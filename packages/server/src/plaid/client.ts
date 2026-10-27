import { hideSecrets, type Log } from '../log.js';
import { PLAID_URLS, SandboxOnlyError, plaidLock, tokenEnvironment, type PlaidEnvironment, type PlaidKeys } from './sandbox-lock.js';
import type {
  WebhookKeyResponse,
  AccountsGetResponse,
  ItemGetResponse,
  LiabilitiesGetResponse,
  PlaidErrorBody,
  SandboxTransaction,
  TransactionsSyncResponse,
} from './types.js';

// A small Plaid client: only the calls the app needs, to the test bank, or
// (Phase 7, the production switch in sandbox-lock.ts) to the real bank when
// its keys are for it and the lock allows it right then. Rule 0.4: the app is
// read-only toward the bank, so the list below has no call that can move
// money. The access token is sent in the request body, which is never
// logged; the API keys go in headers.

// A44: how much history a new connection asks the bank for. It cannot change once connected.
export const HISTORY_DAYS = 90;

const MIXED = 'a test-bank key is never sent to the real bank, nor a real key to the test bank';

// Pinned, so Plaid's answers do not change shape under the app.
export const PLAID_API_VERSION = '2020-09-14';

export const ENDPOINTS = {
  // Reading the bank.
  transactionsSync: '/transactions/sync',
  accountsGet: '/accounts/get',
  liabilitiesGet: '/liabilities/get',
  itemGet: '/item/get',
  // Asks Plaid to look at the bank again now.
  transactionsRefresh: '/transactions/refresh',
  // Turning a new connection's link key into its bank key.
  publicTokenExchange: '/item/public_token/exchange',
  // 1.1 and 1.3: a key for the bank's own login screen (Plaid Link), to
  // connect, or to log in again on the same connection. It reads nothing.
  linkTokenCreate: '/link/token/create',
  // Section 2 (A47), Plaid's webhooks: the public key that checks a
  // webhook's signature, and the address Plaid sends a connection's webhooks
  // to. Configuration, never money.
  webhookVerificationKeyGet: '/webhook_verification_key/get',
  itemWebhookUpdate: '/item/webhook/update',
  // The test bank only: make a connection without screens, add test
  // transactions, and pretend the bank wants a new login.
  sandboxPublicTokenCreate: '/sandbox/public_token/create',
  sandboxTransactionsCreate: '/sandbox/transactions/create',
  sandboxItemResetLogin: '/sandbox/item/reset_login',
} as const;

type Endpoint = (typeof ENDPOINTS)[keyof typeof ENDPOINTS];

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type Fetch = (
  url: string,
  init: { readonly method: 'POST'; readonly headers: Record<string, string>; readonly body: string; readonly signal?: AbortSignal },
) => Promise<FetchResponse>;

// The access token of a connection. It shows as [bank key] wherever it is
// printed. It is a test-bank key or a real one, and says which; a client
// sends it only to its own bank.
export class BankKey {
  readonly #token: string;
  readonly environment: PlaidEnvironment;

  constructor(token: string) {
    this.environment = tokenEnvironment(token, 'access');
    this.#token = token;
  }

  reveal(): string {
    return this.#token;
  }

  toJSON(): string {
    return '[bank key]';
  }

  toString(): string {
    return '[bank key]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[bank key]';
  }
}

export class PlaidError extends Error {
  override readonly name = 'PlaidError';
  readonly endpoint: Endpoint;
  // The HTTP status, or null when Plaid could not be reached.
  readonly status: number | null;
  readonly errorType: string;
  readonly errorCode: string;
  readonly requestId: string | null;

  constructor(endpoint: Endpoint, status: number | null, body: PlaidErrorBody, message: string) {
    super(message);
    this.endpoint = endpoint;
    this.status = status;
    this.errorType = body.error_type;
    this.errorCode = body.error_code;
    this.requestId = body.request_id ?? null;
  }
}

export interface PlaidClientOptions {
  readonly fetch?: Fetch;
  readonly log: Log;
  readonly timeoutMs?: number;
}

export class PlaidClient {
  readonly #keys: PlaidKeys;
  readonly #fetch: Fetch;
  readonly #log: Log;
  readonly #timeoutMs: number;

  constructor(keys: PlaidKeys, options: PlaidClientOptions) {
    this.#keys = keys;
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
    this.#log = options.log;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  // Which bank it sends to: Plaid's test bank, or the real one (Phase 7).
  get environment(): PlaidEnvironment {
    return this.#keys.environment;
  }

  toJSON(): string {
    return '[PlaidClient]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[PlaidClient]';
  }

  // Changes since the cursor; the whole history when there is none.
  syncTransactions(key: BankKey, cursor: string | null, count: number): Promise<TransactionsSyncResponse> {
    return this.#post(ENDPOINTS.transactionsSync, {
      access_token: key.reveal(),
      ...(cursor === null ? {} : { cursor }),
      count,
      options: { include_original_description: true },
    }, key);
  }

  getAccounts(key: BankKey): Promise<AccountsGetResponse> {
    return this.#post(ENDPOINTS.accountsGet, { access_token: key.reveal() }, key);
  }

  getLiabilities(key: BankKey): Promise<LiabilitiesGetResponse> {
    return this.#post(ENDPOINTS.liabilitiesGet, { access_token: key.reveal() }, key);
  }

  getItem(key: BankKey): Promise<ItemGetResponse> {
    return this.#post(ENDPOINTS.itemGet, { access_token: key.reveal() }, key);
  }

  async refreshTransactions(key: BankKey): Promise<void> {
    await this.#post(ENDPOINTS.transactionsRefresh, { access_token: key.reveal() }, key);
  }

  async exchangePublicToken(publicToken: string): Promise<{ readonly key: BankKey; readonly itemId: string }> {
    if (tokenEnvironment(publicToken, 'public') !== this.#keys.environment) throw new SandboxOnlyError(MIXED);
    const reply = await this.#post<{ access_token: string; item_id: string }>(ENDPOINTS.publicTokenExchange, { public_token: publicToken });
    const key = new BankKey(reply.access_token);
    if (key.environment !== this.#keys.environment) throw new SandboxOnlyError(MIXED);
    return { key, itemId: reply.item_id };
  }

  // 1.1: a key for the bank's own login screen (Plaid Link), for a new
  // connection: transactions and card statements, 90 days of history (A44),
  // and (section 2, A47) the address Plaid sends its webhooks to, when there
  // is one. 1.3: with `updateKey`, logging in again on that same connection
  // (Plaid's update mode, where a webhook address has no effect: the
  // connection keeps its own), where he can also add an account that is
  // missing. It never makes a connection itself; Link does, once he logs in.
  // Her rulebook, section 2: historyDays asks for that many days instead (her
  // setup's 730; Plaid takes it only when the connection is made, TXN-009).
  async createLinkToken(input: { readonly clientUserId: string; readonly updateKey?: BankKey; readonly webhook?: string | null; readonly historyDays?: number }): Promise<string> {
    const body: Record<string, unknown> = { client_name: 'Budget App', language: 'en', country_codes: ['US'], user: { client_user_id: input.clientUserId } };
    if (input.updateKey === undefined) Object.assign(body, { products: ['transactions', 'liabilities'], transactions: { days_requested: input.historyDays ?? HISTORY_DAYS }, ...(input.webhook === undefined || input.webhook === null ? {} : { webhook: input.webhook }) });
    else Object.assign(body, { access_token: input.updateKey.reveal(), update: { account_selection_enabled: true } });
    const reply = await this.#post<{ link_token?: unknown }>(ENDPOINTS.linkTokenCreate, body, input.updateKey);
    if (typeof reply.link_token !== 'string' || reply.link_token === '') throw new Error('Plaid sent no link key');
    return reply.link_token;
  }

  // Section 2 (A47): the public key Plaid signs webhooks with, by its id. No
  // bank key is sent.
  getWebhookVerificationKey(kid: string): Promise<WebhookKeyResponse> {
    return this.#post(ENDPOINTS.webhookVerificationKeyGet, { key_id: kid });
  }

  // Section 2 (A47): the address Plaid sends this connection's webhooks to.
  // The same connection: nothing new is made, and nothing is read.
  async updateWebhook(key: BankKey, webhook: string): Promise<{ readonly itemId: string }> {
    const reply = await this.#post<{ item?: { item_id?: unknown } }>(ENDPOINTS.itemWebhookUpdate, { access_token: key.reveal(), webhook }, key);
    const itemId = reply.item?.item_id;
    if (typeof itemId !== 'string' || itemId === '') throw new Error('Plaid did not say which connection');
    return { itemId };
  }

  // The test bank's way to connect without screens. With the username
  // user_custom, the password is a description of the accounts to make.
  async createSandboxPublicToken(input: {
    readonly institutionId: string;
    readonly products: readonly string[];
    readonly username?: string;
    readonly password?: string;
    readonly daysRequested?: number;
  }): Promise<string> {
    this.#testBankOnly();
    const options: Record<string, unknown> = {};
    if (input.username !== undefined) options['override_username'] = input.username;
    if (input.password !== undefined) options['override_password'] = input.password;
    if (input.daysRequested !== undefined) options['transactions'] = { days_requested: input.daysRequested };
    const reply = await this.#post<{ public_token: string }>(ENDPOINTS.sandboxPublicTokenCreate, {
      institution_id: input.institutionId,
      initial_products: input.products,
      options,
    });
    if (tokenEnvironment(reply.public_token, 'public') !== 'sandbox') throw new SandboxOnlyError('that link key is not a test-bank key');
    return reply.public_token;
  }

  async createSandboxTransactions(key: BankKey, transactions: readonly SandboxTransaction[]): Promise<void> {
    this.#testBankOnly();
    await this.#post(ENDPOINTS.sandboxTransactionsCreate, { access_token: key.reveal(), transactions }, key);
  }

  async resetSandboxLogin(key: BankKey): Promise<void> {
    this.#testBankOnly();
    await this.#post(ENDPOINTS.sandboxItemResetLogin, { access_token: key.reveal() }, key);
  }

  #testBankOnly(): void {
    if (this.#keys.environment !== 'sandbox') throw new SandboxOnlyError('the test bank only: never on the real bank');
  }

  async #post<T>(endpoint: Endpoint, body: Record<string, unknown>, key?: BankKey): Promise<T> {
    const environment = this.#keys.environment;
    // Asked again right before each request, with the process's own environment.
    if (environment !== 'sandbox' && plaidLock() !== 'hosted') throw new SandboxOnlyError("Plaid's real bank is never reached under the tests, in a break-it run, or with PLAID_LOCK=sandbox");
    if (key !== undefined && key.environment !== environment) throw new SandboxOnlyError(MIXED);
    const base = PLAID_URLS[environment];
    const url = `${base}${endpoint}`;
    if (!url.startsWith(`${base}/`)) throw new SandboxOnlyError('every request goes to its own bank');
    const secrets = [this.#keys.clientId, this.#keys.secret];
    let response: FetchResponse;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PLAID-CLIENT-ID': this.#keys.clientId,
          'PLAID-SECRET': this.#keys.secret,
          'Plaid-Version': PLAID_API_VERSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      // What went wrong is kept to its kind. The error from the network layer
      // is not passed on, in case it carries any of what was sent.
      const kind = error instanceof Error ? hideSecrets(error.name, secrets) : 'unknown';
      this.#log.warn('plaid unreachable', { endpoint, kind });
      throw new PlaidError(endpoint, null, { error_type: 'NETWORK', error_code: 'NETWORK_ERROR' }, `Plaid ${endpoint} could not be reached (${kind})`);
    }
    const text = await response.text();
    let reply: unknown;
    try {
      reply = JSON.parse(text);
    } catch {
      this.#log.warn('plaid answer not JSON', { endpoint, status: response.status });
      throw new PlaidError(endpoint, response.status, { error_type: 'API_ERROR', error_code: 'NOT_JSON' }, `Plaid ${endpoint} answered with something that is not JSON`);
    }
    if (!response.ok) {
      const error = plaidErrorBody(reply);
      this.#log.warn('plaid error', { endpoint, status: response.status, errorCode: error.error_code, requestId: error.request_id ?? null });
      const said = error.error_message === undefined ? '' : `: ${hideSecrets(error.error_message, secrets)}`;
      throw new PlaidError(endpoint, response.status, error, `Plaid ${endpoint} failed with ${error.error_code} (${error.error_type})${said}`);
    }
    const requestId = typeof reply === 'object' && reply !== null && 'request_id' in reply ? String(reply.request_id) : null;
    this.#log.info('plaid', { endpoint, status: response.status, requestId });
    return reply as T;
  }
}

function plaidErrorBody(reply: unknown): PlaidErrorBody {
  const r = (typeof reply === 'object' && reply !== null ? reply : {}) as Record<string, unknown>;
  const text = (value: unknown, fallback: string): string => (typeof value === 'string' && value !== '' ? value : fallback);
  return {
    error_type: text(r['error_type'], 'API_ERROR'),
    error_code: text(r['error_code'], 'UNKNOWN'),
    ...(typeof r['error_message'] === 'string' ? { error_message: r['error_message'] } : {}),
    ...(typeof r['request_id'] === 'string' ? { request_id: r['request_id'] } : {}),
  };
}

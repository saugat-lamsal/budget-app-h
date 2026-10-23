import type { AccountId, IsoDate } from '@budget-app/money';
import type { StoredAccount } from './bank/stored-account.js';
import type { TokenBox } from './crypto/token-box.js';
import type { Db } from './db/database.js';
import { readAccounts, readConnection, saveAccount, saveNewConnection, setAccountRoles } from './db/store.js';
import type { Log } from './log.js';
import { todayIn } from './history/today.js';
import { BankKey, type PlaidClient } from './plaid/client.js';
import { saveServerLine } from './server-log.js';
import type { BankAccountLine, BankAnswer, BankConnectedRequest, BankConnectionView, BankLinkAnswer, BankLinkRequest, BankRefusal, BankRolesRequest } from './views/bank.js';

// Rules 1.1 to 1.3 (QUESTIONS.md A46): connecting the bank, which account is
// which, and logging in to the bank again. Plaid Link, in the browser, shows
// the bank's own login; this desk makes its link key, keeps the connection
// the moment Link hands back the bank's answer, and keeps his picks. There is
// only ever one connection (1.1): it never makes a second and never removes
// one, and logging in again (1.3) keeps the same one, so it never uses
// another of the 10 Plaid allows.

// His four accounts (section 1), in the order the screen asks about them.
export const ROLES: readonly AccountId[] = ['checking', 'savings', 'everyday-card', 'old-card'];

// Plaid asks for an id for the person connecting: there is one, and it is
// never his name or email.
export const CLIENT_USER_ID = 'budget-app-owner';

// All four are picked, each once (1.2): only then is the bank read. Her
// setup picks three: the old card is off ("Off in this setup", rolesFor).
export function rolesComplete(accounts: readonly StoredAccount[], asked: readonly AccountId[] = ROLES): boolean {
  const roles = accounts.flatMap((a) => (a.role === null ? [] : [a.role]));
  return asked.every((role) => roles.includes(role));
}

const ROLE_WORDS: Readonly<Record<AccountId, string>> = { checking: 'checking', savings: 'savings', 'everyday-card': 'the everyday card', 'old-card': 'the old card' };
const countWord = (roles: readonly AccountId[]): string => (roles.length === 3 ? 'three' : 'four');

// "Pick each of the four: checking, savings, the everyday card, and the old card."
function pickEach(roles: readonly AccountId[]): string {
  const names = roles.map((role) => ROLE_WORDS[role]);
  return `Pick each of the ${countWord(roles)}: ${names.slice(0, -1).join(', ')}, and ${names.at(-1) ?? ''}.`;
}

export interface BankDeskInput {
  readonly db: Db;
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  readonly log: Log;
  readonly today: () => IsoDate;
  // His home time zone (section 2): the permission's end is his date (10.13).
  readonly zone: () => string;
  // Tracking has started (setup day is done): the picks cannot change (1.2).
  readonly tracking: () => boolean;
  // How many lines the book's change log has, for the order of the log (13.5).
  readonly bookLines: () => number;
  // Reads the bank (a sync), once all four are picked.
  readonly sync: () => Promise<unknown>;
  // 1.2: the accounts to pick (rolesFor); upstream's four when not given.
  readonly roles?: () => readonly AccountId[];
  // Section 2 (A47): where Plaid sends a new connection's webhooks (the hosted
  // server's https address); null where Plaid cannot reach the app.
  readonly webhook?: () => string | null;
  // The books read again, and the alerts told.
  readonly changed: () => void;
}

const refuse = (code: BankRefusal['code'], why: string): BankRefusal => ({ ok: false, code, why });

// 1.1: what connecting asks first. On the test bank (the rehearsal) a
// connection uses none of the 10.
export function connectQuestion(bank: 'test' | 'real'): string {
  const slots = bank === 'test' ? "Connecting to Plaid's test bank is free: it uses none of your 10 real connections." : 'Connecting uses 1 of the 10 connections Plaid allows, and one that is removed never comes back.';
  return `${slots} Connect the bank?`;
}

export class BankDesk {
  readonly #input: BankDeskInput;
  // A connection on its way: a second answer from Link meanwhile is never exchanged.
  #connecting: Promise<BankAnswer> | null = null;

  constructor(input: BankDeskInput) {
    this.#input = input;
  }

  get #roles(): readonly AccountId[] {
    return this.#input.roles?.() ?? ROLES;
  }

  get #bank(): 'test' | 'real' {
    return this.#input.plaid.environment === 'production' ? 'real' : 'test';
  }

  view(): BankConnectionView {
    const { db } = this.#input;
    const connection = readConnection(db);
    if (connection === null) return { state: 'none', bank: this.#bank };
    const accounts = readAccounts(db);
    return {
      state: 'connected',
      bank: this.#bank,
      connectedOn: connection.connectedOn,
      needsLogin: connection.needsLogin,
      accounts: accounts.map(lineOf),
      // Only when they are not upstream's four (her setup's three).
      ...(this.#roles.includes('old-card') ? {} : { roles: this.#roles }),
      rolesSet: rolesComplete(accounts, this.#roles),
      rolesFixed: this.#input.tracking(),
      permissionEnds: connection.permissionEnds === null ? null : todayIn(this.#input.zone(), new Date(connection.permissionEnds)),
      historyComplete: connection.historyComplete,
    };
  }

  // A link key for Plaid Link: to connect (1.1, asks first), or to log in
  // again on the same connection (1.3).
  async link(request: BankLinkRequest): Promise<BankLinkAnswer> {
    const { db, box } = this.#input;
    const connection = readConnection(db);
    if (request.mode === 'connect') {
      if (connection !== null) return refuse('connected-already', 'The bank is connected already. The app never makes a second connection.');
      if (!request.yes) return refuse('needs-yes', connectQuestion(this.#bank));
      return this.#linkToken();
    }
    if (connection === null) return refuse('not-connected', 'There is no bank connection yet. Connect the bank first.');
    return this.#linkToken(new BankKey(box.open(connection.sealedKey, connection.itemId)));
  }

  async #linkToken(updateKey?: BankKey): Promise<BankLinkAnswer> {
    try {
      const linkToken = await this.#input.plaid.createLinkToken({ clientUserId: CLIENT_USER_ID, ...(updateKey === undefined ? { webhook: this.#input.webhook?.() ?? null } : { updateKey }) });
      return { ok: true, linkToken };
    } catch (error) {
      this.#input.log.warn('no link key from Plaid', { kind: kindOf(error) });
      return refuse('bank-said-no', "Plaid couldn't open the bank's login just now. Nothing was changed. Try again in a minute.");
    }
  }

  // 1.1: Link handed back the bank's answer. One at a time, and only while
  // nothing is connected: the connection is kept the moment the bank gives it.
  connected(request: BankConnectedRequest): Promise<BankAnswer> {
    if (this.#connecting !== null) return Promise.resolve(refuse('busy', 'The bank is being connected already.'));
    const running = this.#connect(request.publicToken).finally(() => {
      this.#connecting = null;
    });
    this.#connecting = running;
    return running;
  }

  async #connect(publicToken: string): Promise<BankAnswer> {
    const { db, plaid, box, log, today } = this.#input;
    if (readConnection(db) !== null) return refuse('connected-already', 'The bank is connected already. The app never makes a second connection.');
    let exchanged: { readonly key: BankKey; readonly itemId: string };
    try {
      exchanged = await plaid.exchangePublicToken(publicToken);
    } catch (error) {
      log.warn('the bank did not take the answer from its login', { kind: kindOf(error) });
      return refuse('bank-said-no', "The bank didn't take that, so nothing was connected. Try Connect the bank again.");
    }
    const { key, itemId } = exchanged;
    // Kept at once, sealed, with its change log line (13.5), in one step.
    db.transaction(() => {
      saveNewConnection(db, { itemId, institutionId: null, sealedKey: box.seal(key.reveal(), itemId), connectedOn: today() });
      saveServerLine(db, { date: today(), action: 'bank-connected', bank: this.#bank, afterBookLines: this.#input.bookLines() });
    })();
    log.info('connected to the bank', { itemId });
    // The accounts, for him to pick from. If they cannot be read now, the next look reads them.
    try {
      await this.#readAccounts(key);
    } catch (error) {
      log.warn('the accounts could not be read right after connecting', { kind: kindOf(error) });
    }
    this.#input.changed();
    return { ok: true, said: 'The bank is connected. Now say which account is which.' };
  }

  // 1.2: each of his four accounts, by the bank's account id. Asks first.
  roles(request: BankRolesRequest): BankAnswer {
    const { db, today } = this.#input;
    if (this.#input.tracking()) return refuse('roles-fixed', 'Tracking has started, so which account is which cannot change.');
    if (readConnection(db) === null) return refuse('not-connected', 'There is no bank connection yet. Connect the bank first.');
    const accounts = readAccounts(db);
    const roles = this.#roles;
    const named = Object.keys(request.roles).sort();
    if (named.join() !== [...roles].sort().join()) return refuse('not-roles', pickEach(roles));
    const picked = roles.map((role) => accounts.find((a) => a.plaidAccountId === request.roles[role]));
    if (picked.some((a) => a === undefined)) return refuse('not-roles', "Each must be one of the bank's accounts. If one is missing, log in to the bank again to add it.");
    if (new Set(picked).size !== roles.length) return refuse('not-roles', `An account can be only one of the ${countWord(roles)}.`);
    if (!request.yes) return refuse('needs-yes', 'Once tracking starts, which account is which cannot change. Keep these?');
    db.transaction(() => {
      setAccountRoles(db, Object.fromEntries(roles.map((role) => [request.roles[role], role])));
      saveServerLine(db, { date: today(), action: 'bank-accounts', accounts: Object.fromEntries(roles.map((role, i) => [role, labelOf(picked[i] as StoredAccount)])) as Record<AccountId, string>, afterBookLines: this.#input.bookLines() });
    })();
    this.#input.changed();
    return { ok: true, said: 'Saved. The bank is read now.' };
  }

  // Reads the accounts again (a new login, or one missing: 1.3), and the bank
  // too once all four are picked (1.2). After logging in again, says so in
  // the change log (13.5).
  async read(options: { readonly loggedInAgain?: boolean } = {}): Promise<BankAnswer> {
    const { db, box, log, today } = this.#input;
    const connection = readConnection(db);
    if (connection === null) return refuse('not-connected', 'There is no bank connection yet. Connect the bank first.');
    try {
      await this.#readAccounts(new BankKey(box.open(connection.sealedKey, connection.itemId)));
    } catch (error) {
      log.warn('the accounts could not be read', { kind: kindOf(error) });
      this.#input.changed();
      return refuse('bank-said-no', "The bank couldn't be read just now. Nothing was changed. Try again in a minute.");
    }
    if (options.loggedInAgain === true) saveServerLine(db, { date: today(), action: 'bank-logged-in-again', afterBookLines: this.#input.bookLines() });
    if (rolesComplete(readAccounts(db), this.#roles)) {
      try {
        await this.#input.sync();
      } catch (error) {
        log.warn('the bank could not be read', { kind: kindOf(error) });
      }
    }
    this.#input.changed();
    return { ok: true, said: rolesComplete(readAccounts(db), this.#roles) ? 'The bank was read.' : 'The accounts were read. Now say which account is which.' };
  }

  async #readAccounts(key: BankKey): Promise<void> {
    const { db, plaid } = this.#input;
    const reply = await plaid.getAccounts(key);
    const stored = new Map(readAccounts(db).map((a) => [a.plaidAccountId, a.rawText]));
    db.transaction(() => {
      // 0: read when connecting or logging in again, not by a sync.
      for (const account of reply.accounts) if (stored.get(account.account_id) !== JSON.stringify(account)) saveAccount(db, account, JSON.stringify(account), 0);
    })();
  }
}

function lineOf(a: StoredAccount): BankAccountLine {
  return { id: a.plaidAccountId, name: a.raw.name, mask: a.raw.mask ?? null, kind: [a.raw.type, a.raw.subtype].filter((p) => p !== null && p !== undefined && p !== '').join(' '), role: a.role };
}

// How an account is named in the change log: its name and last digits.
function labelOf(a: StoredAccount): string {
  return a.raw.mask === null || a.raw.mask === undefined ? a.raw.name : `${a.raw.name} ••${a.raw.mask}`;
}

// What went wrong, by its kind only: never what was sent.
function kindOf(error: unknown): string {
  if (error instanceof Error) return 'errorCode' in error && typeof error.errorCode === 'string' ? error.errorCode : error.name;
  return 'unknown';
}

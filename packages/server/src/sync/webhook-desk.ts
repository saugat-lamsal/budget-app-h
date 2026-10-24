import { createHash } from 'node:crypto';
import type { Log } from '../log.js';
import { WEBHOOK_AHEAD_SECONDS, WEBHOOK_MAX_AGE_SECONDS, verifyWebhook, type PlaidWebhook, type WebhookKeys } from '../plaid/webhook.js';
import type { TimerClock } from '../serve/sync-timer.js';

// Section 2 (QUESTIONS.md A47): what the app does with a webhook from Plaid.
// It is answered at once (Plaid gives up on an answer after 10 seconds) and
// the work is done after. A webhook is only a trigger: the app syncs, and
// reads from the bank itself what is new (new transactions, the bank wanting
// a new login (10.5), its permission running out (10.13), new statements).
// Nothing a webhook says is ever taken as money.
// - Plaid sends each at least once, in any order: the same signed call again
//   does nothing more, and every action is a sync, which is safe to repeat.
// - A burst of calls makes one sync: it starts once the burst has had two
//   seconds to come in. Calls while a sync is on its way make one more after
//   it. One that waits on a sync already on its way (the timer's) starts its
//   own after it, so what Plaid has now is read. Never two syncs at once: the
//   books' own lock (Keeper.sync) sees to that, for the timer and webhooks.
// - Only his connection's webhooks are taken (the item_id is his). Her setup
//   (her rulebook, section 2, HB11): either of her connections', and each
//   syncs the banks its burst named.
// - More than 30 calls a minute: the rest are answered 429, unlooked at.
// - What was refused is logged with why, never with the body or the header.
// The 60-minute timer stays (Plaid drops a webhook after 24 hours of tries).

export type WebhookAction = 'sync' | 'note' | 'nothing';

const SYNC_CODES: Readonly<Record<string, readonly string[]>> = {
  TRANSACTIONS: ['SYNC_UPDATES_AVAILABLE'],
  ITEM: ['ERROR', 'LOGIN_REPAIRED', 'PENDING_DISCONNECT', 'PENDING_EXPIRATION', 'USER_PERMISSION_REVOKED', 'USER_ACCOUNT_REVOKED', 'NEW_ACCOUNTS_AVAILABLE'],
  LIABILITIES: ['DEFAULT_UPDATE'],
};

// What a webhook makes the app do. TRANSACTIONS' other codes are for Plaid's
// older way of reading (the app reads with /transactions/sync only).
export function webhookAction(w: PlaidWebhook): WebhookAction {
  if (SYNC_CODES[w.type]?.includes(w.code) === true) return 'sync';
  if (w.type === 'ITEM' && w.code === 'WEBHOOK_UPDATE_ACKNOWLEDGED') return 'note';
  return 'nothing';
}

export const GATHER_MS = 2_000;
export const CALLS_PER_MINUTE = 30;

export interface WebhookDeskInput {
  readonly keys: WebhookKeys;
  // His connection's item_id; null before there is one.
  readonly itemId: () => string | null;
  // One sync (Keeper.sync), and the one on its way, if any (Keeper.syncOnItsWay).
  readonly sync: () => Promise<unknown>;
  // Her setup: every connection's item_id, and a sync of the banks these
  // items are (Keeper.syncItems), in place of itemId and sync.
  readonly itemIds?: () => readonly string[];
  readonly syncItems?: (itemIds: readonly string[]) => Promise<unknown>;
  readonly onItsWay: () => Promise<unknown> | null;
  readonly clock: TimerClock;
  readonly now: () => Date;
  readonly log: Log;
  readonly gatherMs?: number;
  readonly perMinute?: number;
}

export interface WebhookAnswer {
  readonly status: number;
  readonly text: string;
}

const WORDS: Readonly<Record<number, string>> = { 200: 'ok', 400: 'Not a webhook.', 401: 'Not signed by Plaid.', 403: 'Not this connection.', 429: 'Too many.', 503: 'Try again later.' };
const answer = (status: number): WebhookAnswer => ({ status, text: WORDS[status] ?? 'No.' });

export class WebhookDesk {
  readonly #input: WebhookDeskInput;
  readonly #gatherMs: number;
  readonly #perMinute: number;
  // When each call came, in the last minute (ms).
  #calls: number[] = [];
  // The signed calls already taken (by their SHA-256), until they are too old to be taken anyway.
  readonly #seen = new Map<string, number>();
  #gather: unknown = null;
  #running: Promise<void> | null = null;
  #again = false;
  #stopped = false;
  // Her setup: the items the calls since the last sync started named.
  #items = new Set<string>();

  constructor(input: WebhookDeskInput) {
    this.#input = input;
    this.#gatherMs = input.gatherMs ?? GATHER_MS;
    this.#perMinute = input.perMinute ?? CALLS_PER_MINUTE;
  }

  async receive(request: { readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>; readonly body: Uint8Array }): Promise<WebhookAnswer> {
    const { log } = this.#input;
    const now = this.#input.now();
    const ms = now.getTime();
    this.#calls = this.#calls.filter((t) => ms - t < 60_000);
    if (this.#calls.length >= this.#perMinute) {
      log.warn('webhook refused', { why: 'too many calls this minute', status: 429 });
      return answer(429);
    }
    this.#calls.push(ms);
    const verified = await verifyWebhook({ headers: request.headers, body: request.body, now, keys: this.#input.keys });
    if (!verified.ok) {
      log.warn('webhook refused', { why: verified.why, status: verified.status });
      return answer(verified.status);
    }
    const { webhook } = verified;
    const mine = this.#input.itemIds?.() ?? [this.#input.itemId()].flatMap((id) => (id === null ? [] : [id]));
    if (webhook.itemId === null || !mine.includes(webhook.itemId)) {
      log.warn('webhook refused', { why: mine.length === 0 ? 'there is no bank connection' : 'not his connection', status: 403 });
      return answer(403);
    }
    for (const [id, until] of this.#seen) if (until <= ms) this.#seen.delete(id);
    const id = createHash('sha256').update(verified.token).digest('hex');
    if (this.#seen.has(id)) {
      log.info('webhook repeat', { type: webhook.type, code: webhook.code });
      return answer(200);
    }
    this.#seen.set(id, ms + (WEBHOOK_MAX_AGE_SECONDS + WEBHOOK_AHEAD_SECONDS) * 1000);
    const action = webhookAction(webhook);
    log.info('webhook', { type: webhook.type, code: webhook.code, ...(webhook.errorCode === null ? {} : { errorCode: webhook.errorCode }), action });
    if (action === 'note') log.info('webhook address confirmed by Plaid');
    if (action === 'sync') {
      this.#items.add(webhook.itemId ?? '');
      this.#want();
    }
    return answer(200);
  }

  // Resolves once no sync of the desk's is on its way.
  async idle(): Promise<void> {
    while (this.#running !== null) await this.#running;
  }

  // No sync starts after this; one on its way is waited for.
  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#gather !== null) this.#input.clock.clearTimeout(this.#gather);
    this.#gather = null;
    await this.idle();
  }

  #want(): void {
    if (this.#stopped) return;
    if (this.#running !== null) {
      this.#again = true;
      return;
    }
    if (this.#gather !== null) return;
    this.#gather = this.#input.clock.setTimeout(() => {
      this.#gather = null;
      this.#run();
    }, this.#gatherMs);
  }

  #run(): void {
    if (this.#stopped) return;
    const work = async (): Promise<void> => {
      try {
        const onItsWay = this.#input.onItsWay();
        if (onItsWay !== null) await onItsWay.catch(() => undefined);
        const items = [...this.#items].sort();
        this.#items = new Set();
        const { syncItems } = this.#input;
        await (syncItems === undefined ? this.#input.sync() : syncItems(items));
      } catch (error) {
        this.#input.log.warn('webhook sync failed', { error: error instanceof Error ? error.message : String(error) });
      }
    };
    this.#running = work().finally(() => {
      this.#running = null;
      if (this.#again) {
        this.#again = false;
        this.#want();
      }
    });
  }
}

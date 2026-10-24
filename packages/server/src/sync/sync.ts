import type { Book, Cents, IsoDate } from '@budget-app/money';
import { bankAtRead, bankView } from '../bank/balances.js';
import { connectionAt, noteBankRead, saveConnectionStateAt, savePermissionEndsAt, type BankNumber } from '../bank/connections.js';
import { keepStatement } from '../bank/kept-statements.js';
import type { BankAtRead } from '../bank/why.js';
import type { TokenBox } from '../crypto/token-box.js';
import type { Db } from '../db/database.js';
import {
  addAttention,
  loadBook,
  nextSyncNumber,
  readAccounts,
  readBankRules,
  readItems,
  readStatements,
  rolesOf,
  saveAccount,
  saveItem,
  saveStatement,
  saveSync,
} from '../db/store.js';
import type { Log } from '../log.js';
import { BankKey, PlaidError, type PlaidClient } from '../plaid/client.js';
import type { AccountsGetResponse, LiabilitiesGetResponse, PlaidCreditCard, TransactionsSyncResponse } from '../plaid/types.js';
import { appendEvent } from '../history/history-db.js';
import { saveBankRead } from './bank-reads.js';
import { planSync, type Attention, type Plan, type PlanInput } from './plan.js';

// One sync: everything Plaid has that is new since the last one, then the
// balances and card statements, saved in one transaction together with the
// cursor for the next sync. So a sync is all or nothing:
// - Interrupted before the save (Plaid unreachable, the app stopped), it
//   saved nothing, and the next sync starts from the same cursor.
// - Run again with nothing new, it changes nothing at all.
// - Two at once: the second to save sees that the cursor moved, and starts
//   over from the new one, so nothing is counted twice.

export interface SyncInput {
  readonly db: Db;
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  readonly log: Log;
  // His calendar date, for anything the bank does not date (a dropped charge).
  readonly today: IsoDate;
  // Changes asked for per page (Plaid allows 1 to 500).
  readonly pageSize?: number;
  // For tests: runs inside the save, after the changes are written and
  // before they are committed.
  readonly beforeCommit?: () => void;
  // The moment the bank was read (Step 3): noted with what the sync saves, in
  // the same transaction, whether or not it brought anything new (database
  // step 4). Without it, a sync with nothing new writes nothing at all.
  readonly readAt?: () => string;
  // Runs right after the save is committed, in the same step, before anything
  // else can run: the real server reads its books again there, so an answer
  // that comes in next is given to the book with the sync in it.
  readonly afterSave?: (result: SyncResult) => void;
  // For tests only: how what the bank sent becomes what the book is given.
  readonly plan?: (input: PlanInput) => Plan;
  // Her rulebook, section 2 (PR 6): which of her banks this sync reads; bank
  // 1, upstream's one connection, when left out.
  readonly bank?: BankNumber;
}

export interface SyncResult {
  // False when there was nothing new, and nothing was written.
  readonly changed: boolean;
  // 10.5: the bank wants him to log in again. Nothing else was done.
  readonly needsLogin: boolean;
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
  // Given to the book.
  readonly sent: number;
  // New things waiting for his decision.
  readonly attention: readonly Attention[];
  readonly historyComplete: boolean;
}

interface Fetched {
  readonly pages: readonly TransactionsSyncResponse[];
  readonly cursor: string;
  readonly accounts: AccountsGetResponse;
  readonly cards: readonly PlaidCreditCard[] | null;
  // 10.13: when the bank's permission runs out, as it says now; undefined
  // when it could not say just then (the date kept is left as it is).
  readonly permissionEnds: string | null | undefined;
}

const TRIES = 3;

export async function syncBank(input: SyncInput): Promise<SyncResult> {
  const { db, log } = input;
  const bank = input.bank ?? 1;
  for (let attempt = 1; ; attempt += 1) {
    const connection = connectionAt(db, bank);
    if (connection === null) throw new Error(bank === 1 ? 'there is no bank connection yet' : 'her second bank is not connected yet');
    const key = new BankKey(input.box.open(connection.sealedKey, connection.itemId));
    let fetched: Fetched;
    try {
      fetched = await fetchUpdate(input.plaid, key, connection.cursor, input.pageSize ?? 250);
    } catch (error) {
      if (error instanceof PlaidError && error.errorCode === 'ITEM_LOGIN_REQUIRED') {
        if (!connection.needsLogin) saveConnectionStateAt(db, bank, { cursor: connection.cursor, historyComplete: connection.historyComplete, needsLogin: true });
        log.warn('the bank wants a new login');
        return { changed: !connection.needsLogin, needsLogin: true, added: 0, modified: 0, removed: 0, sent: 0, attention: [], historyComplete: connection.historyComplete };
      }
      throw error;
    }
    const result = db.transaction(() => save(input, connection.cursor, fetched))();
    if (result !== 'cursor-moved') {
      input.afterSave?.(result);
      log.info('sync done', { changed: result.changed, added: result.added, modified: result.modified, removed: result.removed, sent: result.sent, attention: result.attention.length });
      return result;
    }
    log.warn('another sync saved first; starting over', { attempt });
    if (attempt >= TRIES) throw new Error('other syncs kept saving first; try again');
  }
}

// All pages of the update, then the balances and statements, then one more
// look for changes that came in meanwhile, so the balances go with the
// transactions. If Plaid's data changes while paging, paging starts over
// from the first page, as Plaid asks.
async function fetchUpdate(plaid: PlaidClient, key: BankKey, start: string | null, pageSize: number): Promise<Fetched> {
  for (let restart = 0; ; restart += 1) {
    try {
      const pages: TransactionsSyncResponse[] = [];
      let cursor = start;
      const more = async (): Promise<void> => {
        for (;;) {
          const page = checkPage(await plaid.syncTransactions(key, cursor, pageSize));
          pages.push(page);
          cursor = page.next_cursor;
          if (!page.has_more) return;
        }
      };
      await more();
      for (let round = 0; ; round += 1) {
        const accounts = await plaid.getAccounts(key);
        const cards = accounts.accounts.some((a) => a.type === 'credit') ? await creditCards(plaid, key) : null;
        const ends = await permissionEndsFrom(plaid, key);
        const before = pages.length;
        await more();
        const quiet = pages.slice(before).every((p) => p.added.length === 0 && p.modified.length === 0 && p.removed.length === 0);
        if (quiet || round >= 2) return { pages, cursor: cursor ?? '', accounts, cards, permissionEnds: ends };
      }
    } catch (error) {
      if (error instanceof PlaidError && error.errorCode === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && restart < TRIES) continue;
      throw error;
    }
  }
}

async function creditCards(plaid: PlaidClient, key: BankKey): Promise<readonly PlaidCreditCard[] | null> {
  try {
    const reply: LiabilitiesGetResponse = await plaid.getLiabilities(key);
    return reply.liabilities.credit ?? [];
  } catch (error) {
    // Without the Liabilities product there are no statements to read.
    if (error instanceof PlaidError && (error.errorCode === 'PRODUCTS_NOT_SUPPORTED' || error.errorCode === 'NO_LIABILITY_ACCOUNTS')) return null;
    throw error;
  }
}

// 10.13: when the bank's permission runs out (an instant, kept exactly as
// sent; none when the bank sets none). It only informs, so a sync never fails
// for it: when the bank cannot say just then, undefined, and the date kept
// stays. A new login wanted still stops the sync (10.5).
async function permissionEndsFrom(plaid: PlaidClient, key: BankKey): Promise<string | null | undefined> {
  try {
    const value = (await plaid.getItem(key)).item.consent_expiration_time;
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch (error) {
    if (error instanceof PlaidError && error.errorCode !== 'ITEM_LOGIN_REQUIRED') return undefined;
    throw error;
  }
}

function checkPage(page: TransactionsSyncResponse): TransactionsSyncResponse {
  if (!Array.isArray(page.added) || !Array.isArray(page.modified) || !Array.isArray(page.removed) || typeof page.next_cursor !== 'string' || typeof page.has_more !== 'boolean') {
    throw new Error('Plaid sent a transactions page the app cannot read');
  }
  return page;
}

// Inside one database transaction: work out the plan and write all of it.
function save(input: SyncInput, startCursor: string | null, fetched: Fetched): SyncResult | 'cursor-moved' {
  const { db } = input;
  const bank = input.bank ?? 1;
  const connection = connectionAt(db, bank);
  if (connection === null) throw new Error('the bank connection is gone');
  if (connection.cursor !== startCursor) return 'cursor-moved';

  // Pages in order: what each id came to in the end.
  const latest = new Map<string, unknown>();
  const removed = new Set<string>();
  let added = 0;
  let modified = 0;
  let removedCount = 0;
  for (const page of fetched.pages) {
    for (const tx of [...page.added, ...page.modified]) {
      latest.set(tx.transaction_id, tx);
      removed.delete(tx.transaction_id);
    }
    for (const r of page.removed) removed.add(r.transaction_id);
    added += page.added.length;
    modified += page.modified.length;
    removedCount += page.removed.length;
  }
  const statusSeen = fetched.pages.some((p) => p.transactions_update_status === 'HISTORICAL_UPDATE_COMPLETE');
  const historyComplete = connection.historyComplete || statusSeen;

  const sync = nextSyncNumber(db);
  const storedAccounts = readAccounts(db);
  const changedAccounts = fetched.accounts.accounts.filter((a) => storedAccounts.find((s) => s.plaidAccountId === a.account_id)?.rawText !== JSON.stringify(a));
  // Roles are kept; a new Plaid account has none until one is set.
  const roles = rolesOf(storedAccounts);
  const storedCards = readStatements(db);
  const changedCards = (fetched.cards ?? []).flatMap((card) =>
    card.account_id !== null && storedCards.get(card.account_id)?.rawText !== JSON.stringify(card) ? [{ accountId: card.account_id, card }] : [],
  );

  const book = loadBook(db);
  const plan = (input.plan ?? planSync)({
    stored: readItems(db),
    changed: [...latest.values()],
    removed: [...removed],
    roles,
    rules: readBankRules(db),
    book,
    today: input.today,
    sync,
  });

  const plaidSentNothing = added + modified + removedCount === 0;
  const changed =
    !plaidSentNothing ||
    plan.items.length > 0 ||
    plan.events.length > 0 ||
    plan.attention.length > 0 ||
    changedAccounts.length > 0 ||
    changedCards.length > 0 ||
    historyComplete !== connection.historyComplete ||
    (fetched.permissionEnds !== undefined && fetched.permissionEnds !== connection.permissionEnds) ||
    connection.cursor === null ||
    connection.needsLogin;
  const result: SyncResult = {
    changed,
    needsLogin: false,
    added,
    modified,
    removed: removedCount,
    sent: plan.events.length,
    attention: plan.attention,
    historyComplete,
  };
  // Her setup (10.7, 12.3): a good read of this bank.
  const at = input.readAt?.();
  if (at !== undefined) noteBankRead(db, bank, at);
  if (!changed) {
    if (at !== undefined) saveBankRead(db, { at, changed, sync: null, ...whatTheReadFound(db, book, sync - 1) });
    return result;
  }

  for (const account of changedAccounts) saveAccount(db, account, JSON.stringify(account), sync);
  if (fetched.permissionEnds !== undefined && fetched.permissionEnds !== connection.permissionEnds) savePermissionEndsAt(db, bank, fetched.permissionEnds);
  for (const { accountId, card } of changedCards) {
    saveStatement(db, accountId, JSON.stringify(card), sync);
    // Her rulebook, 52.5: each one kept, in her setup.
    keepStatement(db, accountId, card, sync);
  }
  for (const item of plan.items) saveItem(db, item);
  // Each with the day of the sync, and the book's totals after it.
  plan.events.forEach((txn, i) => appendEvent(db, { event: { kind: 'receive', txn }, date: input.today, sync, totals: plan.totals[i] ?? null }));
  for (const attention of plan.attention) addAttention(db, sync, attention);
  // With nothing new from Plaid, the cursor stays as it was.
  const cursor = plaidSentNothing && connection.cursor !== null ? connection.cursor : fetched.cursor;
  saveConnectionStateAt(db, bank, { cursor, historyComplete, needsLogin: false });
  saveSync(db, {
    id: sync,
    today: input.today,
    cursorBefore: startCursor,
    cursorAfter: cursor,
    added,
    modified,
    removed: removedCount,
    sent: plan.events.length,
    held: plan.attention.length,
  });
  if (at !== undefined) saveBankRead(db, { at, changed, sync, ...whatTheReadFound(db, book, sync) });
  input.beforeCommit?.();
  return result;
}

// 12.6 (A57): the bank as this read leaves it, and the check after it, with
// the book as the sync leaves it (the plan gave it what the bank sent).
function whatTheReadFound(db: Db, book: Book | null, syncs: number): { readonly bank: BankAtRead | null; readonly difference: Cents | null } {
  const view = bankView(readAccounts(db), readItems(db));
  if (!view.ok) return { bank: null, difference: null };
  return { bank: bankAtRead(view.view, syncs), difference: book === null ? null : book.selfCheck(view.view.withPending).difference };
}

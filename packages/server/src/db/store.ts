import type { AccountId, Book, IsoDate } from '@budget-app/money';
import { checkBankRules, type BankRule } from '../bank/reading.js';
import type { StoredAccount } from '../bank/stored-account.js';
import { readHistory, replayHistory } from '../history/history-db.js';
import type { PlaidAccount, PlaidCreditCard } from '../plaid/types.js';
import type { Attention, ItemStatus, StoredItem } from '../sync/plan.js';
import { statement, type Db } from './database.js';
import { hasHerSteps, migrateHer } from './her-steps.js';

// Reading and writing the database. Nothing here talks to the bank.

export interface Connection {
  readonly itemId: string;
  readonly institutionId: string | null;
  readonly sealedKey: string;
  readonly cursor: string | null;
  readonly historyComplete: boolean;
  readonly needsLogin: boolean;
  readonly connectedOn: IsoDate;
  // 10.13: when the bank's permission runs out, as an instant; null when it gave none.
  readonly permissionEnds: string | null;
}

export function readConnection(db: Db): Connection | null {
  const row = statement(db, 'SELECT * FROM connection WHERE id = 1').get() as
    | { item_id: string; institution_id: string | null; sealed_key: string; cursor: string | null; history_complete: number; needs_login: number; connected_on: string; permission_ends: string | null }
    | undefined;
  if (row === undefined) return null;
  return {
    itemId: row.item_id,
    institutionId: row.institution_id,
    sealedKey: row.sealed_key,
    cursor: row.cursor,
    historyComplete: row.history_complete === 1,
    needsLogin: row.needs_login === 1,
    connectedOn: row.connected_on,
    permissionEnds: row.permission_ends,
  };
}

// 10.13: what the bank said last about when its permission runs out.
export function savePermissionEnds(db: Db, at: string | null): void {
  db.prepare('UPDATE connection SET permission_ends = ? WHERE id = 1').run(at);
}

export function saveNewConnection(db: Db, c: { itemId: string; institutionId: string | null; sealedKey: string; connectedOn: IsoDate }): void {
  db.prepare('INSERT INTO connection (id, item_id, institution_id, sealed_key, connected_on) VALUES (1, ?, ?, ?, ?)').run(c.itemId, c.institutionId, c.sealedKey, c.connectedOn);
}

export function saveConnectionState(db: Db, state: { cursor: string | null; historyComplete: boolean; needsLogin: boolean }): void {
  db.prepare('UPDATE connection SET cursor = ?, history_complete = ?, needs_login = ? WHERE id = 1').run(
    state.cursor,
    state.historyComplete ? 1 : 0,
    state.needsLogin ? 1 : 0,
  );
}

// ----- Accounts -----

export { rolesOf, type StoredAccount } from '../bank/stored-account.js';

// Her second card's pick is kept in her own table (her-steps.ts, her step 1).
export function readAccounts(db: Db): StoredAccount[] {
  const sql = hasHerSteps(db)
    ? 'SELECT a.plaid_account_id, COALESCE(a.role, h.role) AS role, a.raw FROM accounts a LEFT JOIN her_account_roles h ON h.plaid_account_id = a.plaid_account_id ORDER BY a.plaid_account_id'
    : 'SELECT plaid_account_id, role, raw FROM accounts ORDER BY plaid_account_id';
  return (db.prepare(sql).all() as { plaid_account_id: string; role: AccountId | null; raw: string }[]).map((row) => ({ plaidAccountId: row.plaid_account_id, role: row.role, raw: JSON.parse(row.raw) as PlaidAccount, rawText: row.raw }));
}

export function saveAccount(db: Db, account: PlaidAccount, rawText: string, sync: number): void {
  db.prepare(
    'INSERT INTO accounts (plaid_account_id, role, raw, updated_by_sync) VALUES (?, NULL, ?, ?) ON CONFLICT (plaid_account_id) DO UPDATE SET raw = excluded.raw, updated_by_sync = excluded.updated_by_sync',
  ).run(account.account_id, rawText, sync);
}

export function setAccountRoles(db: Db, roles: Readonly<Record<string, AccountId | null>>): void {
  // Her steps first, when her second card is picked (her-steps.ts).
  if (Object.values(roles).includes('second-card')) migrateHer(db);
  const her = hasHerSteps(db);
  db.transaction(() => {
    db.prepare('UPDATE accounts SET role = NULL').run();
    if (her) db.prepare('DELETE FROM her_account_roles').run();
    for (const [id, role] of Object.entries(roles)) {
      const second = role === 'second-card';
      const changed = db.prepare('UPDATE accounts SET role = ? WHERE plaid_account_id = ?').run(second ? null : role, id);
      if (changed.changes !== 1) throw new Error(`there is no account ${id}`);
      if (second) db.prepare('INSERT INTO her_account_roles (plaid_account_id, role) VALUES (?, ?)').run(id, role);
    }
  })();
}

// ----- Bank items -----

interface ItemRow {
  transaction_id: string;
  plaid_account_id: string;
  raw: string;
  pending: number;
  amount_cents: number | null;
  removed: number;
  status: ItemStatus;
  kind: string | null;
  book_id: string | null;
  replaced_by: string | null;
  first_sync: number;
  last_sync: number;
}

export function readItems(db: Db): Map<string, StoredItem> {
  const rows = db.prepare('SELECT * FROM bank_items ORDER BY first_sync, rowid').all() as ItemRow[];
  return new Map(
    rows.map((row) => [
      row.transaction_id,
      {
        transactionId: row.transaction_id,
        accountId: row.plaid_account_id,
        raw: JSON.parse(row.raw) as unknown,
        pending: row.pending === 1,
        amountCents: row.amount_cents,
        removed: row.removed === 1,
        status: row.status,
        kind: row.kind,
        bookId: row.book_id,
        replacedBy: row.replaced_by,
        firstSync: row.first_sync,
        lastSync: row.last_sync,
      },
    ]),
  );
}

export function saveItem(db: Db, item: StoredItem): void {
  db.prepare(
    `INSERT INTO bank_items (transaction_id, plaid_account_id, raw, pending, amount_cents, removed, status, kind, book_id, replaced_by, first_sync, last_sync)
     VALUES (@transactionId, @accountId, @raw, @pending, @amountCents, @removed, @status, @kind, @bookId, @replacedBy, @firstSync, @lastSync)
     ON CONFLICT (transaction_id) DO UPDATE SET
       plaid_account_id = excluded.plaid_account_id, raw = excluded.raw, pending = excluded.pending, amount_cents = excluded.amount_cents,
       removed = excluded.removed, status = excluded.status, kind = excluded.kind, book_id = excluded.book_id,
       replaced_by = excluded.replaced_by, last_sync = excluded.last_sync`,
  ).run({
    transactionId: item.transactionId,
    accountId: item.accountId,
    raw: JSON.stringify(item.raw),
    pending: item.pending ? 1 : 0,
    amountCents: item.amountCents,
    removed: item.removed ? 1 : 0,
    status: item.status,
    kind: item.kind,
    bookId: item.bookId,
    replacedBy: item.replacedBy,
    firstSync: item.firstSync,
    lastSync: item.lastSync,
  });
}

// ----- The book -----

// The book, rebuilt from its history, in order: what the bank sent and his
// answers (history/history-db.ts). Null before setup day. The money math has
// no clock and no chance in it, so the same history always gives the same book.
export function loadBook(db: Db): Book | null {
  return replayHistory(readHistory(db), false).book;
}

export function bookEvents(db: Db): { readonly kind: string; readonly payload: unknown }[] {
  return (db.prepare('SELECT kind, payload FROM book_events ORDER BY seq').all() as { kind: string; payload: string }[]).map((row) => ({
    kind: row.kind,
    payload: JSON.parse(row.payload) as unknown,
  }));
}

// ----- Statements, attention, syncs, settings -----

// By Plaid account id.
export function readStatements(db: Db): Map<string, { raw: PlaidCreditCard; rawText: string }> {
  const rows = db.prepare('SELECT plaid_account_id, raw FROM statements').all() as { plaid_account_id: string; raw: string }[];
  return new Map(rows.map((row) => [row.plaid_account_id, { raw: JSON.parse(row.raw) as PlaidCreditCard, rawText: row.raw }]));
}

export function saveStatement(db: Db, plaidAccountId: string, rawText: string, sync: number): void {
  db.prepare(
    'INSERT INTO statements (plaid_account_id, raw, updated_by_sync) VALUES (?, ?, ?) ON CONFLICT (plaid_account_id) DO UPDATE SET raw = excluded.raw, updated_by_sync = excluded.updated_by_sync',
  ).run(plaidAccountId, rawText, sync);
}

export function addAttention(db: Db, sync: number, attention: Attention): void {
  db.prepare('INSERT INTO attention (sync, transaction_id, what) VALUES (?, ?, ?)').run(sync, attention.transactionId, attention.what);
}

export function readAttention(db: Db): { readonly sync: number; readonly transactionId: string | null; readonly what: string }[] {
  return (db.prepare('SELECT sync, transaction_id, what FROM attention ORDER BY id').all() as { sync: number; transaction_id: string | null; what: string }[]).map((row) => ({
    sync: row.sync,
    transactionId: row.transaction_id,
    what: row.what,
  }));
}

export function nextSyncNumber(db: Db): number {
  const row = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM syncs').get() as { next: number };
  return row.next;
}

export function saveSync(
  db: Db,
  sync: { id: number; today: IsoDate; cursorBefore: string | null; cursorAfter: string | null; added: number; modified: number; removed: number; sent: number; held: number },
): void {
  db.prepare(
    'INSERT INTO syncs (id, today, cursor_before, cursor_after, added, modified, removed, sent, held) VALUES (@id, @today, @cursorBefore, @cursorAfter, @added, @modified, @removed, @sent, @held)',
  ).run(sync);
}

const BANK_RULES = 'bank-rules';

export function readBankRules(db: Db): readonly BankRule[] {
  const row = db.prepare('SELECT value FROM settings WHERE name = ?').get(BANK_RULES) as { value: string } | undefined;
  return checkBankRules(row === undefined ? [] : (JSON.parse(row.value) as unknown));
}

// Saves the bank rules as they are, without a log line: for a change that
// logs itself (bank-rules-db.ts).
export function saveBankRules(db: Db, rules: readonly BankRule[]): void {
  db.prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value').run(BANK_RULES, JSON.stringify(checkBankRules(rules)));
}

// Rule 13.5: every change is logged with the date.
export function setBankRules(db: Db, rules: readonly BankRule[], date: IsoDate): void {
  const checked = checkBankRules(rules);
  db.transaction(() => {
    const before = readBankRules(db);
    db.prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value').run(BANK_RULES, JSON.stringify(checked));
    logChange(db, date, 'bank rules changed', { before, after: checked });
  })();
}

export function logChange(db: Db, date: IsoDate, what: string, detail: unknown): void {
  db.prepare('INSERT INTO change_log (date, what, detail) VALUES (?, ?, ?)').run(date, what, JSON.stringify(detail));
}

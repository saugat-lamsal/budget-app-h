import { statement, type Db } from '../db/database.js';
import { hasHerSteps, migrateHer } from '../db/her-steps.js';
import type { PlaidCreditCard } from '../plaid/types.js';

// Her rulebook, 52.5 (PR 7+8): each statement the bank sends is kept, in her
// own table (her step 3), so the statement before is known from the second
// one on. Only in her setup: upstream's database is never written to here.

// What tells one statement from another: its statement date, or its due date
// when the bank sends none (9.8). Null when the bank sent neither.
export function statementKey(card: PlaidCreditCard): string | null {
  if (card.last_statement_issue_date !== null) return card.last_statement_issue_date;
  return card.next_payment_due_date === null ? null : `due ${card.next_payment_due_date}`;
}

export function keepStatement(db: Db, plaidAccountId: string, card: PlaidCreditCard, sync: number): void {
  if (!hasHerSteps(db)) return;
  migrateHer(db);
  const key = statementKey(card);
  if (key === null) return;
  statement(
    db,
    'INSERT INTO her_statements (plaid_account_id, statement_key, raw, first_sync, last_sync) VALUES (?, ?, ?, ?, ?) ON CONFLICT (plaid_account_id, statement_key) DO UPDATE SET raw = excluded.raw, last_sync = excluded.last_sync',
  ).run(plaidAccountId, key, JSON.stringify(card), sync, sync);
}

// Every statement kept for a card account, in the order they first came.
export function keptStatements(db: Db, plaidAccountId: string): PlaidCreditCard[] {
  if (!hasHerSteps(db) || statement(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'her_statements'").get() === undefined) return [];
  const rows = statement(db, 'SELECT raw FROM her_statements WHERE plaid_account_id = ? ORDER BY first_sync, statement_key').all(plaidAccountId) as { raw: string }[];
  return rows.map((row) => JSON.parse(row.raw) as PlaidCreditCard);
}

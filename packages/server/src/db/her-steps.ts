import { statement, type Db } from './database.js';

// Her setup's own database steps (CLAUDE.md, "Database"): run after
// upstream's STEPS, in a list of their own with their own version, kept in
// the table her_schema. Upstream's STEPS are never added to, so its new steps
// merge in as they come; each of hers only adds tables of her own. They run
// only in her setup (when her server starts, and before her own data is first
// written), so upstream's database stays exactly upstream's.
export const HER_STEPS: readonly string[] = [
  `
  -- Her step 1 (her rulebook, 1.2, PR 5): which account is her second card.
  -- Upstream's accounts table allows only its own four roles, so the second
  -- card's pick is kept here: at most one account, and an account picked as
  -- the second card has no role in accounts.
  CREATE TABLE her_account_roles (
    plaid_account_id TEXT PRIMARY KEY REFERENCES accounts (plaid_account_id),
    role TEXT NOT NULL UNIQUE CHECK (role IN ('second-card'))
  );
  `,
  `
  -- Her step 2 (her rulebook, 1.1, PR 6): her second bank connection.
  -- Upstream's connection table holds exactly one row (its first bank), so
  -- the second is kept here, with the same columns.
  CREATE TABLE her_connections (
    bank INTEGER PRIMARY KEY CHECK (bank = 2),
    item_id TEXT NOT NULL,
    institution_id TEXT,
    -- The access token, encrypted. Never stored in the clear.
    sealed_key TEXT NOT NULL,
    cursor TEXT,
    history_complete INTEGER NOT NULL DEFAULT 0 CHECK (history_complete IN (0, 1)),
    needs_login INTEGER NOT NULL DEFAULT 0 CHECK (needs_login IN (0, 1)),
    connected_on TEXT NOT NULL,
    permission_ends TEXT
  );

  -- Each of her banks: its name as Plaid gave it when she connected it (HB8),
  -- the last good read of it (10.7), and since when its syncs fail (12.3,
  -- HB9); null while they work.
  CREATE TABLE her_banks (
    bank INTEGER PRIMARY KEY CHECK (bank IN (1, 2)),
    institution_id TEXT,
    name TEXT,
    last_read TEXT,
    failing_since TEXT
  );
  `,
  `
  -- Her step 3 (her rulebook, 52.5, PR 7+8): each statement the bank sends,
  -- kept, so the statement before is known from the second one on. Upstream's
  -- statements table keeps only the latest for each card. A statement is told
  -- from another by its statement date, or by its due date when the bank sends
  -- no statement date (9.8); a later answer about the same one replaces it.
  CREATE TABLE her_statements (
    plaid_account_id TEXT NOT NULL,
    statement_key TEXT NOT NULL,
    raw TEXT NOT NULL,
    first_sync INTEGER NOT NULL,
    last_sync INTEGER NOT NULL,
    PRIMARY KEY (plaid_account_id, statement_key)
  );

  -- The latest one of each card, already read before this step.
  INSERT INTO her_statements (plaid_account_id, statement_key, raw, first_sync, last_sync)
  SELECT plaid_account_id,
    COALESCE(json_extract(raw, '$.last_statement_issue_date'), 'due ' || json_extract(raw, '$.next_payment_due_date')),
    raw, updated_by_sync, updated_by_sync
  FROM statements
  WHERE COALESCE(json_extract(raw, '$.last_statement_issue_date'), json_extract(raw, '$.next_payment_due_date')) IS NOT NULL;
  `,
];

export const HER_SCHEMA_VERSION = HER_STEPS.length;

// Whether her steps have run in this database.
export function hasHerSteps(db: Db): boolean {
  return statement(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'her_schema'").get() !== undefined;
}

// Runs her steps not run yet, each in its own transaction with its version.
export function migrateHer(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS her_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM her_schema WHERE id = 1').get() as { version: number } | undefined;
  const version = row?.version ?? 0;
  if (version > HER_SCHEMA_VERSION) {
    throw new Error(`the database is from a newer version of her setup (her schema ${version}, this app knows ${HER_SCHEMA_VERSION})`);
  }
  for (let step = version; step < HER_SCHEMA_VERSION; step += 1) {
    db.transaction(() => {
      db.exec(HER_STEPS[step] ?? '');
      db.prepare('INSERT INTO her_schema (id, version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version').run(step + 1);
    })();
  }
}

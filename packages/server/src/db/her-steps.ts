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

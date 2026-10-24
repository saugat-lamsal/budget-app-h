import type { IsoDate } from '@budget-app/money';
import { statement, type Db } from '../db/database.js';
import { hasHerSteps, migrateHer } from '../db/her-steps.js';
import { readConnection, saveConnectionState, saveNewConnection, savePermissionEnds, type Connection } from '../db/store.js';

// Her rulebook, 1.1 (PR 6): her two bank connections, Capital One then
// American Express. Bank 1 is upstream's one connection (its table holds
// exactly one row); her second is in her own table (her step 2), with the
// same columns. Upstream's setup has bank 1 only, and none of her tables.

export type BankNumber = 1 | 2;

export interface BankConnection extends Connection {
  readonly bank: BankNumber;
  // As Plaid gave it when she connected it (HB8); null in upstream's setup.
  readonly name: string | null;
  // 10.7: the last good read of this bank, as an instant; null in upstream's setup (the bank's reads say it).
  readonly lastRead: string | null;
  // 12.3 (HB9): since when this bank's syncs fail; null while they work.
  readonly failingSince: string | null;
}

interface HerBankRow {
  bank: number;
  institution_id: string | null;
  name: string | null;
  last_read: string | null;
  failing_since: string | null;
}

interface ConnectionRow {
  item_id: string;
  institution_id: string | null;
  sealed_key: string;
  cursor: string | null;
  history_complete: number;
  needs_login: number;
  connected_on: string;
  permission_ends: string | null;
}

const fromRow = (row: ConnectionRow): Connection => ({
  itemId: row.item_id,
  institutionId: row.institution_id,
  sealedKey: row.sealed_key,
  cursor: row.cursor,
  historyComplete: row.history_complete === 1,
  needsLogin: row.needs_login === 1,
  connectedOn: row.connected_on,
  permissionEnds: row.permission_ends,
});

function herBank(db: Db, bank: BankNumber): HerBankRow | undefined {
  return statement(db, 'SELECT * FROM her_banks WHERE bank = ?').get(bank) as HerBankRow | undefined;
}

// One bank's connection; null while it is not connected.
export function connectionAt(db: Db, bank: BankNumber): BankConnection | null {
  const her = hasHerSteps(db);
  let connection: Connection | null;
  if (bank === 1) connection = readConnection(db);
  else {
    const row = her ? (statement(db, 'SELECT * FROM her_connections WHERE bank = 2').get() as ConnectionRow | undefined) : undefined;
    connection = row === undefined ? null : fromRow(row);
  }
  if (connection === null) return null;
  const h = her ? herBank(db, bank) : undefined;
  return { ...connection, bank, institutionId: connection.institutionId ?? h?.institution_id ?? null, name: h?.name ?? null, lastRead: h?.last_read ?? null, failingSince: h?.failing_since ?? null };
}

// Every connection, bank 1 first.
export function connectionsOf(db: Db): BankConnection[] {
  return ([1, 2] as const).flatMap((bank) => connectionAt(db, bank) ?? []);
}

// The connection Plaid's item_id is; null when it is neither (section 2, HB11).
export function connectionOfItem(db: Db, itemId: string): BankConnection | null {
  return connectionsOf(db).find((c) => c.itemId === itemId) ?? null;
}

// 1.1: a new connection, kept at once, sealed. Her setup's steps run first,
// and the bank's name is kept with it (HB8); upstream's keeps only its own row.
export function saveNewConnectionAt(db: Db, bank: BankNumber, c: { itemId: string; institutionId: string | null; sealedKey: string; connectedOn: IsoDate; name?: string | null }): void {
  const her = bank === 2 || c.name !== undefined;
  if (her) migrateHer(db);
  if (bank === 1) saveNewConnection(db, c);
  else db.prepare('INSERT INTO her_connections (bank, item_id, institution_id, sealed_key, connected_on) VALUES (2, ?, ?, ?, ?)').run(c.itemId, c.institutionId, c.sealedKey, c.connectedOn);
  if (her) db.prepare('INSERT INTO her_banks (bank, institution_id, name) VALUES (?, ?, ?) ON CONFLICT (bank) DO UPDATE SET institution_id = excluded.institution_id, name = excluded.name').run(bank, c.institutionId, c.name ?? null);
}

export function saveConnectionStateAt(db: Db, bank: BankNumber, state: { cursor: string | null; historyComplete: boolean; needsLogin: boolean }): void {
  if (bank === 1) saveConnectionState(db, state);
  else db.prepare('UPDATE her_connections SET cursor = ?, history_complete = ?, needs_login = ? WHERE bank = 2').run(state.cursor, state.historyComplete ? 1 : 0, state.needsLogin ? 1 : 0);
}

export function savePermissionEndsAt(db: Db, bank: BankNumber, at: string | null): void {
  if (bank === 1) savePermissionEnds(db, at);
  else db.prepare('UPDATE her_connections SET permission_ends = ? WHERE bank = 2').run(at);
}

// 10.7 and 12.3, her setup only: a good read of this bank (it works again),
// or a sync of it that failed (since when, kept from the first that failed).
export function noteBankRead(db: Db, bank: BankNumber, at: string): void {
  if (!hasHerSteps(db)) return;
  db.prepare('INSERT INTO her_banks (bank, last_read) VALUES (?, ?) ON CONFLICT (bank) DO UPDATE SET last_read = excluded.last_read, failing_since = NULL').run(bank, at);
}

export function noteBankFailing(db: Db, bank: BankNumber, at: string): void {
  if (!hasHerSteps(db)) return;
  db.prepare('INSERT INTO her_banks (bank, failing_since) VALUES (?, ?) ON CONFLICT (bank) DO UPDATE SET failing_since = COALESCE(failing_since, excluded.failing_since)').run(bank, at);
}

// Setup day waits until Plaid has sent all of each bank's history (14.1).
export function setupConnectionOf(db: Db): { readonly historyComplete: boolean } | null {
  const connections = connectionsOf(db);
  return connections.length === 0 ? null : { historyComplete: connections.every((c) => c.historyComplete) };
}

// A bank's name on her screens and in her alerts (HB8), "Bank 2" if Plaid gave none.
export function bankNameOf(c: Pick<BankConnection, 'bank' | 'name'>): string {
  return c.name ?? `Bank ${c.bank}`;
}

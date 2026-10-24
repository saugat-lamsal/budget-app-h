import type { IsoDate } from '@budget-app/money';
import type { TokenBox } from './crypto/token-box.js';
import type { Db } from './db/database.js';
import { connectionAt, saveNewConnectionAt } from './bank/connections.js';
import { logChange } from './db/store.js';
import type { Log } from './log.js';
import type { PlaidClient } from './plaid/client.js';

// Connecting to Plaid's test bank, without screens (Phase 3): the test bank
// makes a link key directly, which is swapped for the connection's bank key.
// The bank key is sealed before it is stored, and is never logged. One
// connection only (rulebook section 1).
export interface ConnectInput {
  readonly db: Db;
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  readonly log: Log;
  readonly today: IsoDate;
  readonly institutionId: string;
  // A test user. user_custom takes a description of the accounts as its password.
  readonly username?: string;
  readonly password?: string;
  readonly daysRequested?: number;
  // Her rulebook, 1.1 (PR 6): which of her banks this is (bank 1 when left
  // out), and its name, which only her setup keeps (HB8).
  readonly bank?: 1 | 2;
  readonly name?: string;
}

export async function connectTestBank(input: ConnectInput): Promise<{ readonly itemId: string }> {
  const { db, plaid, box, log } = input;
  const bank = input.bank ?? 1;
  if (connectionAt(db, bank) !== null) throw new Error(bank === 1 ? 'there is already a bank connection, and there is only ever one' : 'her second bank is connected already');
  if (bank === 2 && connectionAt(db, 1) === null) throw new Error('her first bank is connected first');
  const publicToken = await plaid.createSandboxPublicToken({
    institutionId: input.institutionId,
    products: ['transactions', 'liabilities'],
    ...(input.username === undefined ? {} : { username: input.username }),
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.daysRequested === undefined ? {} : { daysRequested: input.daysRequested }),
  });
  const { key, itemId } = await plaid.exchangePublicToken(publicToken);
  db.transaction(() => {
    saveNewConnectionAt(db, bank, { itemId, institutionId: input.institutionId, sealedKey: box.seal(key.reveal(), itemId), connectedOn: input.today, ...(input.name === undefined ? {} : { name: input.name }) });
    logChange(db, input.today, 'connected to the test bank', { itemId, institutionId: input.institutionId });
  })();
  log.info('connected to the test bank', { itemId });
  return { itemId };
}

import { addDays, type AccountId, type IsoDate } from '@budget-app/money';
import { connectTestBank } from '../connect.js';
import type { TokenBox } from '../crypto/token-box.js';
import type { Db } from '../db/database.js';
import { readAccounts, readConnection, setAccountRoles } from '../db/store.js';
import type { Log } from '../log.js';
import type { PlaidClient } from '../plaid/client.js';
import { syncBank } from '../sync/sync.js';

// npm run serve -- --connect: Plaid's test bank, with made-up accounts shaped
// like his (one checking, one savings, two cards), for the real server to
// run on before Phase 7. The live tests use the same accounts.

// His four accounts, by the last four digits the made-up accounts show.
export const TEST_BANK_MASKS: Readonly<Record<string, AccountId>> = { '1111': 'checking', '2222': 'savings', '3333': 'everyday-card', '4444': 'old-card' };

// A custom test user shaped like his accounts. Dates are counted from today;
// a date_posted after today makes a transaction pending.
export function accountsLikeHis(today: IsoDate): string {
  const d = (days: number): IsoDate => addDays(today, days);
  const tx = (on: number, posts: number, amount: number, description: string): Record<string, unknown> => ({
    date_transacted: d(on),
    date_posted: d(posts),
    amount,
    description,
    currency: 'USD',
  });
  return JSON.stringify({
    override_accounts: [
      {
        type: 'depository',
        subtype: 'checking',
        starting_balance: 3000,
        meta: { name: 'Made-up Checking', mask: '1111' },
        transactions: [
          tx(-12, -12, -2500, 'MADEUP CORP PAYROLL'),
          tx(-6, -5, 45.67, 'GROCERY OUTLET 12'),
          tx(-4, -4, 300, 'Zelle payment to MOM MADEUP'),
          tx(-1, 3, 25.5, 'GAS STATION 77'),
        ],
      },
      {
        type: 'depository',
        subtype: 'savings',
        starting_balance: 5000,
        meta: { name: 'Made-up Savings', mask: '2222' },
        transactions: [tx(-10, -10, -1.23, 'INTEREST EARNED')],
      },
      {
        type: 'credit',
        subtype: 'credit card',
        starting_balance: 450,
        meta: { name: 'Made-up Everyday Card', mask: '3333', limit: 5000 },
        transactions: [tx(-8, -7, 12.34, 'COFFEE SHOP 5'), tx(-1, 2, 60, 'GROCERY OUTLET 12')],
        liability: { type: 'credit', purchase_apr: 22.99, minimum_payment_amount: 35, last_payment_amount: 100, is_overdue: false },
      },
      {
        type: 'credit',
        subtype: 'credit card',
        starting_balance: 3000,
        meta: { name: 'Made-up Old Card', mask: '4444', limit: 4000 },
        transactions: [],
        liability: { type: 'credit', purchase_apr: 0, minimum_payment_amount: 60, last_payment_amount: 150, is_overdue: false },
      },
    ],
  });
}

export interface ConnectLikeHisInput {
  readonly db: Db;
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  readonly log: Log;
  readonly today: IsoDate;
  // Between syncs while the test bank is still sending the history.
  readonly wait?: (ms: number) => Promise<void>;
  // The accounts to pick (rolesFor); his four when not given. Her setup's
  // three leave the old card's account unpicked, so it is never read ("Off in
  // this setup").
  readonly roles?: readonly AccountId[];
}

// Connects the test bank with the made-up accounts, syncs until it has sent
// all of the history, and sets his four accounts by their last four digits.
// Refused when there is a connection already: there is only ever one.
export async function connectLikeHis(input: ConnectLikeHisInput): Promise<void> {
  const { db, plaid, box, log, today } = input;
  if (readConnection(db) !== null) throw new Error('there is already a bank connection, and there is only ever one');
  // First Platypus Bank: the test bank Plaid suggests for this.
  await connectTestBank({ db, plaid, box, log, today, institutionId: 'ins_109508', username: 'user_custom', password: accountsLikeHis(today) });
  const wait = input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let tries = 0; ; tries += 1) {
    await syncBank({ db, plaid, box, log, today });
    if (readConnection(db)?.historyComplete === true) break;
    if (tries >= 40) throw new Error('the test bank did not finish sending the history in time; run with --sync later');
    await wait(3_000);
  }
  const asked = input.roles;
  // Her setup (her rulebook, 1.2) has no old card and a second card: on this one
  // connection, the card at 4444 is her second card. (PR 6 brings her second bank.)
  const secondCard = asked !== undefined && asked.includes('second-card') && !asked.includes('old-card');
  const roleOf = (mask: string): AccountId | undefined => (secondCard && TEST_BANK_MASKS[mask] === 'old-card' ? 'second-card' : TEST_BANK_MASKS[mask]);
  const roles = Object.fromEntries(readAccounts(db).flatMap((a) => (a.raw.mask !== null && a.raw.mask !== undefined && roleOf(a.raw.mask) !== undefined ? [[a.plaidAccountId, roleOf(a.raw.mask) ?? null]] : [])));
  setAccountRoles(db, asked === undefined ? roles : Object.fromEntries(Object.entries(roles).filter(([, role]) => role !== null && asked.includes(role))));
}

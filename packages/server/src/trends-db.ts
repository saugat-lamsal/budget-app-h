import { addDays, daysBetween, type IsoDate } from '@budget-app/money';
import { readPlaidItem } from './bank/plaid-item.js';
import { readBankItem } from './bank/reading.js';
import { rolesOf } from './bank/stored-account.js';
import type { Db } from './db/database.js';
import { readAccounts, readBankRules, readConnection, readItems } from './db/store.js';
import { readSetupInput } from './history/history-db.js';
import { HISTORY_DAYS } from './plaid/client.js';
import type { BeforeSetup, HistoryLine } from './trends.js';

// The Trends tab's bank history from before setup day (40.1, 40.3), read from
// the database for trends.ts, which reads none itself. Everything that is in
// the starting money (14.2): what the bank sent before setup day, posted and
// kept (status history), and the charges setup day counted while still
// pending, at the amount it counted. A charge pending on setup day that posted
// later is in the books only as the difference (A10); one pending that day
// that was not a purchase went to the books once it posted (status waiting,
// then sent), so it is not here. It only reads.
// Her rulebook, 40.1: historyDays is how many days the bank was asked for.
// Asked for more than 90 (her setup's 730), Trends still reads only the 90
// days before the bank was connected; the older history is the rule finder's.
export function beforeSetupOf(db: Db, options: { readonly historyDays?: number } = {}): BeforeSetup | null {
  const connection = readConnection(db);
  const setup = readSetupInput(db);
  if (connection === null || setup === null) return null;
  const roles = rolesOf(readAccounts(db));
  const bankRules = readBankRules(db);
  const lines: HistoryLine[] = [];
  for (const item of readItems(db).values()) {
    if (item.status !== 'history' || item.removed || item.pending) continue;
    const account = roles.get(item.accountId);
    const read = readPlaidItem(item.raw);
    if (account === undefined || !read.ok || read.item.amount === 0) continue;
    // 4.1: a purchase, and a payment to a person, on the day it happened, as the books date them.
    const reading = readBankItem(account, read.item.amount, read.item.description, bankRules);
    const date = reading.kind === 'purchase' || reading.kind === 'payment-to-person' ? read.item.day : read.item.date;
    lines.push({ id: item.transactionId, account, amount: read.item.amount, date, description: read.item.description });
  }
  for (const charge of setup.pendingCharges) lines.push({ id: charge.id, account: charge.account, amount: charge.amount, date: charge.date, description: charge.description });
  // Section 2: the 90 days asked for at connection; an item older than that (a bank's own lag) moves it back.
  let historyFrom: IsoDate = addDays(connection.connectedOn.slice(0, 10), -HISTORY_DAYS);
  const read = (options.historyDays ?? HISTORY_DAYS) > HISTORY_DAYS ? lines.filter((line) => daysBetween(historyFrom, line.date) >= 0) : lines;
  for (const line of read) if (daysBetween(line.date, historyFrom) > 0) historyFrom = line.date;
  return { setupDay: setup.date, lastPaycheckDate: setup.lastPaycheckDate, historyFrom, lines: read, bankRules };
}

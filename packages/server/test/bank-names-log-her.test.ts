// Her rulebook, 1.1, 13.5 and HB8: on her screens each bank is named as
// Plaid named it when she connected it. Settings' change log said "Bank
// connected · Bank of America, through Plaid" for every real connection,
// upstream's words, so on her real books both of hers would have said Bank
// of America (found while writing her connection-day sheet, Oct 27, 2026;
// the rehearsal on the test bank showed "Plaid's test bank"). The line keeps
// no bank number, but her banks are connected one at a time on the Bank
// page, bank 1 then bank 2, each with its line in the same step
// (bank-desk.ts), so the nth real line is bank n. Every name is made up.
import type { IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { withBankNames } from '../src/bank-names-log.js';
import type { BankNumber } from '../src/bank/connections.js';
import type { ServerLogLine } from '../src/views/server-log.js';

const at = (date: IsoDate) => ({ date, afterBookLines: 0, afterBankLines: 0 });
const connected = (bank: 'test' | 'real', date: IsoDate = '2026-10-27'): ServerLogLine => ({ ...at(date), action: 'bank-connected', bank });
const bank = (n: BankNumber, name: string | null) => ({ bank: n, name });

const FIRST = 'Made-up First Bank';
const SECOND = 'Made-up Second Bank';

describe('HB8 13.5 her change log names each bank it connected', () => {
  it('HB8 13.5 the first real "Bank connected" line is bank 1, the second bank 2, each as Plaid named it; the lines between are left as they are', () => {
    const picked: ServerLogLine = { ...at('2026-10-27'), action: 'bank-accounts', accounts: { checking: 'Made-up Checking ••1111', savings: 'Made-up Savings ••2222', 'everyday-card': 'Made-up Card ••3333', 'old-card': '', 'second-card': 'Made-up Card ••5555' } };
    const login: ServerLogLine = { ...at('2026-10-27'), action: 'logged-in', device: 'Made-up Phone' };
    const lines = [login, connected('real'), picked, connected('real', '2026-10-28')];
    expect(withBankNames(lines, [bank(1, FIRST), bank(2, SECOND)])).toEqual([login, { ...connected('real'), name: FIRST }, picked, { ...connected('real', '2026-10-28'), name: SECOND }]);
  });

  it('HB8 by the bank\'s number, not the order the banks are listed in', () => {
    expect(withBankNames([connected('real'), connected('real')], [bank(2, SECOND), bank(1, FIRST)]).map((l) => (l.action === 'bank-connected' ? l.name : null))).toEqual([FIRST, SECOND]);
  });

  it('HB8 a bank Plaid gave no name is "Bank 1" or "Bank 2", as on her other screens', () => {
    expect(withBankNames([connected('real'), connected('real')], [bank(1, null), bank(2, null)])).toMatchObject([{ name: 'Bank 1' }, { name: 'Bank 2' }]);
  });

  it('HB8 the test bank\'s lines keep their words ("Plaid\'s test bank"): its first bank connects by itself, with no line, so the order says nothing', () => {
    const lines = [connected('test')];
    expect(withBankNames(lines, [bank(1, FIRST), bank(2, SECOND)])).toEqual(lines);
  });

  it('HB8 a real line with no bank for it is never given another bank\'s name', () => {
    expect(withBankNames([connected('real'), connected('real')], [bank(1, FIRST)])).toEqual([{ ...connected('real'), name: FIRST }, connected('real')]);
    expect(withBankNames([connected('real')], [])).toEqual([connected('real')]);
    expect(withBankNames([], [bank(1, FIRST), bank(2, SECOND)])).toEqual([]);
  });

  it('HB8 a test bank line before the real ones does not shift them', () => {
    expect(withBankNames([connected('test'), connected('real'), connected('real')], [bank(1, FIRST), bank(2, SECOND)])).toEqual([connected('test'), { ...connected('real'), name: FIRST }, { ...connected('real'), name: SECOND }]);
  });
});

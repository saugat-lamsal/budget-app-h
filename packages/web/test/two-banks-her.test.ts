import type { StatusView } from '@budget-app/server/views';
import { describe, expect, it } from 'vitest';
import { BANK_WORDS, HER_BANK_WORDS } from '../src/screens/bank-text.js';
import { statusLines } from '../src/screens/status-text.js';

// Her rulebook, PR 6: her two banks in the screens' words (0.7, 1.1, 1.3),
// each named as Plaid named it when she connected it (HB8). Upstream's
// setup keeps its own words. Every name and time is made up.

const view = (extra: Partial<StatusView> = {}): StatusView => ({
  state: 'tracking',
  today: '2026-10-16',
  timeZone: 'America/New_York',
  lastRead: '2026-10-16T15:05:00-04:00',
  lastSync: { at: '2026-10-16T15:05:00-04:00', result: 'failed' },
  backups: null,
  started: '2026-10-16T06:00:00-04:00',
  history: { whenOpened: 0, now: 0 },
  mismatchSince: null,
  alertsWaiting: 0,
  ...extra,
});

describe('0.7 the status page: each of her banks', () => {
  it("0.7 each bank's last read and last sync, by name, in place of the one bank's; a failing one needs a look", () => {
    const lines = statusLines(
      view({
        banks: [
          { bank: 1, name: 'Made-up First Bank', lastRead: '2026-10-16T15:05:00-04:00', lastSync: { at: '2026-10-16T15:05:00-04:00', result: 'nothing-new' } },
          { bank: 2, name: 'Made-up Second Bank', lastRead: '2026-10-15T09:00:00-04:00', lastSync: { at: '2026-10-16T15:05:00-04:00', result: 'failed' } },
        ],
      }),
    );
    expect(lines.slice(0, 4)).toEqual([
      { id: 'last-read-1', title: 'Made-up First Bank last read', detail: '3:05 PM', look: false },
      { id: 'last-sync-1', title: 'Made-up First Bank: last sync', detail: '3:05 PM: nothing new', look: false },
      { id: 'last-read-2', title: 'Made-up Second Bank last read', detail: 'Thu, Oct 15, 9:00 AM', look: false },
      { id: 'last-sync-2', title: 'Made-up Second Bank: last sync', detail: '3:05 PM: it failed, so nothing changed. It is tried again at the next time.', look: true },
    ]);
    expect(lines.map((l) => l.id)).not.toContain('last-read');
  });

  it('0.7 a bank not read yet, and one with no sync since the server started', () => {
    const lines = statusLines(view({ banks: [{ bank: 1, name: 'Made-up First Bank', lastRead: null, lastSync: null }] }));
    expect(lines.slice(0, 2)).toEqual([
      { id: 'last-read-1', title: 'Made-up First Bank last read', detail: 'Not read yet.', look: false },
      { id: 'last-sync-1', title: 'Made-up First Bank: last sync', detail: 'None since the server started.', look: false },
    ]);
  });

  // PR 12, found by the agent on her screens (HB32): it said the totals match
  // while one bank could not be read and the check waited.
  it('0.7 12.3 while a bank cannot be read, the daily check says it waits for that bank, not that the totals match (HB32)', () => {
    const banks = (second: 'failed' | 'needs-login' | 'new'): NonNullable<StatusView['banks']> => [
      { bank: 1, name: 'Made-up First Bank', lastRead: '2026-10-16T15:05:00-04:00', lastSync: { at: '2026-10-16T15:05:00-04:00', result: 'new' } },
      { bank: 2, name: 'Made-up Second Bank', lastRead: '2026-10-15T09:00:00-04:00', lastSync: { at: '2026-10-16T15:05:00-04:00', result: second } },
    ];
    const check = (b: NonNullable<StatusView['banks']>): unknown => statusLines(view({ banks: b })).find((l) => l.id === 'difference');
    expect(check(banks('failed'))).toEqual({ id: 'difference', title: 'Daily check', detail: 'Waiting until Made-up Second Bank can be read.', look: false });
    expect(check(banks('needs-login'))).toEqual({ id: 'difference', title: 'Daily check', detail: 'Waiting until Made-up Second Bank can be read.', look: false });
    expect(check(banks('new'))).toEqual({ id: 'difference', title: 'Daily check', detail: 'The totals match the bank.', look: false });
    // A difference that began before still says since when (10.4).
    expect(statusLines(view({ banks: banks('failed'), mismatchSince: '2026-10-16T11:00:00-04:00' })).find((l) => l.id === 'difference')).toMatchObject({ detail: 'The totals have not matched the bank since 11:00 AM.', look: true });
  });

  it("0.7 upstream's setup, with no banks: the one bank's lines, as they were", () => {
    expect(statusLines(view()).slice(0, 2).map((l) => l.id)).toEqual(['last-read', 'last-sync']);
  });
});

describe('1.1 and 1.3 the Bank page: her words', () => {
  it('1.1 1.3 her two banks, Capital One then American Express, each logged in to again by name', () => {
    expect(HER_BANK_WORDS.noneTitle).toBe('Connect a bank');
    expect(HER_BANK_WORDS.noneReal).toContain('first Capital One, then American Express');
    expect(HER_BANK_WORDS.loginAgain('Made-up Second Bank')).toBe('Log in to Made-up Second Bank again');
    expect(HER_BANK_WORDS.needsLogin('Made-up Second Bank')).toBe('Made-up Second Bank wants you to log in again. Until you do, nothing new is read from it.');
    expect(HER_BANK_WORDS.permission('Made-up Second Bank')).toBe("Made-up Second Bank's permission runs out");
    expect(HER_BANK_WORDS.unnamed(2)).toBe('Bank 2');
    // Upstream's words are as they were.
    expect(BANK_WORDS.noneTitle).toBe('Connect the bank');
    expect(BANK_WORDS.loginAgain).toBe('Log in to the bank again');
  });
});

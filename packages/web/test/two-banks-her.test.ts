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

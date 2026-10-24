import type { IsoDate } from '@budget-app/money';

// Rule 0.7 (QUESTIONS.md A57): the status page, on the real server only. It
// only reads, and has no amounts: how the bank, the backups, the server and
// its history are doing. The times are his home time zone's, with their
// offset ("2026-10-16T06:12:00-04:00").

export interface StatusView {
  // Whether setup day is done (section 14); the page is the same either way.
  readonly state: 'tracking' | 'not-set-up';
  readonly today: IsoDate;
  readonly timeZone: string;
  // The last good read of the bank; null before the first.
  readonly lastRead: string | null;
  // The last sync this server tried since it started, when it ended, and how
  // it went: new activity, nothing new, the bank wants a new login (10.5), or
  // it failed (nothing changed, 0.4). Null before its first.
  readonly lastSync: { readonly at: string; readonly result: 'new' | 'nothing-new' | 'needs-login' | 'failed' } | null;
  // A43, hosted only: the backups are copying while Litestream's heartbeat
  // comes (what /health/backups watches); the last heartbeat, null before the
  // first. Null on this computer, where there are no backups.
  readonly backups: { readonly copying: boolean; readonly lastBeat: string | null } | null;
  // When the server last started (its books opened).
  readonly started: string;
  // 0.6: the books open only when every event replays to its totals: how many
  // there were then, and how many there are now.
  readonly history: { readonly whenOpened: number; readonly now: number };
  // 10.4: since when the totals have not matched the bank; null while they match.
  readonly mismatchSince: string | null;
  // Alerts worked out and not sent yet (quiet hours, or the phone not reached).
  readonly alertsWaiting: number;
  // Her rulebook, 0.7 (PR 6): each of her banks, by name, with its own last
  // good read and how its last sync went. Left out in upstream's setup.
  readonly banks?: readonly StatusBank[];
}

export interface StatusBank {
  readonly bank: 1 | 2;
  readonly name: string;
  readonly lastRead: string | null;
  readonly lastSync: { readonly at: string; readonly result: 'new' | 'nothing-new' | 'needs-login' | 'failed' } | null;
}

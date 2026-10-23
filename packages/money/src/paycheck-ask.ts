import type { Cents } from './cents.js';
import { daysBetween, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import type { PaycheckSplit } from './payday.js';

// Her rulebook, PR 4: "Ask before splitting a paycheck" (section 2, 3.1,
// 51.1 to 51.3). While it is on, a deposit the paycheck rule matches waits in
// review for a yes, which is "This is my paycheck" (6.1): it splits it and
// starts the pay period on the day it arrived (B53). The book holds the
// waiting paychecks; this file says which one holds a yes up (51.2).

// 51.1: a paycheck waiting for your yes, as Home and the alert (10.15) show
// it. early: less than 10 days after the last paycheck (3.7, 51.3). wouldGet:
// what each bucket would get with the split the next paycheck uses (3.3,
// 13.1); null when it can no longer be your paycheck (older than the last
// one, B54) or the parts are too large to stay exact (0.1).
export interface WaitingPaycheck {
  readonly id: string;
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly early: boolean;
  readonly wouldGet: PaycheckSplit | null;
}

// 51.2, Review's words for a newer paycheck while an older one waits.
export const OLDER_PAYCHECK_FIRST = 'An older paycheck is still waiting. Answer it first.';

// 51.2: the waiting paycheck that a yes on a deposit of this day must wait
// for: one from an earlier day that can still be your paycheck (not older
// than the last paycheck, B54). The same day is not older: either order
// keeps the pay periods in order. Null when there is none.
export function olderPaycheckWaiting(waiting: readonly WaitingPaycheck[], lastPaycheckDate: IsoDate, date: IsoDate): WaitingPaycheck | null {
  return waiting.find((w) => daysBetween(lastPaycheckDate, w.date) >= 0 && daysBetween(w.date, date) > 0) ?? null;
}

export function refuseYesWhileOlderWaits(older: WaitingPaycheck): never {
  throw new MoneyError('older-paycheck-waiting', `an older paycheck from ${older.date} is still waiting: answer it first (51.2)`);
}

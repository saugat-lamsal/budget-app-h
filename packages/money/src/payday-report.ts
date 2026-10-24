import type { SplitBucket } from './buckets.js';
import type { Cents } from './cents.js';
import type { IsoDate } from './dates.js';
import type { PeriodSummary } from './activity.js';
import type { PaycheckSplit } from './payday.js';
import type { LeftoverChoice } from './settings.js';

// What the Payday screen shows (QUESTIONS.md B104 to B106). Everything is
// worked out here, by the money math; the screen only shows it.

// The last paycheck and what it did (3.2, 3.3).
export interface PaycheckReport {
  readonly id: string;
  readonly date: IsoDate;
  readonly amount: Cents;
  // As the bank describes it.
  readonly description: string;
  // The mom reserve first, then the split; detail has the steps.
  readonly split: PaycheckSplit;
  // What it was worked out with, which is not always what the settings say
  // now: a change to the split applies from the next paycheck (13.1).
  readonly percent: { readonly savings: number; readonly needs: number; readonly wants: number; readonly wishlist?: number };
  readonly reservePerPaycheck: Cents;
  readonly reserveCap: Cents;
  // What the mom reserve held before the paycheck.
  readonly reserveBefore: Cents;
  // The bank took it back (4.10): the pay period stays, its money does not.
  readonly takenBack: boolean;
}

// What became of a bucket's leftover at the last payday (3.4, 3.5).
export interface LeftoverReport {
  readonly bucket: SplitBucket;
  // What the bucket held when the paycheck was counted.
  readonly leftAtPayday: Cents;
  // What the setting said then.
  readonly setting: LeftoverChoice;
  // nothing-to-ask: nothing left, or overspent, which carries over (3.5).
  // kept: rolled over, by the setting or your answer.
  // moved-to-savings: by the setting or your answer.
  // waiting: the question is open.
  readonly outcome: 'nothing-to-ask' | 'kept' | 'moved-to-savings' | 'waiting';
  // What was kept, moved, or asked about now (which spending from before
  // payday that showed up later can lower, B4); 0 when there was nothing to ask.
  readonly amount: Cents;
  // How much spending made before payday that showed up or changed since
  // took off what the bucket held at payday (B4, B109): leftAtPayday = amount
  // + lessSincePayday whenever there was something to ask; 0 when nothing
  // was taken off, or there was nothing to ask.
  readonly lessSincePayday: Cents;
  // The question in review while it is open.
  readonly question: string | null;
}

export interface PaydayReport {
  readonly period: { readonly number: number; readonly startDate: IsoDate };
  // Null before the first paycheck.
  readonly paycheck: PaycheckReport | null;
  // Needs, then wants; empty before the first paycheck.
  readonly leftovers: readonly LeftoverReport[];
  // The pay period before this one, added up; null before the first paycheck.
  readonly ended: PeriodSummary | null;
}

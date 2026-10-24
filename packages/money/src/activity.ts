import type { AccountId } from './accounts.js';
import type { AnyPot, Pot, PotAmounts, SpendingKind } from './book.js';
import { addCents, type Cents } from './cents.js';
import type { IsoDate } from './dates.js';
import type { ResortDetail } from './resort.js';

// What went in and out of a bucket (QUESTIONS.md B97 to B99), for the
// Buckets screen. The book writes one line to its ledger every time an entry
// changes what a bucket holds; everything here is read back from those lines,
// so the list can never say something the bucket does not.

// What kind of entry made the change, for adding a pay period up by kind.
export type ActivityKind = 'paycheck' | 'money-in' | 'spending' | 'mom' | 'move' | 'leftover';

export const ACTIVITY_KINDS: readonly ActivityKind[] = Object.freeze(['paycheck', 'money-in', 'spending', 'mom', 'move', 'leftover']);

// What a row is, in a word the screen puts a name to.
export type ActivityWhat =
  // The bucket's share of a paycheck (3.3).
  | 'paycheck'
  // Money in sorted: split as other income, paid back into a bucket, or held for others (6.1).
  | 'other-income'
  | 'payback'
  | 'not-mine'
  // Spending of each kind (4.1, 4.8, 5.2, 7.2, 8.3).
  | SpendingKind
  // A payment to mom out of the reserve (8.1).
  | 'mom'
  // A hand move (13.3), and a leftover moved to savings at payday (3.4).
  | 'move'
  | 'leftover'
  // Something the book no longer has an entry for.
  | 'removed';

export interface ActivityRow {
  // The item's id: what to re-sort, and what the bank calls it.
  readonly id: string;
  readonly what: ActivityWhat;
  // As the bank describes it; empty for a hand move and a leftover.
  readonly description: string;
  // The day it happened (4.1), the payday for a leftover.
  readonly date: IsoDate;
  readonly account: AccountId | null;
  // What it did to this bucket in this pay period, added up: money in is
  // positive, money out negative.
  readonly amount: Cents;
  // The other bucket, for a hand move or a leftover.
  readonly other: AnyPot | null;
  readonly pending: boolean;
  // For spending, how much of it was refunded (4.5).
  readonly refunded: Cents;
  // Spending split across buckets: this row is only the part in this bucket (4.4).
  readonly partOfSplit: boolean;
  // Whether it can be sorted again from here, and how (4.7).
  readonly resort: ResortDetail;
}

export interface BucketActivity {
  readonly pot: AnyPot;
  readonly period: { readonly number: number; readonly startDate: IsoDate; readonly endDate: IsoDate | null };
  // What the bucket held when the pay period began.
  readonly opening: Cents;
  // The rows that are money in, added up (positive), and money out (negative).
  readonly in: Cents;
  readonly out: Cents;
  // What it held at the end; for the current pay period, what it holds now.
  readonly closing: Cents;
  // Newest first.
  readonly rows: readonly ActivityRow[];
}

// A pay period added up by kind of entry: opening + everything in byKind
// = closing, for every bucket. endDate is null for the current pay period.
// Wishlist is there only in a setup that has it (her rulebook, section 2).
export interface PeriodSummary {
  readonly number: number;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate | null;
  readonly opening: PotAmounts;
  readonly closing: PotAmounts;
  readonly byKind: Readonly<Record<Pot, Readonly<Record<ActivityKind, Cents>>>> & { readonly wishlist?: Readonly<Record<ActivityKind, Cents>> };
}

// One line of the ledger: an entry changed what a bucket holds by delta.
export interface LedgerLine {
  readonly entry: string;
  readonly pot: AnyPot;
  readonly delta: Cents;
  readonly kind: ActivityKind;
}

// A bucket's lines in one pay period, one item at a time: everything an item
// did to the bucket, added up, in the order the items first appeared. last is
// the position of the item's latest line, so the item counted last can be
// told from one counted earlier.
export interface Folded {
  readonly entry: string;
  readonly net: Cents;
  readonly last: number;
}

export function foldLines(lines: readonly LedgerLine[], pot: AnyPot): Folded[] {
  const folded = new Map<string, { entry: string; net: Cents; last: number }>();
  lines.forEach((line, position) => {
    if (line.pot !== pot) return;
    const seen = folded.get(line.entry);
    if (seen === undefined) folded.set(line.entry, { entry: line.entry, net: line.delta, last: position });
    else {
      seen.net = addCents(seen.net, line.delta);
      seen.last = position;
    }
  });
  return [...folded.values()];
}

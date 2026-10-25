import type { AccountId, Cents, IsoDate } from '@budget-app/money';
import type { BankCheck } from './buckets.js';

// What the Trends tab shows (rulebook section 40, QUESTIONS.md A58), worked
// out on the server (src/trends.ts) from the books and the bank history the
// app keeps. The screen only formats it. Trends only reads: nothing here
// changes the books.

// 40.2: the parts of what was spent. A payment to the old card is its own
// part of needs; "unsorted" is spending still waiting in review (or, before
// setup day, what no rule sorts).
// Her rulebook, 40.2 and 40.4 (PR 10+11): Wishlist is its own part where the setup has it.
export type TrendsPart = 'needs' | 'wants' | 'old-card' | 'unsorted' | 'wishlist';
export const TRENDS_PARTS: readonly TrendsPart[] = Object.freeze(['needs', 'wants', 'old-card', 'unsorted'] as const);

export interface TrendsItem {
  // The book's id for it, or the bank's before setup day.
  readonly id: string;
  // The day it happened (4.1).
  readonly date: IsoDate;
  readonly description: string;
  readonly account: AccountId | null;
  readonly part: TrendsPart;
  // Spent: positive. Less what was refunded, so a refund can make it negative.
  readonly amount: Cents;
  // 40.1: read from the bank history by today's rules, not from the books.
  readonly beforeSetup: boolean;
}

export interface TrendsPeriod {
  readonly startDate: IsoDate;
  // Its last day: the day before the next one began. For the current pay
  // period, the day before the next payday (11.2), or today once that has passed.
  readonly lastDay: IsoDate;
  readonly current: boolean;
  // 40.3: the oldest, cut off by the start of the bank history ("Part of a pay period").
  readonly cutOff: boolean;
  // 40.3: ended and not cut off.
  readonly full: boolean;
  // 40.1: all of it from the bank history, part of it (the pay period setup
  // day fell in), or none of it.
  readonly beforeSetup: 'all' | 'part' | 'none';
  readonly spent: Readonly<Record<Exclude<TrendsPart, 'wishlist'>, Cents>> & { readonly wishlist?: Cents };
  readonly total: Cents;
  // Newest first. They add up to spent, part by part.
  readonly items: readonly TrendsItem[];
}

// 40.5: what the savings bucket and the mom reserve held, each its own amount.
export interface SavingsPoint {
  readonly date: IsoDate;
  // When tracking started, at the end of a pay period, or now.
  readonly at: 'start' | 'end' | 'now';
  readonly savings: Cents;
  readonly momReserve: Cents;
  // Her rulebook, 40.5: Wishlist beside savings, its own amount, where the setup has it.
  readonly wishlist?: Cents;
}

// 40.6: one place, the old card payments, or everything else.
export interface PlaceGroup {
  readonly kind: 'place' | 'old-card' | 'everything-else';
  // The place's name; empty for the other two.
  readonly name: string;
  readonly amount: Cents;
  // Newest first.
  readonly items: readonly TrendsItem[];
}

// 40.7: your usual by the same day of a pay period.
export type Usual =
  | { readonly state: 'known'; readonly periods: number; readonly byToday: Cents; readonly whole: Cents }
  | { readonly state: 'not-enough'; readonly fullPeriods: number };

// 40.8: what Wants held at the end of a day, or what an even pace leaves.
export interface DayPoint {
  readonly date: IsoDate;
  // Day 1 is the pay period's first day.
  readonly day: number;
  readonly left: Cents;
}

export type EvenPace =
  | {
      readonly state: 'pace';
      // Days 1 to D (and on to today, once the next payday has passed).
      readonly points: readonly DayPoint[];
      // What an even pace leaves at the end of today, and Wants against it: what
      // Wants holds now less that (negative: less left than an even pace).
      readonly today: Cents;
      readonly difference: Cents;
    }
  | { readonly state: 'none'; readonly why: 'started-at-or-below-zero' };

export interface WantsPace {
  // The books' pay period: day 1 is the day it began.
  readonly startDate: IsoDate;
  readonly nextPayday: IsoDate;
  // Today's day number, and D: the days from the first day to the day before the next payday.
  readonly day: number;
  readonly days: number;
  // 10.1: what Wants started the pay period with.
  readonly startedWith: Cents;
  // What Wants holds now: the line's last point.
  readonly left: Cents;
  // Days 1 to today.
  readonly line: readonly DayPoint[];
  readonly pace: EvenPace;
}

export interface TrendsNow {
  // 40.7: this pay period (40.3), and today's day number in it (payday is day 1).
  readonly startDate: IsoDate;
  readonly day: number;
  // So far this pay period, without old card payments.
  readonly spentSoFar: Cents;
  readonly usual: Usual;
  readonly wants: WantsPace;
}

// ----- Future (40.11 to 40.13): every amount here is an estimate (40.10) -----

// 40.11: where a bucket lands by payday at this pay period's pace.
export type Landing =
  | {
      readonly state: 'estimate';
      // What it holds now.
      readonly holds: Cents;
      // Spent from it so far this pay period, old card payments left out.
      readonly spentSoFar: Cents;
      // Payday is day 1, today counted (from setup day in the books' first pay period).
      readonly daysSoFar: number;
      // After today, up to the day before the next payday.
      readonly daysLeft: number;
      // What it would spend in the days left at this pace, rounded up to the cent.
      readonly pace: Cents;
      readonly lands: Cents;
    }
  | { readonly state: 'too-early'; readonly holds: Cents; readonly daysSoFar: number }
  | { readonly state: 'payday-passed'; readonly holds: Cents };

export interface LandingByPayday {
  readonly nextPayday: IsoDate;
  readonly needs: Landing;
  readonly wants: Landing;
  // Spending waiting in review: in neither until it is sorted.
  readonly waitingInReview: Cents;
}

// 40.12: after each payday, the low and the high end.
export interface SavingsRangePoint {
  readonly date: IsoDate;
  readonly low: Cents;
  readonly high: Cents;
}

export type SavingsYearOut =
  | {
      readonly state: 'estimate';
      readonly now: Cents;
      // A year from today.
      readonly to: IsoDate;
      // The paydays after today up to then.
      readonly paydays: number;
      // How many pay periods the least and the most come from (3 to 5).
      readonly periods: number;
      readonly least: Cents;
      readonly most: Cents;
      readonly low: Cents;
      readonly high: Cents;
      readonly points: readonly SavingsRangePoint[];
    }
  | { readonly state: 'not-enough'; readonly now: Cents; readonly periods: number };

// 40.13: what the old card owed, as the books hold it.
export interface DebtPoint {
  readonly date: IsoDate;
  readonly at: 'start' | 'end' | 'now';
  readonly owed: Cents;
}

export type OldCardPlan =
  | {
      readonly state: 'plan';
      readonly promoEndDate: IsoDate;
      // 9.5.
      readonly perPayday: Cents;
      readonly paydaysLeft: number;
      // The payday it reaches $0.00.
      readonly paidOffBy: IsoDate;
      // Today, then each payday until it reaches $0.00: what it owes once that payday's share is paid.
      readonly points: readonly { readonly date: IsoDate; readonly owed: Cents }[];
    }
  | { readonly state: 'due-now'; readonly promoEndDate: IsoDate; readonly owed: Cents }
  | { readonly state: 'no-promo-end-date' }
  | { readonly state: 'paid-off' };

export interface TrendsFuture {
  readonly landing: LandingByPayday;
  readonly savings: SavingsYearOut;
  readonly oldCard: { readonly owed: readonly DebtPoint[]; readonly plan: OldCardPlan };
}

// ----- Habits (40.14 to 40.17): old card payments left out (40.10) -----

export interface SpendDays {
  // How many days, the total spent on them, and per day, rounded down to the cent.
  readonly days: number;
  readonly total: Cents;
  readonly perDay: Cents;
  // Newest first.
  readonly items: readonly TrendsItem[];
}

// 40.14: payday and the 2 days after, against the rest.
export type PaydayEffect =
  | { readonly state: 'known'; readonly periods: number; readonly first: SpendDays; readonly rest: SpendDays }
  | { readonly state: 'not-enough'; readonly fullPeriods: number };

// 40.15: one day of the week. weekday: 0 Sunday to 6 Saturday.
export interface WeekdaySpend {
  readonly weekday: number;
  // How many of it the 90 days hold.
  readonly days: number;
  readonly total: Cents;
  // An average one, rounded down to the cent.
  readonly average: Cents;
  readonly items: readonly TrendsItem[];
}

export interface Weekdays {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly total: Cents;
  // Monday to Sunday.
  readonly days: readonly WeekdaySpend[];
  // The weekday with the most on average; null when none spent more than $0.00.
  readonly most: number | null;
}

// 40.16: a charge that comes again and again.
export interface RepeatCharge {
  readonly name: string;
  readonly every: 'week' | 'two-weeks' | 'month';
  readonly newestDate: IsoDate;
  readonly newestAmount: Cents;
  // Estimates: the newest day plus the gap before it, and the newest amount times 52, 26 or 12.
  readonly next: IsoDate;
  readonly perYear: Cents;
  // Its charges, newest first.
  readonly items: readonly TrendsItem[];
}

// 40.17: pay periods the books ended with Wants at $0.00 or more.
export interface WantsStreak {
  readonly ended: number;
  readonly current: number;
  readonly best: number;
  // The newest that ended went below zero.
  readonly lastOver: boolean;
}

export interface TrendsHabits {
  readonly paydayEffect: PaydayEffect;
  readonly weekdays: Weekdays;
  readonly repeats: readonly RepeatCharge[];
  readonly streak: WantsStreak;
}

export type TrendsView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      readonly setupDay: IsoDate;
      // 40.1: the first day of the bank history kept from before setup day; null when there is none.
      readonly historyFrom: IsoDate | null;
      // 40.9: the same check as Home and Buckets.
      readonly check: BankCheck;
      // 40.4: each pay period in the last 90 days, and the current one, oldest first.
      readonly periods: readonly TrendsPeriod[];
      // 40.5: oldest first.
      readonly savings: readonly SavingsPoint[];
      // 40.6: the last 90 days.
      readonly places: { readonly from: IsoDate; readonly to: IsoDate; readonly total: Cents; readonly groups: readonly PlaceGroup[] };
      readonly now: TrendsNow;
      // 40.10 to 40.17.
      readonly future: TrendsFuture;
      readonly habits: TrendsHabits;
    };

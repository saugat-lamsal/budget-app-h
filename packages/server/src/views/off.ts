import {
  settingsWhenOff,
  type ActivityKind,
  rolesFor,
  type AccountId,
  type ActivityRow,
  type BucketActivity,
  type Cents,
  type PaycheckReport,
  type PaycheckSplit,
  type PaydayReport,
  type PeriodSummary,
  type AnyPot,
  type Pot,
  type PotAmounts,
  type ResortDetail,
  type Settings,
  type SplitSettings,
  type StartingPots,
  type Switches,
} from '@budget-app/money';
import type { ActivityView } from './activity.js';
import type { BucketsView } from './buckets.js';
import type { PaydayView } from './payday.js';
import type { KeyedDetail, ReviewView } from './review.js';
import type { SettingsView } from './settings.js';
import type { SetupReadyView, SetupView } from './setup.js';
import type { SavingsPoint, TrendsFuture, TrendsPart, TrendsPeriod, TrendsView } from './trends.js';

// Her rulebook, "Off in this setup": nothing about the mom reserve or the old
// card is shown or offered anywhere. The views are worked out as upstream's,
// so upstream's own tests and screens are as they were; this takes out of
// each view what is off, just before it is sent to the phone. The ...Shown
// types are what the phone can be sent: upstream's view, or the same with
// these parts left out.

// Upstream's setup: every view goes as it is.
const allOn = (s: Switches): boolean => s.momReserve === 'on' && s.oldCard === 'on';

type Tracking<V> = Extract<V, { readonly state: 'tracking' }>;
type NotTracking<V> = Exclude<V, { readonly state: 'tracking' }>;
// T with the keys K left out, or not.
type Maybe<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ----- Buckets: no mom reserve row, no old card debt -----

export type BucketsShown = NotTracking<BucketsView> | Maybe<Tracking<BucketsView>, 'momReserve' | 'oldCard'>;

export function shownBuckets(view: BucketsView, switches: Switches): BucketsShown {
  if (allOn(switches)) return view;
  if (view.state !== 'tracking') return view;
  const { momReserve, oldCard, ...rest } = view;
  return { ...rest, ...(switches.momReserve === 'off' ? {} : { momReserve }), ...(switches.oldCard === 'off' ? {} : { oldCard }) };
}

// ----- Payday: the paycheck says nothing about a reserve; the split is 3.3's alone -----

type Reserve = 'reservePerPaycheck' | 'reserveCap' | 'reserveBefore';
type ReserveSteps = 'reserveTaken' | 'overflowToSavings';
export type PaycheckSplitShown = Maybe<Omit<PaycheckSplit, 'detail'>, 'momReserve'> & { readonly detail: Maybe<PaycheckSplit['detail'], ReserveSteps> };
export type PaycheckShown = Maybe<Omit<PaycheckReport, 'split'>, Reserve> & { readonly split: PaycheckSplitShown };
// The pay period before, added up, with no mom reserve bucket and no payments to mom.
// Wishlist only where the setup has it (her rulebook, section 2).
type PotsShown = Readonly<Maybe<PotAmounts, 'momReserve'>>;
type KindsShown = Readonly<Maybe<Record<ActivityKind, Cents>, 'mom'>>;
export type PeriodSummaryShown = Omit<PeriodSummary, 'opening' | 'closing' | 'byKind'> & {
  readonly opening: PotsShown;
  readonly closing: PotsShown;
  readonly byKind: Readonly<Maybe<Record<Pot, KindsShown>, 'momReserve'>> & { readonly wishlist?: KindsShown };
};
export type PaydayReportShown = Omit<PaydayReport, 'paycheck' | 'ended'> & { readonly paycheck: PaycheckShown | null; readonly ended: PeriodSummaryShown | null };
// savingsAlone: what should be in the savings account is the savings bucket alone (3.8, no reserve).
// withWishlist: her rulebook, 3.8: it is savings plus Wishlist.
export type PaydayShown = NotTracking<PaydayView> | (Omit<Tracking<PaydayView>, 'report'> & { readonly report: PaydayReportShown; readonly savingsAlone?: true; readonly withWishlist?: true });

function summaryWithoutMom(summary: PeriodSummary): PeriodSummaryShown {
  const { momReserve: _opening, ...opening } = summary.opening;
  const { momReserve: _closing, ...closing } = summary.closing;
  const { momReserve: _byKind, ...pots } = summary.byKind;
  const noMom = ({ mom: _mom, ...kinds }: Readonly<Record<ActivityKind, Cents>>): Omit<Record<ActivityKind, Cents>, 'mom'> => kinds;
  const byKind = { savings: noMom(pots.savings), needs: noMom(pots.needs), wants: noMom(pots.wants), heldForOthers: noMom(pots.heldForOthers), ...(pots.wishlist === undefined ? {} : { wishlist: noMom(pots.wishlist) }) };
  return { ...summary, opening, closing, byKind };
}

// A paycheck's parts (3.3) with no reserve, nor its steps.
function splitWithoutReserve(split: PaycheckSplit): PaycheckSplitShown {
  const { momReserve: _reserve, detail, ...parts } = split;
  const { reserveTaken: _taken, overflowToSavings: _overflow, ...steps } = detail;
  return { ...parts, detail: steps };
}

export function shownPayday(view: PaydayView, switches: Switches): PaydayShown {
  if (view.state !== 'tracking' || switches.momReserve === 'on') return view;
  const report = view.report;
  const ended = report.ended === null ? null : summaryWithoutMom(report.ended);
  const wishlist = switches.wishlist === 'on' ? { withWishlist: true as const } : {};
  if (report.paycheck === null) return { ...view, report: { ...report, ended }, savingsAlone: true, ...wishlist };
  const { reservePerPaycheck: _perPaycheck, reserveCap: _cap, reserveBefore: _before, split, ...paycheck } = report.paycheck;
  return { ...view, report: { ...report, paycheck: { ...paycheck, split: splitWithoutReserve(split) }, ended }, savingsAlone: true, ...wishlist };
}

// ----- Review: what "This is my paycheck" would give has no reserve (3.2 off) -----

type WithPreview<T extends { readonly paycheckPreview: PaycheckSplit | null }> = Omit<T, 'paycheckPreview'> & { readonly paycheckPreview: PaycheckSplitShown | null };
export type ReviewItemShown = WithPreview<KeyedDetail>;
export type ReviewShown = NotTracking<ReviewView> | (Omit<Tracking<ReviewView>, 'items'> & { readonly items: readonly ReviewItemShown[] });

function previewWithoutReserve<T extends { readonly paycheckPreview: PaycheckSplit | null }>(item: T): WithPreview<T> {
  return { ...item, paycheckPreview: item.paycheckPreview === null ? null : splitWithoutReserve(item.paycheckPreview) };
}

export function shownReview(view: ReviewView, switches: Switches): ReviewShown {
  if (view.state !== 'tracking' || switches.momReserve === 'on') return view;
  return { ...view, items: view.items.map(previewWithoutReserve) };
}

// ----- Settings: no settings about them, no reserve in the split, no payoff countdown -----

type OffSetting = 'momReservePerPaycheck' | 'momReserveCap' | 'momMonthlyTarget' | 'momRule' | 'oldCardPromoEndDate' | 'oldCardClosingDay';
export type SettingsValuesShown = Maybe<Settings, OffSetting>;
export type SplitSettingsShown = Maybe<SplitSettings, 'momReservePerPaycheck' | 'momReserveCap'>;
type SettingsTracking = Tracking<SettingsView>;
export type SettingsShown =
  | NotTracking<SettingsView>
  | (Maybe<Omit<SettingsTracking, 'settings' | 'split' | 'ruleChoices'>, 'payoff'> & {
      readonly settings: SettingsValuesShown;
      readonly split: Omit<SettingsTracking['split'], 'thisPayPeriod' | 'fromNextPaycheck'> & { readonly thisPayPeriod: SplitSettingsShown; readonly fromNextPaycheck: SplitSettingsShown };
      readonly ruleChoices: { readonly [K in keyof SettingsTracking['ruleChoices']]: readonly SettingsTracking['ruleChoices'][K][number][] };
      // The accounts a bank rule can be on, when not upstream's four.
      readonly accounts?: readonly AccountId[];
    });

function without<T extends object>(value: T, off: object): T {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !(key in off))) as T;
}

export function shownSettings(view: SettingsView, switches: Switches): SettingsShown {
  if (allOn(switches)) return view;
  if (view.state !== 'tracking') return view;
  const off = settingsWhenOff(switches);
  const { payoff, ...rest } = view;
  const momOff = switches.momReserve === 'off';
  const choices = view.ruleChoices;
  return {
    ...rest,
    settings: without(view.settings, off),
    split: { ...view.split, thisPayPeriod: without(view.split.thisPayPeriod, off), fromNextPaycheck: without(view.split.fromNextPaycheck, off) },
    ruleChoices: momOff ? { ...choices, deposit: choices.deposit.filter((to) => to !== 'momReserve'), person: choices.person.filter((to) => to !== 'mom') } : choices,
    ...(switches.oldCard === 'off' ? { accounts: rolesFor(switches) } : { payoff }),
  };
}

// ----- Trends: no "Old card payment" part (40.2, 40.4), no reserve beside savings (40.5), no old card (40.13) -----

export type SavingsPointShown = Maybe<SavingsPoint, 'momReserve'>;
export type TrendsFutureShown = Maybe<TrendsFuture, 'oldCard'>;
export type TrendsPeriodShown = Omit<TrendsPeriod, 'spent'> & { readonly spent: Readonly<Maybe<Record<TrendsPart, Cents>, 'old-card'>> };
type TrendsTracking = Tracking<TrendsView>;
export type TrendsShown =
  | NotTracking<TrendsView>
  | (Omit<TrendsTracking, 'periods' | 'savings' | 'future'> & {
      readonly periods: readonly TrendsPeriodShown[];
      readonly savings: readonly SavingsPointShown[];
      readonly future: TrendsFutureShown;
    });

export function shownTrends(view: TrendsView, switches: Switches): TrendsShown {
  if (allOn(switches)) return view;
  if (view.state !== 'tracking') return view;
  const oldCardOff = switches.oldCard === 'off';
  const { oldCard, ...future } = view.future;
  return {
    ...view,
    periods: view.periods.map((p) => {
      const { 'old-card': oldCardPart, ...spent } = p.spent;
      return { ...p, spent: oldCardOff ? spent : { ...spent, 'old-card': oldCardPart } };
    }),
    savings: view.savings.map(({ momReserve, ...point }) => (switches.momReserve === 'off' ? point : { ...point, momReserve })),
    future: oldCardOff ? future : { ...future, oldCard },
  };
}

// ----- Setup day: no old card, and no mom reserve to give any of the starting money to -----

// accounts: the ones a bank rule can be on, when not upstream's four.
export type SetupReadyShown = Maybe<Omit<SetupReadyView, 'assignment'>, 'oldCard'> & { readonly assignment: Maybe<StartingPots, 'momReserve'>; readonly accounts?: readonly AccountId[] };
export type SetupShown = Exclude<SetupView, SetupReadyView> | SetupReadyShown;

export function shownSetup(view: SetupView, switches: Switches): SetupShown {
  if (allOn(switches)) return view;
  if (view.state !== 'not-set-up' || !view.ready) return view;
  const { oldCard, assignment, ...rest } = view;
  const { momReserve, ...given } = assignment;
  // Her rulebook, 14.2: Wishlist is one of the buckets to hand out to, from $0.00.
  const pots = switches.wishlist === 'on' ? { ...given, wishlist: given.wishlist ?? 0 } : given;
  return {
    ...rest,
    ...(switches.oldCard === 'off' ? { accounts: rolesFor(switches) } : { oldCard }),
    assignment: switches.momReserve === 'off' ? pots : { ...pots, momReserve },
  };
}

// ----- A bucket's own list: the mom reserve has none, and is not one to move money to -----

export type ActivityShown =
  | NotTracking<ActivityView>
  // A bucket this setup does not have.
  | { readonly state: 'off'; readonly madeUpData: boolean }
  | (Omit<Tracking<ActivityView>, 'balances' | 'activity'> & {
      readonly balances: PotsShown;
      readonly activity: Omit<BucketActivity, 'rows'> & { readonly rows: readonly ActivityRowShown[] };
    });
// Sorting money in again offers "This is my paycheck" with what it would give (3.2 off).
type Resortable = Extract<ResortDetail, { readonly resortable: true }>;
export type ActivityRowShown = Omit<ActivityRow, 'resort'> & { readonly resort: Exclude<ResortDetail, Resortable> | WithPreview<Resortable> };

export function shownActivity(view: ActivityView, pot: AnyPot, switches: Switches): ActivityShown {
  if (switches.momReserve === 'on') return view;
  if (pot === 'momReserve') return { state: 'off', madeUpData: view.madeUpData };
  if (view.state !== 'tracking') return view;
  const { momReserve: _momReserve, ...balances } = view.balances;
  const rows = view.activity.rows.map((row) => (row.resort.resortable ? { ...row, resort: previewWithoutReserve(row.resort) } : row));
  return { ...view, balances, activity: { ...view.activity, rows } };
}

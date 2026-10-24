import {
  DEFAULT_SETTINGS,
  HER_SETTINGS,
  HER_SWITCHES,
  MoneyError,
  addDays,
  cardNotices,
  changeSettings,
  daysBetween,
  startTracking,
  wishlistMove,
  withPendingCharges,
  type BankBalances,
  type BankTransaction,
  type Book,
  type CardNotice,
  type CardStatement,
  type Cents,
  type Deposit,
  type IsoDate,
  type LeftoverAnswer,
  type LeftoverChoice,
  type PersonPayment,
  type AnyPot,
  type Pot,
  type Pots,
  type Purchase,
  type RecheckedItem,
  type Refund,
  type ReviewDetail,
  type ReviewItem,
  type SavingsWithdrawal,
  type Settings,
  type SetupInput,
  type SortingRule,
  type TransferSent,
} from '../../src/index.js';
import { activityProblems, leftoverProblems, summaryProblems } from '../activity-helpers.js';
import { SimBank, type Card, type ChargeAccount, type OwnAccount, type Posted } from './bank.js';
import { Random } from './random.js';

// Phase 2, the simulated you: a made-up person with made-up numbers, lived
// one day at a time. Each day the bank's activity arrives in a shuffled
// order, the person does their evening review, and then every check runs.
// Besides the daily self-check, the simulator works out from the rulebook
// what each thing should do to the buckets and checks the book did exactly
// that. The first check that fails stops the life and reports its seed and
// day, so the same life can be played again exactly.

export interface LifeOptions {
  readonly seed: number;
  readonly years: number;
  // For the simulator's own tests: on this day the bank changes a balance
  // without telling the book, so the self-check must fail.
  readonly sabotageOnDay?: number;
  // For the bank connection's tests (packages/server): what the bank did on
  // setup day and on each day after, and the book's totals at the end of
  // each day, so the same days can be played through the bank connection in
  // Plaid's format. Recording changes nothing about the life.
  readonly record?: LifeRecorder;
  // For the full pay period through the screens (packages/web): a short life
  // lived as planned instead of at random. The years are ignored. Everything
  // else is the simulator's as always: its bank, its book, and every check on
  // every day. Without a plan, nothing about a life changes.
  readonly plan?: LifePlan;
  // A life shaped like hers (her rulebook, "Off in this setup", and
  // docs/her-plan.txt Piece J): her setup day, with the mom reserve and the
  // old card switched off, so there is no mom and no old card at all. Every
  // evening it checks that nothing about them is offered, and now and then
  // asks for something about them and checks it is refused. Upstream's life
  // (none given) is unchanged, draw for draw.
  readonly profile?: 'upstream' | 'her';
}

// ---- A life lived as planned --------------------------------------------

// Something the bank does on a planned day, in the order planned. A label
// names a purchase so later events can point at it.
export type PlannedBankEvent =
  // 4.1 to 4.3; a pending one posts on postsOn, at postsAt if it changed
  // (a tip, 4.6). The person sorts it in review that evening, or not before
  // sortOn.
  | {
      readonly kind: 'shop';
      readonly label: string;
      readonly store: string;
      readonly account: ChargeAccount;
      readonly amount: Cents;
      readonly pending?: { readonly postsOn: IsoDate; readonly postsAt?: Cents };
      readonly sortOn?: IsoDate;
    }
  // 4.5: a refund the bank does not match to its purchase, as the bank
  // connection reads every refund. On a card it is a refund; to checking it
  // is money in (A29). The person matches it to the labelled purchase.
  | { readonly kind: 'refund'; readonly of: string; readonly amount: Cents }
  // 3.1: a paycheck through payroll.
  | { readonly kind: 'paycheck'; readonly amount: Cents }
  // 8.1: a payment the mom rule matches.
  | { readonly kind: 'mom'; readonly amount: Cents; readonly from: OwnAccount }
  // 6.1 and 7.5: money in that waits for his choice (a friend paying back).
  | { readonly kind: 'deposit'; readonly account: OwnAccount; readonly amount: Cents; readonly description: string; readonly choice: 'other-income' | 'not-mine' | 'needs' | 'wants' }
  // 12.5: a card payment that leaves today and lands on landsOn.
  | { readonly kind: 'card-payment'; readonly card: Card; readonly from: OwnAccount; readonly amount: Cents; readonly landsOn: IsoDate }
  // 4.10: the bank charges a labelled purchase again, and takes the copy back on takenBackOn.
  | { readonly kind: 'charge-twice'; readonly of: string; readonly takenBackOn: IsoDate }
  // B13
  | { readonly kind: 'old-card-refund'; readonly amount: Cents };

// Something the person does on a planned evening, before going through
// review (or after it, with afterReview).
export type PlannedAnswer = (
  | { readonly kind: 'settings'; readonly patch: Partial<Settings> }
  | { readonly kind: 'add-rule'; readonly rule: SortingRule }
  | { readonly kind: 'move-rule'; readonly id: string; readonly direction: 'up' | 'down' }
  // 4.7: sorts a labelled purchase again, into the other bucket.
  | { readonly kind: 'resort'; readonly of: string }
  | { readonly kind: 'move'; readonly from: Pot; readonly to: Pot; readonly amount: Cents }
  // 3.4: the payday question for a bucket.
  | { readonly kind: 'leftover'; readonly bucket: 'needs' | 'wants'; readonly answer: LeftoverAnswer }
) & { readonly afterReview?: true };

export interface LifePlan {
  readonly start: IsoDate;
  readonly lastPaycheck: IsoDate;
  // How many days to live, setup day the first.
  readonly days: number;
  readonly pay: Cents;
  readonly posted: Posted;
  // On setup day: charges still pending (each posts later, at postsAt if it
  // changed), and card payments on their way.
  readonly pendingAtSetup: readonly { readonly label: string; readonly date: IsoDate; readonly account: ChargeAccount; readonly amount: Cents; readonly store: string; readonly postsOn: IsoDate; readonly postsAt?: Cents }[];
  readonly onTheirWayAtSetup: readonly { readonly date: IsoDate; readonly from: OwnAccount; readonly card: Card; readonly amount: Cents; readonly landsOn: IsoDate }[];
  readonly momReserve: Cents;
  // What tracking starts with (B131: the starting settings, and no rules).
  readonly settings: Settings;
  readonly rules: readonly SortingRule[];
  readonly bank: Readonly<Record<IsoDate, readonly PlannedBankEvent[]>>;
  readonly answers: Readonly<Record<IsoDate, readonly PlannedAnswer[]>>;
}

// The book's totals that bank activity alone decides. The person's answers
// only move money between buckets, so these do not depend on them.
export interface BookTotals {
  readonly appSide: Cents;
  readonly inTransit: Cents;
  readonly oldCardDebt: Cents;
}

// Phase 5: an alert the real server should send, worked out here from the
// rulebook on its own (the server's names, without its keys).
export type ExpectedAlert =
  | { readonly kind: 'low-bucket'; readonly bucket: 'needs' | 'wants'; readonly period: number; readonly amount: Cents; readonly startedWith: Cents }
  | { readonly kind: 'empty-bucket'; readonly bucket: 'needs' | 'wants'; readonly period: number; readonly amount: Cents }
  | { readonly kind: 'bank-took-back'; readonly id: string; readonly date: IsoDate; readonly description: string; readonly amount: Cents }
  | { readonly kind: 'daily-review'; readonly waiting: number }
  | { readonly kind: 'card-reminder'; readonly card: Card; readonly dueDate: IsoDate; readonly daysBefore: number; readonly minimumPayment: Cents; readonly statementBalance: Cents | null }
  | { readonly kind: 'card-overdue'; readonly card: Card; readonly dueDate: IsoDate; readonly minimumPayment: Cents }
  // 10.14: once per paycheck, when it is counted: what is still to move to
  // savings (3.8) and the old card's share (9.5; this life never enters a
  // promo end date, so none).
  | { readonly kind: 'payday'; readonly period: number; readonly date: IsoDate; readonly toSavings: Cents; readonly extraInSavings: Cents; readonly oldCard: null };

// Phase 5: the day as the real server lives it, in order, each step with the
// alerts due right after it: setup day itself; a part of the bank's activity
// one sync brings (the day's feed up to afterFeed); an answer (the index-th
// answer of the day); and the evening, at the daily review time (10.3, 9.1 to
// 9.4). Steps before the evening's review are in the day; from it on, in the
// evening.
export type DayStep =
  | { readonly kind: 'setup'; readonly alerts: readonly ExpectedAlert[] }
  | { readonly kind: 'sync'; readonly afterFeed: number; readonly phase: 'day' | 'evening'; readonly alerts: readonly ExpectedAlert[] }
  | { readonly kind: 'answer'; readonly index: number; readonly phase: 'day' | 'evening'; readonly alerts: readonly ExpectedAlert[] }
  | { readonly kind: 'evening'; readonly alerts: readonly ExpectedAlert[] };

export interface RecordedBankDay {
  readonly date: IsoDate;
  // What the bank sent that day, in the order it sent it.
  readonly feed: readonly BankTransaction[];
  readonly posted: Posted;
  // 12.1: posted plus pending charges.
  readonly balances: BankBalances;
  // Transfers with only one half showing, as "from to amount left|arrived".
  readonly halvesShowing: readonly string[];
  readonly totals: BookTotals;
  // Every bucket at the end of the day, and how many items wait in review.
  readonly pots: Pots;
  readonly waiting: number;
  // Phase 5: the day's steps, and the card statements that closed that day.
  readonly steps: readonly DayStep[];
  readonly statements: readonly CardStatement[];
}

// One answer the person gave the book, exactly as the book took it, and how
// many of the day's bank transactions the book had been given before it.
export interface RecordedAnswer {
  readonly method: string;
  readonly args: readonly unknown[];
  readonly afterFeed: number;
}

export interface LifeRecorder {
  // The bank as it started, what it sent before setup day, and setup day itself.
  setupDay(setup: { readonly start: Posted; readonly feed: readonly BankTransaction[]; readonly input: SetupInput; readonly totals: BookTotals }): void;
  day(day: RecordedBankDay): void;
  // Each answer, in the order given, before the day it was given on is recorded.
  answer?(answer: RecordedAnswer): void;
  // At the end of each day, once every check has passed: the simulator's own
  // book, to read then (it goes on changing), and the bank's balances.
  endOfDay?(day: { readonly date: IsoDate; readonly book: Book; readonly balances: BankBalances }): void;
}

// The book's methods that change it in answer to the person.
const ANSWERS = new Set(['sort', 'sortAlways', 'answerLeftover', 'acknowledge', 'moveMoney', 'changeSettings', 'addRule', 'changeRule', 'removeRule', 'moveRule']);

// The book, telling each answer it takes. A refused one (it throws, and
// changes nothing) is not told, nor a hand move that only asks first. Before
// each answer it is about to be given, `before` runs (Phase 5: the bank's
// activity until then is one sync).
function answering(book: Book, before: () => void, told: (method: string, args: readonly unknown[]) => void): Book {
  return new Proxy(book, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (typeof prop !== 'string' || !ANSWERS.has(prop)) return (value as (...a: unknown[]) => unknown).bind(target);
      return (...args: unknown[]): unknown => {
        before();
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (prop !== 'moveMoney' || (result as { moved: boolean }).moved) told(prop, structuredClone(args));
        return result;
      };
    },
  });
}

export type LifeResult =
  | { readonly ok: true; readonly seed: number; readonly days: number; readonly stats: Stats }
  | {
      readonly ok: false;
      readonly seed: number;
      readonly day: number;
      readonly date: IsoDate;
      readonly check: string;
      readonly message: string;
      readonly recent: readonly string[];
      readonly stats: Stats;
    };

// How often each kind of thing happened, to show the life covers what it should.
export const STAT_NAMES = [
  'days',
  'paychecks',
  'threePaycheckMonths',
  'latePaychecks',
  'smallPaychecks',
  'earlyPaychecksInReview',
  'myPaycheckChoices',
  'bonuses',
  'otherIncome',
  'purchases',
  'postedFromPending',
  'postedAtNewAmount',
  'holdsDropped',
  'pendingChanged',
  'refundsLinked',
  'refundsInReview',
  'splitPurchases',
  'savingsBills',
  'momPayments',
  'momDifferences',
  'momFromSavings',
  'paidForFriends',
  'friendsPaidBack',
  'personPaymentsFromSavings',
  'paymentsForMom',
  'forMomRules',
  'forMomResorted',
  'personPaymentsSplit',
  'everydayCardPayments',
  'oldCardPayments',
  'oldCardFromSavings',
  'oldCardPurchases',
  'oldCardRefunds',
  'paymentsInTransit',
  'paymentsLandedFirst',
  'paymentsLandedOutOfOrder',
  'lateCardPayments',
  'remindersChecked',
  'overdueAlerts',
  'cardFees',
  'cardInterest',
  'savingsTransfers',
  'transfersMarked',
  'leftoverRolledOver',
  'leftoverMovedToSavings',
  'leftoverAnsweredLate',
  'leftoverLoweredLate',
  'settingsChanges',
  'handMoves',
  'confirmedMoves',
  'resorts',
  'mistakesRefused',
  'alwaysRules',
  'rulesAdded',
  'duplicatesSent',
  'takenBack',
  'pendingAtSetup',
  'inTransitAtSetup',
  'activityChecks',
  'momRuleSetWhileWaiting',
  'momPaymentsRefundedWhileWaiting',
  'paycheckRuleSetWhileWaiting',
  'refundedInFullWhileWaiting',
  'refundsTakenBack',
] as const;
// What only a life shaped like hers counts: answers about the mom reserve or
// the old card refused, and items in review checked to offer nothing about
// them; and (PR 4) paychecks that waited for her yes, yeses on a later day,
// "not a paycheck" first and her paycheck after all, and a yes to a newer
// paycheck refused while an older one waited (51.2); and (PR 5) her second
// card: purchases, fees and refunds on it, payments to it (in transit,
// landing late), card payments from savings, and its reminders checked.
export const HER_STAT_NAMES = [
  'offRefused',
  'offersChecked',
  'paychecksWaitedForYes',
  'yesLate',
  'notAPaycheckFirst',
  'yesAfterNotAPaycheck',
  'olderPaycheckFirst',
  'secondCardPurchases',
  'secondCardRefunds',
  'secondCardFees',
  'secondCardPayments',
  'secondCardPaymentsInTransit',
  'cardPaymentsFromSavings',
  'secondCardRemindersChecked',
  'secondCardAtSetup',
  // PR 9: her Wishlist bucket.
  'wishlistPaychecks',
  'wishlistPurchases',
  'wishlistSplits',
  'wishlistRefunds',
  'wishlistHandMoves',
  'wishlistMoves',
] as const;
// What a life shaped like hers never has.
export const OFF_IN_HER_LIFE: readonly (typeof STAT_NAMES)[number][] = [
  'momPayments',
  'momDifferences',
  'momFromSavings',
  'paymentsForMom',
  'forMomRules',
  'forMomResorted',
  'oldCardPayments',
  'oldCardFromSavings',
  'oldCardPurchases',
  'oldCardRefunds',
  'momRuleSetWhileWaiting',
  'momPaymentsRefundedWhileWaiting',
];
export type Stats = Record<(typeof STAT_NAMES)[number] | (typeof HER_STAT_NAMES)[number], number>;

const PAYROLL = 'ACME PAYROLL';
const MOM = 'Made Up Mom';
// Someone the person sends money to for mom, which no rule knows at first (7.6).
const FOR_MOM = 'MADE UP AUNT';
const FIRST_START: IsoDate = '2026-10-01';

const START_RULES: readonly SortingRule[] = [
  { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
  { id: 'gas', for: 'purchase', contains: 'MADE UP GAS', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
  { id: 'pharmacy', for: 'purchase', contains: 'PHARMACY', bucket: 'needs' },
  { id: 'utility', for: 'purchase', contains: 'UTILITY', bucket: 'needs' },
  { id: 'phone', for: 'purchase', contains: 'PHONE', bucket: 'needs' },
  { id: 'streaming', for: 'purchase', contains: 'STREAMING', bucket: 'wants' },
  { id: 'landlord', for: 'person', contains: 'LANDLORD', choice: { to: 'needs' } },
  { id: 'roommate', for: 'deposit', contains: 'ROOMMATE', choice: { to: 'needs' } },
  { id: 'savings-interest', for: 'deposit', contains: 'INTEREST PAID', choice: { to: 'savings' } },
];

// How the person sorts something from a store when it waits in review.
type Sorting = 'needs' | 'wants' | 'split' | 'either' | 'wishlist';

interface Store {
  readonly name: string;
  readonly sorting: Sorting;
  readonly min: Cents;
  readonly max: Cents;
  // How often it comes up: on this many days in 1,000.
  readonly perThousandDays: number;
  // Paid by debit card this many times in 10, otherwise by the everyday card.
  readonly debitOutOf10: number;
  readonly how: 'pending' | 'posted' | 'gas';
  readonly tip?: boolean;
  readonly refundsOutOf100?: number;
}

const STORES: readonly Store[] = [
  { name: 'MADE UP GROCER', sorting: 'needs', min: 2_500, max: 18_000, perThousandDays: 300, debitOutOf10: 4, how: 'pending' },
  { name: 'MADE UP GAS', sorting: 'needs', min: 2_500, max: 7_500, perThousandDays: 150, debitOutOf10: 3, how: 'gas' },
  { name: 'MADE UP CAFE', sorting: 'wants', min: 300, max: 1_200, perThousandDays: 550, debitOutOf10: 2, how: 'pending' },
  { name: 'MADE UP RESTAURANT', sorting: 'wants', min: 1_800, max: 9_500, perThousandDays: 200, debitOutOf10: 1, how: 'pending', tip: true },
  { name: 'MADE UP ONLINE SHOP', sorting: 'either', min: 800, max: 16_000, perThousandDays: 140, debitOutOf10: 1, how: 'pending', refundsOutOf100: 15 },
  { name: 'MADE UP BIG BOX', sorting: 'split', min: 3_000, max: 26_000, perThousandDays: 90, debitOutOf10: 3, how: 'pending', refundsOutOf100: 6 },
  { name: 'MADE UP PHARMACY', sorting: 'needs', min: 800, max: 6_000, perThousandDays: 45, debitOutOf10: 5, how: 'posted' },
  { name: 'MADE UP CINEMA', sorting: 'wants', min: 1_200, max: 4_000, perThousandDays: 40, debitOutOf10: 0, how: 'pending' },
];

const SPLITS: readonly Settings['split'][] = [
  { savings: 50, needs: 30, wants: 20 },
  { savings: 40, needs: 35, wants: 25 },
  { savings: 55, needs: 30, wants: 15 },
  { savings: 45, needs: 35, wants: 20 },
  { savings: 60, needs: 25, wants: 15 },
];

// Her life (PR 9): her splits name Wishlist (her rulebook, section 2), now
// and then at 0%.
const HER_SPLITS: readonly Settings['split'][] = [
  { savings: 40, needs: 30, wants: 20, wishlist: 10 },
  { savings: 35, needs: 30, wants: 20, wishlist: 15 },
  { savings: 45, needs: 30, wants: 15, wishlist: 10 },
  { savings: 50, needs: 30, wants: 20, wishlist: 0 },
  { savings: 30, needs: 35, wants: 20, wishlist: 15 },
];

// Her life (PR 9): things off her Wishlist, sorted to it by hand in review
// (no rule picks Wishlist, 4.2), and now and then sent back.
const HER_STORES: readonly Store[] = [{ name: 'MADE UP GADGET SHOP', sorting: 'wishlist', min: 2_500, max: 45_000, perThousandDays: 35, debitOutOf10: 2, how: 'pending', refundsOutOf100: 20 }];

// How the person sorts a payment to a person: one place, for mom, or split
// across needs, wants, and not mine (7.6).
type PersonSorting = 'needs' | 'wants' | 'not-mine' | 'mom' | 'split';

// What the person knows about a bank transaction: how they will sort it.
type Intent =
  | { readonly type: 'store'; readonly sorting: Sorting; readonly store: string }
  | { readonly type: 'person'; readonly sorting: PersonSorting }
  | { readonly type: 'from-savings'; readonly sorting: 'needs' | 'wants' }
  | { readonly type: 'money-in'; readonly choice: 'paycheck' | 'other-income' | 'not-mine' | 'needs' | 'wants' }
  | { readonly type: 'refund'; readonly bucket: 'needs' | 'wants' | 'wishlist' };

// Where a purchase stands, as the simulator keeps track of it: the bucket it
// is in, waiting in review, split, counted on setup day, on the old card, or
// taken back by the bank (4.10), or refunded in full while it waited, so
// kept as a record sorted nowhere (4.5, A26).
type Standing = 'needs' | 'wants' | 'wishlist' | 'unsorted' | 'split' | 'setup' | 'old-card' | 'gone' | 'refunded';

// Sorted into one bucket (her life: Wishlist too).
const inABucket = (s: Standing | undefined): s is 'needs' | 'wants' | 'wishlist' => s === 'needs' || s === 'wants' || s === 'wishlist';

type PotName = keyof Pots;
const POT_NAMES: readonly PotName[] = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers', 'unsortedIn', 'unsortedOut'];
// How the buckets should change. Anything not named should not change.
type Change = Partial<Record<PotName, Cents>>;

interface CardPaymentSeen {
  left: IsoDate | null;
  landed: IsoDate | null;
  readonly amount: Cents;
}

interface Person {
  readonly pay: Cents;
  readonly rent: Cents;
  readonly closingDay: Record<Card, number>;
  readonly roommate: boolean;
  readonly momTimesPerMonth: number;
  // After a few payments for mom sorted by hand, "always do this" (13.6).
  readonly alwaysForMom: boolean;
}

class CheckFailed extends Error {
  readonly check: string;

  constructor(check: string, message: string) {
    super(message);
    this.check = check;
  }
}

export function liveALife(options: LifeOptions): LifeResult {
  return new Life(options).live();
}

class Life {
  readonly #seed: number;
  readonly #her: boolean;
  // The buckets the book has: her life has Wishlist too (PR 9).
  readonly #potNames: readonly PotName[];
  readonly #days: number;
  readonly #sabotageOnDay: number | undefined;
  readonly #record: LifeRecorder | undefined;
  readonly #startPosted: Posted;
  // How much of the bank's feed has been recorded.
  #recordedUpTo = 0;
  readonly #random: Random;
  readonly #person: Person;
  readonly #bank: SimBank;
  readonly #book: Book;
  readonly #setupInput: SetupInput;
  readonly #start: IsoDate;
  readonly #stats: Stats;
  #date: IsoDate;
  #day = 0;

  // The simulator's own record of what the book should know.
  #settings: Settings;
  // The split the pay period started with (13.1, B38).
  #periodSplit: Settings['split'];
  #lastPaycheckDate: IsoDate;
  #paychecksSeen = 0;
  readonly #rules: SortingRule[] = [...START_RULES];
  // By the id a purchase first had; a posting's id leads back to it.
  readonly #standing = new Map<string, Standing>();
  readonly #firstId = new Map<string, string>();
  // Purchases the person leaves waiting in review because they are sending
  // them back for a full refund (A26).
  readonly #awaitingReturn = new Set<string>();
  // How the person split each split purchase, by the id it first had.
  readonly #splitParts = new Map<string, { readonly needs: Cents; readonly wants: Cents; readonly wishlist?: Cents }>();
  readonly #momSent = new Map<string, Cents>();
  // 13.2, A9: now and then the person clears the mom rule, and sets it again
  // a few days later. Payments to mom wait in review meanwhile, and the bank
  // refunds part of some of them. In the order they came.
  readonly #waitingForMomRule: { readonly txn: PersonPayment; refunded: Cents }[] = [];
  // Payments to mom refunded in part, which setting the mom rule left
  // waiting (13.2, B73), until the person sorts them. Setting the rule again
  // leaves them waiting again.
  #momLeftWaiting: { readonly txn: PersonPayment; readonly refunded: Cents }[] = [];
  // The same for the paycheck rule: the paycheck that waits for it, if any.
  #paycheckWaitingForRule: string | null = null;
  // Her rulebook, 3.1 and 51.2 (her life, "Ask before splitting a paycheck"
  // on): the paychecks waiting for her yes, with the day each arrived; when
  // she will answer each, and whether she says "not a paycheck" first; and
  // the ones she said were not a paycheck, as other income, with what that
  // gave each bucket and the day she makes it her paycheck after all.
  readonly #waitingForYes = new Map<string, IsoDate>();
  readonly #yesPlans = new Map<string, { readonly on: IsoDate; readonly notFirst: boolean }>();
  readonly #notAPaycheck = new Map<string, { readonly date: IsoDate; readonly amount: Cents; readonly parts: Change; readonly on: IsoDate }>();

  // Things already set to happen on a later day, such as a pending charge
  // posting or a card payment landing.
  readonly #later = new Map<IsoDate, (() => void)[]>();
  // What the person does after the day's bank activity, such as moving
  // money to savings on payday.
  readonly #tonight: (() => void)[] = [];
  readonly #intents = new Map<string, Intent>();
  // Everything sent to the book, for duplicates.
  readonly #sent: BankTransaction[] = [];
  // Recent lines for a failure report.
  readonly #recent: string[] = [];
  readonly #statements: CardStatement[] = [];
  readonly #cardPayments: Record<Card, CardPaymentSeen[]> = { 'everyday-card': [], 'old-card': [], 'second-card': [] };
  // The leftover questions: when the person will answer each one, and how.
  readonly #leftoverPlans = new Map<string, { readonly on: IsoDate | null; readonly answer: LeftoverAnswer }>();
  // What each leftover question asked at payday, and what spending made
  // before payday had taken from its bucket then (B4).
  readonly #askedAtPayday = new Map<string, { readonly asked: Cents; readonly spentBefore: Cents }>();
  // Early paychecks the person leaves in review until a later day.
  readonly #waitUntil = new Map<string, IsoDate>();
  // Purchases the person sorted by hand to one bucket, which they may re-sort.
  readonly #handSorted: { readonly id: string; to: 'needs' | 'wants' }[] = [];
  readonly #alertsGiven = new Set<string>();
  // 10.14: the paychecks counted by the last event point, and the transfers
  // the bank showed as something else that the person has not marked yet (5.6).
  #paychecksTold = 0;
  readonly #notMarkedYet = new Set<string>();
  // Phase 5: today's steps as the real server lives them, how far the feed
  // was at the last one, how many answers today, whether the evening's review
  // has begun, the statements that closed today, and each card's latest.
  #steps: DayStep[] = [];
  #pointFeed = 0;
  #answersToday = 0;
  #phase: 'day' | 'evening' = 'day';
  #statementsToday: CardStatement[] = [];
  readonly #latestStatement: Partial<Record<Card, CardStatement>> = {};
  // 10.6: what the bank took back, oldest first, for the alerts still to come.
  readonly #tookBack: { readonly id: string; readonly date: IsoDate; readonly description: string; readonly amount: Cents }[] = [];
  // Payments for mom that are not the mom rule's, which the person may sort
  // again (7.6): what each took from the reserve, and the day it was made.
  readonly #forMom: { readonly id: string; readonly date: IsoDate; readonly amount: Cents; readonly fromReserve: Cents }[] = [];
  // Payments the mom rule matched, which can never be sorted another way (8.1).
  readonly #momRulePayments: string[] = [];
  // Where the person sorted each mom difference, by its review id.
  readonly #differenceTo = new Map<string, 'needs' | 'wants'>();
  #restaurantsSortedByHand = 0;
  #forMomSortedByHand = 0;
  #nextScheduledPayday: IsoDate;
  #nextSettingsChange: IsoDate;
  // A life lived as planned: its plan, its purchases by label (the id each
  // first had), the refunds waiting to be matched to their purchase, and
  // purchases the person leaves in review until a day.
  readonly #plan: LifePlan | undefined;
  readonly #labels = new Map<string, string>();
  readonly #refundOf = new Map<string, string>();
  readonly #sortOn = new Map<string, IsoDate>();

  constructor(options: LifeOptions) {
    this.#seed = options.seed;
    this.#her = options.profile === 'her';
    this.#potNames = this.#her ? [...POT_NAMES, 'wishlist'] : POT_NAMES;
    this.#plan = options.plan;
    this.#days = options.plan === undefined ? Math.round(options.years * 365) : options.plan.days;
    this.#sabotageOnDay = options.sabotageOnDay;
    this.#record = options.record;
    this.#random = new Random(options.seed);
    this.#stats = Object.fromEntries([...STAT_NAMES, ...HER_STAT_NAMES].map((name) => [name, 0])) as Stats;
    const r = this.#random;
    if (options.plan !== undefined) {
      const plan = options.plan;
      this.#person = { pay: plan.pay, rent: 0, closingDay: { 'everyday-card': 0, 'old-card': 0, 'second-card': 0 }, roommate: false, momTimesPerMonth: 0, alwaysForMom: false };
      this.#start = plan.start;
      this.#date = plan.start;
      this.#lastPaycheckDate = plan.lastPaycheck;
      this.#nextScheduledPayday = addDays(plan.lastPaycheck, 14);
      this.#nextSettingsChange = addDays(plan.start, 100_000);
      this.#startPosted = { ...plan.posted };
      this.#bank = new SimBank(this.#startPosted);
      for (const p of plan.pendingAtSetup) {
        const charge = this.#bank.authorize(p.date, p.account, p.amount, p.store);
        this.#labels.set(p.label, charge.id);
        this.#standing.set(charge.id, p.account === 'old-card' ? 'old-card' : 'setup');
        const store = STORES.find((s) => s.name === p.store);
        if (store !== undefined) this.#intents.set(charge.id, { type: 'store', sorting: store.sorting, store: store.name });
        this.#stats.pendingAtSetup++;
        this.#laterOn(p.postsOn, () => this.#post(charge.id, p.postsAt ?? p.amount));
      }
      for (const w of plan.onTheirWayAtSetup) {
        const left = this.#bank.send(w.date, w.from, w.card, w.amount);
        this.#stats.inTransitAtSetup++;
        const seen: CardPaymentSeen = { left: left.date, landed: null, amount: left.amount };
        this.#cardPayments[w.card].push(seen);
        this.#laterOn(w.landsOn, () => {
          this.#ownTransfer(() => this.#bank.land(this.#date, left, false));
          seen.landed = this.#date;
        });
      }
      // 14.2: savings and the mom reserve as planned, and the rest 60 to 40
      // between needs and wants, as a person lives it.
      const balances = this.#bank.balances();
      const startingMoney = balances.checking + balances.savings - balances.everydayCard - (balances.secondCard ?? 0) + this.#bank.inTransit();
      const savings = balances.savings - plan.momReserve;
      const rest = startingMoney - savings - plan.momReserve;
      const needs = rest > 0 ? share(rest, 60) : rest;
      this.#settings = plan.settings;
      this.#periodSplit = plan.settings.split;
      this.#rules.splice(0, this.#rules.length, ...plan.rules);
      this.#setupInput = {
        date: plan.start,
        bankBalances: this.#bank.postedBalances(),
        pendingCharges: this.#bank.pendingCharges(),
        transfersInTransit: this.#bank.halvesShowing(),
        oldCardBalance: this.#bank.posted.oldCard,
        assignment: { savings, needs, wants: rest - needs, momReserve: plan.momReserve, heldForOthers: 0 },
        lastPaycheckDate: plan.lastPaycheck,
        settings: plan.settings,
        rules: plan.rules,
      };
    } else {
      this.#person = {
        pay: r.int(260_000, 480_000),
        rent: r.int(90_000, 180_000),
        // Her life has no old card, so its statement never closes (day 0);
        // upstream's has no second card.
        closingDay: { 'everyday-card': r.int(1, 28), 'old-card': this.#her ? 0 : r.int(1, 28), 'second-card': this.#her ? r.int(1, 28) : 0 },
        roommate: r.chance(1, 2),
        momTimesPerMonth: this.#her ? 0 : r.int(1, 3),
        alwaysForMom: this.#her ? false : r.chance(1, 2),
      };
      this.#start = addDays(FIRST_START, r.int(0, 364));
      this.#date = this.#start;
      const lastPaycheck = addDays(this.#start, -r.int(0, 13));
      this.#lastPaycheckDate = lastPaycheck;
      this.#nextScheduledPayday = addDays(lastPaycheck, 14);
      this.#nextSettingsChange = addDays(this.#start, r.int(60, 330));

      // Setup day (section 14): the bank as it stands, with a few charges still
      // pending and sometimes a card payment on its way.
      this.#startPosted = {
        checking: r.int(150_000, 600_000),
        savings: r.int(200_000, 2_000_000),
        everydayCard: r.int(0, 250_000),
        oldCard: this.#her ? 0 : r.int(250_000, 350_000),
        ...(this.#her ? { secondCard: r.int(0, 250_000) } : {}),
      };
      this.#bank = new SimBank(this.#startPosted);
      for (let i = r.int(0, 3); i > 0; i--) {
        const store = r.pick(STORES.filter((s) => s.how !== 'posted'));
        const account = r.chance(store.debitOutOf10, 10) ? 'checking' : this.#card();
        const charge = this.#bank.authorize(addDays(this.#start, -r.int(0, 2)), account, r.int(store.min, store.max), store.name);
        if (account === 'second-card') this.#stats.secondCardAtSetup++;
        this.#standing.set(charge.id, 'setup');
        this.#intents.set(charge.id, { type: 'store', sorting: store.sorting, store: store.name });
        this.#stats.pendingAtSetup++;
        this.#laterOn(addDays(this.#start, r.int(1, 3)), () => this.#post(charge.id, charge.amount + (r.chance(1, 4) ? r.int(1, 1_500) : 0)));
      }
      if (!this.#her && r.chance(1, 5)) {
        const charge = this.#bank.authorize(addDays(this.#start, -1), 'old-card', r.int(1_000, 6_000), 'MADE UP CAFE');
        this.#standing.set(charge.id, 'old-card');
        this.#stats.pendingAtSetup++;
        this.#laterOn(addDays(this.#start, r.int(1, 3)), () => this.#post(charge.id, charge.amount));
      }
      if (r.chance(1, 4)) {
        const left = this.#bank.send(addDays(this.#start, -1), 'checking', 'everyday-card', r.int(5_000, 60_000));
        this.#stats.inTransitAtSetup++;
        const seen: CardPaymentSeen = { left: left.date, landed: null, amount: left.amount };
        this.#cardPayments['everyday-card'].push(seen);
        this.#laterOn(addDays(this.#start, r.int(1, 2)), () => {
          this.#ownTransfer(() => this.#bank.land(this.#date, left, r.chance(7, 10)));
          seen.landed = this.#date;
        });
      }
      // Sometimes a payment shows landing on the card before it shows leaving
      // checking, or a payment to the old card is on its way (12.5, B48).
      if (r.chance(1, 8)) {
        const landed = this.#bank.landFirst(addDays(this.#start, -1), 'checking', 'everyday-card', r.int(5_000, 60_000));
        this.#stats.inTransitAtSetup++;
        const seen: CardPaymentSeen = { left: null, landed: landed.date, amount: landed.amount };
        this.#cardPayments['everyday-card'].push(seen);
        this.#laterOn(addDays(this.#start, r.int(1, 2)), () => {
          this.#ownTransfer(() => this.#bank.sendAfter(this.#date, landed));
          seen.left = this.#date;
        });
      }
      if (!this.#her && r.chance(1, 8)) {
        const left = this.#bank.send(addDays(this.#start, -1), 'checking', 'old-card', r.int(5_000, 30_000));
        this.#stats.inTransitAtSetup++;
        const seen: CardPaymentSeen = { left: left.date, landed: null, amount: left.amount };
        this.#cardPayments['old-card'].push(seen);
        this.#laterOn(addDays(this.#start, r.int(1, 2)), () => {
          this.#ownTransfer(() => this.#bank.land(this.#date, left, r.chance(1, 2)));
          seen.landed = this.#date;
        });
      }
      // Her second card: a payment to it on its way on setup day, from
      // checking or savings (12.5, B48).
      if (this.#her && r.chance(1, 4)) {
        const left = this.#bank.send(addDays(this.#start, -1), r.chance(1, 4) ? 'savings' : 'checking', 'second-card', r.int(5_000, 60_000));
        this.#stats.inTransitAtSetup++;
        this.#stats.secondCardAtSetup++;
        const seen: CardPaymentSeen = { left: left.date, landed: null, amount: left.amount };
        this.#cardPayments['second-card'].push(seen);
        this.#laterOn(addDays(this.#start, r.int(1, 2)), () => {
          this.#ownTransfer(() => this.#bank.land(this.#date, left, r.chance(1, 2)));
          seen.landed = this.#date;
        });
      }
      // 14.2: the person assigns the starting money, worked out here on its own.
      const balances = this.#bank.balances();
      const startingMoney = balances.checking + balances.savings - balances.everydayCard - (balances.secondCard ?? 0) + this.#bank.inTransit();
      const momReserve = this.#her ? 0 : Math.min(r.int(0, 300_000), balances.savings);
      const savings = balances.savings - momReserve;
      const rest = startingMoney - savings - momReserve;
      const needs = rest > 0 ? share(rest, 60) : rest;
      // Her rulebook, 14.2: she gives some to Wishlist, and picks its share (section 2).
      const wishlist = this.#her && rest > 0 ? share(rest, r.int(0, 20)) : 0;
      this.#settings = this.#her
        ? changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL }, split: r.pick(HER_SPLITS) })
        : changeSettings(DEFAULT_SETTINGS, { paycheckRule: { contains: PAYROLL }, momRule: { contains: MOM } });
      this.#periodSplit = this.#settings.split;
      this.#setupInput = {
        date: this.#start,
        bankBalances: this.#bank.postedBalances(),
        pendingCharges: this.#bank.pendingCharges(),
        transfersInTransit: this.#bank.halvesShowing(),
        oldCardBalance: this.#bank.posted.oldCard,
        assignment: { savings, needs, wants: rest - needs - wishlist, momReserve, heldForOthers: 0, ...(this.#her ? { wishlist } : {}) },
        lastPaycheckDate: lastPaycheck,
        settings: this.#settings,
        rules: START_RULES,
        ...(this.#her ? { switches: HER_SWITCHES } : {}),
      };
    }
    const setup = startTracking(this.#setupInput);
    if (!setup.ok) throw new Error(`seed ${options.seed}: the simulator's setup day did not add up (${setup.difference})`);
    const answer = options.record?.answer?.bind(options.record);
    this.#book = answering(
      setup.book,
      () => this.#syncPoint(),
      (method, args) => {
        answer?.({ method, args, afterFeed: this.#bank.feed.length - this.#recordedUpTo });
        this.#steps.push({ kind: 'answer', index: this.#answersToday++, phase: this.#phase, alerts: this.#eventPoint() });
      },
    );
  }

  live(): LifeResult {
    try {
      this.#checkSetupDay();
      this.#pointFeed = this.#bank.feed.length;
      this.#steps.push({ kind: 'setup', alerts: this.#eventPoint() });
      if (this.#record !== undefined) {
        this.#recordedUpTo = this.#bank.feed.length;
        this.#record.setupDay({ start: { ...this.#startPosted }, feed: [...this.#bank.feed], input: this.#setupInput, totals: this.#totals() });
      }
      for (this.#day = 0; this.#day < this.#days; this.#day++) {
        this.#date = addDays(this.#start, this.#day);
        this.#phase = 'day';
        this.#bankDay();
        if (this.#day === this.#sabotageOnDay) this.#bank.changeWithoutTelling('checking', -1);
        this.#phase = 'evening';
        this.#evening();
        this.#check();
        this.#recordDay();
        this.#record?.endOfDay?.({ date: this.#date, book: this.#book, balances: this.#bank.balances() });
        this.#steps = [];
        this.#statementsToday = [];
        this.#answersToday = 0;
        this.#pointFeed = this.#bank.feed.length;
        this.#stats.days++;
      }
      return { ok: true, seed: this.#seed, days: this.#days, stats: this.#stats };
    } catch (error) {
      const check = error instanceof CheckFailed ? error.check : 'the book refused something';
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, seed: this.#seed, day: this.#day, date: this.#date, check, message, recent: [...this.#recent], stats: this.#stats };
    }
  }

  // B4: what spending made before this day takes from a bucket now, worked
  // out from the purchases as the book lists them: what is left of each
  // (after refunds, and less any part counted on setup day), in the bucket it
  // is sorted to, or its part of a split.
  #spentBeforeFromList(bucket: 'needs' | 'wants', day: IsoDate): Cents {
    let spent = 0;
    for (const p of this.#book.purchases()) {
      if (daysBetween(p.date, day) <= 0) continue;
      const left = p.amount - p.refunded - p.countedAtSetup;
      const sorted = p.sortedTo;
      if ('split' in sorted) {
        if (left !== 0) spent += sorted.split.filter((part) => part.bucket === bucket).reduce((sum, part) => sum + part.amount, 0);
      } else if (sorted.to === bucket) {
        spent += left;
      }
    }
    return spent;
  }

  #totals(): BookTotals {
    const check = this.#book.selfCheck(this.#bank.balances());
    return { appSide: check.appSide, inTransit: check.inTransit, oldCardDebt: this.#book.oldCardDebt() };
  }

  #recordDay(): void {
    if (this.#record === undefined) return;
    const feed = this.#bank.feed.slice(this.#recordedUpTo);
    this.#recordedUpTo = this.#bank.feed.length;
    const halvesShowing = this.#bank
      .halvesShowing()
      .map((h) => `${h.from} ${h.to} ${h.amount} ${h.kind === 'transfer-sent' ? 'left' : 'arrived'}`)
      .sort();
    this.#record.day({
      date: this.#date,
      feed,
      posted: { ...this.#bank.posted },
      balances: this.#bank.balances(),
      halvesShowing,
      totals: this.#totals(),
      pots: this.#book.pots(),
      waiting: this.#book.reviewItems().length,
      steps: this.#steps,
      statements: this.#statementsToday,
    });
  }

  // 14.3: an assignment a cent off either way is refused, saying what is left.
  #checkSetupDay(): void {
    const assignment = this.#setupInput.assignment;
    for (const off of [-1, 1]) {
      const result = startTracking({ ...this.#setupInput, assignment: { ...assignment, wants: assignment.wants + off } });
      if (result.ok || result.difference !== -off) {
        throw new CheckFailed('14.3 setup adds up exactly', `an assignment ${off} cent off was ${result.ok ? 'accepted' : `refused with ${result.difference} left`}`);
      }
    }
  }

  // ---- The bank's day -------------------------------------------------

  #bankDay(): void {
    const r = this.#random;
    const today = this.#date;
    if (this.#plan !== undefined) {
      // What was set for today (postings, landings), then the plan, in order.
      const later = this.#later.get(today) ?? [];
      this.#later.delete(today);
      for (const event of later) event();
      for (const event of this.#plan.bank[today] ?? []) this.#planned(event);
      return;
    }
    const dayOfMonth = Number(today.slice(8, 10));
    // Plans first, since some of what they plan can happen today.
    if (today === this.#nextScheduledPayday) this.#planPaycheck();
    if (dayOfMonth === 1 && !this.#her) this.#planMomPayments();
    const events: (() => void)[] = [...(this.#later.get(today) ?? [])];
    this.#later.delete(today);

    for (const store of STORES) if (r.chance(store.perThousandDays, 1_000)) events.push(() => this.#shop(store));
    if (this.#her) for (const store of HER_STORES) if (r.chance(store.perThousandDays, 1_000)) events.push(() => this.#shop(store));
    // Now and then the rent goes from savings; the landlord's rule still sorts it (A16).
    if (dayOfMonth === 1) events.push(() => this.#payPerson(this.#person.rent, 'MADE UP LANDLORD', 'needs', r.chance(1, 12) ? 'savings' : 'checking'));
    if (dayOfMonth === 5) events.push(() => this.#bill('MADE UP STREAMING', 1_599, 'everyday-card'));
    if (dayOfMonth === 12) events.push(() => this.#bill('MADE UP UTILITY', r.int(6_000, 20_000), 'checking'));
    if (dayOfMonth === 18) events.push(() => this.#bill('MADE UP PHONE', r.int(4_500, 9_000), this.#her ? 'second-card' : 'everyday-card'));
    if (dayOfMonth === 15 && this.#person.roommate) events.push(() => this.#deposit('checking', r.int(4_000, 12_000), 'ZELLE FROM MADE UP ROOMMATE', null));
    if (dayOfMonth === 28) events.push(() => this.#deposit('savings', r.int(50, 1_500), 'MADE UP BANK INTEREST PAID', null));
    for (const card of ['everyday-card', 'old-card', 'second-card'] as const) {
      if (dayOfMonth === this.#person.closingDay[card]) events.push(() => this.#closeStatement(card));
    }
    if (r.chance(1, 25)) events.push(() => this.#payForFriend());
    if (r.chance(1, 40)) events.push(() => this.#deposit('checking', r.int(1_500, 6_000), 'ZELLE FROM MADE UP FRIEND', 'wants'));
    if (r.chance(1, 30)) events.push(() => this.#payPerson(r.int(2_500, 8_000), 'MADE UP BARBER', 'wants'));
    if (!this.#her && r.chance(1, 60)) events.push(() => this.#payPerson(r.int(5_000, 40_000), FOR_MOM, 'mom'));
    if (r.chance(1, 40)) events.push(() => this.#payPerson(r.int(2_000, 16_000), 'MADE UP COWORKER', 'split'));
    if (r.chance(1, 45)) events.push(() => this.#billFromSavings());
    if (r.chance(1, 50)) events.push(() => this.#misreadTransfer());
    if (r.chance(1, 150)) events.push(() => this.#chargeTwice());
    if (r.chance(1, 120)) events.push(() => this.#deposit('checking', r.int(2_000, 30_000), 'MADE UP GIFT', r.pick(['other-income', 'wants'] as const)));
    if (!this.#her && r.chance(1, 600)) events.push(() => this.#oldCardPurchase());
    if (!this.#her && r.chance(1, 400)) events.push(() => this.#oldCardRefund());
    if (today.slice(5) === '03-15') events.push(() => this.#deposit('checking', r.int(20_000, 250_000), 'IRS TREAS 310 TAX REF', 'other-income'));
    if (r.chance(1, 50)) events.push(() => this.#sendDuplicate());

    // The bank sends the day's activity in no particular order.
    for (let i = events.length - 1; i > 0; i--) {
      const j = r.int(0, i);
      [events[i], events[j]] = [events[j] as () => void, events[i] as () => void];
    }
    for (const event of events) event();
  }

  #laterOn(date: IsoDate, event: () => void): void {
    const list = this.#later.get(date);
    if (list) list.push(event);
    else this.#later.set(date, [event]);
  }

  // Paydays every 14 days (section 2). Now and then the paycheck is a few
  // days late. One that comes 5 days late makes the next one arrive only 9
  // days after it, so that one waits in review as an early paycheck (3.7).
  // Now and then a bonus comes through payroll a few days after payday.
  #planPaycheck(): void {
    const r = this.#random;
    const scheduled = this.#nextScheduledPayday;
    this.#nextScheduledPayday = addDays(scheduled, 14);
    const delay = r.chance(1, 60) ? 5 : r.chance(1, 40) ? r.int(1, 4) : 0;
    if (delay > 0) this.#stats.latePaychecks++;
    const spread = share(this.#person.pay, 3);
    // Now and then a short paycheck, smaller than what the mom reserve takes (B1).
    const small = r.chance(1, 50);
    if (small) this.#stats.smallPaychecks++;
    const amount = small ? r.int(30_000, 140_000) : this.#person.pay + r.int(-spread, spread);
    this.#laterOn(addDays(scheduled, delay), () => this.#payroll(amount, `${PAYROLL} DIRECT DEP`, 'paycheck'));
    if (r.chance(1, 13)) {
      this.#laterOn(addDays(scheduled, delay + r.int(2, 7)), () => {
        this.#stats.bonuses++;
        this.#payroll(r.int(30_000, 200_000), `${PAYROLL} BONUS`, 'other-income');
      });
    }
  }

  // 3.1 and 3.7: a deposit matching the paycheck rule is a paycheck, unless
  // it comes less than 10 days after the last one; then it waits in review.
  #payroll(amount: Cents, description: string, meant: 'paycheck' | 'other-income'): void {
    const early = daysBetween(this.#lastPaycheckDate, this.#date) < this.#settings.earlyPaycheckDays;
    // 13.2, A9: now and then the paycheck rule is cleared that morning, and set
    // again that evening, after the paycheck has come in and waited.
    if (meant === 'paycheck' && !early && this.#settings.paycheckRule !== null && this.#paycheckWaitingForRule === null && this.#plan === undefined && this.#random.chance(1, 25)) {
      this.#clearRule('paycheckRule');
      const before = this.#book.pots();
      const txn = this.#bank.deposit(this.#date, 'checking', amount, description);
      this.#intents.set(txn.id, { type: 'money-in', choice: meant });
      const outcome = this.#receive(txn);
      if (outcome !== 'review') throw new CheckFailed('3.1 with no paycheck rule, a paycheck waits in review', `${txn.id} came back as ${outcome}`);
      this.#expectChange(before, { unsortedIn: amount }, '3.1 with no paycheck rule, a paycheck waits in review', txn.id);
      this.#paycheckWaitingForRule = txn.id;
      this.#tonight.push(() => this.#setPaycheckRuleAgain(txn));
      return;
    }
    const before = this.#book.pots();
    const asked = this.#openLeftovers();
    const txn = this.#bank.deposit(this.#date, 'checking', amount, description);
    this.#intents.set(txn.id, { type: 'money-in', choice: meant });
    const outcome = this.#receive(txn);
    const asks = this.#settings.askBeforeSplittingPaycheck === true;
    if (early) {
      if (outcome !== 'review') throw new CheckFailed('3.7 an early paycheck waits in review', `${txn.id}, ${daysBetween(this.#lastPaycheckDate, this.#date)} days after the last paycheck, came back as ${outcome}`);
      this.#expectChange(before, { unsortedIn: amount }, '3.7 an early paycheck waits in review', txn.id);
      this.#stats.earlyPaychecksInReview++;
      // 51.3: while asking, an early one is a paycheck waiting for her yes too.
      if (asks) this.#waitingForYes.set(txn.id, this.#date);
    } else if (asks) {
      // Her rulebook, 3.1: with "Ask before splitting a paycheck" on, it waits
      // for her yes, and nothing is split.
      if (outcome !== 'review') throw new CheckFailed('3.1 with asking on, a paycheck waits for her yes', `${txn.id} came back as ${outcome}`);
      this.#expectChange(before, { unsortedIn: amount }, '3.1 with asking on, a paycheck waits for her yes', txn.id);
      const item = this.#book.reviewItems().find((i) => i.id === txn.id);
      if (item?.type !== 'money-in' || item.reason !== 'paycheck') throw new CheckFailed('3.1 with asking on, a paycheck waits for her yes', `${txn.id} waits as ${JSON.stringify(item)}`);
      this.#waitingForYes.set(txn.id, this.#date);
      this.#stats.paychecksWaitedForYes++;
    } else {
      if (outcome !== 'paycheck') throw new CheckFailed('3.1 a paycheck starts a pay period', `${txn.id}, ${daysBetween(this.#lastPaycheckDate, this.#date)} days after the last paycheck, came back as ${outcome}`);
      this.#onPaycheck(before, asked, amount, this.#date, 'bank');
    }
  }

  #openLeftovers(): Set<'needs' | 'wants'> {
    return new Set(this.#book.reviewItems().flatMap((i) => (i.type === 'leftover' ? [i.bucket] : [])));
  }

  // 3.2 and 3.3, worked out here from the rulebook: the mom reserve comes off
  // first, as much as fits under the cap (a smaller paycheck gives all it
  // has); what does not fit goes to savings; the rest is split by the
  // percentages, each rounded down, with the leftover cents to savings.
  // Her rulebook, 3.3: Wishlist rounded down too, where the split names it.
  #expectedSplit(amount: Cents, reserveBefore: Cents): { momReserve: Cents; savings: Cents; needs: Cents; wants: Cents; wishlist?: Cents } {
    const { momReservePerPaycheck, momReserveCap, split } = this.#settings;
    const forReserve = Math.min(momReservePerPaycheck, amount);
    const fits = Math.max(0, Math.min(forReserve, momReserveCap - reserveBefore));
    const rest = amount - forReserve;
    const needs = share(rest, split.needs);
    const wants = share(rest, split.wants);
    const wishlist = split.wishlist === undefined ? 0 : share(rest, split.wishlist);
    return { momReserve: fits, savings: forReserve - fits + rest - needs - wants - wishlist, needs, wants, ...(split.wishlist === undefined ? {} : { wishlist }) };
  }

  // `asked` is which buckets had a leftover question open before payday;
  // `how`: the bank's paycheck split by itself, a deposit waiting in review
  // you called your paycheck (6.1, or a yes, 3.1), or one already sorted as
  // other income made your paycheck after all (B52; `before` is then the
  // buckets with that other income taken back out).
  #onPaycheck(before: Pots, asked: Set<'needs' | 'wants'>, amount: Cents, date: IsoDate, how: 'bank' | 'review' | 'resort'): void {
    const fromReview = how === 'review';
    const record = this.#book.paychecks().at(-1);
    const expected = this.#expectedSplit(amount, before.momReserve);
    const got = record && partsOf(record.split);
    if ((expected.wishlist ?? 0) > 0) this.#stats.wishlistPaychecks++;
    if (!record || record.amount !== amount || record.date !== date || !same(got, expected)) {
      throw new CheckFailed('3.2 and 3.3 the paycheck split', `a paycheck of ${amount} with the reserve at ${before.momReserve}: expected ${JSON.stringify(expected)}, the book has ${JSON.stringify(got)} on ${record?.date}`);
    }
    // The buckets at payday: the paycheck's parts, plus whatever was left in
    // a bucket set to always move it to savings (3.4). When a question from
    // the last payday is still open and the setting has changed since, only
    // the reserve is checked; the rulebook does not cover that case.
    const change: Change = { ...expected, ...(fromReview ? { unsortedIn: -amount } : {}) };
    for (const bucket of ['needs', 'wants'] as const) {
      if (this.#settings.leftoverAtPayday[bucket] === 'move-to-savings' && before[bucket] > 0) {
        change[bucket] = expected[bucket] - before[bucket];
        change.savings = (change.savings ?? 0) + before[bucket];
      }
    }
    if ([...asked].some((bucket) => this.#settings.leftoverAtPayday[bucket] !== 'ask')) {
      // Her rulebook, 3.4: Wishlist is never asked about, so its share is checked here too.
      const wishlist = expected.wishlist === undefined ? {} : { wishlist: expected.wishlist };
      this.#expectChange(before, { momReserve: expected.momReserve, ...wishlist, ...(fromReview ? { unsortedIn: -amount } : {}) }, '3.2 the mom reserve at payday', `paycheck of ${amount}`, ['savings', 'needs', 'wants']);
    } else {
      this.#expectChange(before, change, '3.2 to 3.4 the buckets at payday', `paycheck of ${amount}`);
    }
    // 3.4 and B2: a leftover question for each bucket set to ask, about what
    // was left when the paycheck came, replacing any earlier one (B3).
    for (const bucket of ['needs', 'wants'] as const) {
      const left = before[bucket];
      const setting = this.#settings.leftoverAtPayday[bucket];
      const questions = this.#book.reviewItems().filter((i) => i.type === 'leftover' && i.bucket === bucket);
      const asks = setting === 'ask' && left > 0;
      const question = questions[0];
      if (asks ? questions.length !== 1 || question?.type !== 'leftover' || question.amount !== left : questions.length !== 0) {
        throw new CheckFailed('3.4 the leftover question at payday', `${bucket} had ${left} left and is set to ${setting}; the questions are ${JSON.stringify(questions)}`);
      }
      if (asks && question !== undefined) this.#askedAtPayday.set(question.id, { asked: left, spentBefore: this.#spentBeforeFromList(bucket, date) });
    }
    this.#lastPaycheckDate = date;
    this.#paychecksSeen++;
    // 10.14: a paycheck from review (6.1) or from setting the paycheck rule
    // (13.2) was counted by an answer, whose step is already made: the payday
    // alert is due at it. One the bank sent is told at the next sync's step.
    if (how !== 'bank') this.#paydayAtTheAnswer();
    this.#periodSplit = this.#settings.split;
    this.#stats.paychecks++;
    const month = date.slice(0, 7);
    if (this.#book.paychecks().filter((p) => p.date.slice(0, 7) === month).length === 3) this.#stats.threePaycheckMonths++;
    // 3.8: the person moves what should be in savings, that evening or the
    // next day, keeping some money in checking. Money on its way counts as
    // moved (B46). When the account holds more than it should, there is
    // nothing to move and the extra is shown on its own; if checking is
    // low, the person brings some of it back.
    const move = (): void => {
      const pots = this.#book.pots();
      const onItsWay = this.#bank.halvesShowing().reduce((sum, h) => sum + (h.kind === 'transfer-sent' && h.to === 'savings' ? h.amount : 0), 0);
      // Her rulebook, 3.8: plus Wishlist, where the setup has it.
      const shouldBeInSavings = pots.savings + pots.momReserve + (pots.wishlist ?? 0);
      const savingsAccountBalance = this.#bank.posted.savings;
      const gap = shouldBeInSavings - (savingsAccountBalance + onItsWay);
      const expected = gap >= 0 ? { shouldBeInSavings, savingsAccountBalance, stillToMove: gap } : { shouldBeInSavings, savingsAccountBalance, stillToMove: 0, extraInSavings: -gap };
      const transfer = this.#book.savingsTransfer(savingsAccountBalance);
      if (!same(transfer, expected)) throw new CheckFailed('3.8 what still needs to move', `the app says ${JSON.stringify(transfer)}, expected ${JSON.stringify(expected)}`);
      const spare = this.#bank.posted.checking - 50_000;
      const extra = transfer.extraInSavings ?? 0;
      if (transfer.stillToMove > 0 && spare > 0) this.#moveBetweenOwn('checking', 'savings', Math.min(transfer.stillToMove, spare));
      else if (extra > 0 && this.#bank.posted.checking < 100_000 && savingsAccountBalance > 0) {
        this.#moveBetweenOwn('savings', 'checking', Math.min(extra, savingsAccountBalance));
      }
    };
    if (this.#random.chance(1, 3)) this.#laterOn(addDays(this.#date, 1), move);
    else this.#tonight.push(move);
  }

  #moveBetweenOwn(from: OwnAccount, to: OwnAccount, amount: Cents): void {
    this.#stats.savingsTransfers++;
    if (this.#random.chance(1, 2)) {
      this.#ownTransfer(() => this.#bank.transfer(this.#date, from, to, amount));
    } else {
      const left = this.#ownTransfer(() => this.#bank.send(this.#date, from, to, amount));
      this.#laterOn(addDays(this.#date, 1), () => this.#ownTransfer(() => this.#bank.land(this.#date, left, this.#random.chance(1, 2))));
    }
  }

  // 5.1 to 5.3: a transfer between your own accounts never changes a bucket,
  // except money leaving for the old card, which is spending from needs (5.2;
  // from savings it waits in review, QUESTIONS.md A4).
  #ownTransfer<T extends BankTransaction>(make: () => T): T {
    const before = this.#book.pots();
    const txn = make();
    this.#receive(txn);
    let change: Change = {};
    if ((txn.kind === 'transfer' || txn.kind === 'transfer-sent') && txn.to === 'old-card') {
      change = txn.from === 'checking' ? { needs: -txn.amount } : { unsortedOut: txn.amount };
    }
    this.#expectChange(before, change, '5.1 to 5.3 transfers between your own accounts', `${txn.kind} ${txn.id}`);
    return txn;
  }

  #shop(store: Store): void {
    const r = this.#random;
    const account: ChargeAccount = r.chance(store.debitOutOf10, 10) ? 'checking' : this.#card();
    const amount = r.int(store.min, store.max);
    this.#stats.purchases++;
    if (store.how === 'posted' || r.chance(1, 20)) {
      const id = this.#purchase(() => this.#bank.purchase(this.#date, account, amount, store.name), store);
      this.#maybeRefund(store, id, amount, account);
      return;
    }
    // Gas pumps often hold $100 and post the real amount later (4.6).
    const hold = store.how === 'gas' && r.chance(1, 2) ? 10_000 : amount;
    const finalAmount = amount + (store.tip ? share(amount, r.int(0, 22)) : 0);
    const id = this.#purchase(() => this.#bank.authorize(this.#date, account, hold, store.name), store);
    // A restaurant often adds the tip the next day, while the charge is still pending (A13).
    const changesFirst = finalAmount !== hold && store.tip === true && r.chance(1, 3);
    if (changesFirst) this.#laterOn(addDays(this.#date, 1), () => this.#changePending(id, finalAmount));
    this.#laterOn(addDays(this.#date, r.int(1, 4) + (changesFirst ? 1 : 0)), () => {
      // Some pumps drop the hold and post the real charge on its own (A2).
      if (hold !== finalAmount && store.how === 'gas' && r.chance(1, 5)) {
        this.#dropHold(id);
        this.#purchase(() => this.#bank.purchase(this.#date, account, finalAmount, store.name), store);
        return;
      }
      const posted = this.#post(id, finalAmount);
      this.#maybeRefund(store, posted, finalAmount, account);
    });
  }

  // QUESTIONS.md A2: the bank drops a pending charge without posting it, and
  // its money goes back where it came from.
  #dropHold(pendingId: string): void {
    const first = this.#firstId.get(pendingId) ?? pendingId;
    const standing = this.#standing.get(first);
    const hold = this.#bank.pendingCharges().find((c) => c.id === pendingId);
    if (hold === undefined) return;
    const before = this.#book.pots();
    const txn = this.#bank.drop(pendingId, this.#date);
    const outcome = this.#receive(txn);
    if (outcome !== 'dropped') throw new CheckFailed('4.6 a dropped pending charge (A2)', `${txn.id} came back as ${outcome}`);
    let change: Change = {};
    if (inABucket(standing)) change = { [standing]: hold.amount };
    else if (standing === 'unsorted') change = { unsortedOut: -hold.amount };
    else if (standing === 'split') change = { ...this.#splitParts.get(first) };
    this.#expectChange(before, change, '4.6 a dropped pending charge gives its money back (A2)', txn.id);
    this.#standing.set(first, 'unsorted');
    this.#stats.holdsDropped++;
  }

  // 4.1 to 4.3: a purchase comes out of the bucket its first matching rule
  // picks, on the day of the purchase; with no rule it waits in review.
  // The card a purchase goes on: the everyday card, or in her life either of
  // her two cards, half and half (her rulebook, section 1). Upstream's life
  // draws nothing here, so it lives exactly as it did.
  #card(): 'everyday-card' | 'second-card' {
    return this.#her && this.#random.chance(1, 2) ? 'second-card' : 'everyday-card';
  }

  #purchase(make: () => Purchase, store: Store | null): string {
    const before = this.#book.pots();
    const txn = make();
    if (txn.account === 'second-card') this.#stats.secondCardPurchases++;
    if (store) this.#intents.set(txn.id, { type: 'store', sorting: store.sorting, store: store.name });
    this.#receive(txn);
    const rule = this.#ruleFor('purchase', txn.description);
    const bucket = rule?.for === 'purchase' ? rule.bucket : null;
    this.#expectChange(before, bucket ? { [bucket]: -txn.amount } : { unsortedOut: txn.amount }, '4.1 to 4.3 a purchase is counted', txn.id);
    this.#standing.set(txn.id, bucket ?? 'unsorted');
    return txn.id;
  }

  // 4.6: the posted charge replaces the pending one, at whatever amount.
  #post(pendingId: string, amount: Cents): string {
    const first = this.#firstId.get(pendingId) ?? pendingId;
    const hold = this.#bank.pendingCharges().find((c) => c.id === pendingId);
    const before = this.#book.pots();
    const txn = this.#bank.post(pendingId, this.#date, amount);
    const intent = this.#intents.get(pendingId);
    if (intent) this.#intents.set(txn.id, intent);
    this.#firstId.set(txn.id, first);
    this.#receive(txn);
    this.#stats.postedFromPending++;
    const oldAmount = hold?.amount ?? amount;
    if (amount !== oldAmount) this.#stats.postedAtNewAmount++;
    this.#expectNewAmount(before, first, oldAmount, amount, '4.6 a posting replaces its pending charge', txn.id);
    return txn.id;
  }

  // QUESTIONS.md A13: the bank changes a pending charge's amount before it
  // posts, such as a tip added the next day.
  #changePending(pendingId: string, amount: Cents): void {
    const first = this.#firstId.get(pendingId) ?? pendingId;
    const hold = this.#bank.pendingCharges().find((c) => c.id === pendingId);
    if (hold === undefined) throw new Error(`the simulator's bank has no pending charge ${pendingId}`);
    const before = this.#book.pots();
    const txn = this.#bank.changePending(pendingId, this.#date, amount);
    const outcome = this.#receive(txn);
    if (outcome !== 'changed') throw new CheckFailed('4.6 a pending charge changes amount (A13)', `${txn.id} came back as ${outcome}`);
    this.#expectNewAmount(before, first, hold.amount, amount, '4.6 a pending charge changes amount (A13)', txn.id);
    this.#stats.pendingChanged++;
  }

  // 4.6 and A13: a pending charge's new amount, as it posts or while it is
  // still pending, replaces the old one and keeps its bucket. A split that
  // no longer adds up goes back to review, all of it (A1); a charge counted
  // on setup day leaves only the difference waiting (A10); on the old card
  // only the debt changes (B15).
  #expectNewAmount(before: Pots, first: string, oldAmount: Cents, newAmount: Cents, check: string, what: string): void {
    const difference = newAmount - oldAmount;
    const standing = this.#standing.get(first);
    if (inABucket(standing)) this.#expectChange(before, { [standing]: -difference }, check, what);
    else if (standing === 'unsorted') this.#expectChange(before, { unsortedOut: difference }, check, what);
    else if (standing === 'setup') this.#expectChange(before, { unsortedOut: difference }, '14.2 a charge pending on setup day leaves only the difference (A10)', what);
    else if (standing === 'old-card') this.#expectChange(before, {}, '5.4 old card purchases touch no bucket', what);
    else if (standing === 'split' && difference === 0) this.#expectChange(before, {}, check, what);
    else if (standing === 'split') {
      const parts = this.#splitParts.get(first);
      if (parts === undefined) throw new CheckFailed(check, `the simulator has no split for ${first}`);
      this.#expectChange(before, { ...parts, unsortedOut: newAmount }, '4.5 a split that no longer adds up goes back to review (A1)', what);
      this.#standing.set(first, 'unsorted');
    } else {
      throw new CheckFailed(check, `the simulator lost track of ${first} (${String(standing)})`);
    }
  }

  // Some things bought online come back, in full or in part, a week or two
  // later. Most refunds name their purchase; the rest wait in review (4.5).
  #maybeRefund(store: Store, purchaseId: string, amount: Cents, account: ChargeAccount): void {
    const r = this.#random;
    if (!store.refundsOutOf100 || !r.chance(store.refundsOutOf100, 100)) return;
    const back = r.chance(3, 5) ? amount : Math.max(1, share(amount, r.int(20, 80)));
    const linked = r.chance(17, 20);
    const bucket = store.sorting === 'wants' || store.sorting === 'wishlist' ? store.sorting : 'needs';
    const waitsForIt = this.#firstId.get(purchaseId) ?? purchaseId;
    if (linked && back === amount && this.#standing.get(waitsForIt) === 'unsorted' && r.chance(1, 2)) this.#awaitingReturn.add(waitsForIt);
    this.#laterOn(addDays(this.#date, r.int(5, 20)), () => {
      const first = this.#firstId.get(purchaseId) ?? purchaseId;
      this.#awaitingReturn.delete(first);
      const standing = this.#standing.get(first);
      const before = this.#book.pots();
      const txn = this.#bank.refund(this.#date, account, back, `${store.name} REFUND`, linked ? purchaseId : undefined);
      if (account === 'second-card') this.#stats.secondCardRefunds++;
      this.#intents.set(txn.id, { type: 'refund', bucket });
      const outcome = this.#receive(txn);
      if (!linked) {
        if (outcome !== 'review') throw new CheckFailed('4.5 a refund it cannot match waits in review', `${txn.id} came back as ${outcome}`);
        this.#expectChange(before, { unsortedIn: back }, '4.5 a refund it cannot match waits in review', txn.id);
        this.#stats.refundsInReview++;
        return;
      }
      this.#stats.refundsLinked++;
      // Back into the bucket the purchase came from; for one not sorted yet,
      // off the unsorted spending (B7). A full refund of a split purchase
      // gives each bucket its part back; a partial one sends the purchase
      // back to review to be split again (4.5, A1).
      if (standing === 'wishlist') this.#stats.wishlistRefunds++;
      if (inABucket(standing)) this.#expectChange(before, { [standing]: back }, '4.5 a refund goes back to its bucket', txn.id);
      else if (standing === 'unsorted') {
        this.#expectChange(before, { unsortedOut: -back }, '4.5 a refund of a purchase not sorted yet', txn.id);
        if (back === amount) this.#refundedInFull(first, txn);
      } else if (standing === 'split') {
        const parts = this.#splitParts.get(first);
        if (back === amount && parts) this.#expectChange(before, { ...parts }, '4.5 a full refund of a split purchase', txn.id);
        else this.#standing.set(first, 'unsorted');
      }
    });
  }

  // A26: a purchase waiting in review and refunded in full has nothing left
  // to sort. It leaves review by itself and is kept as a record. Now and then
  // the bank takes the refund back (4.10), and it comes back to be sorted.
  #refundedInFull(first: string, refund: Refund): void {
    if (this.#book.reviewItems().some((i) => i.id === first)) throw new CheckFailed('4.5 A26 a purchase refunded in full leaves review', `${first} still waits after ${refund.id}`);
    this.#standing.set(first, 'refunded');
    this.#stats.refundedInFullWhileWaiting++;
    // Her life (rarer refunds in full, as no mom payments are ever refunded) takes every one back.
    if (this.#her || this.#random.chance(1, 2)) this.#laterOn(addDays(this.#date, this.#random.int(1, 8)), () => this.#takeBackRefund(first, refund));
  }

  #takeBackRefund(first: string, refund: Refund): void {
    if (this.#standing.get(first) !== 'refunded') throw new CheckFailed('4.5 A26 a record refunded in full stays one', `${first} is ${String(this.#standing.get(first))}`);
    const before = this.#book.pots();
    const logBefore = this.#book.changeLog().length;
    const txn = this.#bank.takeBackRefund(this.#date, refund);
    const outcome = this.#receive(txn);
    if (outcome !== 'taken-back') throw new CheckFailed('4.10 the bank takes back a refund', `${txn.id} came back as ${outcome}`);
    this.#expectChange(before, { unsortedOut: refund.amount }, '4.10 A26 a refund taken back: its purchase waits in review again', txn.id);
    const item = this.#book.reviewItems().find((i) => i.id === first);
    if (item?.type !== 'spending' || item.amount !== refund.amount) throw new CheckFailed('4.10 A26 a refund taken back: its purchase waits in review again', `${first}: ${JSON.stringify(item)}`);
    const logged = { date: this.#date, kind: 'bank-took-back', id: refund.id, description: refund.description, amount: refund.amount };
    const log = this.#book.changeLog();
    if (log.length !== logBefore + 1 || !same(log.at(-1), logged)) throw new CheckFailed('13.5 a take-back is logged (A14)', `expected ${JSON.stringify(logged)}, the log ends with ${JSON.stringify(log.at(-1))}`);
    this.#tookBack.push({ id: refund.id, date: this.#date, description: refund.description, amount: refund.amount });
    this.#standing.set(first, 'unsorted');
    this.#stats.refundsTakenBack++;
  }

  #bill(name: string, amount: Cents, account: ChargeAccount): void {
    this.#stats.purchases++;
    this.#purchase(() => this.#bank.purchase(this.#date, account, amount, name), null);
  }

  // 7.4: a payment to a person goes to review unless a rule covers them,
  // whichever of your accounts it leaves (A16). A rule can say it is for mom
  // (7.6); then it comes out of the reserve as far as it goes, like one the
  // mom rule matches (8.1, 8.3).
  #payPerson(amount: Cents, payee: string, sorting: PersonSorting, from: OwnAccount = 'checking'): void {
    if (from === 'savings') this.#stats.personPaymentsFromSavings++;
    const before = this.#book.pots();
    const txn = this.#bank.payPerson(this.#date, amount, payee, from);
    this.#intents.set(txn.id, { type: 'person', sorting });
    this.#receive(txn);
    const rule = this.#ruleFor('person', txn.description);
    const to = rule?.for === 'person' ? rule.choice.to : null;
    let change: Change;
    if (to === null) change = { unsortedOut: amount };
    else if (to === 'not-mine') change = { heldForOthers: -amount };
    else if (to === 'mom') {
      const fromReserve = this.#forMomPayment(txn.id, txn.date, amount, before.momReserve);
      change = { momReserve: -fromReserve, unsortedOut: amount - fromReserve };
      this.#stats.paymentsForMom++;
    } else change = { [to]: -amount };
    this.#expectChange(before, change, '7.4 a payment to a person', txn.id);
    if (to === 'mom') this.#checkMomMonth(txn.date);
  }

  // 7.6: a payment for mom that the mom rule did not match. It takes what
  // the reserve has, up to its amount (8.3), counts toward its month (8.2),
  // and can be sorted another way later. Returns what the reserve gave.
  #forMomPayment(id: string, date: IsoDate, amount: Cents, reserve: Cents): Cents {
    const fromReserve = Math.min(amount, Math.max(0, reserve));
    this.#forMom.push({ id, date, amount, fromReserve });
    if (this.#forMom.length > 30) this.#forMom.shift();
    this.#addMomSent(date, amount);
    return fromReserve;
  }

  #addMomSent(date: IsoDate, amount: Cents): void {
    const month = date.slice(0, 7);
    this.#momSent.set(month, (this.#momSent.get(month) ?? 0) + amount);
  }

  // 8.2: everything sent to mom in a month, worked out here on its own.
  #checkMomMonth(date: IsoDate): void {
    const month = date.slice(0, 7);
    const sent = this.#momSent.get(month) ?? 0;
    const shown = this.#book.momSentInMonth(month).sent;
    if (shown !== sent) throw new CheckFailed('8.2 sent to mom this month', `${sent} sent in ${month}, the app shows ${shown}`);
  }

  // 8.1 to 8.3: one to three payments to mom a month, on random days, now
  // and then from savings (A16). Each comes out of the reserve as far as it
  // goes, and the rest waits in review.
  #planMomPayments(): void {
    const r = this.#random;
    for (let i = 0; i < this.#person.momTimesPerMonth; i++) {
      const amount = r.int(20_000, 150_000);
      const from: OwnAccount = r.chance(1, 6) ? 'savings' : 'checking';
      this.#laterOn(addDays(this.#date, r.int(0, 27)), () => this.#payMom(amount, from, true));
    }
  }

  // 8.1 and 8.3: a payment to mom, out of the reserve as far as it goes.
  // Now and then (not in a planned life) the mom rule was cleared first.
  #payMom(amount: Cents, from: OwnAccount, mayClearRule: boolean): void {
    const r = this.#random;
    this.#stats.momPayments++;
    if (from === 'savings') this.#stats.momFromSavings++;
    if (mayClearRule && this.#settings.momRule !== null && r.chance(1, 30)) {
      this.#clearRule('momRule');
      this.#laterOn(addDays(this.#date, r.int(1, 6)), () => this.#setMomRuleAgain());
    }
    const before = this.#book.pots();
    const txn = this.#bank.payPerson(this.#date, amount, MOM, from);
    this.#receive(txn);
    if (this.#settings.momRule === null) {
      this.#waitForMomRule(txn, before);
      return;
    }
    const fromReserve = Math.min(amount, Math.max(0, before.momReserve));
    if (fromReserve < amount) this.#stats.momDifferences++;
    this.#expectChange(before, { momReserve: -fromReserve, unsortedOut: amount - fromReserve }, '8.1 and 8.3 a payment to mom', txn.id);
    this.#addMomSent(txn.date, amount);
    this.#checkMomMonth(txn.date);
    this.#momRulePayments.push(txn.id);
    if (this.#momRulePayments.length > 20) this.#momRulePayments.shift();
  }

  // 4.9 (A16): a bill paid straight from savings waits in review, even one
  // a rule would sort if it came from checking.
  #billFromSavings(): void {
    const r = this.#random;
    this.#stats.savingsBills++;
    const before = this.#book.pots();
    const txn = this.#bank.payFromSavings(this.#date, r.int(5_000, 60_000), r.pick(['MADE UP INSURANCE', 'MADE UP UTILITY'] as const));
    this.#intents.set(txn.id, { type: 'from-savings', sorting: r.chance(4, 5) ? 'needs' : 'wants' });
    const outcome = this.#receive(txn);
    const item = this.#book.reviewItems().find((i) => i.id === txn.id);
    if (outcome !== 'review' || item?.type !== 'spending' || item.reason !== 'from-savings') {
      throw new CheckFailed('4.9 money leaving savings waits in review', `${txn.id} came back as ${outcome}: ${JSON.stringify(item)}`);
    }
    this.#expectChange(before, { unsortedOut: txn.amount }, '4.9 money leaving savings waits in review', txn.id);
  }

  // 5.6 (A12): now and then the bank shows a move between checking and
  // savings as spending on one account and a deposit on the other. Each
  // waits in review until the person marks it as a transfer between their
  // accounts, which they do as soon as it shows, the way a bank rule would
  // read it (so the bank connection's tests can read it with one). Then no
  // bucket changes (5.3), and it is in transit until its other half shows
  // (12.5).
  #misreadTransfer(): void {
    const r = this.#random;
    const from: OwnAccount = r.chance(2, 3) ? 'checking' : 'savings';
    const to: OwnAccount = from === 'checking' ? 'savings' : 'checking';
    const left = this.#bank.misreadSend(this.#date, from, to, r.int(5_000, 80_000));
    this.#markAsTransfer(left, to);
    const land = (): void => this.#markAsTransfer(this.#bank.misreadLand(this.#date, left), from);
    if (r.chance(1, 2)) land();
    else this.#laterOn(addDays(this.#date, r.int(1, 2)), land);
  }

  #markAsTransfer(txn: Purchase | SavingsWithdrawal | Deposit, other: OwnAccount): void {
    const r = this.#random;
    const before = this.#book.pots();
    this.#notMarkedYet.add(txn.id);
    const outcome = this.#receive(txn);
    const item = this.#book.reviewItems().find((i) => i.id === txn.id);
    const reason = txn.kind === 'deposit' ? 'deposit' : txn.kind === 'savings-withdrawal' ? 'from-savings' : 'no-rule';
    if (outcome !== 'review' || item === undefined || !('reason' in item) || item.reason !== reason) {
      throw new CheckFailed('5.6 a transfer shown as something else waits in review', `${txn.id} came back as ${outcome}: ${JSON.stringify(item)}`);
    }
    this.#expectChange(before, txn.kind === 'deposit' ? { unsortedIn: txn.amount } : { unsortedOut: txn.amount }, '5.6 a transfer shown as something else waits in review', txn.id);
    // Now and then a slip first: the account it is already in, or a card
    // for money that arrived.
    if (r.chance(1, 10)) {
      const wrong = txn.kind === 'deposit' && r.chance(1, 2) ? 'everyday-card' : txn.account;
      this.#expectRefused(() => this.#book.sort(txn.id, { transfer: wrong }, this.#date), this.#book.pots(), txn.id, `marking ${txn.id} as a transfer with ${wrong} (5.6)`);
    }
    this.#book.sort(txn.id, { transfer: other }, this.#date);
    this.#notMarkedYet.delete(txn.id);
    this.#note(`mark ${txn.id} as a transfer with ${other}`);
    this.#expectChange(before, {}, '5.6 a transfer between your accounts changes no bucket', txn.id);
    if (this.#book.reviewItems().some((i) => i.id === txn.id)) throw new CheckFailed('5.6 a marked transfer leaves review', txn.id);
    this.#stats.transfersMarked++;
  }

  // 4.10 (A14): now and then the bank charges a recent purchase twice, and a
  // few days later takes the copy back. The copy counts like any purchase.
  #chargeTwice(): void {
    const r = this.#random;
    const recent = this.#sent
      .slice(-60)
      .filter((t): t is Purchase => t.kind === 'purchase' && !t.pending && (t.account === 'checking' || t.account === 'everyday-card' || t.account === 'second-card') && STORES.some((s) => s.name === t.description));
    if (recent.length === 0) return;
    const first = r.pick(recent);
    const copy = this.#bank.chargeTwice(this.#date, first);
    this.#purchase(() => copy, STORES.find((s) => s.name === first.description) ?? null);
    this.#laterOn(addDays(this.#date, r.int(1, 6)), () => this.#takeBackCopy(copy));
  }

  // 4.10: taken back, the copy's money goes back where it came from, the
  // change is logged (13.5), and an alert says so, once (10.6).
  #takeBackCopy(copy: Purchase): void {
    const standing = this.#standing.get(copy.id);
    const before = this.#book.pots();
    const logBefore = this.#book.changeLog().length;
    const txn = this.#bank.takeBack(this.#date, copy);
    const outcome = this.#receive(txn);
    if (outcome !== 'taken-back') throw new CheckFailed('4.10 the bank takes back a charge (A14)', `${txn.id} came back as ${outcome}`);
    let change: Change;
    if (inABucket(standing)) change = { [standing]: copy.amount };
    else if (standing === 'unsorted') change = { unsortedOut: -copy.amount };
    else if (standing === 'split') change = { ...this.#splitParts.get(copy.id) };
    else throw new CheckFailed('4.10 the bank takes back a charge (A14)', `the simulator did not expect the copy ${copy.id} to be ${String(standing)}`);
    this.#expectChange(before, change, '4.10 a charge taken back gives its money back (A14)', txn.id);
    const log = this.#book.changeLog();
    const logged = { date: this.#date, kind: 'bank-took-back', id: copy.id, description: copy.description, amount: copy.amount };
    if (log.length !== logBefore + 1 || !same(log.at(-1), logged)) throw new CheckFailed('13.5 a take-back is logged (A14)', `expected ${JSON.stringify(logged)}, the log ends with ${JSON.stringify(log.at(-1))}`);
    if (this.#book.reviewItems().some((i) => i.id === copy.id)) throw new CheckFailed('4.10 nothing taken back waits in review', copy.id);
    this.#tookBack.push({ id: copy.id, date: this.#date, description: copy.description, amount: copy.amount });
    this.#standing.set(copy.id, 'gone');
    this.#stats.takenBack++;
    // Sorting it now is refused, which the person now and then tries.
    if (this.#random.chance(1, 5)) this.#expectRefused(() => this.#book.sort(copy.id, { to: 'needs' }, this.#date), this.#book.pots(), null, `sorting ${copy.id}, which the bank took back (4.10)`);
  }

  // Paying for a friend is not your spending (7.2); they pay you back later (7.1).
  #payForFriend(): void {
    const r = this.#random;
    const amount = r.int(2_000, 20_000);
    this.#stats.paidForFriends++;
    this.#payPerson(amount, 'MADE UP FRIEND', 'not-mine');
    this.#laterOn(addDays(this.#date, r.int(3, 20)), () => {
      this.#stats.friendsPaidBack++;
      this.#deposit('checking', amount, 'ZELLE FROM MADE UP FRIEND', 'not-mine');
    });
  }

  // 6.1 and 6.2: a deposit goes where a rule for its source says, or waits in review.
  #deposit(account: OwnAccount, amount: Cents, description: string, choice: 'other-income' | 'not-mine' | 'needs' | 'wants' | null): void {
    const before = this.#book.pots();
    const txn = this.#bank.deposit(this.#date, account, amount, description);
    if (choice) this.#intents.set(txn.id, { type: 'money-in', choice });
    this.#receive(txn);
    const rule = this.#ruleFor('deposit', description);
    const to = rule?.for === 'deposit' ? rule.choice.to : null;
    const change: Change = to === null ? { unsortedIn: amount } : to === 'other-income' ? this.#otherIncome(amount) : to === 'not-mine' ? { heldForOthers: amount } : { [to]: amount };
    this.#expectChange(before, change, '6.1 and 6.2 a deposit', txn.id);
  }

  // 6.1: other income is split by this pay period's percentages (B38), with
  // no mom reserve.
  #otherIncome(amount: Cents): Change {
    const needs = share(amount, this.#periodSplit.needs);
    const wants = share(amount, this.#periodSplit.wants);
    // Her rulebook, 6.1: and Wishlist's share, where the split names it.
    if (this.#periodSplit.wishlist === undefined) return { needs, wants, savings: amount - needs - wants };
    const wishlist = share(amount, this.#periodSplit.wishlist);
    return { needs, wants, wishlist, savings: amount - needs - wants - wishlist };
  }

  // 5.4: a new purchase on the old card raises the debt and is only a flag to see.
  #oldCardPurchase(): void {
    const r = this.#random;
    this.#stats.oldCardPurchases++;
    const before = this.#book.pots();
    const txn = this.#bank.authorize(this.#date, 'old-card', r.int(1_000, 6_000), 'MADE UP CAFE');
    this.#receive(txn);
    this.#expectChange(before, {}, '5.4 old card purchases touch no bucket', txn.id);
    if (!this.#book.reviewItems().some((i) => i.type === 'old-card-purchase' && i.id === txn.id)) {
      throw new CheckFailed('5.4 a new old card purchase is flagged', `${txn.id} is not flagged`);
    }
    this.#standing.set(txn.id, 'old-card');
    // It may post at a new amount; only the debt changes (B15).
    this.#laterOn(addDays(this.#date, r.int(1, 3)), () => this.#post(txn.id, txn.amount + (r.chance(1, 3) ? r.int(1, 500) : 0)));
  }

  // B13: a refund on the old card lowers the debt and touches no bucket.
  #oldCardRefund(): void {
    this.#stats.oldCardRefunds++;
    const before = this.#book.pots();
    const txn = this.#bank.refund(this.#date, 'old-card', this.#random.int(500, 5_000), 'MADE UP STORE REFUND');
    this.#receive(txn);
    this.#expectChange(before, {}, 'B13 an old card refund touches no bucket', txn.id);
  }

  // The bank sometimes sends something it already sent. Nothing changes.
  #sendDuplicate(): void {
    const recent = this.#sent.slice(-40);
    if (recent.length === 0) return;
    const txn = this.#random.pick(recent);
    const before = this.#book.pots();
    const { outcome } = this.#book.receive(txn);
    this.#stats.duplicatesSent++;
    if (outcome !== 'duplicate') throw new CheckFailed('nothing is counted twice', `${txn.id} sent again came back as ${outcome}`);
    this.#expectChange(before, {}, 'nothing is counted twice', `${txn.id} sent again`);
  }

  // A card's closing day: interest if the last statement was not paid in
  // full, the new statement, the person's plan for paying it, and checks on
  // the reminder days, the due date, and the day after it.
  #closeStatement(card: Card): void {
    const r = this.#random;
    const last = this.#statements.filter((s) => s.card === card).at(-1);
    if (last && card !== 'old-card') {
      const unpaid = last.statementBalance - this.#paidToward(last, last.dueDate);
      if (unpaid > 0) this.#cardCharge(card, 'interest', Math.max(1, share(unpaid, 2)));
    }
    if (card === 'old-card' && r.chance(1, 4)) this.#cardCharge(card, 'interest', r.int(500, 4_000));
    const statement = this.#bank.closeStatement(card, this.#date);
    this.#statements.push(statement);
    const { closingDate, dueDate, statementBalance: balance, minimumPayment: minimum } = statement;
    // 9.1 to 9.4 are checked each evening against the latest statement of each
    // card (#eveningPoint); the bank charges a late fee the day after the due
    // date if the minimum is not paid.
    this.#statementsToday.push(statement);
    this.#latestStatement[card] = statement;
    this.#laterOn(addDays(dueDate, 1), () => this.#dueDatePassed(statement));
    if (balance <= 0) return;
    const before = (days: number): IsoDate => addDays(dueDate, -days);
    const after = (days: number): IsoDate => addDays(dueDate, days);
    const plan = r.int(1, 100);
    if (card !== 'old-card') {
      // Her life pays her cards from savings now and then (5.1); upstream's
      // always from checking, and draws nothing for it.
      const from: OwnAccount = this.#her && r.chance(1, 6) ? 'savings' : 'checking';
      if (plan <= 70) {
        this.#planCardPayment(card, from, balance, before(r.int(1, 8)));
      } else if (plan <= 78) {
        this.#planCardPayment(card, from, minimum, before(r.int(1, 8)));
      } else if (plan <= 90) {
        const first = Math.max(1, share(balance, r.int(30, 70)));
        if (balance > first && first * 2 !== balance && r.chance(1, 3)) {
          this.#laterOn(this.#notBeforeTomorrow(before(r.int(3, 8))), () => this.#payTwoAtOnce(card, first, balance - first, from));
        } else {
          this.#planCardPayment(card, from, first, addDays(closingDate, r.int(3, 10)));
          if (balance > first) this.#planCardPayment(card, from, balance - first, before(r.int(1, 5)));
        }
      } else if (plan <= 95 || minimum <= 1) {
        this.#stats.lateCardPayments++;
        this.#planCardPayment(card, from, balance, after(r.int(1, 5)));
      } else {
        // Less than the minimum before the due date, the rest after it (A6).
        const short = r.int(1, minimum - 1);
        this.#stats.lateCardPayments++;
        this.#planCardPayment(card, from, short, before(r.int(1, 5)));
        this.#planCardPayment(card, from, balance - short, after(r.int(1, 5)));
      }
    } else {
      const amount = Math.min(balance, minimum + r.int(0, 40_000));
      if (plan <= 85) {
        this.#planCardPayment(card, 'checking', amount, before(r.int(2, 10)));
      } else if (plan <= 90) {
        this.#stats.oldCardFromSavings++;
        this.#planCardPayment(card, 'savings', amount, before(r.int(2, 10)));
      } else if (plan <= 95 && minimum > 1) {
        const short = r.int(1, minimum - 1);
        this.#stats.lateCardPayments++;
        this.#planCardPayment(card, 'checking', short, before(r.int(2, 10)));
        this.#planCardPayment(card, 'checking', amount - short, after(r.int(1, 6)));
      } else {
        this.#stats.lateCardPayments++;
        this.#planCardPayment(card, 'checking', amount, after(r.int(1, 6)));
      }
    }
  }

  #countCardPayment(card: Card, from: OwnAccount): void {
    if (card === 'old-card') this.#stats.oldCardPayments++;
    else this.#stats.everydayCardPayments++;
    if (card === 'second-card') this.#stats.secondCardPayments++;
    if (card !== 'old-card' && from === 'savings') this.#stats.cardPaymentsFromSavings++;
  }

  #notBeforeTomorrow(on: IsoDate): IsoDate {
    return daysBetween(this.#date, on) < 1 ? addDays(this.#date, 1) : on;
  }

  #planCardPayment(card: Card, from: OwnAccount, amount: Cents, on: IsoDate): void {
    if (amount <= 0) return;
    this.#laterOn(this.#notBeforeTomorrow(on), () => this.#payCard(card, from, amount));
  }

  // A card payment: usually it leaves checking and lands on the card one to
  // three days later (12.5); sometimes the same day; sometimes the card shows
  // it before checking does.
  #payCard(card: Card, from: OwnAccount, amount: Cents): void {
    const r = this.#random;
    this.#countCardPayment(card, from);
    const seen: CardPaymentSeen = { left: null, landed: null, amount };
    this.#cardPayments[card].push(seen);
    const how = r.int(1, 100);
    if (how <= 20) {
      this.#ownTransfer(() => this.#bank.transfer(this.#date, from, card, amount));
      seen.left = this.#date;
      seen.landed = this.#date;
    } else if (how <= 92) {
      this.#stats.paymentsInTransit++;
      if (card === 'second-card') this.#stats.secondCardPaymentsInTransit++;
      const left = this.#ownTransfer(() => this.#bank.send(this.#date, from, card, amount));
      seen.left = this.#date;
      this.#laterOn(addDays(this.#date, r.int(1, 3)), () => {
        this.#ownTransfer(() => this.#bank.land(this.#date, left, r.chance(7, 10)));
        seen.landed = this.#date;
      });
    } else {
      this.#stats.paymentsLandedFirst++;
      const landed = this.#ownTransfer(() => this.#bank.landFirst(this.#date, from, card, amount));
      seen.landed = this.#date;
      this.#laterOn(addDays(this.#date, r.int(1, 2)), () => {
        this.#ownTransfer(() => this.#bank.sendAfter(this.#date, landed));
        seen.left = this.#date;
      });
    }
  }

  // Two payments of different amounts leave the same day and land out of
  // order, neither naming the other half, so the book has to pair each
  // landing by its amount (12.5, B45).
  #payTwoAtOnce(card: Card, first: Cents, second: Cents, from: OwnAccount = 'checking'): void {
    this.#stats.paymentsInTransit += 2;
    this.#stats.paymentsLandedOutOfOrder++;
    const halves: { left: TransferSent; seen: CardPaymentSeen }[] = [first, second].map((amount) => {
      this.#countCardPayment(card, from);
      if (card === 'second-card') this.#stats.secondCardPaymentsInTransit++;
      const seen: CardPaymentSeen = { left: this.#date, landed: null, amount };
      this.#cardPayments[card].push(seen);
      return { left: this.#ownTransfer(() => this.#bank.send(this.#date, from, card, amount)), seen };
    });
    halves.reverse().forEach(({ left, seen }, i) => {
      this.#laterOn(addDays(this.#date, i + 1), () => {
        this.#ownTransfer(() => this.#bank.land(this.#date, left, false));
        seen.landed = this.#date;
      });
    });
  }

  // What the person has paid toward a statement, as of a day: payments that
  // reached the card after the closing date (or are still on their way), and
  // that have shown leaving by that day (B47), or shown landing when the card
  // saw them first.
  #paidToward(statement: CardStatement, asOf: IsoDate): Cents {
    let paid = 0;
    for (const p of this.#cardPayments[statement.card]) {
      const shown = p.left ?? p.landed;
      if (shown === null || daysBetween(shown, asOf) < 0) continue;
      if (p.landed !== null && daysBetween(statement.closingDate, p.landed) <= 0) continue;
      paid += p.amount;
    }
    return paid;
  }

  // 9.1 to 9.4, each evening, for the latest statement of a card: a reminder
  // on the reminder days while not enough is paid (the full statement balance
  // on the everyday card, the minimum on the old card; never one with nothing
  // owed, B29), and the overdue alert on every day after the due date while
  // the payments since the statement add up to less than the minimum (B30),
  // none on the due date itself. Checked against the money math, and returned
  // as the alerts the server should send that evening.
  #cardAlerts(statement: CardStatement): ExpectedAlert[] {
    const { card, dueDate, statementBalance, minimumPayment } = statement;
    const daysLeft = daysBetween(this.#date, dueDate);
    const paid = this.#paidToward(statement, this.#date);
    // Her second card: like the everyday card (her rulebook, 9.1 and 9.3).
    const owed = card !== 'old-card' ? statementBalance : minimumPayment;
    const expected: CardNotice[] = [];
    if (daysLeft < 0 && paid < minimumPayment) expected.push({ kind: 'overdue', card, dueDate, minimumPayment });
    const remind = daysLeft >= 0 && this.#settings.cardReminderDaysBefore.includes(daysLeft) && owed > 0 && paid < owed;
    if (remind && card !== 'old-card') expected.push({ kind: 'reminder', card, daysBefore: daysLeft, dueDate, statementBalance, minimumPayment });
    if (remind && card === 'old-card') expected.push({ kind: 'reminder', card, daysBefore: daysLeft, dueDate, minimumPayment });
    this.#stats.remindersChecked++;
    if (card === 'second-card') this.#stats.secondCardRemindersChecked++;
    const notices = cardNotices(this.#date, statement, this.#book.cardPayments(statement.card), this.#book.settings());
    if (!same(notices, expected)) {
      throw new CheckFailed(daysLeft < 0 ? '9.4 the overdue alert' : '9.1 to 9.3 card reminders', `${statement.card} closed ${statement.closingDate}, due ${statement.dueDate}, paid ${paid}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(notices)}`);
    }
    if (expected.some((n) => n.kind === 'overdue')) this.#stats.overdueAlerts++;
    return expected.map(
      (n): ExpectedAlert =>
        n.kind === 'overdue'
          ? { kind: 'card-overdue', card, dueDate, minimumPayment }
          : { kind: 'card-reminder', card, dueDate, daysBefore: n.daysBefore, minimumPayment, statementBalance: n.card !== 'old-card' ? n.statementBalance : null },
    );
  }

  // 9.4: the day after the due date the bank charges a late fee if the
  // payments since the statement add up to less than the minimum.
  #dueDatePassed(statement: CardStatement): void {
    if (this.#paidToward(statement, this.#date) < statement.minimumPayment) this.#cardCharge(statement.card, 'fee', 2_900);
  }

  // 4.8 and 5.5: fees and interest on the everyday card wait in review with
  // needs suggested; on the old card they only raise the debt.
  #cardCharge(card: Card, charge: 'fee' | 'interest', amount: Cents): void {
    if (charge === 'fee') this.#stats.cardFees++;
    else this.#stats.cardInterest++;
    if (card === 'second-card') this.#stats.secondCardFees++;
    const before = this.#book.pots();
    const txn = this.#bank.cardCharge(this.#date, card, charge, amount);
    this.#receive(txn);
    if (card === 'old-card') {
      this.#expectChange(before, {}, '5.5 old card fees and interest', txn.id);
      return;
    }
    this.#expectChange(before, { unsortedOut: amount }, '4.8 card fees and interest wait in review', txn.id);
    const item = this.#book.reviewItems().find((i) => i.id === txn.id);
    if (item?.type !== 'spending' || item.suggestion !== 'needs') throw new CheckFailed('4.8 needs is suggested for card fees', JSON.stringify(item));
  }

  #receive(txn: BankTransaction): string {
    const { outcome } = this.#book.receive(txn);
    this.#sent.push(txn);
    const about = 'takenId' in txn ? txn.takenId : 'pendingId' in txn ? txn.pendingId : '';
    this.#note(`receive ${txn.kind} ${txn.id} ${'amount' in txn ? txn.amount : `for ${about}`}${'account' in txn ? ` ${txn.account}` : ''}${'to' in txn ? ` ${txn.from}->${txn.to}` : ''} "${txn.description}": ${outcome}`);
    return outcome;
  }

  // 4.2 and B9: the first rule in the list whose text the description contains.
  #ruleFor(kind: SortingRule['for'], description: string): SortingRule | undefined {
    const text = description.toLowerCase();
    return this.#rules.find((rule) => rule.for === kind && text.includes(rule.contains.toLowerCase()));
  }

  // A settings change, as the real server lives it: the bank's activity so
  // far is one sync, its alerts worked out under the settings as they were;
  // then the simulator's own record changes with the book's, so the alerts
  // due right after the change are worked out under the new ones (a higher
  // low alert level makes a bucket low at once: 10.1, 13.1). Every settings
  // change in the simulator goes through here.
  #changeSettings(patch: Partial<Settings>): ReturnType<Book['changeSettings']> {
    this.#syncPoint();
    const before = this.#settings;
    this.#settings = { ...before, ...patch };
    try {
      return this.#book.changeSettings(patch, this.#date);
    } catch (error) {
      this.#settings = before;
      throw error;
    }
  }

  // ---- The mom rule and the paycheck rule, cleared and set again (13.2, A9)

  // Clearing a rule sorts nothing: the preview says so, and nothing changes.
  #clearRule(key: 'momRule' | 'paycheckRule'): void {
    const before = this.#book.pots();
    const logBefore = this.#book.changeLog().length;
    const preview = this.#book.previewSettingsChange({ [key]: null }, this.#date);
    if (preview.items.length !== 0 || !same(preview.potsAfter, before)) throw new CheckFailed('13.2 A9 clearing a rule sorts nothing', JSON.stringify(preview));
    const { rechecked } = this.#changeSettings({ [key]: null });
    if (rechecked.length !== 0) throw new CheckFailed('13.2 A9 clearing a rule sorts nothing', JSON.stringify(rechecked));
    this.#expectChange(before, {}, '13.2 A9 clearing a rule sorts nothing', key);
    if (this.#book.changeLog().length !== logBefore + 1) throw new CheckFailed('13.5 every change is logged', `clearing ${key} was not logged`);
    this.#note(`${key} cleared`);
  }

  // A payment to mom while the mom rule is cleared waits in review like any
  // payment to a person (7.4). Now and then the bank refunds part of it, or
  // all of it, before the rule is set again.
  #waitForMomRule(txn: PersonPayment, before: Pots): void {
    this.#expectChange(before, { unsortedOut: txn.amount }, '7.4 with no mom rule, a payment to mom waits in review', txn.id);
    const waiting = { txn, refunded: 0 };
    this.#waitingForMomRule.push(waiting);
    if (txn.account !== 'checking' || !this.#random.chance(1, 2)) return;
    const back = this.#random.chance(1, 4) ? txn.amount : this.#random.int(1, txn.amount - 1);
    // Right away, so it always comes before the rule is set again (that can be later the same day).
    {
      const ahead = this.#book.pots();
      const refund = this.#bank.refund(this.#date, 'checking', back, 'ZELLE RETURNED', txn.id);
      const outcome = this.#receive(refund);
      if (outcome !== 'sorted') throw new CheckFailed('4.5 a refund of a payment waiting in review', `${refund.id} came back as ${outcome}`);
      this.#expectChange(ahead, { unsortedOut: -back }, '4.5 a refund of a payment waiting in review', refund.id);
      waiting.refunded += back;
      // A26: refunded in full, nothing is left to sort, so it leaves review.
      const stillWaits = this.#book.reviewItems().some((i) => i.id === txn.id);
      if (stillWaits !== (back < txn.amount)) throw new CheckFailed('4.5 A26 a payment refunded in full leaves review, one refunded in part waits', `${txn.id}, ${back} of ${txn.amount} back`);
      this.#stats.momPaymentsRefundedWhileWaiting++;
    }
  }

  // The mom rule is set again. Worked out here from the rulebook, before the
  // book is asked: the waiting payments to mom, oldest first, each come out
  // of the reserve as far as it goes, the rest waiting (8.1, 8.3); one partly
  // or fully refunded cannot be for mom and stays waiting exactly as it was
  // (13.2, B73). The preview must say exactly that, and the change do it.
  #setMomRuleAgain(): void {
    if (this.#settings.momRule !== null) return;
    const before = this.#book.pots();
    const patch = { momRule: { contains: MOM } };
    let reserve = before.momReserve;
    // A26: one refunded in full is not waiting any more, so the rule does not see it.
    const waitingNow = [...this.#momLeftWaiting, ...this.#waitingForMomRule.filter(({ txn, refunded }) => refunded < txn.amount)];
    const expected: RecheckedItem[] = waitingNow.map(({ txn, refunded }) => {
      const { id, date, amount, description } = txn;
      if (refunded > 0) return { kind: 'still-waiting', id, date, amount: amount - refunded, description, why: 'partly-refunded' };
      const fromReserve = Math.min(amount, Math.max(0, reserve));
      reserve -= fromReserve;
      return { kind: 'mom', id, date, amount, description, fromReserve, difference: amount - fromReserve };
    });
    const preview = this.#book.previewSettingsChange(patch, this.#date);
    if (!same(preview.items, expected)) throw new CheckFailed('13.2 A9 what setting the mom rule would do', `expected ${JSON.stringify(expected)}, the preview says ${JSON.stringify(preview.items)}`);
    const { rechecked } = this.#changeSettings(patch);
    if (!same(rechecked, preview.items) || !same(this.#book.pots(), preview.potsAfter)) throw new CheckFailed('13.2 A9 the change is what the preview said', JSON.stringify({ rechecked, after: this.#book.pots(), preview }));
    const taken = expected.reduce((sum, item) => sum + (item.kind === 'mom' ? item.fromReserve : 0), 0);
    this.#expectChange(before, { momReserve: -taken, unsortedOut: -taken }, '13.2 A9 8.1 setting the mom rule', `${expected.length} waiting`);
    for (const { txn, refunded } of this.#waitingForMomRule) {
      if (refunded > 0) {
        // Still the person's to sort, from what is left of it.
        this.#intents.set(txn.id, { type: 'person', sorting: 'needs' });
        continue;
      }
      if (expected.some((i) => i.id === txn.id && i.kind === 'mom' && i.difference > 0)) this.#stats.momDifferences++;
      this.#addMomSent(txn.date, txn.amount);
      this.#momRulePayments.push(txn.id);
      if (this.#momRulePayments.length > 20) this.#momRulePayments.shift();
    }
    // 8.2: each month the rule took payments from, once all are added.
    for (const { txn } of this.#waitingForMomRule) this.#checkMomMonth(txn.date);
    this.#waitingForMomRule.length = 0;
    this.#momLeftWaiting = waitingNow.filter(({ refunded }) => refunded > 0);
    this.#stats.momRuleSetWhileWaiting++;
    this.#note(`mom rule set again: ${JSON.stringify(expected.map((i) => [i.id, i.kind]))}`);
  }

  // The paycheck rule is set again, the evening the paycheck came in. The
  // waiting paycheck becomes the paycheck, dated the day it came (B53), split
  // as any paycheck is (3.2, 3.3), with the leftover questions about what the
  // buckets hold now.
  #setPaycheckRuleAgain(txn: Deposit): void {
    const before = this.#book.pots();
    const asked = this.#openLeftovers();
    const patch = { paycheckRule: { contains: PAYROLL } };
    const preview = this.#book.previewSettingsChange(patch, this.#date);
    const first = preview.items[0];
    // Her rulebook, 13.2: while asking, it becomes a paycheck waiting for her
    // yes, showing what it would get, and nothing is split.
    if (this.#settings.askBeforeSplittingPaycheck === true) {
      const wouldGet = this.#expectedSplit(txn.amount, before.momReserve);
      const got = first?.kind === 'paycheck-waiting' ? first.wouldGet : null;
      if (preview.items.length !== 1 || first?.kind !== 'paycheck-waiting' || first.id !== txn.id || first.amount !== txn.amount || first.date !== txn.date || got === null || !same(partsOf(got), wouldGet)) {
        throw new CheckFailed('13.2 with asking on, setting the paycheck rule makes it a paycheck waiting for her yes', `${txn.id} waits; the preview says ${JSON.stringify(preview.items)}`);
      }
      const { rechecked } = this.#changeSettings(patch);
      if (!same(rechecked, preview.items) || !same(this.#book.pots(), preview.potsAfter)) throw new CheckFailed('13.2 A9 the change is what the preview said', JSON.stringify({ rechecked, preview }));
      this.#expectChange(before, {}, '13.2 with asking on, setting the paycheck rule splits nothing', txn.id);
      this.#paycheckWaitingForRule = null;
      this.#waitingForYes.set(txn.id, txn.date);
      this.#stats.paycheckRuleSetWhileWaiting++;
      this.#note(`paycheck rule set again: ${txn.id} waits for her yes`);
      return;
    }
    if (preview.items.length !== 1 || first?.kind !== 'paycheck' || first.id !== txn.id || first.amount !== txn.amount || first.date !== txn.date) {
      throw new CheckFailed('13.2 A9 what setting the paycheck rule would do', `${txn.id} waits; the preview says ${JSON.stringify(preview.items)}`);
    }
    const expectedSplit = this.#expectedSplit(txn.amount, before.momReserve);
    if (!same(partsOf(first.split), expectedSplit)) {
      throw new CheckFailed('13.2 A9 3.2 3.3 the paycheck the rule would make', `expected ${JSON.stringify(expectedSplit)}, the preview says ${JSON.stringify(first.split)}`);
    }
    const { rechecked } = this.#changeSettings(patch);
    if (!same(rechecked, preview.items) || !same(this.#book.pots(), preview.potsAfter)) throw new CheckFailed('13.2 A9 the change is what the preview said', JSON.stringify({ rechecked, preview }));
    this.#paycheckWaitingForRule = null;
    this.#onPaycheck(before, asked, txn.amount, txn.date, 'review');
    this.#stats.paycheckRuleSetWhileWaiting++;
    this.#note(`paycheck rule set again: ${txn.id} is the paycheck`);
  }

  // ---- The person's evening ---------------------------------------------

  #evening(): void {
    const r = this.#random;
    for (const action of this.#tonight.splice(0)) action();
    if (this.#plan !== undefined) {
      // As planned: the planned answers, then everything waiting in review,
      // then the answers planned for after it.
      const answers = this.#plan.answers[this.#date] ?? [];
      for (const answer of answers) if (answer.afterReview !== true) this.#answerAsPlanned(answer);
      for (const item of this.#book.reviewItems()) this.#handle(item);
      for (const answer of answers) if (answer.afterReview === true) this.#answerAsPlanned(answer);
      return;
    }
    this.#maybeChangeSettings();
    // Most evenings the person goes through what is waiting.
    if (r.chance(17, 20)) {
      for (const item of this.#book.reviewItems()) {
        this.#handle(item);
        if (!this.#book.reviewItems().some((i) => i.id === item.id)) this.#momLeftWaiting = this.#momLeftWaiting.filter((w) => w.txn.id !== item.id);
      }
    }
    if (this.#her) this.#myPaycheckAfterAll();
    if (r.chance(1, 40)) this.#resort();
    if (!this.#her && r.chance(1, 150)) this.#notForMom();
    this.#handMoves();
    if (this.#her) this.#offInHerSetup();
  }

  #handle(item: ReviewItem): void {
    const r = this.#random;
    const today = this.#date;
    // Earlier answers can sort later items (a new rule, a paycheck), so skip
    // anything no longer waiting.
    if (!this.#book.reviewItems().some((i) => i.id === item.id)) return;
    // What waits for the mom rule or the paycheck rule to be set again waits for it.
    if (item.id === this.#paycheckWaitingForRule || this.#waitingForMomRule.some((w) => w.txn.id === item.id)) return;
    // What is going back to the store waits for its refund (A26).
    if (this.#awaitingReturn.has(item.id)) return;
    // In a planned life, what the person leaves in review until a day.
    const sortOn = this.#sortOn.get(this.#firstId.get(item.id) ?? item.id);
    if (sortOn !== undefined && daysBetween(sortOn, today) < 0) return;
    const before = this.#book.pots();
    switch (item.type) {
      case 'leftover': {
        // In a planned life, the payday questions are answered as planned.
        if (this.#plan !== undefined) return;
        let plan = this.#leftoverPlans.get(item.id);
        if (plan === undefined) {
          const when = r.int(1, 100);
          plan = { on: when <= 60 ? today : when <= 95 ? addDays(today, r.int(1, 3)) : null, answer: r.chance(3, 5) ? 'roll-over' : 'move-to-savings' };
          this.#leftoverPlans.set(item.id, plan);
        }
        if (plan.on === null || daysBetween(plan.on, today) < 0) return;
        this.#answerLeftover(item, plan.answer, before);
        return;
      }
      case 'old-card-purchase':
        this.#book.acknowledge(item.id, today);
        this.#note(`acknowledge ${item.id}`);
        this.#expectChange(before, {}, '5.4 seeing the flag moves nothing', item.id);
        if (this.#book.reviewItems().some((i) => i.id === item.id)) throw new CheckFailed('5.4 seeing the flag clears it', `${item.id} is still waiting`);
        return;
      case 'money-in': {
        // In a planned life, a refund the bank did not match, matched by hand.
        if (this.#refundOf.has(item.id)) {
          this.#tryMistake(item, before);
          this.#matchRefund(item, before);
          return;
        }
        let choice = this.#moneyInChoice(item);
        const meant = choice;
        if (choice === 'paycheck' && this.#her) {
          const hers = this.#herAnswer(item, before);
          if (hers === null) return;
          choice = hers;
        } else if (choice === 'paycheck') {
          // Now and then the person leaves an early paycheck for a while. By
          // then a newer paycheck may have come, and this one can no longer
          // start a pay period (B54), so it becomes other income.
          let on = this.#waitUntil.get(item.id);
          if (on === undefined) {
            on = r.chance(1, 4) ? addDays(today, r.int(1, 20)) : today;
            this.#waitUntil.set(item.id, on);
          }
          if (daysBetween(on, today) < 0) return;
        }
        this.#tryMistake(item, before);
        if (choice === 'paycheck' && daysBetween(this.#lastPaycheckDate, item.date) < 0) {
          this.#expectRefused(() => this.#book.sort(item.id, { to: 'paycheck' }, today), before, item.id, 'calling a deposit older than the last paycheck a paycheck (B54)');
          choice = 'other-income';
        }
        const asked = this.#openLeftovers();
        this.#book.sort(item.id, { to: choice }, today);
        this.#waitingForYes.delete(item.id);
        this.#note(`sort money in ${item.id} -> ${choice}`);
        if (choice === 'paycheck') {
          this.#stats.myPaycheckChoices++;
          this.#onPaycheck(before, asked, item.amount, item.date, 'review');
          return;
        }
        if (choice === 'other-income') this.#stats.otherIncome++;
        const change: Change = choice === 'other-income' ? this.#otherIncome(item.amount) : choice === 'not-mine' ? { heldForOthers: item.amount } : { [choice]: item.amount };
        this.#expectChange(before, { ...change, unsortedIn: -item.amount }, '6.1 sorting money in', item.id);
        // Her rulebook, 3.1: "not a paycheck" first; her paycheck after all, a few days on.
        if (meant === 'paycheck' && this.#yesPlans.get(item.id)?.notFirst === true) {
          this.#notAPaycheck.set(item.id, { date: item.date, amount: item.amount, parts: change, on: addDays(today, r.int(1, 5)) });
          this.#stats.notAPaycheckFirst++;
        }
        return;
      }
      case 'spending':
        this.#tryMistake(item, before);
        this.#sortSpending(item, before);
        return;
    }
  }

  // Her rulebook, 3.1 and 51.2: when she answers a paycheck waiting for her
  // yes: the day it comes, a few days late, or now and then two weeks or
  // more late; now and then "not a paycheck" first (as other income), and "This is my paycheck" a few days after that
  // (#myPaycheckAfterAll). The older paycheck is answered first: a yes to a
  // newer one while an older one that can still be her paycheck waits is
  // refused with nothing changed, and she leaves it for another evening.
  // Null: not today.
  #herAnswer(item: Extract<ReviewItem, { type: 'money-in' }>, before: Pots): 'paycheck' | 'other-income' | null {
    const r = this.#random;
    const today = this.#date;
    let plan = this.#yesPlans.get(item.id);
    if (plan === undefined) {
      // Now and then she is away for a while, and the next paycheck comes
      // while this one still waits.
      const when = r.int(1, 100);
      plan = { on: when <= 55 ? today : when <= 80 || when > 85 ? addDays(today, r.int(1, 4)) : addDays(today, r.int(12, 18)), notFirst: when > 85 };
      this.#yesPlans.set(item.id, plan);
    }
    if (daysBetween(plan.on, today) < 0) return null;
    if (plan.notFirst) return 'other-income';
    // One older than the last paycheck is refused as any is (B54), in #handle.
    if (daysBetween(this.#lastPaycheckDate, item.date) >= 0 && this.#olderWaiting(item.id, item.date)) {
      this.#expectRefused(() => this.#book.sort(item.id, { to: 'paycheck' }, today), before, item.id, 'a yes to a newer paycheck while an older one waits (51.2)');
      this.#stats.olderPaycheckFirst++;
      return null;
    }
    if (daysBetween(item.date, today) > 0) this.#stats.yesLate++;
    return 'paycheck';
  }

  // 51.2, worked out here: a paycheck waiting for her yes from a day before
  // this one, which can still be her paycheck (not older than the last, B54).
  #olderWaiting(id: string, date: IsoDate): boolean {
    for (const [other, arrived] of this.#waitingForYes) {
      if (other !== id && daysBetween(this.#lastPaycheckDate, arrived) >= 0 && daysBetween(arrived, date) > 0) return true;
    }
    return false;
  }

  // Her rulebook, 3.1 and B52: a paycheck she said was not one, as other
  // income, made her paycheck after all on the day she planned, from the day
  // it arrived. Other income's parts come back out of the buckets first. If a
  // newer paycheck was counted since, it cannot be (B54) and stays other
  // income; while an older paycheck waits for her yes, it is refused (51.2)
  // and she tries another evening. Either refusal changes nothing.
  #myPaycheckAfterAll(): void {
    for (const [id, was] of [...this.#notAPaycheck]) {
      if (daysBetween(was.on, this.#date) < 0) continue;
      const before = this.#book.pots();
      const attempt = (): void => this.#book.sort(id, { to: 'paycheck' }, this.#date);
      if (daysBetween(this.#lastPaycheckDate, was.date) < 0) {
        this.#expectRefused(attempt, before, null, 'making a deposit older than the last paycheck her paycheck (B54)');
        this.#notAPaycheck.delete(id);
        continue;
      }
      if (this.#olderWaiting(id, was.date)) {
        this.#expectRefused(attempt, before, null, 'her paycheck after all while an older paycheck waits (51.2)');
        this.#stats.olderPaycheckFirst++;
        continue;
      }
      const asked = this.#openLeftovers();
      attempt();
      this.#notAPaycheck.delete(id);
      this.#note(`${id}: her paycheck after all`);
      const base: Record<string, Cents> = { ...before };
      for (const [pot, part] of Object.entries(was.parts) as [PotName, Cents][]) base[pot] = (base[pot] ?? 0) - part;
      this.#stats.yesAfterNotAPaycheck++;
      this.#stats.myPaycheckChoices++;
      this.#onPaycheck(base as unknown as Pots, asked, was.amount, was.date, 'resort');
    }
  }

  #moneyInChoice(item: Extract<ReviewItem, { type: 'money-in' }>): 'paycheck' | 'other-income' | 'not-mine' | 'needs' | 'wants' | 'wishlist' {
    const intent = this.#intents.get(item.id);
    if (intent?.type === 'refund') return intent.bucket;
    return intent?.type === 'money-in' ? intent.choice : 'other-income';
  }

  // Now and then the person first tries something the rulebook does not
  // allow. The app must refuse it and change nothing.
  #tryMistake(item: ReviewItem, before: Pots): void {
    const r = this.#random;
    if (!r.chance(1, 25)) return;
    const today = this.#date;
    if (item.type === 'spending' && item.amount >= 2) {
      const person = this.#intents.get(item.id)?.type === 'person';
      const split = (needs: Cents, wants: Cents) => () => this.#book.sort(item.id, { split: [{ bucket: 'needs', amount: needs }, { bucket: 'wants', amount: wants }] }, today);
      if (item.reason === 'mom-difference') this.#expectRefused(split(1, item.amount - 1), before, item.id, 'splitting a mom difference (B23)');
      else if (person) {
        const intoSavings = () => this.#book.sort(item.id, { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'savings' as never, amount: item.amount - 1 }] }, today);
        this.#expectRefused(intoSavings, before, item.id, 'splitting a payment to a person into savings (7.6)');
      } else if (item.reason === 'from-savings' && r.chance(1, 2)) {
        const always = () => this.#book.sortAlways(item.id, { to: 'needs' }, { id: `always-${item.id}`, contains: item.description }, today);
        this.#expectRefused(always, before, item.id, 'a sorting rule for money leaving savings (4.9)');
      } else if (r.chance(1, 2)) this.#expectRefused(split(1, item.amount - 2), before, item.id, 'a split one cent short (4.4)');
      else if (item.reason !== 'old-card-from-savings') this.#expectRefused(() => this.#book.sort(item.id, { to: 'savings' }, today), before, item.id, 'sorting spending to savings (4.2, QUESTIONS.md A3)');
    } else if (item.type === 'money-in' && item.reason === 'refund') {
      this.#expectRefused(() => this.#book.sort(item.id, { to: r.pick(['paycheck', 'other-income'] as const) }, today), before, item.id, 'calling a store refund income (B16)');
    }
  }

  #expectRefused(attempt: () => unknown, before: Pots, itemId: string | null, what: string): void {
    const logBefore = this.#book.changeLog().length;
    let refused = false;
    try {
      attempt();
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      refused = true;
    }
    if (!refused) throw new CheckFailed('refusing what the rulebook does not allow', `the person tried ${what}, and the app accepted it`);
    this.#expectChange(before, {}, 'a refused change leaves no trace', what);
    if (this.#book.changeLog().length !== logBefore) throw new CheckFailed('a refused change leaves no trace', `${what} was logged`);
    if (itemId !== null && !this.#book.reviewItems().some((i) => i.id === itemId)) throw new CheckFailed('a refused change leaves no trace', `${itemId} left review after ${what}`);
    this.#stats.mistakesRefused++;
    this.#note(`refused, as it should be: ${what}`);
  }

  #sortSpending(item: Extract<ReviewItem, { type: 'spending' }>, before: Pots): void {
    const r = this.#random;
    const today = this.#date;
    const intent = this.#intents.get(item.id);
    const store = intent?.type === 'store' ? intent.store : null;
    // 13.6: after sorting a few restaurant meals by hand, "always do this".
    // The item and every waiting meal the new rule is the first match for
    // land in wants.
    if (store === 'MADE UP RESTAURANT' && item.reason === 'no-rule' && ++this.#restaurantsSortedByHand > 3) {
      const waiting = this.#waitingFrom(store);
      const total = waiting.reduce((sum, i) => sum + i.amount, 0);
      const logBefore = this.#book.changeLog().length;
      const rule = { id: `always-${item.id}`, contains: store };
      const { sticks } = this.#book.sortAlways(item.id, { to: 'wants' }, rule, today);
      this.#rules.push({ ...rule, for: 'purchase', bucket: 'wants' });
      this.#note(`always: restaurants to wants (${item.id}), sorting ${waiting.length} waiting`);
      this.#expectChange(before, { wants: -total, unsortedOut: -total }, '13.6 always do this', item.id);
      if (!sticks || this.#book.changeLog().length !== logBefore + 1) throw new CheckFailed('13.6 always do this', `sticks: ${sticks}, log ${logBefore} -> ${this.#book.changeLog().length}`);
      for (const i of waiting) this.#standing.set(i.id, 'wants');
      this.#stats.alwaysRules++;
      return;
    }
    let change: Change;
    // A bucket to cover from savings by hand, once sorted.
    let cover: 'needs' | 'wants' | null = null;
    if (item.reason === 'old-card-from-savings') {
      // QUESTIONS.md A4: it suggests savings; the person mostly confirms it,
      // and sometimes picks needs instead.
      if (item.suggestion !== 'savings') throw new CheckFailed('5.2 an old card payment from savings suggests savings (A4)', JSON.stringify(item));
      const to = r.chance(3, 4) ? 'savings' : 'needs';
      this.#book.sort(item.id, { to }, today);
      change = { [to]: -item.amount };
    } else if (item.reason === 'card-fee' || item.reason === 'card-interest' || item.reason === 'setup-difference') {
      this.#book.sort(item.id, { to: 'needs' }, today);
      change = { needs: -item.amount };
    } else if (item.reason === 'mom-difference') {
      const to = r.pick(['needs', 'wants'] as const);
      this.#book.sort(item.id, { to }, today);
      change = { [to]: -item.amount };
      this.#differenceTo.set(item.id, to);
    } else if (item.reason === 'from-savings') {
      // 4.9 and 4.2: sorted to needs or wants like any spending. To pay for
      // it out of savings, the person then moves the money by hand (13.3).
      if (intent?.type !== 'from-savings') throw new CheckFailed('4.9 only money leaving savings waits as from savings', JSON.stringify(item));
      this.#book.sort(item.id, { to: intent.sorting }, today);
      change = { [intent.sorting]: -item.amount };
      if (r.chance(1, 2)) cover = intent.sorting;
    } else if (intent?.type === 'person') {
      const sorting = intent.sorting === 'split' && item.amount < 3 ? 'wants' : intent.sorting;
      if (sorting === 'mom') {
        // 7.6 (B20): for mom. Out of the reserve as far as it goes; the rest
        // waits as a mom difference (8.3). After a few, "always do this".
        if (this.#person.alwaysForMom && ++this.#forMomSortedByHand > 2) {
          this.#alwaysForMom(item, before);
          return;
        }
        this.#book.sort(item.id, { to: 'mom' }, today);
        const fromReserve = this.#forMomPayment(item.id, item.date, item.amount, before.momReserve);
        change = { momReserve: -fromReserve, unsortedOut: -fromReserve };
        this.#checkMomMonth(item.date);
        this.#stats.paymentsForMom++;
      } else if (sorting === 'split') {
        // 7.6 (B20): split across needs, wants, and not mine.
        const parts = splitInto(r, item.amount, r.chance(1, 2) ? (['wants', 'not-mine'] as const) : (['needs', 'wants', 'not-mine'] as const));
        this.#book.sort(item.id, { split: parts }, today);
        change = {};
        for (const part of parts) {
          const pot = part.bucket === 'not-mine' ? 'heldForOthers' : part.bucket;
          change[pot] = (change[pot] ?? 0) - part.amount;
        }
        this.#stats.personPaymentsSplit++;
      } else {
        this.#book.sort(item.id, { to: sorting }, today);
        change = sorting === 'not-mine' ? { heldForOthers: -item.amount } : { [sorting]: -item.amount };
      }
    } else if (intent?.type === 'store' && intent.sorting === 'split' && item.amount >= 3 && this.#her && r.chance(1, 3)) {
      // Her rulebook, 4.4: split across needs, wants and Wishlist.
      const needs = r.int(1, item.amount - 2);
      const wants = r.int(1, item.amount - needs - 1);
      const wishlist = item.amount - needs - wants;
      this.#book.sort(item.id, { split: [{ bucket: 'needs', amount: needs }, { bucket: 'wants', amount: wants }, { bucket: 'wishlist', amount: wishlist }] }, today);
      change = { needs: -needs, wants: -wants, wishlist: -wishlist };
      this.#standing.set(item.id, 'split');
      this.#splitParts.set(item.id, { needs, wants, wishlist });
      this.#stats.splitPurchases++;
      this.#stats.wishlistSplits++;
    } else if (intent?.type === 'store' && intent.sorting === 'split' && item.amount >= 2) {
      const needs = r.int(1, item.amount - 1);
      this.#book.sort(item.id, { split: [{ bucket: 'needs', amount: needs }, { bucket: 'wants', amount: item.amount - needs }] }, today);
      change = { needs: -needs, wants: -(item.amount - needs) };
      this.#standing.set(item.id, 'split');
      this.#splitParts.set(item.id, { needs, wants: item.amount - needs });
      this.#stats.splitPurchases++;
    } else {
      const sorting = intent?.type === 'store' ? intent.sorting : 'either';
      const to = sorting === 'needs' || sorting === 'wants' || sorting === 'wishlist' ? sorting : r.pick(['needs', 'wants'] as const);
      this.#book.sort(item.id, { to }, today);
      change = { [to]: -item.amount };
      if (intent?.type === 'store') {
        this.#standing.set(item.id, to);
        if (to === 'wishlist') this.#stats.wishlistPurchases++;
        else this.#handSorted.push({ id: item.id, to });
        if (this.#handSorted.length > 50) this.#handSorted.shift();
      }
    }
    this.#note(`sort spending ${item.id} (${item.reason}) ${JSON.stringify(change)}`);
    this.#expectChange(before, { unsortedOut: -item.amount, ...change }, '4.2, 4.4 and 7.6 sorting spending', item.id);
    if (cover !== null) this.#move('savings', cover, item.amount, true);
    if (this.#her && (change.wishlist ?? 0) < 0 && r.chance(2, 3)) this.#moveForWishlist();
  }

  // 13.6 and 7.6: "always do this" for a payment for mom. The new rule sorts
  // this one and every one like it still waiting, each out of the reserve
  // as far as it goes, in the order they wait.
  #alwaysForMom(item: Extract<ReviewItem, { type: 'spending' }>, before: Pots): void {
    const waiting = this.#book
      .reviewItems()
      .filter((i): i is Extract<ReviewItem, { type: 'spending' }> => i.type === 'spending' && i.id !== item.id && i.reason === 'person-payment' && i.description.includes(FOR_MOM));
    const logBefore = this.#book.changeLog().length;
    const rule = { id: `always-${item.id}`, contains: FOR_MOM };
    const { sticks } = this.#book.sortAlways(item.id, { to: 'mom' }, rule, this.#date);
    this.#rules.push({ ...rule, for: 'person', choice: { to: 'mom' } });
    let reserve = before.momReserve;
    let taken = 0;
    for (const i of [item, ...waiting]) {
      const fromReserve = this.#forMomPayment(i.id, i.date, i.amount, reserve);
      reserve -= fromReserve;
      taken += fromReserve;
    }
    this.#note(`always: ${FOR_MOM} for mom (${item.id}), sorting ${waiting.length} more waiting`);
    this.#expectChange(before, { momReserve: -taken, unsortedOut: -taken }, '13.6 always do this, for mom (7.6)', item.id);
    for (const i of [item, ...waiting]) this.#checkMomMonth(i.date);
    if (!sticks || this.#book.changeLog().length !== logBefore + 1) throw new CheckFailed('13.6 always do this', `sticks: ${sticks}, log ${logBefore} -> ${this.#book.changeLog().length}`);
    this.#stats.forMomRules++;
    this.#stats.paymentsForMom += 1 + waiting.length;
  }

  // 7.6: now and then the person decides a payment marked for mom was not
  // for mom after all, and sorts it again. The reserve gets back what it
  // gave, the difference is undone wherever it went, and the month's total
  // drops (8.2). One the mom rule matched can never be sorted again (8.1).
  #notForMom(): void {
    const r = this.#random;
    const today = this.#date;
    if (this.#momRulePayments.length > 0 && r.chance(1, 4)) {
      const id = r.pick(this.#momRulePayments);
      this.#expectRefused(() => this.#book.sort(id, { to: 'needs' }, today), this.#book.pots(), null, `sorting ${id}, which the mom rule matched, another way (8.1)`);
    }
    const target = this.#forMom.length > 0 ? r.pick(this.#forMom) : undefined;
    if (target === undefined) return;
    this.#forMom.splice(this.#forMom.indexOf(target), 1);
    const before = this.#book.pots();
    const to = r.pick(['needs', 'wants', 'not-mine'] as const);
    this.#book.sort(target.id, { to }, today);
    const change: Change = { momReserve: target.fromReserve, [to === 'not-mine' ? 'heldForOthers' : to]: -target.amount };
    const difference = target.amount - target.fromReserve;
    const went = this.#differenceTo.get(`${target.id}:difference`);
    this.#differenceTo.delete(`${target.id}:difference`);
    if (difference > 0 && went === undefined) change.unsortedOut = -difference;
    else if (difference > 0 && went !== undefined) change[went] = (change[went] ?? 0) + difference;
    this.#addMomSent(target.date, -target.amount);
    this.#note(`re-sort ${target.id}, for mom, to ${to}`);
    this.#expectChange(before, change, '7.6 a payment for mom sorted again', target.id);
    this.#checkMomMonth(target.date);
    this.#stats.forMomResorted++;
  }

  // Spending from a store still waiting in review with no rule for it.
  #waitingFrom(store: string): Extract<ReviewItem, { type: 'spending' }>[] {
    return this.#book.reviewItems().filter((i): i is Extract<ReviewItem, { type: 'spending' }> => {
      const intent = this.#intents.get(i.id);
      return i.type === 'spending' && i.reason === 'no-rule' && intent?.type === 'store' && intent.store === store;
    });
  }

  // 4.7: now and then the person changes their mind about a purchase. What
  // is left of it moves from one bucket to the other (B7).
  #resort(): void {
    const target = this.#handSorted.length > 0 ? this.#random.pick(this.#handSorted) : undefined;
    if (!target || this.#standing.get(target.id) !== target.to) return;
    const from = target.to;
    const to = from === 'needs' ? 'wants' : 'needs';
    const before = this.#book.pots();
    this.#book.sort(target.id, { to }, this.#date);
    const moved = this.#book.pots()[from] - before[from];
    if (moved < 0) throw new CheckFailed('4.7 re-sorting a purchase', `${target.id} took ${-moved} more out of ${from}`);
    this.#expectChange(before, { [from]: moved, [to]: -moved }, '4.7 re-sorting a purchase', target.id);
    target.to = to;
    this.#standing.set(target.id, to);
    this.#stats.resorts++;
    this.#note(`re-sort ${target.id} -> ${to}`);
  }

  // Her rulebook, "Off in this setup", every evening of a life shaped like
  // hers: the switches are as setup day set them, nothing about the mom
  // reserve or the old card holds anything, and nothing in review or sorting
  // again offers them. Now and then the person asks for one of them anyway,
  // and it must be refused with nothing changed.
  #offInHerSetup(): void {
    const book = this.#book;
    const r = this.#random;
    if (!same(book.switches(), HER_SWITCHES)) throw new CheckFailed('Off in this setup: fixed on setup day', JSON.stringify(book.switches()));
    if (book.pots().momReserve !== 0 || book.oldCardDebt() !== 0) throw new CheckFailed('Off in this setup: off is not zero, and holds nothing', `mom reserve ${book.pots().momReserve}, old card ${book.oldCardDebt()}`);
    const s = book.settings();
    if (s.momReservePerPaycheck !== 0 || s.momReserveCap !== 0 || s.momRule !== null || s.oldCardPromoEndDate !== null || s.oldCardClosingDay !== null) {
      throw new CheckFailed('Off in this setup: no settings about them', JSON.stringify(s));
    }
    const offered = (options: ReviewDetail['options'], what: string): void => {
      this.#stats.offersChecked++;
      if (options.type !== 'sort') return;
      const tos = [...options.picks.map((p) => p.to), ...options.always];
      if (tos.includes('mom') || tos.includes('momReserve') || options.transfer.includes('old-card') || 'old-card' in options.transferOutcome) {
        throw new CheckFailed('Off in this setup: nothing about them is offered', `${what}: ${JSON.stringify(options)}`);
      }
    };
    for (const detail of book.reviewDetails()) offered(detail.options, detail.item.id);
    const purchases = book.purchases();
    if (purchases.length > 0) {
      const id = r.pick(purchases).id;
      const detail = book.resortDetail(id);
      if (detail?.resortable === true) offered(detail.options, `sorting ${id} again`);
    }
    if (!r.chance(1, 10)) return;
    const waiting = book.reviewItems().filter((i) => i.type === 'spending' || i.type === 'money-in');
    const item = waiting.length > 0 ? r.pick(waiting) : undefined;
    const today = this.#date;
    const tries: { readonly what: string; readonly run: () => unknown }[] = [
      { what: 'moving money into the mom reserve', run: () => book.moveMoney({ from: 'savings', to: 'momReserve', amount: r.int(1, 5_000), confirmed: true }, today) },
      { what: 'moving money out of the mom reserve', run: () => book.moveMoney({ from: 'momReserve', to: 'needs', amount: 1, confirmed: true }, today) },
      { what: 'setting a mom rule', run: () => book.changeSettings({ momRule: { contains: MOM } }, today) },
      { what: 'a mom reserve per paycheck', run: () => book.changeSettings({ momReservePerPaycheck: 150_000 }, today) },
      { what: 'an old card promo end date', run: () => book.changeSettings({ oldCardPromoEndDate: addDays(today, 200) }, today) },
      { what: 'a person rule for mom', run: () => book.addRule({ id: `her-mom-${today}`, for: 'person', contains: 'MADE UP AUNT', choice: { to: 'mom' } }, today) },
      { what: 'a purchase on the old card', run: () => book.receive({ kind: 'purchase', id: `her-old-card-${today}`, account: 'old-card', date: today, amount: 1_000, description: 'MADE UP CAFE', pending: false }) },
      { what: 'a payment to the old card', run: () => book.receive({ kind: 'transfer', id: `her-to-old-card-${today}`, from: 'checking', to: 'old-card', date: today, amount: 1_000, description: 'PAYMENT FROM checking TO old-card' }) },
      ...(item === undefined
        ? []
        : [
            { what: `${item.id} for mom`, run: () => book.sort(item.id, { to: 'mom' }, today) },
            { what: `${item.id} into the mom reserve`, run: () => book.sort(item.id, { to: 'momReserve' }, today) },
            { what: `${item.id} a transfer to the old card`, run: () => book.sort(item.id, { transfer: 'old-card' }, today) },
          ]),
    ];
    const attempt = r.pick(tries);
    const before = book.pots();
    const logBefore = book.changeLog().length;
    const waitingBefore = JSON.stringify(book.reviewItems());
    try {
      attempt.run();
    } catch (error) {
      if (!(error instanceof MoneyError) || error.code !== 'off-in-this-setup') throw error;
      this.#expectChange(before, {}, 'Off in this setup: a refused answer leaves no trace', attempt.what);
      if (book.changeLog().length !== logBefore || JSON.stringify(book.reviewItems()) !== waitingBefore) throw new CheckFailed('Off in this setup: a refused answer leaves no trace', attempt.what);
      this.#stats.offRefused++;
      this.#note(`refused, as it should be: ${attempt.what}`);
      return;
    }
    throw new CheckFailed('Off in this setup: anything about them is refused', `${attempt.what} was accepted`);
  }

  // 13.3: covering an overspent needs from savings, small moves between
  // needs and wants, keeping money a friend said to keep, and now and then
  // something out of the mom reserve.
  #handMoves(): void {
    const r = this.#random;
    const pots = this.#book.pots();
    if (pots.needs < 0 && pots.savings > -pots.needs && r.chance(1, 3)) this.#move('savings', 'needs', -pots.needs, true);
    if (r.chance(1, 60)) {
      const [from, to] = r.chance(1, 2) ? (['needs', 'wants'] as const) : (['wants', 'needs'] as const);
      this.#move(from, to, r.int(2_000, 10_000), r.chance(1, 2));
    }
    if (pots.heldForOthers > 0 && r.chance(1, 90)) this.#move('heldForOthers', 'wants', pots.heldForOthers, true);
    // Her life (PR 9): money into Wishlist by hand, and now and then out of it.
    if (this.#her && r.chance(1, 45)) {
      const [from, to] = r.pick([['wants', 'wishlist'], ['savings', 'wishlist'], ['wishlist', 'wants'], ['wishlist', 'savings']] as const);
      this.#move(from, to, r.int(1_000, 15_000), r.chance(4, 5));
      this.#stats.wishlistHandMoves++;
    }
    if (!this.#her && pots.momReserve > 5_000 && r.chance(1, 200)) this.#move('momReserve', 'needs', 5_000, true);
    // Rarely more comes out of the mom reserve than it holds, so the next
    // payment to mom meets a reserve below zero (8.3, B27).
    if (!this.#her && pots.momReserve >= 0 && r.chance(1, 400)) this.#move('momReserve', 'needs', pots.momReserve + r.int(1, 20_000), true);
    // And now and then a slip the app must refuse: a move to the same
    // bucket, or of nothing.
    if (r.chance(1, 100)) {
      const slip = r.chance(1, 2) ? { from: 'needs' as const, to: 'needs' as const, amount: 1_000 } : { from: 'needs' as const, to: 'wants' as const, amount: 0 };
      this.#expectRefused(() => this.#book.moveMoney(slip, this.#date), this.#book.pots(), null, `moving ${slip.amount} from ${slip.from} to ${slip.to}`);
    }
  }

  // 13.4: it asks first when money leaves savings or the mom reserve, or
  // would leave the bucket it comes out of below zero (B51), and nothing
  // moves until you confirm. 13.5: every move is logged.
  #move(from: AnyPot, to: AnyPot, amount: Cents, confirmIfAsked: boolean): void {
    const before = this.#book.pots();
    const logBefore = this.#book.changeLog().length;
    const reasons = [
      ...(from === 'savings' ? ['out-of-savings'] : []),
      ...(from === 'momReserve' ? ['out-of-mom-reserve'] : []),
      ...(from === 'wishlist' ? ['out-of-wishlist'] : []),
      ...((before[from] ?? 0) - amount < 0 ? ['below-zero'] : []),
    ];
    let result = this.#book.moveMoney({ from, to, amount }, this.#date);
    if (reasons.length === 0 && !result.moved) throw new CheckFailed('13.4 asking to confirm', `moving ${amount} ${from} -> ${to} asked: ${JSON.stringify(result)}`);
    if (reasons.length > 0) {
      if (result.moved || !same([...result.reasons].sort(), [...reasons].sort())) {
        throw new CheckFailed('13.4 asking to confirm', `moving ${amount} ${from} -> ${to} with ${from} at ${before[from]}: expected to ask for ${reasons.join(', ')}, got ${JSON.stringify(result)}`);
      }
      this.#expectChange(before, {}, '13.4 nothing moves until you confirm', `${from} -> ${to}`);
      if (!confirmIfAsked) return;
      result = this.#book.moveMoney({ from, to, amount, confirmed: true }, this.#date);
      this.#stats.confirmedMoves++;
      if (!result.moved) throw new CheckFailed('13.4 a confirmed move goes through', JSON.stringify(result));
    }
    this.#expectChange(before, { [from]: -amount, [to]: amount }, '13.3 a hand move', `${amount} ${from} -> ${to}`);
    const last = this.#book.changeLog().at(-1);
    if (this.#book.changeLog().length !== logBefore + 1 || last?.kind !== 'money-moved' || last.from !== from || last.to !== to || last.amount !== amount || last.date !== this.#date) {
      throw new CheckFailed('13.5 every move is logged', JSON.stringify(last));
    }
    this.#stats.handMoves++;
    this.#note(`move ${amount} ${from} -> ${to}`);
  }

  // Her rulebook, 50.4: she moves $X from savings to checking, all of it at
  // once or in two halves (12.5); either way it is $0.00 once it has left
  // savings, and moving it changes no bucket (5.3).
  #moveForWishlist(): void {
    const x = this.#wishlistMoveNow();
    if (x.amount === 0) return;
    this.#moveBetweenOwn('savings', 'checking', x.amount);
    const after = this.#wishlistMoveNow();
    if (after.amount !== 0 || after.when !== null) throw new CheckFailed('50.4 it goes away once $X is moved', `moved ${x.amount}, now ${JSON.stringify(after)}`);
    this.#stats.wishlistMoves++;
    this.#note(`50.4: moved ${x.amount} from savings to checking`);
  }

  // 50.4 as the app works it out, from the savings account as 3.8 reads it.
  #wishlistMoveNow(): NonNullable<ReturnType<typeof wishlistMove>> {
    const x = wishlistMove(this.#book, { savingsAccountBalance: this.#bank.balances().savings, statements: {}, today: this.#date });
    if (x === null) throw new CheckFailed('50.4 moving Wishlist money', 'no amount while the bank is read');
    return x;
  }

  // About once a year, on a day picked at random, some settings change
  // (13.1), and the first time, a new rule for the cinema (13.2).
  #maybeChangeSettings(): void {
    const r = this.#random;
    if (this.#date !== this.#nextSettingsChange) return;
    this.#nextSettingsChange = addDays(this.#date, r.int(300, 420));
    const patch: { -readonly [K in keyof Settings]?: Settings[K] } = { split: r.pick(this.#her ? HER_SPLITS : SPLITS) };
    if (!this.#her && r.chance(2, 5)) patch.momReservePerPaycheck = r.pick([100_000, 150_000, 200_000]);
    if (!this.#her && r.chance(1, 4)) patch.momReserveCap = r.pick([300_000, 400_000]);
    if (r.chance(1, 4)) patch.lowBucketAlertPercent = r.pick([10, 20, 25]);
    if (r.chance(1, 8)) patch.payScheduleDays = this.#settings.payScheduleDays === 14 ? 15 : 14;
    // Section 2 (A48): now and then the schedule is twice a month, or back.
    if (r.chance(1, 4)) patch.paySchedule = this.#settings.paySchedule === 'twice-a-month' ? 'every-n-days' : 'twice-a-month';
    if (r.chance(1, 4)) {
      const choices: readonly LeftoverChoice[] = ['ask', 'ask', 'roll-over', 'move-to-savings'];
      patch.leftoverAtPayday = { needs: r.pick(choices), wants: r.pick(choices) };
    }
    const logBefore = this.#book.changeLog().length;
    this.#changeSettings(patch);
    this.#stats.settingsChanges++;
    this.#note(`settings changed: ${JSON.stringify(patch)}`);
    if (this.#book.changeLog().length !== logBefore + 1) throw new CheckFailed('13.5 every change is logged', 'a settings change was not logged');
    if (this.#rules.some((rule) => rule.id === 'cinema')) return;
    const rule: SortingRule = { id: 'cinema', for: 'purchase', contains: 'CINEMA', bucket: 'wants' };
    const waiting = this.#waitingFrom('MADE UP CINEMA');
    const total = waiting.reduce((sum, i) => sum + i.amount, 0);
    const before = this.#book.pots();
    this.#book.addRule(rule, this.#date);
    this.#rules.push(rule);
    this.#stats.rulesAdded++;
    this.#expectChange(before, { wants: -total, unsortedOut: -total }, '13.2 a new rule sorts what is waiting', `cinema, ${waiting.length} waiting`);
    for (const i of waiting) this.#standing.set(i.id, 'wants');
  }

  // 3.4 and B4: what was asked at payday, lowered by spending made before
  // payday that showed up or changed since, never below zero and never above
  // what was asked. Worked out here from the purchases as listed, not from
  // the question.
  #answerLeftover(item: Extract<ReviewItem, { type: 'leftover' }>, answer: LeftoverAnswer, before: Pots): void {
    const today = this.#date;
    const askedAt = this.#askedAtPayday.get(item.id);
    if (askedAt === undefined) throw new CheckFailed('3.4 a leftover answer', `the simulator has no record of ${item.id}`);
    const late = this.#spentBeforeFromList(item.bucket, item.date) - askedAt.spentBefore;
    const moves = Math.min(askedAt.asked, Math.max(0, askedAt.asked - late));
    this.#book.answerLeftover(item.id, answer, today);
    this.#note(`answer leftover ${item.id} ${answer} (${moves} of ${askedAt.asked})`);
    // Rolling over moves nothing; moving to savings moves what it asks about now.
    this.#expectChange(before, answer === 'roll-over' ? {} : { [item.bucket]: -moves, savings: moves }, '3.4 a leftover answer', item.id);
    if (moves !== askedAt.asked) this.#stats.leftoverLoweredLate++;
    if (daysBetween(item.date, today) > 0) this.#stats.leftoverAnsweredLate++;
    if (answer === 'roll-over') this.#stats.leftoverRolledOver++;
    else this.#stats.leftoverMovedToSavings++;
  }

  // ---- A life lived as planned -------------------------------------------

  #firstOf(label: string): string {
    const first = this.#labels.get(label);
    if (first === undefined) throw new Error(`the plan has no purchase called ${label}`);
    return first;
  }

  // The purchase a label names, as the book has it now (a posted charge has
  // an id of its own).
  #purchaseNow(label: string): ReturnType<Book['purchases']>[number] {
    const first = this.#firstOf(label);
    const found = this.#book.purchases().find((p) => (this.#firstId.get(p.id) ?? p.id) === first);
    if (found === undefined) throw new Error(`the book has no purchase for ${label} (${first})`);
    return found;
  }

  #planned(event: PlannedBankEvent): void {
    switch (event.kind) {
      case 'shop': {
        const store = STORES.find((s) => s.name === event.store) ?? null;
        this.#stats.purchases++;
        const pending = event.pending;
        const id =
          pending === undefined
            ? this.#purchase(() => this.#bank.purchase(this.#date, event.account, event.amount, event.store), store)
            : this.#purchase(() => this.#bank.authorize(this.#date, event.account, event.amount, event.store), store);
        this.#labels.set(event.label, id);
        if (event.sortOn !== undefined) this.#sortOn.set(id, event.sortOn);
        if (pending !== undefined) this.#laterOn(pending.postsOn, () => this.#post(id, pending.postsAt ?? event.amount));
        return;
      }
      case 'refund': {
        // 4.5: the bank does not say which purchase it is for. To checking
        // it is money in (6.1, A29).
        const first = this.#firstOf(event.of);
        const purchase = this.#sent.find((t): t is Purchase => t.kind === 'purchase' && t.id === first);
        if (purchase === undefined) throw new Error(`the plan refunds ${event.of}, which the bank never charged`);
        const before = this.#book.pots();
        const description = `${purchase.description} REFUND`;
        const txn = purchase.account === 'checking' ? this.#bank.deposit(this.#date, 'checking', event.amount, description) : this.#bank.refund(this.#date, purchase.account, event.amount, description);
        const outcome = this.#receive(txn);
        if (outcome !== 'review') throw new CheckFailed('4.5 a refund it cannot match waits in review', `${txn.id} came back as ${outcome}`);
        this.#expectChange(before, { unsortedIn: event.amount }, '4.5 a refund it cannot match waits in review', txn.id);
        this.#refundOf.set(txn.id, first);
        this.#stats.refundsInReview++;
        return;
      }
      case 'paycheck':
        this.#payroll(event.amount, `${PAYROLL} DIRECT DEP`, 'paycheck');
        return;
      case 'mom':
        this.#payMom(event.amount, event.from, false);
        return;
      case 'deposit':
        this.#deposit(event.account, event.amount, event.description, event.choice);
        return;
      case 'card-payment': {
        this.#countCardPayment(event.card, event.from);
        this.#stats.paymentsInTransit++;
        const seen: CardPaymentSeen = { left: this.#date, landed: null, amount: event.amount };
        this.#cardPayments[event.card].push(seen);
        const left = this.#ownTransfer(() => this.#bank.send(this.#date, event.from, event.card, event.amount));
        this.#laterOn(event.landsOn, () => {
          this.#ownTransfer(() => this.#bank.land(this.#date, left, false));
          seen.landed = this.#date;
        });
        return;
      }
      case 'charge-twice': {
        const first = this.#firstOf(event.of);
        const posted = [...this.#sent].reverse().find((t): t is Purchase => t.kind === 'purchase' && !t.pending && (this.#firstId.get(t.id) ?? t.id) === first);
        if (posted === undefined) throw new Error(`the plan charges ${event.of} twice before it posted`);
        const copy = this.#bank.chargeTwice(this.#date, posted);
        this.#purchase(() => copy, STORES.find((s) => s.name === posted.description) ?? null);
        this.#laterOn(event.takenBackOn, () => this.#takeBackCopy(copy));
        return;
      }
      case 'old-card-refund': {
        this.#stats.oldCardRefunds++;
        const before = this.#book.pots();
        const txn = this.#bank.refund(this.#date, 'old-card', event.amount, 'MADE UP STORE REFUND');
        this.#receive(txn);
        this.#expectChange(before, {}, 'B13 an old card refund touches no bucket', txn.id);
        return;
      }
    }
  }

  // 4.5, A18 and A29: a refund the bank did not match, or money in to
  // checking that is a store's refund, matched by hand to its purchase. It
  // then counts exactly as if the bank had matched it: back into the bucket
  // the purchase came from, or each bucket its part of a split refunded in full.
  #matchRefund(item: Extract<ReviewItem, { type: 'money-in' }>, before: Pots): void {
    const first = this.#refundOf.get(item.id) as string;
    const options = this.#book.reviewDetails().find((d) => d.item.id === item.id)?.options;
    const match = options?.type === 'sort' ? options.match.find((id) => (this.#firstId.get(id) ?? id) === first) : undefined;
    if (match === undefined) throw new CheckFailed('4.5 A18 A29 a refund lists the purchase it belongs to', `${item.id} lists ${JSON.stringify(options?.type === 'sort' ? options.match : options)}, not ${first}`);
    const purchase = this.#book.purchases().find((p) => p.id === match);
    if (purchase === undefined) throw new CheckFailed('4.5 A18 A29 a refund lists the purchase it belongs to', `${match} is not a purchase`);
    const left = purchase.amount - purchase.refunded;
    const standing = this.#standing.get(first);
    const parts = this.#splitParts.get(first);
    const change: Change = { unsortedIn: -item.amount };
    if (inABucket(standing)) change[standing] = item.amount;
    else if (standing === 'split' && parts !== undefined && item.amount === left) Object.assign(change, { ...parts });
    else if (standing === 'unsorted' && item.amount < left) change.unsortedOut = -item.amount;
    else throw new Error(`the plan matches ${item.id} to ${first}, ${String(standing)}, a case it does not cover`);
    this.#book.sort(item.id, { refundOf: match }, this.#date);
    this.#note(`match refund ${item.id} to ${match}`);
    this.#expectChange(before, change, '4.5 a refund matched by hand counts as if the bank had matched it (A18, A29)', item.id);
    if (this.#book.reviewItems().some((i) => i.id === item.id)) throw new CheckFailed('4.5 a matched refund leaves review', item.id);
    this.#stats.refundsLinked++;
  }

  #answerAsPlanned(answer: PlannedAnswer): void {
    const today = this.#date;
    const before = this.#book.pots();
    const logBefore = this.#book.changeLog().length;
    const logged = (check: string, kind: string): void => {
      const log = this.#book.changeLog();
      if (log.length !== logBefore + 1 || log.at(-1)?.kind !== kind) throw new CheckFailed(check, `expected one ${kind} line, the log ends with ${JSON.stringify(log.slice(logBefore))}`);
    };
    switch (answer.kind) {
      case 'settings': {
        // 13.1: a new split or mom reserve waits for the next paycheck; the
        // simulator's own record of the split this pay period stays as it is.
        this.#changeSettings(answer.patch);
        this.#stats.settingsChanges++;
        this.#note(`settings changed: ${JSON.stringify(answer.patch)}`);
        this.#expectChange(before, {}, '13.1 a settings change with nothing waiting moves no money', JSON.stringify(answer.patch));
        logged('13.5 every change is logged', 'settings-changed');
        return;
      }
      case 'add-rule': {
        // 13.2: it sorts the purchases waiting with no rule that it matches.
        const rule = answer.rule;
        if (rule.for !== 'purchase') throw new Error('the plan adds purchase rules only');
        const waiting = this.#book
          .reviewItems()
          .filter((i): i is Extract<ReviewItem, { type: 'spending' }> => i.type === 'spending' && i.reason === 'no-rule' && this.#intents.get(i.id)?.type === 'store' && i.description.toLowerCase().includes(rule.contains.toLowerCase()));
        const total = waiting.reduce((sum, i) => sum + i.amount, 0);
        this.#book.addRule(rule, today);
        this.#rules.push(rule);
        this.#stats.rulesAdded++;
        this.#note(`rule added: ${rule.contains} to ${rule.bucket}, sorting ${waiting.length} waiting`);
        this.#expectChange(before, { [rule.bucket]: -total, unsortedOut: -total }, '13.2 a new rule sorts what is waiting', rule.id);
        for (const i of waiting) this.#standing.set(this.#firstId.get(i.id) ?? i.id, rule.bucket);
        logged('13.5 every change is logged', 'rule-added');
        return;
      }
      case 'move-rule': {
        // 13.2: one place up or down among the rules of its kind. Nothing
        // waits that a rule matches, so nothing is sorted.
        const index = this.#rules.findIndex((r) => r.id === answer.id);
        const rule = this.#rules[index];
        if (rule === undefined) throw new Error(`the plan moves ${answer.id}, which is not a rule`);
        const sameKind = this.#rules.flatMap((r, i) => (r.for === rule.for ? [i] : []));
        const other = sameKind[sameKind.indexOf(index) + (answer.direction === 'up' ? -1 : 1)];
        if (other === undefined) throw new Error(`the plan moves ${answer.id} ${answer.direction}, past the end of its list`);
        [this.#rules[index], this.#rules[other]] = [this.#rules[other] as SortingRule, rule];
        this.#book.moveRule(answer.id, answer.direction, today);
        this.#note(`rule ${answer.id} moved ${answer.direction}`);
        this.#expectChange(before, {}, '13.2 moving a rule sorts only what it is now the first match for', answer.id);
        const now = this.#book.rules().filter((r) => r.for === rule.for).map((r) => r.id);
        const expected = this.#rules.filter((r) => r.for === rule.for).map((r) => r.id);
        if (!same(now, expected)) throw new CheckFailed('13.2 a rule moves one place among its kind', `the book has ${JSON.stringify(now)}, expected ${JSON.stringify(expected)}`);
        logged('13.5 every move is logged', 'rule-moved');
        return;
      }
      case 'resort': {
        // 4.7 and B7: what is left of it moves to the other bucket.
        const first = this.#firstOf(answer.of);
        const from = this.#standing.get(first);
        if (from !== 'needs' && from !== 'wants') throw new Error(`the plan sorts ${answer.of} again, but it is ${String(from)}`);
        const to = from === 'needs' ? 'wants' : 'needs';
        const purchase = this.#purchaseNow(answer.of);
        const left = purchase.amount - purchase.refunded - purchase.countedAtSetup;
        this.#book.sort(purchase.id, { to }, today);
        this.#expectChange(before, { [from]: left, [to]: -left }, '4.7 re-sorting a purchase', purchase.id);
        this.#standing.set(first, to);
        this.#stats.resorts++;
        this.#note(`re-sort ${purchase.id} -> ${to}`);
        return;
      }
      case 'move':
        this.#move(answer.from, answer.to, answer.amount, true);
        return;
      case 'leftover': {
        const item = this.#book.reviewItems().find((i): i is Extract<ReviewItem, { type: 'leftover' }> => i.type === 'leftover' && i.bucket === answer.bucket);
        if (item === undefined) throw new CheckFailed('3.4 a payday question to answer', `no question for ${answer.bucket}`);
        this.#answerLeftover(item, answer.answer, before);
        return;
      }
    }
  }

  // ---- The checks at the end of every day --------------------------------

  #check(): void {
    const book = this.#book;
    const bank = this.#bank.balances();
    // 12.1: the simulator's own sum of pending charges agrees with the app's.
    const appWay = withPendingCharges(this.#bank.postedBalances(), this.#bank.pendingCharges());
    if (!same(appWay, bank)) throw new CheckFailed('12.1 pending charges', `the bank's balances with pending charges are ${JSON.stringify(bank)}, the app's way gives ${JSON.stringify(appWay)}`);
    // 12.3: the daily self-check. On a mismatch, safe to spend is held back
    // (0.5) and the alert shows the difference (10.4).
    const check = book.selfCheck(bank);
    if (check.ok && check.difference !== 0) throw new CheckFailed('12.3 a difference passed the self-check', JSON.stringify(check));
    if (!check.ok) {
      const safe = book.checkedSafeToSpend(this.#date, bank);
      if (safe.ok || safe.difference !== check.difference) throw new CheckFailed('0.5 safe to spend is held back on a mismatch', JSON.stringify(safe));
      const alert = book.takeAlerts({ bankConnection: 'ok', bankBalances: bank }).find((a) => a.kind === 'totals-mismatch');
      if (alert?.kind !== 'totals-mismatch' || alert.difference !== check.difference) throw new CheckFailed('10.4 the mismatch alert', JSON.stringify(alert));
      throw new CheckFailed('12.3 daily self-check', `bank side ${check.bankSide} + in transit ${check.inTransit} should equal app side ${check.appSide}; difference ${check.difference}`);
    }
    if (check.inTransit !== this.#bank.inTransit()) throw new CheckFailed('12.5 money in transit', `the book has ${check.inTransit} in transit, the bank ${this.#bank.inTransit()}`);
    // 12.5: the payments listed as on their way are exactly the ones the bank
    // shows with only one half, the old card's included.
    const listed = book.inTransit().items.map((i) => `${i.from} ${i.to} ${i.amount} ${i.seen}`).sort();
    const showing = this.#bank.halvesShowing().map((h) => `${h.from} ${h.to} ${h.amount} ${h.kind === 'transfer-sent' ? 'left' : 'arrived'}`).sort();
    if (!same(listed, showing)) throw new CheckFailed('12.5 the list of money in transit', `the book lists ${JSON.stringify(listed)}, the bank shows ${JSON.stringify(showing)}`);
    if (book.oldCardDebt() !== this.#bank.oldCardOwed()) throw new CheckFailed('12.4 old card debt', `the book shows ${book.oldCardDebt()}, the old card owes ${this.#bank.oldCardOwed()}`);
    // No cent created or lost: the running totals equal a recount from scratch.
    const pots = book.pots();
    const recount = book.recountPots();
    // Her rulebook, 50.4: never above the extra in savings nor the Wishlist
    // purchases not yet moved, and nothing to say at $0.00.
    if (this.#her) {
      const x = this.#wishlistMoveNow();
      const extra = book.savingsTransfer(bank.savings).extraInSavings ?? 0;
      if (x.extra !== extra || x.amount !== Math.min(extra, x.notMoved) || x.notMoved < 0 || (x.when === null) !== (x.amount === 0)) throw new CheckFailed('50.4 moving Wishlist money', JSON.stringify({ x, extra }));
    }
    for (const key of this.#potNames) {
      if (pots[key] !== recount[key]) throw new CheckFailed('recount', `${key} is ${pots[key]}, a recount gives ${recount[key]}`);
      if (!Number.isSafeInteger(pots[key])) throw new CheckFailed('0.1 whole cents', `${key} is ${pots[key]}`);
    }
    // 3.1: one pay period per paycheck, counted from the last one.
    if (book.period().number !== this.#paychecksSeen || book.lastPaycheckDate() !== this.#lastPaycheckDate) {
      throw new CheckFailed('3.1 pay periods', `period ${book.period().number} from ${book.lastPaycheckDate()}, expected ${this.#paychecksSeen} from ${this.#lastPaycheckDate}`);
    }
    // 11.1, 11.2 and 0.5: safe to spend is wants left minus unsorted
    // spending, with the days to the next payday from the pay schedule.
    const nextPayday = this.#settings.paySchedule === 'twice-a-month' ? twiceAMonthNextPayday(this.#lastPaycheckDate) : addDays(this.#lastPaycheckDate, this.#settings.payScheduleDays);
    const safe = book.checkedSafeToSpend(this.#date, bank);
    if (!safe.ok || safe.safeToSpend.amount !== pots.wants - pots.unsortedOut) {
      throw new CheckFailed('11.1 safe to spend', `${JSON.stringify(safe)} with wants ${pots.wants} and unsorted spending ${pots.unsortedOut}`);
    }
    if (safe.safeToSpend.nextPayday !== nextPayday || safe.safeToSpend.daysToPayday !== daysBetween(this.#date, nextPayday)) {
      throw new CheckFailed('11.2 days to payday', `${JSON.stringify(safe.safeToSpend)}, expected the next payday ${nextPayday}`);
    }
    // 7.3: held for others says what it means.
    const others = book.othersMoney();
    const meaning = pots.heldForOthers === 0 ? 'settled' : pots.heldForOthers > 0 ? 'holding-for-others' : 'owed-to-you';
    if (others.heldForOthers !== pots.heldForOthers || others.meaning !== meaning) throw new CheckFailed('7.3 held for others', JSON.stringify(others));
    // B3: never more than one leftover question for a bucket.
    const review = book.reviewItems();
    // A26: nothing waits in review with nothing left to sort.
    const empty = review.find((i) => i.type === 'spending' && i.amount === 0);
    if (empty !== undefined) throw new CheckFailed('4.5 A26 nothing waits in review at $0.00', JSON.stringify(empty));
    for (const bucket of ['needs', 'wants'] as const) {
      if (review.filter((i) => i.type === 'leftover' && i.bucket === bucket).length > 1) throw new CheckFailed('3.4 one leftover question per bucket', `${bucket} has more than one`);
    }
    this.#checkMomMonth(this.#date);
    this.#syncPoint();
    this.#eveningPoint(review.length);
    this.#checkActivity();
  }

  // B97, B105: what went in and out of every bucket adds up, and joins the pay
  // period before it. The current pay period every day; every pay period
  // since setup day on the last day and every 60 days.
  #checkActivity(): void {
    const current = this.#book.period().number;
    const whole = this.#day === this.#days - 1 || this.#day % 60 === 59;
    const assigned = this.#setupInput.assignment;
    const problems = [
      ...activityProblems(this.#book, whole ? assigned : undefined, whole ? 0 : current),
      ...summaryProblems(this.#book, whole ? 0 : current),
      ...leftoverProblems(this.#book),
    ];
    if (problems.length > 0) throw new CheckFailed('B97 B105 B109 what went in and out of each bucket adds up, and a payday question and what was taken off it add up to what was held', problems.slice(0, 5).join('; '));
    this.#stats.activityChecks++;
  }

  // Phase 5: the bank's activity since the last step is one sync. Called
  // before each answer and at the end of the day.
  #syncPoint(): void {
    const fed = this.#bank.feed.length;
    if (fed === this.#pointFeed) return;
    this.#pointFeed = fed;
    this.#steps.push({ kind: 'sync', afterFeed: fed - this.#recordedUpTo, phase: this.#phase, alerts: this.#eventPoint() });
  }

  // Section 10 at one moment, as the real server works it out after each
  // sync and each answer: the low alert below the level and the empty alert
  // at zero or below, each once per bucket per pay period, exactly when due
  // (10.1, 10.2); each take-back once (10.6); no login or mismatch alert while
  // all is well. Worked out here on its own, checked against the money math's
  // takeAlerts, and returned as the alerts due now.
  #eventPoint(): ExpectedAlert[] {
    const book = this.#book;
    const pots = book.pots();
    const period = book.period().number;
    const started = book.startedPeriodWith();
    const percent = BigInt(this.#settings.lowBucketAlertPercent);
    const due: ExpectedAlert[] = [];
    for (const bucket of ['needs', 'wants'] as const) {
      const amount = pots[bucket];
      if (amount <= 0 && !this.#alertsGiven.has(`${period} ${bucket} empty-bucket`)) due.push({ kind: 'empty-bucket', bucket, period, amount });
      if (amount > 0 && BigInt(amount) * 100n < BigInt(started[bucket]) * percent && !this.#alertsGiven.has(`${period} ${bucket} low-bucket`)) {
        due.push({ kind: 'low-bucket', bucket, period, amount, startedWith: started[bucket] });
      }
    }
    const alerts = book.takeAlerts({ bankConnection: 'ok', bankBalances: this.#bank.balances() });
    const given: ExpectedAlert[] = [];
    for (const alert of alerts) {
      if (alert.kind === 'totals-mismatch') {
        // The self-check fails here, between the bank's activity and an answer:
        // the same failure as at the end of the day (12.3).
        const check = book.selfCheck(this.#bank.balances());
        throw new CheckFailed('12.3 daily self-check', `bank side ${check.bankSide} + in transit ${check.inTransit} should equal app side ${check.appSide}; difference ${check.difference}`);
      }
      if (alert.kind === 'bank-login') throw new CheckFailed('10.5 no bank-login alert when all is well', JSON.stringify(alert));
      if (alert.kind === 'daily-review') continue;
      if (alert.kind === 'bank-took-back') {
        // 10.6: once, for each transaction the bank took back since the alerts were last taken.
        const expected = this.#tookBack.shift();
        if (expected === undefined || !same(alert, { kind: 'bank-took-back', ...expected })) throw new CheckFailed('10.6 the take-back alert', `${JSON.stringify(alert)}, expected ${JSON.stringify(expected)}`);
        given.push({ kind: 'bank-took-back', ...expected });
        continue;
      }
      if (alert.amount !== pots[alert.bucket] || (alert.kind === 'low-bucket' && alert.startedWith !== started[alert.bucket])) throw new CheckFailed('10.1 and 10.2 alert amounts', JSON.stringify(alert));
      given.push(alert.kind === 'low-bucket' ? { kind: 'low-bucket', bucket: alert.bucket, period, amount: alert.amount, startedWith: alert.startedWith } : { kind: 'empty-bucket', bucket: alert.bucket, period, amount: alert.amount });
      this.#alertsGiven.add(`${period} ${alert.bucket} ${alert.kind}`);
    }
    const names = (list: readonly ExpectedAlert[]): string[] =>
      list
        .filter((a) => a.kind !== 'bank-took-back')
        .map((a) => JSON.stringify(sortedKeys(a)))
        .sort();
    if (!same(names(given), names(due))) {
      throw new CheckFailed('10.1 and 10.2 low and empty alerts', `due ${JSON.stringify(due)}, given ${JSON.stringify(given)}, with needs ${pots.needs} and wants ${pots.wants} after starting at ${JSON.stringify(started)}`);
    }
    if (this.#tookBack.length > 0) throw new CheckFailed('10.6 the take-back alert', `no alert for ${JSON.stringify(this.#tookBack)}`);
    // 10.14: a paycheck counted since the last point, once; setup day is not one.
    if (this.#paychecksSeen > this.#paychecksTold) given.push(this.#paydayAlert());
    this.#paychecksTold = this.#paychecksSeen;
    return given;
  }

  #paydayAtTheAnswer(): void {
    const last = this.#steps.at(-1);
    if (last?.kind !== 'answer') throw new CheckFailed('10.14 the payday alert', `a paycheck from review with no answer step before it (${last?.kind ?? 'none'})`);
    this.#steps[this.#steps.length - 1] = { ...last, alerts: [...last.alerts, this.#paydayAlert()] };
    this.#paychecksTold = this.#paychecksSeen;
  }

  // 10.14 with 3.8, worked out here: the savings bucket and the mom reserve
  // should be in the savings account; money on its way there counts as moved
  // (B46), once the book knows it is a transfer (one the bank showed as
  // spending counts only once the person has marked it, 5.6); anything over
  // is shown on its own.
  #paydayAlert(): ExpectedAlert {
    if (this.#settings.oldCardPromoEndDate !== null) throw new CheckFailed('10.14 the payday alert', 'this life has no payoff countdown to work out');
    const pots = this.#book.pots();
    const onItsWay = this.#bank.halvesShowing().reduce((sum, h) => sum + (h.kind === 'transfer-sent' && h.to === 'savings' && !this.#notMarkedYet.has(h.id) ? h.amount : 0), 0);
    const gap = pots.savings + pots.momReserve - (this.#bank.posted.savings + onItsWay);
    return { kind: 'payday', period: this.#paychecksSeen, date: this.#lastPaycheckDate, toSavings: Math.max(0, gap), extraInSavings: Math.max(0, -gap), oldCard: null };
  }

  // The evening, at the daily review time: the daily review only when
  // something waits (10.3), with how many, and the card reminders and the
  // overdue alert for the latest statement of each card (9.1 to 9.4).
  #eveningPoint(waiting: number): void {
    const alerts = this.#book.takeAlerts({ bankConnection: 'ok', bankBalances: this.#bank.balances() });
    const review = alerts.find((a) => a.kind === 'daily-review');
    if (alerts.some((a) => a.kind !== 'daily-review')) throw new CheckFailed('10.1 10.2 10.6 nothing new since the last sync or answer', JSON.stringify(alerts));
    if ((waiting > 0) !== (review !== undefined)) throw new CheckFailed('10.3 the daily review only when something waits', `${waiting} waiting`);
    if (review !== undefined && (review.waiting !== waiting || review.at !== this.#settings.dailyReviewTime)) throw new CheckFailed('10.3 the daily review', `${JSON.stringify(review)} with ${waiting} waiting`);
    const expected: ExpectedAlert[] = waiting > 0 ? [{ kind: 'daily-review', waiting }] : [];
    for (const card of ['everyday-card', 'old-card', 'second-card'] as const) {
      const statement = this.#latestStatement[card];
      if (statement !== undefined) expected.push(...this.#cardAlerts(statement));
    }
    this.#steps.push({ kind: 'evening', alerts: expected });
  }

  // The buckets changed by exactly this much, and nothing else changed
  // (apart from any buckets this check leaves out).
  #expectChange(before: Pots, change: Change, check: string, what: string, leaveOut: readonly PotName[] = []): void {
    const after = this.#book.pots();
    for (const key of this.#potNames) {
      if (leaveOut.includes(key)) continue;
      const expected = (before[key] ?? 0) + (change[key] ?? 0);
      if (after[key] !== expected) throw new CheckFailed(check, `${what}: ${key} went from ${before[key]} to ${after[key]}, expected ${expected}`);
    }
  }

  #note(line: string): void {
    this.#recent.push(`${this.#date} ${line}`);
    if (this.#recent.length > 25) this.#recent.shift();
  }
}

// A whole-number percent of an amount, rounded down, without floating point.
function share(amount: Cents, percent: number): Cents {
  const hundredths = amount * percent;
  return (hundredths - (hundredths % 100)) / 100;
}

// Random parts of an amount, one for each bucket, each at least a cent.
function splitInto<B extends string>(r: Random, amount: Cents, buckets: readonly B[]): { bucket: B; amount: Cents }[] {
  let left = amount;
  return buckets.map((bucket, i) => {
    const part = i === buckets.length - 1 ? left : r.int(1, left - (buckets.length - 1 - i));
    left -= part;
    return { bucket, amount: part };
  });
}

// The same plain data, whatever order the keys are in.
// A paycheck's parts, Wishlist's where the split names it.
function partsOf(split: { readonly momReserve: Cents; readonly savings: Cents; readonly needs: Cents; readonly wants: Cents; readonly wishlist?: Cents }) {
  const { momReserve, savings, needs, wants, wishlist } = split;
  return { momReserve, savings, needs, wants, ...(wishlist === undefined ? {} : { wishlist }) };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortedKeys(a)) === JSON.stringify(sortedKeys(b));
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, sortedKeys(v)]),
    );
  }
  return value;
}

export function describeFailure(result: Extract<LifeResult, { ok: false }>, years: number, profile: 'upstream' | 'her' = 'upstream'): string {
  return [
    `Simulated life${profile === 'her' ? ' shaped like hers' : ''} failed: seed ${result.seed}, day ${result.day} (${result.date}), check "${result.check}".`,
    result.message,
    `Replay: node scripts/simulate.mjs${profile === 'her' ? ' --profile her' : ''} --seed ${result.seed} --years ${years}`,
    'Last things that happened:',
    ...result.recent.map((line) => `  ${line}`),
  ].join('\n');
}

// Section 2 (A48), the simulator's own way: a twice-a-month payday is the
// last weekday on or before the 15th or the last day of the month. The next
// payday is the one after the payday nearest the last paycheck (halfway
// counts as the earlier one).
function twiceAMonthNextPayday(last: IsoDate): IsoDate {
  const paydays: IsoDate[] = [];
  const first = new Date(`${last}T00:00:00Z`);
  for (let m = -2; m <= 3; m++) {
    const year = first.getUTCFullYear();
    const month = first.getUTCMonth() + m;
    for (const target of [new Date(Date.UTC(year, month, 15)), new Date(Date.UTC(year, month + 1, 0))]) {
      while (target.getUTCDay() === 0 || target.getUTCDay() === 6) target.setUTCDate(target.getUTCDate() - 1);
      paydays.push(target.toISOString().slice(0, 10));
    }
  }
  let nearest = 0;
  for (let i = 1; i < paydays.length; i++) {
    if (Math.abs(daysBetween(last, paydays[i]!)) < Math.abs(daysBetween(last, paydays[nearest]!))) nearest = i;
  }
  return paydays[nearest + 1]!;
}

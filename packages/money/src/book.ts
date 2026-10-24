import { ALL_ACCOUNTS, type AccountId } from './accounts.js';
import { ACTIVITY_KINDS, foldLines, type ActivityKind, type ActivityRow, type ActivityWhat, type BucketActivity, type LedgerLine, type PeriodSummary } from './activity.js';
import { bucketLevel, type Alert, type AlertInput } from './alerts.js';
import { isSortBucket, isSpendingBucket, type SortBucket, type SplitBucket } from './buckets.js';
import type { CardPayment, EverydayCard } from './reminders.js';
import { addCents, assertCents, assertPositiveCents, subtractCents, type Cents } from './cents.js';
import { assertIsoDate, daysBetween, monthOf, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import { nextPayday, splitPaycheck, type PaycheckSplit, type SplitSettings } from './payday.js';
import { olderPaycheckWaiting, refuseYesWhileOlderWaits, type WaitingPaycheck } from './paycheck-ask.js';
import { COMMON_WORD_DAYS, likelyPurchases, type LikelyPurchase, type PurchaseCandidate } from './likely-purchases.js';
import { reviewOptions, type PickTo, type ReviewFacts, type ReviewOptions } from './review-options.js';
import { commonPlaceWords, placeName, type RuleOffer } from './rule-offers.js';
import type { LeftoverReport, PaycheckReport, PaydayReport } from './payday-report.js';
import type { ResortDetail } from './resort.js';
import { bankSide, type BankBalances } from './self-check.js';
import {
  checkRules,
  findRule,
  isDepositRuleChoice,
  isMoneyInChoice,
  isPersonPaymentChoice,
  type DepositRuleChoice,
  type MoneyInChoice,
  type PersonPaymentChoice,
  type SortingRule,
} from './rules.js';
import { changeSettings as applySettingsChange, matchesTextRule, validateSettings, type LeftoverChoice, type Settings } from './settings.js';
import { checkOpening, checkSwitches, optionsInThisSetup, refuseOffBalances, refuseOffChoice, refuseOffMove, refuseOffRule, refuseOffSettings, refuseOffTransaction, refuseOffWishlist, type Switches } from './switches.js';
import {
  checkTransaction,
  sameTransaction,
  type BankTransaction,
  type CardCharge,
  type Deposit,
  type PendingChanged,
  type PendingDropped,
  type PersonPayment,
  type Purchase,
  type SavingsWithdrawal,
  type Refund,
  type TakenBack,
  type Transfer,
  type TransferArrived,
  type TransferSent,
} from './transactions.js';

// The book: every bucket and everything waiting in review. Bank activity and
// your answers are applied one at a time, in the order they happen. Each
// entry remembers exactly what it did to the buckets (its effect), so a
// change to an entry undoes the old effect and applies the new one, and the
// buckets can always be added up again from scratch (recountPots).

export interface StartingPots {
  readonly savings: Cents;
  readonly needs: Cents;
  readonly wants: Cents;
  readonly momReserve: Cents;
  readonly heldForOthers: Cents;
  // Her rulebook, section 2: the Wishlist bucket, only in a setup that has it
  // (its switch on). Missing is $0.00 there; upstream's books never have it.
  readonly wishlist?: Cents;
}

export interface Pots extends StartingPots {
  // Deposits and refunds waiting in review (rule 12.2).
  readonly unsortedIn: Cents;
  // Spending waiting in review (rule 4.3).
  readonly unsortedOut: Cents;
}

type PotName = keyof Pots;
// What an entry does to the totals: the pots, plus the old card debt, which
// is tracked on its own and is not part of the self-check (12.4), plus the
// money in transit between checking, savings, and the everyday card (12.5).
type TotalName = PotName | 'oldCardDebt' | 'inTransit';
type Effect = Partial<Record<TotalName, Cents>>;

const POT_NAMES: readonly PotName[] = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers', 'unsortedIn', 'unsortedOut', 'wishlist'];
const TOTAL_NAMES: readonly TotalName[] = [...POT_NAMES, 'oldCardDebt', 'inTransit'];

export interface OpenBookInput {
  // The day tracking starts.
  readonly date: IsoDate;
  readonly pots: StartingPots;
  readonly oldCardDebt: Cents;
  // The pay schedule counts from this date until the first paycheck arrives.
  readonly lastPaycheckDate: IsoDate;
  readonly settings: Settings;
  readonly rules?: readonly SortingRule[];
  // Charges pending on setup day. They are already in the starting money,
  // so they start out counted (see startTracking).
  readonly countedAtSetup?: readonly (Purchase | SavingsWithdrawal)[];
  // Transfers with only one half showing on setup day (12.5): money that had
  // left and not arrived, or arrived before it was seen leaving. The
  // starting money allows for them.
  readonly inTransitAtSetup?: readonly (TransferSent | TransferArrived)[];
  // Her rulebook, "Off in this setup": the mom reserve and the old card, on or
  // off, fixed for good on setup day. None given is upstream's: both on.
  readonly switches?: Switches;
}

export type ReceiveOutcome = 'paycheck' | 'sorted' | 'posted' | 'dropped' | 'changed' | 'taken-back' | 'review' | 'duplicate';

export interface Received {
  readonly id: string;
  readonly outcome: ReceiveOutcome;
}

export type LeftoverAnswer = 'roll-over' | 'move-to-savings';

// Part of a split (4.4). A payment to a person can also have a part that is
// not mine (7.6).
export interface SplitPart {
  readonly bucket: SortBucket | 'not-mine';
  readonly amount: Cents;
}

// How you sort something in review, or re-sort it later (4.7). transfer
// names your other account, for spending or money in that was really a
// transfer between your accounts (5.6). refundOf names the purchase a refund
// waiting in review belongs to (4.5, QUESTIONS.md A18).
export type SortChoice =
  | MoneyInChoice
  | PersonPaymentChoice
  | { readonly split: readonly SplitPart[] }
  | { readonly transfer: AccountId }
  | { readonly refundOf: string }
  // QUESTIONS.md A21: "It was not a payment to the old card", for one you
  // marked from savings: it becomes what the bank sent again.
  | { readonly unmark: true };

export type SpendingSort =
  | { readonly to: 'unsorted' }
  // Her rulebook, 4.2: or Wishlist, where the setup has it.
  | { readonly to: SortBucket }
  | { readonly split: readonly SplitPart[] }
  // A payment to a person that was not your spending (7.2).
  | { readonly to: 'not-mine' }
  // A payment to the old card from savings, taken from the savings bucket
  // once you confirm it (QUESTIONS.md A4).
  | { readonly to: 'savings' }
  // A charge pending on setup day, already counted in the starting money.
  | { readonly to: 'counted-at-setup' };

// debt-payoff is a payment to the old card (5.2). mom-difference is the part
// of a mom payment the reserve could not cover (8.3).
export type SpendingKind = 'purchase' | 'card-fee' | 'card-interest' | 'debt-payoff' | 'person-payment' | 'mom-difference';

export type ReviewItem =
  | {
      readonly type: 'money-in';
      readonly id: string;
      readonly date: IsoDate;
      readonly amount: Cents;
      readonly description: string;
      readonly reason: MoneyInReason;
    }
  | {
      readonly type: 'spending';
      readonly id: string;
      readonly date: IsoDate;
      readonly amount: Cents;
      readonly description: string;
      readonly reason:
        | 'no-rule'
        // Money leaving savings always waits (4.9).
        | 'from-savings'
        | 'card-fee'
        | 'card-interest'
        | 'split-changed'
        | 'old-card-from-savings'
        | 'person-payment'
        | 'mom-difference'
        | 'setup-difference';
      // Savings only for a payment to the old card from savings (A4).
      readonly suggestion: SplitBucket | 'savings' | null;
    }
  | {
      // A new purchase on the old card (5.4): a flag to see, not money to sort.
      readonly type: 'old-card-purchase';
      readonly id: string;
      readonly date: IsoDate;
      readonly amount: Cents;
      readonly description: string;
    }
  | {
      readonly type: 'leftover';
      readonly id: string;
      readonly date: IsoDate;
      readonly bucket: SplitBucket;
      // What the question asks about now.
      readonly amount: Cents;
      // What the bucket held at payday, and how much spending made before
      // payday that showed up or changed since took off it (B4, B109).
      // amount + lessSincePayday = atPayday.
      readonly atPayday: Cents;
      readonly lessSincePayday: Cents;
    };

// paycheck: a deposit the paycheck rule matched, waiting for your yes while
// "Ask before splitting a paycheck" is on (her rulebook, 3.1).
export type MoneyInReason = 'deposit' | 'early-paycheck' | 'refund' | 'paycheck';

// Everything review shows about one waiting item, worked out by the money
// math so the screens never decide anything themselves.
export interface ReviewDetail {
  readonly item: ReviewItem;
  // Where it happened; null for a leftover question.
  readonly account: AccountId | null;
  readonly pending: boolean;
  // The choices the rulebook gives for this kind of item.
  readonly options: ReviewOptions;
  // 20d, A15: for a refund, the purchases it likely belongs to.
  readonly likelyPurchases: readonly LikelyPurchase[];
  // 3.2, 3.3: for a deposit that could be my paycheck, the split it would get.
  readonly paycheckPreview: PaycheckSplit | null;
}

// 13.8: what a sorting rule could cover in an entry: the kind of rule, the
// account and day, the description as it first showed up, and every
// description it has had (as it first showed up and as it posted).
interface Place {
  readonly for: RuleOffer['for'];
  readonly account: AccountId;
  readonly date: IsoDate;
  readonly first: string;
  readonly descriptions: readonly string[];
}

// 40.2: what one item spent out of needs or wants in a pay period (Book.spentIn).
export interface SpentItem {
  readonly id: string;
  readonly pot: SplitBucket;
  // Spent: positive. The day of the purchase (4.1).
  readonly amount: Cents;
  readonly date: IsoDate;
  // As the bank describes it now (posted, once it posts).
  readonly description: string;
  readonly account: AccountId | null;
  // Null for an item the book no longer has.
  readonly kind: SpendingKind | null;
}

export interface PurchaseView {
  readonly id: string;
  // The day of the purchase, even after it posts (4.1).
  readonly date: IsoDate;
  readonly description: string;
  readonly amount: Cents;
  readonly refunded: Cents;
  // The part already counted in the starting money on setup day.
  readonly countedAtSetup: Cents;
  readonly pending: boolean;
  readonly kind: SpendingKind;
  readonly sortedTo: SpendingSort;
}

export interface PaycheckRecord {
  readonly id: string;
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly split: PaycheckSplit;
}

export interface Period {
  // 0 is the stretch from setup day to the first paycheck.
  readonly number: number;
  readonly startDate: IsoDate;
}

// Rule 7.3: held for others should come back to zero. Negative means
// someone owes you.
export interface OthersMoney {
  readonly heldForOthers: Cents;
  readonly meaning: 'settled' | 'holding-for-others' | 'owed-to-you';
}

export interface MomMonth {
  readonly month: string;
  readonly sent: Cents;
  readonly target: { readonly low: Cents; readonly high: Cents };
}

export interface SafeToSpend {
  readonly amount: Cents;
  readonly nextPayday: IsoDate;
  // Negative when the expected paycheck is late.
  readonly daysToPayday: number;
}

// Rule 12.3: the bank side, plus money in transit (12.5), must equal the
// app side.
export interface SelfCheck {
  readonly bankSide: Cents;
  // Money that left checking or savings for checking, savings, or the
  // everyday card and has not arrived yet. Negative when the arriving half
  // was seen before the leaving half.
  readonly inTransit: Cents;
  readonly appSide: Cents;
  // Bank side plus in transit, minus app side. Zero when they match.
  readonly difference: Cents;
  readonly ok: boolean;
}

// Rule 12.5: transfers with only one half seen so far.
export interface InTransitItem {
  readonly id: string;
  readonly date: IsoDate;
  readonly from: 'checking' | 'savings';
  readonly to: AccountId;
  readonly amount: Cents;
  // Which half the app has seen.
  readonly seen: 'left' | 'arrived';
}

export interface InTransit {
  // The amount the self-check counts. Money on its way to the old card is
  // listed but not counted (12.4).
  readonly total: Cents;
  readonly items: readonly InTransitItem[];
}

// Her rulebook, 52.2 and 52.4 (PR 7+8): one thing the book holds on a card
// used day to day, as it holds it now (Book.cardEntries). owes is what it
// adds to what the card owes now: a charge above zero, a refund or a payment
// that reached the card below. atSetup is the part of it already in the
// card's balance on setup day. posted is null while it is still pending or
// was dropped: it is on no statement.
// takenBack: the bank took it back (4.10), and owed is what it added before.
interface CardEntryBase {
  readonly id: string;
  // The bank's id and day for it as posted (the book's own; the bank's
  // posted day can differ, statement.ts asks for it).
  readonly posted: { readonly id: string; readonly date: IsoDate } | null;
  // The day of the purchase (4.1), or the day it reached the card.
  readonly date: IsoDate;
  readonly description: string;
  readonly owes: Cents;
  readonly atSetup: Cents;
  readonly takenBack: { readonly id: string; readonly date: IsoDate; readonly owed: Cents } | null;
}

export type CardEntry =
  | (CardEntryBase & { readonly kind: 'charge'; readonly spendingKind: SpendingKind; readonly sortedTo: SpendingSort })
  // A refund counted on the purchase it belongs to (refundOf), or money in
  // on the card sorted on its own (4.5, 6.1).
  | (CardEntryBase & { readonly kind: 'refund'; readonly refundOf: string | null; readonly sortedTo: MoneyInEntry['sortedTo'] })
  | (CardEntryBase & { readonly kind: 'payment' });

// Her rulebook, 50.4: one purchase's part in Wishlist (Book.wishlistFlows).
export interface WishlistPurchase {
  readonly id: string;
  // The day of the purchase (4.1).
  readonly date: IsoDate;
  // Where it left from: checking (the debit card) or a card.
  readonly account: AccountId;
  // What it takes from Wishlist now, less refunds: above zero.
  readonly amount: Cents;
  // The bank's id and the book's day for it as posted; null while pending.
  readonly posted: { readonly id: string; readonly date: IsoDate } | null;
}

export interface WishlistFlows {
  readonly purchases: readonly WishlistPurchase[];
  readonly paidBack: Cents;
  readonly movedToChecking: Cents;
}

// Rule 0.5: safe to spend only when the totals match the bank.
export type CheckedSafeToSpend =
  | { readonly ok: true; readonly safeToSpend: SafeToSpend }
  | { readonly ok: false; readonly difference: Cents; readonly nextPayday: IsoDate; readonly daysToPayday: number };

// The buckets you can move money between by hand (13.3). Her rulebook:
// Wishlist too, only in a setup that has it (section 2).
export type Pot = 'savings' | 'needs' | 'wants' | 'momReserve' | 'heldForOthers';
// Any bucket of any setup: upstream's, and Wishlist.
export type AnyPot = Pot | 'wishlist';

// What each bucket holds, Wishlist only where the setup has it.
export type PotAmounts = Readonly<Record<Pot, Cents>> & { readonly wishlist?: Cents };

// The buckets money can be moved between by hand (13.3), and the ones whose
// activity is kept (QUESTIONS.md B97), in the order to show them: upstream's,
// with Wishlist after wants where the setup has it (Book.movablePots).
export const MOVABLE_POTS: readonly Pot[] = Object.freeze(['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'] as const);
const WITH_WISHLIST: readonly AnyPot[] = Object.freeze(['savings', 'needs', 'wants', 'wishlist', 'momReserve', 'heldForOthers'] as const);

export interface MoneyMove {
  readonly from: AnyPot;
  readonly to: AnyPot;
  readonly amount: Cents;
  // Needed to move money out of savings or the mom reserve (13.4), or Wishlist.
  readonly confirmed?: boolean;
}

// Why a hand move asks you to confirm first (13.4; her rulebook: out of Wishlist too).
export type ConfirmReason = 'out-of-savings' | 'out-of-mom-reserve' | 'out-of-wishlist' | 'below-zero';

export type MoveResult =
  | { readonly moved: true }
  | { readonly moved: false; readonly needsConfirmation: true; readonly reasons: readonly ConfirmReason[] };

// Rule 13.5: every change and every manual move, with its date.
export type ChangeLogEntry =
  // changes: the new value of each setting changed; before: what it was.
  | { readonly date: IsoDate; readonly kind: 'settings-changed'; readonly changes: Partial<Settings>; readonly before: Partial<Settings> }
  | { readonly date: IsoDate; readonly kind: 'rule-added'; readonly rule: SortingRule }
  // 13.6: added by correcting an item, ahead of the rule it corrects (null
  // when no rule had sorted that item).
  | {
      readonly date: IsoDate;
      readonly kind: 'rule-added-from-correction';
      readonly rule: SortingRule;
      readonly correcting: string;
      readonly aheadOf: string | null;
    }
  | { readonly date: IsoDate; readonly kind: 'rule-changed'; readonly before: SortingRule; readonly after: SortingRule }
  | { readonly date: IsoDate; readonly kind: 'rule-removed'; readonly rule: SortingRule }
  // A22: a rule moved one place up or down among the rules of its kind, past
  // another; position is its place among them now, from 1.
  | { readonly date: IsoDate; readonly kind: 'rule-moved'; readonly rule: SortingRule; readonly past: SortingRule; readonly direction: 'up' | 'down'; readonly position: number }
  | { readonly date: IsoDate; readonly kind: 'money-moved'; readonly from: AnyPot; readonly to: AnyPot; readonly amount: Cents }
  // 4.10: the bank took back a transaction the app had counted.
  | { readonly date: IsoDate; readonly kind: 'bank-took-back'; readonly id: string; readonly description: string; readonly amount: Cents };

// QUESTIONS.md A9: a waiting item a new paycheck rule or mom rule handles.
// A deposit becomes a paycheck (3.1), with its split, or, less than 10 days
// after the last paycheck or older than it, waits as an early paycheck (3.7,
// B54). A payment to a person comes out of the mom reserve (8.1); what the
// reserve cannot cover waits in review (8.3).
export type RecheckedItem =
  | { readonly kind: 'paycheck'; readonly id: string; readonly date: IsoDate; readonly amount: Cents; readonly description: string; readonly split: PaycheckSplit }
  | { readonly kind: 'early-paycheck'; readonly id: string; readonly date: IsoDate; readonly amount: Cents; readonly description: string }
  // Her rulebook, 13.2: with "Ask before splitting a paycheck" on, it becomes
  // a paycheck waiting for your yes, and is not split.
  | { readonly kind: 'paycheck-waiting'; readonly id: string; readonly date: IsoDate; readonly amount: Cents; readonly description: string; readonly wouldGet: PaycheckSplit | null }
  | {
      readonly kind: 'mom';
      readonly id: string;
      readonly date: IsoDate;
      readonly amount: Cents;
      readonly description: string;
      readonly fromReserve: Cents;
      readonly difference: Cents;
    }
  // 13.2, B73: a payment the new mom rule matches but that cannot come out of
  // the mom reserve, because part of it was refunded. It stays waiting
  // exactly as it was; amount is what waits.
  | { readonly kind: 'still-waiting'; readonly id: string; readonly date: IsoDate; readonly amount: Cents; readonly description: string; readonly why: 'partly-refunded' };

// What a change to the settings would do, worked out before it is done (A9):
// the waiting items it would handle, oldest first, and every bucket and the
// number of items waiting, before and after.
export interface SettingsPreview {
  readonly items: readonly RecheckedItem[];
  readonly potsBefore: Pots;
  readonly potsAfter: Pots;
  readonly waitingBefore: number;
  readonly waitingAfter: number;
}

// Thrown to undo a change that was only being tried out (see previewSettingsChange).
const DRY_RUN: unique symbol = Symbol('dry run');

export interface SavingsTransfer {
  readonly shouldBeInSavings: Cents;
  readonly savingsAccountBalance: Cents;
  // What still needs to go into the savings account; $0 when it holds enough.
  readonly stillToMove: Cents;
  // Only when the account holds more than it should: by how much (3.8).
  readonly extraInSavings?: Cents;
}

// Every entry made from a bank transaction can be taken back by the bank
// (4.10). It then stays in the book, doing nothing, so the bank sending it
// again is still known.
interface FromTheBank {
  takenBack?: boolean;
}

interface PaycheckEntry extends FromTheBank {
  readonly kind: 'paycheck';
  readonly id: string;
  readonly txn: Deposit;
  readonly split: PaycheckSplit;
  effect: Effect;
}

interface MoneyInEntry extends FromTheBank {
  readonly kind: 'money-in';
  readonly id: string;
  readonly txn: Deposit | Refund;
  // A deposit waiting as a plain deposit becomes an early paycheck when a
  // new paycheck rule matches it (A9).
  reason: MoneyInReason;
  // A deposit you call your paycheck becomes a paycheck entry instead. Her
  // rulebook, 6.1: payback can go into Wishlist too.
  sortedTo: 'unsorted' | DepositRuleChoice['to'] | 'wishlist';
  // 13.8: he sorted it himself (in review or from a bucket's list), not a rule.
  byHand?: boolean;
  // How it was split, when sorted as other income.
  incomeSplit: PaycheckSplit | null;
  effect: Effect;
}

// Spending, or something you marked as a transfer (5.6): original is then
// what the bank sent, which sorting it some other way brings back.
interface SpendEntry extends FromTheBank {
  readonly kind: 'spend';
  readonly id: string;
  readonly txn: Purchase | SavingsWithdrawal | CardCharge | Transfer | TransferSent | PersonPayment;
  readonly spendingKind: SpendingKind;
  postedTxn: Purchase | SavingsWithdrawal | null;
  pending: boolean;
  amount: Cents;
  // 13.8: he sorted it himself (in review or from a bucket's list), not a rule.
  byHand?: boolean;
  refunded: Cents;
  // The part already taken out of the starting money on setup day.
  readonly countedAtSetup: Cents;
  sortedTo: SpendingSort;
  // True when a split stopped adding up and was sent back to review.
  splitChanged: boolean;
  // True when the bank dropped it while pending (QUESTIONS.md A2).
  dropped?: boolean;
  original?: MarkedAsTransfer;
  // The posted version, when what you marked had been pending.
  originalPosted?: Purchase | SavingsWithdrawal;
  effect: Effect;
}

// What the bank sent that you can mark as a transfer between your accounts (5.6).
type MarkedAsTransfer = Purchase | SavingsWithdrawal | PersonPayment | Deposit | Refund;

// A refund matched to its purchase. Its money is counted on the purchase.
interface RefundEntry extends FromTheBank {
  readonly kind: 'refund';
  readonly id: string;
  readonly txn: Refund;
  readonly of: string;
  effect: Effect;
}

// A payment to mom (8.1). It takes what it can from the mom reserve; any
// difference is a separate spending entry waiting in review (8.3). how:
// the mom rule matched it (it always stays on the reserve), or a person
// rule or you picked "for mom" (7.6), which can be sorted again.
interface MomEntry extends FromTheBank {
  readonly kind: 'mom';
  readonly id: string;
  readonly txn: PersonPayment;
  readonly fromReserve: Cents;
  readonly how: 'mom-rule' | 'person-rule' | 'by-hand';
  effect: Effect;
}

// One half of a transfer (12.5). The leaving half of a payment to the old
// card is a spending entry instead (5.2), except on setup day.
interface LegEntry extends FromTheBank {
  readonly kind: 'leg';
  readonly id: string;
  readonly txn: TransferSent | TransferArrived;
  original?: MarkedAsTransfer;
  originalPosted?: Purchase | SavingsWithdrawal;
  effect: Effect;
}

// Money you moved by hand (13.3).
interface MoveEntry {
  readonly kind: 'move';
  readonly id: string;
  readonly date: IsoDate;
  readonly from: AnyPot;
  readonly to: AnyPot;
  effect: Effect;
}

// A transfer that changes no bucket (5.1, 5.3), kept so it counts once.
interface TransferEntry extends FromTheBank {
  readonly kind: 'transfer';
  readonly id: string;
  readonly txn: Transfer;
  effect: Effect;
}

// Old card activity that changes only the debt (5.4, 5.5).
interface OldCardEntry extends FromTheBank {
  readonly kind: 'old-card';
  readonly id: string;
  readonly txn: Purchase | CardCharge | Refund;
  postedTxn: Purchase | SavingsWithdrawal | null;
  pending: boolean;
  amount: Cents;
  // The part already in the old card balance on setup day.
  readonly countedAtSetup: Cents;
  effect: Effect;
}

// A leftover question at payday (3.4). amount is what was unspent at
// payday; spentBefore is what spending made before payday had taken from
// the bucket then. Spending made before payday that shows up or changes
// afterward lowers the question, while it is open (B4).
interface LeftoverEntry {
  readonly kind: 'leftover';
  readonly id: string;
  readonly date: IsoDate;
  readonly bucket: SplitBucket;
  readonly amount: Cents;
  readonly spentBefore: Cents;
  answer: 'open' | LeftoverAnswer;
  // What the question asked about when it was answered (B4, B109); null while it is open.
  answeredFor: Cents | null;
  effect: Effect;
}

type Entry =
  | PaycheckEntry
  | MoneyInEntry
  | SpendEntry
  | RefundEntry
  | MomEntry
  | TransferEntry
  | LegEntry
  | OldCardEntry
  | LeftoverEntry
  | MoveEntry;

// Which kind of entry made a change to a bucket, for the ledger (B97). The
// kinds that never touch a bucket (a refund counts on its purchase, a transfer
// only moves money in transit, old card activity only changes the debt) have none.
function ledgerKind(entry: Entry): ActivityKind | null {
  switch (entry.kind) {
    case 'paycheck':
      return 'paycheck';
    case 'money-in':
      return 'money-in';
    case 'spend':
      return 'spending';
    case 'mom':
      return 'mom';
    case 'move':
      return 'move';
    case 'leftover':
      return 'leftover';
    case 'refund':
    case 'leg':
    case 'transfer':
    case 'old-card':
      return null;
  }
}

// Wishlist's lines are kept where the setup has it; elsewhere it never changes.
const POT_NAMES_SET: ReadonlySet<string> = new Set(WITH_WISHLIST);

// A pay period as the ledger knows it: when it began, what every bucket held
// then, and what the paycheck that began it was worked out with (3.3, 13.1)
// and what the leftover setting said (3.4). Pay period 0, the stretch from
// setup day to the first paycheck, has no paycheck.
interface PeriodRecord {
  readonly number: number;
  readonly startDate: IsoDate;
  readonly opening: PotAmounts;
  // 40.13: what the old card owed then (12.4).
  readonly openingDebt: Cents;
  readonly split: SplitSettings;
  readonly leftoverSetting: Readonly<Record<SplitBucket, LeftoverChoice>> | null;
  readonly paycheckId: string | null;
}

// Why spending of each kind is waiting in review.
function spendingReason(kind: SpendingKind): 'no-rule' | 'card-fee' | 'card-interest' | 'old-card-from-savings' | 'person-payment' | 'mom-difference' {
  switch (kind) {
    case 'purchase':
      return 'no-rule';
    case 'debt-payoff':
      return 'old-card-from-savings';
    default:
      return kind;
  }
}

// What a spending entry takes from the buckets: its amount, less refunds,
// less any part already counted on setup day.
function netOf(entry: SpendEntry): Cents {
  return entry.amount - entry.refunded - entry.countedAtSetup;
}

// Two halves of a transfer fit together when they go between the same
// accounts for the same amount.
function sameRoute(a: TransferSent | TransferArrived, b: TransferSent | TransferArrived): boolean {
  return a.from === b.from && a.to === b.to && a.amount === b.amount;
}

// 13.1: the settings a pay period keeps from its paycheck (FROM_NEXT_PAYCHECK).
function splitSettingsOf(settings: Settings): SplitSettings {
  const { split, momReservePerPaycheck, momReserveCap } = settings;
  return Object.freeze({ split, momReservePerPaycheck, momReserveCap });
}

// Wishlist only where the setup has it (her rulebook, section 2).
function potsOf(totals: Record<TotalName, Cents>, switches: Switches): Pots {
  const { savings, needs, wants, momReserve, heldForOthers, unsortedIn, unsortedOut, wishlist } = totals;
  return Object.freeze({ savings, needs, wants, momReserve, heldForOthers, unsortedIn, unsortedOut, ...(switches.wishlist === 'on' ? { wishlist } : {}) });
}

export function openBook(input: OpenBookInput): Book {
  return new Book(input);
}

export class Book {
  readonly #opening: Required<StartingPots> & { readonly oldCardDebt: Cents };
  readonly #totals: Record<TotalName, Cents>;
  readonly #entries = new Map<string, Entry>();
  // Posted transaction id -> the entry of the pending purchase it replaced.
  readonly #aliases = new Map<string, string>();
  // The two halves of a transfer, paired both ways (12.5).
  readonly #pairs = new Map<string, string>();
  // Ids of entries waiting for you, in the order they arrived.
  readonly #review = new Set<string>();
  // Pending charges the bank dropped, by the id of the drop (QUESTIONS.md A2).
  readonly #drops = new Map<string, PendingDropped>();
  // Pending charges whose amount the bank changed, by the id of the change (A13).
  readonly #changes = new Map<string, PendingChanged>();
  // Transactions the bank took back, by the id of the take-back (A14).
  readonly #takenBacks = new Map<string, TakenBack>();
  // Halves of transfers given on setup day: already in the balances then (52.2).
  readonly #setupLegs = new Set<string>();
  // Alerts that come once, when something happens (10.6), not yet given.
  readonly #notices: Alert[] = [];
  readonly #paychecks: PaycheckRecord[] = [];
  readonly #log: ChangeLogEntry[] = [];
  // Numbers hand moves, so each one has its own id.
  #moveCount = 0;
  // The pay period in which each bucket's low and empty alerts were last
  // given (10.1, 10.2).
  readonly #lowAlerted: Record<SplitBucket, number | null> = { needs: null, wants: null };
  readonly #emptyAlerted: Record<SplitBucket, number | null> = { needs: null, wants: null };
  // What needs and wants started this pay period with (10.1): what payday
  // left in them, rollover and overspending included, less a leftover you
  // then moved to savings. Before the first paycheck, what setup day gave.
  readonly #periodStart: Record<SplitBucket, Cents>;
  #settings: Settings;
  readonly #switches: Switches;
  // The split and mom reserve settings in force for this pay period. A
  // change to them waits for the next paycheck (13.1).
  #periodSplit: SplitSettings;
  #rules: readonly SortingRule[];
  #lastPaycheckDate: IsoDate;
  #period: Period;
  // The ledger (QUESTIONS.md B97): every change to a bucket, in the pay period
  // it was counted in, so what went in and out of a bucket can always be read
  // back and always adds up to what the bucket holds. A line is added
  // whenever an entry's effect changes, and never taken away. Pay period k's
  // lines are in #ledger[k]; #periods[k] says how it began.
  readonly #periods: PeriodRecord[] = [];
  readonly #ledger: LedgerLine[][] = [];

  constructor(input: OpenBookInput) {
    assertIsoDate(input.date, 'start date');
    assertIsoDate(input.lastPaycheckDate, 'last paycheck date');
    assertCents(input.oldCardDebt, 'old card debt');
    const { savings, needs, wants, momReserve, heldForOthers, wishlist = 0 } = input.pots;
    this.#opening = Object.freeze({ savings, needs, wants, momReserve, heldForOthers, wishlist, oldCardDebt: input.oldCardDebt });
    for (const [name, value] of Object.entries(this.#opening)) assertCents(value, name);
    this.#totals = { ...this.#opening, unsortedIn: 0, unsortedOut: 0, inTransit: 0 };
    addCents(savings, needs, wants, momReserve, heldForOthers, wishlist);
    this.#settings = validateSettings(input.settings);
    this.#switches = checkSwitches(input.switches);
    const setupActivity = [...(input.countedAtSetup ?? []), ...(input.inTransitAtSetup ?? [])];
    checkOpening(this.#switches, { momReserve, wishlist, oldCardDebt: input.oldCardDebt, settings: this.#settings, oldCardActivity: setupActivity.some((t) => ('account' in t && t.account === 'old-card') || ('to' in t && t.to === 'old-card')), setupActivity });
    this.#periodSplit = splitSettingsOf(this.#settings);
    this.#rules = checkRules(input.rules ?? []);
    for (const rule of this.#rules) refuseOffRule(this.#switches, rule);
    this.#lastPaycheckDate = input.lastPaycheckDate;
    this.#period = { number: 0, startDate: input.date };
    this.#periods.push({ number: 0, startDate: input.date, opening: this.#potTotals(), openingDebt: this.#totals.oldCardDebt, split: this.#periodSplit, leftoverSetting: null, paycheckId: null });
    this.#ledger.push([]);
    this.#periodStart = { needs, wants };
    for (const txn of input.countedAtSetup ?? []) this.#countAtSetup(txn);
    for (const txn of input.inTransitAtSetup ?? []) this.#inTransitAtSetup(txn);
  }

  // Half of a transfer showing on setup day. Its money is already in the
  // starting money (or the old card balance), so it changes no bucket and no
  // debt here; it only waits, in transit, for its other half. Even a payment
  // to the old card that left before setup day is not spending in the
  // tracked time; it lowers the debt when it lands.
  #inTransitAtSetup(txn: TransferSent | TransferArrived): void {
    checkTransaction(txn);
    if (txn.kind !== 'transfer-sent' && txn.kind !== 'transfer-arrived') {
      throw new MoneyError('bad-transaction', `${String((txn as { id?: unknown }).id)} is not half of a transfer`);
    }
    const copy = Object.freeze({ ...txn });
    const partner = copy.kind === 'transfer-sent' ? this.#arrivalFor(copy) : this.#oldestUnpairedSent(copy);
    const travelling = copy.kind === 'transfer-sent' ? copy.amount : -copy.amount;
    this.#add({ kind: 'leg', id: copy.id, txn: copy, effect: {} }, copy.to === 'old-card' ? {} : { inTransit: travelling });
    this.#setupLegs.add(copy.id);
    if (partner !== undefined) this.#pair(copy.kind === 'transfer-sent' ? copy.id : partner, copy.kind === 'transfer-sent' ? partner : copy.id);
  }

  // A charge pending on setup day changes nothing now: it is already in the
  // starting money (or the old card balance). It is kept so that, when it
  // posts, only the difference counts (QUESTIONS.md A10).
  #countAtSetup(txn: Purchase | SavingsWithdrawal): void {
    checkTransaction(txn);
    if (!txn.pending) throw new MoneyError('bad-transaction', `${txn.id} was not pending on setup day`);
    const copy = Object.freeze({ ...txn });
    if (copy.kind === 'purchase' && copy.account === 'old-card') {
      this.#add({ kind: 'old-card', id: copy.id, txn: copy, postedTxn: null, pending: true, amount: copy.amount, countedAtSetup: copy.amount, effect: {} }, {});
      return;
    }
    const entry: SpendEntry = {
      kind: 'spend',
      id: copy.id,
      txn: copy,
      spendingKind: 'purchase',
      postedTxn: null,
      pending: true,
      amount: copy.amount,
      refunded: 0,
      countedAtSetup: copy.amount,
      sortedTo: { to: 'counted-at-setup' },
      splitChanged: false,
      effect: {},
    };
    this.#addSpendingEntry(entry);
  }

  // ----- Reading -----

  pots(): Pots {
    return potsOf(this.#totals, this.#switches);
  }

  // The old card balance, tracked separately as debt (12.4).
  oldCardDebt(): Cents {
    return this.#totals.oldCardDebt;
  }

  // Adds every bucket up again from the starting amounts and every entry.
  // Must always equal pots(); a difference means the book is broken.
  recountPots(): Pots {
    return potsOf(this.#recount(), this.#switches);
  }

  recountOldCardDebt(): Cents {
    return this.#recount().oldCardDebt;
  }

  #recount(): Record<TotalName, Cents> {
    const totals: Record<TotalName, Cents> = { ...this.#opening, unsortedIn: 0, unsortedOut: 0, inTransit: 0 };
    for (const entry of this.#entries.values()) {
      for (const name of TOTAL_NAMES) totals[name] = addCents(totals[name], entry.effect[name] ?? 0);
    }
    return totals;
  }

  settings(): Settings {
    return this.#settings;
  }

  // Off in this setup: fixed on setup day.
  switches(): Switches {
    return this.#switches;
  }

  // The buckets money can be moved between by hand, and whose activity is
  // kept, in the order to show them: Wishlist after wants where the setup
  // has it (her rulebook, section 2).
  movablePots(): readonly AnyPot[] {
    return this.#switches.wishlist === 'on' ? WITH_WISHLIST : MOVABLE_POTS;
  }

  rules(): readonly SortingRule[] {
    return this.#rules;
  }

  // 13.1: the split and mom reserve in force this pay period: the settings
  // the paycheck that began it was worked out with (setup day's before the
  // first paycheck). A change to them is the setting at once, but waits here
  // until the next paycheck.
  splitInForce(): SplitSettings {
    return this.#periodSplit;
  }

  period(): Period {
    return this.#period;
  }

  // Rule 10.1: what needs and wants started this pay period with.
  startedPeriodWith(): { readonly needs: Cents; readonly wants: Cents } {
    return Object.freeze({ ...this.#periodStart });
  }

  lastPaycheckDate(): IsoDate {
    return this.#lastPaycheckDate;
  }

  paychecks(): readonly PaycheckRecord[] {
    return [...this.#paychecks];
  }

  // Her rulebook, 51.1: the paychecks waiting for your yes, oldest first: the
  // ones the paycheck rule matched while "Ask before splitting a paycheck"
  // was on (3.1), and, while it is on, the early ones (3.7, 51.3).
  paychecksWaiting(): readonly WaitingPaycheck[] {
    const ask = this.#settings.askBeforeSplittingPaycheck === true;
    const found: WaitingPaycheck[] = [];
    for (const id of this.#review) {
      const entry = this.#entry(id);
      if (entry.kind !== 'money-in' || entry.txn.kind !== 'deposit' || !(entry.reason === 'paycheck' || (ask && entry.reason === 'early-paycheck'))) continue;
      const { date, amount, description } = entry.txn;
      const older = daysBetween(this.#lastPaycheckDate, date) < 0;
      found.push(Object.freeze({ id, date, amount, description, early: entry.reason === 'early-paycheck', wouldGet: older ? null : this.#splitIfPaycheck(amount) }));
    }
    return Object.freeze(found.sort((a, b) => daysBetween(b.date, a.date)));
  }

  // 51.2: whether a yes on a deposit of this day waits for an older paycheck.
  #olderWaitingFor(date: IsoDate): boolean {
    return this.#settings.askBeforeSplittingPaycheck === true && olderPaycheckWaiting(this.paychecksWaiting(), this.#lastPaycheckDate, date) !== null;
  }

  purchases(): PurchaseView[] {
    const views: PurchaseView[] = [];
    for (const e of this.#entries.values()) {
      if (e.kind !== 'spend') continue;
      const description = (e.postedTxn ?? e.txn).description;
      views.push({
        id: e.id,
        date: e.txn.date,
        description,
        amount: e.amount,
        refunded: e.refunded,
        countedAtSetup: e.countedAtSetup,
        pending: e.pending,
        kind: e.spendingKind,
        sortedTo: e.sortedTo,
      });
    }
    return views;
  }

  reviewItems(): ReviewItem[] {
    return [...this.#review].map((id) => this.#reviewView(this.#entry(id)));
  }

  // The same items, with what review needs to show each one. Changes nothing.
  reviewDetails(): ReviewDetail[] {
    return [...this.#review].map((id) => {
      const detail = this.#reviewDetail(this.#entry(id));
      return { ...detail, options: optionsInThisSetup(this.#switches, detail.options) };
    });
  }

  // Rules 11.1 to 11.3: wants left, minus unsorted spending. Savings, the
  // mom reserve, held for others, and unsorted money in never count, nor
  // Wishlist (her rulebook, 11.3). Shown
  // with the days to the next payday from the pay schedule.
  safeToSpend(today: IsoDate): SafeToSpend {
    assertIsoDate(today, 'today');
    return {
      amount: subtractCents(this.#totals.wants, this.#totals.unsortedOut),
      ...nextPayday(this.#lastPaycheckDate, this.#settings, today),
    };
  }

  // Rules 12.1 to 12.5. The bank balances must include pending charges
  // (withPendingCharges). The old card is not part of the check.
  selfCheck(bank: BankBalances): SelfCheck {
    refuseOffBalances(this.#switches, bank);
    const bankTotal = bankSide(bank);
    const appTotal = this.appSide();
    const difference = subtractCents(addCents(bankTotal, this.#totals.inTransit), appTotal);
    return { bankSide: bankTotal, inTransit: this.#totals.inTransit, appSide: appTotal, difference, ok: difference === 0 };
  }

  // Rule 12.2: savings + needs + wants + mom reserve + held for others
  // + unsorted money in - unsorted spending. Everything in the buckets. Her
  // rulebook, 12.2: + Wishlist ($0.00 in a setup without it).
  appSide(): Cents {
    const t = this.#totals;
    return subtractCents(addCents(t.savings, t.needs, t.wants, t.momReserve, t.heldForOthers, t.wishlist, t.unsortedIn), t.unsortedOut);
  }

  // Rule 12.5: transfers with only one half seen so far, oldest first.
  inTransit(): InTransit {
    const items: InTransitItem[] = [];
    for (const entry of this.#entries.values()) {
      const txn = 'txn' in entry ? entry.txn : null;
      if (txn === null || (txn.kind !== 'transfer-sent' && txn.kind !== 'transfer-arrived') || this.#pairs.has(entry.id) || this.#gone(entry)) continue;
      const { id, date, from, to, amount } = txn;
      items.push({ id, date, from, to, amount, seen: txn.kind === 'transfer-sent' ? 'left' : 'arrived' });
    }
    return { total: this.#totals.inTransit, items };
  }

  // Rule 0.5: when the totals do not match the bank, say so instead of
  // showing a safe-to-spend number the app cannot back up.
  checkedSafeToSpend(today: IsoDate, bank: BankBalances): CheckedSafeToSpend {
    const safeToSpend = this.safeToSpend(today);
    const check = this.selfCheck(bank);
    if (check.ok) return { ok: true, safeToSpend };
    return { ok: false, difference: check.difference, nextPayday: safeToSpend.nextPayday, daysToPayday: safeToSpend.daysToPayday };
  }

  // Rule 3.8: what should be sitting in the savings account (savings plus
  // the mom reserve; her rulebook, 3.8: plus Wishlist), and how much still
  // needs to be moved there. Negative means the account holds more than the
  // buckets say.
  savingsTransfer(savingsAccountBalance: Cents): SavingsTransfer {
    assertCents(savingsAccountBalance, 'savings account balance');
    const shouldBeInSavings = addCents(this.#totals.savings, this.#totals.momReserve, this.#totals.wishlist);
    // Money already on its way to savings counts as moved (12.5).
    const onItsWay = this.inTransit()
      .items.filter((item) => item.to === 'savings' && item.seen === 'left')
      .map((item) => item.amount);
    const gap = subtractCents(shouldBeInSavings, addCents(savingsAccountBalance, ...onItsWay));
    // 3.8: nothing to move when the account already holds enough; anything
    // over is shown on its own.
    if (gap >= 0) return { shouldBeInSavings, savingsAccountBalance, stillToMove: gap };
    return { shouldBeInSavings, savingsAccountBalance, stillToMove: 0, extraInSavings: -gap };
  }

  // Section 10: the alerts due now. The low and empty bucket alerts come
  // once per bucket per pay period (10.1, 10.2), so taking one marks it as
  // given until the next paycheck. The others come every time they are due.
  takeAlerts(input: AlertInput): Alert[] {
    const alerts: Alert[] = [];
    const newlyLow: SplitBucket[] = [];
    const newlyEmpty: SplitBucket[] = [];
    // 10.1: needs or wants below the alert level, a percent of what the
    // bucket started the pay period with, compared to the exact cent. At
    // zero or below the empty alert covers it, and a bucket that started at
    // zero or below has no level above zero to fall under.
    const percent = this.#settings.lowBucketAlertPercent;
    for (const bucket of ['needs', 'wants'] as const) {
      const amount = this.#totals[bucket];
      const startedWith = this.#periodStart[bucket];
      const low = bucketLevel(amount, startedWith, percent) === 'low';
      if (low && this.#lowAlerted[bucket] !== this.#period.number) {
        alerts.push({ kind: 'low-bucket', bucket, amount, startedWith });
        newlyLow.push(bucket);
      }
    }
    // 10.2: needs or wants at zero or below.
    for (const bucket of ['needs', 'wants'] as const) {
      const amount = this.#totals[bucket];
      if (bucketLevel(amount, this.#periodStart[bucket], percent) === 'empty' && this.#emptyAlerted[bucket] !== this.#period.number) {
        alerts.push({ kind: 'empty-bucket', bucket, amount });
        newlyEmpty.push(bucket);
      }
    }
    // 10.3: at the review time, only if something is waiting.
    const waiting = this.#review.size;
    if (waiting > 0) alerts.push({ kind: 'daily-review', at: this.#settings.dailyReviewTime, waiting });
    // 10.4: the totals do not match the bank (section 12).
    const check = this.selfCheck(input.bankBalances);
    if (!check.ok) alerts.push({ kind: 'totals-mismatch', difference: check.difference });
    // 10.5
    if (input.bankConnection === 'needs-login') alerts.push({ kind: 'bank-login' });
    // 10.6: what the bank took back since the alerts were last taken, in order.
    alerts.push(...this.#notices);
    // Marked only once everything above worked, so a refused call gives nothing.
    for (const bucket of newlyLow) this.#lowAlerted[bucket] = this.#period.number;
    for (const bucket of newlyEmpty) this.#emptyAlerted[bucket] = this.#period.number;
    this.#notices.length = 0;
    return alerts;
  }

  // Rule 8.2: everything sent to mom in a calendar month ("YYYY-MM").
  momSentInMonth(month: string): MomMonth {
    assertIsoDate(`${month}-01`, 'month');
    if (month.length !== 7) throw new MoneyError('not-a-date', `month must be YYYY-MM, got ${month}`);
    let sent = 0;
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'mom' && !this.#gone(entry) && monthOf(entry.txn.date) === month) sent = addCents(sent, entry.txn.amount);
    }
    return { month, sent, target: this.#settings.momMonthlyTarget };
  }

  // Payments the app has seen to a card, oldest first, for the reminders
  // (9.3, 9.4): the day each left and the day it reached the card (12.5).
  // A transfer seen in two halves is one payment.
  cardPayments(card: 'everyday-card' | 'old-card' | 'second-card'): CardPayment[] {
    const payments: CardPayment[] = [];
    for (const entry of this.#entries.values()) {
      const txn = 'txn' in entry ? entry.txn : null;
      if (txn === null || !('to' in txn) || txn.to !== card || this.#gone(entry)) continue;
      const partner = this.#pairs.get(entry.id);
      if (txn.kind === 'transfer') {
        payments.push({ date: txn.date, amount: txn.amount, landedOn: txn.date });
      } else if (txn.kind === 'transfer-sent') {
        payments.push({ date: txn.date, amount: txn.amount, landedOn: partner === undefined ? null : this.#legTxn(partner).date });
      } else if (txn.kind === 'transfer-arrived' && partner === undefined) {
        // Seen landing, not yet seen leaving.
        payments.push({ date: txn.date, amount: txn.amount, landedOn: txn.date });
      }
    }
    return payments.sort((a, b) => daysBetween(b.date, a.date));
  }

  // Her rulebook, 52.2 and 52.4 (PR 7+8): everything the book holds on a card
  // used day to day that changes what it owes, as it holds it now, in the
  // order it came: purchases, fees and interest, refunds, and payments that
  // reached it. A payment still on its way is not here (12.5). Only reads;
  // set-aside.ts and statement.ts add it up.
  cardEntries(card: EverydayCard): CardEntry[] {
    if (card !== 'everyday-card' && card !== 'second-card') throw new MoneyError('bad-card', `not a card used day to day: ${String(card)}`);
    if (card === 'second-card' && this.#switches.secondCard !== 'on') throw new MoneyError('off-in-this-setup', 'this setup has no second card');
    const takeBacks = new Map<string, TakenBack>();
    for (const t of this.#takenBacks.values()) takeBacks.set(this.#aliases.get(t.takenId) ?? t.takenId, t);
    const takenBack = (entry: Entry, owed: Cents): CardEntry['takenBack'] => {
      const t = takeBacks.get(entry.id);
      return t === undefined ? null : { id: t.id, date: t.date, owed };
    };
    const entries: CardEntry[] = [];
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'spend' && (entry.txn.kind === 'purchase' || entry.txn.kind === 'card-charge') && entry.txn.account === card) {
        const shown = entry.postedTxn ?? entry.txn;
        const posted = entry.pending || entry.dropped === true ? null : { id: shown.id, date: shown.date };
        const base = { id: entry.id, posted, date: entry.txn.date, description: shown.description, owes: entry.amount, atSetup: entry.countedAtSetup };
        entries.push({ ...base, kind: 'charge', spendingKind: entry.spendingKind, sortedTo: entry.sortedTo, takenBack: takenBack(entry, shown.amount) });
      } else if ((entry.kind === 'refund' || entry.kind === 'money-in') && entry.txn.kind === 'refund' && entry.txn.account === card) {
        const gone = this.#gone(entry);
        const base = { id: entry.id, posted: { id: entry.txn.id, date: entry.txn.date }, date: entry.txn.date, description: entry.txn.description, owes: gone ? 0 : -entry.txn.amount, atSetup: 0 };
        const sorted = entry.kind === 'refund' ? { refundOf: entry.of, sortedTo: 'unsorted' as const } : { refundOf: null, sortedTo: entry.sortedTo };
        entries.push({ ...base, kind: 'refund', ...sorted, takenBack: takenBack(entry, -entry.txn.amount) });
      } else if ((entry.kind === 'transfer' || entry.kind === 'leg') && (entry.txn.kind === 'transfer' || entry.txn.kind === 'transfer-arrived') && entry.txn.to === card) {
        const owes = this.#gone(entry) ? 0 : -entry.txn.amount;
        const base = { id: entry.id, posted: { id: entry.txn.id, date: entry.txn.date }, date: entry.txn.date, description: entry.txn.description, owes, atSetup: this.#setupLegs.has(entry.id) ? -entry.txn.amount : 0 };
        entries.push({ ...base, kind: 'payment', takenBack: takenBack(entry, -entry.txn.amount) });
      }
    }
    return entries;
  }

  // Her rulebook, 50.4 (PR 9): what the book holds that moving Wishlist money
  // is worked out from (wishlist.ts): each purchase's part in Wishlist now,
  // in the order they came, less refunds (one that left savings is not here:
  // its money already left the savings account); money in sorted as payback
  // into Wishlist; and every move from savings to checking since tracking
  // started, counted from the day it left savings (12.5). Only reads.
  wishlistFlows(): WishlistFlows {
    refuseOffWishlist(this.#switches);
    const purchases: WishlistPurchase[] = [];
    let paidBack = 0;
    let movedToChecking = 0;
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'spend') {
        const amount = -(entry.effect.wishlist ?? 0);
        const txn = entry.txn;
        const account: AccountId = txn.kind === 'transfer' || txn.kind === 'transfer-sent' ? txn.from : txn.account;
        if (amount <= 0 || account === 'savings') continue;
        const shown = entry.postedTxn ?? txn;
        purchases.push(Object.freeze({ id: entry.id, date: txn.date, account, amount, posted: entry.pending ? null : Object.freeze({ id: shown.id, date: shown.date }) }));
      } else if (entry.kind === 'money-in' && entry.sortedTo === 'wishlist') {
        paidBack = addCents(paidBack, entry.effect.wishlist ?? 0);
      } else if ((entry.kind === 'transfer' || entry.kind === 'leg') && !this.#gone(entry) && !this.#setupLegs.has(entry.id)) {
        const t = entry.txn;
        // A move seen arriving first counts until its leaving half shows.
        const counts = t.kind !== 'transfer-arrived' || !this.#pairs.has(entry.id);
        if (t.from === 'savings' && t.to === 'checking' && counts) movedToChecking = addCents(movedToChecking, t.amount);
      }
    }
    return Object.freeze({ purchases: Object.freeze(purchases), paidBack, movedToChecking });
  }

  othersMoney(): OthersMoney {
    const heldForOthers = this.#totals.heldForOthers;
    const meaning = heldForOthers === 0 ? 'settled' : heldForOthers > 0 ? 'holding-for-others' : 'owed-to-you';
    return { heldForOthers, meaning };
  }

  // ----- What went in and out of a bucket (QUESTIONS.md B97 to B99) -----

  // What went in and out of a bucket in a pay period (the current one unless
  // one is named): what it held at the start, each item that changed it with
  // what that item did to it in total, and what it held at the end. Read back
  // from the ledger, so opening + in + out is always closing. An item whose
  // total for the bucket is zero is left out (it was sorted somewhere else,
  // marked a transfer, taken back, or dropped), except a purchase refunded in
  // full, which stays so the refund can be seen (B98). Newest first (B99).
  activity(pot: AnyPot, period?: number): BucketActivity {
    if (pot === 'wishlist') refuseOffWishlist(this.#switches);
    if (!this.movablePots().includes(pot)) throw new MoneyError('bad-pot', `not a bucket: ${String(pot)}`);
    const number = this.#payPeriod(period);
    const record = this.#periods[number];
    const lines = this.#ledger[number];
    if (record === undefined || lines === undefined) throw new MoneyError('broken-book', `pay period ${number} has no ledger`);
    const next = this.#periods[number + 1];
    const found: { readonly row: ActivityRow; readonly last: number }[] = [];
    for (const item of foldLines(lines, pot)) {
      const row = this.#activityRow(item.entry, item.net, pot);
      if (row !== null) found.push({ row, last: item.last });
    }
    // The newest day first; on the same day, the one counted last.
    found.sort((a, b) => daysBetween(a.row.date, b.row.date) || b.last - a.last);
    const rows = Object.freeze(found.map((f) => f.row));
    const wentIn = addCents(0, ...rows.filter((row) => row.amount > 0).map((row) => row.amount));
    const wentOut = addCents(0, ...rows.filter((row) => row.amount < 0).map((row) => row.amount));
    return Object.freeze({
      pot,
      period: Object.freeze({ number, startDate: record.startDate, endDate: next === undefined ? null : next.startDate }),
      opening: record.opening[pot] ?? 0,
      in: wentIn,
      out: wentOut,
      closing: next === undefined ? this.#totals[pot] : (next.opening[pot] ?? 0),
      rows,
    });
  }

  // The pay period asked for, the current one when none is named.
  #payPeriod(period: number | undefined): number {
    const number = period ?? this.#period.number;
    if (!Number.isInteger(number) || number < 0 || number > this.#period.number) {
      throw new MoneyError('unknown-period', `there is no pay period ${String(number)}; the current one is ${this.#period.number}`);
    }
    return number;
  }

  // A whole pay period (the current one unless one is named) added up by kind
  // of entry, bucket by bucket: what each bucket held at the start, what each
  // kind did to it, and what it held at the end (B105).
  periodSummary(period?: number): PeriodSummary {
    const number = this.#payPeriod(period);
    const record = this.#periods[number];
    const lines = this.#ledger[number];
    if (record === undefined || lines === undefined) throw new MoneyError('broken-book', `pay period ${number} has no ledger`);
    const next = this.#periods[number + 1];
    const byKind = {} as Record<AnyPot, Record<ActivityKind, Cents>>;
    for (const pot of this.movablePots()) byKind[pot] = Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, 0])) as Record<ActivityKind, Cents>;
    for (const line of lines) byKind[line.pot][line.kind] = addCents(byKind[line.pot][line.kind], line.delta);
    for (const pot of this.movablePots()) Object.freeze(byKind[pot]);
    return Object.freeze({
      number,
      startDate: record.startDate,
      endDate: next === undefined ? null : next.startDate,
      opening: Object.freeze({ ...record.opening }),
      closing: Object.freeze(next === undefined ? this.#potTotals() : { ...next.opening }),
      byKind: Object.freeze(byKind),
    });
  }

  // 40.13 (QUESTIONS.md A59): what the old card owed (12.4) when a pay period
  // (the current one unless one is named) began, and when it ended: what it
  // owed when the next paycheck was counted, or now. Only reads.
  oldCardDebtIn(period?: number): { readonly opening: Cents; readonly closing: Cents } {
    const number = this.#payPeriod(period);
    const record = this.#periods[number];
    if (record === undefined) throw new MoneyError('broken-book', `pay period ${number} has no record`);
    const next = this.#periods[number + 1];
    return Object.freeze({ opening: record.openingDebt, closing: next === undefined ? this.#totals.oldCardDebt : next.openingDebt });
  }

  // 40.2 (QUESTIONS.md A58): what each item spent out of needs and out of
  // wants in a pay period (the current one unless one is named), read from
  // the ledger's spending lines only and added up per item and bucket, as a
  // positive amount spent (a refund larger than what is left makes it
  // negative). So, bucket by bucket, they add up to minus the pay period's
  // spending in periodSummary, to the cent. An item whose lines add up to
  // zero is left out.
  spentIn(period?: number): SpentItem[] {
    const number = this.#payPeriod(period);
    const lines = this.#ledger[number];
    if (lines === undefined) throw new MoneyError('broken-book', `pay period ${number} has no ledger`);
    const spending = lines.filter((line) => line.kind === 'spending');
    const items: SpentItem[] = [];
    for (const pot of ['needs', 'wants'] as const) {
      for (const item of foldLines(spending, pot)) {
        if (item.net === 0) continue;
        const entry = this.#entries.get(item.entry) ?? this.#entries.get(item.entry.split(':')[0] ?? item.entry);
        const amount = subtractCents(0, item.net);
        if (entry === undefined || entry.kind !== 'spend') {
          items.push(Object.freeze({ id: item.entry, pot, amount, date: this.#periods[number]?.startDate ?? this.#period.startDate, description: '', account: null, kind: null }));
          continue;
        }
        const account: AccountId = entry.txn.kind === 'transfer' || entry.txn.kind === 'transfer-sent' ? entry.txn.from : entry.txn.account;
        items.push(Object.freeze({ id: item.entry, pot, amount, date: entry.txn.date, description: (entry.postedTxn ?? entry.txn).description, account, kind: entry.spendingKind }));
      }
    }
    return items;
  }

  // What the Payday screen shows (B104 to B106): the last paycheck and what
  // it did (3.2, 3.3), what became of each bucket's leftover (3.4, 3.5), and
  // the pay period that just ended, added up.
  paydayReport(): PaydayReport {
    const number = this.#period.number;
    const record = this.#periods[number];
    if (record === undefined) throw new MoneyError('broken-book', `pay period ${number} has no record`);
    const period = Object.freeze({ number, startDate: record.startDate });
    const settings = record.leftoverSetting;
    if (record.paycheckId === null || settings === null) return Object.freeze({ period, paycheck: null, leftovers: Object.freeze([]), ended: null });

    const made = this.#paychecks.find((p) => p.id === record.paycheckId);
    const entry = this.#entries.get(record.paycheckId);
    if (made === undefined || entry?.kind !== 'paycheck') throw new MoneyError('broken-book', `pay period ${number} began with ${record.paycheckId}, which is not a paycheck`);
    const paycheck: PaycheckReport = Object.freeze({
      id: made.id,
      date: made.date,
      amount: made.amount,
      description: entry.txn.description,
      split: made.split,
      percent: Object.freeze({ ...record.split.split }),
      reservePerPaycheck: record.split.momReservePerPaycheck,
      reserveCap: record.split.momReserveCap,
      reserveBefore: record.opening.momReserve,
      takenBack: entry.takenBack === true,
    });

    const leftovers: LeftoverReport[] = (['needs', 'wants'] as const).map((bucket) => {
      const leftAtPayday = record.opening[bucket];
      const setting = settings[bucket];
      const report = (outcome: LeftoverReport['outcome'], amount: Cents, question: string | null, lessSincePayday: Cents = 0): LeftoverReport => Object.freeze({ bucket, leftAtPayday, setting, outcome, amount, lessSincePayday, question });
      // 3.5: nothing left, or overspent, asks nothing and moves nothing.
      if (leftAtPayday <= 0) return report('nothing-to-ask', 0, null);
      if (setting === 'roll-over') return report('kept', leftAtPayday, null);
      const asked = this.#entries.get(`leftover:${made.id}:${bucket}`);
      if (asked?.kind !== 'leftover') throw new MoneyError('broken-book', `the ${bucket} leftover question for ${made.id} is missing`);
      const now = this.#asked(asked);
      const less = subtractCents(asked.amount, now);
      if (asked.answer === 'open') return report('waiting', now, asked.id, less);
      if (asked.answer === 'roll-over') return report('kept', now, null, less);
      return report('moved-to-savings', -(asked.effect[bucket] ?? 0), null, less);
    });

    return Object.freeze({ period, paycheck, leftovers: Object.freeze(leftovers), ended: number >= 1 ? this.periodSummary(number - 1) : null });
  }

  // One item's row in a bucket's list, or null when it has nothing to show there.
  #activityRow(id: string, amount: Cents, pot: AnyPot): ActivityRow | null {
    const entry = this.#entries.get(id) ?? this.#entries.get(id.split(':')[0] ?? id);
    if (amount === 0 && !(entry?.kind === 'spend' && this.#refundedInFullIn(entry, pot))) return null;
    const base = { id, amount };
    if (entry === undefined) {
      // Nothing left of it to describe (B98): it was removed after it counted.
      const startDate = this.#period.startDate;
      return Object.freeze({ ...base, what: 'removed', description: '', date: startDate, account: null, other: null, pending: false, refunded: 0, partOfSplit: false, resort: this.#resortOf(id, undefined) });
    }
    const resort = this.#resortShown(id, entry);
    switch (entry.kind) {
      case 'paycheck':
        return Object.freeze({ ...base, what: 'paycheck', description: entry.txn.description, date: entry.txn.date, account: entry.txn.account, other: null, pending: false, refunded: 0, partOfSplit: false, resort });
      case 'money-in': {
        const what: ActivityWhat = entry.sortedTo === 'other-income' ? 'other-income' : entry.sortedTo === 'not-mine' ? 'not-mine' : 'payback';
        return Object.freeze({ ...base, what, description: entry.txn.description, date: entry.txn.date, account: entry.txn.account, other: null, pending: false, refunded: 0, partOfSplit: false, resort });
      }
      case 'spend': {
        const shown = entry.postedTxn ?? entry.txn;
        const account: AccountId = entry.txn.kind === 'transfer' || entry.txn.kind === 'transfer-sent' ? entry.txn.from : entry.txn.account;
        return Object.freeze({ ...base, what: entry.spendingKind, description: shown.description, date: entry.txn.date, account, other: null, pending: entry.pending, refunded: entry.refunded, partOfSplit: 'split' in entry.sortedTo, resort });
      }
      case 'mom':
        return Object.freeze({ ...base, what: 'mom', description: entry.txn.description, date: entry.txn.date, account: entry.txn.account, other: null, pending: false, refunded: 0, partOfSplit: false, resort });
      case 'move':
        return Object.freeze({ ...base, what: 'move', description: '', date: entry.date, account: null, other: pot === entry.from ? entry.to : entry.from, pending: false, refunded: 0, partOfSplit: false, resort });
      case 'leftover':
        return Object.freeze({ ...base, what: 'leftover', description: '', date: entry.date, account: null, other: pot === entry.bucket ? 'savings' : entry.bucket, pending: false, refunded: 0, partOfSplit: false, resort });
      case 'refund':
      case 'leg':
      case 'transfer':
      case 'old-card':
        // These never change a bucket (ledgerKind), so they have no rows.
        throw new MoneyError('broken-book', `${entry.kind} ${id} has a row in ${pot}, but it should never`);
    }
  }

  // ----- Sorting something again (rule 4.7, QUESTIONS.md B100) -----

  // Whether an item that is not waiting in review can be sorted again, and the
  // choices for it: the same ones review gives that kind of item. null when
  // the book has no such item.
  resortDetail(id: string): ResortDetail | null {
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) return null;
    return this.#resortShown(entry.id, entry);
  }

  // Off in this setup: sorting again never offers what is off.
  #resortShown(id: string, entry: Entry): ResortDetail {
    const detail = this.#resortOf(id, entry);
    return detail.resortable ? Object.freeze({ ...detail, options: optionsInThisSetup(this.#switches, detail.options) }) : detail;
  }

  #resortOf(id: string, entry: Entry | undefined): ResortDetail {
    const no = (why: string): ResortDetail => Object.freeze({ resortable: false, id, why });
    if (entry === undefined) return no('It is no longer in your books.');
    if (this.#review.has(entry.id)) return no('It is still waiting in Review. Sort it there.');
    switch (entry.kind) {
      case 'paycheck':
        return no("A paycheck can't be sorted again: it started a pay period, and its money was split by the rules.");
      case 'leftover':
        return no('Your answer to a payday question is final. Move the money by hand if you want it somewhere else.');
      case 'move':
        return no('A hand move is undone by moving the money back.');
      case 'refund':
        return no('This refund was matched to its purchase, and counts on that purchase.');
      case 'leg':
      case 'transfer':
        return no('This is money moving between your own accounts. No bucket changes.');
      case 'old-card':
        return no('This only changes what the old card owes. No bucket changes.');
      case 'mom': {
        if (entry.takenBack === true) return no('The bank took it back.');
        // 8.1: a payment the mom rule matched always comes out of the reserve.
        if (entry.how === 'mom-rule') return no('This payment matches your mom rule, so it always comes out of the mom reserve.');
        const txn = entry.txn;
        // Sorting it again can pick another bucket or split it, but a rule or a transfer starts
        // from a payment waiting to be sorted, not one already counted for mom.
        const options = reviewOptions({ type: 'spending', kind: 'person-payment', fromSavings: false, account: txn.account, leavesAnAccount: false, pending: false, partlyRefunded: false, countedAtSetup: false, gone: false, canBeForMom: true, markedFromSavings: false, net: txn.amount });
        if (options.type !== 'sort') throw new MoneyError('broken-book', 'a payment to a person has no choices');
        return Object.freeze({
          resortable: true,
          id,
          type: 'spending',
          description: txn.description,
          date: txn.date,
          amount: txn.amount,
          account: txn.account,
          pending: false,
          refund: false,
          now: Object.freeze({ to: 'mom' as const }),
          marked: null,
          options: { ...options, always: [] },
          likelyPurchases: [],
          paycheckPreview: null,
        });
      }
      case 'money-in': {
        if (entry.takenBack === true) return no('The bank took it back.');
        if (entry.sortedTo === 'unsorted') return no('It is still waiting in Review. Sort it there.');
        const txn = entry.txn;
        // 3.7, B54: a deposit older than the last paycheck cannot start a pay period.
        const older = txn.kind === 'deposit' && daysBetween(this.#lastPaycheckDate, txn.date) < 0;
        const likely = this.#likelyFor(txn);
        const options = reviewOptions({ type: 'money-in', reason: entry.reason, account: txn.account, olderThanLastPaycheck: older, likely: likely.map((p) => p.id), ...(txn.kind === 'deposit' && this.#olderWaitingFor(txn.date) ? { olderPaycheckWaiting: true } : {}), ...this.#wishlistFact() });
        if (options.type !== 'sort') throw new MoneyError('broken-book', 'money in has no choices');
        return Object.freeze({
          resortable: true,
          id,
          type: 'money-in',
          description: txn.description,
          date: txn.date,
          amount: txn.amount,
          account: txn.account,
          pending: false,
          refund: txn.kind === 'refund',
          now: Object.freeze({ to: entry.sortedTo }),
          marked: null,
          options,
          likelyPurchases: likely,
          paycheckPreview: txn.kind === 'deposit' && !older ? this.#splitIfPaycheck(txn.amount) : null,
        });
      }
      case 'spend': {
        if (entry.dropped === true || entry.takenBack === true) return no('The bank took it back, so there is nothing left to sort.');
        const txn = entry.txn;
        // 5.2: a payment to the old card from checking always comes out of needs.
        if (entry.spendingKind === 'debt-payoff' && (txn.kind === 'transfer' || txn.kind === 'transfer-sent') && txn.from === 'checking') {
          // 5.6, A20: one you marked by hand can be undone by sorting it, as what the bank sent.
          if (entry.original !== undefined) return this.#markedPaymentDetail(id, entry, txn);
          return no('A payment to the old card from checking always comes out of Needs.');
        }
        if ('to' in entry.sortedTo && entry.sortedTo.to === 'counted-at-setup') return no('It was counted on setup day.');
        const options = reviewOptions(this.#spendFacts(entry));
        if (options.type !== 'sort') throw new MoneyError('broken-book', 'spending has no choices');
        const account: AccountId = txn.kind === 'transfer' || txn.kind === 'transfer-sent' ? txn.from : txn.account;
        return Object.freeze({
          resortable: true,
          id,
          type: 'spending',
          description: (entry.postedTxn ?? txn).description,
          date: txn.date,
          amount: netOf(entry),
          account,
          pending: entry.pending,
          refund: false,
          now: entry.sortedTo,
          marked: null,
          options,
          likelyPurchases: [],
          paycheckPreview: null,
        });
      }
    }
  }

  // 13.8: after he sorted an item by hand, the rule to offer for it: when an
  // earlier one from the same place was sorted by hand the same way. The
  // same place: its description, as it first showed up or as it posted, has
  // this one's name in it. Only where "always do this" can still be made for
  // it from its bucket's list (not for one counted for mom, which takes no
  // rule once counted). Changes nothing.
  ruleOffer(id: string): RuleOffer | null {
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) throw new MoneyError('unknown-item', 'no item ' + id);
    const place = this.#placeOf(entry);
    const to = this.#sortedByHand(entry);
    if (place === null || to === null) return null;
    const detail = this.#resortOf(entry.id, entry);
    if (!detail.resortable || !detail.options.always.includes(to)) return null;
    const name = this.#placeNameOf(place);
    if (name === null) return null;
    const rule = { contains: name };
    for (const other of this.#entries.values()) {
      if (other === entry || this.#sortedByHand(other) !== to) continue;
      const was = this.#placeOf(other);
      if (was?.for === place.for && was.descriptions.some((d) => matchesTextRule(rule, d))) return Object.freeze({ for: place.for, contains: name, to });
    }
    return null;
  }

  // 13.8: the place in an entry a sorting rule could cover. Null for
  // anything else, for one the bank took back or dropped, and for one he
  // marked a transfer (5.6).
  #placeOf(entry: Entry): Place | null {
    if (this.#gone(entry)) return null;
    if (entry.kind === 'spend') {
      const txn = entry.txn;
      if (entry.original !== undefined || entry.dropped === true) return null;
      if (entry.spendingKind === 'purchase' && txn.kind === 'purchase') {
        return { for: 'purchase', account: txn.account, date: txn.date, first: txn.description, descriptions: entry.postedTxn === null ? [txn.description] : [txn.description, entry.postedTxn.description] };
      }
      if (entry.spendingKind === 'person-payment' && txn.kind === 'payment-to-person') return { for: 'person', account: txn.account, date: txn.date, first: txn.description, descriptions: [txn.description] };
      return null;
    }
    if (entry.kind === 'mom') return { for: 'person', account: entry.txn.account, date: entry.txn.date, first: entry.txn.description, descriptions: [entry.txn.description] };
    if (entry.kind === 'money-in' && entry.reason === 'deposit' && entry.txn.kind === 'deposit') {
      return { for: 'deposit', account: entry.txn.account, date: entry.txn.date, first: entry.txn.description, descriptions: [entry.txn.description] };
    }
    return null;
  }

  // 13.8: where he sorted it by hand, in one place; null when a rule sorted
  // it, it waits, or it was split.
  #sortedByHand(entry: Entry): PickTo | null {
    if (entry.kind === 'spend' && entry.byHand === true && 'to' in entry.sortedTo) {
      const to = entry.sortedTo.to;
      return to === 'needs' || to === 'wants' || to === 'not-mine' ? to : null;
    }
    if (entry.kind === 'mom' && entry.how === 'by-hand') return 'mom';
    if (entry.kind === 'money-in' && entry.byHand === true && entry.sortedTo !== 'unsorted') return entry.sortedTo;
    return null;
  }

  // 13.8 (as 4.5, A33): the place's name, without the words on most of his
  // items of that kind on that account, on its day and in the 90 days before.
  #placeNameOf(place: Place): string | null {
    const near: string[] = [];
    for (const e of this.#entries.values()) {
      const p = this.#placeOf(e);
      if (p === null || p.for !== place.for || p.account !== place.account) continue;
      const before = daysBetween(p.date, place.date);
      if (before >= 0 && before <= COMMON_WORD_DAYS) near.push(p.first);
    }
    return placeName(place.first, commonPlaceWords(near));
  }

  // 40.6 (QUESTIONS.md A58): the place's name for an item, as 13.8 finds it,
  // or null when it has none (a card fee, a transfer, or no word left). One
  // he marked a transfer (5.6) is the purchase or payment it was. Asked for by
  // the Trends tab only: it reads the whole book.
  placeName(id: string): string | null {
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) throw new MoneyError('unknown-item', 'no item ' + id);
    const original = entry.kind === 'spend' || entry.kind === 'leg' ? entry.original : undefined;
    if (original !== undefined) {
      const kind = original.kind === 'payment-to-person' ? 'person' : original.kind === 'purchase' ? 'purchase' : null;
      return kind === null ? null : this.#placeNameOf({ for: kind, account: original.account, date: original.date, first: original.description, descriptions: [original.description] });
    }
    const place = this.#placeOf(entry);
    return place === null ? null : this.#placeNameOf(place);
  }

  // 13.6, 13.8: what "always do this" starts from for an item, waiting or
  // sorted: its place's name, or its description when it has none. One he
  // marked a transfer (5.6) starts from the purchase or payment it was. Asked
  // for by the screens only: it reads the whole book.
  ruleText(id: string): string {
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) throw new MoneyError('unknown-item', 'no item ' + id);
    const original = entry.kind === 'spend' || entry.kind === 'leg' ? entry.original : undefined;
    if (original !== undefined) {
      const kind = original.kind === 'payment-to-person' ? 'person' : original.kind === 'purchase' ? 'purchase' : null;
      const name = kind === null ? null : this.#placeNameOf({ for: kind, account: original.account, date: original.date, first: original.description, descriptions: [original.description] });
      return name ?? original.description;
    }
    const place = this.#placeOf(entry);
    const shown = 'txn' in entry ? (entry.kind === 'spend' && entry.postedTxn !== null ? entry.postedTxn.description : entry.txn.description) : '';
    return (place === null ? null : this.#placeNameOf(place)) ?? shown;
  }

  // A20, B110: a purchase you marked as a payment to the old card, from checking.
  // It comes out of needs (5.2) and is on needs' list as that. Sorting it any
  // way but a transfer makes it what the bank sent again (5.6), so the choices
  // are the ones that purchase had before you marked it, less the transfer you
  // already made.
  #markedPaymentDetail(id: string, entry: SpendEntry, txn: Transfer | TransferSent): ResortDetail {
    const original = entry.original;
    if (original === undefined) throw new MoneyError('broken-book', `${id} was not marked as a transfer`);
    const person = original.kind === 'payment-to-person';
    const facts: ReviewFacts = {
      type: 'spending',
      kind: person ? 'person-payment' : 'purchase',
      fromSavings: original.kind === 'savings-withdrawal',
      account: original.account,
      leavesAnAccount: true,
      pending: false,
      partlyRefunded: false,
      countedAtSetup: false,
      gone: false,
      canBeForMom: person,
      markedFromSavings: false,
      net: entry.amount,
    };
    const options = reviewOptions(facts);
    if (options.type !== 'sort') throw new MoneyError('broken-book', 'a marked payment has no choices');
    const partner = txn.to;
    const transferOutcome = Object.fromEntries(Object.entries(options.transferOutcome).filter(([account]) => account !== partner));
    return Object.freeze({
      resortable: true,
      id,
      type: 'spending',
      description: (entry.postedTxn ?? txn).description,
      date: txn.date,
      amount: netOf(entry),
      account: txn.from,
      pending: false,
      refund: false,
      now: Object.freeze({ to: 'old-card-payment' as const }),
      marked: partner,
      options: { ...options, transfer: options.transfer.filter((account) => account !== partner), transferOutcome },
      likelyPurchases: [],
      paycheckPreview: null,
    });
  }

  // What the book knows about a piece of spending, without any rule applied to
  // it yet, for the choices review and sorting again give it.
  #spendFacts(entry: SpendEntry): ReviewFacts {
    const txn = entry.txn;
    const account: AccountId = txn.kind === 'transfer' || txn.kind === 'transfer-sent' ? txn.from : txn.account;
    return {
      type: 'spending',
      kind: entry.spendingKind,
      fromSavings: txn.kind === 'savings-withdrawal',
      account,
      leavesAnAccount: (txn.kind === 'purchase' || txn.kind === 'savings-withdrawal' || txn.kind === 'payment-to-person') && (account === 'checking' || account === 'savings'),
      pending: entry.pending,
      partlyRefunded: entry.refunded > 0,
      countedAtSetup: entry.countedAtSetup > 0,
      gone: entry.dropped === true || entry.takenBack === true,
      canBeForMom: entry.spendingKind === 'person-payment' && txn.kind === 'payment-to-person' && entry.refunded === 0,
      markedFromSavings: this.#markedFromSavings(entry),
      net: netOf(entry),
      ...this.#wishlistFact(),
    };
  }

  // Her rulebook, 4.2 and 6.1: review offers Wishlist where the setup has it.
  #wishlistFact(): { readonly wishlist?: true } {
    return this.#switches.wishlist === 'on' ? { wishlist: true } : {};
  }

  // A purchase refunded in full, and still sorted into this bucket (B98).
  #refundedInFullIn(entry: SpendEntry, pot: AnyPot): boolean {
    if (entry.refunded === 0 || netOf(entry) !== 0 || entry.dropped === true || entry.takenBack === true) return false;
    const sorted = entry.sortedTo;
    if ('split' in sorted) return sorted.split.some((part) => part.bucket === pot);
    return sorted.to === pot;
  }

  // ----- Bank activity -----

  receive(txn: BankTransaction): Received {
    checkTransaction(txn);
    const known = this.#knownTransaction(txn.id);
    if (known !== undefined) {
      if (sameTransaction(known, txn)) return { id: txn.id, outcome: 'duplicate' };
      throw new MoneyError('conflicting-id', `a different transaction already has id ${txn.id}`);
    }
    refuseOffTransaction(this.#switches, txn);
    return this.#dispatch(Object.freeze({ ...txn }));
  }

  // Hands a checked transaction to whatever deals with its kind.
  #dispatch(copy: BankTransaction): Received {
    switch (copy.kind) {
      case 'deposit':
        return this.#receiveDeposit(copy);
      case 'purchase':
      case 'savings-withdrawal':
        return this.#receivePurchase(copy);
      case 'refund':
        return copy.account === 'old-card' ? this.#addOldCard(copy) : this.#receiveRefund(copy);
      case 'card-charge':
        if (copy.account === 'old-card') return this.#addOldCard(copy);
        return this.#addSpending(copy, copy.charge === 'fee' ? 'card-fee' : 'card-interest', { to: 'unsorted' });
      case 'transfer':
        return this.#receiveTransfer(copy);
      case 'transfer-sent':
        return this.#receiveSent(copy);
      case 'transfer-arrived':
        return this.#receiveArrived(copy);
      case 'payment-to-person':
        return this.#receivePersonPayment(copy);
      case 'pending-dropped':
        return this.#receiveDropped(copy);
      case 'pending-changed':
        return this.#receivePendingChanged(copy);
      case 'taken-back':
        return this.#receiveTakenBack(copy);
    }
  }

  // QUESTIONS.md A13: the bank changed a pending charge's amount before it
  // posted. The new amount replaces the old right away, keeping its bucket,
  // the same way posting does (4.6): a split that no longer adds up goes back
  // to review (A1), and one counted on setup day leaves the difference in
  // review (A10).
  #receivePendingChanged(txn: PendingChanged): Received {
    const target = this.#entries.get(this.#aliases.get(txn.pendingId) ?? txn.pendingId);
    if ((target?.kind !== 'spend' && target?.kind !== 'old-card') || !target.pending) {
      throw new MoneyError('not-pending', `${txn.pendingId} is not a pending charge`);
    }
    const before = { amount: target.amount };
    const sortedBefore = target.kind === 'spend' ? { sortedTo: target.sortedTo, splitChanged: target.splitChanged } : null;
    target.amount = txn.amount;
    try {
      if (target.kind === 'spend') this.#refreshSpending(target);
      else this.#setEffect(target, { oldCardDebt: txn.amount - target.countedAtSetup });
    } catch (error) {
      Object.assign(target, before, sortedBefore ?? {});
      throw error;
    }
    this.#changes.set(txn.id, txn);
    return { id: txn.id, outcome: 'changed' };
  }

  // QUESTIONS.md A14 and rule 4.10: the bank took back a transaction the app
  // had counted. The app takes it back too: whatever it did to the buckets,
  // the mom reserve, the money in transit, or the old card debt is undone,
  // and its money goes back where it came from. The change is logged (13.5)
  // and you are told, once (10.6). A paycheck's pay period stays, since its
  // days have passed; only its money comes back out of the buckets. A
  // pending charge is not taken back but dropped (4.6).
  #receiveTakenBack(txn: TakenBack): Received {
    const target = this.#entries.get(this.#aliases.get(txn.takenId) ?? txn.takenId);
    if (target === undefined || !('txn' in target)) throw new MoneyError('unknown-item', `no transaction ${txn.takenId}`);
    if (target.takenBack === true) throw new MoneyError('already-taken-back', `${txn.takenId} was taken back already`);
    if ((target.kind === 'spend' || target.kind === 'old-card') && target.pending) {
      throw new MoneyError('still-pending', `${txn.takenId} is still pending: the bank drops a pending charge (4.6)`);
    }
    const shown = target.kind === 'spend' || target.kind === 'old-card' ? (target.postedTxn ?? target.txn) : target.txn;
    const amount = target.kind === 'spend' || target.kind === 'old-card' ? target.amount : target.txn.amount;
    this.#atomically(() => {
      this.#takeBack(target);
      this.#log.push(Object.freeze({ date: txn.date, kind: 'bank-took-back', id: target.id, description: shown.description, amount }));
      this.#notices.push(Object.freeze({ kind: 'bank-took-back', id: target.id, date: txn.date, description: shown.description, amount }));
    });
    this.#takenBacks.set(txn.id, txn);
    return { id: txn.id, outcome: 'taken-back' };
  }

  // Undoes one entry made from a bank transaction, keeping it in the book.
  #takeBack(entry: Entry): void {
    switch (entry.kind) {
      case 'spend':
        // Like a drop (A2): nothing left of it, so its money goes back. A
        // refund already counted on it keeps its money where it went.
        entry.amount = 0;
        entry.takenBack = true;
        this.#refreshSpending(entry);
        break;
      case 'old-card':
        // What was in the old card balance on setup day comes off the debt too.
        entry.amount = 0;
        entry.takenBack = true;
        this.#setEffect(entry, { oldCardDebt: -entry.countedAtSetup });
        this.#review.delete(entry.id);
        break;
      case 'refund': {
        // Its money was counted on the purchase it refunded.
        const purchase = this.#entry(entry.of);
        if (purchase.kind !== 'spend') throw new MoneyError('broken-book', `${entry.id} refunds ${entry.of}, which is not spending`);
        purchase.refunded = subtractCents(purchase.refunded, entry.txn.amount);
        entry.takenBack = true;
        this.#refreshSpending(purchase);
        break;
      }
      case 'mom': {
        entry.takenBack = true;
        this.#setEffect(entry, {});
        const difference = this.#entries.get(`${entry.id}:difference`);
        if (difference !== undefined) this.#takeBack(difference);
        break;
      }
      case 'paycheck':
      case 'money-in':
      case 'transfer':
      case 'leg':
        entry.takenBack = true;
        this.#setEffect(entry, {});
        this.#review.delete(entry.id);
        break;
      case 'leftover':
      case 'move':
        throw new MoneyError('broken-book', `${entry.id} did not come from the bank`);
    }
    // Its other half, if any, is on its way again (12.5).
    this.#unpairAll(entry.id);
  }

  // QUESTIONS.md A2: a pending charge the bank drops without posting it is
  // removed, and its money goes back where it came from: its bucket (or
  // each part of a split), the unsorted spending, or the old card debt. One
  // counted in the starting money on setup day leaves the difference in
  // review, like any change to such a charge (A10).
  #receiveDropped(txn: PendingDropped): Received {
    const target = this.#entries.get(this.#aliases.get(txn.pendingId) ?? txn.pendingId);
    if ((target?.kind !== 'spend' && target?.kind !== 'old-card') || !target.pending) {
      throw new MoneyError('not-pending', `${txn.pendingId} is not a pending charge`);
    }
    const before = { pending: target.pending, amount: target.amount };
    target.pending = false;
    target.amount = 0;
    try {
      if (target.kind === 'spend') {
        target.dropped = true;
        this.#refreshSpending(target);
      } else {
        this.#setEffect(target, { oldCardDebt: -target.countedAtSetup });
        this.#review.delete(target.id);
      }
    } catch (error) {
      Object.assign(target, before, target.kind === 'spend' ? { dropped: false } : {});
      throw error;
    }
    this.#drops.set(txn.id, txn);
    return { id: txn.id, outcome: 'dropped' };
  }

  // Rule 12.5: the half of a transfer that left checking or savings. Buckets
  // change the same way as for a whole transfer (section 5): none, or needs
  // for a payment to the old card (5.2). The old card debt waits for the
  // money to land.
  #receiveSent(txn: TransferSent): Received {
    // Check for the arriving half first, so a mismatch changes nothing.
    const partner = this.#arrivalFor(txn);
    let received: Received;
    if (txn.to === 'old-card') {
      received = this.#addSpending(txn, 'debt-payoff', txn.from === 'checking' ? { to: 'needs' } : { to: 'unsorted' });
    } else {
      this.#add({ kind: 'leg', id: txn.id, txn, effect: {} }, { inTransit: txn.amount });
      received = { id: txn.id, outcome: 'sorted' };
    }
    if (partner !== undefined) this.#pair(txn.id, partner);
    return received;
  }

  // The arriving half that belongs to this leaving half: one that names it,
  // or else the oldest unpaired one between the same accounts for the same
  // amount that names no other.
  #arrivalFor(sent: TransferSent): string | undefined {
    let fallback: string | undefined;
    for (const entry of this.#entries.values()) {
      if (entry.kind !== 'leg' || entry.txn.kind !== 'transfer-arrived' || this.#pairs.has(entry.id) || this.#gone(entry)) continue;
      const a = entry.txn;
      if (a.sentId === sent.id) {
        if (!sameRoute(a, sent)) throw new MoneyError('bad-transaction', `${a.id} names ${sent.id} but does not match it`);
        return entry.id;
      }
      if (this.#namesNoHalf(a) && fallback === undefined && sameRoute(a, sent)) fallback = entry.id;
    }
    return fallback;
  }

  // An arrival that names no leaving half, or names one the bank took back
  // (4.10), pairs like one the bank did not link.
  #namesNoHalf(arrival: TransferArrived): boolean {
    if (arrival.sentId === undefined) return true;
    const named = this.#entries.get(arrival.sentId);
    return named !== undefined && this.#gone(named);
  }

  // Rule 12.5: the half of a transfer that arrived. Money landing on the old
  // card lowers the debt (5.2); anywhere else it ends its time in transit.
  #receiveArrived(txn: TransferArrived): Received {
    let partner: string | undefined;
    // An arrival paired with the named half only by guess, which gives way.
    let displaced: string | undefined;
    if (txn.sentId !== undefined) {
      const named = this.#entries.get(txn.sentId);
      if (named !== undefined) {
        const namedTxn = 'txn' in named ? named.txn : null;
        if (namedTxn === null || namedTxn.kind !== 'transfer-sent' || !sameRoute(namedTxn, txn)) {
          throw new MoneyError('bad-transaction', `${txn.id} names ${txn.sentId}, which is not the same transfer`);
        }
        // A leaving half the bank took back (4.10) cannot be paired with;
        // the oldest unpaired one is taken instead, as for an arrival the
        // bank did not link.
        if (this.#gone(named)) {
          partner = this.#oldestUnpairedSent(txn);
        } else {
          const current = this.#pairs.get(named.id);
          if (current !== undefined) {
            const currentTxn = this.#legTxn(current);
            if (currentTxn.kind !== 'transfer-arrived' || currentTxn.sentId !== undefined) {
              throw new MoneyError('already-arrived', `${txn.sentId} has already arrived`);
            }
            displaced = current;
          }
          partner = named.id;
        }
      } else if (this.#waitingFor(txn.sentId)) {
        throw new MoneyError('already-arrived', `another arrival is already waiting for ${txn.sentId}`);
      }
    } else {
      partner = this.#oldestUnpairedSent(txn);
    }
    this.#add({ kind: 'leg', id: txn.id, txn, effect: {} }, txn.to === 'old-card' ? { oldCardDebt: -txn.amount } : { inTransit: -txn.amount });
    if (displaced !== undefined && partner !== undefined) this.#unpair(partner, displaced);
    if (partner !== undefined) this.#pair(partner, txn.id);
    if (displaced !== undefined) {
      // The arrival that was paired by guess looks again for a leaving half.
      const other = this.#oldestUnpairedSent(this.#legTxn(displaced) as TransferArrived);
      if (other !== undefined) this.#pair(other, displaced);
    }
    return { id: txn.id, outcome: 'sorted' };
  }

  #legTxn(id: string): TransferSent | TransferArrived {
    const entry = this.#entry(id);
    const txn = 'txn' in entry ? entry.txn : null;
    if (txn === null || (txn.kind !== 'transfer-sent' && txn.kind !== 'transfer-arrived')) {
      throw new MoneyError('broken-book', `${id} is not half of a transfer`);
    }
    return txn;
  }

  #unpair(a: string, b: string): void {
    this.#pairs.delete(a);
    this.#pairs.delete(b);
  }

  #oldestUnpairedSent(arrival: TransferArrived): string | undefined {
    for (const entry of this.#entries.values()) {
      const txn = 'txn' in entry ? entry.txn : null;
      if (txn?.kind === 'transfer-sent' && !this.#pairs.has(entry.id) && !this.#gone(entry) && sameRoute(txn, arrival)) return entry.id;
    }
    return undefined;
  }

  #waitingFor(sentId: string): boolean {
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'leg' && entry.txn.kind === 'transfer-arrived' && entry.txn.sentId === sentId && !this.#pairs.has(entry.id) && !this.#gone(entry)) return true;
    }
    return false;
  }

  #pair(sentId: string, arrivedId: string): void {
    this.#pairs.set(sentId, arrivedId);
    this.#pairs.set(arrivedId, sentId);
  }

  // Unpairs an entry from its other half, if it has one.
  #unpairAll(id: string): void {
    const partner = this.#pairs.get(id);
    if (partner !== undefined) this.#unpair(id, partner);
  }

  // Rule 7.4: a payment to a person waits in review unless a rule covers
  // that person, whichever of your accounts it leaves (A16). A rule can
  // also say it is for mom (7.6).
  #receivePersonPayment(txn: PersonPayment): Received {
    if (matchesTextRule(this.#settings.momRule, txn.description)) return this.#payMom(txn, 'mom-rule');
    const rule = findRule(this.#rules, 'person', txn.description);
    if (rule?.choice.to === 'mom') return this.#payMom(txn, 'person-rule');
    return this.#addSpending(txn, 'person-payment', rule === undefined ? { to: 'unsorted' } : { to: rule.choice.to });
  }

  #knownTransaction(id: string): BankTransaction | undefined {
    const about = this.#drops.get(id) ?? this.#changes.get(id) ?? this.#takenBacks.get(id);
    if (about !== undefined) return about;
    const postedFor = this.#aliases.get(id);
    if (postedFor !== undefined) {
      const entry = this.#entry(postedFor);
      if ('originalPosted' in entry && entry.originalPosted !== undefined) return entry.originalPosted;
      return 'postedTxn' in entry ? (entry.postedTxn ?? undefined) : undefined;
    }
    const entry = this.#entries.get(id);
    if (entry === undefined || !('txn' in entry)) return undefined;
    // Marked as a transfer by hand (5.6): the bank sent it as something else.
    return ('original' in entry ? entry.original : undefined) ?? entry.txn;
  }

  // Taken back by the bank (4.10): still in the book, doing nothing.
  #gone(entry: Entry): boolean {
    return 'takenBack' in entry && entry.takenBack === true;
  }

  // Rules 8.1 and 8.3: a mom payment comes out of the reserve, whatever the
  // day or amount. If the reserve cannot cover it all, the difference waits
  // in review for you to pick a bucket.
  #payMom(txn: PersonPayment, how: MomEntry['how']): Received {
    const fromReserve = Math.min(txn.amount, Math.max(0, this.#totals.momReserve));
    const mom: MomEntry = { kind: 'mom', id: txn.id, txn, fromReserve, how, effect: {} };
    this.#add(mom, { momReserve: -fromReserve });
    const difference = txn.amount - fromReserve;
    if (difference === 0) return { id: txn.id, outcome: 'sorted' };
    const entry: SpendEntry = {
      kind: 'spend',
      id: `${txn.id}:difference`,
      txn,
      spendingKind: 'mom-difference',
      postedTxn: null,
      pending: false,
      amount: difference,
      refunded: 0,
      countedAtSetup: 0,
      sortedTo: { to: 'unsorted' },
      splitChanged: false,
      effect: {},
    };
    try {
      this.#addSpendingEntry(entry);
    } catch (error) {
      this.#remove(mom);
      throw error;
    }
    return { id: txn.id, outcome: 'review' };
  }

  // Section 5.
  #receiveTransfer(txn: Transfer): Received {
    if (txn.to !== 'old-card') {
      // 5.1 and 5.3: between your own accounts, so no bucket changes. A
      // move to or from savings only changes what is left to move (3.8).
      this.#add({ kind: 'transfer', id: txn.id, txn, effect: {} }, {});
      return { id: txn.id, outcome: 'sorted' };
    }
    // 5.2: a payment to the old card is spending from needs. From savings
    // the rulebook does not say, so it waits in review (QUESTIONS.md).
    return this.#addSpending(txn, 'debt-payoff', txn.from === 'checking' ? { to: 'needs' } : { to: 'unsorted' });
  }

  // 5.4 and 5.5: old card activity changes the debt shown and no bucket. A
  // new purchase is flagged in review.
  #addOldCard(txn: Purchase | CardCharge | Refund): Received {
    const pending = txn.kind === 'purchase' && txn.pending;
    const entry: OldCardEntry = { kind: 'old-card', id: txn.id, txn, postedTxn: null, pending, amount: txn.amount, countedAtSetup: 0, effect: {} };
    this.#add(entry, { oldCardDebt: txn.kind === 'refund' ? -txn.amount : txn.amount });
    if (txn.kind !== 'purchase') return { id: txn.id, outcome: 'sorted' };
    this.#review.add(entry.id);
    return { id: txn.id, outcome: 'review' };
  }

  #receiveDeposit(txn: Deposit): Received {
    const s = this.#settings;
    if (!matchesTextRule(s.paycheckRule, txn.description)) {
      const rule = findRule(this.#rules, 'deposit', txn.description);
      const result = this.#holdMoneyIn(txn, 'deposit');
      if (rule === undefined) return result;
      // 6.2: a rule for a known source makes the choice automatically.
      const entry = this.#moneyInEntry(txn.id);
      try {
        this.#sortMoneyIn(entry, rule.choice);
      } catch (error) {
        this.#remove(entry);
        throw error;
      }
      return { id: txn.id, outcome: 'sorted' };
    }
    // Rule 3.7: too soon after the last paycheck to split automatically.
    if (daysBetween(this.#lastPaycheckDate, txn.date) < s.earlyPaycheckDays) return this.#holdMoneyIn(txn, 'early-paycheck');
    // Her rulebook, 3.1: with "Ask before splitting a paycheck" on, it waits for your yes.
    if (s.askBeforeSplittingPaycheck === true) return this.#holdMoneyIn(txn, 'paycheck');
    this.#payday(txn);
    return { id: txn.id, outcome: 'paycheck' };
  }

  #holdMoneyIn(txn: Deposit | Refund, reason: MoneyInReason): Received {
    const entry: MoneyInEntry = { kind: 'money-in', id: txn.id, txn, reason, sortedTo: 'unsorted', incomeSplit: null, effect: {} };
    this.#add(entry, { unsortedIn: txn.amount });
    this.#review.add(entry.id);
    return { id: txn.id, outcome: 'review' };
  }

  // Rules 4.1, 4.2, 4.6, 4.9.
  #receivePurchase(txn: Purchase | SavingsWithdrawal): Received {
    if (txn.pendingId !== undefined) {
      const target = this.#entries.get(this.#aliases.get(txn.pendingId) ?? txn.pendingId);
      if (target !== undefined) {
        if ((target.kind !== 'spend' && target.kind !== 'old-card') || !target.pending) {
          throw new MoneyError('already-posted', `${txn.pendingId} is not a pending purchase`);
        }
        if (target.txn.kind !== txn.kind || target.txn.account !== txn.account) {
          throw new MoneyError('bad-transaction', `${txn.id} is on a different account from the pending charge it replaces`);
        }
        return this.#post(target, txn);
      }
      // The app never saw the pending charge, so this is simply a new purchase.
    }
    // 4.9: money leaving savings always waits in review; no rule sorts it.
    if (txn.kind === 'savings-withdrawal') return this.#addSpending(txn, 'purchase', { to: 'unsorted' });
    if (txn.account === 'old-card') return this.#addOldCard(txn);
    const rule = findRule(this.#rules, 'purchase', txn.description);
    return this.#addSpending(txn, 'purchase', rule === undefined ? { to: 'unsorted' } : { to: rule.bucket });
  }

  #addSpending(txn: Purchase | SavingsWithdrawal | CardCharge | Transfer | TransferSent | PersonPayment, spendingKind: SpendingKind, sortedTo: SpendingSort): Received {
    const pending = (txn.kind === 'purchase' || txn.kind === 'savings-withdrawal') && txn.pending;
    const entry: SpendEntry = {
      kind: 'spend',
      id: txn.id,
      txn,
      spendingKind,
      postedTxn: null,
      pending,
      amount: txn.amount,
      refunded: 0,
      countedAtSetup: 0,
      sortedTo,
      splitChanged: false,
      effect: {},
    };
    this.#addSpendingEntry(entry);
    return { id: txn.id, outcome: this.#review.has(entry.id) ? 'review' : 'sorted' };
  }

  // Rule 4.6: the posted charge replaces the pending one, even at a new amount.
  #post(entry: SpendEntry | OldCardEntry, txn: Purchase | SavingsWithdrawal): Received {
    const before = { postedTxn: entry.postedTxn, pending: entry.pending, amount: entry.amount };
    const sortedBefore = entry.kind === 'spend' ? { sortedTo: entry.sortedTo, splitChanged: entry.splitChanged } : null;
    entry.postedTxn = txn;
    entry.pending = false;
    entry.amount = txn.amount;
    try {
      if (entry.kind === 'spend') this.#refreshSpending(entry);
      else this.#setEffect(entry, { oldCardDebt: txn.amount - entry.countedAtSetup });
    } catch (error) {
      // Too large to stay exact (0.1): the pending charge stays as it was.
      Object.assign(entry, before, sortedBefore ?? {});
      throw error;
    }
    this.#aliases.set(txn.id, entry.id);
    return { id: txn.id, outcome: 'posted' };
  }

  // Rule 4.5.
  #receiveRefund(txn: Refund): Received {
    const target = txn.refundOf === undefined ? undefined : this.#entries.get(this.#aliases.get(txn.refundOf) ?? txn.refundOf);
    if (target?.kind !== 'spend' || target.spendingKind === 'debt-payoff' || txn.amount > target.amount - target.refunded) {
      return this.#holdMoneyIn(txn, 'refund');
    }
    this.#applyRefund(txn, target);
    return { id: txn.id, outcome: 'sorted' };
  }

  // A refund counted on the purchase it belongs to (4.5): whether the bank
  // said which one, or you did (A18).
  #applyRefund(txn: Refund, target: SpendEntry): void {
    const refunded = addCents(target.refunded, txn.amount);
    const before = { refunded: target.refunded, sortedTo: target.sortedTo, splitChanged: target.splitChanged };
    const entry: RefundEntry = { kind: 'refund', id: txn.id, txn, of: target.id, effect: {} };
    this.#add(entry, {});
    target.refunded = refunded;
    try {
      this.#refreshSpending(target);
    } catch (error) {
      // Too large to stay exact (0.1): the purchase stays as it was.
      Object.assign(target, before);
      this.#forget(entry.id);
      throw error;
    }
  }

  // Works out what a purchase does to the buckets now. A split that no
  // longer adds up (after a partial refund, or posting at a new amount) goes
  // back to review to be split again. A full refund of a split purchase
  // gives each bucket its part back (4.5): the split stays, and nothing waits.
  #refreshSpending(entry: SpendEntry): void {
    const net = netOf(entry);
    const sorted = entry.sortedTo;
    if ('split' in sorted && net !== 0 && sorted.split.reduce((sum, part) => sum + part.amount, 0) !== net) {
      entry.sortedTo = { to: 'unsorted' };
      entry.splitChanged = true;
    }
    // A charge counted at setup that posted at a new amount, or was
    // refunded: the difference waits in review.
    if ('to' in sorted && sorted.to === 'counted-at-setup' && net !== 0) entry.sortedTo = { to: 'unsorted' };
    const now = entry.sortedTo;
    let effect: Effect;
    if ('split' in now) {
      effect = {};
      if (net !== 0) {
        for (const part of now.split) {
          // A part of a payment to a person that is not mine lowers held for others (7.6).
          const pot = part.bucket === 'not-mine' ? 'heldForOthers' : part.bucket;
          effect[pot] = subtractCents(effect[pot] ?? 0, part.amount);
        }
      }
    } else if (now.to === 'unsorted') {
      effect = { unsortedOut: net };
    } else if (now.to === 'not-mine') {
      effect = { heldForOthers: -net };
    } else if (now.to === 'counted-at-setup') {
      effect = {};
    } else {
      effect = { [now.to]: -net };
    }
    // A payment to the old card also lowers the debt, however it is sorted.
    // When only the leaving half has been seen, the debt waits for it to
    // land (12.5).
    if (entry.spendingKind === 'debt-payoff' && entry.txn.kind === 'transfer') effect.oldCardDebt = -entry.amount;
    this.#setEffect(entry, effect);
    // A charge the bank dropped (A2) or took back (4.10) with nothing left
    // has nothing to sort. Nor has one refunded in full (4.5, A26): it leaves
    // review by itself, kept as a record sorted nowhere, and comes back if
    // the bank takes a refund back.
    const gone = entry.dropped === true || entry.takenBack === true;
    const refundedInFull = entry.refunded > 0 && net === 0;
    if ('to' in now && now.to === 'unsorted' && !((gone || refundedInFull) && net === 0)) this.#review.add(entry.id);
    else this.#review.delete(entry.id);
  }

  // Rules 3.1 to 3.5. A paycheck too large to stay exact (0.1) is refused
  // whole: no leftover moves, no question, no new pay period.
  #payday(txn: Deposit): void {
    this.#atomically(() => {
      // 13.1: a change to the split or the reserve applies from this paycheck.
      // The new pay period begins first, so what the paycheck does, leftover
      // moves included, is counted in it (B97).
      this.#periodSplit = splitSettingsOf(this.#settings);
      this.#period = { number: this.#period.number + 1, startDate: txn.date };
      const { needs, wants } = this.#settings.leftoverAtPayday;
      this.#periods.push({ number: this.#period.number, startDate: txn.date, opening: this.#potTotals(), openingDebt: this.#totals.oldCardDebt, split: this.#periodSplit, leftoverSetting: { needs, wants }, paycheckId: txn.id });
      this.#ledger.push([]);
      this.#closePeriod('needs', txn);
      this.#closePeriod('wants', txn);
      const split = splitPaycheck(txn.amount, this.#totals.momReserve, this.#periodSplit);
      const entry: PaycheckEntry = { kind: 'paycheck', id: txn.id, txn, split, effect: {} };
      // Her rulebook, 3.3 and 3.4: Wishlist gets its part, and is never asked about.
      this.#add(entry, { momReserve: split.momReserve, savings: split.savings, needs: split.needs, wants: split.wants, ...(split.wishlist === undefined ? {} : { wishlist: split.wishlist }) });
      this.#paychecks.push({ id: txn.id, date: txn.date, amount: txn.amount, split });
      this.#periodStart.needs = this.#totals.needs;
      this.#periodStart.wants = this.#totals.wants;
      this.#lastPaycheckDate = txn.date;
    });
  }

  // Rule 3.4: unspent money in a bucket at payday either rolls over or moves
  // to savings. A negative balance just carries over (3.5).
  #closePeriod(bucket: SplitBucket, txn: Deposit): void {
    // An unanswered question from an earlier payday is replaced by this one,
    // which covers everything now in the bucket, so nothing can move twice.
    for (const id of this.#review) {
      const old = this.#entry(id);
      if (old.kind === 'leftover' && old.bucket === bucket) {
        this.#review.delete(id);
        this.#entries.delete(id);
      }
    }
    const amount = this.#totals[bucket];
    const choice = this.#settings.leftoverAtPayday[bucket];
    if (amount <= 0 || choice === 'roll-over') return;
    const spentBefore = this.#spentBefore(bucket, txn.date);
    const entry: LeftoverEntry = { kind: 'leftover', id: `leftover:${txn.id}:${bucket}`, date: txn.date, bucket, amount, spentBefore, answer: 'open', answeredFor: null, effect: {} };
    this.#add(entry, {});
    if (choice === 'ask') this.#review.add(entry.id);
    else this.#answerLeftover(entry, 'move-to-savings', amount);
  }

  // What spending made before this day takes from a bucket now (4.1: it
  // comes out on the day it was made, whenever it shows up).
  #spentBefore(bucket: SplitBucket, day: IsoDate): Cents {
    let spent = 0;
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'spend' && daysBetween(entry.txn.date, day) > 0) spent = subtractCents(spent, entry.effect[bucket] ?? 0);
    }
    return spent;
  }

  // B4: what an open leftover question asks about now. Spending made before
  // payday that showed up or changed since lowers it, never below zero and
  // never above what was asked at payday.
  #asked(entry: LeftoverEntry): Cents {
    if (entry.answer !== 'open') return entry.answeredFor ?? entry.amount;
    const late = subtractCents(this.#spentBefore(entry.bucket, entry.date), entry.spentBefore);
    return Math.min(entry.amount, Math.max(0, subtractCents(entry.amount, late)));
  }

  // ----- Your answers -----

  // An open question is always about the payday that started this pay
  // period (an older one is replaced at the next payday). Moving the
  // leftover to savings also takes it out of what the bucket started this
  // pay period with (10.1).
  answerLeftover(id: string, answer: LeftoverAnswer, date: IsoDate): void {
    assertIsoDate(date);
    if (answer !== 'roll-over' && answer !== 'move-to-savings') throw new MoneyError('bad-choice', `not a leftover choice: ${String(answer)}`);
    const entry = this.#entries.get(id);
    if (entry?.kind !== 'leftover' || !this.#review.has(id)) throw new MoneyError('unknown-item', `no open leftover question ${id}`);
    // B4: what the question asks about now, after any late spending.
    const amount = this.#asked(entry);
    const start = answer === 'move-to-savings' ? subtractCents(this.#periodStart[entry.bucket], amount) : this.#periodStart[entry.bucket];
    this.#answerLeftover(entry, answer, amount);
    this.#periodStart[entry.bucket] = start;
    this.#review.delete(id);
  }

  #answerLeftover(entry: LeftoverEntry, answer: LeftoverAnswer, amount: Cents): void {
    if (answer === 'move-to-savings') this.#setEffect(entry, { [entry.bucket]: -amount, savings: amount });
    entry.answer = answer;
    entry.answeredFor = amount;
  }

  // Sorts something waiting in review, or re-sorts it later (4.7). Either
  // way it is sorted by hand (13.8), unless it was made a transfer, matched
  // to its purchase, or unmarked: then it is no longer one he sorted.
  sort(id: string, choice: SortChoice, date: IsoDate): void {
    refuseOffChoice(this.#switches, choice);
    this.#sortAnswer(id, choice, date);
    if (typeof choice === 'object' && choice !== null && ('to' in choice || 'split' in choice)) {
      const entry = this.#entries.get(this.#aliases.get(id) ?? id);
      if (entry?.kind === 'spend' || entry?.kind === 'money-in') entry.byHand = true;
    }
  }

  #sortAnswer(id: string, choice: SortChoice, date: IsoDate): void {
    assertIsoDate(date);
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) throw new MoneyError('unknown-item', `no item ${id}`);
    // Taken back by the bank (4.10): only what is left of it, if anything, waits to be sorted.
    if (this.#gone(entry) && !this.#review.has(entry.id)) throw new MoneyError('not-sortable', `the bank took back ${id}`);
    if (typeof choice === 'object' && choice !== null && 'unmark' in choice) return this.#unmark(entry, choice.unmark);
    // A21: one you marked from savings takes savings or needs (A4), or is unmarked; to be
    // anything else, unmark it first. One tap cannot mean both.
    if (entry.kind === 'spend' && this.#markedFromSavings(entry) && !(typeof choice === 'object' && choice !== null && 'to' in choice && (choice.to === 'savings' || choice.to === 'needs'))) {
      throw new MoneyError('bad-choice', `${id} is marked as a payment to the old card from savings: it comes out of savings or needs, or say it was not one`);
    }
    if (typeof choice === 'object' && choice !== null && 'transfer' in choice) return this.#markAsTransfer(entry, choice.transfer);
    if (typeof choice === 'object' && choice !== null && 'refundOf' in choice) return this.#matchRefund(entry, choice.refundOf);
    // Marked as a transfer by hand (5.6): sorting it any other way makes it
    // what the bank sent again first. A payment to the old card from savings
    // still takes savings or needs, like any (5.2, A4). From checking, picking
    // needs is picking what the purchase was (A20, B110).
    const oldCardFromSavings =
      entry.kind === 'spend' &&
      entry.spendingKind === 'debt-payoff' &&
      (entry.txn.kind === 'transfer' || entry.txn.kind === 'transfer-sent') &&
      entry.txn.from === 'savings' &&
      'to' in choice &&
      (choice.to === 'savings' || choice.to === 'needs');
    if ((entry.kind === 'leg' || entry.kind === 'spend') && entry.original !== undefined && !oldCardFromSavings) {
      this.#atomically(() => this.sort(this.#restore(entry), choice, date));
      return;
    }
    switch (entry.kind) {
      case 'spend':
        if ((entry.txn.kind === 'transfer' || entry.txn.kind === 'transfer-sent') && entry.txn.from === 'checking') {
          throw new MoneyError('not-sortable', `${id} is a payment to the old card, which always comes out of needs (5.2)`);
        }
        return this.#sortSpending(entry, choice);
      case 'money-in':
        return this.#sortMoneyIn(entry, choice);
      case 'mom':
        // 7.6: a payment marked for mom by hand or by a person rule can be
        // sorted again. One the mom rule matched always stays on the reserve (8.1).
        if (entry.how === 'mom-rule') throw new MoneyError('not-sortable', `${id} matches the mom rule, so it always comes out of the mom reserve (8.1)`);
        if (isPersonPaymentChoice(choice) && choice.to === 'mom') return;
        this.#atomically(() => {
          this.#unMom(entry);
          this.#sortSpending(this.#spendEntry(entry.id), choice);
        });
        return;
      default:
        throw new MoneyError('not-sortable', `${id} is a ${entry.kind} and cannot be sorted`);
    }
  }

  // 4.5, QUESTIONS.md A18: a refund the bank did not match, matched by you to
  // the purchase it belongs to. It then counts exactly as if the bank had
  // matched it, and like a matched refund it cannot be sorted again. A
  // refund already put back into a bucket can still be matched; that is
  // undone first.
  //
  // QUESTIONS.md A29: money in to checking can be a store's refund to the
  // debit card, which the bank shows as a deposit. Matched, it becomes that
  // refund, as if the bank had said so.
  #matchRefund(entry: Entry, purchaseId: unknown): void {
    if (entry.kind !== 'money-in' || !(entry.txn.kind === 'refund' || entry.txn.account === 'checking')) {
      throw new MoneyError('bad-choice', `only a store refund or money in to checking can be matched to a purchase, and ${entry.id} is not one`);
    }
    const txn: Refund = entry.txn.kind === 'refund' ? entry.txn : { kind: 'refund', id: entry.txn.id, account: 'checking', date: entry.txn.date, amount: entry.txn.amount, description: entry.txn.description };
    const target = typeof purchaseId === 'string' ? this.#entries.get(this.#aliases.get(purchaseId) ?? purchaseId) : undefined;
    if (target?.kind !== 'spend' || !this.#couldBelongTo(txn, target)) {
      throw new MoneyError('bad-choice', 'that is not a purchase this refund can belong to: it must be on the same account, on or before the refund, with at least the refund left to refund');
    }
    this.#atomically(() => {
      this.#remove(entry);
      this.#applyRefund(txn, target);
    });
  }

  // 20d, A15: the purchases a refund likely belongs to; A29: money in to
  // checking too, which can be a store's refund to the debit card. Money in
  // to savings has none: nothing is bought from savings.
  #likelyFor(txn: Deposit | Refund): LikelyPurchase[] {
    return likelyPurchases({ account: txn.account, date: txn.date, amount: txn.amount, description: txn.description }, this.#purchaseCandidates());
  }

  // 4.5: a purchase a refund can belong to: on the same account, made on or
  // before the day of the refund, with at least the refund's amount not yet
  // refunded. One the bank took back or dropped has nothing left.
  #couldBelongTo(refund: Refund, e: SpendEntry): boolean {
    return (
      e.spendingKind === 'purchase' &&
      e.txn.kind === 'purchase' &&
      e.txn.account === refund.account &&
      daysBetween(e.txn.date, refund.date) >= 0 &&
      e.amount - e.refunded >= refund.amount
    );
  }

  // 5.6: spending or money in that was really a transfer between your own
  // accounts. It becomes that transfer's half, leaving checking or savings,
  // or arriving in the account it came into, and is handled as one: no
  // bucket changes (5.1, 5.3), in transit until its other half shows (12.5),
  // or out of needs when it pays the old card from checking (5.2). What the
  // bank sent is kept, so sorting it another way later brings it back.
  #markAsTransfer(entry: Entry, other: unknown): void {
    if (typeof other !== 'string' || !(ALL_ACCOUNTS as readonly string[]).includes(other)) {
      throw new MoneyError('bad-choice', `a transfer is with one of your four accounts, not ${String(other)}`);
    }
    const account = other as AccountId;
    if ((entry.kind === 'leg' || entry.kind === 'spend') && entry.original !== undefined) {
      // Marked already with this account: not a choice (A20), so it is refused rather than redone.
      const partner = entry.txn.kind === 'transfer-sent' ? entry.txn.to : entry.txn.kind === 'transfer-arrived' ? entry.txn.from : undefined;
      if (partner === account) throw new MoneyError('bad-choice', `${entry.id} is already marked as a transfer with ${account}`);
      this.#atomically(() => this.#markAsTransfer(this.#entry(this.#restore(entry)), account));
      return;
    }
    const { original, posted, half } = this.#halfFrom(entry, account);
    this.#atomically(() => {
      this.#remove(entry);
      if (half.kind === 'transfer-sent') this.#receiveSent(half);
      else this.#receiveArrived(half);
      const made = this.#entry(half.id);
      if (made.kind !== 'leg' && made.kind !== 'spend') throw new MoneyError('broken-book', `${half.id} did not become a transfer`);
      made.original = original;
      if (posted !== null) made.originalPosted = posted;
    });
  }

  // The half of a transfer an entry becomes when you mark it as one (5.6).
  #halfFrom(entry: Entry, other: AccountId): { original: MarkedAsTransfer; posted: Purchase | SavingsWithdrawal | null; half: TransferSent | TransferArrived } {
    const refuse = (why: string): never => {
      throw new MoneyError('bad-choice', `${entry.id} cannot be a transfer: ${why}`);
    };
    if (entry.kind === 'spend') {
      if (entry.pending) throw new MoneyError('still-pending', `${entry.id} is still pending; mark it once it posts`);
      const txn = entry.txn;
      const fromAnAccount = txn.kind === 'purchase' || txn.kind === 'savings-withdrawal' || txn.kind === 'payment-to-person';
      if (!fromAnAccount || (entry.spendingKind !== 'purchase' && entry.spendingKind !== 'person-payment')) {
        refuse('only money leaving checking or savings can be the leaving half');
      }
      if (txn.kind !== 'purchase' && txn.kind !== 'savings-withdrawal' && txn.kind !== 'payment-to-person') return refuse('not spending from an account');
      if (txn.account !== 'checking' && txn.account !== 'savings') refuse('money leaving a card is never a transfer');
      if (entry.refunded > 0 || entry.countedAtSetup > 0 || entry.dropped === true || this.#gone(entry)) refuse('part of it was refunded, counted on setup day, or taken back');
      const from = txn.account as 'checking' | 'savings';
      if (other === from) refuse('a transfer goes to another of your accounts');
      const shown = entry.postedTxn ?? txn;
      const half: TransferSent = { kind: 'transfer-sent', id: entry.id, from, to: other, date: shown.date, amount: entry.amount, description: shown.description };
      return { original: txn, posted: entry.postedTxn, half };
    }
    const arriving = entry.kind === 'money-in' || (entry.kind === 'old-card' && entry.txn.kind === 'refund');
    if (!arriving || this.#gone(entry)) return refuse('only spending from checking or savings, or money in, can be a transfer');
    const txn = entry.txn;
    if (txn.kind !== 'deposit' && txn.kind !== 'refund') return refuse('only money in can be the arriving half');
    if (other !== 'checking' && other !== 'savings') refuse('money arrives from checking or savings');
    if (other === txn.account) refuse('a transfer comes from another of your accounts');
    const half: TransferArrived = { kind: 'transfer-arrived', id: entry.id, from: other as 'checking' | 'savings', to: txn.account, date: txn.date, amount: txn.amount, description: txn.description };
    return { original: txn, posted: null, half };
  }

  // A21: a payment to the old card from savings that you marked by hand
  // (5.6): not one the bank sent as such.
  #markedFromSavings(entry: SpendEntry): boolean {
    const txn = entry.txn;
    return entry.spendingKind === 'debt-payoff' && entry.original !== undefined && (txn.kind === 'transfer' || txn.kind === 'transfer-sent') && txn.from === 'savings';
  }

  // QUESTIONS.md A21: "It was not a payment to the old card". One you marked
  // from savings becomes what the bank sent again, taken as the bank sent it
  // (money leaving savings waits in review, 4.9); the old card owes what it
  // did before. Whatever bucket it was sorted to gets its money back.
  #unmark(entry: Entry, yes: unknown): void {
    if (yes !== true || entry.kind !== 'spend' || !this.#markedFromSavings(entry)) {
      throw new MoneyError('bad-choice', `${entry.id} is not a payment you marked as going to the old card from savings`);
    }
    this.#atomically(() => this.#restore(entry));
  }

  // Undoes a transfer you marked by hand and gives the book what the bank
  // sent instead, as it would have taken it then. Returns its id.
  #restore(entry: LegEntry | SpendEntry): string {
    const { original, originalPosted } = entry;
    if (original === undefined) throw new MoneyError('broken-book', `${entry.id} was not marked as a transfer`);
    this.#remove(entry);
    this.#dispatch(original);
    if (originalPosted !== undefined) this.#dispatch(originalPosted);
    return original.id;
  }

  // 7.6: a payment for mom made back into a payment to a person, unsorted.
  #unMom(entry: MomEntry): void {
    const difference = this.#entries.get(`${entry.id}:difference`);
    if (difference !== undefined) this.#remove(difference);
    this.#remove(entry);
    this.#addSpending(entry.txn, 'person-payment', { to: 'unsorted' });
  }

  #spendEntry(id: string): SpendEntry {
    const entry = this.#entry(id);
    if (entry.kind !== 'spend') throw new MoneyError('broken-book', `${id} is not spending`);
    return entry;
  }

  // Clears a flag in review that has no money to sort (5.4).
  acknowledge(id: string, date: IsoDate): void {
    assertIsoDate(date);
    const entry = this.#entries.get(id);
    if (entry?.kind !== 'old-card' || !this.#review.has(id)) throw new MoneyError('unknown-item', `no flag ${id} waiting in review`);
    this.#review.delete(id);
  }

  // Rules 4.3, 4.4, 4.7, 4.8, 7.2, 7.6.
  #sortSpending(entry: SpendEntry, choice: SortChoice): void {
    const before = { sortedTo: entry.sortedTo, splitChanged: entry.splitChanged };
    if (!('split' in choice) && !('to' in choice)) throw new MoneyError('bad-choice', `not a way to sort spending: ${JSON.stringify(choice)}`);
    const person = entry.spendingKind === 'person-payment';
    if (person && !('split' in choice)) {
      if (!isPersonPaymentChoice(choice)) throw new MoneyError('bad-choice', 'a payment to a person goes to needs, wants, not mine, or for mom, or is split across needs, wants and not mine');
      if (choice.to === 'mom') {
        // 7.6: for mom, it comes out of the mom reserve like a payment the mom rule matches (8.1).
        if (entry.txn.kind !== 'payment-to-person' || entry.refunded > 0) throw new MoneyError('bad-choice', `${entry.id} cannot be for mom: part of it was refunded`);
        const txn = entry.txn;
        this.#atomically(() => {
          this.#remove(entry);
          this.#payMom(txn, 'by-hand');
        });
        return;
      }
      entry.sortedTo = Object.freeze({ to: choice.to });
    } else if (entry.spendingKind === 'debt-payoff') {
      // QUESTIONS.md A4: a payment to the old card from savings comes out of
      // the savings bucket once you confirm it, or out of needs if you pick
      // that instead (5.2).
      if ('split' in choice || (choice.to !== 'savings' && choice.to !== 'needs')) {
        throw new MoneyError('bad-choice', 'a payment to the old card from savings comes out of savings or needs');
      }
      entry.sortedTo = Object.freeze({ to: choice.to });
    } else if (entry.spendingKind === 'mom-difference' && 'split' in choice) {
      throw new MoneyError('bad-choice', 'the difference on a mom payment goes to needs or wants');
    } else if ('split' in choice) {
      if (!Array.isArray(choice.split)) throw new MoneyError('bad-choice', 'a split needs a list of parts');
      const parts = choice.split.map((part) => {
        // 4.4: spending splits across needs and wants (her rulebook: and Wishlist); 7.6: a payment to a
        // person can also have a part that is not mine, and never one in Wishlist.
        if (!(isSortBucket(part.bucket) && !(person && part.bucket === 'wishlist')) && !(person && part.bucket === 'not-mine')) {
          throw new MoneyError('bad-choice', `${person ? 'a payment to a person splits across needs, wants and not mine' : 'spending can go to needs, wants or Wishlist'}, not ${String(part.bucket)}`);
        }
        assertPositiveCents(part.amount, 'each part of a split');
        return Object.freeze({ bucket: part.bucket, amount: part.amount });
      });
      const total = addCents(0, ...parts.map((part) => part.amount));
      const net = netOf(entry);
      if (total !== net) throw new MoneyError('split-does-not-add-up', `the parts add up to ${total}, the purchase is ${net}`);
      entry.sortedTo = Object.freeze({ split: Object.freeze(parts) });
    } else if (isSortBucket(choice.to) && !(choice.to === 'wishlist' && entry.spendingKind === 'mom-difference')) {
      entry.sortedTo = Object.freeze({ to: choice.to });
    } else {
      throw new MoneyError('bad-choice', `spending can go to needs, wants or Wishlist, not ${String(choice.to)}`);
    }
    entry.splitChanged = false;
    try {
      this.#refreshSpending(entry);
    } catch (error) {
      // Too large to stay exact (0.1): it stays sorted the way it was.
      Object.assign(entry, before);
      throw error;
    }
  }

  // Rule 6.1: this is my paycheck, other income, payback, or not mine. A
  // store refund the app could not match can be payback or not mine, but
  // neither kind of income.
  #sortMoneyIn(entry: MoneyInEntry, choice: SortChoice): void {
    if (!isMoneyInChoice(choice)) throw new MoneyError('bad-choice', 'money in is your paycheck, other income, payback into one bucket, or not mine');
    const txn = entry.txn;
    if (choice.to === 'paycheck' || choice.to === 'other-income') {
      if (txn.kind === 'refund') throw new MoneyError('bad-choice', 'a store refund is not income');
      if (choice.to === 'paycheck') return this.#makePaycheck(entry, txn);
    }
    const amount = txn.amount;
    let effect: Effect;
    let incomeSplit: PaycheckSplit | null = null;
    if (choice.to === 'other-income') {
      // Split by this pay period's percentages (13.1), with no mom reserve:
      // the reserve comes only from paychecks.
      incomeSplit = splitPaycheck(amount, this.#totals.momReserve, { ...this.#periodSplit, momReservePerPaycheck: 0 });
      effect = { momReserve: incomeSplit.momReserve, savings: incomeSplit.savings, needs: incomeSplit.needs, wants: incomeSplit.wants, ...(incomeSplit.wishlist === undefined ? {} : { wishlist: incomeSplit.wishlist }) };
    } else if (choice.to === 'not-mine') {
      effect = { heldForOthers: amount };
    } else {
      effect = { [choice.to]: amount };
    }
    this.#setEffect(entry, effect);
    entry.sortedTo = choice.to;
    entry.incomeSplit = incomeSplit;
    this.#review.delete(entry.id);
  }

  // 6.1 "this is my paycheck": it starts a new pay period exactly as if the
  // paycheck rule had matched it (3.1 to 3.5), and like any paycheck it is
  // final. Whatever it was sorted to before is taken back first. A deposit
  // older than the last paycheck cannot start a pay period; it can still be
  // other income.
  #makePaycheck(entry: MoneyInEntry, txn: Deposit): void {
    if (daysBetween(this.#lastPaycheckDate, txn.date) < 0) {
      throw new MoneyError('bad-choice', `${txn.id} is older than the last paycheck, so it cannot start a new pay period; it can be other income`);
    }
    // Her rulebook, 51.2: while asking, the older paycheck is answered first.
    if (this.#settings.askBeforeSplittingPaycheck === true) {
      const older = olderPaycheckWaiting(this.paychecksWaiting(), this.#lastPaycheckDate, txn.date);
      if (older !== null) refuseYesWhileOlderWaits(older);
    }
    this.#atomically(() => {
      this.#remove(entry);
      this.#payday(txn);
    });
  }

  #moneyInEntry(id: string): MoneyInEntry {
    const entry = this.#entry(id);
    if (entry.kind !== 'money-in') throw new MoneyError('broken-book', `${id} is not money in`);
    return entry;
  }

  // ----- Changes (section 13) -----

  // 13.1: a change to the split or the mom reserve applies from the next
  // paycheck; everything else applies right away. 0.3: nothing already
  // worked out is redone.
  changeSettings(patch: Partial<Settings>, date: IsoDate): { readonly rechecked: readonly RecheckedItem[] } {
    assertIsoDate(date);
    refuseOffSettings(this.#switches, patch);
    const next = applySettingsChange(this.#settings, patch);
    const before = this.#settings;
    try {
      return this.#atomically(() => {
        this.#settings = next;
        const keys = Object.keys(patch) as (keyof Settings)[];
        const changes = Object.freeze(Object.fromEntries(keys.map((key) => [key, next[key]])));
        const was = Object.freeze(Object.fromEntries(keys.map((key) => [key, before[key]])));
        this.#log.push(Object.freeze({ date, kind: 'settings-changed', changes, before: was }));
        // QUESTIONS.md A9: a new paycheck rule or mom rule also checks what is
        // waiting in review, the way a new sorting rule does (13.2).
        const rechecked = [...('paycheckRule' in patch ? this.#recheckForPaychecks() : []), ...('momRule' in patch ? this.#recheckForMom() : [])];
        return Object.freeze({ rechecked: Object.freeze(rechecked) });
      });
    } catch (error) {
      this.#settings = before;
      throw error;
    }
  }

  // A9: what changeSettings would do, without doing it. The change is made,
  // looked at, and undone in full (#atomically), so the preview is exactly
  // what the change itself does, and a change that would be refused is
  // refused here too.
  previewSettingsChange(patch: Partial<Settings>, date: IsoDate): SettingsPreview {
    const settings = this.#settings;
    const potsBefore = this.pots();
    const waitingBefore = this.#review.size;
    let preview: SettingsPreview | undefined;
    try {
      this.#atomically(() => {
        const { rechecked } = this.changeSettings(patch, date);
        preview = Object.freeze({ items: rechecked, potsBefore, potsAfter: this.pots(), waitingBefore, waitingAfter: this.#review.size });
        throw DRY_RUN;
      });
    } catch (error) {
      if (error !== DRY_RUN) throw error;
    } finally {
      this.#settings = settings;
    }
    if (preview === undefined) throw new MoneyError('broken-book', 'the preview of a settings change was not made');
    return preview;
  }

  // A9: waiting deposits that match the paycheck rule, oldest first. Each
  // starts a pay period like any paycheck (3.1), unless it is less than 10
  // days after the last paycheck, or older than it (3.7, B54); then it waits
  // as an early paycheck, with the same choices (6.1).
  #recheckForPaychecks(): RecheckedItem[] {
    const matching = [...this.#review]
      .map((id) => this.#entry(id))
      .filter((entry): entry is MoneyInEntry & { txn: Deposit } => {
        return entry.kind === 'money-in' && entry.reason === 'deposit' && entry.txn.kind === 'deposit' && matchesTextRule(this.#settings.paycheckRule, entry.txn.description);
      })
      .sort((a, b) => daysBetween(b.txn.date, a.txn.date));
    const handled: RecheckedItem[] = [];
    for (const entry of matching) {
      const { id, date, amount, description } = entry.txn;
      if (daysBetween(this.#lastPaycheckDate, date) < this.#settings.earlyPaycheckDays) {
        entry.reason = 'early-paycheck';
        handled.push(Object.freeze({ kind: 'early-paycheck', id, date, amount, description }));
      } else if (this.#settings.askBeforeSplittingPaycheck === true) {
        // Her rulebook, 13.2: it waits for your yes; none is split.
        entry.reason = 'paycheck';
        handled.push(Object.freeze({ kind: 'paycheck-waiting', id, date, amount, description, wouldGet: this.#splitIfPaycheck(amount) }));
      } else {
        this.#makePaycheck(entry, entry.txn);
        const record = this.#paychecks[this.#paychecks.length - 1];
        if (record?.id !== id) throw new MoneyError('broken-book', `${id} did not become a paycheck`);
        const split = Object.freeze({ ...record.split, detail: Object.freeze({ ...record.split.detail }) });
        handled.push(Object.freeze({ kind: 'paycheck', id, date, amount, description, split }));
      }
    }
    return handled;
  }

  // A9: waiting payments to a person that match the mom rule come out of the
  // mom reserve, oldest first (8.1); what the reserve cannot cover waits in
  // review (8.3).
  #recheckForMom(): RecheckedItem[] {
    const matching = [...this.#review]
      .map((id) => this.#entry(id))
      .filter((entry): entry is SpendEntry & { txn: PersonPayment } => {
        return entry.kind === 'spend' && entry.spendingKind === 'person-payment' && entry.txn.kind === 'payment-to-person' && matchesTextRule(this.#settings.momRule, entry.txn.description);
      })
      .sort((a, b) => daysBetween(b.txn.date, a.txn.date));
    const handled: RecheckedItem[] = [];
    for (const entry of matching) {
      // 13.2, B73: a payment partly refunded cannot be for mom. Taking it out
      // and paying mom from what the bank first sent would lose the refund.
      // (One the bank took back waits only for money back, so it has a refund too.)
      if (entry.refunded > 0) {
        const { id, date, description } = entry.txn;
        handled.push(Object.freeze({ kind: 'still-waiting', id, date, amount: netOf(entry), description, why: 'partly-refunded' }));
        continue;
      }
      this.#remove(entry);
      this.#payMom(entry.txn, 'mom-rule');
      const mom = this.#entry(entry.txn.id);
      if (mom.kind !== 'mom') throw new MoneyError('broken-book', `${entry.txn.id} did not come out of the mom reserve`);
      const { id, date, amount, description } = entry.txn;
      handled.push(Object.freeze({ kind: 'mom', id, date, amount, description, fromReserve: mom.fromReserve, difference: amount - mom.fromReserve }));
    }
    return handled;
  }

  // 13.2: a new or changed rule applies to new transactions and to those
  // waiting in review. Anything already sorted stays put.
  // stillWaiting: the waiting items the rule matched but that cannot take
  // what it says (QUESTIONS.md A19); they wait for you.
  addRule(rule: SortingRule, date: IsoDate): { readonly stillWaiting: readonly string[] } {
    assertIsoDate(date);
    refuseOffRule(this.#switches, rule);
    return this.#atomically(() => {
      this.#rules = checkRules([...this.#rules, rule]);
      this.#log.push(Object.freeze({ date, kind: 'rule-added', rule: this.#ruleById(rule.id) }));
      return { stillWaiting: this.#sortWaitingByRules(rule.id) };
    });
  }

  // 13.6: re-sort an item and "always do this". The new rule goes just ahead
  // of the rule it corrects, so the correction sticks: the earliest rule that
  // matches the item, either as it first arrived (new purchases are sorted
  // on that, often a pending description) or as it posted. If no rule
  // matches it, the new rule goes at the end. The rule's text must match the
  // item one way or the other. sticks says whether the next item arriving
  // the way this one did will now go where you sorted this one.
  sortAlways(id: string, choice: SortChoice, rule: { readonly id: string; readonly contains: string }, date: IsoDate): { readonly sticks: boolean; readonly stillWaiting: readonly string[] } {
    assertIsoDate(date);
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) throw new MoneyError('unknown-item', `no item ${id}`);
    let newRule: SortingRule;
    // How the item has appeared: as it arrived first, then as it posted.
    let descriptions: string[];
    // 4.9: money leaving savings always waits in review, so no rule can sort it.
    const fromSavings = entry.kind === 'spend' && entry.txn.kind === 'savings-withdrawal';
    // A20: a purchase you marked as a payment to the old card from checking is, for a
    // rule, the purchase it was: sorting it makes it that again first.
    const was = entry.kind === 'spend' ? this.#wasBeforeMarked(entry) : undefined;
    if ('transfer' in choice) throw new MoneyError('bad-choice', 'a sorting rule cannot mark transfers; the bank rules in settings do that');
    if ('refundOf' in choice) throw new MoneyError('bad-choice', 'a sorting rule cannot match a refund to a purchase');
    if ('unmark' in choice) throw new MoneyError('bad-choice', 'a sorting rule cannot unmark a transfer');
    if (was?.kind === 'purchase' || (entry.kind === 'spend' && was === undefined && entry.spendingKind === 'purchase' && !fromSavings)) {
      if ('split' in choice || !isSpendingBucket(choice.to)) throw new MoneyError('bad-choice', 'a rule picks needs or wants; it cannot split');
      newRule = { id: rule.id, for: 'purchase', contains: rule.contains, bucket: choice.to };
      descriptions = was?.descriptions ?? (entry.kind === 'spend' ? [entry.txn.description, ...(entry.postedTxn === null ? [] : [entry.postedTxn.description])] : []);
    } else if (was?.kind === 'person-payment' || (entry.kind === 'spend' && was === undefined && entry.spendingKind === 'person-payment')) {
      if (!isPersonPaymentChoice(choice)) throw new MoneyError('bad-choice', 'a person rule picks needs, wants, not mine, or mom; it cannot split');
      newRule = { id: rule.id, for: 'person', contains: rule.contains, choice: { to: choice.to } };
      descriptions = was?.descriptions ?? (entry.kind === 'spend' ? [entry.txn.description] : []);
    } else if (entry.kind === 'money-in' && entry.reason === 'deposit') {
      if (!isDepositRuleChoice(choice)) {
        throw new MoneyError('bad-choice', 'a deposit rule picks other income, a bucket, or not mine; paychecks are found by the paycheck rule in settings');
      }
      newRule = { id: rule.id, for: 'deposit', contains: rule.contains, choice: { to: choice.to } };
      descriptions = [entry.txn.description];
    } else {
      throw new MoneyError('no-rule-for-this', `${id} is not something a sorting rule can cover`);
    }
    const covers = (r: SortingRule): boolean => r.for === newRule.for && descriptions.some((d) => matchesTextRule(r, d));
    if (!covers(newRule)) throw new MoneyError('bad-rule', `"${rule.contains}" does not match ${descriptions.map((d) => `"${d}"`).join(' or ')}`);
    const found = this.#rules.findIndex(covers);
    const at = found === -1 ? this.#rules.length : found;
    const corrected = this.#rules[at];
    return this.#atomically(() => {
      this.#rules = checkRules([...this.#rules.slice(0, at), newRule, ...this.#rules.slice(at)]);
      this.sort(entry.id, choice, date);
      const added = this.#ruleById(newRule.id);
      this.#log.push(Object.freeze({ date, kind: 'rule-added-from-correction', rule: added, correcting: entry.id, aheadOf: corrected?.id ?? null }));
      const stillWaiting = this.#sortWaitingByRules(added.id);
      return { sticks: findRule(this.#rules, newRule.for, descriptions[0] ?? '')?.id === added.id, stillWaiting };
    });
  }

  changeRule(rule: SortingRule, date: IsoDate): { readonly stillWaiting: readonly string[] } {
    assertIsoDate(date);
    refuseOffRule(this.#switches, rule);
    const before = this.#ruleById(rule.id);
    return this.#atomically(() => {
      this.#rules = checkRules(this.#rules.map((r) => (r.id === rule.id ? rule : r)));
      this.#log.push(Object.freeze({ date, kind: 'rule-changed', before, after: this.#ruleById(rule.id) }));
      return { stillWaiting: this.#sortWaitingByRules(rule.id) };
    });
  }

  removeRule(id: string, date: IsoDate): void {
    assertIsoDate(date);
    const rule = this.#ruleById(id);
    this.#rules = checkRules(this.#rules.filter((r) => r.id !== id));
    this.#log.push(Object.freeze({ date, kind: 'rule-removed', rule }));
  }

  // 13.2, QUESTIONS.md A22: moves a rule one place up or down among the
  // rules of its kind (only those compete, B9), past the next one of its kind;
  // rules of other kinds stay where they are. What waits in review that
  // either rule is now the first match for is sorted, as after a changed
  // rule; what is sorted already stays where it is. Returns the waiting items
  // they matched but could not sort (A19).
  moveRule(id: string, direction: 'up' | 'down', date: IsoDate): { readonly stillWaiting: readonly string[] } {
    assertIsoDate(date);
    if (direction !== 'up' && direction !== 'down') throw new MoneyError('bad-rule', `a rule moves up or down, not ${String(direction)}`);
    const rule = this.#ruleById(id);
    const at = this.#rules.indexOf(rule);
    const ofItsKind = this.#rules.flatMap((r, i) => (r.for === rule.for ? [i] : []));
    const k = ofItsKind.indexOf(at);
    const other = ofItsKind[direction === 'up' ? k - 1 : k + 1];
    if (other === undefined) throw new MoneyError('bad-rule', `${id} is already ${direction === 'up' ? 'first' : 'last'} of its kind`);
    const past = this.#rules[other] as SortingRule;
    return this.#atomically(() => {
      const next = [...this.#rules];
      next[at] = past;
      next[other] = rule;
      this.#rules = checkRules(next);
      const position = (direction === 'up' ? k - 1 : k + 1) + 1;
      this.#log.push(Object.freeze({ date, kind: 'rule-moved', rule: this.#ruleById(id), past: this.#ruleById(past.id), direction, position }));
      const stillWaiting = [...this.#sortWaitingByRules(id), ...this.#sortWaitingByRules(past.id)];
      return { stillWaiting: [...new Set(stillWaiting)] };
    });
  }

  #ruleById(id: string): SortingRule {
    const rule = this.#rules.find((r) => r.id === id);
    if (rule === undefined) throw new MoneyError('unknown-rule', `no rule ${id}`);
    return rule;
  }

  // A20: what a purchase you marked as a payment to the old card from checking
  // was, for a sorting rule: a purchase or a payment to a person, as the bank
  // described it. Undefined for anything else.
  #wasBeforeMarked(entry: SpendEntry): { readonly kind: 'purchase' | 'person-payment'; readonly descriptions: string[] } | undefined {
    const { original, originalPosted } = entry;
    if (original === undefined || entry.spendingKind !== 'debt-payoff') return undefined;
    // Only from checking: one from savings keeps its own choices (A4, A21).
    if ((entry.txn.kind !== 'transfer' && entry.txn.kind !== 'transfer-sent') || entry.txn.from !== 'checking') return undefined;
    if (original.kind === 'savings-withdrawal') return undefined;
    return {
      kind: original.kind === 'payment-to-person' ? 'person-payment' : 'purchase',
      descriptions: [original.description, ...(originalPosted === undefined ? [] : [originalPosted.description])],
    };
  }

  // 13.2: a new or changed rule sorts the items waiting in review that it is
  // now the first match for. It never lets another, older rule sort them:
  // an item an older rule matches is waiting for a reason (a split that
  // stopped adding up, a difference from setup day), and is yours to decide.
  // QUESTIONS.md A19: an item the rule matches but that cannot take what it
  // says (a partly refunded payment cannot be for mom, B73) stays waiting,
  // exactly as it was. Returns those items.
  #sortWaitingByRules(ruleId: string): string[] {
    const stillWaiting: string[] = [];
    for (const id of [...this.#review]) {
      const entry = this.#entry(id);
      const unsortedSpending = entry.kind === 'spend' && 'to' in entry.sortedTo && entry.sortedTo.to === 'unsorted';
      // 4.9: money leaving savings is never sorted by a rule.
      const fromSavings = entry.kind === 'spend' && entry.txn.kind === 'savings-withdrawal';
      let apply: (() => void) | undefined;
      if (unsortedSpending && entry.spendingKind === 'purchase' && !fromSavings) {
        const rule = this.#firstMatchIfIt(ruleId, 'purchase', (entry.postedTxn ?? entry.txn).description);
        if (rule !== undefined) apply = () => this.#sortSpending(entry, { to: rule.bucket });
      } else if (unsortedSpending && entry.spendingKind === 'person-payment') {
        const rule = this.#firstMatchIfIt(ruleId, 'person', entry.txn.description);
        if (rule !== undefined) apply = () => this.#sortSpending(entry, rule.choice);
      } else if (entry.kind === 'money-in' && entry.reason === 'deposit' && entry.sortedTo === 'unsorted') {
        const rule = this.#firstMatchIfIt(ruleId, 'deposit', entry.txn.description);
        if (rule !== undefined) apply = () => this.#sortMoneyIn(entry, rule.choice);
      }
      if (apply === undefined) continue;
      // 13.8: a rule sorts it, not he.
      if (entry.kind === 'spend' || entry.kind === 'money-in') entry.byHand = false;
      try {
        this.#atomically(apply);
      } catch (error) {
        if (!(error instanceof MoneyError)) throw error;
        stillWaiting.push(id);
      }
    }
    return stillWaiting;
  }

  // The first rule of this kind that matches, but only if it is the rule
  // with this id.
  #firstMatchIfIt<K extends SortingRule['for']>(ruleId: string, kind: K, description: string): Extract<SortingRule, { for: K }> | undefined {
    const rule = findRule(this.#rules, kind, description);
    return rule?.id === ruleId ? rule : undefined;
  }

  // 13.3 and 13.4: move money between buckets by hand. Moving out of
  // savings or the mom reserve, or a move that would leave the bucket it
  // comes out of below zero (usually a typo), needs your confirmation first.
  moveMoney(move: MoneyMove, date: IsoDate): MoveResult {
    assertIsoDate(date);
    const { from, to, amount } = move;
    if (!WITH_WISHLIST.includes(from) || !WITH_WISHLIST.includes(to) || from === to) {
      throw new MoneyError('bad-move', `cannot move money from ${String(from)} to ${String(to)}`);
    }
    assertPositiveCents(amount, 'amount to move');
    refuseOffMove(this.#switches, move);
    const reasons: ConfirmReason[] = [];
    if (from === 'savings') reasons.push('out-of-savings');
    if (from === 'momReserve') reasons.push('out-of-mom-reserve');
    if (from === 'wishlist') reasons.push('out-of-wishlist');
    if (subtractCents(this.#totals[from], amount) < 0) reasons.push('below-zero');
    if (reasons.length > 0 && move.confirmed !== true) return { moved: false, needsConfirmation: true, reasons };
    // A move that is refused (a total too large to stay exact, 0.1) does not
    // use up a number: it is counted only once it has gone through.
    const entry: MoveEntry = { kind: 'move', id: `move:${this.#moveCount + 1}`, date, from, to, effect: {} };
    this.#add(entry, { [from]: -amount, [to]: amount });
    this.#moveCount += 1;
    this.#log.push(Object.freeze({ date, kind: 'money-moved', from, to, amount }));
    return { moved: true };
  }

  changeLog(): readonly ChangeLogEntry[] {
    return [...this.#log];
  }

  // ----- Bookkeeping -----

  // Runs a change made of several steps (a payday, a rule sorting what is
  // waiting) all or nothing: if any step is refused, the whole book goes
  // back exactly as it was (0.1). Each step can then assume the ones before
  // it stand, with no check of its own done in advance.
  #atomically<T>(change: () => T): T {
    const saved = {
      totals: { ...this.#totals },
      entries: [...this.#entries.values()].map((entry): Entry => ({ ...entry })),
      aliases: [...this.#aliases],
      pairs: [...this.#pairs],
      review: [...this.#review],
      paychecks: this.#paychecks.length,
      log: this.#log.length,
      notices: this.#notices.length,
      moveCount: this.#moveCount,
      lowAlerted: { ...this.#lowAlerted },
      emptyAlerted: { ...this.#emptyAlerted },
      periodStart: { ...this.#periodStart },
      periodSplit: this.#periodSplit,
      rules: this.#rules,
      lastPaycheckDate: this.#lastPaycheckDate,
      period: this.#period,
      periods: this.#periods.length,
      ledgerLast: this.#ledger[this.#ledger.length - 1]?.length ?? 0,
    };
    try {
      return change();
    } catch (error) {
      Object.assign(this.#totals, saved.totals);
      this.#entries.clear();
      for (const entry of saved.entries) this.#entries.set(entry.id, entry);
      this.#aliases.clear();
      for (const [k, v] of saved.aliases) this.#aliases.set(k, v);
      this.#pairs.clear();
      for (const [k, v] of saved.pairs) this.#pairs.set(k, v);
      this.#review.clear();
      for (const id of saved.review) this.#review.add(id);
      this.#paychecks.length = saved.paychecks;
      this.#log.length = saved.log;
      this.#notices.length = saved.notices;
      this.#moveCount = saved.moveCount;
      Object.assign(this.#lowAlerted, saved.lowAlerted);
      Object.assign(this.#emptyAlerted, saved.emptyAlerted);
      Object.assign(this.#periodStart, saved.periodStart);
      this.#periodSplit = saved.periodSplit;
      this.#rules = saved.rules;
      this.#lastPaycheckDate = saved.lastPaycheckDate;
      this.#period = saved.period;
      // The ledger only ever grows, so going back is cutting off what was added.
      this.#periods.length = saved.periods;
      this.#ledger.length = saved.periods;
      const last = this.#ledger[saved.periods - 1];
      if (last !== undefined) last.length = saved.ledgerLast;
      throw error;
    }
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (entry === undefined) throw new MoneyError('unknown-item', `no item ${id}`);
    return entry;
  }

  // Adds an entry and what it does. If its totals would be too large to
  // stay exact (0.1), the entry is not kept, so nothing changes and the same
  // transaction can be tried again.
  #add(entry: Entry, effect: Effect): void {
    this.#register(entry);
    try {
      this.#setEffect(entry, effect);
    } catch (error) {
      this.#forget(entry.id);
      throw error;
    }
  }

  // The same for spending, whose effect follows from how it is sorted.
  #addSpendingEntry(entry: SpendEntry): void {
    this.#register(entry);
    try {
      this.#refreshSpending(entry);
    } catch (error) {
      this.#forget(entry.id);
      throw error;
    }
  }

  // Takes back an entry whose effect is already undone (or never applied).
  #forget(id: string): void {
    this.#entries.delete(id);
    this.#review.delete(id);
  }

  // Undoes an entry completely. Its other half, if any, is on its way again.
  #remove(entry: Entry): void {
    this.#setEffect(entry, {});
    this.#unpairAll(entry.id);
    this.#forget(entry.id);
  }

  // Two entries can never share an id: the second would silently replace
  // the first and its money would vanish from the recount.
  #register(entry: Entry): void {
    if (this.#entries.has(entry.id)) throw new MoneyError('broken-book', `two entries would share the id ${entry.id}`);
    this.#entries.set(entry.id, entry);
  }

  // Replaces what an entry does to the buckets. Works out every new total
  // first, so a total too large to stay exact changes nothing.
  #setEffect(entry: Entry, next: Effect): void {
    const updated = { ...this.#totals };
    const lines: { pot: AnyPot; delta: Cents }[] = [];
    for (const name of TOTAL_NAMES) {
      const change = subtractCents(next[name] ?? 0, entry.effect[name] ?? 0);
      updated[name] = addCents(updated[name], change);
      if (change !== 0 && POT_NAMES_SET.has(name)) lines.push({ pot: name as AnyPot, delta: change });
    }
    const kind = ledgerKind(entry);
    if (lines.length > 0 && kind === null) throw new MoneyError('broken-book', `${entry.kind} ${entry.id} changed a bucket, but it should never`);
    Object.assign(this.#totals, updated);
    entry.effect = { ...next };
    const ledger = this.#ledger[this.#ledger.length - 1];
    if (kind !== null && ledger !== undefined) for (const line of lines) ledger.push({ entry: entry.id, pot: line.pot, delta: line.delta, kind });
  }

  // What every bucket holds right now, Wishlist only where the setup has it.
  #potTotals(): PotAmounts {
    const t = this.#totals;
    return { savings: t.savings, needs: t.needs, wants: t.wants, momReserve: t.momReserve, heldForOthers: t.heldForOthers, ...(this.#switches.wishlist === 'on' ? { wishlist: t.wishlist } : {}) };
  }

  #reviewDetail(entry: Entry): ReviewDetail {
    const item = this.#reviewView(entry);
    switch (entry.kind) {
      case 'money-in': {
        const txn = entry.txn;
        // 3.7, B54: a deposit older than the last paycheck cannot start a pay period.
        const older = txn.kind === 'deposit' && daysBetween(this.#lastPaycheckDate, txn.date) < 0;
        const likely = this.#likelyFor(txn);
        const facts: ReviewFacts = { type: 'money-in', reason: entry.reason, account: txn.account, olderThanLastPaycheck: older, likely: likely.map((p) => p.id), ...(txn.kind === 'deposit' && this.#olderWaitingFor(txn.date) ? { olderPaycheckWaiting: true } : {}), ...this.#wishlistFact() };
        return {
          item,
          account: txn.account,
          pending: false,
          options: reviewOptions(facts),
          likelyPurchases: likely,
          paycheckPreview: txn.kind === 'deposit' && !older ? this.#splitIfPaycheck(txn.amount) : null,
        };
      }
      case 'spend': {
        const txn = entry.txn;
        const account: AccountId = txn.kind === 'transfer' || txn.kind === 'transfer-sent' ? txn.from : txn.account;
        return { item, account, pending: entry.pending, options: reviewOptions(this.#spendFacts(entry)), likelyPurchases: [], paycheckPreview: null };
      }
      case 'old-card':
        return { item, account: 'old-card', pending: entry.pending, options: reviewOptions({ type: 'old-card-purchase' }), likelyPurchases: [], paycheckPreview: null };
      case 'leftover':
        return { item, account: null, pending: false, options: reviewOptions({ type: 'leftover' }), likelyPurchases: [], paycheckPreview: null };
      case 'paycheck':
      case 'refund':
      case 'mom':
      case 'move':
      case 'leg':
      case 'transfer':
        throw new MoneyError('broken-book', `${entry.kind} ${entry.id} should never be in review`);
    }
  }

  // What a deposit would get if you called it your paycheck, or null when
  // that cannot be worked out (a total too large to stay exact, 0.1).
  #splitIfPaycheck(amount: Cents): PaycheckSplit | null {
    try {
      return splitPaycheck(amount, this.#totals.momReserve, splitSettingsOf(this.#settings));
    } catch (error) {
      if (error instanceof MoneyError) return null;
      throw error;
    }
  }

  // Purchases a refund could belong to (20d): spending that is a purchase on
  // a card or the debit card. One the bank took back or dropped has nothing
  // left (4.10, A2), so it is never enough for a refund.
  #purchaseCandidates(): PurchaseCandidate[] {
    const candidates: PurchaseCandidate[] = [];
    for (const e of this.#entries.values()) {
      if (e.kind !== 'spend' || e.spendingKind !== 'purchase' || e.txn.kind !== 'purchase') continue;
      candidates.push({
        id: e.id,
        account: e.txn.account,
        date: e.txn.date,
        description: (e.postedTxn ?? e.txn).description,
        amount: e.amount,
        left: e.amount - e.refunded,
        sortedTo: e.sortedTo,
      });
    }
    return candidates;
  }

  #reviewView(entry: Entry): ReviewItem {
    switch (entry.kind) {
      case 'money-in': {
        const { id, date, amount, description } = entry.txn;
        return { type: 'money-in', id, date, amount, description, reason: entry.reason };
      }
      case 'spend': {
        const fromSavings = entry.txn.kind === 'savings-withdrawal';
        const reason = entry.countedAtSetup > 0 ? 'setup-difference' : entry.splitChanged ? 'split-changed' : fromSavings ? 'from-savings' : spendingReason(entry.spendingKind);
        const description = (entry.postedTxn ?? entry.txn).description;
        // Fees and interest suggest needs (4.8). A payment to the old card
        // waiting here came from savings, so it suggests savings (A4).
        const suggestion = entry.spendingKind === 'debt-payoff' ? 'savings' : ['purchase', 'person-payment', 'mom-difference'].includes(entry.spendingKind) ? null : 'needs';
        return { type: 'spending', id: entry.id, date: entry.txn.date, amount: netOf(entry), description, reason, suggestion };
      }
      case 'leftover':
        return { type: 'leftover', id: entry.id, date: entry.date, bucket: entry.bucket, amount: this.#asked(entry), atPayday: entry.amount, lessSincePayday: subtractCents(entry.amount, this.#asked(entry)) };
      case 'old-card':
        return { type: 'old-card-purchase', id: entry.id, date: entry.txn.date, amount: entry.amount, description: (entry.postedTxn ?? entry.txn).description };
      case 'paycheck':
      case 'refund':
      case 'mom':
      case 'move':
      case 'leg':
      case 'transfer':
        throw new MoneyError('broken-book', `${entry.kind} ${entry.id} should never be in review`);
    }
  }
}

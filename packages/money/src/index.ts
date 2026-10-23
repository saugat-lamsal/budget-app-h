// The money math: whole cents only, with no screens, network, database, or
// clock of its own. Callers pass in dates and settings.
export { MoneyError } from './errors.js';
export {
  addCents,
  assertCents,
  formatDollars,
  parseDollars,
  percentOf,
  subtractCents,
  type Cents,
} from './cents.js';
export { addDays, assertIsoDate, dayOfWeek, daysBetween, monthOf, type IsoDate } from './dates.js';
export {
  DEFAULT_SETTINGS,
  FROM_NEXT_PAYCHECK,
  PAY_SCHEDULES,
  changeSettings,
  matchesTextRule,
  validateSettings,
  type LeftoverChoice,
  type PaySchedule,
  type Settings,
  type TextRule,
} from './settings.js';
export { ACCOUNTS, type AccountId } from './accounts.js';
export { nextPayday, paydaysAfter, paydaysBefore, splitPaycheck, type PaycheckSplit, type PayScheduleSettings, type SplitSettings } from './payday.js';
export type {
  BankTransaction,
  CardCharge,
  Deposit,
  PendingChanged,
  PendingDropped,
  PersonPayment,
  Purchase,
  Refund,
  SavingsWithdrawal,
  TakenBack,
  Transfer,
  TransferArrived,
  TransferSent,
} from './transactions.js';
export { BUCKETS, SPENDING_BUCKETS, type Bucket, type SplitBucket } from './buckets.js';
export { RULE_CHOICES, checkRules, findRule, type DepositRuleChoice, type MoneyInChoice, type PersonPaymentChoice, type SortingRule } from './rules.js';
export { ACTIVITY_KINDS, type ActivityKind, type ActivityRow, type ActivityWhat, type BucketActivity, type PeriodSummary } from './activity.js';
export type { LeftoverReport, PaycheckReport, PaydayReport } from './payday-report.js';
export type { ResortDetail, SortedNow } from './resort.js';
export {
  Book,
  MOVABLE_POTS,
  openBook,
  type ChangeLogEntry,
  type LeftoverAnswer,
  type MomMonth,
  type MoneyMove,
  type MoveResult,
  type MoneyInReason,
  type OpenBookInput,
  type OthersMoney,
  type PaycheckRecord,
  type Pot,
  type Period,
  type Pots,
  type PurchaseView,
  type SpentItem,
  type Received,
  type ReceiveOutcome,
  type RecheckedItem,
  type SettingsPreview,
  type ReviewDetail,
  type ReviewItem,
  type CheckedSafeToSpend,
  type ConfirmReason,
  type InTransit,
  type InTransitItem,
  type SafeToSpend,
  type SavingsTransfer,
  type SelfCheck,
  type SortChoice,
  type SpendingKind,
  type SpendingSort,
  type SplitPart,
  type StartingPots,
} from './book.js';
export {
  cardDue,
  cardNotices,
  payoffCountdown,
  type CardDue,
  type CardNotice,
  type CardPayment,
  type CardStatement,
  type PayoffCountdown,
} from './reminders.js';
export { reviewOptions, type PickTo, type ReviewFacts, type ReviewOptions, type ReviewPick, type TransferOutcome, type Unavailable } from './review-options.js';
export { MOST_LIKELY_SHOWN, likelyPurchases, type LikelyPurchase, type PurchaseCandidate, type RefundToMatch } from './likely-purchases.js';
export { commonPlaceWords, placeName, type RuleOffer } from './rule-offers.js';
export { bucketLevel, type Alert, type AlertInput, type BucketLevel } from './alerts.js';
export { bankSide, withPendingCharges, type BankBalances, type PendingCharge } from './self-check.js';
export { checkAssignment, inTransitEffect, startTracking, startingDebt, startingMoney, type SetupInput, type SetupResult } from './setup.js';
export { UPSTREAM_SWITCHES, checkSwitches, rolesFor, settingsWhenOff, type Switch, type Switches } from './switches.js';
export { HER_SETTINGS, HER_SWITCHES } from './her-setup.js';
export { OLDER_PAYCHECK_FIRST, type WaitingPaycheck } from './paycheck-ask.js';

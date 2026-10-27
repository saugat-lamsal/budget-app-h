import type {
  AccountId,
  Cents,
  ConfirmReason,
  IsoDate,
  DepositRuleChoice,
  LeftoverAnswer,
  PersonPaymentChoice,
  PickTo,
  AnyPot,
  RecheckedItem,
  RuleOffer,
  Settings,
  SettingsPreview,
  SplitBucket,
  WishlistChange,
} from '@budget-app/money';
import type { BankRulePreview, BankRuleSpec } from './bank-rules.js';
import type { FoundGroup, FoundPreview } from './rule-finder.js';

// How a tap reaches the books. The screen sends the choice it was offered;
// the server hands it to the money math, which decides. Types only, so the
// phone can share them with the server.

// A part of a split (4.4, 7.6). 'rest' is whatever the other parts leave: the
// money math works it out, so the screen never subtracts.
export interface ChoicePart {
  readonly bucket: 'needs' | 'wants' | 'wishlist' | 'not-mine';
  readonly amount: Cents | 'rest';
}

export type ChoiceOf =
  // One tap: a bucket, other income, my paycheck, not mine, for mom.
  | { readonly to: PickTo }
  | { readonly split: readonly ChoicePart[] }
  // "Transfer between my accounts" (5.6), with that account.
  | { readonly transfer: AccountId }
  // The leftover question at payday (3.4).
  | { readonly leftover: LeftoverAnswer }
  // Seen the flag for a new purchase on the old card (5.4).
  | { readonly acknowledge: true }
  // "This refund is for this one" (4.5, QUESTIONS.md A18): one of the likely
  // purchases offered for a refund.
  | { readonly refundOf: string }
  // "It was not a payment to the old card" (QUESTIONS.md A21): for one marked
  // from savings, it becomes what the bank sent again.
  | { readonly unmark: true };

export interface ChoiceRequest {
  // Made once on the phone for this decision, and sent again, the same, on a
  // retry. The server answers a repeat with the first answer and changes
  // nothing.
  readonly id: string;
  // The item waiting in review, or, with resort, an item sorted already.
  readonly item: string;
  readonly choice: ChoiceOf;
  // "Always do this" (13.6): a rule that makes this the answer for anything
  // whose description contains this text.
  readonly always?: { readonly contains: string };
  // He said yes to "are you sure". Needed for anything final.
  readonly confirmed?: boolean;
  // Sorting something again from the list of what went in and out of a
  // bucket (4.7, QUESTIONS.md B100): the item may be one that is not waiting
  // in review. Without it, only an item waiting in review can be sorted.
  readonly resort?: true;
  // Step 3: the item's key as the screen showed it (its key in the screen's
  // numbers). If the item is not that any more (a sync brought something new
  // about it), the answer is refused with how it is now, and nothing changes.
  readonly seen?: string;
  // Her rulebook, 50.3: sorting a purchase to Wishlist, which thing on her
  // list it was (an item's id), or 'none'. Asked while the list has items.
  readonly wishlistItem?: string;
}

// ----- Her rulebook, 50.1 and 50.3: changes to her Wishlist list -----

// What the phone can send about the list. Marking an item bought comes with
// the sort in review instead (ChoiceRequest.wishlistItem), in the same answer.
export type WishlistEdit = Exclude<WishlistChange, { readonly bought: unknown }>;

export interface WishlistRequest {
  // As for a choice: made once on the phone, sent again, the same, on a retry.
  readonly id: string;
  readonly wishlist: WishlistEdit;
  // Removing an item asks first (anything final asks first).
  readonly confirmed?: boolean;
}

export type WishlistResponse = { readonly ok: true; readonly replayed: boolean } | { readonly ok: false; readonly code: RefusalCode; readonly why: string };

// What was done.
export interface Done {
  readonly item: string;
  // The choice, with a split's "rest" filled in.
  readonly choice: ChoiceOf;
  // With "always do this": other waiting items the new rule sorted too (13.2).
  readonly alsoSorted: number;
  // With "always do this": waiting items the rule matched but could not sort,
  // left exactly as they were (13.2, QUESTIONS.md A19). Empty otherwise.
  readonly stillWaiting: readonly { readonly item: string; readonly name: string }[];
  // With "always do this": whether the next one arriving the same way will go
  // here by itself (13.6, B49). Null without "always do this".
  readonly sticks: boolean | null;
  // 13.8: sorted by hand the same way as an earlier one from the same place:
  // the rule the screen offers to make ("always do this"), with the place's
  // name as its text. Left out when there is none (and in answers kept
  // before 13.8).
  readonly offer?: RuleOffer;
}

export type RefusalCode =
  // Final choices need his OK first.
  | 'needs-confirmation'
  // The item is not waiting any more: it was dealt with already.
  | 'not-waiting'
  // The decision number was used for a different choice.
  | 'id-reused'
  // The money math refused it.
  | 'refused'
  // Step 3: the item changed since the screen showed it (seen).
  | 'changed';

export type ChoiceResponse =
  | { readonly ok: true; readonly replayed: boolean; readonly done: Done }
  // Nothing was changed. why is for him to read.
  | { readonly ok: false; readonly code: RefusalCode; readonly why: string };

// ----- Moving money between buckets by hand (13.3, 13.4; B103) -----

export interface Moved {
  readonly from: AnyPot;
  readonly to: AnyPot;
  readonly amount: Cents;
}

export interface MoveRequest {
  // As for a choice: made once, sent again, the same, on a retry.
  readonly id: string;
  readonly move: Moved;
  // He said yes to "are you sure" (13.4): money out of savings or the mom
  // reserve, or a move that would leave a bucket below zero.
  readonly confirmed?: boolean;
}

export type MoveResponse =
  | { readonly ok: true; readonly replayed: boolean; readonly moved: Moved }
  // Nothing was changed. With needs-confirmation, reasons says why it asks
  // (the money math's, 13.4).
  | { readonly ok: false; readonly code: RefusalCode; readonly why: string; readonly reasons?: readonly ConfirmReason[] };

// ----- Settings and sorting rules (section 2; 13.1, 13.2, 13.5) -----

// A sorting rule as the phone sends it and sees it: what kind of item it is
// for, the text the bank's description contains, and what it does (one of
// RULE_CHOICES for that kind, from the money math).
export type RuleSpec =
  | { readonly for: 'purchase'; readonly contains: string; readonly to: SplitBucket }
  | { readonly for: 'deposit'; readonly contains: string; readonly to: DepositRuleChoice['to'] }
  | { readonly for: 'person'; readonly contains: string; readonly to: PersonPaymentChoice['to'] };

export type RuleView = RuleSpec & { readonly id: string };

export interface SettingsRequest {
  // As for a choice: made once, sent again, the same, on a retry.
  readonly id: string;
  // The settings to change and their new values, as the money math has them:
  // amounts in whole cents, percentages and days in whole numbers.
  readonly settings: Partial<Settings>;
  // His yes, for a change that asks first: the paycheck rule or the mom rule,
  // which sort what is waiting for good (QUESTIONS.md A9).
  readonly confirmed?: boolean;
  // With his yes: the key of the preview he was shown. If what the change
  // would do is not that any more, it asks again with what it would do now.
  readonly seen?: string;
}

export interface RuleRequest {
  readonly id: string;
  readonly rule:
    | { readonly add: RuleSpec }
    | { readonly change: RuleView }
    | { readonly remove: string }
    // A22: one place up or down among the rules of its kind.
    | { readonly move: { readonly id: string; readonly direction: 'up' | 'down' } };
  // His yes, for removing a rule.
  readonly confirmed?: boolean;
}

// What a change to the paycheck rule or the mom rule would do (A9), from the
// money math, and a key that names exactly this preview.
export type SettingsPreviewView = SettingsPreview & { readonly key: string };

export interface SettingsDone {
  // The settings that changed (the ones sent that were already so are left alone).
  readonly changed: readonly (keyof Settings)[];
  // 13.1: some of them wait for the next paycheck.
  readonly fromNextPaycheck: boolean;
  // A9: what a new paycheck rule or mom rule did to what was waiting.
  readonly rechecked: readonly RecheckedItem[];
}

export type SettingsResponse =
  | { readonly ok: true; readonly replayed: boolean; readonly done: SettingsDone }
  // Nothing was changed. With needs-confirmation for the paycheck rule or the
  // mom rule, preview says what it would do.
  | { readonly ok: false; readonly code: RefusalCode; readonly why: string; readonly preview?: SettingsPreviewView };

export interface RuleDone {
  readonly action: 'added' | 'changed' | 'removed' | 'moved-up' | 'moved-down';
  // The rule as it is now; for a removal, as it was.
  readonly rule: RuleView;
  // 13.2: the waiting items the rule sorted.
  readonly alsoSorted: number;
  // A19: waiting items it matched but could not sort, left exactly as they were.
  readonly stillWaiting: readonly { readonly item: string; readonly name: string }[];
}

export type RuleResponse =
  | { readonly ok: true; readonly replayed: boolean; readonly done: RuleDone }
  | { readonly ok: false; readonly code: RefusalCode; readonly why: string };

// ----- Setup day (rulebook section 14; QUESTIONS.md B42, B43, B48) -----

// One answer on the Setup day screens. Each is kept by the server until
// tracking starts; the screen works nothing out.
export type SetupStep =
  // B48: whether a transfer with only one half showing is still on its way.
  | { readonly onItsWay: { readonly half: string; readonly answer: boolean } }
  // B42: the day of his last paycheck, which the pay schedule counts from.
  | { readonly lastPaycheck: IsoDate }
  // 14.2: how much of the starting money goes in one bucket. Any whole number
  // of cents: zero, or below zero when the card owes more than he has (B43).
  | { readonly assign: { readonly pot: AnyPot; readonly amount: Cents } }
  // 14.2: whatever is left to assign goes in this bucket, worked out by the
  // money math, not the screen.
  | { readonly assign: { readonly pot: AnyPot; readonly rest: true } }
  // 20a: his answer to a bank rule suggested from the bank's labels: add it
  // as it is, or skip it; or add it as he changed it, which asks first, with
  // what it would match.
  | { readonly suggestion: { readonly id: string; readonly answer: 'add' | 'skip' } }
  | { readonly suggestion: { readonly id: string; readonly answer: 'change'; readonly rule: BankRuleSpec } }
  // A25: how many days back setup day asks about transfers with only one
  // side showing. A setting (0.2): any whole number of days from zero up.
  | { readonly lookBack: number }
  // Her rulebook, 53.1: her answer to a suggestion of the rule finder: keep it
  // as it is (a place with the bucket she picks, 53.7), skip it, or keep it
  // with her own words, which asks first (53.8, 53.9); or skip a whole group.
  | { readonly found: { readonly id: string; readonly answer: 'add'; readonly bucket?: 'needs' | 'wants' } }
  | { readonly found: { readonly id: string; readonly answer: 'skip' } }
  | { readonly found: { readonly id: string; readonly answer: 'change'; readonly contains: string; readonly bucket?: 'needs' | 'wants' } }
  | { readonly foundGroup: { readonly group: FoundGroup; readonly answer: 'skip' } }
  // 14.3: start tracking. Final, so it needs his yes.
  | { readonly start: true };

export interface SetupRequest {
  // As for a choice: made once, sent again, the same, on a retry.
  readonly id: string;
  readonly setup: SetupStep;
  // His yes, for starting.
  readonly confirmed?: boolean;
  // With his yes: the key of the last look he saw. If what tracking would
  // start with is not that any more, it asks again.
  readonly seen?: string;
}

// What the setup step did.
export type SetupDone =
  | { readonly step: 'on-its-way'; readonly half: string; readonly answer: boolean; readonly startingMoney: Cents }
  | { readonly step: 'last-paycheck'; readonly date: IsoDate; readonly nextPayday: IsoDate }
  | { readonly step: 'assign'; readonly pot: AnyPot; readonly amount: Cents; readonly leftToAssign: Cents }
  // 20a: ruleId names the bank rule it added; null when skipped.
  | { readonly step: 'suggestion'; readonly id: string; readonly answer: 'added' | 'changed' | 'skipped'; readonly ruleId: string | null }
  // A25: asked is how many transfers setup day asks about now.
  | { readonly step: 'look-back'; readonly days: number; readonly asked: number }
  // Her rulebook, 53.1: ruleId names the bank rule or sorting rule it made; null when skipped.
  | { readonly step: 'found'; readonly id: string; readonly answer: 'added' | 'changed' | 'skipped'; readonly ruleId: string | null }
  | { readonly step: 'found-group'; readonly group: FoundGroup; readonly skipped: number }
  // Tracking has started. stillToSet: the rules he has not set yet, for Settings.
  | { readonly step: 'started'; readonly startingMoney: Cents; readonly stillToSet: readonly ('paycheckRule' | 'momRule')[] };

export type SetupResponse =
  | { readonly ok: true; readonly replayed: boolean; readonly done: SetupDone }
  // Nothing was changed. why is for him to read. With needs-confirmation for
  // a suggestion he changed, preview says what the rule would match.
  // Her rulebook, 53.8: with needs-confirmation for a finder suggestion she
  // changed, foundPreview says what it would match and overlap.
  | { readonly ok: false; readonly code: RefusalCode; readonly why: string; readonly preview?: BankRulePreview; readonly foundPreview?: FoundPreview };

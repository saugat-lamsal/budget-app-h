import type { AccountId, Cents, IsoDate } from '@budget-app/money';
import type { BankRule } from '../bank/reading.js';

// Her rulebook, section 53: the rule finder on setup day, as the Setup day
// screen shows it. Worked out on the server (rule-finder.ts) from both
// banks' whole history and her answers; the screen only shows it.

// The groups, in the order the finder offers them (53.1).
export type FoundGroup = 'card-payments' | 'transfers' | 'people-fees' | 'paycheck' | 'places';

export type FoundRule =
  // A bank rule on one account (section 2): a card payment's side or a
  // transfer's (other: the account at the other end), a payment to a person,
  // or a fee or interest on a card (other: null).
  | { readonly kind: 'bank-rule'; readonly account: AccountId; readonly contains: string; readonly means: BankRule['means']; readonly other: AccountId | null }
  // 53.6: the paycheck rule (section 2).
  | { readonly kind: 'paycheck'; readonly contains: string }
  // 53.7: a sorting rule for purchases at a place, with the bucket the bank's
  // category suggests (null with no category).
  | { readonly kind: 'place'; readonly contains: string; readonly bucket: 'needs' | 'wants' | null };

// One bank item in the history.
export interface FoundItem {
  readonly id: string;
  readonly date: IsoDate;
  readonly account: AccountId;
  readonly description: string;
  readonly amount: Cents;
  readonly direction: 'in' | 'out';
  readonly pending: boolean;
}

// 53.8: what a rule would have matched in the whole history. items are those
// it was found from and also the rest, each newest first, at most SHOWN of
// each; the counts are all of them.
export interface FoundMatches {
  readonly count: number;
  readonly accounts: readonly AccountId[];
  readonly from: IsoDate | null;
  readonly to: IsoDate | null;
  readonly items: readonly FoundItem[];
  readonly foundCount: number;
  readonly also: readonly FoundItem[];
  readonly alsoCount: number;
}

// 53.9: another rule that reads some of the same items: one of the finder's
// suggestions (still open) or a rule she has.
export interface FoundOverlap {
  readonly with: { readonly suggestion: string } | { readonly rule: FoundRule; readonly ruleId: string | null };
  readonly count: number;
  readonly items: readonly FoundItem[];
}

// One suggestion on setup day, with her answer.
export interface FoundLine {
  readonly id: string;
  readonly group: FoundGroup;
  readonly rule: FoundRule;
  readonly pending: boolean;
  readonly matches: FoundMatches;
  readonly run: readonly { readonly date: IsoDate; readonly amount: Cents }[] | null;
  // open: not answered. added: kept as suggested; changed: kept as she changed
  // it (rule is then what she kept). skipped. covered: she has this rule already.
  readonly status: 'open' | 'added' | 'changed' | 'skipped' | 'covered';
  // For a bank rule kept, its id among her bank rules.
  readonly ruleId: string | null;
  // 53.9, for an open one: the others that read some of the same items. With
  // a rule she has, it can only be changed or skipped.
  readonly overlaps: readonly FoundOverlap[];
}

// A changed suggestion before it is kept: what its new words would have matched and what they overlap.
export interface FoundPreview {
  readonly id: string;
  readonly rule: FoundRule;
  readonly matches: FoundMatches;
  readonly overlaps: readonly FoundOverlap[];
  // Names exactly this look; her yes carries it.
  readonly key: string;
}

// Her answer to one suggestion, as setup day keeps it. rule: what she kept
// (with the bucket she picked for a place); ruleId: the bank rule or sorting
// rule it made.
export interface FoundAnswer {
  readonly answer: 'added' | 'changed' | 'skipped';
  readonly ruleId: string | null;
  readonly rule: FoundRule | null;
}

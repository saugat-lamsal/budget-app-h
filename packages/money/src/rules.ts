import { isBucket, isSpendingBucket, type Bucket, type SplitBucket } from './buckets.js';
import { MoneyError } from './errors.js';
import { matchesTextRule } from './settings.js';

// The choices for money coming in (6.1): this is my paycheck (a new pay
// period: the mom reserve first, then the split), other income (split by
// the percentages only), payback into a bucket you pick, or not mine (held
// for others). Her rulebook, 6.1: payback can go into Wishlist too, where
// the setup has it; a deposit rule still cannot pick it (6.2).
export type MoneyInChoice = { readonly to: 'paycheck' | 'wishlist' | DepositRuleChoice['to'] };

// What a deposit rule can pick (6.2): anything but "this is my paycheck".
// Paychecks are found by the paycheck rule in settings (section 2), which
// keeps the 10-day check (3.7).
export type DepositRuleChoice = { readonly to: 'other-income' | 'not-mine' | Bucket };

export function isMoneyInChoice(choice: unknown): choice is MoneyInChoice {
  return isDepositRuleChoice(choice) || (typeof choice === 'object' && choice !== null && 'to' in choice && (choice.to === 'paycheck' || choice.to === 'wishlist'));
}

export function isDepositRuleChoice(choice: unknown): choice is DepositRuleChoice {
  if (typeof choice !== 'object' || choice === null || !('to' in choice)) return false;
  return choice.to === 'other-income' || choice.to === 'not-mine' || isBucket(choice.to);
}

// What a payment to a person can be (7.2, 7.4, 7.6): spending from needs or
// wants, not mine (lowers held for others), or for mom (out of the mom
// reserve, like a payment the mom rule matches, 8.1).
export type PersonPaymentChoice = { readonly to: SplitBucket | 'not-mine' | 'mom' };

export function isPersonPaymentChoice(choice: unknown): choice is PersonPaymentChoice {
  if (typeof choice !== 'object' || choice === null || !('to' in choice)) return false;
  return choice.to === 'not-mine' || choice.to === 'mom' || isSpendingBucket(choice.to);
}

// What each kind of sorting rule can pick, in the order to offer them: a
// purchase needs or wants (4.2), money in anything but "this is my paycheck"
// (6.2, B55), a payment to a person needs, wants, not mine, or for mom (7.6).
export const RULE_CHOICES: {
  readonly purchase: readonly SplitBucket[];
  readonly deposit: readonly DepositRuleChoice['to'][];
  readonly person: readonly PersonPaymentChoice['to'][];
} = Object.freeze({
  purchase: Object.freeze(['needs', 'wants'] as const),
  deposit: Object.freeze(['other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine'] as const),
  person: Object.freeze(['needs', 'wants', 'not-mine', 'mom'] as const),
});

// Your sorting rules (4.2, 6.2, 7.4). A rule matches a bank description that
// contains its text, ignoring case. When several rules match, the first one
// in the list wins.
export type SortingRule =
  | {
      readonly id: string;
      readonly for: 'purchase';
      readonly contains: string;
      readonly bucket: SplitBucket;
    }
  | {
      readonly id: string;
      readonly for: 'deposit';
      readonly contains: string;
      readonly choice: DepositRuleChoice;
    }
  | {
      readonly id: string;
      readonly for: 'person';
      readonly contains: string;
      readonly choice: PersonPaymentChoice;
    };

export function checkRules(rules: readonly SortingRule[]): readonly SortingRule[] {
  const ids = new Set<string>();
  const checked = rules.map((rule) => {
    const bad = (why: string): never => {
      throw new MoneyError('bad-rule', `${why}: ${JSON.stringify(rule)}`);
    };
    if (typeof rule.id !== 'string' || rule.id === '') bad('a rule needs an id');
    if (ids.has(rule.id)) bad('two rules have the same id');
    ids.add(rule.id);
    if (typeof rule.contains !== 'string' || rule.contains.trim() === '') bad('a rule needs some text to match');
    switch (rule.for) {
      case 'purchase':
        if (!isSpendingBucket(rule.bucket)) bad('a purchase rule must pick needs or wants');
        return Object.freeze({ ...rule });
      case 'deposit':
        if (!isDepositRuleChoice(rule.choice)) bad('a deposit rule must pick other income, a bucket, or not mine');
        return Object.freeze({ ...rule, choice: Object.freeze({ to: rule.choice.to }) });
      case 'person':
        if (!isPersonPaymentChoice(rule.choice)) bad('a person rule must pick needs, wants, not mine, or mom');
        return Object.freeze({ ...rule, choice: Object.freeze({ to: rule.choice.to }) });
      default:
        return bad('unknown kind of rule');
    }
  });
  return Object.freeze(checked);
}

export function findRule<K extends SortingRule['for']>(
  rules: readonly SortingRule[],
  kind: K,
  description: string,
): Extract<SortingRule, { for: K }> | undefined {
  return rules.find((rule): rule is Extract<SortingRule, { for: K }> => rule.for === kind && matchesTextRule(rule, description));
}

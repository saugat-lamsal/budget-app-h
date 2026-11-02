import { describe, expect, it } from 'vitest';
import { RULE_WHAT, doneText, labeledText, nowWords, offerText, pickLabel, ruleSentenceText, sortedWords } from '../src/screens/review-text.js';

// B226: what Review says about a pending item the bank labels as a transfer
// or a payment to a person, which no bank rule reads as one. Made-up words.

describe('B226 the bank rule for a pending item read as a purchase, in words', () => {
  it('B226 a transfer (a card payment is one): the rule for its wording, and how to fix this one once it posts', () => {
    expect(labeledText({ account: 'checking', contains: 'PAYMENT TO ACCT', means: 'transfer', other: 'everyday-card' })).toBe(
      'Your bank labels this a transfer between your accounts (a card payment is one), but no bank rule reads it as one, so it counts as spending while it is pending. A bank rule for “PAYMENT TO ACCT” on checking reads the next ones right: add it on Settings, Bank rules. This one you can mark “Transfer between my accounts” once it posts.',
    );
  });

  it('B226 a payment to a person, from savings', () => {
    expect(labeledText({ account: 'savings', contains: 'Zelle payment to MADE UP FRIEND', means: 'payment-to-person', other: null })).toBe(
      'Your bank labels this a payment to a person, but no bank rule reads it as one, so it counts as a purchase. A bank rule for “Zelle payment to MADE UP FRIEND” on savings reads the next ones right: add it on Settings, Bank rules.',
    );
  });
});

// Rule 13.8 (QUESTIONS.md A55): the rule offered the second time a place is
// sorted the same way by hand, and what any rule made from an item would do.
describe('13.8 the rule offered, in words', () => {
  it('13.8 the notice says it was sorted the same way before, by the place\'s name', () => {
    expect(offerText({ for: 'purchase', contains: 'SUNRISE BAKERY', to: 'wants' })).toBe('You sorted “SUNRISE BAKERY” the same way before. Make it a rule so the next one sorts itself?');
  });

  it('13.6 13.8 what the rule would do: purchases, payments to people, or deposits, whose description contains the text, sorted as the pick', () => {
    expect(ruleSentenceText('purchases', 'SUNRISE BAKERY', 'Wants')).toBe('From now on, purchases whose description contains “SUNRISE BAKERY” are sorted as: Wants. Anything waiting that matches is sorted now too, if it can be.');
    expect(RULE_WHAT).toEqual({ purchase: 'purchases', person: 'payments to people', deposit: 'deposits' });
  });
});

describe('7.1 7.2 the screens say Other (A62)', () => {
  it('7.7 on a sheet it says what it is, so it is not taken for Other income; on a button it is short', () => {
    expect(pickLabel('spending', 'not-mine')).toBe('Other (not Needs or Wants)');
    expect(pickLabel('money-in', 'not-mine')).toBe('Other (not Needs or Wants)');
    expect(pickLabel('money-in', 'not-mine', true)).toBe('Other');
    expect(pickLabel('money-in', 'other-income')).toBe('Other income');
  });

  it('7.8 a part of a split, and where it is now, say Other', () => {
    expect(nowWords({ to: 'not-mine' })).toBe('marked Other');
    expect(nowWords({ split: [{ bucket: 'not-mine', amount: 1_250 }, { bucket: 'wants', amount: 150 }] })).toBe('split: Other $12.50, Wants $1.50');
    expect(sortedWords({ split: [{ bucket: 'not-mine', amount: 100 }, { bucket: 'savings', amount: 200 }] })).toBe('Split: Other $1.00, Savings $2.00');
  });

  it('7.1 7.2 the notice is the same for money in and money out', () => {
    const done = { choice: { to: 'not-mine' }, alsoSorted: 0, stillWaiting: [] } as never;
    expect(doneText('MADE UP', 'money-in', done)).toBe('MADE UP marked Other.');
    expect(doneText('MADE UP', 'spending', done)).toBe('MADE UP marked Other.');
  });
});

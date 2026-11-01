import type { CardStanding } from '@budget-app/money';
import type { CardNames } from '@budget-app/server/views';
import { afterEach, describe, expect, it } from 'vitest';
import { cardStatementDetail, cardStatementTitle } from '../src/screens/buckets-text.js';
import { bucketTitle } from '../src/screens/cards-text.js';
import { BUCKET_NAMES, pickLabel } from '../src/screens/review-text.js';
import { POT_NAMES } from '../src/ui/names.js';
import { rememberCardNames } from '../src/ui/card-names.js';

// Her rulebook, 7.1, 7.3, 9.9 and 52.4 (60j): the words for Other and for each
// of her cards' statements. Every name and number is made up.

const NAMES: CardNames = { 'everyday-card': 'Made-up Rewards Card', 'second-card': 'Made-up Blue Card' };
const SECOND: CardStanding = { card: 'second-card', closingDate: '2026-10-05', dueDate: '2026-11-01', daysLeft: 22, statementBalance: 25_000, minimumPayment: 2_500, paid: 0, standing: 'to-pay' };

afterEach(() => rememberCardNames(null));

describe('9.9 her cards on Buckets', () => {
  it('9.9 each row names the card as its bank names it, and says statement', () => {
    rememberCardNames(NAMES);
    expect(cardStatementTitle({ card: 'everyday-card' })).toBe('Made-up Rewards Card statement');
    expect(cardStatementTitle({ card: 'second-card' })).toBe('Made-up Blue Card statement');
  });

  it('9.9 before the names are known, it says which card in the app\'s own words', () => {
    expect(cardStatementTitle({ card: 'second-card' })).toBe('Second card statement');
  });

  it('9.9 9.1 the Amex card reads as the everyday card does: the minimum while it is to pay, and Paid when it is paid', () => {
    expect(cardStatementDetail(SECOND)).toBe('Due in 22 days, Sun, Nov 1. Minimum $25.00. Statement closed Mon, Oct 5.');
    expect(cardStatementDetail({ ...SECOND, standing: 'paid', paid: 25_000 })).toBe('Paid. Due Sun, Nov 1. Statement closed Mon, Oct 5.');
  });

  it('9.9 9.4 overdue, and past the due date with the minimum met, say so in words', () => {
    expect(cardStatementDetail({ ...SECOND, daysLeft: -1, standing: 'overdue' })).toBe('Overdue: it was due Sun, Nov 1. Minimum $25.00. Statement closed Mon, Oct 5.');
    expect(cardStatementDetail({ ...SECOND, daysLeft: -1, paid: 2_500, standing: 'minimum-paid' })).toBe('The due date passed, Sun, Nov 1, with $25.00 paid. The minimum was met; interest may apply to the rest. Statement closed Mon, Oct 5.');
  });
});

describe('7.1 7.3 the word is Other', () => {
  it('7.1 every name for it says Other; on the sheet, what it is, so it is not taken for Other income', () => {
    expect(POT_NAMES.heldForOthers).toBe('Other');
    expect(BUCKET_NAMES['not-mine']).toBe('Other');
    expect(pickLabel('money-in', 'not-mine')).toBe('Other (not Needs or Wants)');
    expect(pickLabel('spending', 'not-mine')).toBe('Other (not Needs or Wants)');
    expect(pickLabel('money-in', 'not-mine', true)).toBe('Other');
  });

  it('7.8 Wishlist and savings have their own names as parts of a split', () => {
    expect(BUCKET_NAMES['wishlist']).toBe('Wishlist');
    expect(BUCKET_NAMES['savings']).toBe('Savings');
  });

  it('52.4 7.7 the statement\'s group is called Other', () => {
    expect(bucketTitle('other')).toBe('Other');
  });
});

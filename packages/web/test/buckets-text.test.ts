import { describe, expect, it } from 'vitest';
import type { CardStanding } from '@budget-app/money';
import { cardStatementDetail, cardStatementTitle, onItsWayDetail, onItsWayTitle } from '../src/screens/buckets-text.js';

// The words for money on its way between his accounts, on Buckets (12.5, B44).

describe('12.5 the words for money on its way', () => {
  it('12.5 each says where it is going', () => {
    expect(['savings', 'checking', 'everyday-card', 'old-card'].map((to) => onItsWayTitle({ to: to as 'savings' }))).toEqual(['To savings', 'To checking', 'Payment to the everyday card', 'Payment to the old card']);
  });

  it('12.5 what left and has not landed, and what landed before it showed leaving', () => {
    expect(onItsWayDetail({ from: 'checking', to: 'savings', date: '2026-10-02', seen: 'left', counted: true })).toBe('Left Checking Fri, Oct 2. Not in Savings yet.');
    expect(onItsWayDetail({ from: 'checking', to: 'everyday-card', date: '2026-09-30', seen: 'arrived', counted: true })).toBe('Reached the everyday card Wed, Sep 30. Not shown leaving Checking yet.');
  });

  it('12.4 B44 one to the old card says it is not part of the check', () => {
    expect(onItsWayDetail({ from: 'checking', to: 'old-card', date: '2026-10-09', seen: 'left', counted: false })).toBe('Left Checking Fri, Oct 9. Not on the old card yet. Not part of the check with your bank: the old card is kept apart.');
  });
});

describe('9.9 the words for a card statement', () => {
  const EVERYDAY: CardStanding = { card: 'everyday-card', closingDate: '2026-10-05', dueDate: '2026-11-01', daysLeft: 22, statementBalance: 25_000, minimumPayment: 2_500, paid: 0, standing: 'to-pay' };
  const OLD: CardStanding = { ...EVERYDAY, card: 'old-card', statementBalance: null };

  it('9.9 9.1 9.2 the row names what the amount beside it is', () => {
    expect(cardStatementTitle(EVERYDAY)).toBe('Everyday card statement');
    expect(cardStatementTitle(OLD)).toBe('Old card minimum');
  });

  it('9.9 still to pay: when it is due, and the minimum on the everyday card', () => {
    expect(cardStatementDetail(EVERYDAY)).toBe('Due in 22 days, Sun, Nov 1. Minimum $25.00. Statement closed Mon, Oct 5.');
    expect(cardStatementDetail(OLD)).toBe('Due in 22 days, Sun, Nov 1. Statement closed Mon, Oct 5.');
    expect(cardStatementDetail({ ...EVERYDAY, daysLeft: 1 })).toContain('Due in 1 day, Sun, Nov 1.');
    expect(cardStatementDetail({ ...EVERYDAY, daysLeft: 0 })).toContain('Due today, Sun, Nov 1.');
  });

  it('9.9 what was paid so far is said, by the cent', () => {
    expect(cardStatementDetail({ ...EVERYDAY, paid: 1 })).toBe('Due in 22 days, Sun, Nov 1. Minimum $25.00. $0.01 paid so far. Statement closed Mon, Oct 5.');
  });

  it('9.9 9.3 paid is in words, the whole balance on the everyday card and the minimum on the old card', () => {
    expect(cardStatementDetail({ ...EVERYDAY, paid: 25_000, standing: 'paid' })).toBe('Paid. Due Sun, Nov 1. Statement closed Mon, Oct 5.');
    expect(cardStatementDetail({ ...OLD, paid: 2_500, standing: 'paid' })).toBe('Minimum paid. Due Sun, Nov 1. Statement closed Mon, Oct 5.');
  });

  it('9.4 overdue, and the minimum paid with the rest not, are in words', () => {
    expect(cardStatementDetail({ ...OLD, daysLeft: -1, standing: 'overdue' })).toBe('Overdue: it was due Sun, Nov 1. Minimum $25.00. Statement closed Mon, Oct 5.');
    expect(cardStatementDetail({ ...EVERYDAY, daysLeft: -1, paid: 10_000, standing: 'minimum-paid' })).toBe('The due date passed, Sun, Nov 1, with $100.00 paid. The minimum was met; interest may apply to the rest. Statement closed Mon, Oct 5.');
  });
});

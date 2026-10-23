import type { TrendsPeriodShown } from '@budget-app/server/views';
import { describe, expect, it } from 'vitest';
import { othersOf } from '../src/screens/bank-rules-text.js';
import { BANK_WORDS, ROLE_ORDER, counted } from '../src/screens/bank-text.js';
import { bankAccountsText } from '../src/screens/settings-text.js';
import { barWords, usualLines } from '../src/screens/trends-text.js';

// Her rulebook, "Off in this setup": the words on her screens, with no old
// card among her accounts. Upstream's words are as they were (their own tests
// say so). Every name and number is made up.

const HER_ACCOUNTS = ['checking', 'savings', 'everyday-card'] as const;
const OFF_WORDS = /\bmom\b|old.?card|reserve|promo|payoff|\bdebt/i;

describe('Off in this setup: her words', () => {
  it('Off in this setup: a bank rule on her accounts is with one of her other accounts, never the old card', () => {
    expect(othersOf('checking', HER_ACCOUNTS)).toEqual(['savings', 'everyday-card']);
    expect(othersOf('savings', HER_ACCOUNTS)).toEqual(['checking', 'everyday-card']);
    expect(othersOf('everyday-card', HER_ACCOUNTS)).toEqual(['checking', 'savings']);
    // Upstream's four, as they were.
    expect(othersOf('checking')).toEqual(['savings', 'everyday-card', 'old-card']);
  });

  it('Off in this setup: picking her accounts counts three, and upstream still counts four', () => {
    for (const text of [BANK_WORDS.pickDetail, BANK_WORDS.missing, BANK_WORDS.keepTitle]) {
      const hers = counted(text, HER_ACCOUNTS);
      expect(hers).not.toContain('four');
      expect(hers).toContain('three');
      expect(counted(text, ROLE_ORDER)).toBe(text);
    }
    expect(counted(BANK_WORDS.pickDetail, HER_ACCOUNTS)).toBe('Pick each of your three accounts once. Nothing is read from the bank until all three are picked. Once tracking starts, this cannot change.');
  });

  it('Off in this setup: the change log names her three accounts, and no old card', () => {
    const text = bankAccountsText({ checking: 'Made Up Checking ••1111', savings: 'Made Up Savings ••2222', 'everyday-card': 'Made Up Card ••3333' });
    expect(text).toBe('Checking: Made Up Checking ••1111; savings: Made Up Savings ••2222; everyday card: Made Up Card ••3333');
    expect(text).not.toMatch(OFF_WORDS);
    expect(bankAccountsText({ checking: 'A', savings: 'B', 'everyday-card': 'C', 'old-card': 'D' })).toBe('Checking: A; savings: B; everyday card: C; old card: D');
  });

  it('Off in this setup: 40.2 40.4 a bar of her pay period says only the parts it has', () => {
    const period: TrendsPeriodShown = {
      startDate: '2026-09-25',
      lastDay: '2026-10-08',
      current: false,
      cutOff: false,
      full: true,
      beforeSetup: 'none',
      spent: { needs: 7_850, wants: 3_300, unsorted: 2_500 },
      total: 13_650,
      items: [],
    };
    expect(barWords(period)).toBe('Sep 25 – Oct 8. Spent $136.50: needs $78.50, wants $33.00, unsorted $25.00.');
  });

  it('Off in this setup: 40.8 her usual says nothing is left out', () => {
    const lines = usualLines({ state: 'known', periods: 5, byToday: 3_000, whole: 6_000 }, 12, false);
    expect(lines).toEqual(['Usual by day 12: $30.00', 'A whole pay period usually: $60.00', 'The middle one of your last 5 full pay periods.']);
    for (const line of lines) expect(line).not.toMatch(OFF_WORDS);
  });
});

import { describe, expect, it } from 'vitest';
import { barWords, partName, wishlistOverTimeWords } from '../src/screens/trends-text.js';

// Her rulebook, PR 10+11: Trends' Wishlist parts in words (40.2, 40.4, 40.5):
// what a bar's color shows is also said, and Wishlist over time is said beside
// savings. Every number is made up.

const period = { startDate: '2026-10-01', lastDay: '2026-10-08', current: true, cutOff: false, full: false, beforeSetup: 'none', total: 18_250, items: [] } as const;

describe('40.2 40.4 Wishlist is its own part of each bar, in words', () => {
  it('40.4 the part is named Wishlist', () => {
    expect(partName('wishlist')).toBe('Wishlist');
  });

  it('40.4 a bar says its Wishlist part with the others, and no old card part in her setup', () => {
    expect(barWords({ ...period, spent: { needs: 10_250, wants: 1_000, unsorted: 1_000, wishlist: 6_000 } })).toBe('Oct 1 – Oct 8, so far. Spent $182.50: needs $102.50, wants $10.00, unsorted $10.00, wishlist $60.00.');
  });
});

describe('40.5 Wishlist over time, beside savings', () => {
  it('40.5 what Wishlist held when tracking started and now, in words; nothing in a setup without it', () => {
    expect(wishlistOverTimeWords({ wishlist: 20_000 }, { wishlist: 54_000 })).toBe('; Wishlist from $200.00 to $540.00');
    expect(wishlistOverTimeWords({}, {})).toBe('');
  });
});

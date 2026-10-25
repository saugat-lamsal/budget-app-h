import { describe, expect, it } from 'vitest';
import { boughtText, itemProgressText, logLineText, moreText, priceOf, putsInWishlist } from '../src/screens/wishlist-items-text.js';

// Her rulebook, PR 10+11: the Wishlist list's words on the phone (50.1 to
// 50.3). How far along each item is, in words and amount, never only a bar;
// "Ready" in words; what was bought; each change to the list. Every name,
// price and date is made up.

describe('50.2 how far along each item is, in words and amount', () => {
  it('50.2 an item with its whole price says Ready, with the amount', () => {
    expect(itemProgressText({ has: 4_500, price: 4_500, ready: true, percent: 100 })).toBe('Ready: $45.00 of $45.00');
  });

  it('50.2 an item still filling says what it has of its price and how far along, rounded down', () => {
    expect(
      itemProgressText({
        has: 4_000,
        price: 12_000,
        ready: false,
        percent: 33,
      }),
    ).toBe('$40.00 of $120.00, 33% of the way');
    expect(itemProgressText({ has: 0, price: 12_000, ready: false, percent: 0 })).toBe('Nothing yet of $120.00');
    expect(
      itemProgressText({
        has: 11_999,
        price: 12_000,
        ready: false,
        percent: 99,
      }),
    ).toBe('$119.99 of $120.00, 99% of the way');
  });

  it('50.2 what is more than all the prices together is said as more than the list needs', () => {
    expect(moreText(1)).toBe('More than the list needs: $0.01');
    expect(moreText(0)).toBeNull();
  });
});

describe('50.1 her changes to the list, in words', () => {
  it('50.1 each change to the list is a dated line in words', () => {
    expect(
      logLineText({
        date: '2026-10-03',
        action: 'added',
        item: 'item-1',
        name: 'Rain jacket',
        price: 12_000,
      }),
    ).toBe('Sat, Oct 3: added Rain jacket, $120.00');
    expect(
      logLineText({
        date: '2026-10-03',
        action: 'changed',
        item: 'item-1',
        name: 'Rain coat',
        price: 13_000,
        was: { name: 'Rain jacket', price: 12_000 },
      }),
    ).toBe('Sat, Oct 3: changed Rain jacket, $120.00 to Rain coat, $130.00');
    expect(
      logLineText({
        date: '2026-10-03',
        action: 'removed',
        item: 'item-1',
        name: 'Rain jacket',
        price: 12_000,
      }),
    ).toBe('Sat, Oct 3: removed Rain jacket');
    expect(
      logLineText({
        date: '2026-10-03',
        action: 'moved-up',
        item: 'item-1',
        name: 'Rain jacket',
        price: 12_000,
      }),
    ).toBe('Sat, Oct 3: moved Rain jacket up');
    expect(
      logLineText({
        date: '2026-10-03',
        action: 'moved-down',
        item: 'item-1',
        name: 'Rain jacket',
        price: 12_000,
      }),
    ).toBe('Sat, Oct 3: moved Rain jacket down');
    expect(
      logLineText({
        date: '2026-10-03',
        action: 'bought',
        item: 'item-1',
        name: 'Rain jacket',
        price: 12_000,
        purchase: 'p',
        paid: 11_500,
      }),
    ).toBe('Sat, Oct 3: marked Rain jacket bought, for $115.00');
    expect(
      logLineText({
        date: '2026-10-03',
        action: 'not-bought',
        item: 'item-1',
        name: 'Rain jacket',
        price: 12_000,
        purchase: 'p',
        paid: 11_500,
      }),
    ).toBe('Sat, Oct 3: put Rain jacket back on the list');
  });

  it('50.1 a price is typed in dollars; anything not more than $0.00 is not a price', () => {
    expect(priceOf('45')).toBe(4_500);
    expect(priceOf('$1,200.50')).toBe(120_050);
    expect(priceOf('0.01')).toBe(1);
    for (const bad of ['', '0', '0.00', '-5', 'abc', '1.5']) expect(priceOf(bad)).toBeNull();
  });
});

describe('50.3 a purchase sorted to Wishlist, and what was bought', () => {
  it('50.3 what was bought says the day and what it cost, and the price beside it when they differ (60a)', () => {
    expect(boughtText({ day: '2026-10-03', paid: 4_312, price: 4_500 })).toBe('Bought Sat, Oct 3 for $43.12. Its price was $45.00.');
    expect(boughtText({ day: '2026-10-03', paid: 4_500, price: 4_500 })).toBe('Bought Sat, Oct 3 for $45.00.');
  });

  it('50.3 review asks which item only for a choice that puts something in Wishlist', () => {
    expect(putsInWishlist({ to: 'wishlist' })).toBe(true);
    expect(putsInWishlist({ to: 'needs' })).toBe(false);
    expect(
      putsInWishlist({
        split: [
          { bucket: 'needs', amount: 100 },
          { bucket: 'wishlist', amount: 'rest' },
        ],
      }),
    ).toBe(true);
    expect(
      putsInWishlist({
        split: [
          { bucket: 'needs', amount: 100 },
          { bucket: 'wants', amount: 'rest' },
        ],
      }),
    ).toBe(false);
    expect(putsInWishlist({ refundOf: 'p1' })).toBe(false);
  });
});

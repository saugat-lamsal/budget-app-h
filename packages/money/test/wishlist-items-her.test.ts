// Her rulebook, PR 10+11: Wishlist items (50.1 to 50.3). A list of up to 20
// things, each a name and a price, in the order she chooses. The list reads
// the Wishlist bucket and holds no money of its own: the fill is arithmetic
// on the bucket (50.2), and marking an item bought only changes the list
// (50.3). The bucket goes down by what the purchase cost, which the book does
// when the purchase is sorted (packages/server/test/wishlist-items-her.test.ts
// checks it through the desk). Every name, price and date is made up.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EMPTY_WISHLIST, MoneyError, WISHLIST_MAX_ITEMS, changeWishlist, fillWishlist, type Cents, type WishlistChange, type WishlistList } from '../src/index.js';
import { runs } from './slow.js';

const MAX = Number.MAX_SAFE_INTEGER;
const DAY = '2026-10-05';

function listOf(...items: readonly (readonly [string, Cents])[]): WishlistList {
  return items.reduce((list, [name, price]) => changeWishlist(list, { add: { name, price } }, DAY), EMPTY_WISHLIST);
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MoneyError) return error.message;
    throw error;
  }
  throw new Error('it was not refused');
}

const names = (list: WishlistList): string[] => list.items.map((i) => i.name);

describe('50.1 Wishlist items: a name and a price, in her order, up to 20, every change logged', () => {
  it('50.1 an item is added at the end of the list with its name and price, and the add is logged with the date', () => {
    const list = listOf(['Rain jacket', 12_000], ['Desk lamp', 4_500]);
    expect(list.items).toEqual([
      { id: 'item-1', name: 'Rain jacket', price: 12_000 },
      { id: 'item-2', name: 'Desk lamp', price: 4_500 },
    ]);
    expect(list.log).toEqual([
      {
        date: DAY,
        action: 'added',
        item: 'item-1',
        name: 'Rain jacket',
        price: 12_000,
      },
      {
        date: DAY,
        action: 'added',
        item: 'item-2',
        name: 'Desk lamp',
        price: 4_500,
      },
    ]);
  });

  it('50.1 the name is kept without the spaces around it; an empty name is refused', () => {
    expect(names(listOf(['  Rain jacket  ', 100]))).toEqual(['Rain jacket']);
    expect(refusal(() => listOf(['   ', 100]))).toBe('Give the item a name.');
  });

  it('50.1 a name longer than 80 characters is refused, 80 is taken', () => {
    expect(names(listOf(['x'.repeat(80), 100]))).toEqual(['x'.repeat(80)]);
    expect(refusal(() => listOf(['x'.repeat(81), 100]))).toBe('Keep the name to 80 characters or fewer.');
  });

  it('50.1 a price is whole cents above zero: one cent and the largest exact amount are taken; zero, negative and part cents are refused', () => {
    expect(listOf(['Sticker', 1]).items[0]?.price).toBe(1);
    expect(listOf(['Boat', MAX]).items[0]?.price).toBe(MAX);
    for (const price of [0, -1, -12_000, 0.5, MAX + 1, Number.NaN]) {
      expect(refusal(() => listOf(['Sticker', price]))).toBe('The price must be more than $0.00.');
    }
  });

  it('50.1 up to 20 items: the 20th is taken, a 21st is refused and nothing changes', () => {
    const twenty = listOf(...Array.from({ length: WISHLIST_MAX_ITEMS }, (_, i) => [`Thing ${i + 1}`, 100 * (i + 1)] as const));
    expect(WISHLIST_MAX_ITEMS).toBe(20);
    expect(twenty.items).toHaveLength(20);
    expect(refusal(() => changeWishlist(twenty, { add: { name: 'One more', price: 100 } }, DAY))).toBe('The list has 20 things already. Remove one to add another.');
    expect(twenty.items).toHaveLength(20);
  });

  it('50.1 changing an item keeps its place and id, and logs what it was and what it is now', () => {
    const list = changeWishlist(listOf(['Rain jacket', 12_000], ['Desk lamp', 4_500]), { change: { item: 'item-1', name: 'Rain coat', price: 13_000 } }, '2026-10-06');
    expect(list.items).toEqual([
      { id: 'item-1', name: 'Rain coat', price: 13_000 },
      { id: 'item-2', name: 'Desk lamp', price: 4_500 },
    ]);
    expect(list.log.at(-1)).toEqual({
      date: '2026-10-06',
      action: 'changed',
      item: 'item-1',
      name: 'Rain coat',
      price: 13_000,
      was: { name: 'Rain jacket', price: 12_000 },
    });
  });

  it('50.1 a change to the same name and price is refused as no change; a change to a price of zero is refused', () => {
    const list = listOf(['Rain jacket', 12_000]);
    expect(refusal(() => changeWishlist(list, { change: { item: 'item-1', name: 'Rain jacket', price: 12_000 } }, DAY))).toBe('That is what it is already. Nothing was changed.');
    expect(refusal(() => changeWishlist(list, { change: { item: 'item-1', name: 'Rain jacket', price: 0 } }, DAY))).toBe('The price must be more than $0.00.');
  });

  it('50.1 removing an item takes it off the list and logs it; the others keep their order', () => {
    const list = changeWishlist(listOf(['A', 100], ['B', 200], ['C', 300]), { remove: { item: 'item-2' } }, DAY);
    expect(names(list)).toEqual(['A', 'C']);
    expect(list.log.at(-1)).toEqual({
      date: DAY,
      action: 'removed',
      item: 'item-2',
      name: 'B',
      price: 200,
    });
  });

  it('50.1 moving an item up or down swaps it with its neighbor and logs it; the first cannot go up nor the last down', () => {
    const list = listOf(['A', 100], ['B', 200], ['C', 300]);
    expect(names(changeWishlist(list, { move: { item: 'item-3', direction: 'up' } }, DAY))).toEqual(['A', 'C', 'B']);
    expect(names(changeWishlist(list, { move: { item: 'item-1', direction: 'down' } }, DAY))).toEqual(['B', 'A', 'C']);
    expect(changeWishlist(list, { move: { item: 'item-1', direction: 'down' } }, DAY).log.at(-1)).toEqual({
      date: DAY,
      action: 'moved-down',
      item: 'item-1',
      name: 'A',
      price: 100,
    });
    expect(refusal(() => changeWishlist(list, { move: { item: 'item-1', direction: 'up' } }, DAY))).toBe('A is first on the list already.');
    expect(refusal(() => changeWishlist(list, { move: { item: 'item-3', direction: 'down' } }, DAY))).toBe('C is last on the list already.');
  });

  it('50.1 an item that is not on the list cannot be changed, removed or moved (13.7): refused, and nothing changes', () => {
    const list = listOf(['A', 100]);
    const gone = 'That item is not on your list any more. Nothing was changed.';
    expect(refusal(() => changeWishlist(list, { change: { item: 'item-9', name: 'Z', price: 1 } }, DAY))).toBe(gone);
    expect(refusal(() => changeWishlist(list, { remove: { item: 'item-9' } }, DAY))).toBe(gone);
    expect(refusal(() => changeWishlist(list, { move: { item: 'item-9', direction: 'up' } }, DAY))).toBe(gone);
    expect(list).toEqual(listOf(['A', 100]));
  });

  it('50.1 ids are never used twice, even after an item is removed', () => {
    const list = changeWishlist(changeWishlist(listOf(['A', 100], ['B', 200]), { remove: { item: 'item-2' } }, DAY), { add: { name: 'C', price: 300 } }, DAY);
    expect(list.items.map((i) => i.id)).toEqual(['item-1', 'item-3']);
  });

  it('50.1 a change never touches the list it was given (the history replays it, 0.6)', () => {
    const list = listOf(['A', 100]);
    const before = JSON.stringify(list);
    changeWishlist(list, { add: { name: 'B', price: 200 } }, DAY);
    changeWishlist(list, { remove: { item: 'item-1' } }, DAY);
    expect(JSON.stringify(list)).toBe(before);
    expect(Object.isFrozen(list) && Object.isFrozen(list.items)).toBe(true);
  });
});

describe('50.2 the Wishlist bucket fills the items in order', () => {
  const items = [
    { id: 'a', name: 'A', price: 10_000 },
    { id: 'b', name: 'B', price: 5_000 },
    { id: 'c', name: 'C', price: 2_500 },
  ];
  const has = (bucket: Cents): Cents[] => fillWishlist(bucket, items).items.map((i) => i.has);

  it('50.2 going down the list, each item gets the smaller of its price and what is left after the items above it', () => {
    expect(has(12_000)).toEqual([10_000, 2_000, 0]);
    expect(fillWishlist(12_000, items).more).toBe(0);
  });

  it('50.2 an item with its whole price says Ready, and how far along each is, rounded down so only a full one is 100%', () => {
    const fill = fillWishlist(12_000, items);
    expect(fill.items.map((i) => [i.ready, i.percent])).toEqual([
      [true, 100],
      [false, 40],
      [false, 0],
    ]);
    // One cent short of the price is 99%, never 100%.
    expect(fillWishlist(9_999, items).items[0]).toMatchObject({
      has: 9_999,
      ready: false,
      percent: 99,
    });
  });

  it('50.2 exactly at an item price it is Ready; one cent short it is not, and one cent more goes to the next', () => {
    expect(fillWishlist(10_000, items).items.map((i) => i.ready)).toEqual([true, false, false]);
    expect(has(9_999)).toEqual([9_999, 0, 0]);
    expect(has(10_001)).toEqual([10_000, 1, 0]);
    expect(fillWishlist(10_001, items).items[1]?.percent).toBe(0);
  });

  it('50.2 with the bucket at zero or below, none has anything, and nothing is more than the list needs', () => {
    for (const bucket of [0, -1, -50_000]) {
      expect(fillWishlist(bucket, items)).toEqual({
        items: items.map((i) => ({ ...i, has: 0, ready: false, percent: 0 })),
        more: 0,
      });
    }
  });

  it('50.2 what is more than all the prices together is shown as more than the list needs', () => {
    expect(fillWishlist(17_500, items)).toMatchObject({ more: 0 });
    expect(fillWishlist(17_501, items)).toMatchObject({ more: 1 });
    expect(fillWishlist(MAX, items).more).toBe(MAX - 17_500);
    // An empty list: all of a bucket above zero is more than the list needs.
    expect(fillWishlist(4_200, [])).toEqual({ items: [], more: 4_200 });
  });

  it('50.2 very large prices and buckets stay exact', () => {
    const big = [
      { id: 'a', name: 'A', price: MAX - 1 },
      { id: 'b', name: 'B', price: MAX },
    ];
    expect(fillWishlist(MAX, big).items.map((i) => [i.has, i.percent])).toEqual([
      [MAX - 1, 100],
      [1, 0],
    ]);
  });

  it('50.2 random lists and buckets: each share is 0 to its price, no item has money while one above it is short, and the shares plus more equal the bucket above zero', () => {
    const itemArb = fc.record({
      id: fc.string(),
      name: fc.string(),
      price: fc.oneof(fc.integer({ min: 1, max: 20_000 }), fc.integer({ min: 1, max: 1e12 })),
    });
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: WISHLIST_MAX_ITEMS }), fc.oneof(fc.integer({ min: -20_000, max: 200_000 }), fc.integer({ min: -1e13, max: 1e13 })), (list, bucket) => {
        const fill = fillWishlist(bucket, list);
        expect(fill.items.map((i) => [i.id, i.price])).toEqual(list.map((i) => [i.id, i.price]));
        let short = false;
        let total = 0;
        for (const item of fill.items) {
          expect(item.has).toBeGreaterThanOrEqual(0);
          expect(item.has).toBeLessThanOrEqual(item.price);
          if (short) expect(item.has).toBe(0);
          if (item.has < item.price) short = true;
          expect(item.ready).toBe(item.has === item.price);
          expect(item.percent === 100).toBe(item.ready);
          total += item.has;
        }
        expect(fill.more).toBeGreaterThanOrEqual(0);
        expect(total + fill.more).toBe(Math.max(0, bucket));
        if (fill.more > 0) expect(fill.items.every((i) => i.ready)).toBe(true);
      }),
      { numRuns: runs(500) },
    );
  });
});

describe('50.3 an item marked bought', () => {
  const bought: WishlistChange = {
    bought: { item: 'item-2', purchase: 'p1', day: '2026-10-07', paid: 4_312 },
  };

  it('50.3 the item picked is marked bought, with the day and what was paid, leaves the list, and it is logged', () => {
    const list = changeWishlist(listOf(['A', 100], ['Desk lamp', 4_500], ['C', 300]), bought, '2026-10-08');
    expect(names(list)).toEqual(['A', 'C']);
    expect(list.bought).toEqual([
      {
        id: 'item-2',
        name: 'Desk lamp',
        price: 4_500,
        purchase: 'p1',
        day: '2026-10-07',
        paid: 4_312,
        place: 1,
      },
    ]);
    expect(list.log.at(-1)).toEqual({
      date: '2026-10-08',
      action: 'bought',
      item: 'item-2',
      name: 'Desk lamp',
      price: 4_500,
      purchase: 'p1',
      paid: 4_312,
    });
  });

  it('50.3 what was paid is what the purchase cost, less or more than the price, and never the price (60a)', () => {
    for (const paid of [1, 4_499, 4_500, 4_501, MAX]) {
      const list = changeWishlist(listOf(['Desk lamp', 4_500]), { bought: { item: 'item-1', purchase: 'p1', day: DAY, paid } }, DAY);
      expect(list.bought[0]?.paid).toBe(paid);
    }
    expect(refusal(() => changeWishlist(listOf(['Desk lamp', 4_500]), { bought: { item: 'item-1', purchase: 'p1', day: DAY, paid: 0 } }, DAY))).toBe('What was paid must be more than $0.00.');
  });

  it('50.3 an item no longer on the list cannot be marked bought (13.7), nor one purchase marked twice', () => {
    const list = changeWishlist(listOf(['A', 100], ['B', 200]), { bought: { item: 'item-1', purchase: 'p1', day: DAY, paid: 100 } }, DAY);
    expect(refusal(() => changeWishlist(list, { bought: { item: 'item-1', purchase: 'p2', day: DAY, paid: 100 } }, DAY))).toBe('That item is not on your list any more. Nothing was changed.');
    expect(refusal(() => changeWishlist(list, { bought: { item: 'item-2', purchase: 'p1', day: DAY, paid: 100 } }, DAY))).toBe('That purchase is marked bought already. Nothing was changed.');
  });

  it('50.3 a purchase marked bought can be changed back: the item comes back to the place it had, and it is logged', () => {
    const list = changeWishlist(changeWishlist(listOf(['A', 100], ['Desk lamp', 4_500], ['C', 300]), bought, DAY), { notBought: { purchase: 'p1' } }, '2026-10-09');
    expect(names(list)).toEqual(['A', 'Desk lamp', 'C']);
    expect(list.items[1]).toEqual({
      id: 'item-2',
      name: 'Desk lamp',
      price: 4_500,
    });
    expect(list.bought).toEqual([]);
    expect(list.log.at(-1)).toEqual({
      date: '2026-10-09',
      action: 'not-bought',
      item: 'item-2',
      name: 'Desk lamp',
      price: 4_500,
      purchase: 'p1',
      paid: 4_312,
    });
  });

  it('50.3 changed back after the list got shorter, it comes back at the end; with 20 on the list it is refused', () => {
    let list = changeWishlist(listOf(['A', 100], ['B', 200], ['C', 300]), { bought: { item: 'item-3', purchase: 'p1', day: DAY, paid: 300 } }, DAY);
    list = changeWishlist(list, { remove: { item: 'item-1' } }, DAY);
    expect(names(changeWishlist(list, { notBought: { purchase: 'p1' } }, DAY))).toEqual(['B', 'C']);
    let full = changeWishlist(listOf(['A', 100]), { bought: { item: 'item-1', purchase: 'p1', day: DAY, paid: 100 } }, DAY);
    for (let i = 0; i < WISHLIST_MAX_ITEMS; i += 1) full = changeWishlist(full, { add: { name: `T${i}`, price: 1 } }, DAY);
    expect(refusal(() => changeWishlist(full, { notBought: { purchase: 'p1' } }, DAY))).toBe('The list has 20 things already. Remove one to put this one back.');
  });

  it('50.3 changing back a purchase that is not marked bought is refused (13.7)', () => {
    expect(refusal(() => changeWishlist(listOf(['A', 100]), { notBought: { purchase: 'p9' } }, DAY))).toBe('That purchase is not marked bought. Nothing was changed.');
  });

  it('50.3 the item does not come back by itself; she can add it again, as a new item', () => {
    const list = changeWishlist(changeWishlist(listOf(['Desk lamp', 4_500]), { bought: { item: 'item-1', purchase: 'p1', day: DAY, paid: 4_500 } }, DAY), { add: { name: 'Desk lamp', price: 4_500 } }, DAY);
    expect(list.items).toEqual([{ id: 'item-2', name: 'Desk lamp', price: 4_500 }]);
    expect(list.bought.map((b) => b.id)).toEqual(['item-1']);
  });
});

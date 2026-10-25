// Her rulebook, PR 10+11, on the server: Wishlist items (50.1 to 50.3)
// through the desks and the screens' views. The list is kept in the books'
// history and replays (0.6), every change is logged (13.5), the Wishlist
// screen shows how the bucket fills the items (50.2), and review asks which
// item a Wishlist purchase was (50.3): the bucket goes down by what the
// purchase cost, never by the item's price. The arithmetic is proved in
// packages/money/test/wishlist-items-her.test.ts. Every name, price and date
// is made up.
import { describe, expect, it } from 'vitest';
import { parseWishlistRequest } from '../src/wishlist-items.js';
import type { WishlistResponse } from '../src/views/choice.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { herLife } from './her-harness.js';
import { choose, decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import type { Keeper } from '../src/history/keeper.js';

const E = ACCOUNT_IDS.everyday;

// Setup day with Wishlist 300.00 (savings 4,000.00, wants 200.00, the rest in needs).
async function herWithWishlist(): Promise<Life> {
  const life = await herLife();
  const k = life.keeper;
  for (const setup of [
    { lastPaycheck: '2026-09-25' },
    { assign: { pot: 'savings' as const, amount: 400_000 } },
    { assign: { pot: 'wishlist' as const, amount: 30_000 } },
    { assign: { pot: 'wants' as const, amount: 20_000 } },
    { assign: { pot: 'needs' as const, rest: true as const } },
  ]) {
    const answer = k.setup({ id: decision(), setup });
    if (!answer.ok) throw new Error(`setup day refused ${JSON.stringify(setup)}: ${answer.why}`);
  }
  const view = k.setupView();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
  const started = k.setup({
    id: decision(),
    setup: { start: true },
    confirmed: true,
    seen: view.key,
  });
  if (!started.ok) throw new Error(`tracking did not start: ${started.why}`);
  return life;
}

function edit(k: Keeper, wishlist: unknown, more: Record<string, unknown> = {}): WishlistResponse {
  const parsed = parseWishlistRequest({ id: decision(), wishlist, ...more });
  if (parsed === null) throw new Error(`not a list change: ${JSON.stringify(wishlist)}`);
  return k.wishlist(parsed);
}

function listOf(k: Keeper): {
  readonly items: readonly {
    readonly name: string;
    readonly has: number;
    readonly price: number;
    readonly ready: boolean;
  }[];
  readonly more: number;
  readonly bought: readonly {
    readonly name: string;
    readonly paid: number;
    readonly day: string;
    readonly purchase: string;
  }[];
  readonly log: readonly { readonly action: string; readonly name: string }[];
} {
  const view = k.activity('wishlist');
  if (view.state !== 'tracking' || !('list' in view) || view.list === undefined) throw new Error('no Wishlist list');
  return view.list as ReturnType<typeof listOf>;
}

async function purchaseOn(life: Life, id: string, amount: number, date = '2026-10-03'): Promise<void> {
  life.h.fake.addPosted({
    id,
    account: E,
    amount,
    date,
    description: 'MADE UP GADGETS',
  });
  life.now = noonInNewYork(date);
  await life.sync();
}

describe('50.1 Wishlist items through the desk', () => {
  it('50.1 adding, changing and moving items: the list keeps her order, the Wishlist screen shows it, and each change is logged with the date', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    expect(edit(k, { add: { name: 'Rain jacket', price: 12_000 } })).toMatchObject({ ok: true });
    expect(edit(k, { add: { name: 'Desk lamp', price: 4_500 } }).ok).toBe(true);
    expect(edit(k, { move: { item: 'item-2', direction: 'up' } }).ok).toBe(true);
    expect(edit(k, { change: { item: 'item-1', name: 'Rain coat', price: 13_000 } }).ok).toBe(true);
    const list = listOf(k);
    expect(list.items.map((i) => [i.name, i.price])).toEqual([
      ['Desk lamp', 4_500],
      ['Rain coat', 13_000],
    ]);
    expect(list.log.map((l) => [l.action, l.name])).toEqual([
      ['added', 'Rain jacket'],
      ['added', 'Desk lamp'],
      ['moved-up', 'Desk lamp'],
      ['changed', 'Rain coat'],
    ]);
    life.done();
  });

  it('50.1 removing an item asks first: without her yes nothing changes; with it the item is gone', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    edit(k, { add: { name: 'Rain jacket', price: 12_000 } });
    expect(edit(k, { remove: { item: 'item-1' } })).toMatchObject({
      ok: false,
      code: 'needs-confirmation',
    });
    expect(listOf(k).items).toHaveLength(1);
    expect(edit(k, { remove: { item: 'item-1' } }, { confirmed: true }).ok).toBe(true);
    expect(listOf(k).items).toHaveLength(0);
    life.done();
  });

  it('50.1 the list is kept in the books: it is the same after a restart, and the history still replays (0.6)', async () => {
    const life = await herWithWishlist();
    edit(life.keeper, { add: { name: 'Rain jacket', price: 12_000 } });
    edit(life.keeper, { add: { name: 'Desk lamp', price: 4_500 } });
    const before = listOf(life.keeper);
    life.restart();
    expect(listOf(life.keeper)).toEqual(before);
    life.done();
  });

  it('50.1 the same decision sent twice changes nothing the second time; a refused change leaves nothing behind', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    const request = parseWishlistRequest({
      id: decision(),
      wishlist: { add: { name: 'Rain jacket', price: 12_000 } },
    });
    if (request === null) throw new Error('not a list change');
    expect(k.wishlist(request)).toMatchObject({ ok: true, replayed: false });
    expect(k.wishlist(request)).toMatchObject({ ok: true, replayed: true });
    expect(edit(k, { add: { name: 'Free thing', price: 0 } })).toEqual({
      ok: false,
      code: 'refused',
      why: 'The price must be more than $0.00.',
    });
    expect(listOf(k).items).toHaveLength(1);
    life.done();
  });

  it("50.1 upstream's setup has no Wishlist list: a change is refused, and its list screen has none", async () => {
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    expect(edit(life.keeper, { add: { name: 'Rain jacket', price: 12_000 } })).toEqual({
      ok: false,
      code: 'refused',
      why: 'This setup has no Wishlist. Nothing was changed.',
    });
    const review = life.keeper.review();
    expect(review.state === 'tracking' && 'wishlistItems' in review).toBe(false);
    life.done();
  });

  it('50.1 what the phone sends is read exactly: anything else is not a list change', () => {
    for (const bad of [
      { add: { name: 'x', price: '1' } },
      { add: { name: 'x', price: 1, extra: 1 } },
      { move: { item: 'item-1', direction: 'sideways' } },
      { bought: { item: 'item-1', purchase: 'p', day: '2026-10-01', paid: 1 } },
      { remove: {} },
      'add',
    ]) {
      expect(parseWishlistRequest({ id: decision(), wishlist: bad })).toBeNull();
    }
  });
});

describe('50.2 the Wishlist screen shows how the bucket fills the items', () => {
  it('50.2 each item has the smaller of its price and what is left, Ready when whole, and more than the list needs', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    edit(k, { add: { name: 'Rain jacket', price: 12_000 } });
    edit(k, { add: { name: 'Desk lamp', price: 15_000 } });
    expect(listOf(k).items.map((i) => [i.name, i.has, i.ready])).toEqual([
      ['Rain jacket', 12_000, true],
      ['Desk lamp', 15_000, true],
    ]);
    expect(listOf(k).more).toBe(3_000);
    edit(k, { add: { name: 'Bike', price: 50_000 } });
    expect(listOf(k).items.map((i) => i.has)).toEqual([12_000, 15_000, 3_000]);
    expect(listOf(k).more).toBe(0);
    life.done();
  });

  it('50.2 the items only read the bucket: adding, changing and removing them moves no money', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    const pots = k.book()?.pots();
    edit(k, { add: { name: 'Rain jacket', price: 12_000 } });
    edit(k, { change: { item: 'item-1', name: 'Rain jacket', price: 99_000 } });
    edit(k, { remove: { item: 'item-1' } }, { confirmed: true });
    expect(k.book()?.pots()).toEqual(pots);
    life.done();
  });
});

describe('50.3 review asks which item a Wishlist purchase was', () => {
  it('50.3 review shows her list beside a purchase it can sort to Wishlist', async () => {
    const life = await herWithWishlist();
    edit(life.keeper, { add: { name: 'Desk lamp', price: 4_500 } });
    await purchaseOn(life, 'lamp-1', 4_312);
    const review = life.keeper.review();
    expect(review.state === 'tracking' && 'wishlistItems' in review && review.wishlistItems).toEqual([{ id: 'item-1', name: 'Desk lamp', price: 4_500 }]);
    life.done();
  });

  it('50.3 the item picked is marked bought with the day and what was paid, and leaves the list; the bucket goes down by what the purchase cost, not the price', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    edit(k, { add: { name: 'Desk lamp', price: 4_500 } });
    await purchaseOn(life, 'lamp-1', 4_312);
    const before = k.book()?.pots().wishlist ?? 0;
    expect(
      choose(k, {
        item: 'lamp-1',
        choice: { to: 'wishlist' },
        wishlistItem: 'item-1',
      }).ok,
    ).toBe(true);
    expect(k.book()?.pots().wishlist).toBe(before - 4_312);
    const list = listOf(k);
    expect(list.items).toEqual([]);
    expect(list.bought).toEqual([
      expect.objectContaining({
        name: 'Desk lamp',
        price: 4_500,
        paid: 4_312,
        day: '2026-10-03',
        purchase: 'lamp-1',
      }),
    ]);
    expect(list.log.at(-1)).toMatchObject({
      action: 'bought',
      name: 'Desk lamp',
    });
    life.done();
  });

  it('50.3 bought for more than its price: the bucket goes down by the whole cost; a split purchase: by its Wishlist part only (60a)', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    edit(k, { add: { name: 'Desk lamp', price: 4_500 } });
    edit(k, { add: { name: 'Bike', price: 50_000 } });
    await purchaseOn(life, 'lamp-1', 4_501);
    await purchaseOn(life, 'store-1', 9_000, '2026-10-04');
    const start = k.book()?.pots().wishlist ?? 0;
    expect(
      choose(k, {
        item: 'lamp-1',
        choice: { to: 'wishlist' },
        wishlistItem: 'item-1',
      }).ok,
    ).toBe(true);
    expect(k.book()?.pots().wishlist).toBe(start - 4_501);
    expect(
      choose(k, {
        item: 'store-1',
        choice: {
          split: [
            { bucket: 'needs', amount: 7_000 },
            { bucket: 'wishlist', amount: 'rest' },
          ],
        },
        wishlistItem: 'item-2',
      }).ok,
    ).toBe(true);
    expect(k.book()?.pots().wishlist).toBe(start - 4_501 - 2_000);
    expect(listOf(k).bought.map((b) => [b.name, b.paid])).toEqual([
      ['Desk lamp', 4_501],
      ['Bike', 2_000],
    ]);
    life.done();
  });

  it('50.3 "None of them" sorts it and marks nothing; with items on the list, a Wishlist sort that does not say which is refused and nothing changes', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    edit(k, { add: { name: 'Desk lamp', price: 4_500 } });
    await purchaseOn(life, 'lamp-1', 4_312);
    const pots = k.book()?.pots();
    expect(choose(k, { item: 'lamp-1', choice: { to: 'wishlist' } })).toEqual({
      ok: false,
      code: 'refused',
      why: 'Which thing on your list was it? Pick one, or None of them.',
    });
    expect(k.book()?.pots()).toEqual(pots);
    expect(
      choose(k, {
        item: 'lamp-1',
        choice: { to: 'wishlist' },
        wishlistItem: 'none',
      }).ok,
    ).toBe(true);
    expect(listOf(k).items.map((i) => i.name)).toEqual(['Desk lamp']);
    expect(listOf(k).bought).toEqual([]);
    life.done();
  });

  it('50.3 an item no longer on the list (13.7): refused with why, and the purchase stays waiting', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    edit(k, { add: { name: 'Desk lamp', price: 4_500 } });
    edit(k, { add: { name: 'Bike', price: 50_000 } });
    await purchaseOn(life, 'lamp-1', 4_312);
    edit(k, { remove: { item: 'item-1' } }, { confirmed: true });
    const pots = k.book()?.pots();
    expect(
      choose(k, {
        item: 'lamp-1',
        choice: { to: 'wishlist' },
        wishlistItem: 'item-1',
      }),
    ).toEqual({
      ok: false,
      code: 'changed',
      why: 'That item is not on your list any more. Nothing was changed.',
    });
    expect(k.book()?.pots()).toEqual(pots);
    expect(
      k
        .book()
        ?.reviewItems()
        .map((i) => i.id),
    ).toContain('lamp-1');
    life.done();
  });

  it('50.3 an item named for a sort that puts nothing in Wishlist is refused, and nothing changes', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    edit(k, { add: { name: 'Desk lamp', price: 4_500 } });
    await purchaseOn(life, 'lamp-1', 4_312);
    expect(
      choose(k, {
        item: 'lamp-1',
        choice: { to: 'needs' },
        wishlistItem: 'item-1',
      }),
    ).toEqual({
      ok: false,
      code: 'refused',
      why: 'Only a purchase sorted to Wishlist can be one of the things on your list. Nothing was changed.',
    });
    expect(
      k
        .book()
        ?.reviewItems()
        .map((i) => i.id),
    ).toContain('lamp-1');
    life.done();
  });

  it('50.3 a purchase marked bought can be changed back: the item comes back to its place, and the bucket does not move', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    edit(k, { add: { name: 'Desk lamp', price: 4_500 } });
    edit(k, { add: { name: 'Bike', price: 50_000 } });
    await purchaseOn(life, 'lamp-1', 4_312);
    choose(k, {
      item: 'lamp-1',
      choice: { to: 'wishlist' },
      wishlistItem: 'item-1',
    });
    const pots = k.book()?.pots();
    expect(edit(k, { notBought: { purchase: 'lamp-1' } }).ok).toBe(true);
    expect(listOf(k).items.map((i) => i.name)).toEqual(['Desk lamp', 'Bike']);
    expect(listOf(k).bought).toEqual([]);
    expect(k.book()?.pots()).toEqual(pots);
    expect(edit(k, { notBought: { purchase: 'lamp-1' } })).toEqual({
      ok: false,
      code: 'changed',
      why: 'That purchase is not marked bought. Nothing was changed.',
    });
    life.done();
  });

  it('50.3 a purchase re-sorted to Wishlist from another bucket asks too; a refund goes back to Wishlist and the item stays bought (60a)', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    edit(k, { add: { name: 'Desk lamp', price: 4_500 } });
    edit(k, { add: { name: 'Bike', price: 50_000 } });
    await purchaseOn(life, 'lamp-1', 4_312);
    expect(choose(k, { item: 'lamp-1', choice: { to: 'needs' } }).ok).toBe(true);
    expect(choose(k, { item: 'lamp-1', choice: { to: 'wishlist' }, resort: true })).toMatchObject({
      ok: false,
      why: 'Which thing on your list was it? Pick one, or None of them.',
    });
    const start = k.book()?.pots().wishlist ?? 0;
    expect(
      choose(k, {
        item: 'lamp-1',
        choice: { to: 'wishlist' },
        wishlistItem: 'item-1',
        resort: true,
      }).ok,
    ).toBe(true);
    expect(k.book()?.pots().wishlist).toBe(start - 4_312);
    await purchaseOn(life, 'lamp-back', -4_312, '2026-10-06');
    expect(
      choose(k, {
        item: 'lamp-back',
        choice: { refundOf: 'lamp-1' },
        confirmed: true,
      }).ok,
    ).toBe(true);
    expect(k.book()?.pots().wishlist).toBe(start);
    expect(listOf(k).items.map((i) => i.name)).toEqual(['Bike']);
    expect(listOf(k).bought.map((b) => b.name)).toEqual(['Desk lamp']);
    life.done();
  });
});

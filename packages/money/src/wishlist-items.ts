import { assertCents, type Cents } from './cents.js';
import { assertIsoDate, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';

// Her rulebook, 50.1 to 50.3 (PR 10+11): Wishlist items. A list of up to 20
// things, each a name and a price, in the order she chooses. The list holds
// no money: it only reads the Wishlist bucket (50.2), and marking an item
// bought changes the list, never a bucket (50.3: the bucket goes down by what
// the purchase cost, when it is sorted to Wishlist). The server keeps each
// change in the books' history and replays it (0.6); this file is the
// arithmetic and the refusals, with no clock and no database.

export const WISHLIST_MAX_ITEMS = 20;
// A sanity limit on what is typed, not a money rule (her-questions.txt HB26).
export const WISHLIST_MAX_NAME = 80;

export interface WishlistItem {
  readonly id: string;
  readonly name: string;
  readonly price: Cents;
}

// 50.3: an item marked bought, with the day of the purchase and what it cost,
// and the place it had on the list, for changing it back.
export interface BoughtItem extends WishlistItem {
  readonly purchase: string;
  readonly day: IsoDate;
  readonly paid: Cents;
  readonly place: number;
}

// 50.1, 13.5: each change, dated, with the item as it is after it.
export interface WishlistLogLine {
  readonly date: IsoDate;
  readonly action: 'added' | 'changed' | 'removed' | 'moved-up' | 'moved-down' | 'bought' | 'not-bought';
  readonly item: string;
  readonly name: string;
  readonly price: Cents;
  // A change: what it was before.
  readonly was?: { readonly name: string; readonly price: Cents };
  // Bought, or changed back: the purchase and what it cost.
  readonly purchase?: string;
  readonly paid?: Cents;
}

export interface WishlistList {
  readonly items: readonly WishlistItem[];
  readonly bought: readonly BoughtItem[];
  readonly log: readonly WishlistLogLine[];
  // The next item's number: ids are never used twice.
  readonly nextId: number;
}

export type WishlistChange =
  | { readonly add: { readonly name: string; readonly price: Cents } }
  | {
      readonly change: {
        readonly item: string;
        readonly name: string;
        readonly price: Cents;
      };
    }
  | { readonly remove: { readonly item: string } }
  | {
      readonly move: {
        readonly item: string;
        readonly direction: 'up' | 'down';
      };
    }
  | {
      readonly bought: {
        readonly item: string;
        readonly purchase: string;
        readonly day: IsoDate;
        readonly paid: Cents;
      };
    }
  | { readonly notBought: { readonly purchase: string } };

export const EMPTY_WISHLIST: WishlistList = freeze([], [], [], 1);

const GONE = 'That item is not on your list any more. Nothing was changed.';

// The list after one change, made on `date`; a change that cannot be made is
// refused with a MoneyError in words, and the list given is never touched.
export function changeWishlist(list: WishlistList, change: WishlistChange, date: IsoDate): WishlistList {
  assertIsoDate(date, 'date');
  const items = [...list.items];
  const line = (action: WishlistLogLine['action'], item: WishlistItem, more: Partial<WishlistLogLine> = {}): WishlistLogLine[] => [
    ...list.log,
    {
      date,
      action,
      item: item.id,
      name: item.name,
      price: item.price,
      ...more,
    },
  ];
  if ('add' in change) {
    if (items.length >= WISHLIST_MAX_ITEMS) refuse(`The list has ${WISHLIST_MAX_ITEMS} things already. Remove one to add another.`);
    const item: WishlistItem = { id: `item-${list.nextId}`, name: nameOf(change.add.name), price: priceOf(change.add.price) };
    return freeze([...items, item], list.bought, line('added', item), list.nextId + 1);
  }
  if ('change' in change) {
    const at = placeOf(items, change.change.item);
    const was = items[at] as WishlistItem;
    const item: WishlistItem = {
      id: was.id,
      name: nameOf(change.change.name),
      price: priceOf(change.change.price),
    };
    if (item.name === was.name && item.price === was.price) refuse('That is what it is already. Nothing was changed.');
    items[at] = item;
    return freeze(items, list.bought, line('changed', item, { was: { name: was.name, price: was.price } }), list.nextId);
  }
  if ('remove' in change) {
    const at = placeOf(items, change.remove.item);
    const [item] = items.splice(at, 1) as [WishlistItem];
    return freeze(items, list.bought, line('removed', item), list.nextId);
  }
  if ('move' in change) {
    const at = placeOf(items, change.move.item);
    const item = items[at] as WishlistItem;
    const up = change.move.direction === 'up';
    const to = up ? at - 1 : at + 1;
    if (to < 0) refuse(`${item.name} is first on the list already.`);
    if (to >= items.length) refuse(`${item.name} is last on the list already.`);
    items[at] = items[to] as WishlistItem;
    items[to] = item;
    return freeze(items, list.bought, line(up ? 'moved-up' : 'moved-down', item), list.nextId);
  }
  if ('bought' in change) {
    const { purchase, day, paid } = change.bought;
    assertIsoDate(day, 'day');
    if (list.bought.some((b) => b.purchase === purchase)) refuse('That purchase is marked bought already. Nothing was changed.');
    const at = placeOf(items, change.bought.item);
    if (!isPositiveCents(paid)) refuse('What was paid must be more than $0.00.');
    const [item] = items.splice(at, 1) as [WishlistItem];
    return freeze(items, [...list.bought, { ...item, purchase, day, paid, place: at }], line('bought', item, { purchase, paid }), list.nextId);
  }
  const was = list.bought.find((b) => b.purchase === change.notBought.purchase);
  if (was === undefined) refuse('That purchase is not marked bought. Nothing was changed.');
  if (items.length >= WISHLIST_MAX_ITEMS) refuse(`The list has ${WISHLIST_MAX_ITEMS} things already. Remove one to put this one back.`);
  const item: WishlistItem = { id: was.id, name: was.name, price: was.price };
  items.splice(Math.min(was.place, items.length), 0, item);
  return freeze(
    items,
    list.bought.filter((b) => b !== was),
    line('not-bought', item, { purchase: was.purchase, paid: was.paid }),
    list.nextId,
  );
}

// 50.2: one item as the bucket fills it.
export interface FilledItem extends WishlistItem {
  // What it has: the smaller of its price and what is left after the items above it.
  readonly has: Cents;
  // "Ready": it has its whole price.
  readonly ready: boolean;
  // How far along, in whole percent, rounded down: 100 only when ready.
  readonly percent: number;
}

export interface WishlistFill {
  readonly items: readonly FilledItem[];
  // "More than the list needs": what the bucket holds over all the prices.
  readonly more: Cents;
}

// 50.2: the Wishlist bucket fills the items in order. With the bucket at zero
// or below, none has anything. It only reads the bucket.
export function fillWishlist(bucket: Cents, items: readonly WishlistItem[]): WishlistFill {
  assertCents(bucket, 'Wishlist');
  let left = BigInt(Math.max(0, bucket));
  const filled = items.map((item): FilledItem => {
    const price = BigInt(item.price);
    const has = left < price ? left : price;
    left -= has;
    return { ...item, has: Number(has), ready: has === price, percent: Number((has * 100n) / price) };
  });
  return Object.freeze({ items: Object.freeze(filled), more: Number(left) });
}

function nameOf(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') refuse('Give the item a name.');
  if (trimmed.length > WISHLIST_MAX_NAME) refuse(`Keep the name to ${WISHLIST_MAX_NAME} characters or fewer.`);
  return trimmed;
}

function priceOf(price: Cents): Cents {
  if (!isPositiveCents(price)) refuse('The price must be more than $0.00.');
  return price;
}

function isPositiveCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function placeOf(items: readonly WishlistItem[], id: string): number {
  const at = items.findIndex((i) => i.id === id);
  if (at < 0) refuse(GONE);
  return at;
}

function refuse(why: string): never {
  throw new MoneyError('wishlist-refused', why);
}

function freeze(items: readonly WishlistItem[], bought: readonly BoughtItem[], log: readonly WishlistLogLine[], nextId: number): WishlistList {
  return Object.freeze({
    items: Object.freeze([...items]),
    bought: Object.freeze([...bought]),
    log: Object.freeze([...log]),
    nextId,
  });
}

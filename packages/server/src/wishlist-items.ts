import { EMPTY_WISHLIST, MoneyError, changeWishlist, fillWishlist, type Book, type BoughtItem, type Cents, type FilledItem, type IsoDate, type WishlistChange, type WishlistItem, type WishlistList, type WishlistLogLine } from '@budget-app/money';
import type { RefusalCode } from './views/choice.js';

// Her rulebook, 50.1 to 50.3 (PR 10+11): Wishlist items on the server. Each
// change to the list is an answer in the books' history (history.ts,
// Answer.wishlist), so the list is kept in the database with everything else
// she answers, comes back the same after a restart, and replays (0.6). The
// arithmetic and the refusals are the money package's (wishlist-items.ts).

// What the phone can send about the list. Marking an item bought comes with
// the sort in review instead (ChoiceRequest.wishlistItem), in the same answer.
export type WishlistEdit = Exclude<WishlistChange, { readonly bought: unknown }>;

export interface WishlistRequest {
  // As for a choice: made once on the phone, sent again, the same, on a retry.
  readonly id: string;
  readonly wishlist: WishlistEdit;
  // Removing an item asks first (anything final asks first).
  readonly confirmed?: boolean;
}

export type WishlistResponse = { readonly ok: true; readonly replayed: boolean } | { readonly ok: false; readonly code: RefusalCode; readonly why: string };

// The Wishlist screen's list, worked out on the server: how the bucket fills
// the items (50.2), what was bought (50.3), and the changes, newest last (13.5).
export interface WishlistListView {
  readonly items: readonly FilledItem[];
  readonly more: Cents;
  readonly bought: readonly BoughtItem[];
  readonly log: readonly WishlistLogLine[];
}

const ID_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;
const ITEM_FORMAT = /^item-[1-9][0-9]{0,8}$/;
const MAX_TEXT = 200;

// refuse() adds "Nothing was changed."
export const NO_WISHLIST = 'This setup has no Wishlist';

// The request, if it is exactly the right shape, otherwise null. Nothing is
// guessed or repaired; the money math judges names and prices.
export function parseWishlistRequest(value: Readonly<Record<string, unknown>>): WishlistRequest | null {
  if (!onlyKeys(value, ['id', 'wishlist', 'confirmed'])) return null;
  const { id, wishlist, confirmed } = value;
  if (typeof id !== 'string' || !ID_FORMAT.test(id)) return null;
  if (confirmed !== undefined && typeof confirmed !== 'boolean') return null;
  const edit = editOf(wishlist);
  if (edit === null) return null;
  return {
    id,
    wishlist: edit,
    ...(confirmed === undefined ? {} : { confirmed }),
  };
}

function editOf(value: unknown): WishlistEdit | null {
  if (!isRecord(value) || Object.keys(value).length !== 1) return null;
  const [kind] = Object.keys(value);
  const body = value[kind ?? ''];
  if (!isRecord(body)) return null;
  const item = (v: unknown): v is string => typeof v === 'string' && ITEM_FORMAT.test(v);
  const text = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT;
  const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  switch (kind) {
    case 'add':
      return onlyKeys(body, ['name', 'price']) && text(body['name']) && number(body['price']) ? { add: { name: body['name'], price: body['price'] } } : null;
    case 'change':
      return onlyKeys(body, ['item', 'name', 'price']) && item(body['item']) && text(body['name']) && number(body['price'])
        ? {
            change: {
              item: body['item'],
              name: body['name'],
              price: body['price'],
            },
          }
        : null;
    case 'remove':
      return onlyKeys(body, ['item']) && item(body['item']) ? { remove: { item: body['item'] } } : null;
    case 'move':
      return onlyKeys(body, ['item', 'direction']) && item(body['item']) && (body['direction'] === 'up' || body['direction'] === 'down') ? { move: { item: body['item'], direction: body['direction'] } } : null;
    case 'notBought':
      return onlyKeys(body, ['purchase']) && typeof body['purchase'] === 'string' && body['purchase'] !== '' && body['purchase'].length <= MAX_TEXT ? { notBought: { purchase: body['purchase'] } } : null;
    default:
      return null;
  }
}

// The list after the changes an answer made, on its day (replaying, 0.6).
export function applyWishlist(list: WishlistList, changes: readonly WishlistChange[], date: IsoDate): WishlistList {
  return changes.reduce((now, change) => changeWishlist(now, change, date), list);
}

export { EMPTY_WISHLIST };

// One change, or why not, in words (13.7: an item no longer there is 'changed').
export function tryWishlist(list: WishlistList, change: WishlistChange, date: IsoDate): { readonly ok: true; readonly list: WishlistList } | { readonly ok: false; readonly code: RefusalCode; readonly why: string } {
  try {
    return { ok: true, list: changeWishlist(list, change, date) };
  } catch (error) {
    if (!(error instanceof MoneyError)) throw error;
    return {
      ok: false,
      code: /not on your list any more|not marked bought|marked bought already/.test(error.message) ? 'changed' : 'refused',
      why: error.message,
    };
  }
}

export function wishlistListView(book: Book, list: WishlistList): WishlistListView {
  const fill = fillWishlist(book.pots().wishlist ?? 0, list.items);
  return {
    items: fill.items,
    more: fill.more,
    bought: list.bought,
    log: list.log,
  };
}

// 50.3: what review shows beside a purchase: the list, in her order.
export function itemsForReview(list: WishlistList): readonly WishlistItem[] {
  return list.items.map(({ id, name, price }) => ({ id, name, price }));
}

// 50.3: what marking an item bought with a sort does. The purchase's part in
// Wishlist after the sort (Book.wishlistFlows) is what was paid: what the
// bucket went down by, never the item's price. Asked only while the list has
// items and the purchase is not marked already; "none" marks nothing.
export function boughtWith(book: Book, list: WishlistList, purchaseId: string, pick: string | undefined): { readonly ok: true; readonly change: WishlistChange | null } | { readonly ok: false; readonly code: RefusalCode; readonly why: string } {
  const purchase = book.wishlistFlows().purchases.find((p) => p.id === purchaseId);
  if (purchase === undefined) {
    if (pick === undefined || pick === 'none') return { ok: true, change: null };
    return {
      ok: false,
      code: 'refused',
      why: 'Only a purchase sorted to Wishlist can be one of the things on your list. Nothing was changed.',
    };
  }
  if (list.bought.some((b) => b.purchase === purchaseId) || (list.items.length === 0 && (pick === undefined || pick === 'none'))) {
    if (pick === undefined || pick === 'none') return { ok: true, change: null };
  }
  if (pick === 'none') return { ok: true, change: null };
  if (pick === undefined)
    return {
      ok: false,
      code: 'refused',
      why: 'Which thing on your list was it? Pick one, or None of them.',
    };
  return {
    ok: true,
    change: {
      bought: {
        item: pick,
        purchase: purchaseId,
        day: purchase.date,
        paid: purchase.amount,
      },
    },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

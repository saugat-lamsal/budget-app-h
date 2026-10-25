import { type AnyPot, type Book, type BucketActivity, type Cents, type IsoDate, type Pot, type WishlistItem } from '@budget-app/money';
import type { WishlistListView } from '../wishlist-items.js';
import { itemKey } from '../item-key.js';

// What the screen for one bucket shows (QUESTIONS.md B97 to B102), worked out
// on the server from the book: what went in and out of it this pay period,
// each item with the choices for sorting it again. The screen only formats
// it: every number here comes from the money math, in whole cents, and is
// sent to the phone as JSON.

export interface ActivityInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  // Her rulebook: Wishlist too, where the setup has it.
  readonly pot: AnyPot;
  // True only for the demo's made-up numbers, so the screen can say so.
  readonly madeUpData: boolean;
}

export type ActivityView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      readonly pot: AnyPot;
      readonly activity: BucketActivity;
      // What every bucket holds now, for the form that moves money (13.3).
      // Wishlist only where the setup has it.
      readonly balances: Readonly<Record<Pot, Cents>> & { readonly wishlist?: Cents };
      // Step 3: each row's key, by its id, sent back with an answer about it
      // (seen), so an answer about an item a sync has changed since is refused.
      readonly keys: Readonly<Record<string, string>>;
      // 13.6, 13.8: by the id of each row that can be sorted again, what
      // "always do this" starts from: the place's name, or its description.
      readonly ruleTexts: Readonly<Record<string, string>>;
      // Her rulebook, 50.3: her Wishlist list, for a purchase sorted again to Wishlist.
      readonly wishlistItems?: readonly WishlistItem[];
      // Her rulebook, 50.2 and 50.3: on Wishlist's list, how the bucket fills her items.
      readonly list?: WishlistListView;
    };

export function activityView(input: ActivityInput): ActivityView {
  const { today, book, pot, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };
  const pots = book.pots();
  const balances = Object.fromEntries(book.movablePots().map((p) => [p, pots[p]])) as Record<Pot, Cents> & { wishlist?: Cents };
  const activity = book.activity(pot);
  const keys = Object.fromEntries(activity.rows.map((row) => [row.id, itemKey(row.resort)]));
  const ruleTexts = Object.fromEntries(activity.rows.flatMap((row) => (row.resort.resortable ? [[row.id, book.ruleText(row.resort.id)]] : [])));
  return { state: 'tracking', madeUpData, today, pot, activity, balances, keys, ruleTexts };
}

// Each bucket's name in an address: /buckets/needs, /api/activity/needs.
// Must match packages/web/src/app/routes.ts (a test checks).
export const POT_SLUGS: Readonly<Record<string, Pot>> = Object.freeze({
  savings: 'savings',
  needs: 'needs',
  wants: 'wants',
  'mom-reserve': 'momReserve',
  'held-for-others': 'heldForOthers',
});

// Her rulebook, section 2 (PR 9): Wishlist's list, /buckets/wishlist, kept
// apart from upstream's buckets; the book refuses it where the setup has no
// Wishlist. Must match packages/web/src/app/routes.ts (a test checks).
export const HER_POT_SLUGS: Readonly<Record<string, 'wishlist'>> = Object.freeze({ wishlist: 'wishlist' });

export function potOfSlug(slug: string): Pot | null {
  return Object.hasOwn(POT_SLUGS, slug) ? (POT_SLUGS[slug] ?? null) : null;
}

export function slugOfPot(pot: AnyPot): string {
  const found = [...Object.entries(POT_SLUGS), ...Object.entries(HER_POT_SLUGS)].find(([, p]) => p === pot);
  if (found === undefined) throw new Error(`no address for ${pot}`);
  return found[0];
}

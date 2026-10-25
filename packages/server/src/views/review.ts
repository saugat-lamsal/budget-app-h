import type { AccountId, Book, Cents, IsoDate, ReviewDetail, WishlistItem } from '@budget-app/money';
import type { BankMeaning } from './bank-rules.js';
import { itemKey } from '../item-key.js';

// What the Review screen shows, worked out on the server from the book:
// everything waiting, with the choices the rulebook gives for each kind of
// item (from the money math, so the screen decides nothing).

export interface ReviewInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  readonly madeUpData: boolean;
  // B226: by item id, the bank rule for a pending item read as a purchase that the bank labels otherwise.
  readonly labeled?: ReadonlyMap<string, BankRuleHint>;
}

export type ReviewView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      // 4.3: unsorted spending, held back from safe to spend until sorted.
      readonly heldBack: Cents;
      // Payday questions first, then money in, spending, and old card flags;
      // each group oldest first (B32: all of them wait here).
      readonly items: readonly KeyedDetail[];
      // Her rulebook, 50.3: her Wishlist list, for "which thing on your list was it".
      readonly wishlistItems?: readonly WishlistItem[];
    };

// Step 3: an item with its key, sent back with an answer about it (seen), so
// an answer about an item a sync has changed since is refused. B226: a
// pending item the bank labels as a card payment, a transfer or a payment to
// a person, which his bank rules read as a purchase, has the bank rule for
// its wording (labeled). 13.6, 13.8: what "always do this" starts from
// (ruleText): the place's name, or the description when it has none.
export type KeyedDetail = ReviewDetail & { readonly key: string; readonly ruleText: string; readonly labeled?: BankRuleHint };

// B226: the bank rule that would read such an item, and the next ones, right.
export interface BankRuleHint {
  readonly account: AccountId;
  readonly contains: string;
  readonly means: BankMeaning;
  // A transfer's other account as the history shows it; null for him to pick.
  readonly other: AccountId | null;
}

export function keyed(detail: ReviewDetail, ruleText: string): KeyedDetail {
  return { ...detail, key: itemKey(detail), ruleText };
}

const GROUPS: readonly ReviewDetail['item']['type'][] = ['leftover', 'money-in', 'spending', 'old-card-purchase'];

export function reviewView(input: ReviewInput): ReviewView {
  const { today, book, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };
  const items = book
    .reviewDetails()
    // Array.prototype.sort is stable, so items of the same group and day stay in the book's order.
    .sort((a, b) => GROUPS.indexOf(a.item.type) - GROUPS.indexOf(b.item.type) || (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : 0))
    .map((detail) => {
      const hint = detail.item.type === 'spending' && detail.pending ? input.labeled?.get(detail.item.id) : undefined;
      const ruleText = detail.item.type === 'spending' || detail.item.type === 'money-in' ? book.ruleText(detail.item.id) : '';
      return hint === undefined ? keyed(detail, ruleText) : { ...keyed(detail, ruleText), labeled: hint };
    });
  return { state: 'tracking', madeUpData, today, heldBack: book.pots().unsortedOut, items };
}

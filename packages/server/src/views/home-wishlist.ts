import { wishlistMove, type BankBalances, type Book, type CardStatement, type DueStatement, type EverydayCard, type IsoDate, type WishlistMove } from '@budget-app/money';
import { readPlaidItem } from '../bank/plaid-item.js';
import { cardStatement } from '../bank/statements.js';
import type { PlaidCreditCard } from '../plaid/types.js';
import type { StoredItem } from '../sync/plan.js';
import type { HomeWithCards } from './home-cards.js';

// Her rulebook, 50.4 (PR 9): moving Wishlist money for a purchase. Home says
// "Move $X from savings to checking" with when (wishlist.ts works it out),
// and the card reminders say it too. Only in a setup with Wishlist; upstream's
// Home is upstream's.

export interface WishlistMoveSources {
  readonly today: IsoDate;
  readonly book: Book;
  // As 3.8 reads the savings account: null while the bank cannot be read.
  readonly bank: BankBalances | null;
  // The latest statement of each card the bank sends, and each card's kept
  // ones (52.5), with the closing day each card's statement date comes from (9.8).
  readonly latest: readonly CardStatement[];
  readonly kept: readonly { readonly card: EverydayCard; readonly raw: readonly PlaidCreditCard[]; readonly closingDay: number | null }[];
  // The bank's items, for the day the bank posted each one.
  readonly items: ReadonlyMap<string, StoredItem>;
}

export function wishlistMoveOf(sources: WishlistMoveSources): WishlistMove | null {
  const { book } = sources;
  if (book.switches().wishlist !== 'on') return null;
  const statements: Partial<Record<EverydayCard, DueStatement[]>> = {};
  const add = (card: EverydayCard, s: DueStatement): void => {
    const list = (statements[card] ??= []);
    if (!list.some((t) => t.closingDate === s.closingDate)) list.push({ closingDate: s.closingDate, dueDate: s.dueDate });
  };
  for (const s of sources.latest) if (s.card === 'everyday-card' || s.card === 'second-card') add(s.card, s);
  for (const k of sources.kept) {
    for (const raw of k.raw) {
      const read = cardStatement(k.card, raw, k.closingDay);
      if (read.ok) add(k.card, read.statement);
    }
  }
  const postedOn = new Map<string, IsoDate>();
  for (const item of sources.items.values()) {
    const plaid = readPlaidItem(item.raw);
    if (plaid.ok) postedOn.set(item.transactionId, plaid.item.date);
  }
  return wishlistMove(book, { savingsAccountBalance: sources.bank?.savings ?? null, statements, today: sources.today, postedOn: (id) => postedOn.get(id) ?? null });
}

// Home as her setup sends it, with 50.4's line: left out at $0.00 and while
// the bank cannot be read.
export type HomeWithWishlist = HomeWithCards | (Extract<HomeWithCards, { state: 'tracking' }> & { readonly wishlistMove?: WishlistMove });

export function withWishlistMove(view: HomeWithCards, move: WishlistMove | null): HomeWithWishlist {
  return view.state !== 'tracking' || move === null || move.amount === 0 ? view : { ...view, wishlistMove: move };
}

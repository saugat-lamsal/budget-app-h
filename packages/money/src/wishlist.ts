import type { Book, WishlistPurchase } from './book.js';
import { addCents, subtractCents, type Cents } from './cents.js';
import { assertIsoDate, daysBetween, type IsoDate } from './dates.js';
import type { EverydayCard } from './reminders.js';

// Her rulebook, 50.4 (PR 9): moving Wishlist money for a purchase. Wishlist
// money is kept in the savings account (3.8), and purchases are paid from
// checking or a card, so a purchase sorted to Wishlist asks her to move that
// much from savings to checking. $X is the smaller of two amounts: the extra
// in savings (3.8), so money still to move into savings is netted in and one
// move covers both; and everything sorted to Wishlist since tracking started,
// less Wishlist refunds and less every move from savings to checking since
// tracking started. A move from savings to checking is not spending (5.3).
// It only reads.
//
// Which purchases are still to move, for when: the moves and the money back
// cover the oldest first. A purchase that left savings is none of them: its
// money already left the savings account. Readings in docs/her-questions.txt.

// A card statement as far as 50.4 needs it: when it closed and when it is due.
export interface DueStatement {
  readonly closingDate: IsoDate;
  readonly dueDate: IsoDate;
}

export interface WishlistMoveInput {
  // As 3.8 reads it; null while the bank cannot be read.
  readonly savingsAccountBalance: Cents | null;
  // The statements the app has for each card, in any order (52.5).
  readonly statements: Readonly<Partial<Record<EverydayCard, readonly DueStatement[]>>>;
  readonly today: IsoDate;
  // The day the bank posted a transaction, by its id, when the caller knows
  // it; otherwise the book's own day for it.
  readonly postedOn?: (id: string) => IsoDate | null;
}

// When to move it. now: a debit card purchase, which has already left
// checking. before-due: a purchase on a card statement that has closed, by its
// due date; day says whether today is before it, on it or after it (as 9.6
// says due and overdue). before-next-due: on a card, on no closed statement
// yet (still pending, or after its last closing day).
export type WishlistMoveWhen =
  | { readonly kind: 'now' }
  | { readonly kind: 'before-due'; readonly card: EverydayCard; readonly dueDate: IsoDate; readonly day: 'before' | 'on' | 'after' }
  | { readonly kind: 'before-next-due'; readonly card: EverydayCard };

export interface WishlistMove {
  // $X: what to move from savings to checking; Home says nothing at $0.00.
  readonly amount: Cents;
  // The extra in savings (3.8), $0.00 when there is none.
  readonly extra: Cents;
  // What was sorted to Wishlist less refunds and moves, never below $0.00.
  readonly notMoved: Cents;
  // Null at $0.00. The earliest of the purchases still to move: now first,
  // then the earliest due date, then a next due date.
  readonly when: WishlistMoveWhen | null;
  // The cards with a purchase still to move, whose reminders say it too (9.1,
  // 9.7), the Capital One card first; empty at $0.00.
  readonly cards: readonly EverydayCard[];
}

const CARDS: readonly EverydayCard[] = ['everyday-card', 'second-card'];

export function wishlistMove(book: Book, input: WishlistMoveInput): WishlistMove | null {
  const flows = book.wishlistFlows();
  assertIsoDate(input.today, 'today');
  if (input.savingsAccountBalance === null) return null;
  const extra = book.savingsTransfer(input.savingsAccountBalance).extraInSavings ?? 0;
  const back = addCents(flows.paidBack, flows.movedToChecking);
  let covered = back;
  let sorted = 0;
  const waiting: { readonly purchase: WishlistPurchase; readonly left: Cents }[] = [];
  const oldestFirst = [...flows.purchases].sort((a, b) => daysBetween(b.date, a.date));
  for (const purchase of oldestFirst) {
    sorted = addCents(sorted, purchase.amount);
    const taken = Math.min(purchase.amount, covered);
    covered -= taken;
    if (taken < purchase.amount) waiting.push({ purchase, left: purchase.amount - taken });
  }
  const notMoved = Math.max(0, subtractCents(sorted, back));
  const amount = Math.max(0, Math.min(extra, notMoved));
  if (amount === 0) return Object.freeze({ amount: 0, extra, notMoved, when: null, cards: Object.freeze([]) });
  const whens = waiting.map((w) => whenFor(w.purchase, input));
  const cards = CARDS.filter((card) => waiting.some((w) => w.purchase.account === card));
  return Object.freeze({ amount, extra, notMoved, when: earliest(whens), cards: Object.freeze(cards) });
}

function whenFor(purchase: WishlistPurchase, input: WishlistMoveInput): WishlistMoveWhen {
  const card = purchase.account;
  if (card !== 'everyday-card' && card !== 'second-card') return { kind: 'now' };
  if (purchase.posted === null) return { kind: 'before-next-due', card };
  const postedOn = input.postedOn?.(purchase.posted.id) ?? purchase.posted.date;
  assertIsoDate(postedOn, 'posted day');
  // The statement it is on: the first that closed on or after the day it posted.
  const on = [...(input.statements[card] ?? [])].sort((a, b) => daysBetween(b.closingDate, a.closingDate)).find((s) => daysBetween(postedOn, s.closingDate) >= 0);
  if (on === undefined) return { kind: 'before-next-due', card };
  const toDue = daysBetween(input.today, on.dueDate);
  return { kind: 'before-due', card, dueDate: on.dueDate, day: toDue > 0 ? 'before' : toDue === 0 ? 'on' : 'after' };
}

function earliest(whens: readonly WishlistMoveWhen[]): WishlistMoveWhen | null {
  const rank = (w: WishlistMoveWhen): number => (w.kind === 'now' ? 0 : w.kind === 'before-due' ? 1 : 2);
  let best: WishlistMoveWhen | null = null;
  for (const w of whens) {
    if (best === null || rank(w) < rank(best)) best = w;
    else if (w.kind === 'before-due' && best.kind === 'before-due' && daysBetween(w.dueDate, best.dueDate) > 0) best = w;
  }
  return best;
}

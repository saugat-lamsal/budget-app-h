// Her rulebook, 50.4 (PR 9): moving Wishlist money for a purchase. Wishlist
// money is kept in the savings account (3.8), and purchases are paid from
// checking or a card, so a purchase sorted to Wishlist asks her to move that
// much from savings to checking: "now" for one that already left checking,
// before the card's due date for one on a closed statement, before its next
// due date while its statement has not closed. $X is the smaller of the
// extra in savings (3.8) and the Wishlist purchases not yet moved.
import { describe, expect, it } from 'vitest';
import { HER_SETTINGS, HER_SWITCHES, DEFAULT_SETTINGS, changeSettings, openBook, wishlistMove, type Book, type CardStatement, type Cents, type IsoDate, type OpenBookInput, type Settings, type WishlistMove, type WishlistMoveInput } from '../src/index.js';
import { LAST_PAYCHECK, PAYROLL, START_DATE, arrived, codeOf, deposit, paycheck, purchase, refund, sent, takenBack, transfer, withdrawal } from './helpers.js';

const HER: Settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL }, split: { savings: 40, needs: 30, wants: 20, wishlist: 10 }, askBeforeSplittingPaycheck: false });
// What lives in the savings account: savings 100,000 and Wishlist 20,000.
const POTS = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0, wishlist: 20_000 };
const IN_SAVINGS: Cents = 120_000;

// The Capital One card closed Oct 5, due Oct 30; the Amex card closed Oct 8, due Nov 3.
const CAPITAL_ONE: CardStatement = { card: 'everyday-card', closingDate: '2026-10-05', dueDate: '2026-10-30', statementBalance: 0, minimumPayment: 0 };
const AMEX: CardStatement = { card: 'second-card', closingDate: '2026-10-08', dueDate: '2026-11-03', statementBalance: 0, minimumPayment: 0 };

function herBook(input: Partial<OpenBookInput> = {}): Book {
  return openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: HER, switches: HER_SWITCHES, ...input });
}

function inputOf(balance: Cents | null, today: IsoDate, more: Partial<WishlistMoveInput>): WishlistMoveInput {
  return { savingsAccountBalance: balance, statements: { 'everyday-card': [CAPITAL_ONE], 'second-card': [AMEX] }, today, ...more };
}

function moveOf(book: Book, balance: Cents, today: IsoDate, more: Partial<WishlistMoveInput> = {}): WishlistMove {
  const move = wishlistMove(book, inputOf(balance, today, more));
  if (move === null) throw new Error('the bank was read');
  return move;
}

// A purchase sorted to Wishlist, posted on its day.
function wishlistPurchase(book: Book, id: string, date: IsoDate, amount: Cents, account: 'checking' | 'everyday-card' | 'second-card'): void {
  book.receive(purchase(id, date, amount, 'MADE UP GADGETS', { account }));
  book.sort(id, { to: 'wishlist' }, date);
}

describe('50.4 moving Wishlist money from savings to checking', () => {
  it('50.4 a Wishlist purchase on a card whose statement has its due date: move $X from savings to checking before the card is due', () => {
    const book = herBook();
    expect(moveOf(book, IN_SAVINGS, '2026-10-06')).toMatchObject({ amount: 0, when: null });
    wishlistPurchase(book, 'c1', '2026-10-04', 5_000, 'everyday-card');
    expect(moveOf(book, IN_SAVINGS, '2026-10-06')).toEqual({ amount: 5_000, extra: 5_000, notMoved: 5_000, when: { kind: 'before-due', card: 'everyday-card', dueDate: '2026-10-30', day: 'before' }, cards: ['everyday-card'] });
  });

  it("50.4 while the statement it is on has not closed yet: before the card's next due date", () => {
    const book = herBook();
    wishlistPurchase(book, 'c1', '2026-10-09', 5_000, 'second-card');
    expect(moveOf(book, IN_SAVINGS, '2026-10-10')).toMatchObject({ amount: 5_000, when: { kind: 'before-next-due', card: 'second-card' } });
    // A purchase on the closing day itself is on that statement.
    const onTheDay = herBook();
    wishlistPurchase(onTheDay, 'c2', '2026-10-08', 5_000, 'second-card');
    expect(moveOf(onTheDay, IN_SAVINGS, '2026-10-10').when).toEqual({ kind: 'before-due', card: 'second-card', dueDate: '2026-11-03', day: 'before' });
    // Still pending: on no statement yet.
    const pending = herBook();
    pending.receive(purchase('c3', '2026-10-04', 5_000, 'MADE UP GADGETS', { account: 'everyday-card', pending: true }));
    pending.sort('c3', { to: 'wishlist' }, '2026-10-04');
    expect(moveOf(pending, IN_SAVINGS, '2026-10-06').when).toEqual({ kind: 'before-next-due', card: 'everyday-card' });
    // A card whose statement the app does not have yet.
    expect(moveOf(book, IN_SAVINGS, '2026-10-10', { statements: {} }).when).toEqual({ kind: 'before-next-due', card: 'second-card' });
  });

  it('50.4 the posted day is the one the bank gives, when the caller knows it', () => {
    const book = herBook();
    wishlistPurchase(book, 'c1', '2026-10-04', 5_000, 'everyday-card');
    expect(moveOf(book, IN_SAVINGS, '2026-10-07', { postedOn: (id) => (id === 'c1' ? '2026-10-06' : null) }).when).toEqual({ kind: 'before-next-due', card: 'everyday-card' });
  });

  it('50.4 a debit card purchase has already left checking: move it now', () => {
    const book = herBook();
    wishlistPurchase(book, 'd1', '2026-10-04', 2_000, 'checking');
    expect(moveOf(book, IN_SAVINGS, '2026-10-04')).toMatchObject({ amount: 2_000, when: { kind: 'now' }, cards: [] });
  });

  it('50.4 with purchases on both cards it names the earliest due date; a debit card purchase comes before any', () => {
    const book = herBook();
    wishlistPurchase(book, 'a1', '2026-10-07', 3_000, 'second-card');
    wishlistPurchase(book, 'c1', '2026-10-04', 1_000, 'everyday-card');
    expect(moveOf(book, IN_SAVINGS, '2026-10-09')).toMatchObject({ amount: 4_000, when: { kind: 'before-due', card: 'everyday-card', dueDate: '2026-10-30' }, cards: ['everyday-card', 'second-card'] });
    // The Amex card due first.
    expect(moveOf(book, IN_SAVINGS, '2026-10-09', { statements: { 'everyday-card': [{ ...CAPITAL_ONE, dueDate: '2026-11-04' }], 'second-card': [AMEX] } }).when).toMatchObject({ card: 'second-card', dueDate: '2026-11-03' });
    // A due date beats a next due date not known yet.
    const later = herBook();
    wishlistPurchase(later, 'c2', '2026-10-06', 1_000, 'everyday-card');
    wishlistPurchase(later, 'a2', '2026-10-07', 1_000, 'second-card');
    expect(moveOf(later, IN_SAVINGS, '2026-10-09').when).toMatchObject({ kind: 'before-due', card: 'second-card' });
    wishlistPurchase(book, 'd1', '2026-10-08', 500, 'checking');
    expect(moveOf(book, IN_SAVINGS, '2026-10-09').when).toEqual({ kind: 'now' });
  });

  it('50.4 exactly on the due date, and the day after, the words change as 9.6 does', () => {
    const book = herBook();
    wishlistPurchase(book, 'c1', '2026-10-04', 5_000, 'everyday-card');
    expect(moveOf(book, IN_SAVINGS, '2026-10-29').when).toMatchObject({ day: 'before' });
    expect(moveOf(book, IN_SAVINGS, '2026-10-30').when).toMatchObject({ day: 'on' });
    expect(moveOf(book, IN_SAVINGS, '2026-10-31').when).toMatchObject({ day: 'after' });
    // With the statement before too: it is on the first one that closed on or after it posted.
    const older: CardStatement = { ...CAPITAL_ONE, closingDate: '2026-09-05', dueDate: '2026-09-30' };
    const early = herBook();
    wishlistPurchase(early, 'c2', '2026-10-01', 5_000, 'everyday-card');
    expect(moveOf(early, IN_SAVINGS, '2026-10-02', { statements: { 'everyday-card': [older, CAPITAL_ONE] } }).when).toEqual({ kind: 'before-due', card: 'everyday-card', dueDate: '2026-10-30', day: 'before' });
  });

  it('50.4 $X is the smaller of the extra in savings and the Wishlist purchases not yet moved: money still to move into savings is netted in', () => {
    const book = herBook();
    wishlistPurchase(book, 'c1', '2026-10-04', 5_000, 'everyday-card');
    // The account holds more than enough: $X is what was sorted to Wishlist.
    expect(moveOf(book, IN_SAVINGS + 50_000, '2026-10-06')).toMatchObject({ amount: 5_000, extra: 55_000, notMoved: 5_000 });
    // 2,000 was still to move into savings before the purchase: one move of 3,000 out covers both.
    expect(moveOf(book, IN_SAVINGS - 2_000, '2026-10-06')).toMatchObject({ amount: 3_000, extra: 3_000, notMoved: 5_000 });
    // More still to move in than the purchase: nothing to move out.
    expect(moveOf(book, IN_SAVINGS - 6_000, '2026-10-06')).toMatchObject({ amount: 0, extra: 0, when: null, cards: [] });
    // At the edge of a cent.
    expect(moveOf(book, IN_SAVINGS - 4_999, '2026-10-06')).toMatchObject({ amount: 1 });
    // A payday asks for more in savings, which nets the move out.
    book.receive(paycheck('p1', '2026-10-09', 100_000));
    expect(moveOf(book, IN_SAVINGS, '2026-10-09')).toMatchObject({ amount: 0 });
  });

  it('50.4 it goes away once $X is $0.00: after a move of exactly $X from savings to checking, which is not spending (5.3)', () => {
    const book = herBook();
    wishlistPurchase(book, 'c1', '2026-10-04', 5_000, 'everyday-card');
    const before = book.pots();
    book.receive(transfer('t1', '2026-10-06', 2_000, 'savings', 'checking'));
    expect(book.pots()).toEqual(before);
    expect(moveOf(book, IN_SAVINGS - 2_000, '2026-10-06')).toMatchObject({ amount: 3_000, notMoved: 3_000 });
    // The rest in two halves: it counts from the day it leaves savings (12.5).
    book.receive(sent('t2', '2026-10-07', 3_000, 'savings', 'checking'));
    expect(moveOf(book, IN_SAVINGS - 5_000, '2026-10-07')).toMatchObject({ amount: 0, notMoved: 0, when: null });
    book.receive(arrived('t2a', '2026-10-08', 3_000, 'savings', 'checking', 't2'));
    expect(moveOf(book, IN_SAVINGS - 5_000, '2026-10-08')).toMatchObject({ amount: 0, notMoved: 0 });
    expect(book.pots()).toEqual(before);
    // Moving more than asked does not make it go below zero.
    book.receive(transfer('t3', '2026-10-09', 1_000, 'savings', 'checking'));
    expect(moveOf(book, IN_SAVINGS - 6_000, '2026-10-09')).toMatchObject({ amount: 0, notMoved: 0 });
  });

  it('50.4 moves cover the oldest Wishlist purchases first: the one named is what is still to move', () => {
    const book = herBook();
    wishlistPurchase(book, 'd1', '2026-10-03', 1_000, 'checking');
    wishlistPurchase(book, 'c1', '2026-10-04', 2_000, 'everyday-card');
    book.receive(transfer('t1', '2026-10-05', 1_000, 'savings', 'checking'));
    expect(moveOf(book, IN_SAVINGS - 1_000, '2026-10-06')).toMatchObject({ amount: 2_000, when: { kind: 'before-due', card: 'everyday-card' }, cards: ['everyday-card'] });
  });

  it('50.4 a move the bank takes back counts no more; one from savings to anywhere else is not a move to checking', () => {
    const book = herBook();
    wishlistPurchase(book, 'c1', '2026-10-04', 5_000, 'everyday-card');
    book.receive(transfer('t1', '2026-10-06', 5_000, 'savings', 'checking'));
    book.receive(takenBack('x1', 't1', '2026-10-07'));
    expect(moveOf(book, IN_SAVINGS, '2026-10-07')).toMatchObject({ amount: 5_000, notMoved: 5_000 });
    book.receive(transfer('t2', '2026-10-08', 5_000, 'savings', 'everyday-card'));
    expect(moveOf(book, IN_SAVINGS - 5_000, '2026-10-08')).toMatchObject({ amount: 0, notMoved: 5_000 });
  });

  it('50.4 a Wishlist refund lowers it, and so does money back sorted into Wishlist', () => {
    const book = herBook();
    wishlistPurchase(book, 'c1', '2026-10-04', 5_000, 'everyday-card');
    book.receive(refund('r1', '2026-10-05', 1_500, 'c1'));
    expect(moveOf(book, IN_SAVINGS, '2026-10-06')).toMatchObject({ amount: 3_500, notMoved: 3_500 });
    book.receive(deposit('d1', '2026-10-06', 500, 'MADE UP FRIEND PAID BACK'));
    book.sort('d1', { to: 'wishlist' }, '2026-10-06');
    expect(moveOf(book, IN_SAVINGS, '2026-10-06')).toMatchObject({ amount: 3_000, notMoved: 3_000 });
    book.receive(refund('r2', '2026-10-07', 3_500, 'c1'));
    expect(moveOf(book, IN_SAVINGS, '2026-10-07')).toMatchObject({ amount: 0, notMoved: 0, when: null });
  });

  it('50.4 a split purchase counts its Wishlist part only; one paid from savings needs no move (it already left savings)', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-04', 10_000, 'MADE UP STORE', { account: 'everyday-card' }));
    book.sort('c1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wishlist', amount: 4_000 }] }, '2026-10-04');
    expect(moveOf(book, IN_SAVINGS, '2026-10-06')).toMatchObject({ amount: 4_000, notMoved: 4_000 });
    book.receive(withdrawal('w1', '2026-10-06', 3_000));
    book.sort('w1', { to: 'wishlist' }, '2026-10-06');
    expect(moveOf(book, IN_SAVINGS - 3_000, '2026-10-06')).toMatchObject({ amount: 4_000, notMoved: 4_000 });
  });

  it('50.4 while the bank cannot be read there is nothing to say; and a setup with no Wishlist has none of it', () => {
    const book = herBook();
    wishlistPurchase(book, 'c1', '2026-10-04', 5_000, 'everyday-card');
    expect(wishlistMove(book, inputOf(null, '2026-10-06', {}))).toBeNull();
    const upstream = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 }, settings: DEFAULT_SETTINGS });
    expect(codeOf(() => moveOf(upstream, 0, '2026-10-06'))).toBe('off-in-this-setup');
  });
});

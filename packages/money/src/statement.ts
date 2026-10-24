import type { Book, CardEntry, SpendingSort } from './book.js';
import { addCents, assertCents, subtractCents, type Cents } from './cents.js';
import { addDays, assertIsoDate, daysBetween, lastDayOfMonth, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import type { CardStatement, EverydayCard } from './reminders.js';

// Her rulebook, 52.4 (PR 7+8): a card's last statement, from the day after
// the statement before closed to its own closing day, in lines that add up
// to its balance exactly: what was carried in less the payments and credits
// that reached the card in its days; each purchase, fee and interest charge,
// less refunds, by the bucket it is sorted to now and again by the pay period
// it was counted in; purchases from before setup day; and what none of that
// accounts for, "Not matched". It only reads.
//
// Which transactions are on it: the ones the bank posted in its days, by the
// day the bank posted them; one still pending is on none (HB14). A charge the
// bank takes back is on the statement it posted in, and its take-back on the
// one it came in. Readings HB14 to HB18, docs/her-questions.txt.

// Her rulebook, 52.4 (PR 9): Wishlist too, where the setup has it.
export type StatementBucket = 'needs' | 'wants' | 'wishlist' | 'unsorted' | 'before-setup';

export interface StatementItem {
  readonly id: string;
  // The day of the purchase (4.1), and the day the bank posted it.
  readonly date: IsoDate;
  readonly postedOn: IsoDate;
  readonly description: string;
  // What it adds to the statement: a charge above zero, a refund below.
  readonly amount: Cents;
}

export interface StatementPeriod {
  readonly number: number;
  // The day the pay period began: setup day, or a paycheck's day.
  readonly startDate: IsoDate;
}

// A history item from before setup day, read by today's bank rules (40.1).
export interface BeforeSetupLine {
  readonly id: string;
  readonly date: IsoDate;
  readonly postedOn: IsoDate;
  readonly description: string;
  // What it added to what the card owes: a charge above zero.
  readonly amount: Cents;
  // A transfer from her other accounts (a payment), as the bank rules read it.
  readonly payment: boolean;
}

export interface StatementInput {
  readonly statement: CardStatement;
  // The one before it (52.5), or null for the first the app sees.
  readonly before: CardStatement | null;
  // Null before setup day.
  readonly book: Book | null;
  // The day the bank posted a transaction, by its id, when the caller knows
  // it; otherwise the book's own day for it.
  readonly postedOn?: (id: string) => IsoDate | null;
  readonly beforeSetup?: readonly BeforeSetupLine[];
}

export type CarriedIn =
  | {
      readonly kind: 'from-statement-before';
      readonly before: Cents;
      // Payments and credits that reached the card in this statement's days (below zero).
      readonly paymentsAndCredits: Cents;
      readonly amount: Cents;
      readonly items: readonly StatementItem[];
    }
  // The first statement the app sees: what is on it that the app cannot
  // account for in its days is from before the app saw this card.
  | { readonly kind: 'before-the-app'; readonly amount: Cents };

export interface StatementView {
  readonly card: EverydayCard;
  readonly closingDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly statementBalance: Cents;
  readonly minimumPayment: Cents;
  // The statement's first day.
  readonly from: IsoDate;
  readonly carriedIn: CarriedIn;
  // Only the groups with something in them, in this order: needs, wants,
  // Wishlist, still unsorted, before setup day.
  readonly byBucket: readonly { readonly bucket: StatementBucket; readonly total: Cents; readonly items: readonly StatementItem[] }[];
  // Before setup day first, then each pay period, oldest first.
  readonly byPayPeriod: readonly { readonly period: StatementPeriod | 'before-setup'; readonly total: Cents; readonly items: readonly StatementItem[] }[];
  // The purchases, fees and interest less refunds, all together.
  readonly charges: Cents;
  readonly notMatched: Cents;
}

type Where = StatementBucket | 'credit';
interface Piece {
  readonly where: Where;
  readonly amount: Cents;
}
interface Line {
  readonly item: Omit<StatementItem, 'amount'>;
  readonly pieces: readonly Piece[];
}

const BUCKET_ORDER: readonly StatementBucket[] = ['needs', 'wants', 'wishlist', 'unsorted', 'before-setup'];

// A bucket a purchase or a refund can be listed by.
const isListed = (to: string): to is 'needs' | 'wants' | 'wishlist' => to === 'needs' || to === 'wants' || to === 'wishlist';

export function cardStatementView(input: StatementInput): StatementView {
  const { statement, before, book } = input;
  const card = statement.card;
  if (card !== 'everyday-card' && card !== 'second-card') throw new MoneyError('bad-card', `not a card used day to day: ${String(card)}`);
  checkStatement(statement);
  if (before !== null) {
    checkStatement(before);
    if (before.card !== card) throw new MoneyError('bad-statement', 'the statement before is of another card');
    if (daysBetween(before.closingDate, statement.closingDate) <= 0) throw new MoneyError('bad-statement', 'the statement before must have closed earlier');
  }
  const from = addDays(before === null ? monthBefore(statement.closingDate) : before.closingDate, 1);
  const inDays = (day: IsoDate): boolean => daysBetween(from, day) >= 0 && daysBetween(day, statement.closingDate) >= 0;
  const postedOn = (id: string, own: IsoDate): IsoDate => {
    const day = input.postedOn?.(id) ?? own;
    assertIsoDate(day, 'posted day');
    return day;
  };

  const lines: Line[] = [];
  const entries = book === null ? [] : book.cardEntries(card);
  const charges = new Map(entries.flatMap((e) => (e.kind === 'charge' ? [[e.id, e] as const] : [])));
  for (const entry of entries) {
    // What it put on the card when it posted, and where that is counted now.
    const amount = entry.takenBack === null ? entry.owes : entry.takenBack.owed;
    const pieces = piecesOf(entry, amount, charges);
    if (entry.posted !== null) {
      const day = postedOn(entry.posted.id, entry.posted.date);
      if (inDays(day)) lines.push({ item: { id: entry.id, date: entry.date, postedOn: day, description: entry.description }, pieces });
    }
    if (entry.takenBack !== null) {
      const t = entry.takenBack;
      const day = postedOn(t.id, t.date);
      if (inDays(day)) lines.push({ item: { id: t.id, date: t.date, postedOn: day, description: entry.description }, pieces: pieces.map((p) => ({ where: p.where, amount: -p.amount })) });
    }
  }
  for (const h of input.beforeSetup ?? []) {
    assertIsoDate(h.date, 'day');
    assertCents(h.amount, 'amount');
    if (inDays(postedOn(h.id, h.postedOn))) lines.push({ item: { id: h.id, date: h.date, postedOn: h.postedOn, description: h.description }, pieces: [{ where: h.payment ? 'credit' : 'before-setup', amount: h.amount }] });
  }
  lines.sort((a, b) => daysBetween(b.item.postedOn, a.item.postedOn) || daysBetween(b.item.date, a.item.date));

  const itemsIn = (keep: (p: Piece) => boolean, of: readonly Line[] = lines): StatementItem[] =>
    of.flatMap((line) => {
      const kept = line.pieces.filter(keep);
      return kept.length === 0 ? [] : [{ ...line.item, amount: addCents(...kept.map((p) => p.amount)) }];
    });
  const total = (items: readonly StatementItem[]): Cents => addCents(...items.map((i) => i.amount));

  const byBucket = BUCKET_ORDER.flatMap((bucket) => {
    const items = itemsIn((p) => p.where === bucket);
    return items.length === 0 ? [] : [{ bucket, total: total(items), items }];
  });
  const periods = book === null ? [] : periodsOf(book);
  const periodOf = (day: IsoDate): StatementPeriod | undefined => periods.findLast((p) => daysBetween(p.startDate, day) >= 0) ?? periods[0];
  const beforeSetup = itemsIn((p) => p.where === 'before-setup');
  const byPayPeriod = [
    ...(beforeSetup.length === 0 ? [] : [{ period: 'before-setup' as const, total: total(beforeSetup), items: beforeSetup }]),
    ...periods.flatMap((period) => {
      const items = itemsIn(
        (p) => p.where !== 'before-setup' && p.where !== 'credit',
        lines.filter((line) => periodOf(line.item.date) === period),
      );
      return items.length === 0 ? [] : [{ period, total: total(items), items }];
    }),
  ];
  const credits = itemsIn((p) => p.where === 'credit');
  const charged = addCents(...byBucket.map((g) => g.total));
  const paymentsAndCredits = total(credits);
  const carriedIn: CarriedIn =
    before === null
      ? { kind: 'before-the-app', amount: subtractCents(statement.statementBalance, charged) }
      : { kind: 'from-statement-before', before: before.statementBalance, paymentsAndCredits, amount: addCents(before.statementBalance, paymentsAndCredits), items: credits };
  return {
    card,
    closingDate: statement.closingDate,
    dueDate: statement.dueDate,
    statementBalance: statement.statementBalance,
    minimumPayment: statement.minimumPayment,
    from,
    carriedIn,
    byBucket,
    byPayPeriod,
    charges: charged,
    notMatched: subtractCents(subtractCents(statement.statementBalance, carriedIn.amount), charged),
  };
}

// Where each part of what an entry put on the card is counted now (HB15). A
// charge pending on setup day: the part setup day counted is from before
// setup day, the rest is under its bucket. A split: each part under its
// bucket; a part a refund already took is under the first part, as that
// refund is. A refund: under the bucket its purchase is in now (all of a
// split's parts when it is the whole of what is left), or as it is sorted
// itself; one sorted to neither needs, wants nor Wishlist is a credit, like a
// payment.
function piecesOf(entry: CardEntry, amount: Cents, charges: ReadonlyMap<string, Extract<CardEntry, { kind: 'charge' }>>): Piece[] {
  if (entry.kind === 'payment') return nonZero([{ where: 'credit', amount }]);
  if (entry.kind === 'charge') {
    const rest = subtractCents(amount, entry.atSetup);
    return nonZero([{ where: 'before-setup', amount: entry.atSetup }, ...spread(entry.sortedTo, rest)]);
  }
  if (entry.refundOf !== null) {
    const of = charges.get(entry.refundOf);
    return nonZero(of === undefined ? [{ where: 'unsorted', amount }] : spread(of.sortedTo, amount, true));
  }
  const to = entry.sortedTo;
  return nonZero([{ where: to === 'unsorted' || isListed(to) ? to : 'credit', amount }]);
}

// An amount spread as a spending sort spreads it.
function spread(sorted: SpendingSort, amount: Cents, refund = false): Piece[] {
  if ('split' in sorted) {
    const parts = sorted.split.map((part): Piece => ({ where: isListed(part.bucket) ? part.bucket : 'unsorted', amount: part.amount }));
    const sum = addCents(...parts.map((p) => p.amount));
    const [first, ...others] = parts;
    if (first === undefined) return [{ where: 'unsorted', amount }];
    // All of a split refunded at once gives each part back (4.5).
    if (refund && -amount === sum) return parts.map((p) => ({ where: p.where, amount: -p.amount }));
    if (refund) return [{ where: first.where, amount }];
    return [{ where: first.where, amount: addCents(first.amount, subtractCents(amount, sum)) }, ...others];
  }
  if (isListed(sorted.to)) return [{ where: sorted.to, amount }];
  if (sorted.to === 'counted-at-setup') return [{ where: 'before-setup', amount }];
  return [{ where: 'unsorted', amount }];
}

function nonZero(pieces: Piece[]): Piece[] {
  return pieces.filter((p) => p.amount !== 0);
}

// The books' pay periods, oldest first.
function periodsOf(book: Book): StatementPeriod[] {
  return Array.from({ length: book.period().number + 1 }, (_, number) => ({ number, startDate: book.periodSummary(number).startDate }));
}

// The same day a month before; in a month too short for it, that month's
// last day (as 9.8 counts a closing day).
function monthBefore(date: IsoDate): IsoDate {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  const before = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const last = lastDayOfMonth(before);
  return Number(last.slice(8)) < day ? last : `${before}-${String(day).padStart(2, '0')}`;
}

function checkStatement(s: CardStatement): void {
  assertIsoDate(s.closingDate, 'statement date');
  assertIsoDate(s.dueDate, 'due date');
  assertCents(s.statementBalance, 'statement balance');
  assertCents(s.minimumPayment, 'minimum payment');
}

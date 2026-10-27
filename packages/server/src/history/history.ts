import { MoneyError, startTracking, type BankTransaction, type Book, type Cents, type IsoDate, type SetupInput, type WishlistChange } from '@budget-app/money';
import type { AlertsEvent } from '../alerts/plan.js';
import type { BankRuleLogLine } from '../views/bank-rules.js';
import type { FoundAnswer } from '../views/rule-finder.js';

// The book's history (Step 1 of the real server): what the bank sent and
// every answer of his, in the order it happened. The book is rebuilt from it,
// one event at a time, and the money math has no clock and no chance in it,
// so the same history always gives the same book. Each event keeps the date
// it was made on, inside it; replaying never asks the clock.
//
// After each event the totals the book had are saved with it. When the
// server starts, it replays the history and compares: if any event gives
// different totals now, a change to the code would rewrite the past, so the
// server does not start, and says at which event.

// The book's methods that change it in answer to him. Every other method
// only reads it.
export const BOOK_ANSWERS = ['sort', 'sortAlways', 'answerLeftover', 'acknowledge', 'moveMoney', 'changeSettings', 'addRule', 'changeRule', 'removeRule', 'moveRule'] as const;
export type BookAnswer = (typeof BOOK_ANSWERS)[number];

// One call to the book, exactly as it was made: the method and what it was given.
export interface BookCall {
  readonly method: BookAnswer;
  readonly args: readonly unknown[];
}

// His Setup day answers before tracking starts, as they stand after an
// event (setup-view.ts SetupAnswers, with its maps as lists).
export interface SavedSetupAnswers {
  readonly onItsWay: readonly (readonly [string, boolean])[];
  readonly halvesWithinDays: number | null;
  readonly lastPaycheckDate: IsoDate | null;
  readonly assignment: Readonly<Record<string, Cents>>;
  readonly suggestions: readonly (readonly [string, { readonly answer: string; readonly ruleId: string | null }])[];
  // Her rulebook, 53.1: her answers to the rule finder; none before it existed.
  readonly found?: readonly (readonly [string, FoundAnswer])[];
}

// One answer of his. Each part is there when the answer did it.
export interface Answer {
  // What it did to the book, in order.
  readonly book?: readonly BookCall[];
  // 10.6: a take-back he marked seen (B84).
  readonly seen?: string;
  // Section 2, 24c: a change to the bank rules, as its change log line. The
  // rules themselves are kept in the settings table too, written in the same step.
  readonly bankRules?: readonly BankRuleLogLine[];
  // Setup day, before tracking starts: his answers as they stand after it.
  readonly setup?: SavedSetupAnswers;
  // Her rulebook, 50.1 to 50.3: changes to her Wishlist list (wishlist-items.ts).
  readonly wishlist?: readonly WishlistChange[];
}

export type HistoryEvent =
  | { readonly kind: 'setup'; readonly input: SetupInput }
  | { readonly kind: 'receive'; readonly txn: BankTransaction }
  | { readonly kind: 'answer'; readonly answer: Answer }
  // Phase 5: alerts the server worked out (alerts/plan.ts), so a restart
  // knows every alert that went out and never gives one twice. They change
  // nothing in the book.
  | { readonly kind: 'alerts'; readonly alerts: AlertsEvent };

// What is checked after each event: every bucket, the money waiting in
// review both ways, the old card debt, money in transit, and how many items
// wait in review. Null before setup day.
export interface Totals {
  readonly savings: Cents;
  readonly needs: Cents;
  readonly wants: Cents;
  readonly momReserve: Cents;
  readonly heldForOthers: Cents;
  readonly unsortedIn: Cents;
  readonly unsortedOut: Cents;
  readonly oldCardDebt: Cents;
  readonly inTransit: Cents;
  readonly waiting: number;
}

// Her rulebook, section 2: with Wishlist too, where the setup has it.
export type HerTotals = Totals & { readonly wishlist?: Cents };

export function totalsOf(book: Book | null): Totals | null {
  if (book === null) return null;
  const p = book.pots();
  return {
    savings: p.savings,
    needs: p.needs,
    wants: p.wants,
    momReserve: p.momReserve,
    heldForOthers: p.heldForOthers,
    ...(p.wishlist === undefined ? {} : { wishlist: p.wishlist }),
    unsortedIn: p.unsortedIn,
    unsortedOut: p.unsortedOut,
    oldCardDebt: book.oldCardDebt(),
    inTransit: book.inTransit().total,
    waiting: book.reviewItems().length,
  };
}

export function sameTotals(a: Totals | null, b: Totals | null): boolean {
  if (a === null || b === null) return a === b;
  const x = a as HerTotals;
  const y = b as HerTotals;
  return (Object.keys(x) as (keyof HerTotals)[]).every((key) => x[key] === y[key]) && Object.keys(y).length === Object.keys(x).length;
}

// ----- Recording what an answer did -----

// The book, as the desks use it, with every change made through it written
// down while a recording is on. A change the book refuses (it throws, and
// changes nothing) is not written down, nor a hand move that only asks first.
export interface Recorder {
  readonly book: Book;
  // Starts writing down; whatever was written before is dropped.
  start(): void;
  // What was written down since start, and stops.
  take(): BookCall[];
}

export function recorderOf(book: Book): Recorder {
  let calls: BookCall[] | null = null;
  const answers: readonly string[] = BOOK_ANSWERS;
  const proxy = new Proxy(book, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (typeof prop !== 'string' || !answers.includes(prop)) return (value as (...a: unknown[]) => unknown).bind(target);
      return (...args: unknown[]): unknown => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        const changed = prop !== 'moveMoney' || (result as { moved: boolean }).moved;
        if (changed && calls !== null) calls.push({ method: prop as BookAnswer, args: JSON.parse(JSON.stringify(args)) as unknown[] });
        return result;
      };
    },
  });
  return {
    book: proxy,
    start: () => {
      calls = [];
    },
    take: () => {
      const taken = calls ?? [];
      calls = null;
      return taken;
    },
  };
}

// ----- Replaying -----

export class ReplayFailed extends Error {}

// Gives the book one call again, exactly as it was made. A call the book
// refuses now, or a hand move that now only asks, is a replay that failed.
export function replayCall(book: Book, call: BookCall): void {
  if (!(BOOK_ANSWERS as readonly string[]).includes(call.method)) throw new ReplayFailed(`the book has no answer called ${String(call.method)}`);
  const method = (book as unknown as Record<string, (...args: unknown[]) => unknown>)[call.method];
  if (method === undefined) throw new ReplayFailed(`the book has no answer called ${call.method}`);
  let result: unknown;
  try {
    result = method.apply(book, [...call.args]);
  } catch (error) {
    if (error instanceof MoneyError) throw new ReplayFailed(`the book refuses ${call.method} now: ${error.message}`);
    throw error;
  }
  if (call.method === 'moveMoney' && !(result as { moved: boolean }).moved) throw new ReplayFailed('the hand move asks to be confirmed now');
}

// The book after setup day: what startTracking makes of what was saved.
export function bookOfSetup(input: SetupInput): Book {
  const setup = startTracking(input);
  if (!setup.ok) throw new ReplayFailed('setup day in the history does not add up');
  return setup.book;
}

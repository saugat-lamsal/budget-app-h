import {
  addCents,
  addDays,
  commonPlaceWords,
  daysBetween,
  findRule,
  matchesTextRule,
  paydaysBefore,
  placeName,
  subtractCents,
  type AccountId,
  type BankBalances,
  type Book,
  type Cents,
  type IsoDate,
  type SortingRule,
  type TextRule,
} from '@budget-app/money';
import { readBankItem, type BankRule } from './bank/reading.js';
import { futureOf } from './trends-future.js';
import { habitsOf } from './trends-habits.js';
import { bankCheckOf } from './views/buckets.js';
import type { WhyLine } from './views/home.js';
import type { DayPoint, EvenPace, PlaceGroup, SavingsPoint, TrendsItem, TrendsNow, TrendsPart, TrendsPeriod, TrendsView, Usual, WantsPace } from './views/trends.js';

// The Trends tab (rulebook section 40, QUESTIONS.md A58): what the books
// already hold, over time, and the bank history kept from before setup day,
// read for this tab only by today's rules. It only reads: nothing here
// changes the books or the history (0.6), and nothing leaves the server. It
// reads no database, so the demo can use it too (the Keeper hands it the
// history: trends-db.ts).

// 40.4, 40.6: how far back "the last 90 days" goes, today included.
export const TRENDS_DAYS = 90;
// 40.6: the biggest places named; the rest are "everything else".
export const TOP_PLACES = 5;
// 40.7: your usual is the middle one of the last 5 full pay periods, and needs at least 3.
export const USUAL_PERIODS = 5;
export const USUAL_AT_LEAST = 3;

// One item the bank sent before setup day that is in the starting money:
// posted and kept, or still pending on setup day at the amount setup day
// counted (14.2).
export interface HistoryLine {
  readonly id: string;
  readonly account: AccountId;
  // Plaid's sign: positive is money out of the account.
  readonly amount: Cents;
  readonly date: IsoDate;
  readonly description: string;
}

export interface BeforeSetup {
  readonly setupDay: IsoDate;
  // The last paycheck he gave on setup day: the pay period setup day fell in began then (40.3).
  readonly lastPaycheckDate: IsoDate;
  // The first day of the bank history (the 90 days asked for at connection, section 2).
  readonly historyFrom: IsoDate;
  readonly lines: readonly HistoryLine[];
  // His bank rules as they are now.
  readonly bankRules: readonly BankRule[];
}

export interface TrendsInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  // Today's balances as the bank reports them (12.1); null when the bank cannot be read.
  readonly bank: BankBalances | null;
  readonly madeUpData: boolean;
  readonly catchingUp?: boolean;
  readonly why?: readonly WhyLine[] | null;
  // Null when the app keeps no bank history from before setup day (the demo).
  readonly before: BeforeSetup | null;
}

// ----- 40.1, 40.2: before setup day, read by today's rules -----

// What kind of rule could name the place of an item before setup day (13.8):
// purchases and money back on a card, and payments to people.
type PlaceKind = 'purchase' | 'person';

export interface ReadBefore {
  readonly part: TrendsPart;
  // Spent: positive; money back makes it negative.
  readonly amount: Cents;
  readonly placeKind: PlaceKind | null;
}

// How the books would take one item today with no answer from him: the bank
// rules say what it is, the sorting rules, the mom rule and the rest of the
// rulebook where it goes. What would wait in review is unsorted; what is not
// spending (money in, transfers, mom, the old card's own debt, money back no
// rule sorts, which would wait as money in) is null.
export function readBeforeSetup(line: HistoryLine, rules: { readonly rules: readonly SortingRule[]; readonly momRule: TextRule | null; readonly bankRules: readonly BankRule[] }): ReadBefore | null {
  const reading = readBankItem(line.account, line.amount, line.description, rules.bankRules);
  const spent = (part: TrendsPart, placeKind: PlaceKind | null): ReadBefore => ({ part, amount: line.amount, placeKind });
  switch (reading.kind) {
    case 'purchase': {
      // 5.4: a new purchase on the old card raises its debt; no bucket.
      if (line.account === 'old-card') return null;
      // 4.9: money leaving savings always waits in review.
      if (line.account === 'savings') return spent('unsorted', null);
      const rule = findRule(rules.rules, 'purchase', line.description);
      return spent(rule === undefined ? 'unsorted' : rule.bucket, 'purchase');
    }
    case 'refund': {
      if (line.account === 'old-card') return null;
      // 4.5: money back counts against the bucket its rule sorts it to; with no rule it waits as money in.
      const rule = findRule(rules.rules, 'purchase', line.description);
      return rule === undefined ? null : spent(rule.bucket, 'purchase');
    }
    case 'card-charge':
      // 4.8: on the everyday card it waits in review; on the old card it is debt (5.5).
      return line.account === 'old-card' ? null : spent('unsorted', null);
    case 'payment-to-person': {
      // 8.1, 7.4, 7.6.
      if (matchesTextRule(rules.momRule, line.description)) return null;
      const rule = findRule(rules.rules, 'person', line.description);
      if (rule === undefined) return spent('unsorted', 'person');
      return rule.choice.to === 'needs' || rule.choice.to === 'wants' ? spent(rule.choice.to, 'person') : null;
    }
    case 'transfer-sent':
      // 5.2: to the old card from checking, out of needs; from savings it waits in review.
      if (reading.to !== 'old-card') return null;
      return spent(line.account === 'checking' ? 'old-card' : 'unsorted', null);
    case 'deposit':
    case 'transfer-arrived':
    case 'nothing':
      return null;
  }
}

// ----- Pay periods (40.3) -----

interface Building {
  startDate: IsoDate;
  lastDay: IsoDate;
  current: boolean;
  cutOff: boolean;
  hasBefore: boolean;
  hasBooks: boolean;
  items: TrendsItem[];
}

const PARTS: readonly TrendsPart[] = ['needs', 'wants', 'old-card', 'unsorted', 'wishlist'];
// Her rulebook, 40.2 and 40.4: Wishlist's part only where the setup has it.
const partsIn = (wishlist: boolean): readonly TrendsPart[] => (wishlist ? PARTS : PARTS.filter((part) => part !== 'wishlist'));

function newest(a: TrendsItem, b: TrendsItem): number {
  return daysBetween(a.date, b.date) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) || PARTS.indexOf(a.part) - PARTS.indexOf(b.part);
}

function finish(p: Building, parts: readonly TrendsPart[]): TrendsPeriod {
  const spent = Object.fromEntries(parts.map((part) => [part, addCents(0, ...p.items.filter((i) => i.part === part).map((i) => i.amount))])) as Record<TrendsPart, Cents>;
  return Object.freeze({
    startDate: p.startDate,
    lastDay: p.lastDay,
    current: p.current,
    cutOff: p.cutOff,
    full: !p.current && !p.cutOff,
    beforeSetup: p.hasBefore && p.hasBooks ? 'part' : p.hasBefore ? 'all' : 'none',
    spent: Object.freeze(spent),
    total: addCents(0, ...parts.map((part) => spent[part])),
    items: Object.freeze([...p.items].sort(newest)),
  });
}

// Day 1 is the pay period's first day; anything dated before it counts on day 1 (40.7, 40.8).
function dayIn(start: IsoDate, date: IsoDate): number {
  return Math.max(1, daysBetween(start, date) + 1);
}

// 40.7: the middle one; of an even number, the average of the middle two, rounded down to the cent.
export function middleOf(values: readonly Cents[]): Cents {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[half] as Cents;
  // In whole cents, without going past what a number holds: halved toward
  // zero, then one less when a negative sum was odd.
  const both = BigInt(sorted[half - 1] as Cents) + BigInt(sorted[half] as Cents);
  const halved = both / 2n;
  return Number(both < 0n && both % 2n !== 0n ? halved - 1n : halved);
}

export function trendsView(input: TrendsInput): TrendsView {
  const { today, book, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };
  const before = input.before;
  const settings = book.settings();
  const current = book.period();
  const next = book.safeToSpend(today).nextPayday;
  const setupDay = book.periodSummary(0).startDate;
  const wishlist = book.switches().wishlist === 'on';

  // ----- The books' pay periods -----
  const books: Building[] = [];
  for (let n = 0; n <= current.number; n += 1) {
    const summary = book.periodSummary(n);
    const isCurrent = n === current.number;
    const lastDay = summary.endDate === null ? (daysBetween(today, next) > 0 ? addDays(next, -1) : today) : addDays(summary.endDate, -1);
    // Her rulebook, 40.2: and what each item spent out of Wishlist, its own part.
    const spent = wishlist ? [...book.spentIn(n), ...book.wishlistSpentIn(n)] : book.spentIn(n);
    const items: TrendsItem[] = spent.map((s) => ({
      id: s.id,
      date: s.date,
      description: s.description,
      account: s.account,
      part: s.pot === 'needs' && s.kind === 'debt-payoff' ? 'old-card' : s.pot,
      amount: s.amount,
      beforeSetup: false,
    }));
    // 4.3, 40.2: spending waiting in review, in the current pay period until it is sorted.
    if (isCurrent) {
      for (const detail of book.reviewDetails()) {
        const item = detail.item;
        if (item.type !== 'spending') continue;
        items.push({ id: item.id, date: item.date, description: item.description, account: detail.account, part: 'unsorted', amount: item.amount, beforeSetup: false });
      }
    }
    // With no history from before setup day, the first pay period began on setup day, not a payday: cut off.
    books.push({ startDate: summary.startDate, lastDay, current: isCurrent, cutOff: n === 0 && before === null, hasBefore: false, hasBooks: true, items });
  }

  // ----- Before setup day (40.1, 40.3) -----
  const placeKinds = new Map<string, { readonly kind: PlaceKind | null; readonly line: HistoryLine }>();
  let all: Building[] = books;
  if (before !== null) {
    const first = books[0] as Building;
    first.startDate = before.lastPaycheckDate;
    first.cutOff = daysBetween(before.historyFrom, before.lastPaycheckDate) < 0;
    const earlier: Building[] = [];
    if (!first.cutOff) {
      let end = before.lastPaycheckDate;
      let guard = 0;
      for (const start of paydaysBefore(before.lastPaycheckDate, settings)) {
        earlier.unshift({ startDate: start, lastDay: addDays(end, -1), current: false, cutOff: daysBetween(before.historyFrom, start) < 0, hasBefore: true, hasBooks: false, items: [] });
        end = start;
        guard += 1;
        if (daysBetween(start, before.historyFrom) >= 0 || guard > 10_000) break;
      }
    }
    all = [...earlier, ...books];
    const rules = { rules: book.rules(), momRule: settings.momRule, bankRules: before.bankRules };
    for (const line of before.lines) {
      const read = readBeforeSetup(line, rules);
      // Dated before the oldest pay period: outside the history.
      const period = [first, ...earlier.slice().reverse()].find((p) => daysBetween(p.startDate, line.date) >= 0);
      placeKinds.set(line.id, { kind: read?.placeKind ?? placeKindOf(line, rules), line });
      if (read === null || period === undefined) continue;
      period.hasBefore = true;
      period.items.push({ id: line.id, date: line.date, description: line.description, account: line.account, part: read.part, amount: read.amount, beforeSetup: true });
    }
  }
  const periods = all.map((p) => finish(p, partsIn(wishlist)));

  // ----- 40.4: the last 90 days, and the current one -----
  const from = addDays(today, -(TRENDS_DAYS - 1));
  const shown = periods.filter((p) => p.current || daysBetween(from, p.lastDay) >= 0);
  // 40.6, 40.16: the place of an item.
  const nameOf = (item: TrendsItem): string | null => (item.beforeSetup ? nameBefore(item, placeKinds) : book.placeName(item.id));

  return {
    state: 'tracking',
    madeUpData,
    today,
    setupDay,
    historyFrom: before?.historyFrom ?? null,
    check: bankCheckOf(book, input.bank, input.catchingUp ?? false, input.why ?? null),
    periods: Object.freeze(shown),
    savings: savingsOf(book, today),
    places: placesOf(book, periods, placeKinds, from, today),
    now: nowOf(book, periods, today, next),
    future: futureOf({ book, today, next, periods, bookStarts: books.map((b) => b.startDate), setupDay }),
    habits: habitsOf({ book, today, from, periods, shown, nameOf }),
  };
}

// The kind of place an item before setup day would have, read or not (13.8
// counts every one of that kind on that account for its common words).
function placeKindOf(line: HistoryLine, rules: { readonly bankRules: readonly BankRule[] }): PlaceKind | null {
  const reading = readBankItem(line.account, line.amount, line.description, rules.bankRules);
  if ((reading.kind === 'purchase' || reading.kind === 'refund') && line.account !== 'savings') return 'purchase';
  return reading.kind === 'payment-to-person' ? 'person' : null;
}

// ----- 40.5: savings over time -----

function savingsOf(book: Book, today: IsoDate): readonly SavingsPoint[] {
  const points: SavingsPoint[] = [];
  const first = book.periodSummary(0);
  // Her rulebook, 40.5: Wishlist beside savings, its own amount, where the setup has it.
  const wishlist = (pots: { readonly wishlist?: Cents }): { readonly wishlist?: Cents } => (pots.wishlist === undefined ? {} : { wishlist: pots.wishlist });
  points.push({ date: first.startDate, at: 'start', savings: first.opening.savings, momReserve: first.opening.momReserve, ...wishlist(first.opening) });
  for (let n = 0; n < book.period().number; n += 1) {
    const s = book.periodSummary(n);
    if (s.endDate !== null) points.push({ date: addDays(s.endDate, -1), at: 'end', savings: s.closing.savings, momReserve: s.closing.momReserve, ...wishlist(s.closing) });
  }
  const pots = book.pots();
  points.push({ date: today, at: 'now', savings: pots.savings, momReserve: pots.momReserve, ...wishlist(pots) });
  return Object.freeze(points.map((p) => Object.freeze(p)));
}

// ----- 40.6: where it went -----

function placesOf(book: Book, periods: readonly TrendsPeriod[], kinds: ReadonlyMap<string, { readonly kind: PlaceKind | null; readonly line: HistoryLine }>, from: IsoDate, to: IsoDate): Extract<TrendsView, { state: 'tracking' }>['places'] {
  const items = periods.flatMap((p) => p.items).filter((i) => daysBetween(from, i.date) >= 0 && daysBetween(i.date, to) >= 0);
  const named = new Map<string, { name: string; items: TrendsItem[] }>();
  const oldCard: TrendsItem[] = [];
  const nameless: TrendsItem[] = [];
  for (const item of [...items].sort(newest)) {
    if (item.part === 'old-card') {
      oldCard.push(item);
      continue;
    }
    const name = item.beforeSetup ? nameBefore(item, kinds) : book.placeName(item.id);
    if (name === null) {
      nameless.push(item);
      continue;
    }
    const key = name.toLowerCase();
    const group = named.get(key) ?? { name, items: [] };
    group.items.push(item);
    named.set(key, group);
  }
  const total = (list: readonly TrendsItem[]): Cents => addCents(0, ...list.map((i) => i.amount));
  const groups: PlaceGroup[] = [...named.values()].map((g) => ({ kind: 'place' as const, name: g.name, amount: total(g.items), items: g.items }));
  if (oldCard.length > 0) groups.push({ kind: 'old-card', name: '', amount: total(oldCard), items: oldCard });
  groups.sort((a, b) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const top = groups.slice(0, TOP_PLACES);
  const rest = [...groups.slice(TOP_PLACES).flatMap((g) => g.items), ...nameless].sort(newest);
  if (rest.length > 0) top.push({ kind: 'everything-else', name: '', amount: total(rest), items: rest });
  return Object.freeze({ from, to, total: total(items), groups: Object.freeze(top.map((g) => Object.freeze({ ...g, items: Object.freeze(g.items) }))) });
}

// 13.8 for an item before setup day: the words on most of his items of that
// kind on that account on its day and in the 90 days before are not a name.
function nameBefore(item: TrendsItem, kinds: ReadonlyMap<string, { readonly kind: PlaceKind | null; readonly line: HistoryLine }>): string | null {
  const own = kinds.get(item.id);
  if (own === undefined || own.kind === null) return null;
  const near: string[] = [];
  for (const other of kinds.values()) {
    if (other.kind !== own.kind || other.line.account !== own.line.account) continue;
    const days = daysBetween(other.line.date, own.line.date);
    if (days >= 0 && days <= TRENDS_DAYS) near.push(other.line.description);
  }
  return placeName(own.line.description, commonPlaceWords(near));
}

// ----- 40.7, 40.8: now -----

function nowOf(book: Book, periods: readonly TrendsPeriod[], today: IsoDate, next: IsoDate): TrendsNow {
  const here = periods[periods.length - 1] as TrendsPeriod;
  const day = dayIn(here.startDate, today);
  // Her rulebook (HB27): Wishlist is not in it either; 40.7 stays on needs and wants.
  const planned = (i: TrendsItem): boolean => i.part !== 'old-card' && i.part !== 'wishlist';
  const spentSoFar = addCents(0, ...here.items.filter(planned).map((i) => i.amount));
  const full = periods.filter((p) => p.full).slice(-USUAL_PERIODS);
  const usual: Usual =
    full.length < USUAL_AT_LEAST
      ? { state: 'not-enough', fullPeriods: full.length }
      : {
          state: 'known',
          periods: full.length,
          byToday: middleOf(full.map((p) => addCents(0, ...p.items.filter((i) => planned(i) && dayIn(p.startDate, i.date) <= day).map((i) => i.amount)))),
          whole: middleOf(full.map((p) => addCents(0, ...p.items.filter(planned).map((i) => i.amount)))),
        };
  return { startDate: here.startDate, day, spentSoFar, usual, wants: wantsPaceOf(book, today, next) };
}

// 40.8: at the end of day n of D, an even pace leaves startedWith x (D - n) / D, rounded down to the cent.
export function evenPace(startedWith: Cents, days: number, day: number): Cents {
  if (day >= days) return 0;
  const left = (BigInt(startedWith) * BigInt(days - day)) / BigInt(days);
  return Number(left);
}

function wantsPaceOf(book: Book, today: IsoDate, next: IsoDate): WantsPace {
  const number = book.period().number;
  const startDate = book.periodSummary(number).startDate;
  const rows = book.activity('wants', number).rows;
  const left = book.pots().wants;
  const startedWith = book.startedPeriodWith().wants;
  const day = dayIn(startDate, today);
  const days = daysBetween(startDate, next);
  const line: DayPoint[] = [];
  for (let k = 1; k <= day; k += 1) {
    const after = rows.filter((r) => dayIn(startDate, r.date) > k).map((r) => r.amount);
    line.push({ date: addDays(startDate, k - 1), day: k, left: subtractCents(left, addCents(0, ...after)) });
  }
  let pace: EvenPace;
  if (startedWith <= 0) pace = { state: 'none', why: 'started-at-or-below-zero' };
  else {
    const points: DayPoint[] = [];
    for (let k = 1; k <= Math.max(day, days); k += 1) points.push({ date: addDays(startDate, k - 1), day: k, left: evenPace(startedWith, days, k) });
    const todayPace = evenPace(startedWith, days, day);
    pace = { state: 'pace', points: Object.freeze(points), today: todayPace, difference: subtractCents(left, todayPace) };
  }
  return { startDate, nextPayday: next, day, days, startedWith, left, line: Object.freeze(line), pace };
}

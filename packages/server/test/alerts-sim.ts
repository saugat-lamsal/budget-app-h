import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, daysBetween, type BankTransaction, type CardPayment, type CardStatement, type Cents, type IsoDate, type SetupInput } from '@budget-app/money';
import { expect } from 'vitest';
import type { Posted } from '../../money/test/sim/bank.js';
import { liveALife, type DayStep, type ExpectedAlert, type RecordedAnswer, type RecordedBankDay } from '../../money/test/sim/life.js';
import { alertKey, type AlertFacts, type Card } from '../src/alerts/alerts.js';
import { readOutbox } from '../src/alerts/outbox.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { readAccounts, readItems, saveItem } from '../src/db/store.js';
import { readPlaidItem } from '../src/bank/plaid-item.js';
import { readBankItem } from '../src/bank/reading.js';
import { rolesOf } from '../src/bank/stored-account.js';
import { bookOfSetup, replayCall, totalsOf, type BookCall } from '../src/history/history.js';
import { appendEvent, readHistory } from '../src/history/history-db.js';
import { Keeper, type SyncBank } from '../src/history/keeper.js';
import { instantIn, timeIn, todayIn } from '../src/history/today.js';
import { memoryLog } from '../src/log.js';
import type { AlertTimer } from '../src/serve/alert-timer.js';
import { serveBooks } from '../src/serve/serving.js';
import { planSync, type Plan, type PlanInput } from '../src/sync/plan.js';
import { FakeClock } from './fake-clock.js';
import { newPushKeys } from '../src/push/push-keys.js';
import { FakePushService } from './fake-push-service.js';
import { loginForTests } from './login-for-tests.js';
import { connected, type Harness } from './harness.js';
import { ACCOUNT, SIM_BANK_RULES, inPlaidFormat } from './sim-bank.js';

// Phase 5: the simulated you (Phase 2) through the real server, with its
// alerts. The simulator lives its life and works out on its own, from the
// rulebook, which alerts are due after each step of each day (setup day, each
// sync, each answer, the evening at the daily review time). The real server
// lives the same days on a clock the test moves: the bank's activity reaches
// it only by syncs with the made-up bank (what the bank shows, its balances and
// its card statements), each answer is saved in its history, and its own
// alert timer works the alerts out, keeps them, and sends them through the
// real sender (web push) to a test phone at the made-up push service.
// What its book is given is the simulator's own (the sync's test seam), so the
// two books are the same.
//
// On top of the simulator's alerts, this works out from the rulebook what the
// server must do when things go wrong, with its own arithmetic (9.3, 9.6 for
// the cards, 10.8 for quiet hours), never the server's:
// - quiet hours (10.8, A35): nothing reaches the phone from 10:00 PM to 7:00
//   AM; what comes due then goes at 7:00 AM and says when it was due. Syncs in
//   the night (one server), and a server back at 3:00 AM (restarts);
// - the server down over several evenings (10.9, A36, restarts): when it is
//   back, only the newest of each kind, if still true, each due at its own
//   evening; the bank's activity of the days it was down is read then, in order;
// - the bank wanting a login for days (10.5, A37): told when it starts, then
//   once each evening it lasts, and the days' activity read once he logs in;
// - the bank not read for a day (10.7, A38): the sync failing all day, or the
//   server down, or the login: told once, due when the last good read became
//   24 hours old, cleared by the next good read;
// - the bank's balance drifting for days (10.4, A37): "totals do not match"
//   when a sync first sees it, then once each evening it lasts;
// - the lock screen (10.10, A39): words only, never an amount.
// Every day: every alert expected is kept once, due at its moment, reached the
// phone exactly once, in its window, saying when it was due if it went late,
// and nothing else was kept or sent. In the end the history's facts are the
// expected ones, and every evening was handled once. Two ways: one server for
// months, or the server stopped every night and started every morning.
// ALERT_SIM_SEEDS, ALERT_SIM_FIRST_SEED and ALERT_SIM_YEARS run more lives of
// the second way. Every name and number is made up.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CARDS: readonly Card[] = ['everyday-card', 'old-card'];

interface Day extends RecordedBankDay {
  readonly answers: readonly RecordedAnswer[];
}

interface Lived {
  readonly start: Posted;
  readonly feed: readonly BankTransaction[];
  readonly input: SetupInput;
  readonly days: readonly Day[];
}

function liveAndRecord(seed: number, years: number): Lived {
  let setup: Omit<Lived, 'days'> | undefined;
  const days: Day[] = [];
  let answers: RecordedAnswer[] = [];
  const result = liveALife({
    seed,
    years,
    record: {
      setupDay: (s) => {
        setup = { start: s.start, feed: s.feed, input: s.input };
      },
      day: (day) => {
        days.push({ ...day, answers });
        answers = [];
      },
      answer: (a) => answers.push(a),
    },
  });
  if (!result.ok) throw new Error(`the simulated life failed on its own: seed ${seed}, ${result.date}, ${result.check}: ${result.message}`);
  if (setup === undefined) throw new Error('no setup day was recorded');
  return { ...setup, days };
}

// The simulator's expected alert as the server's facts (the daily review and
// the overdue alert are for the day they come on).
function factsOf(alert: ExpectedAlert, date: IsoDate): AlertFacts {
  switch (alert.kind) {
    case 'daily-review':
      return { kind: 'daily-review', date, waiting: alert.waiting };
    case 'card-overdue':
      return { kind: 'card-overdue', card: alert.card, dueDate: alert.dueDate, minimumPayment: alert.minimumPayment, date };
    default:
      return alert;
  }
}

// A small random number maker of its own, from the seed, for when things go wrong.
function randomFrom(seed: number): (outOf: number) => boolean {
  let state = seed * 2_654_435_761 + 1;
  return (outOf) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % outOf === 0;
  };
}

export type Way = 'one-server' | 'restarts';

// Days when the server cannot have the bank's activity: it is down (from the
// evening before), the bank wants a login, or it cannot be reached. The
// activity of the days from `from` (a day's index), `days` of them, is read
// the morning after: the first good read, then each held-back day in order.
interface Stretch {
  readonly kind: 'down' | 'login' | 'network';
  readonly from: number;
  readonly days: number;
}

// The bank's checking balance off by `cents`, with no transaction to show for
// it, from the morning of day `from` for `days` days.
interface Drift {
  readonly from: number;
  readonly days: number;
  readonly cents: Cents;
}

// When each goes wrong: fixed days, moved a little by the seed, kept apart,
// and only what fits in the life.
function scheduleOf(seed: number, way: Way, length: number): { readonly stretches: readonly Stretch[]; readonly drifts: readonly Drift[] } {
  const s = seed % 5;
  const stretches: Stretch[] =
    way === 'restarts'
      ? [
          // Down from the evening of day 20 to the morning of day 23: the evenings of days 20, 21 and 22.
          { kind: 'down', from: 21 + s, days: 2 },
          { kind: 'network', from: 40 + s, days: 1 },
          { kind: 'login', from: 55 + s, days: 3 },
          { kind: 'down', from: 85 + s, days: 1 },
          { kind: 'down', from: 125 + s, days: 3 },
        ]
      : [
          { kind: 'login', from: 50 + s, days: 2 },
          { kind: 'network', from: 110 + s, days: 1 },
        ];
  const drifts: Drift[] =
    way === 'restarts'
      ? [{ from: 100 + s, days: 3, cents: 12_345 }]
      : [
          { from: 25 + s, days: 4, cents: 12_345 },
          { from: 90 + s, days: 2, cents: -6_789 },
        ];
  const fits = (from: number, days: number): boolean => from >= 2 && from + days + 2 < length;
  return { stretches: stretches.filter((x) => fits(x.from, x.days)), drifts: drifts.filter((x) => fits(x.from, x.days)) };
}

interface Expected {
  readonly facts: AlertFacts;
  readonly dueAt: string;
  // When the phone should show it: from, or by to (a phone that cannot be reached).
  readonly shownBy: { readonly from: number; readonly to: number };
}

// What the books held when the server stopped hearing from the bank: what
// waited in review and what was paid toward each card.
interface Frozen {
  readonly waiting: number;
  readonly payments: Readonly<Record<Card, readonly CardPayment[]>>;
}

export interface Outcome {
  readonly days: number;
  readonly alerts: number;
  readonly late: number;
  readonly restarts: number;
  readonly nightSyncs: number;
  readonly failedSyncs: number;
  readonly logins: number;
  readonly offsets: ReadonlySet<string>;
  // Sent at the end of quiet hours, having come due in them (10.8).
  readonly quietHeld: number;
  // Evenings handled together when the server came back (10.9), the most at once.
  readonly mostEveningsAtOnce: number;
  readonly backInTheNight: number;
  readonly notRead: number;
  readonly loginRepeats: number;
  readonly mismatches: number;
  readonly mismatchRepeats: number;
  readonly heldBackDays: number;
}

export async function throughTheServer(seed: number, years: number, way: Way): Promise<Outcome> {
  const lived = liveAndRecord(seed, years);
  const { input, days } = lived;
  const settings = input.settings;
  const zone = settings.homeTimeZone;
  const reviewTime = settings.dailyReviewTime;
  const at = (date: IsoDate, time: string, plusMs = 0): Date => new Date(instantIn(zone, date, time).getTime() + plusMs);
  const chance = randomFrom(seed);
  const { stretches, drifts } = scheduleOf(seed, way, days.length);
  const stretchOn = (i: number): Stretch | undefined => stretches.find((x) => x.from <= i && i < x.from + x.days);
  const resumingOn = (i: number): Stretch | undefined => stretches.find((x) => x.from + x.days === i);
  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const dir = mkdtempSync(join(tmpdir(), 'budget-alerts-sim-'));
  const path = join(dir, 'books.sqlite');
  const clock = { now: at(input.date, '07:00') };
  const fakeClock = new FakeClock(clock);
  // Phase 5, the phone: the alerts go through the real sender (web push) to
  // the made-up push service on this computer, which checks the app's
  // signature, opens each one with the phone's own keys, and shows it as the
  // phone's service worker would (fake-push-service.ts).
  const keys = newPushKeys('mailto:made-up@example.com');
  const service = await FakePushService.start({ now: () => clock.now, serverKey: keys.publicKey });
  const phone = service.newPhone();
  let subscribed = false;
  let h: Harness | undefined;
  let db: Db | undefined;
  let keeper: Keeper | undefined;
  let alerts: AlertTimer | undefined;
  const expected = new Map<string, Expected>();
  const outcome = {
    days: 0,
    alerts: 0,
    late: 0,
    restarts: 0,
    nightSyncs: 0,
    failedSyncs: 0,
    logins: 0,
    offsets: new Set<string>(),
    quietHeld: 0,
    mostEveningsAtOnce: 0,
    backInTheNight: 0,
    notRead: 0,
    loginRepeats: 0,
    mismatches: 0,
    mismatchRepeats: 0,
    heldBackDays: 0,
  };

  // ----- The rulebook, worked out here on its own -----

  // 10.8: when quiet hours end, if the moment is in them (on his clock).
  const quietEnd = (moment: Date): Date | null => {
    const { from, to } = settings.quietHours;
    if (from === to) return null;
    const local = timeIn(zone, moment);
    const date = local.slice(0, 10);
    const hm = local.slice(11, 16);
    if (from > to) {
      if (hm >= from) return instantIn(zone, addDays(date, 1), to);
      return hm < to ? instantIn(zone, date, to) : null;
    }
    return hm >= from && hm < to ? instantIn(zone, date, to) : null;
  };
  // B201: a tap opens the screen an alert is about: Review for the daily review, the bucket's own list for low and empty, Payday for the payday alert (10.14), Home for the rest.
  const screenOf = (f: AlertFacts): string => (f.kind === 'daily-review' ? '/review' : f.kind === 'low-bucket' || f.kind === 'empty-bucket' ? `/buckets/${f.bucket}` : f.kind === 'payday' ? '/payday' : '/home');
  // B185: "Was due 2:30 AM." (his answer, Oct 11: not "Due" again), with the day when it was another day; nothing when sent in the minute it came due.
  const dueWordsOf = (dueAt: string, shownAt: string): string | null => {
    const due = timeIn(zone, new Date(dueAt));
    const shown = timeIn(zone, new Date(shownAt));
    if (due.slice(0, 16) === shown.slice(0, 16)) return null;
    const hour = Number(due.slice(11, 13));
    const time = `${hour % 12 === 0 ? 12 : hour % 12}:${due.slice(14, 16)} ${hour < 12 ? 'AM' : 'PM'}`;
    const day = new Date(`${due.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `Was due ${due.slice(0, 10) === shown.slice(0, 10) ? '' : `${day}, `}${time}.`;
  };
  // 9.7, B185 (his answer, Oct 11): a card reminder counts the days to the due date from the day it is shown on.
  const reminderTitleOf = (f: Extract<AlertFacts, { kind: 'card-reminder' }>, shownAt: string): string => {
    const left = daysBetween(timeIn(zone, new Date(shownAt)).slice(0, 10), f.dueDate);
    const card = f.card === 'everyday-card' ? 'Everyday card' : 'Old card';
    if (left < 0) return `${card} payment was due ${left === -1 ? 'yesterday' : `${-left} days ago`}`;
    return `${card} payment due ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`}`;
  };
  // 9.3, B28, B47: what is paid toward a statement by a day: payments that
  // reached the card after its closing date (one landing on it counts toward
  // the one before), from the day they left, even while on their way.
  const paidToward = (statement: CardStatement, date: IsoDate, payments: readonly CardPayment[]): Cents =>
    payments
      .filter((p) => {
        const landed = p.landedOn === undefined ? p.date : p.landedOn;
        return (landed === null || daysBetween(statement.closingDate, landed) > 0) && daysBetween(p.date, date) >= 0;
      })
      .reduce((sum, p) => sum + p.amount, 0);
  // 9.1 to 9.4 on one evening: a reminder on a reminder day while not enough
  // is paid (the statement balance on the everyday card, the minimum on the
  // old card, never with nothing owed), the overdue alert each day after the
  // due date while less than the minimum is paid.
  const cardFacts = (date: IsoDate, statement: CardStatement, payments: readonly CardPayment[]): AlertFacts[] => {
    const { card, dueDate, statementBalance, minimumPayment } = statement;
    const paid = paidToward(statement, date, payments);
    const daysLeft = daysBetween(date, dueDate);
    const owed = card === 'everyday-card' ? statementBalance : minimumPayment;
    if (daysLeft < 0) return paid < minimumPayment ? [{ kind: 'card-overdue', card, dueDate, minimumPayment, date }] : [];
    if (!settings.cardReminderDaysBefore.includes(daysLeft) || owed <= 0 || paid >= owed) return [];
    return [{ kind: 'card-reminder', card, dueDate, daysBefore: daysLeft, minimumPayment, statementBalance: card === 'everyday-card' ? statementBalance : null }];
  };
  // 9.6: the card is due (from the first reminder day until paid) or overdue, today.
  const cardNow = (today: IsoDate, statement: CardStatement, payments: readonly CardPayment[]): 'due' | 'overdue' | null => {
    const paid = paidToward(statement, today, payments);
    const daysLeft = daysBetween(today, statement.dueDate);
    if (daysLeft < 0) return paid < statement.minimumPayment ? 'overdue' : null;
    const owed = statement.card === 'everyday-card' ? statement.statementBalance : statement.minimumPayment;
    return daysLeft > Math.max(-1, ...settings.cardReminderDaysBefore) || paid >= owed ? null : 'due';
  };

  // ----- What the server knows, as this test follows it -----

  let running = false;
  // When the server last stopped (restarts), for what it kept and could not send while stopped.
  let stoppedAt: Date | null = null;
  // The next evening the server has not handled (from its first look on).
  let nextEvening: IsoDate = input.date;
  // The last good read of the bank.
  let lastGoodRead: Date | null = null;
  const login = { on: false, times: 0, lastDay: '' as IsoDate };
  const mismatch = { on: false, times: 0, lastDay: '' as IsoDate };
  const notRead = { on: false, times: 0 };
  // The bank's drift as it is at the bank, and as the server last read it.
  let driftAtBank: Cents = 0;
  let driftRead: Cents = 0;
  // 10.4 (A47): the good read that first showed the difference; null while it matches.
  let mismatchSince: Date | null = null;
  let needsLogin = false;
  // The card statements set at the bank, and those a good read has brought.
  let atBank: Partial<Record<Card, CardStatement>> = {};
  let known: Partial<Record<Card, CardStatement>> = {};
  // Days whose activity the server has not had yet, oldest first.
  let held: Day[] = [];
  let frozen: Frozen | null = null;
  let eveningLatest: Date | null = null;
  let where = `seed ${seed} (${way}), setup day`;

  const expectAlert = (facts: AlertFacts, dueAt: Date, givenAt: Date, latest: Date | null = null): void => {
    const key = alertKey(facts);
    if (expected.has(key)) throw new Error(`${where}: ${key} expected twice`);
    const from = quietEnd(givenAt) ?? givenAt;
    if (from.getTime() > givenAt.getTime()) outcome.quietHeld += 1;
    expected.set(key, { facts, dueAt: dueAt.toISOString(), shownBy: { from: from.getTime(), to: Math.max(from.getTime(), latest?.getTime() ?? 0) } });
  };
  const today = (): IsoDate => todayIn(zone, clock.now);

  // The books as they stand, checked against the simulator's end of day `i`.
  const snapshot = (i: number): Frozen => {
    const book = keeper?.book();
    const day = days[i];
    if (book === null || book === undefined || day === undefined) throw new Error(`${where}: no books to hold`);
    expect(book.pots(), `${where}: the books held are the simulator's at the end of ${day.date}`).toEqual(day.pots);
    expect(book.reviewItems().length, `${where}: what waits in the books held`).toBe(day.waiting);
    return { waiting: day.waiting, payments: { 'everyday-card': book.cardPayments('everyday-card'), 'old-card': book.cardPayments('old-card'), 'second-card': book.cardPayments('second-card') } };
  };
  const liveSnapshot = (): Frozen => {
    const book = keeper?.book();
    if (book === null || book === undefined) throw new Error(`${where}: no books`);
    return { waiting: book.reviewItems().length, payments: { 'everyday-card': book.cardPayments('everyday-card'), 'old-card': book.cardPayments('old-card'), 'second-card': book.cardPayments('second-card') } };
  };
  // An evening's alerts from books that stand still: the daily review if something waits, and the cards.
  const eveningFrom = (date: IsoDate, books: Frozen): AlertFacts[] => [
    ...(books.waiting > 0 ? [{ kind: 'daily-review' as const, date, waiting: books.waiting }] : []),
    ...CARDS.flatMap((card) => {
      const statement = known[card];
      return statement === undefined ? [] : cardFacts(date, statement, books.payments[card]);
    }),
  ];
  // 10.4 and 10.5 (A37): once more on an evening they last, not twice a day.
  const lastingAgain = (date: IsoDate): AlertFacts[] => {
    const again: AlertFacts[] = [];
    if (login.on && login.lastDay < date && needsLogin) {
      again.push({ kind: 'bank-login', time: login.times, day: date, again: true });
      login.lastDay = date;
    }
    if (mismatch.on && mismatch.lastDay < date && !needsLogin && driftRead !== 0) {
      again.push({ kind: 'totals-mismatch', time: mismatch.times, difference: driftRead, day: date, again: true });
      mismatch.lastDay = date;
    }
    return again;
  };
  // One evening's alerts: the simulator's when the books are its own, else from the books held.
  const eveningAlerts = (date: IsoDate): AlertFacts[] => {
    if (held.length > 0) {
      if (frozen === null) throw new Error(`${where}: no books held`);
      return [...eveningFrom(date, frozen), ...lastingAgain(date)];
    }
    const day = dayByDate.get(date);
    if (day === undefined) throw new Error(`${where}: no day ${date}`);
    const simulator = day.steps.filter((s) => s.kind === 'evening').flatMap((s) => s.alerts.map((a) => factsOf(a, date)));
    // This test's own card arithmetic agrees with the simulator's.
    if (running) {
      const mine = eveningFrom(date, liveSnapshot()).map(alertKey).toSorted();
      expect(mine, `${where}: the evening worked out here is the simulator's`).toEqual(simulator.map(alertKey).toSorted());
    }
    return [...simulator, ...lastingAgain(date)];
  };
  const kindOf = (f: AlertFacts): string => (f.kind === 'card-reminder' || f.kind === 'card-overdue' ? `card ${f.card}` : f.kind);
  // 10.9 (A36): the evenings that came while the server was down, when it is back.
  const catchUp = (back: Date): void => {
    const missed: IsoDate[] = [];
    while (at(nextEvening, reviewTime).getTime() <= back.getTime()) {
      missed.push(nextEvening);
      nextEvening = addDays(nextEvening, 1);
    }
    if (missed.length === 0) return;
    outcome.mostEveningsAtOnce = Math.max(outcome.mostEveningsAtOnce, missed.length);
    const books = frozen;
    if (books === null) throw new Error(`${where}: no books held over the evenings missed`);
    const newest = new Map<string, { readonly facts: AlertFacts; readonly dueAt: Date }>();
    for (const date of missed) for (const facts of eveningAlerts(date)) newest.set(kindOf(facts), { facts, dueAt: at(date, reviewTime) });
    const now = todayIn(zone, back);
    for (const { facts, dueAt } of newest.values()) {
      if (facts.kind === 'card-reminder' || facts.kind === 'card-overdue') {
        const statement = known[facts.card];
        const state = statement === undefined ? null : cardNow(now, statement, books.payments[facts.card]);
        if (state !== (facts.kind === 'card-reminder' ? 'due' : 'overdue')) continue;
      }
      expectAlert(facts, dueAt, back);
    }
  };
  // 10.7 (A38): told once when the last good read becomes the setting's hours old.
  const notReadDue = (): Date | null => (lastGoodRead === null || notRead.on ? null : new Date(lastGoodRead.getTime() + settings.bankNotReadAlertHours * HOUR));
  const tellNotRead = (givenAt: Date): void => {
    const due = notReadDue();
    if (due === null || due.getTime() > givenAt.getTime() || lastGoodRead === null) return;
    notRead.on = true;
    notRead.times += 1;
    outcome.notRead += 1;
    const facts: AlertFacts = { kind: 'bank-not-read', time: notRead.times, hours: settings.bankNotReadAlertHours, lastRead: lastGoodRead.toISOString(), lastReadLocal: timeIn(zone, lastGoodRead) };
    expectAlert(facts, due, givenAt);
  };
  // A good read: what it clears, what it finds (10.4 when the bank drifted).
  const readGood = (): void => {
    lastGoodRead = new Date(clock.now);
    notRead.on = false;
    login.on = false;
    needsLogin = false;
    known = { ...atBank };
    driftRead = driftAtBank;
    if (driftRead !== 0 && mismatchSince === null) mismatchSince = new Date(clock.now);
    if (driftRead === 0) {
      mismatchSince = null;
      mismatch.on = false;
    }
  };
  // 10.4 (A47): told once the difference has lasted the setting's hours from
  // the read that first showed it, due then; not while the bank wants a login.
  const mismatchDue = (): Date | null => (mismatch.on || mismatchSince === null || driftRead === 0 || needsLogin ? null : new Date(mismatchSince.getTime() + settings.totalsMismatchAlertHours * HOUR));
  const tellMismatch = (givenAt: Date): void => {
    const due = mismatchDue();
    if (due === null || due.getTime() > givenAt.getTime()) return;
    mismatch.on = true;
    mismatch.times += 1;
    mismatch.lastDay = todayIn(zone, givenAt);
    outcome.mismatches += 1;
    expectAlert({ kind: 'totals-mismatch', time: mismatch.times, difference: driftRead, day: todayIn(zone, givenAt), again: false }, due, givenAt);
  };

  try {
    h = await connected({
      posted: { checking: lived.start.checking, savings: lived.start.savings, everyday: lived.start.everydayCard, old: lived.start.oldCard },
      history: (fake) => {
        for (const txn of lived.feed) inPlaidFormat(fake, txn);
      },
      rules: SIM_BANK_RULES,
      today: input.date,
      path,
    });
    const harness = h;
    db = h.db;
    // Setup day reads what the bank sent with his accounts and bank rules as
    // they are now (setup-day.ts); its book is the simulator's own.
    const roles = rolesOf(readAccounts(db));
    for (const item of readItems(db).values()) {
      const role = roles.get(item.accountId);
      const read = readPlaidItem(item.raw);
      if (role !== undefined && read.ok) saveItem(db, { ...item, kind: readBankItem(role, read.item.amount, read.item.description, SIM_BANK_RULES).kind });
    }
    appendEvent(db, { event: { kind: 'setup', input }, date: input.date, sync: null, totals: totalsOf(bookOfSetup(input)) });

    // What the next sync gives the book: the simulator's own transactions,
    // given only by a sync that goes through. The bank's items, balances and
    // statements are read from the made-up bank as always.
    let toGive: BankTransaction[] = [];
    const plan = (planInput: PlanInput): Plan => {
      const { items } = planSync({ ...planInput, book: null });
      const book = planInput.book;
      if (book === null) throw new Error('no book to give the bank to');
      const totals = toGive.map((txn) => {
        book.receive(txn);
        return totalsOf(book);
      });
      return { items, events: toGive, totals, attention: [] };
    };
    const bank: SyncBank = { plaid: h.plaid, box: h.box, log: memoryLog([]), pageSize: 100, plan };

    const settle = async (): Promise<void> => {
      await alerts?.idle();
    };
    const clockTo = async (moment: Date): Promise<void> => {
      const ms = moment.getTime() - clock.now.getTime();
      if (ms < 0) throw new Error(`${where}: the steps of the day ran past ${moment.toISOString()}`);
      await fakeClock.advance(ms, settle);
    };
    // The clock moves on to the moment. What the server does by the clock alone
    // while it runs is followed here as it happens: each evening at the review
    // time, and the bank not read for a day.
    const until = async (moment: Date): Promise<void> => {
      for (;;) {
        const evening = running ? at(nextEvening, reviewTime) : null;
        const stale = running ? notReadDue() : null;
        const gap = running ? mismatchDue() : null;
        const next = [evening, stale, gap].filter((t): t is Date => t !== null && t.getTime() <= moment.getTime()).sort((a, b) => a.getTime() - b.getTime())[0];
        if (next === undefined) break;
        await clockTo(next);
        if (stale !== null && stale.getTime() === next.getTime()) tellNotRead(next);
        if (gap !== null && gap.getTime() === next.getTime()) tellMismatch(next);
        if (evening !== null && evening.getTime() === next.getTime()) {
          const date = nextEvening;
          nextEvening = addDays(nextEvening, 1);
          for (const facts of eveningAlerts(date)) expectAlert(facts, next, next, eveningLatest);
        }
      }
      await clockTo(moment);
    };
    const start = async (): Promise<void> => {
      if (db === undefined) db = openDatabase(path);
      keeper = Keeper.open({ db, now: () => clock.now, push: { keys, agent: service.agent } });
      if (!subscribed) {
        // He turned notifications on, on his phone, logged in there.
        const token = loginForTests(db, clock.now, 'Safari on iPhone').slice('budget-login='.length);
        expect(keeper.pushDesk().on({ token, device: 'Safari on iPhone' }, phone.subscription())).toEqual({ ok: true });
        subscribed = true;
      }
      const sender = keeper.pushSender();
      if (sender === null) throw new Error('no push sender');
      running = true;
      // Kept and held for the end of quiet hours that came while it was
      // stopped (10.8): it goes the moment it is back (seed 1034: the bank not
      // read since 9:00 PM the night before the clocks went forward, due at
      // 10:00 PM, the server stopped at 11:00 PM and back at 7:30 AM).
      if (stoppedAt !== null) {
        for (const [key, e] of expected) {
          if (!phone.ids().includes(key) && e.shownBy.to >= stoppedAt.getTime() && e.shownBy.to < clock.now.getTime()) expected.set(key, { ...e, shownBy: { from: e.shownBy.from, to: clock.now.getTime() } });
        }
      }
      catchUp(clock.now);
      tellNotRead(clock.now);
      tellMismatch(clock.now);
      const serving = serveBooks({ keeper, bank, clock: fakeClock, webRoot: 'C:/made-up/no-screens/', origin: () => '', sender });
      alerts = serving.alerts;
      alerts.start();
      await settle();
    };
    const stop = async (): Promise<void> => {
      await alerts?.stop();
      alerts = undefined;
      keeper = undefined;
      db?.close();
      db = undefined;
      running = false;
      stoppedAt = new Date(clock.now);
      outcome.restarts += 1;
    };
    // A sync; true when it went through.
    const sync = async (): Promise<boolean> => {
      if (keeper === undefined) throw new Error(`${where}: the server is not running`);
      let ok = false;
      let wantsLogin = false;
      try {
        const result = await keeper.sync(bank);
        ok = !result.needsLogin;
        wantsLogin = result.needsLogin;
      } catch {
        ok = false;
      }
      if (ok) {
        toGive = [];
        readGood();
        tellMismatch(clock.now);
      } else if (wantsLogin) {
        // 10.5: told when it starts.
        needsLogin = true;
        if (!login.on) {
          login.on = true;
          login.times += 1;
          login.lastDay = today();
          outcome.logins += 1;
          expectAlert({ kind: 'bank-login', time: login.times, day: today(), again: false }, clock.now, clock.now);
        }
      }
      await settle();
      return ok;
    };
    const setStatements = (day: Day): void => {
      for (const s of day.statements) {
        harness.fake.setStatement(ACCOUNT[s.card], {
          is_overdue: false,
          last_payment_amount: null,
          last_payment_date: null,
          last_statement_issue_date: s.closingDate,
          last_statement_balance: s.statementBalance / 100,
          minimum_payment_amount: s.minimumPayment / 100,
          next_payment_due_date: s.dueDate,
        });
        atBank = { ...atBank, [s.card]: s };
      }
    };
    // One step of a day, at the moment the clock is at: a part of the bank's
    // activity read by a sync, or an answer, saved as the desk saves it.
    const runStep = async (day: Day, step: DayStep, fed: { n: number }, retryAfterFailure: boolean): Promise<void> => {
      const moment = new Date(clock.now);
      if (step.kind === 'setup' || step.kind === 'evening') return;
      if (step.kind === 'sync') {
        const txns = day.feed.slice(fed.n, step.afterFeed);
        for (const txn of txns) inPlaidFormat(harness.fake, txn);
        toGive = [...toGive, ...txns];
        fed.n = step.afterFeed;
        if (retryAfterFailure) {
          // The bank cannot be reached: tried again five minutes later.
          harness.fake.beforeCall = () => 'network';
          expect(await sync(), `${where}: a sync that cannot reach the bank`).toBe(false);
          harness.fake.beforeCall = undefined;
          outcome.failedSyncs += 1;
          await until(new Date(moment.getTime() + 5 * MINUTE));
        }
        const syncedAt = new Date(clock.now);
        expect(await sync(), `${where}: a sync`).toBe(true);
        for (const a of step.alerts) expectAlert(factsOf(a, day.date), syncedAt, syncedAt);
        return;
      }
      // An answer: given to the running books and saved in their history, as the desk does.
      if (keeper === undefined || db === undefined) throw new Error(`${where}: the server is not running`);
      const answer = day.answers[step.index];
      expect(fed.n, `${where}: the answer comes after what the bank sent before it`).toBe(answer?.afterFeed);
      const book = keeper.book();
      if (answer === undefined || book === null) throw new Error(`${where}: no answer ${step.index}`);
      const call: BookCall = { method: answer.method as BookCall['method'], args: answer.args };
      replayCall(book, call);
      appendEvent(db, { event: { kind: 'answer', answer: { book: [call] } }, date: today(), sync: null, totals: totalsOf(book) });
      alerts?.poke();
      await settle();
      for (const a of step.alerts) expectAlert(factsOf(a, day.date), moment, moment);
    };

    // The end of a day (or of a stretch): what the outbox kept, what the phone showed, and nothing else.
    const check = (): void => {
      const now = clock.now.getTime();
      if (running && db !== undefined) {
        const rows = readOutbox(db, 1_000_000).rows;
        const byKey = (a: readonly [string, string], b: readonly [string, string]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
        expect(
          rows.map((r) => [r.key, r.dueAt] as const).toSorted(byKey),
          `${where}: every alert kept once, due at its moment, and nothing else`,
        ).toEqual([...expected.entries()].map(([key, e]) => [key, e.dueAt] as const).toSorted(byKey));
        for (const r of rows) if (r.sentAt === null && (expected.get(r.key)?.shownBy.from ?? 0) <= now) throw new Error(`${where}: ${r.key} is not sent yet, due ${r.dueAt}`);
      }
      if (process.env['ALERT_SIM_DEBUG'] !== undefined) appendFileSync(process.env['ALERT_SIM_DEBUG'], `${where} ${Math.round(performance.now() / 1000)} s ${expected.size} alerts\n`);
      for (const [key, e] of expected) {
        const shown = phone.shown.find((s) => s.id === key);
        if (shown === undefined) {
          if (e.shownBy.to <= now) throw new Error(`${where}: ${key} was never shown, due ${e.dueAt}, to be shown by ${new Date(e.shownBy.to).toISOString()}`);
          continue;
        }
        const time = Date.parse(shown.at);
        if (time < e.shownBy.from || time > e.shownBy.to) throw new Error(`${where}: ${key} was shown at ${shown.at}, due ${e.dueAt}, to be shown from ${new Date(e.shownBy.from).toISOString()} by ${new Date(e.shownBy.to).toISOString()}`);
        expect(shown.due, `${where}: ${key}, shown at ${shown.at}, says when it was due`).toBe(dueWordsOf(e.dueAt, shown.at));
        if (e.facts.kind === 'card-reminder') expect(shown.title, `${where}: ${key}, shown at ${shown.at}, counts the days from then`).toBe(reminderTitleOf(e.facts, shown.at));
        expect(`${shown.title} ${shown.body}`, `${where}: ${key} has no amount on the lock screen (10.10)`).not.toContain('$');
        expect(shown.notification.screen, `${where}: ${key}: a tap opens the screen it is about (B201)`).toBe(screenOf(e.facts));
      }
      for (const shown of phone.shown) if (!expected.has(shown.id)) throw new Error(`${where}: ${shown.id} was shown at ${shown.at}, and was not expected`);
      expect(phone.repeats, `${where}: nothing shown twice`).toBe(0);
      expect(service.problems, `${where}: every push signed by the app and encrypted for the phone`).toEqual([]);
    };

    clock.now = at(input.date, '08:00');
    await start();
    // Setup day can leave needs or wants at zero or below (a small starting
    // money; 10.1, 10.2): those alerts are due the moment the server first
    // looks at the books after it, here.
    const setupStep = days[0]?.steps.find((step) => step.kind === 'setup');
    for (const a of setupStep?.alerts ?? []) expectAlert(factsOf(a, input.date), clock.now, clock.now);
    let backAt: Date | null = null;
    let downEvenings = 0;

    for (const [i, day] of days.entries()) {
      where = `seed ${seed} (${way}), ${day.date}`;
      const stretch = stretchOn(i);
      const resuming = resumingOn(i);
      eveningLatest = null;
      // Back in the night after an evening down (restarts): it starts then.
      if (backAt !== null) {
        await until(backAt);
        await start();
        // It syncs once it is back.
        expect(await sync(), `${where}: the sync when it is back`).toBe(true);
        backAt = null;
      }
      // The morning: started (restarts every day, or after days down).
      if (!running && stretch?.kind !== 'down') {
        await until(at(day.date, '07:30'));
        await start();
      }
      // The bank's balance drifts, or comes right, before the day's first sync.
      for (const d of drifts) {
        const change = i === d.from ? d.cents : i === d.from + d.days ? -d.cents : 0;
        if (change !== 0) {
          harness.fake.drift(ACCOUNT.checking, change);
          driftAtBank += change;
        }
      }

      if (stretch !== undefined) {
        // The day's activity is held back until the bank is read again.
        held.push(day);
        outcome.heldBackDays += 1;
        if (stretch.kind !== 'down') {
          if (i === stretch.from) frozen = snapshot(i - 1);
          await until(at(day.date, '08:30'));
          if (stretch.kind === 'login') harness.fake.needsLogin = true;
          else harness.fake.beforeCall = () => 'network';
          expect(await sync(), `${where}: the morning sync, when the bank ${stretch.kind === 'login' ? 'wants a login' : 'cannot be reached'}`).toBe(false);
          if (stretch.kind === 'network') {
            outcome.failedSyncs += 1;
            await until(at(day.date, '13:00'));
            expect(await sync(), `${where}: the afternoon sync, the bank still out of reach`).toBe(false);
            outcome.failedSyncs += 1;
          }
          harness.fake.beforeCall = undefined;
        }
      } else if (held.length > 0) {
        // The first good read since: at 8:30, or once he logs in again at 8:45.
        if (resuming?.kind === 'login') {
          await until(at(day.date, '08:30'));
          expect(await sync(), `${where}: the bank still wants a login`).toBe(false);
          await until(at(day.date, '08:45'));
          harness.fake.needsLogin = false;
        } else await until(at(day.date, '08:30'));
        expect(await sync(), `${where}: the first good read`).toBe(true);
        // Then each day held back, in order, ten seconds a step.
        let moment = new Date(clock.now.getTime() + MINUTE);
        for (const past of held) {
          setStatements(past);
          const fed = { n: 0 };
          for (const step of past.steps) {
            if (step.kind !== 'sync' && step.kind !== 'answer') continue;
            await until(moment);
            await runStep(past, step, fed, false);
            moment = new Date(moment.getTime() + 10_000);
          }
          expect(fed.n, `${where}: every bank transaction of ${past.date} was synced`).toBe(past.feed.length);
        }
        if (moment.getTime() >= at(day.date, '08:58').getTime()) throw new Error(`${where}: too many steps held back`);
        held = [];
        frozen = null;
        // Then the day's own statements, and its sync.
        setStatements(day);
        await until(at(day.date, '08:58'));
        expect(await sync(), `${where}: the sync after catching up`).toBe(true);
      }

      if (stretch === undefined) {
        const steps = day.steps;
        const fed = { n: 0 };
        if (resuming === undefined) setStatements(day);
        // Some days the first of the day's syncs comes in the night (one server only).
        const night = way === 'one-server' && resuming === undefined && steps.some((s) => s.kind === 'sync') && (chance(5) || day.date === '2026-11-01' || day.date === '2027-03-14');
        const firstSync = steps.findIndex((s) => s.kind === 'sync');
        if (night) {
          if (steps.slice(0, firstSync).some((s) => s.kind === 'answer')) throw new Error(`${where}: an answer before the first sync`);
          await until(at(day.date, '02:30'));
          await runStep(day, steps[firstSync] as DayStep, fed, false);
          outcome.nightSyncs += 1;
        }
        if (resuming === undefined) {
          // The morning sync reads the statements (and the bank wanting a login, now and then).
          await until(at(day.date, '08:30'));
          if (way === 'restarts' && chance(12)) {
            harness.fake.needsLogin = true;
            expect(await sync(), `${where}: the bank wants a login`).toBe(false);
            // He logs in again.
            await until(at(day.date, '08:45'));
            harness.fake.needsLogin = false;
          }
          expect(await sync(), `${where}: the morning sync`).toBe(true);
        }
        let daySteps = 0;
        let eveningSteps = 0;
        for (const [n, step] of steps.entries()) {
          if (night && n <= firstSync) continue;
          if (step.kind !== 'sync' && step.kind !== 'answer') continue;
          const moment = step.phase === 'evening' ? at(day.date, '18:00', 30_000 * eveningSteps++) : at(day.date, '09:00', 10 * MINUTE * daySteps++);
          if (step.phase === 'evening' && moment.getTime() >= at(day.date, '19:59').getTime()) throw new Error(`${where}: too many evening steps`);
          if (step.phase === 'day' && moment.getTime() >= at(day.date, '18:00').getTime()) throw new Error(`${where}: too many day steps`);
          await until(moment);
          await runStep(day, step, fed, way === 'restarts' && step.kind === 'sync' && step.phase === 'day' && resuming === undefined && chance(9));
        }
        expect(fed.n, `${where}: every bank transaction of the day was synced`).toBe(day.feed.length);
      }

      // The evening, at the daily review time.
      const evening = at(day.date, reviewTime);
      outcome.offsets.add(timeIn(zone, evening).slice(-6));
      expect(timeIn(zone, evening).slice(11, 16), `${where}: the evening is at the review time on the clock`).toBe(reviewTime);
      const quietDay = stretch === undefined && resuming === undefined && held.length === 0;
      const downTomorrow = stretches.find((x) => x.kind === 'down' && x.from === i + 1);
      if (downTomorrow !== undefined) {
        // Down from just before this evening for days (10.9).
        await until(at(day.date, '19:59'));
        frozen = snapshot(i);
        await stop();
      } else if (stretch?.kind === 'down') {
        // Still down.
      } else if (way === 'one-server' && quietDay && chance(6)) {
        // The phone cannot be reached from 7:55 PM to 8:12 PM: tried at 8:00, 8:01, 8:03, 8:07, and shown at 8:15.
        await until(at(day.date, '19:55'));
        phone.failing = 'the phone cannot be reached';
        eveningLatest = at(day.date, '20:15');
        await until(at(day.date, '20:12'));
        phone.failing = null;
        outcome.late += [...expected.values()].filter((e) => e.dueAt === evening.toISOString()).length;
      } else if (way === 'restarts' && quietDay && (day.steps.some((st) => st.kind === 'evening' && st.alerts.length > 0) ? chance(3) : chance(9))) {
        // Down over the evening (more often over one with alerts): back at 9:30 PM, or in the night at 3:00 AM.
        await until(at(day.date, '19:59'));
        frozen = snapshot(i);
        await stop();
        // Every other time back in the night.
        downEvenings += 1;
        if (downEvenings % 2 === 0) {
          backAt = at(addDays(day.date, 1), '03:00');
          outcome.backInTheNight += 1;
        } else {
          await until(at(day.date, '21:30'));
          await start();
          outcome.late += [...expected.values()].filter((e) => e.dueAt === evening.toISOString()).length;
        }
      }
      // A sync in the evening, as the timer would make it, so a good read is never a day old on a good day.
      if (running && stretch === undefined) {
        const nine = at(day.date, '21:00');
        await until(clock.now.getTime() < nine.getTime() ? nine : new Date(clock.now.getTime() + MINUTE));
        expect(await sync(), `${where}: the evening sync`).toBe(true);
      }
      await until(at(day.date, '23:00'));
      check();
      if (way === 'restarts' && running) await stop();
      outcome.days += 1;
    }

    // The last alerts, sent once quiet hours are over; then the history.
    if (backAt !== null) {
      await until(backAt);
      await start();
    }
    if (!running) await start();
    await until(at(addDays(days.at(-1)?.date ?? input.date, 1), '07:30'));
    check();
    const history = readHistory(db as Db).flatMap((e) => (e.event.kind === 'alerts' ? [e.event.alerts] : []));
    const given = history.flatMap((a) => a.given.map((g) => [g.key, g.facts] as const));
    expect(new Set(given.map(([key]) => key)).size, `seed ${seed}: each alert given once`).toBe(given.length);
    expect(Object.fromEntries(given), `seed ${seed}: the facts of every alert`).toEqual(Object.fromEntries([...expected.entries()].map(([key, e]) => [key, e.facts])));
    const evenings = history.reduce((n, a) => n + (a.check.kind === 'evening' ? daysBetween(a.check.from ?? a.check.date, a.check.date) + 1 : 0), 0);
    expect(evenings, `seed ${seed}: every evening handled once`).toBe(days.length);
    outcome.loginRepeats = given.filter(([, f]) => f.kind === 'bank-login' && f.again).length;
    outcome.mismatchRepeats = given.filter(([, f]) => f.kind === 'totals-mismatch' && f.again).length;
    outcome.alerts = expected.size;
    return outcome;
  } finally {
    await alerts?.stop();
    db?.close();
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

import { addDays, bucketLevel, cardDue, cardNotices, payoffCountdown, type BankBalances, type Book, type CardStatement, type Cents, type IsoDate } from '@budget-app/money';
import { ReplayFailed } from '../history/history.js';
import { instantIn, timeIn, todayIn } from '../history/today.js';
import { alertRecord, lastingKindOf, type AlertFacts, type AlertRecord, type LastingKind } from './alerts.js';

// Which alerts are due, worked out from the book and what is known of the
// bank at one moment, and the alerts already given (the ledger). Nothing here
// asks the clock or the database: the moment and everything else is handed in,
// so the same history always comes to the same ledger.
//
// Each time the server looks (after a sync or an answer, and on its timer) it
// makes at most these, in this order, each one an "alerts" event in the book's
// history, saved with its alerts in the outbox in one step:
// - start: the first look on a database. From then on the evenings count; the
//   take-backs already there are known, and get no alert.
// - evening: the evening (the daily review time, section 2, in his home time
//   zone) not handled yet whose moment has come, even with nothing to give, so
//   it is never handled twice. The daily review (10.3), card reminders (9.1 to
//   9.3) and the overdue alert (9.4) come then (9.7, A34), and the totals not
//   matching the bank (10.4) and the bank wanting a new login (10.5) once more
//   each day they last (A37). Evenings that came while the server was not
//   looking (it was down) are handled together when it is back: only the
//   newest of each kind, and only if it is still true then (10.9, A36), each
//   due at its own evening.
// - change: what is true now that has not been told: needs or wants low or
//   empty (10.1, 10.2, once per bucket per pay period), what the bank took
//   back (10.6, once), the totals not matching the bank (10.4) and the bank
//   wanting a new login (10.5) when they start, and the bank not read for the
//   hours of the setting (10.7, A38), due at the moment the last good read
//   became that old, and a paycheck counted since the last look (10.14, A49,
//   once per pay period), and (her rulebook, 10.15) each paycheck waiting
//   for her yes, once. Made only when it gives or clears something, or
//   notes the pay period of a history kept before the payday alert.
// Quiet hours (10.8, A35) and the lock screen (10.10, A39) are about sending:
// the alerts are kept at the moment they come due all the same (keeper.ts).

export type AlertCheck =
  | { readonly kind: 'start'; readonly eveningsFrom: IsoDate; readonly known: readonly string[] }
  // The evening of date; with from, every evening from `from` to date, which
  // came while the server was not looking (10.9).
  | { readonly kind: 'evening'; readonly date: IsoDate; readonly dueAt: string; readonly from?: IsoDate }
  | { readonly kind: 'change' };

export interface AlertsEvent {
  // The moment the server looked, as an instant (ISO, UTC).
  readonly at: string;
  readonly check: AlertCheck;
  readonly given: readonly AlertRecord[];
  // Lasting alerts that stopped being true (10.4, 10.5, 10.7): told again only
  // after this.
  readonly cleared: readonly LastingKind[];
  // 10.14: the newest pay period known after this event, when it changed: at
  // the start, with a payday alert, or noted in a history kept before the
  // payday alert. Left out otherwise (and in every event kept before).
  readonly payPeriod?: number;
}

// A lasting alert (10.4, 10.5, 10.7): whether it is told and still true, how
// many times it has started, the last day it was told (10.4, 10.5: once a
// day), and the read it is about (10.7: again only after a newer one).
export interface LastingState {
  readonly on: boolean;
  readonly times: number;
  readonly lastDay: IsoDate | null;
  readonly about: string | null;
}

export interface AlertLedger {
  readonly started: boolean;
  // The next evening to handle; null before the start.
  readonly nextEvening: IsoDate | null;
  // The key of every alert given, so none is given twice.
  readonly given: ReadonlySet<string>;
  // Take-backs already there at the start: no alert for them.
  readonly known: ReadonlySet<string>;
  readonly lasting: Readonly<Record<LastingKind, LastingState>>;
  // 10.14: the newest pay period the alerts know of (told, or there when they
  // started); a paycheck that begins a newer one is told. Null in a history
  // kept before the payday alert, until its first look notes it.
  readonly payPeriod: number | null;
}

const OFF: LastingState = { on: false, times: 0, lastDay: null, about: null };

export const NO_ALERTS: AlertLedger = {
  started: false,
  nextEvening: null,
  given: new Set(),
  known: new Set(),
  lasting: { 'totals-mismatch': OFF, 'bank-login': OFF, 'bank-not-read': OFF, 'bank-login-2': OFF, 'bank-not-read-2': OFF },
  payPeriod: null,
};

// What is known at the moment the server looks.
export interface AlertWorld {
  readonly book: Book;
  readonly now: Date;
  // His home time zone (section 2).
  readonly zone: string;
  // The bank's balances with pending charges (12.1) as last read; null when
  // they cannot be worked out. The mismatch is then neither told, cleared,
  // nor told again.
  readonly bank: BankBalances | null;
  readonly needsLogin: boolean;
  // The latest statement of each card (section 9).
  readonly statements: readonly CardStatement[];
  // The last good read of the bank, as an instant; null before the first (10.7).
  readonly lastRead: string | null;
  // 10.13: when the bank's permission to read his accounts runs out, as an
  // instant, when the bank gave it.
  readonly permissionEnds?: string | null;
  // 10.4 (A47): when the totals stopped matching the bank, as an instant (the
  // read that first showed it); null while they match, or when not known.
  readonly mismatchSince?: string | null;
  // Her setup (HB6): each card's name as its bank gives it; null or left out
  // in upstream's, whose alerts keep their own words.
  readonly cardNames?: Readonly<Record<'everyday-card' | 'second-card', string>> | null;
  // Her rulebook, 10.5, 10.7 and 10.13 (PR 6, HB10): each of her banks, by
  // its name, in place of needsLogin, lastRead and permissionEnds, which are
  // then about her first bank only. Null or left out in upstream's setup.
  readonly banks?: readonly AlertBank[] | null;
  // Her rulebook, 50.4: the Wishlist money to move from savings to checking,
  // which the card reminders say too. Null or left out without Wishlist.
  readonly wishlistMove?: { readonly amount: Cents; readonly cards: readonly ('everyday-card' | 'second-card')[] } | null;
}

// One of her banks, as the alerts know it.
export interface AlertBank {
  readonly bank: 1 | 2;
  readonly name: string;
  readonly needsLogin: boolean;
  // Its last good read, as an instant; null before the first (10.7).
  readonly lastRead: string | null;
  readonly permissionEnds: string | null;
}

// The banks the alerts are about: her banks, or upstream's one connection,
// from the world's own fields (its alerts carry no bank and no name).
function banksOf(world: Pick<AlertWorld, 'banks' | 'needsLogin' | 'lastRead' | 'permissionEnds'>): readonly (Omit<AlertBank, 'name'> & { readonly name: string | null })[] {
  return world.banks ?? [{ bank: 1, name: null, needsLogin: world.needsLogin, lastRead: world.lastRead, permissionEnds: world.permissionEnds ?? null }];
}

// What one bank's alerts carry: her second bank's number, and her bank's name.
const tagOf = (b: { readonly bank: 1 | 2; readonly name: string | null }): { readonly bank?: 2; readonly name?: string } => ({ ...(b.bank === 2 ? { bank: 2 as const } : {}), ...(b.name === null ? {} : { name: b.name }) });

const HOUR = 3_600_000;

// The ledger after one "alerts" event: the same live and in a replay. An
// event that does not fit what came before (an alert given twice, an evening
// out of turn, a second start, a lasting alert out of turn) is a history that
// cannot be replayed.
export function applyAlerts(ledger: AlertLedger, event: AlertsEvent): AlertLedger {
  const given = new Set(ledger.given);
  for (const alert of event.given) {
    if (given.has(alert.key)) throw new ReplayFailed(`the alert "${alert.key}" was already given`);
    given.add(alert.key);
  }
  const lasting = { ...ledger.lasting };
  for (const alert of event.given) {
    const f = alert.facts;
    const outOfTurn = (): ReplayFailed => new ReplayFailed(`the alert "${alert.key}" is out of turn`);
    if (f.kind === 'totals-mismatch' || f.kind === 'bank-login') {
      const kind = lastingKindOf(f);
      const state = lasting[kind];
      if (!f.again) {
        if (state.on || f.time !== state.times + 1) throw outOfTurn();
        lasting[kind] = { on: true, times: f.time, lastDay: f.day, about: null };
      } else {
        if (!state.on || f.time !== state.times || (state.lastDay !== null && f.day <= state.lastDay)) throw outOfTurn();
        lasting[kind] = { ...state, lastDay: f.day };
      }
    }
    if (f.kind === 'bank-not-read') {
      const kind = lastingKindOf(f);
      const state = lasting[kind];
      if (state.on || f.time !== state.times + 1) throw outOfTurn();
      lasting[kind] = { on: true, times: f.time, lastDay: null, about: f.lastRead };
    }
  }
  for (const kind of event.cleared) {
    if (!lasting[kind].on) throw new ReplayFailed(`${kind} was cleared without being on`);
    lasting[kind] = { ...lasting[kind], on: false, about: null };
  }
  // 10.14: a payday alert only for a pay period newer than the one known,
  // given with it; the pay period known only ever moves on.
  for (const alert of event.given) {
    const f = alert.facts;
    if (f.kind === 'payday' && (ledger.payPeriod === null || event.payPeriod !== f.period)) throw new ReplayFailed(`the alert "${alert.key}" is out of turn`);
  }
  if (event.payPeriod !== undefined && ledger.payPeriod !== null && event.payPeriod <= ledger.payPeriod) throw new ReplayFailed(`the pay period ${event.payPeriod} is not newer than ${ledger.payPeriod}`);
  const payPeriod = event.payPeriod ?? ledger.payPeriod;
  const check = event.check;
  switch (check.kind) {
    case 'start':
      if (ledger.started) throw new ReplayFailed('alerts started twice');
      return { ...ledger, started: true, nextEvening: check.eveningsFrom, given, known: new Set(check.known), lasting, payPeriod };
    case 'evening': {
      const first = check.from ?? check.date;
      if (!ledger.started || first !== ledger.nextEvening || check.date < first) throw new ReplayFailed(`the evening of ${check.date} is out of turn (next is ${ledger.nextEvening ?? 'none'})`);
      return { ...ledger, nextEvening: addDays(check.date, 1), given, lasting, payPeriod };
    }
    case 'change':
      if (!ledger.started) throw new ReplayFailed('alerts given before they started');
      return { ...ledger, given, lasting, payPeriod };
  }
}

// The instant the evening of a day comes: the daily review time (section 2)
// on that day in his home time zone.
export function eveningAt(world: Pick<AlertWorld, 'book' | 'zone'>, date: IsoDate): Date {
  return instantIn(world.zone, date, world.book.settings().dailyReviewTime);
}

// The next event to make now, or null when there is nothing to do.
export function nextAlertsEvent(world: AlertWorld, ledger: AlertLedger): AlertsEvent | null {
  const at = world.now.toISOString();
  if (!ledger.started) {
    const today = todayIn(world.zone, world.now);
    const eveningsFrom = eveningAt(world, today).getTime() > world.now.getTime() ? today : addDays(today, 1);
    const known = world.book
      .changeLog()
      .flatMap((line) => (line.kind === 'bank-took-back' ? [line.id] : []));
    // 10.14: the pay period of this moment is known; only a newer one is told.
    return { at, check: { kind: 'start', eveningsFrom, known }, given: [], cleared: [], payPeriod: world.book.period().number };
  }
  const from = ledger.nextEvening;
  if (from !== null && eveningAt(world, from).getTime() <= world.now.getTime()) {
    // Every evening whose moment has come: one when the server looks on time,
    // more when it was down (10.9).
    let to = from;
    while (eveningAt(world, addDays(to, 1)).getTime() <= world.now.getTime()) to = addDays(to, 1);
    return eveningsEvent(world, ledger, from, to, at);
  }
  return changeEvent(world, ledger, at);
}

// Milliseconds until the next alert comes due by the clock alone: the next
// evening, or the bank's last good read becoming too old (10.7). 0 or less
// when one is due; null before the start.
export function nextDueIn(world: Pick<AlertWorld, 'book' | 'zone' | 'now' | 'lastRead' | 'mismatchSince' | 'banks'>, ledger: AlertLedger): number | null {
  if (!ledger.started || ledger.nextEvening === null) return null;
  const now = world.now.getTime();
  let next = eveningAt(world, ledger.nextEvening).getTime() - now;
  // 10.7: each bank's last good read (her setup), or the bank's.
  for (const b of world.banks ?? [{ bank: 1 as const, lastRead: world.lastRead }]) {
    const kind = b.bank === 2 ? 'bank-not-read-2' : 'bank-not-read';
    if (!ledger.lasting[kind].on && b.lastRead !== null) next = Math.min(next, Date.parse(b.lastRead) + world.book.settings().bankNotReadAlertHours * HOUR - now);
  }
  // 10.4 (A47): the moment a difference has lasted the setting's hours.
  const mismatch = mismatchDueAt(world);
  if (!ledger.lasting['totals-mismatch'].on && mismatch !== null && mismatch > now) next = Math.min(next, mismatch - now);
  return next;
}

// 10.4 (A47): when a difference with the bank is told: once it has lasted
// the setting's hours from the read that first showed it. Null when there is
// no difference known.
function mismatchDueAt(world: Pick<AlertWorld, 'book' | 'mismatchSince'>): number | null {
  const since = world.mismatchSince ?? null;
  return since === null ? null : Date.parse(since) + world.book.settings().totalsMismatchAlertHours * HOUR;
}

// Which alerts are one kind, of which only the newest goes when several
// evenings came while the server was down (10.9): one daily review, one
// reminder per card, one more of each lasting alert.
function kindOf(f: AlertFacts): string {
  if (f.kind === 'card-reminder' || f.kind === 'card-overdue') return `card ${f.card}`;
  // Her second bank's are kinds of their own (HB10).
  if ((f.kind === 'bank-login' || f.kind === 'bank-permission') && f.bank === 2) return `${f.kind} bank 2`;
  return f.kind;
}

// The evenings from `from` to `to`, all due by now. Each evening's alerts are
// worked out with the books as they are now (nothing changes while the server
// is down), for its own day; then only the newest of each kind, if it is
// still true now, each due at its own evening. On time, that is the one
// evening's alerts.
function eveningsEvent(world: AlertWorld, ledger: AlertLedger, from: IsoDate, to: IsoDate, at: string): AlertsEvent {
  const newest = new Map<string, { readonly facts: AlertFacts; readonly dueAt: string }>();
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const dueAt = eveningAt(world, date).toISOString();
    for (const facts of eveningAlerts(world, ledger, date)) newest.set(kindOf(facts), { facts, dueAt });
  }
  const today = todayIn(world.zone, world.now);
  const given = [...newest.values()]
    .filter(({ facts }) => stillTrue(world, today, facts))
    .map(({ facts, dueAt }) => alertRecord(facts, dueAt))
    .filter((record) => !ledger.given.has(record.key));
  const dueAt = eveningAt(world, to).toISOString();
  return { at, check: from === to ? { kind: 'evening', date: to, dueAt } : { kind: 'evening', from, date: to, dueAt }, given, cleared: [] };
}

// One evening's alerts, with the books now.
function eveningAlerts(world: AlertWorld, ledger: AlertLedger, date: IsoDate): AlertFacts[] {
  const { book } = world;
  const facts: AlertFacts[] = [];
  // 10.3: only if something is waiting.
  const waiting = book.reviewItems().length;
  if (waiting > 0) facts.push({ kind: 'daily-review', date, waiting });
  // 9.1 to 9.4, for that day, with the payments seen by then.
  const settings = book.settings();
  for (const statement of world.statements) {
    for (const notice of cardNotices(date, statement, book.cardPayments(statement.card), settings)) {
      const name = notice.card === 'old-card' ? undefined : world.cardNames?.[notice.card];
      const named = name === undefined ? {} : { name };
      if (notice.kind === 'overdue') {
        facts.push({ kind: 'card-overdue', card: notice.card, dueDate: notice.dueDate, minimumPayment: notice.minimumPayment, date, ...named });
      } else {
        facts.push({
          kind: 'card-reminder',
          card: notice.card,
          dueDate: notice.dueDate,
          daysBefore: notice.daysBefore,
          minimumPayment: notice.minimumPayment,
          statementBalance: notice.card !== 'old-card' ? notice.statementBalance : null,
          ...named,
          // Her rulebook, 50.4: while it is not moved, the reminder says it too.
          ...(notice.card !== 'old-card' && world.wishlistMove != null && world.wishlistMove.amount > 0 && world.wishlistMove.cards.includes(notice.card) ? { wishlistMove: world.wishlistMove.amount } : {}),
        });
      }
    }
  }
  // 10.4 and 10.5 (A37): once more, on a day it lasts and was not told yet.
  const again = (state: LastingState): boolean => state.on && (state.lastDay === null || state.lastDay < date);
  const mismatch = ledger.lasting['totals-mismatch'];
  const check = world.bank === null ? null : book.selfCheck(world.bank);
  if (again(mismatch) && check !== null && !check.ok) facts.push({ kind: 'totals-mismatch', time: mismatch.times, difference: check.difference, day: date, again: true });
  for (const b of banksOf(world)) {
    const login = ledger.lasting[b.bank === 2 ? 'bank-login-2' : 'bank-login'];
    if (again(login) && b.needsLogin) facts.push({ kind: 'bank-login', time: login.times, day: date, again: true, ...tagOf(b) });
  }
  // 10.13: from the setting's days before the day it runs out, until that day; each bank's own.
  for (const b of banksOf(world)) {
    const ends = permissionEndsOn(world.zone, b.permissionEnds);
    if (ends !== null && date >= addDays(ends, -settings.bankPermissionWarnDays) && date < ends) facts.push({ kind: 'bank-permission', ends, ...tagOf(b) });
  }
  return facts;
}

// 10.13: the day a bank's permission runs out, on his clock; null when the bank gave no date.
function permissionEndsOn(zone: string, at: string | null): IsoDate | null {
  return at === null ? null : todayIn(zone, new Date(at));
}

// 10.13: still the date that bank gives, and not run out yet.
function permissionStillTrue(world: AlertWorld, f: Extract<AlertFacts, { kind: 'bank-permission' }>): boolean {
  const at = banksOf(world).find((b) => b.bank === (f.bank ?? 1))?.permissionEnds ?? null;
  return at !== null && permissionEndsOn(world.zone, at) === f.ends && world.now.getTime() < Date.parse(at);
}

// 10.9: an evening's alert is still true now. A reminder: the card is still
// due (9.6: not enough paid, the due date not passed); the overdue alert:
// still overdue. The rest are worked out with the books now already.
function stillTrue(world: AlertWorld, today: IsoDate, f: AlertFacts): boolean {
  if (f.kind === 'bank-permission') return permissionStillTrue(world, f);
  if (f.kind !== 'card-reminder' && f.kind !== 'card-overdue') return true;
  const statement = world.statements.find((s) => s.card === f.card);
  if (statement === undefined) return false;
  const due = cardDue(today, statement, world.book.cardPayments(statement.card), world.book.settings());
  return due !== null && due.dueDate === f.dueDate && due.kind === (f.kind === 'card-reminder' ? 'due' : 'overdue');
}

// 10.9 (A40): an alert kept earlier and not sent yet is still true now, when
// the phone can be given it. The daily review: something waits in review. A
// card: as above. Low and empty: the bucket is at that level now, in that pay
// period. A lasting alert (10.4, 10.5, 10.7): it is still on, the same time
// it started. A take-back: always (it happened).
export function stillTrueNow(world: AlertWorld, ledger: AlertLedger, f: AlertFacts): boolean {
  const { book } = world;
  switch (f.kind) {
    case 'daily-review':
      return book.reviewItems().length > 0;
    case 'card-reminder':
    case 'card-overdue':
      return stillTrue(world, todayIn(world.zone, world.now), f);
    case 'low-bucket':
    case 'empty-bucket': {
      if (f.period !== book.period().number) return false;
      const level = bucketLevel(book.pots()[f.bucket], book.startedPeriodWith()[f.bucket], book.settings().lowBucketAlertPercent);
      return level === (f.kind === 'low-bucket' ? 'low' : 'empty');
    }
    case 'totals-mismatch':
    case 'bank-login':
    case 'bank-not-read': {
      const state = ledger.lasting[lastingKindOf(f)];
      return state.on && state.times === f.time;
    }
    case 'bank-took-back':
      return true;
    case 'bank-permission':
      return permissionStillTrue(world, f);
    // 10.14: its pay period still lasts.
    case 'payday':
      return f.period === book.period().number;
    // Her rulebook, 10.15: it still waits for her yes.
    case 'paycheck-waiting':
      return book.paychecksWaiting().some((p) => p.id === f.id);
  }
}

// 10.14: the paycheck that began the pay period now: what is still to move
// into the savings account (3.8, as Payday shows it), and the old card's share
// this payday (9.5, as Home shows it).
function paydayFacts(world: AlertWorld): AlertFacts {
  const { book } = world;
  const transfer = world.bank === null ? null : book.savingsTransfer(world.bank.savings);
  const countdown = payoffCountdown(book, todayIn(world.zone, world.now));
  const { number: period, startDate: date } = book.period();
  return { kind: 'payday', period, date, toSavings: transfer?.stillToMove ?? null, extraInSavings: transfer?.extraInSavings ?? 0, oldCard: countdown.on ? countdown.perPayday : null };
}

function changeEvent(world: AlertWorld, ledger: AlertLedger, at: string): AlertsEvent | null {
  const { book } = world;
  const given: AlertRecord[] = [];
  const give = (facts: AlertFacts, dueAt = at): void => {
    const record = alertRecord(facts, dueAt);
    if (!ledger.given.has(record.key)) given.push(record);
  };
  // 10.1 and 10.2: the level of each bucket now, once per pay period each.
  const pots = book.pots();
  const started = book.startedPeriodWith();
  const period = book.period().number;
  const percent = book.settings().lowBucketAlertPercent;
  for (const bucket of ['needs', 'wants'] as const) {
    const level = bucketLevel(pots[bucket], started[bucket], percent);
    if (level === 'low') give({ kind: 'low-bucket', bucket, period, amount: pots[bucket], startedWith: started[bucket] });
    if (level === 'empty') give({ kind: 'empty-bucket', bucket, period, amount: pots[bucket] });
  }
  // 10.6: each take-back, once.
  for (const line of book.changeLog()) {
    if (line.kind === 'bank-took-back' && !ledger.known.has(line.id)) give({ kind: 'bank-took-back', id: line.id, date: line.date, description: line.description, amount: line.amount });
  }
  // Her rulebook, 10.15: each paycheck waiting for her yes, once, when it posts.
  for (const p of book.paychecksWaiting()) give({ kind: 'paycheck-waiting', id: p.id, date: p.date, amount: p.amount, early: p.early });
  // 10.4 and 10.5: told when they start, cleared when they stop.
  const today = todayIn(world.zone, world.now);
  const cleared: LastingKind[] = [];
  const lasting = (kind: 'totals-mismatch' | 'bank-login' | 'bank-login-2', now: boolean | null, facts: (time: number) => AlertFacts, dueAt?: string): void => {
    if (now === null) return;
    const state = ledger.lasting[kind];
    if (now && !state.on) give(facts(state.times + 1), dueAt);
    if (!now && state.on) cleared.push(kind);
  };
  const check = world.bank === null ? null : book.selfCheck(world.bank);
  // 10.4 (A47): told once the difference has lasted the setting's hours, due at that moment.
  const mismatchDue = mismatchDueAt(world);
  const lasted = check !== null && !check.ok && mismatchDue !== null && mismatchDue <= world.now.getTime();
  lasting('totals-mismatch', check === null ? null : lasted, (time) => ({ kind: 'totals-mismatch', time, difference: check?.difference ?? 0, day: today, again: false }), lasted ? new Date(mismatchDue).toISOString() : undefined);
  for (const b of banksOf(world)) lasting(b.bank === 2 ? 'bank-login-2' : 'bank-login', b.needsLogin, (time) => ({ kind: 'bank-login', time, day: today, again: false, ...tagOf(b) }));
  // 10.7: once, when the last good read is the setting's hours old; cleared by
  // a newer read. Each of her banks on its own.
  for (const b of banksOf(world)) {
    const kind = b.bank === 2 ? 'bank-not-read-2' : 'bank-not-read';
    const notRead = ledger.lasting[kind];
    if (notRead.on) {
      if (b.lastRead !== notRead.about) cleared.push(kind);
    } else if (b.lastRead !== null) {
      const hours = book.settings().bankNotReadAlertHours;
      const due = Date.parse(b.lastRead) + hours * HOUR;
      if (due <= world.now.getTime()) {
        give({ kind: 'bank-not-read', time: notRead.times + 1, hours, lastRead: b.lastRead, lastReadLocal: timeIn(world.zone, new Date(b.lastRead)), ...tagOf(b) }, new Date(due).toISOString());
      }
    }
  }
  // 10.14: a paycheck counted since the last look, once per pay period; in a
  // history kept before the payday alert, the pay period now is only noted.
  let payPeriod: number | undefined;
  if (ledger.payPeriod === null || period > ledger.payPeriod) {
    payPeriod = period;
    if (ledger.payPeriod !== null) give(paydayFacts(world));
  }
  if (given.length === 0 && cleared.length === 0 && payPeriod === undefined) return null;
  return { at, check: { kind: 'change' }, given, cleared, ...(payPeriod === undefined ? {} : { payPeriod }) };
}

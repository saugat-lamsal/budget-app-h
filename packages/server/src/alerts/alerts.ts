import { daysBetween, formatDollars, type Cents, type IsoDate } from '@budget-app/money';

// Phase 5, part one: the alerts and card reminders of rulebook sections 9
// and 10, as the real server works them out, keeps them, and sends them.
// This is what one alert is: the facts it is about, the key that makes it
// come only as often as its rule says, and its words. Nothing here uses Node:
// the list on the phone (views/alerts.ts) shares these types.

export type Card = 'everyday-card' | 'old-card' | 'second-card';

export type AlertFacts =
  // 10.1: once per bucket per pay period. What is left, and what the bucket
  // started the pay period with (the level is a percent of it).
  | { readonly kind: 'low-bucket'; readonly bucket: 'needs' | 'wants'; readonly period: number; readonly amount: Cents; readonly startedWith: Cents }
  // 10.2: once per bucket per pay period.
  | { readonly kind: 'empty-bucket'; readonly bucket: 'needs' | 'wants'; readonly period: number; readonly amount: Cents }
  // 10.3: at the review time, only if something waits; once a day.
  | { readonly kind: 'daily-review'; readonly date: IsoDate; readonly waiting: number }
  // 9.1 to 9.3: on each reminder day while not enough is paid. The everyday
  // card shows its statement balance; the old card does not (null). Her
  // second card is reminded about like the everyday card (her rulebook, 9.1).
  // name: in her setup, the card's name as its bank gives it (HB6); left out
  // in upstream's, which keeps its own words. It is not part of the key.
  | { readonly kind: 'card-reminder'; readonly card: Card; readonly dueDate: IsoDate; readonly daysBefore: number; readonly minimumPayment: Cents; readonly statementBalance: Cents | null; readonly name?: string; readonly wishlistMove?: Cents }
  // 9.4: every day after the due date until the minimum is paid (B30).
  | { readonly kind: 'card-overdue'; readonly card: Card; readonly dueDate: IsoDate; readonly minimumPayment: Cents; readonly date: IsoDate; readonly name?: string }
  // 10.4 and 10.5 (A37): when it starts (the time-th time it starts, on its
  // day), then again (again: true) once each day it lasts, at the review time.
  | { readonly kind: 'totals-mismatch'; readonly time: number; readonly difference: Cents; readonly day: IsoDate; readonly again: boolean }
  // Her rulebook, 10.5, 10.7 and 10.13 (PR 6, HB10): each of her banks has
  // its own. bank: 2 for her second bank (its own key and kind); left out for
  // the first, upstream's one connection. name: the bank's name as Plaid gave
  // it (HB8), in her setup only; it is not part of the key.
  | { readonly kind: 'bank-login'; readonly time: number; readonly day: IsoDate; readonly again: boolean; readonly bank?: 2; readonly name?: string }
  // 10.7 (A38): the last good read of the bank is this many hours old (the
  // time-th time), and when that read was, as an instant and on his clock.
  | { readonly kind: 'bank-not-read'; readonly time: number; readonly hours: number; readonly lastRead: string; readonly lastReadLocal: string; readonly bank?: 2; readonly name?: string }
  // 10.13: once per date the bank gave, the setting's days before it, at the
  // review time. ends: the day it runs out, on his clock.
  | { readonly kind: 'bank-permission'; readonly ends: IsoDate; readonly bank?: 2; readonly name?: string }
  // 10.6: once, when it happens.
  | { readonly kind: 'bank-took-back'; readonly id: string; readonly date: IsoDate; readonly description: string; readonly amount: Cents }
  // 10.14 (A49): once per paycheck, the pay period it began, when it is
  // counted. date: the paycheck's day. toSavings: what is still to move into
  // the savings account (3.8), null when the bank cannot be read;
  // extraInSavings: what it holds over what it should. oldCard: the old
  // card's share this payday (9.5), null while the payoff countdown is off.
  | { readonly kind: 'payday'; readonly period: number; readonly date: IsoDate; readonly toSavings: Cents | null; readonly extraInSavings: Cents; readonly oldCard: Cents | null }
  // Her rulebook, 10.15: a paycheck waiting for her yes (3.1, 51.1), once,
  // when it posts. date: the day it arrived; early: less than 10 days after
  // the last paycheck (3.7, 51.3).
  | { readonly kind: 'paycheck-waiting'; readonly id: string; readonly date: IsoDate; readonly amount: Cents; readonly early: boolean };

export type AlertKind = AlertFacts['kind'];

// The alerts that stay true for a while (10.4, 10.5, 10.7). Her second
// bank's 10.5 and 10.7 are kinds of their own (her rulebook, PR 6).
export type LastingKind = 'totals-mismatch' | 'bank-login' | 'bank-not-read' | 'bank-login-2' | 'bank-not-read-2';
export const LASTING_KINDS: readonly LastingKind[] = ['totals-mismatch', 'bank-login', 'bank-not-read', 'bank-login-2', 'bank-not-read-2'];

// The lasting kind a lasting alert is: her second bank's are its own.
export function lastingKindOf(f: Extract<AlertFacts, { kind: 'totals-mismatch' | 'bank-login' | 'bank-not-read' }>): LastingKind {
  if (f.kind === 'totals-mismatch') return f.kind;
  return f.bank === 2 ? `${f.kind}-2` : f.kind;
}

// " bank 2" on her second bank's keys; nothing on the first's, which are upstream's.
const ofBank = (f: { readonly bank?: 2 }): string => (f.bank === 2 ? ' bank 2' : '');

// One alert as it was worked out: kept in the book's history (an "alerts"
// event) and in the outbox, in the same step.
export interface AlertRecord {
  // The same alert always has the same key, so it is kept and sent once.
  readonly key: string;
  readonly facts: AlertFacts;
  // When it came due, as an instant (ISO, UTC): the moment of the sync or
  // answer that made it true, or the evening it is for.
  readonly dueAt: string;
  readonly title: string;
  readonly body: string;
}

// What makes an alert the same alert: its rule's "once".
export function alertKey(f: AlertFacts): string {
  switch (f.kind) {
    case 'low-bucket':
    case 'empty-bucket':
      return `${f.kind} ${f.bucket} pay period ${f.period}`;
    case 'daily-review':
      return `daily-review ${f.date}`;
    case 'card-reminder':
      return `card-reminder ${f.card} due ${f.dueDate} ${f.daysBefore} days before`;
    case 'card-overdue':
      return `card-overdue ${f.card} due ${f.dueDate} on ${f.date}`;
    case 'totals-mismatch':
      return f.again ? `${f.kind} ${f.time} again ${f.day}` : `${f.kind} ${f.time}`;
    case 'bank-login':
      return (f.again ? `${f.kind} ${f.time} again ${f.day}` : `${f.kind} ${f.time}`) + ofBank(f);
    case 'bank-not-read':
      return `bank-not-read ${f.time}${ofBank(f)}`;
    case 'bank-took-back':
      return `bank-took-back ${f.id}`;
    case 'bank-permission':
      return `bank-permission ends ${f.ends}${ofBank(f)}`;
    case 'payday':
      return `payday pay period ${f.period}`;
    case 'paycheck-waiting':
      return `paycheck-waiting ${f.id}`;
  }
}

// Phase 5, the phone: the screen a tap on the alert opens. A bucket's
// alert opens that bucket's list; the daily review, Review; everything else
// Home, where Needs attention says what it is about.
export function alertScreen(f: AlertFacts | null): string {
  if (f === null) return '/alerts';
  switch (f.kind) {
    case 'low-bucket':
    case 'empty-bucket':
      return `/buckets/${f.bucket}`;
    case 'daily-review':
      return '/review';
    // 10.13: where he logs in to the bank again (1.3).
    case 'bank-permission':
      return '/bank';
    // 10.14: what the paycheck did, and what to move.
    case 'payday':
      return '/payday';
    // Her rulebook, 10.15: where she says yes.
    case 'paycheck-waiting':
      return '/review';
    default:
      return '/home';
  }
}

export function alertRecord(facts: AlertFacts, dueAt: string): AlertRecord {
  return { key: alertKey(facts), facts, dueAt, ...alertWords(facts) };
}

const BUCKETS = { needs: 'Needs', wants: 'Wants' } as const;
const CARDS: Readonly<Record<Card, string>> = { 'everyday-card': 'Everyday card', 'old-card': 'Old card', 'second-card': 'Second card' };

// "Fri, Oct 23".
export function dayWords(date: IsoDate): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// "9:00 AM", from a time on his clock as timeIn writes it ("2026-10-02T09:00:00-04:00").
export function clockWords(local: string): string {
  const hour = Number(local.slice(11, 13));
  const minute = local.slice(14, 16);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
}

// What the phone shows: a title and a line. With amounts, as the rules say
// (9.1, 9.2, 10.4): the alerts list in the app always has them. Without them,
// words only, for the lock screen (10.10, A39): the same alert, its amounts
// left out. sentOn, the day it goes on his clock: a card reminder that goes
// out later than its day counts the days to the due date from then (9.7, his
// answer Oct 11, B185); left out, from the day it is for.
export function alertWords(f: AlertFacts, options: { readonly amounts?: boolean; readonly sentOn?: IsoDate } = {}): { readonly title: string; readonly body: string } {
  const amounts = options.amounts ?? true;
  switch (f.kind) {
    case 'low-bucket':
      return { title: `${BUCKETS[f.bucket]} is low`, body: amounts ? `${formatDollars(f.amount)} left of ${formatDollars(f.startedWith)} this pay period.` : 'Open the app to see what is left this pay period.' };
    case 'empty-bucket':
      return {
        title: `${BUCKETS[f.bucket]} is empty`,
        body: f.amount >= 0 ? 'Nothing is left in it for this pay period.' : amounts ? `It is ${formatDollars(-f.amount)} over for this pay period.` : 'It is over for this pay period.',
      };
    case 'daily-review':
      return { title: 'Time to review', body: f.waiting === 1 ? '1 thing is waiting for you to sort.' : `${f.waiting} things are waiting for you to sort.` };
    case 'card-reminder': {
      const left = options.sentOn === undefined ? f.daysBefore : daysBetween(options.sentOn, f.dueDate);
      // Only one the phone could not be given until after the due date goes then (B181).
      const when = left < 0 ? `was due ${left === -1 ? 'yesterday' : `${-left} days ago`}` : `due ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`}`;
      const owed = f.statementBalance === null ? `Minimum ${formatDollars(f.minimumPayment)}.` : `Statement balance ${formatDollars(f.statementBalance)}, minimum ${formatDollars(f.minimumPayment)}.`;
      // Her rulebook, 50.4: Wishlist money still to move from savings to checking.
      const move = f.wishlistMove === undefined ? '' : amounts ? ` Move ${formatDollars(f.wishlistMove)} from savings to checking for Wishlist first.` : ' Move the Wishlist money from savings to checking first.';
      return { title: `${f.name ?? CARDS[f.card]} payment ${when}`, body: amounts ? `${owed} Due ${dayWords(f.dueDate)}.${move}` : `Due ${dayWords(f.dueDate)}.${move}` };
    }
    case 'card-overdue':
      return {
        title: `${f.name ?? CARDS[f.card]} payment is overdue`,
        body: amounts
          ? `The minimum, ${formatDollars(f.minimumPayment)}, was due ${dayWords(f.dueDate)}, and less than that has been paid since the statement.`
          : `The minimum was due ${dayWords(f.dueDate)}, and less than that has been paid since the statement.`,
      };
    case 'totals-mismatch':
      return {
        title: f.again ? 'Your totals still do not match the bank' : 'Your totals do not match the bank',
        body: amounts
          ? `Off by ${formatDollars(Math.abs(f.difference))}: the bank shows ${f.difference < 0 ? 'less' : 'more'} than your buckets add up to. Safe to spend is hidden until they match.`
          : 'Safe to spend is hidden until they match.',
      };
    case 'bank-login':
      if (f.name !== undefined) return { title: `Log in to ${f.name} again`, body: f.again ? `${f.name} still wants you to log in again before the app can read it.` : `${f.name} wants you to log in again before the app can read it.` };
      return { title: 'Log in to your bank again', body: f.again ? 'The bank still wants you to log in again before the app can read it.' : 'The bank wants you to log in again before the app can read it.' };
    case 'bank-took-back':
      return {
        title: 'The bank took something back',
        body: amounts ? `${f.description}, ${formatDollars(f.amount)}, taken back ${dayWords(f.date)}. It is undone in your buckets too.` : `${f.description}, taken back ${dayWords(f.date)}. It is undone in your buckets too.`,
      };
    case 'bank-permission': {
      const left = options.sentOn === undefined ? null : daysBetween(options.sentOn, f.ends);
      const when = left === null ? 'soon' : left <= 0 ? 'today' : left === 1 ? 'by tomorrow' : `within ${left} days`;
      if (f.name !== undefined) return { title: `Log in to ${f.name} again ${when}`, body: `${f.name} lets the app read your accounts until ${dayWords(f.ends)}. Logging in again keeps it reading, and nothing is lost.` };
      return { title: `Log in to your bank again ${when}`, body: `The bank lets the app read your accounts until ${dayWords(f.ends)}. Logging in again keeps it reading, and nothing is lost.` };
    }
    case 'bank-not-read':
      return {
        title: `${f.name ?? 'The bank'} has not been read for ${f.hours} ${f.hours === 1 ? 'hour' : 'hours'}`,
        body: `Last read ${dayWords(f.lastReadLocal.slice(0, 10))} at ${clockWords(f.lastReadLocal)}. Your numbers may be out of date until it is read again.`,
      };
    case 'payday':
      return { title: 'Payday', body: amounts ? paydayAmounts(f) : `Open Payday to see what to move to savings${f.oldCard === null ? '' : ' and pay on the old card'}.` };
    case 'paycheck-waiting': {
      const early = f.early ? ' It came less than 10 days after your last one.' : '';
      return {
        title: 'Paycheck waiting for your yes',
        body: `${amounts ? `${formatDollars(f.amount)} came in` : 'A paycheck came in'} ${dayWords(f.date)}. Nothing is split until you say yes in Review.${early}`,
      };
    }
  }
}

// 10.14: what is still to move to savings (3.8), and the old card's share this payday (9.5).
function paydayAmounts(f: Extract<AlertFacts, { kind: 'payday' }>): string {
  const savings =
    f.toSavings === null
      ? 'Open Payday to see what to move to savings once the bank can be read.'
      : f.toSavings > 0
        ? `Move ${formatDollars(f.toSavings)} to savings.`
        : f.extraInSavings > 0
          ? `Nothing to move to savings: it holds ${formatDollars(f.extraInSavings)} more than it should.`
          : 'Nothing to move to savings.';
  if (f.oldCard === null) return savings;
  return `${savings} ${f.oldCard > 0 ? `Old card: ${formatDollars(f.oldCard)} this payday.` : 'Nothing is owed on the old card.'}`;
}

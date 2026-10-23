import { addDays, type IsoDate } from '@budget-app/money';
import { instantIn, timeIn } from '../history/today.js';
import { alertWords, clockWords, dayWords, type AlertFacts } from './alerts.js';

// Phase 5: what goes to the phone, and when. The alerts are kept at the
// moment they come due (plan.ts); these say whether one may be sent now and
// with which words. Nothing here asks the clock: the moment is handed in.

// 10.8 (QUESTIONS.md A35): quiet hours, on his clock ("HH:MM" from and to, in
// his home time zone). Nothing is sent in them; what comes due then waits
// until they end. The moment they end when `now` is in them; null when it is
// not. The same time twice is no quiet hours at all.
export function quietUntil(zone: string, quiet: { readonly from: string; readonly to: string }, now: Date): Date | null {
  const { from, to } = quiet;
  if (from === to) return null;
  const local = timeIn(zone, now);
  const date = local.slice(0, 10);
  const time = local.slice(11, 16);
  const across = from > to;
  const inThem = across ? time >= from || time < to : time >= from && time < to;
  if (!inThem) return null;
  // Across midnight and already past `from`: they end the next morning.
  return instantIn(zone, across && time >= from ? addDays(date, 1) : date, to);
}

// 10.8, 10.9 (B185): an alert sent later than the minute it came due says when
// it was due, on his clock: "Was due 3:10 AM.", with the day when it was
// another day ("Was due Fri, Oct 2, 9:55 PM."); not "Due" again (his answer,
// Oct 11). Null when it goes in the minute it came due.
export function dueWords(zone: string, dueAt: string, now: Date): string | null {
  const due = timeIn(zone, new Date(dueAt));
  const sent = timeIn(zone, now);
  if (due.slice(0, 16) === sent.slice(0, 16)) return null;
  const day = due.slice(0, 10) === sent.slice(0, 10) ? '' : `${dayWords(due.slice(0, 10))}, `;
  return `Was due ${day}${clockWords(due)}.`;
}

// 10.10 (A39): the words the phone gets, on sentOn, the day it goes on his
// clock. Without amounts on the lock screen (the setting, off to start), the
// alert's words without them; a card reminder counts its days from sentOn
// (9.7, B185). An alert kept before its facts were kept goes with the words
// it was kept with.
export function wordsToSend(kept: { readonly title: string; readonly body: string; readonly facts: AlertFacts | null }, amounts: boolean, sentOn: IsoDate): { readonly title: string; readonly body: string } {
  if (kept.facts === null) return { title: kept.title, body: kept.body };
  return alertWords(kept.facts, { amounts, sentOn });
}

// ----- 10.9 (QUESTIONS.md A40): what waited for the phone -----

// One alert not sent yet, as the outbox has it.
export interface Unsent {
  readonly key: string;
  // Null for one kept before its facts were (database step 6).
  readonly facts: AlertFacts | null;
  readonly dueAt: string;
  readonly createdAt: string;
  // Tries so far: one tried and not sent waited for the phone (it could not
  // be reached, or no phone had notifications on).
  readonly tries: number;
}

// Why one was never sent: a newer one of its kind went, or it was no longer
// true when it could have gone.
export type NotSentWhy = 'newer' | 'not-true';

// The kinds of which only the newest goes (his answer to A40, like 10.9 when
// the app was not running): one daily review, one per card (a reminder and the
// overdue alert together), each bucket's low alert and empty alert on their
// own, one of each lasting alert (10.4, 10.5, 10.7). Each take-back is its own:
// each is something the bank did. One kept before its facts is its own too.
export function sendKindOf(key: string, f: AlertFacts | null): string {
  if (f === null) return key;
  switch (f.kind) {
    case 'card-reminder':
    case 'card-overdue':
      return `card ${f.card}`;
    case 'low-bucket':
    case 'empty-bucket':
      return `${f.kind} ${f.bucket}`;
    case 'bank-took-back':
      return `bank-took-back ${f.id}`;
    // Her rulebook, 10.15: each paycheck waiting is its own.
    case 'paycheck-waiting':
      return `paycheck-waiting ${f.id}`;
    default:
      return f.kind;
  }
}

// What happens to what is not sent yet, at one look (keys, oldest first):
// - go: the newest of each kind, and anything only quiet hours held (never
//   tried: 10.8 says it waits, not that it is dropped, B188);
// - held: older ones of a kind that waited for the phone, behind a newer one:
//   not tried, and replaced when that one goes (replacedBy);
// - notTrue: the newest of a kind that waited for the phone and is no longer
//   true, with the older ones that waited with it: never sent.
export interface SendPlan {
  readonly go: readonly string[];
  readonly held: readonly string[];
  readonly notTrue: readonly string[];
}

const inOrder = (a: Unsent, b: Unsent): number => (a.dueAt !== b.dueAt ? (a.dueAt < b.dueAt ? -1 : 1) : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function planSends(unsent: readonly Unsent[], stillTrue: (f: AlertFacts) => boolean): SendPlan {
  const rows = unsent.toSorted(inOrder);
  const newest = new Map<string, Unsent>();
  for (const row of rows) newest.set(sendKindOf(row.key, row.facts), row);
  const dropped = new Set<string>();
  for (const [kind, row] of newest) if (row.tries > 0 && row.facts !== null && !stillTrue(row.facts)) dropped.add(kind);
  const go: string[] = [];
  const held: string[] = [];
  const notTrue: string[] = [];
  for (const row of rows) {
    const kind = sendKindOf(row.key, row.facts);
    if (dropped.has(kind) && row.tries > 0) notTrue.push(row.key);
    else if (newest.get(kind) === row || row.tries === 0) go.push(row.key);
    else held.push(row.key);
  }
  return { go, held, notTrue };
}

// The ones `sent` replaces once it went: older ones of its kind that waited
// for the phone. "Not sent: a newer one went."
export function replacedBy(unsent: readonly Unsent[], sent: Unsent): string[] {
  const kind = sendKindOf(sent.key, sent.facts);
  return unsent
    .filter((row) => row.key !== sent.key && row.tries > 0 && inOrder(row, sent) < 0 && sendKindOf(row.key, row.facts) === kind)
    .toSorted(inOrder)
    .map((row) => row.key);
}

import { EMPTY_WISHLIST, MoneyError, type BankTransaction, type Book, type Cents, type IsoDate, type SetupInput, type WishlistList } from '@budget-app/money';
import { statement, type Db } from '../db/database.js';
import { NO_ALERTS, applyAlerts, type AlertLedger, type AlertsEvent } from '../alerts/plan.js';
import { applyWishlist } from '../wishlist-items.js';
import { ReplayFailed, bookOfSetup, replayCall, sameTotals, totalsOf, type Answer, type HistoryEvent, type SavedSetupAnswers, type Totals } from './history.js';

// The book's history in the database (table book_events), the decision
// numbers with their first answers (table decisions), and when Home last
// checked safe to spend against the bank (table last_checked). Nothing here
// asks the clock: every date is in what is saved.

export interface StoredEvent {
  readonly seq: number;
  readonly date: IsoDate;
  // The sync that brought it, for what the bank sent.
  readonly sync: number | null;
  readonly event: HistoryEvent;
  // The totals after it; null before setup day, and for events saved before
  // the totals were (they are filled in, once, the first time they replay).
  readonly totals: Totals | null;
  readonly sealed: boolean;
}

interface Row {
  seq: number;
  sync: number | null;
  kind: 'setup' | 'receive' | 'answer' | 'alerts';
  date: string;
  payload: string;
  totals: string | null;
}

// Setup days saved before a setting existed open with a value for it, or the
// books he has would not open after the deploy that adds it (0.6). His real
// setup day was saved on Oct 12, 2026 (history-check.test.ts lists its
// settings). Section 2 (A48): before the pay schedule setting (Oct 14) he was
// paid every so many days, as the app then counted. 10.4 (A47): before the
// wait for "totals do not match" (Oct 14) it was told at once; it opens with
// the 12 hours he OK'd for his books (34b). 9.8 (A52, A53): before the
// statement closing day (Oct 16; the days from statement to due date, Oct 15,
// were never set on his books) there was none; until he sets it, a card the
// bank sends no statement date for has its reminders off, as it had.
function savedSetup(input: SetupInput): SetupInput {
  const settings = input.settings as Partial<SetupInput['settings']>;
  const missing: Partial<SetupInput['settings']> = {
    ...(settings.paySchedule === undefined ? { paySchedule: 'every-n-days' } : {}),
    ...(settings.totalsMismatchAlertHours === undefined ? { totalsMismatchAlertHours: 12 } : {}),
    ...(settings.everydayCardClosingDay === undefined ? { everydayCardClosingDay: null } : {}),
    ...(settings.oldCardClosingDay === undefined ? { oldCardClosingDay: null } : {}),
  };
  return Object.keys(missing).length === 0 ? input : { ...input, settings: { ...input.settings, ...missing } };
}

// Setup day's input as it was saved (read the way readHistory reads it), or
// null before setup day. For the Trends tab (40.3): the last paycheck he gave
// and the charges counted as pending that day.
export function readSetupInput(db: Db): SetupInput | null {
  const row = statement(db, "SELECT payload FROM book_events WHERE kind = 'setup' ORDER BY seq LIMIT 1").get() as { payload: string } | undefined;
  return row === undefined ? null : savedSetup(JSON.parse(row.payload) as SetupInput);
}

export function readHistory(db: Db): StoredEvent[] {
  const rows = db.prepare('SELECT seq, sync, kind, date, payload, totals FROM book_events ORDER BY seq').all() as Row[];
  return rows.map((row) => {
    const payload = JSON.parse(row.payload) as unknown;
    const event: HistoryEvent =
      row.kind === 'setup'
        ? { kind: 'setup', input: savedSetup(payload as SetupInput) }
        : row.kind === 'receive'
          ? { kind: 'receive', txn: payload as BankTransaction }
          : row.kind === 'alerts'
            ? { kind: 'alerts', alerts: payload as AlertsEvent }
            : { kind: 'answer', answer: payload as Answer };
    const totals = row.totals === null ? null : (JSON.parse(row.totals) as Totals | null);
    return { seq: row.seq, date: row.date, sync: row.sync, event, totals, sealed: row.totals !== null };
  });
}

// Adds one event at the end of the history, with the totals after it.
// Returns its number.
export function appendEvent(db: Db, e: { readonly event: HistoryEvent; readonly date: IsoDate; readonly sync: number | null; readonly totals: Totals | null }): number {
  const payload = e.event.kind === 'setup' ? e.event.input : e.event.kind === 'receive' ? e.event.txn : e.event.kind === 'alerts' ? e.event.alerts : e.event.answer;
  const info = db.prepare('INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (?, ?, ?, ?, ?)').run(e.sync, e.event.kind, e.date, JSON.stringify(payload), JSON.stringify(e.totals));
  return Number(info.lastInsertRowid);
}

// The number of the last event in the history; 0 before the first.
export function lastSeqOf(db: Db): number {
  const row = statement(db, 'SELECT MAX(seq) AS seq FROM book_events').get() as { seq: number | null };
  return row.seq ?? 0;
}

// ----- Replaying -----

// What the history comes to.
export interface Replayed {
  readonly book: Book | null;
  // 10.6: the take-backs he marked seen.
  readonly seen: Set<string>;
  // Setup day, before tracking starts: his answers so far; null before the first.
  readonly setupAnswers: SavedSetupAnswers | null;
  // Phase 5: the alerts given so far, and the evenings handled.
  readonly alerts: AlertLedger;
  // Her rulebook, 50.1 to 50.3: her Wishlist list as the answers left it.
  readonly wishlist: WishlistList;
  // Events saved before their totals were, with the totals they replay to.
  readonly unsealed: readonly { readonly seq: number; readonly totals: Totals | null }[];
}

// The history does not replay to what was saved: a change to the code would
// rewrite the past. At names the first event that differs.
export class HistoryDoesNotReplay extends Error {
  readonly at: { readonly seq: number; readonly kind: HistoryEvent['kind']; readonly date: IsoDate };
  readonly saved: Totals | null;
  readonly replayed: Totals | null;

  constructor(at: StoredEvent, why: string, saved: Totals | null, replayed: Totals | null) {
    super(`The history does not replay to what was saved, at event ${at.seq} (${describeEvent(at)}, ${at.date}): ${why}`);
    this.name = 'HistoryDoesNotReplay';
    this.at = { seq: at.seq, kind: at.event.kind, date: at.date };
    this.saved = saved;
    this.replayed = replayed;
  }
}

// What an event was, in words.
export function describeEvent(e: StoredEvent): string {
  switch (e.event.kind) {
    case 'setup':
      return 'setup day';
    case 'receive':
      return `from the bank: ${e.event.txn.kind} ${e.event.txn.id}`;
    case 'answer': {
      const a = e.event.answer;
      const parts = [
        ...(a.book ?? []).map((c) => c.method),
        ...(a.seen === undefined ? [] : ['seen']),
        ...(a.bankRules === undefined ? [] : ['a bank rule']),
        ...(a.setup === undefined ? [] : ['a setup day answer']),
        ...(a.wishlist === undefined ? [] : ['the Wishlist list']),
      ];
      return `his answer: ${parts.join(', ') || 'nothing'}`;
    }
    case 'alerts': {
      const a = e.event.alerts;
      const what = a.check.kind === 'evening' ? `the evening of ${a.check.date}` : a.check.kind === 'start' ? 'the start' : 'a change';
      return `alerts for ${what}: ${a.given.map((g) => g.key).join(', ') || 'none'}`;
    }
  }
}

// Replays every event, in order. With check, the totals after each event
// must be the ones saved with it; the first that differs, or an event the
// code refuses now, stops it (HistoryDoesNotReplay).
export function replayHistory(events: readonly StoredEvent[], check: boolean): Replayed {
  const unsealed: { seq: number; totals: Totals | null }[] = [];
  // Without the check, no totals are worked out: that takes time on every event.
  const replayed = replayEach(
    events,
    check
      ? (stored, now) => {
          if (!stored.sealed) unsealed.push({ seq: stored.seq, totals: now });
          else if (!sameTotals(stored.totals, now)) throw new HistoryDoesNotReplay(stored, 'the totals differ', stored.totals, now);
        }
      : null,
  );
  if (!replayed.ok) throw new HistoryDoesNotReplay(replayed.at, replayed.why, replayed.at.totals, null);
  return { ...replayed.replayed, unsealed };
}

// Replays every event, in order, telling `after` (when given) the totals each
// one comes to. An event the code refuses now stops it, and says which
// (QUESTIONS.md A28: new totals cannot fix that).
export function replayEach(
  events: readonly StoredEvent[],
  after: ((stored: StoredEvent, totals: Totals | null) => void) | null,
): { readonly ok: true; readonly replayed: Omit<Replayed, 'unsealed'> } | { readonly ok: false; readonly at: StoredEvent; readonly why: string } {
  let book: Book | null = null;
  const seen = new Set<string>();
  let setupAnswers: SavedSetupAnswers | null = null;
  let alerts = NO_ALERTS;
  let wishlist = EMPTY_WISHLIST;
  for (const stored of events) {
    try {
      // Phase 5: an alert given twice, or an evening out of turn, is a
      // history that cannot be replayed.
      if (stored.event.kind === 'alerts') {
        if (book === null) throw new ReplayFailed('alerts before setup day');
        alerts = applyAlerts(alerts, stored.event.alerts);
      }
      book = applyEvent(book, stored.event, seen, (answers) => {
        setupAnswers = answers;
      });
      if (stored.event.kind === 'answer' && stored.event.answer.wishlist !== undefined) wishlist = applyWishlist(wishlist, stored.event.answer.wishlist, stored.date);
    } catch (error) {
      if (error instanceof ReplayFailed || error instanceof MoneyError) return { ok: false, at: stored, why: error.message };
      throw error;
    }
    after?.(stored, totalsOf(book));
  }
  return { ok: true, replayed: { book, seen, setupAnswers, alerts, wishlist } };
}

function applyEvent(book: Book | null, event: HistoryEvent, seen: Set<string>, setSetup: (answers: SavedSetupAnswers) => void): Book | null {
  switch (event.kind) {
    case 'setup':
      if (book !== null) throw new ReplayFailed('a second setup day');
      return bookOfSetup(event.input);
    case 'receive':
      if (book === null) throw new ReplayFailed('the bank sent something to the book before setup day');
      book.receive(event.txn);
      return book;
    case 'answer': {
      const a = event.answer;
      if (a.book !== undefined) {
        if (book === null) throw new ReplayFailed('an answer to the book before setup day');
        for (const call of a.book) replayCall(book, call);
      }
      if (a.seen !== undefined) seen.add(a.seen);
      if (a.setup !== undefined) setSetup(a.setup);
      return book;
    }
    case 'alerts':
      // Nothing in the book: replayEach keeps the alerts given.
      return book;
  }
}

// Fills in the totals of events saved before the totals were, with what
// they replay to. Done once; they are checked from then on.
export function sealHistory(db: Db, unsealed: Replayed['unsealed']): void {
  if (unsealed.length === 0) return;
  const update = db.prepare('UPDATE book_events SET totals = ? WHERE seq = ? AND totals IS NULL');
  db.transaction(() => {
    for (const u of unsealed) update.run(JSON.stringify(u.totals), u.seq);
  })();
}

// ----- Decision numbers -----

export type DeskName = 'choice' | 'move' | 'settings' | 'rule' | 'setup' | 'bank-rule';

export interface Decision {
  readonly id: string;
  readonly desk: DeskName;
  // The request, written the same way whatever order its keys came in.
  readonly fingerprint: string;
  // The first answer, as sent to the phone.
  readonly answer: unknown;
  // The event it made.
  readonly seq: number;
}

export function readDecision(db: Db, id: string): Decision | null {
  const row = db.prepare('SELECT id, desk, fingerprint, answer, seq FROM decisions WHERE id = ?').get(id) as { id: string; desk: DeskName; fingerprint: string; answer: string; seq: number } | undefined;
  return row === undefined ? null : { ...row, answer: JSON.parse(row.answer) as unknown };
}

export function saveDecision(db: Db, d: Decision): void {
  db.prepare('INSERT INTO decisions (id, desk, fingerprint, answer, seq) VALUES (?, ?, ?, ?, ?)').run(d.id, d.desk, d.fingerprint, JSON.stringify(d.answer), d.seq);
}

// ----- When Home last checked safe to spend (0.5, B82) -----

export function readLastChecked(db: Db): { readonly amount: Cents; readonly at: string } | null {
  const row = db.prepare('SELECT amount, at FROM last_checked WHERE id = 1').get() as { amount: number; at: string } | undefined;
  return row === undefined ? null : { amount: row.amount, at: row.at };
}

export function saveLastChecked(db: Db, checked: { readonly amount: Cents; readonly at: string }): void {
  db.prepare('INSERT INTO last_checked (id, amount, at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET amount = excluded.amount, at = excluded.at').run(checked.amount, checked.at);
}

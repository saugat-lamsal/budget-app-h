import { addCents, assertCents, assertCentsAtLeastZero, type Cents } from './cents.js';
import { assertIsoDate, daysBetween, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import type { Settings } from './settings.js';
import { paydaysAfter } from './payday.js';

// Rulebook section 9: what the card reminders say, and when. Sending them
// to the phone is Phase 5; this only works out what is due on a given day.
// Her rulebook, 9.1 and 9.3: her second card is reminded about exactly like
// the everyday card, each card with its own statement.

// The cards used day to day: the everyday card, and her second card.
export type EverydayCard = 'everyday-card' | 'second-card';

const isEverydayCard = (card: CardStatement['card']): card is EverydayCard => card === 'everyday-card' || card === 'second-card';

export interface CardStatement {
  readonly card: EverydayCard | 'old-card';
  // The statement date. Payments after it count toward this statement.
  readonly closingDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly statementBalance: Cents;
  readonly minimumPayment: Cents;
}

export interface CardPayment {
  // The day the payment left checking or savings (or the only day seen).
  readonly date: IsoDate;
  readonly amount: Cents;
  // The day it reached the card: null while it is still on its way, left
  // out when it is the same day as date (12.5).
  readonly landedOn?: IsoDate | null;
}

export type CardNotice =
  | {
      readonly kind: 'reminder';
      readonly card: EverydayCard;
      readonly daysBefore: number;
      readonly dueDate: IsoDate;
      readonly statementBalance: Cents;
      readonly minimumPayment: Cents;
    }
  | {
      readonly kind: 'reminder';
      readonly card: 'old-card';
      readonly daysBefore: number;
      readonly dueDate: IsoDate;
      readonly minimumPayment: Cents;
    }
  | {
      readonly kind: 'overdue';
      readonly card: EverydayCard | 'old-card';
      readonly dueDate: IsoDate;
      readonly minimumPayment: Cents;
    };

export function cardNotices(today: IsoDate, statement: CardStatement, payments: readonly CardPayment[], settings: Settings): CardNotice[] {
  const { card, dueDate, statementBalance, minimumPayment } = statement;
  const { paid, toPay } = paidAgainst(today, statement, payments);
  const daysLeft = daysBetween(today, dueDate);
  if (daysLeft < 0) {
    // 9.4: the due date passed and the payments since the statement add up
    // to less than the minimum. The same on both cards (A6).
    const overdue = paid < minimumPayment;
    return overdue ? [{ kind: 'overdue', card, dueDate, minimumPayment }] : [];
  }
  // 9.3: payments since the statement add up toward what has to be paid.
  if (paid >= toPay) return [];
  if (!settings.cardReminderDaysBefore.includes(daysLeft)) return [];
  // 9.1 and 9.2: the everyday card shows its statement balance; the old card does not.
  return isEverydayCard(card)
    ? [{ kind: 'reminder', card, daysBefore: daysLeft, dueDate, statementBalance, minimumPayment }]
    : [{ kind: 'reminder', card, daysBefore: daysLeft, dueDate, minimumPayment }];
}

// What the app has seen paid toward a statement, and what has to be paid
// for the reminders to stop (9.3). On the everyday card that is the full
// statement balance (paying less means interest on the rest); on the old
// card it is the minimum. Her rulebook, 52.1: Home shows what is paid.
export function paidAgainst(today: IsoDate, statement: CardStatement, payments: readonly CardPayment[]): { readonly paid: Cents; readonly toPay: Cents } {
  assertIsoDate(today, 'today');
  checkStatement(statement);
  const { card, closingDate, statementBalance, minimumPayment } = statement;
  // Payments the app has seen for this statement. A payment belongs to the
  // statement whose date it reached the card after, the way the card applies
  // it; one still on its way will land after it. It counts as seen from the
  // day it left (12.5).
  const seen = payments.filter((p) => {
    assertIsoDate(p.date, 'payment date');
    assertCents(p.amount, 'payment amount');
    const landed = p.landedOn === undefined ? p.date : p.landedOn;
    if (landed !== null) assertIsoDate(landed, 'landing date');
    const forThisStatement = landed === null || daysBetween(closingDate, landed) > 0;
    return forThisStatement && daysBetween(p.date, today) >= 0;
  });
  return { paid: addCents(0, ...seen.map((p) => p.amount)), toPay: isEverydayCard(card) ? statementBalance : minimumPayment };
}

// Rule 9.6 (QUESTIONS.md A17): what Home shows about a card payment. Due on
// every day from the first reminder day through the due date, until the
// payments seen add up to what 9.3 asks for; past the due date, overdue as
// in 9.4. The phone reminders still come only on the reminder days.
export type CardDue =
  | {
      readonly kind: 'due';
      readonly card: EverydayCard;
      readonly daysLeft: number;
      readonly dueDate: IsoDate;
      readonly statementBalance: Cents;
      readonly minimumPayment: Cents;
    }
  | { readonly kind: 'due'; readonly card: 'old-card'; readonly daysLeft: number; readonly dueDate: IsoDate; readonly minimumPayment: Cents }
  | { readonly kind: 'overdue'; readonly card: EverydayCard | 'old-card'; readonly dueDate: IsoDate; readonly minimumPayment: Cents };

export function cardDue(today: IsoDate, statement: CardStatement, payments: readonly CardPayment[], settings: Settings): CardDue | null {
  const { card, dueDate, statementBalance, minimumPayment } = statement;
  const { paid, toPay } = paidAgainst(today, statement, payments);
  const daysLeft = daysBetween(today, dueDate);
  if (daysLeft < 0) return paid < minimumPayment ? { kind: 'overdue', card, dueDate, minimumPayment } : null;
  const firstReminder = Math.max(-1, ...settings.cardReminderDaysBefore);
  if (daysLeft > firstReminder || paid >= toPay) return null;
  return isEverydayCard(card)
    ? { kind: 'due', card, daysLeft, dueDate, statementBalance, minimumPayment }
    : { kind: 'due', card, daysLeft, dueDate, minimumPayment };
}

function checkStatement(statement: CardStatement): void {
  if (!isEverydayCard(statement.card) && statement.card !== 'old-card') {
    throw new MoneyError('bad-statement', `reminders are for the everyday card, the second card or the old card, not ${String(statement.card)}`);
  }
  assertIsoDate(statement.closingDate, 'statement date');
  assertIsoDate(statement.dueDate, 'due date');
  if (daysBetween(statement.closingDate, statement.dueDate) < 0) throw new MoneyError('bad-statement', 'the due date is before the statement date');
  assertCents(statement.statementBalance, 'statement balance');
  assertCentsAtLeastZero(statement.minimumPayment, 'minimum payment');
}

// Rule 9.5 (QUESTIONS.md A7): what the old card owes, divided by the paydays
// left before the promo ends. Paydays follow the pay schedule from the last
// paycheck, and only those after today and before the end date count. Each
// share is rounded up to the cent, so the last payment comes out a little
// smaller. With no paydays left, all of it is due now; with nothing owed,
// nothing is. Off until the promo end date is entered (section 16).
export type PayoffCountdown =
  | { readonly on: false; readonly reason: 'no-promo-end-date' }
  | { readonly on: true; readonly owed: Cents; readonly promoEndDate: IsoDate; readonly paydaysLeft: number; readonly perPayday: Cents };

export function payoffCountdown(book: { settings(): Settings; oldCardDebt(): Cents; lastPaycheckDate(): IsoDate }, today: IsoDate): PayoffCountdown {
  assertIsoDate(today, 'today');
  const settings = book.settings();
  const end = settings.oldCardPromoEndDate;
  if (end === null) return { on: false, reason: 'no-promo-end-date' };
  const owed = book.oldCardDebt();
  assertCents(owed, 'old card debt');
  let paydaysLeft = 0;
  for (const payday of paydaysAfter(book.lastPaycheckDate(), settings)) {
    if (daysBetween(payday, end) <= 0) break;
    if (daysBetween(today, payday) > 0) paydaysLeft += 1;
  }
  let perPayday: Cents;
  if (owed <= 0) perPayday = 0;
  else if (paydaysLeft === 0) perPayday = owed;
  else {
    const rest = owed % paydaysLeft;
    perPayday = (owed - rest) / paydaysLeft + (rest === 0 ? 0 : 1);
  }
  return { on: true, owed, promoEndDate: end, paydaysLeft, perPayday };
}

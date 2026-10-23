import { MoneyError, assertIsoDate, daysBetween, type CardStatement, type IsoDate, type Settings } from '@budget-app/money';
import { BankDataError } from '../errors.js';
import type { PlaidCreditCard } from '../plaid/types.js';
import { centsFromPlaid } from './amounts.js';

// Section 9: what the card reminders need, from Plaid's Liabilities answer.
// The statement date is the day the last statement was issued; payments the
// card gets after it count toward that statement (9.3).
// 9.8 (A52, A53): Bank of America sends no statement date; it is then the
// last day before the due date on closingDay, the day of the month set for
// that card (null: not set yet, and there is no statement). The bank's own
// date wins when it sends one.
export type StatementResult = { readonly ok: true; readonly statement: CardStatement } | { readonly ok: false; readonly why: string };

export function cardStatement(card: 'everyday-card' | 'old-card' | 'second-card', raw: PlaidCreditCard, closingDay: number | null = null): StatementResult {
  try {
    const dueDate = date(raw.next_payment_due_date, 'due date');
    const closingDate = raw.last_statement_issue_date === null && closingDay !== null ? closingDateBefore(dueDate, closingDay) : date(raw.last_statement_issue_date, 'statement date');
    if (daysBetween(closingDate, dueDate) < 0) throw new BankDataError('the due date is before the statement date');
    if (raw.last_statement_balance === null) throw new BankDataError('the bank did not give the statement balance');
    if (raw.minimum_payment_amount === null) throw new BankDataError('the bank did not give the minimum payment');
    const statementBalance = centsFromPlaid(raw.last_statement_balance, 'statement balance');
    const minimumPayment = centsFromPlaid(raw.minimum_payment_amount, 'minimum payment');
    if (minimumPayment < 0) throw new BankDataError('the minimum payment is below zero');
    return { ok: true, statement: { card, closingDate, dueDate, statementBalance, minimumPayment } };
  } catch (error) {
    if (error instanceof BankDataError || error instanceof MoneyError) return { ok: false, why: error.message };
    throw error;
  }
}

// 9.8: the closing day set for a card (section 2); her second card has its own.
export function closingDayOf(card: 'everyday-card' | 'old-card' | 'second-card', settings: Settings): number | null {
  if (card === 'second-card') return settings.secondCardClosingDay ?? null;
  return card === 'everyday-card' ? settings.everydayCardClosingDay : settings.oldCardClosingDay;
}

// The order the cards are listed in: the everyday card, her second card, the old card.
export const CARD_ORDER: readonly ('everyday-card' | 'old-card' | 'second-card')[] = ['everyday-card', 'second-card', 'old-card'];

// 9.8 (A53): the last day before the due date that falls on the closing
// day; in a month too short for that day, the month's last day. month is
// 1 to 12, and 0 is the December before (Date.UTC carries it over).
function closingDateBefore(dueDate: IsoDate, closingDay: number): IsoDate {
  const [year = 0, month = 0] = dueDate.split('-').map(Number);
  const onClosingDay = (m: number): IsoDate => {
    const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return new Date(Date.UTC(year, m - 1, Math.min(closingDay, lastDay))).toISOString().slice(0, 10);
  };
  const sameMonth = onClosingDay(month);
  return daysBetween(sameMonth, dueDate) > 0 ? sameMonth : onClosingDay(month - 1);
}

function date(value: string | null, what: string): string {
  if (value === null) throw new BankDataError(`the bank did not give the ${what}`);
  assertIsoDate(value, what);
  return value;
}

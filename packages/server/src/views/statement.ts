import { cardStatementView, daysBetween, type BeforeSetupLine, type Book, type CardStatement, type EverydayCard, type IsoDate, type StatementView } from '@budget-app/money';
import { cardStatement } from '../bank/statements.js';
import { readPlaidItem } from '../bank/plaid-item.js';
import { readBankItem, type BankRule } from '../bank/reading.js';
import type { StoredItem } from '../sync/plan.js';
import type { PlaidCreditCard } from '../plaid/types.js';
import type { CardRemindersOff } from './home.js';

// Her rulebook, 52.4 and 52.5 (PR 7+8): the Statement screen, one card's last
// statement, opened from its row on Home. Worked out here from the kept
// statements, the book and the bank history; the screen only formats it. It
// only reads.

export type StatementScreenView =
  | { readonly state: 'ready'; readonly today: IsoDate; readonly madeUpData: boolean; readonly statement: StatementView }
  // No statement of this card can be read yet: none has come, or its
  // reminders are off for want of its statement date (9.8).
  | { readonly state: 'no-statement'; readonly madeUpData: boolean; readonly card: EverydayCard; readonly why: CardRemindersOff['why'] | 'none-yet' }
  // Upstream's setup has no section 52.
  | { readonly state: 'off' };

export interface StatementScreenInput {
  readonly today: IsoDate;
  readonly card: EverydayCard;
  // Every statement kept for the card's account (52.5), as the bank sent them.
  readonly kept: readonly PlaidCreditCard[];
  // The card's closing day (9.8), for a bank that sends no statement date.
  readonly closingDay: number | null;
  // Null before setup day.
  readonly book: Book | null;
  // The bank's own items, for the days they posted, and those from before
  // setup day, read by today's bank rules (40.1).
  readonly items: ReadonlyMap<string, StoredItem>;
  // The card's Plaid account.
  readonly accountId: string;
  readonly bankRules: readonly BankRule[];
  readonly madeUpData: boolean;
}

export function statementScreenView(input: StatementScreenInput): StatementScreenView {
  const { card, madeUpData } = input;
  // Each statement read as the reminders read it; the latest of each statement date.
  const byDate = new Map<IsoDate, CardStatement>();
  let unreadable = false;
  for (const raw of input.kept) {
    const read = cardStatement(card, raw, input.closingDay);
    if (read.ok) byDate.set(read.statement.closingDate, read.statement);
    else unreadable = true;
  }
  const read = [...byDate.values()].sort((a, b) => daysBetween(b.closingDate, a.closingDate));
  const statement = read.at(-1);
  if (statement === undefined) return { state: 'no-statement', madeUpData, card, why: !unreadable ? 'none-yet' : input.closingDay === null ? 'no-statement-date' : 'unreadable' };

  // The day the bank posted each of its items on this card.
  const postedOn = new Map<string, IsoDate>();
  const beforeSetup: BeforeSetupLine[] = [];
  for (const item of input.items.values()) {
    if (item.accountId !== input.accountId) continue;
    const plaid = readPlaidItem(item.raw);
    if (!plaid.ok) continue;
    postedOn.set(item.transactionId, plaid.item.date);
    if (item.status !== 'history' || item.removed || item.pending || plaid.item.amount === 0) continue;
    const reading = readBankItem(card, plaid.item.amount, plaid.item.description, input.bankRules);
    beforeSetup.push({ id: item.transactionId, date: plaid.item.day, postedOn: plaid.item.date, description: plaid.item.description, amount: plaid.item.amount, payment: reading.kind === 'transfer-arrived' });
  }
  const view = cardStatementView({ statement, before: read.at(-2) ?? null, book: input.book, postedOn: (id) => postedOn.get(id) ?? null, beforeSetup });
  return { state: 'ready', today: input.today, madeUpData, statement: view };
}

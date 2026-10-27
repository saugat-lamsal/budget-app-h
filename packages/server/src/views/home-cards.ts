import { cardDue, daysBetween, paidAgainst, setAside, type BankBalances, type Book, type CardStatement, type Cents, type EverydayCard, type IsoDate } from '@budget-app/money';
import { cardPaymentsSeen, type PaidBeforeSetup } from '../bank/paid-before-setup.js';
import type { CardRemindersOff, HomeView } from './home.js';

// Her rulebook, 52.1 to 52.3 (PR 7+8): each card on Home. Its statement
// balance and due date, what the payments since the statement have paid
// toward it (9.3), what it owes now in all, and how much of that is set aside
// (52.2); due from the first reminder day, overdue after the due date, in
// words (9.6); and, with its reminders off (9.8), that instead. Upstream's
// setup has none of this: its Home is upstream's.

export interface HomeCardsInput {
  // What each card owed on setup day (52.2, owedAtSetup).
  readonly atSetup: Readonly<Partial<Record<EverydayCard, Cents>>>;
  // 9.3 (her rulebook, 60i): each card's payments from before setup day.
  readonly paidBeforeSetup?: PaidBeforeSetup;
}

type Tracking = Extract<HomeView, { state: 'tracking' }>;

// Home as her setup sends it: upstream's Home, with the cards added to it
// (views/home.ts stays upstream's; the keeper adds them, withCards).
export type HomeWithCards = Exclude<HomeView, Tracking> | (Tracking & { readonly cards?: HomeCards });

export function withCards(view: HomeView, cards: HomeCards | null): HomeWithCards {
  return view.state !== 'tracking' || cards === null ? view : { ...view, cards };
}

export type HomeCardState =
  // 9.6: from the first reminder day until paid.
  | { readonly kind: 'due'; readonly daysLeft: number }
  // 9.4: the due date passed with less than the minimum paid.
  | { readonly kind: 'overdue' }
  // 9.3: the payments since the statement add up to all of it.
  | { readonly kind: 'paid' }
  // Before the first reminder day.
  | { readonly kind: 'not-due-yet' }
  // After the due date, the minimum paid but not all of it.
  | { readonly kind: 'minimum-paid' };

export interface HomeCard {
  readonly card: EverydayCard;
  // 52.2: what it owes now as the app counts it, and all of that set aside
  // (nothing for a card that owes less than nothing, HB12).
  readonly owes: Cents;
  readonly setAside: Cents;
  readonly statement:
    | {
        readonly shown: true;
        readonly closingDate: IsoDate;
        readonly dueDate: IsoDate;
        readonly statementBalance: Cents;
        readonly minimumPayment: Cents;
        // 9.3: what the payments since the statement have paid toward it.
        readonly paid: Cents;
        readonly state: HomeCardState;
      }
    // 9.8: its reminders are off, and why; or no statement has come yet.
    | { readonly shown: false; readonly why: CardRemindersOff['why'] | 'none-yet' };
}

export interface HomeCards {
  readonly cards: readonly HomeCard[];
  readonly total: Cents;
  // 52.2: how much of what is set aside is in savings rather than checking;
  // null while the bank cannot be read.
  readonly inSavings: Cents | null;
}

export function homeCards(input: HomeCardsInput, today: IsoDate, book: Book, bank: BankBalances | null, statements: readonly CardStatement[], cardsOff: readonly CardRemindersOff[]): HomeCards {
  const settings = book.settings();
  const aside = setAside(book, input.atSetup, bank?.savings ?? null);
  const cards = aside.cards.map((c): HomeCard => {
    const statement = statements.find((s) => s.card === c.card);
    const off = cardsOff.find((o) => o.card === c.card);
    if (statement === undefined || off !== undefined) return { ...c, statement: { shown: false, why: off?.why ?? 'none-yet' } };
    const payments = cardPaymentsSeen(book, c.card, input.paidBeforeSetup);
    const { paid } = paidAgainst(today, statement, payments);
    const due = cardDue(today, statement, payments, settings);
    const state: HomeCardState =
      due !== null
        ? due.kind === 'due'
          ? { kind: 'due', daysLeft: due.daysLeft }
          : { kind: 'overdue' }
        : paid >= statement.statementBalance
          ? { kind: 'paid' }
          : daysBetween(today, statement.dueDate) < 0
            ? { kind: 'minimum-paid' }
            : { kind: 'not-due-yet' };
    const { closingDate, dueDate, statementBalance, minimumPayment } = statement;
    return { ...c, statement: { shown: true, closingDate, dueDate, statementBalance, minimumPayment, paid, state } };
  });
  return { cards, total: aside.total, inSavings: aside.inSavings };
}

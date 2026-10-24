import { subtractCents, type Cents, type InTransit, type Pots, type SelfCheck } from '@budget-app/money';
import { bankView, type BankViewResult } from './bank/balances.js';
import { cardStatement, closingDayOf, type StatementResult } from './bank/statements.js';
import type { Db } from './db/database.js';
import { connectionsOf } from './bank/connections.js';
import { loadBook, readAccounts, readAttention, readItems, readStatements } from './db/store.js';

// Where things stand, from what is saved: the self-check against the bank's
// balances (section 12), the old card debt against the old card's balance,
// money in transit, the card statements, and what waits for his decision.
export interface BankStatus {
  readonly connected: boolean;
  // 10.5
  readonly needsLogin: boolean;
  readonly historyComplete: boolean;
  // Setup day is done.
  readonly tracking: boolean;
  readonly bank: BankViewResult | null;
  // 12.3: null before setup day, or when the bank side cannot be worked out.
  readonly selfCheck: SelfCheck | null;
  // 12.4: tracked on its own, not part of the self-check.
  readonly oldCard: { readonly book: Cents; readonly bank: Cents; readonly difference: Cents } | null;
  readonly inTransit: InTransit | null;
  readonly pots: Pots | null;
  readonly waitingInReview: number;
  readonly statements: readonly { readonly card: 'everyday-card' | 'old-card' | 'second-card'; readonly result: StatementResult }[];
  readonly attention: readonly { readonly sync: number; readonly transactionId: string | null; readonly what: string }[];
}

export function bankStatus(db: Db): BankStatus {
  // Her setup: both of her banks (her rulebook, 1.1).
  const connections = connectionsOf(db);
  const book = loadBook(db);
  const accounts = readAccounts(db);
  const bank = connections.length === 0 || accounts.length === 0 ? null : bankView(accounts, readItems(db));
  const stored = readStatements(db);
  const statements = accounts.flatMap((a) => {
    const raw = stored.get(a.plaidAccountId)?.raw;
    if ((a.role !== 'everyday-card' && a.role !== 'old-card' && a.role !== 'second-card') || raw === undefined) return [];
    // 9.8: read with the statement closing day set for that card.
    const closingDay = book === null ? null : closingDayOf(a.role, book.settings());
    return [{ card: a.role, result: cardStatement(a.role, raw, closingDay) }];
  });
  const selfCheck = book !== null && bank !== null && bank.ok ? book.selfCheck(bank.view.withPending) : null;
  const oldCard =
    book !== null && bank !== null && bank.ok
      ? { book: book.oldCardDebt(), bank: bank.view.oldCardWithPending, difference: subtractCents(bank.view.oldCardWithPending, book.oldCardDebt()) }
      : null;
  return {
    connected: connections.length > 0,
    needsLogin: connections.some((c) => c.needsLogin),
    historyComplete: connections.length > 0 && connections.every((c) => c.historyComplete),
    tracking: book !== null,
    bank,
    selfCheck,
    oldCard,
    inTransit: book?.inTransit() ?? null,
    pots: book?.pots() ?? null,
    waitingInReview: book?.reviewItems().length ?? 0,
    statements: statements.sort((a, b) => a.card.localeCompare(b.card)),
    attention: readAttention(db),
  };
}

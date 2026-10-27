import { daysBetween, type AccountId, type Book, type CardPayment, type CardStatement } from '@budget-app/money';
import type { StoredItem } from '../sync/plan.js';
import { readPlaidItem } from './plaid-item.js';
import { readBankItem, type BankRule } from './reading.js';

// Rule 9.3 (her rulebook, 60i; docs/her-questions.txt HA9): the payments the
// app sees toward a card's statement are the books' (from setup day on) and
// the ones that reached the card before setup day, read from the bank history
// the app keeps by today's bank rules, as the statement reads them (52.4,
// HB18): a credit on the card that a bank rule reads as a transfer from
// checking or savings. Each counts from the day it posted, the day it reached
// the card, so 9.3's statement it belongs to is worked out as for any other
// (B28). Both setups. It only reads.

type Card = CardStatement['card'];

export type PaidBeforeSetup = Readonly<Partial<Record<Card, readonly CardPayment[]>>>;

const isCard = (account: AccountId | undefined): account is Card => account === 'everyday-card' || account === 'old-card' || account === 'second-card';

// Each card's payments in the history: what the bank sent before setup day,
// posted and kept (status history). One still pending, or one the bank
// removed, is not one.
export function paidBeforeSetup(items: ReadonlyMap<string, StoredItem>, roles: ReadonlyMap<string, AccountId>, bankRules: readonly BankRule[]): PaidBeforeSetup {
  const paid: Partial<Record<Card, CardPayment[]>> = {};
  for (const item of items.values()) {
    if (item.status !== 'history' || item.removed || item.pending) continue;
    const card = roles.get(item.accountId);
    const read = readPlaidItem(item.raw);
    if (!isCard(card) || !read.ok) continue;
    if (readBankItem(card, read.item.amount, read.item.description, bankRules).kind !== 'transfer-arrived') continue;
    (paid[card] ??= []).push({ date: read.item.date, amount: -read.item.amount, landedOn: read.item.date });
  }
  return paid;
}

// The payments seen toward a card's statements (9.3, 9.4, 9.6; her rulebook,
// 52.1): the books' and the history's, oldest first, as the books list theirs.
export function cardPaymentsSeen(book: Book, card: Card, before: PaidBeforeSetup | undefined): CardPayment[] {
  return [...book.cardPayments(card), ...(before?.[card] ?? [])].sort((a, b) => daysBetween(b.date, a.date));
}

import type { Book } from './book.js';
import { addCents, assertCents, subtractCents, type Cents } from './cents.js';
import type { EverydayCard } from './reminders.js';
import { withPendingCharges, type BankBalances } from './self-check.js';
import type { Purchase, SavingsWithdrawal } from './transactions.js';

// Her rulebook, 52.2 (PR 7+8): set aside. Every purchase on a card already
// came out of its bucket on the day it was made (4.1), so the money to pay
// the card is in no bucket: it stays in her bank accounts until she pays. So
// what is set aside for a card is all of what it owes as the app counts it:
// its balance on setup day, plus purchases, fees and interest since, less
// refunds and the payments that reached it, pending charges included. Only
// reads the book.

// What a card owed on setup day, as setup day counted it: its balance plus
// its charges still pending then (14.2).
export function owedAtSetup(setup: { readonly bankBalances: BankBalances; readonly pendingCharges: readonly (Purchase | SavingsWithdrawal)[] }, card: EverydayCard): Cents {
  const counted = withPendingCharges(setup.bankBalances, setup.pendingCharges);
  return card === 'everyday-card' ? counted.everydayCard : (counted.secondCard ?? 0);
}

// What a card owes now, as the books count it.
export function cardOwes(book: Book, card: EverydayCard, atSetup: Cents): Cents {
  assertCents(atSetup, 'what the card owed on setup day');
  let owes = atSetup;
  for (const entry of book.cardEntries(card)) owes = addCents(owes, subtractCents(entry.owes, entry.atSetup));
  return owes;
}

export interface CardSetAside {
  readonly card: EverydayCard;
  readonly owes: Cents;
  // All of what it owes; nothing for a card that owes less than nothing (HB12).
  readonly setAside: Cents;
}

export interface SetAside {
  // The everyday card, then the second card where the setup has one.
  readonly cards: readonly CardSetAside[];
  readonly total: Cents;
  // How much of it is in the savings account rather than checking: the extra
  // the account holds over the buckets that live there (3.8), never more
  // than all that is set aside. Null while the bank cannot be read.
  readonly inSavings: Cents | null;
}

export function setAside(book: Book, atSetup: Readonly<Partial<Record<EverydayCard, Cents>>>, savingsAccountBalance: Cents | null): SetAside {
  const cards: EverydayCard[] = book.switches().secondCard === 'on' ? ['everyday-card', 'second-card'] : ['everyday-card'];
  const each = cards.map((card): CardSetAside => {
    const owes = cardOwes(book, card, atSetup[card] as Cents);
    return { card, owes, setAside: Math.max(owes, 0) };
  });
  const total = addCents(...each.map((c) => c.setAside));
  if (savingsAccountBalance === null) return { cards: each, total, inSavings: null };
  const extra = book.savingsTransfer(savingsAccountBalance).extraInSavings ?? 0;
  return { cards: each, total, inSavings: Math.min(extra, total) };
}

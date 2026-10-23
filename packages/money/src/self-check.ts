import { addCents, assertCents, assertPositiveCents, subtractCents, type Cents } from './cents.js';

// Rulebook section 12, the bank side. Balances as the bank reports them,
// including pending charges. The old card is not here: it is tracked
// separately as debt (12.4).
export interface BankBalances {
  readonly checking: Cents;
  readonly savings: Cents;
  // What you owe on the everyday card.
  readonly everydayCard: Cents;
  // Her rulebook, 12.1: what you owe on her second card. Not there in
  // upstream's setup, which has no second card.
  readonly secondCard?: Cents;
}

export interface PendingCharge {
  readonly account: 'checking' | 'savings' | 'everyday-card' | 'old-card' | 'second-card';
  readonly amount: Cents;
}

// 12.1: posted balances plus the bank's pending charges. A pending debit
// lowers checking, money pending out of savings lowers savings (4.9), and a
// pending card charge raises what you owe. The old card is left out (12.4).
export function withPendingCharges(posted: BankBalances, pending: readonly PendingCharge[]): BankBalances {
  let { checking, savings, everydayCard } = posted;
  let secondCard = posted.secondCard;
  for (const charge of pending) {
    assertPositiveCents(charge.amount, 'pending charge');
    if (charge.account === 'checking') checking = subtractCents(checking, charge.amount);
    if (charge.account === 'savings') savings = subtractCents(savings, charge.amount);
    if (charge.account === 'everyday-card') everydayCard = addCents(everydayCard, charge.amount);
    if (charge.account === 'second-card') secondCard = addCents(secondCard ?? 0, charge.amount);
  }
  return secondCard === undefined ? { checking, savings, everydayCard } : { checking, savings, everydayCard, secondCard };
}

// 12.1: checking + savings - everyday card balance (her rulebook: - the
// second card's balance too).
export function bankSide(bank: BankBalances): Cents {
  assertCents(bank.checking, 'checking balance');
  assertCents(bank.savings, 'savings balance');
  assertCents(bank.everydayCard, 'everyday card balance');
  if (bank.secondCard !== undefined) assertCents(bank.secondCard, 'second card balance');
  return subtractCents(subtractCents(addCents(bank.checking, bank.savings), bank.everydayCard), bank.secondCard ?? 0);
}

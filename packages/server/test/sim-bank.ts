import type { AccountId, BankTransaction } from '@budget-app/money';
import { checkBankRules, type BankRule } from '../src/bank/reading.js';
import { ACCOUNT_IDS, type FakePlaid } from './fake-plaid.js';

// The simulated you (Phase 2) in Plaid's format, for the tests that play its
// life through the bank connection. Every name and number is made up.

export const ACCOUNT: Record<AccountId, string> = {
  checking: ACCOUNT_IDS.checking,
  savings: ACCOUNT_IDS.savings,
  'everyday-card': ACCOUNT_IDS.everyday,
  'old-card': ACCOUNT_IDS.old,
  'second-card': ACCOUNT_IDS.second,
};

const OWN = ['checking', 'savings'] as const;
const ALL: readonly AccountId[] = ['checking', 'savings', 'everyday-card', 'old-card'];
const CARDS: readonly AccountId[] = ['everyday-card', 'old-card'];

// How the made-up bank describes things, as bank rules. A transfer's
// leaving half is in the simulator's own words, which say where it went
// ("PAYMENT FROM checking TO old-card", "TRANSFER checking TO savings"), and
// its arriving half says where it came from. Payments to people and card
// charges use the simulator's own words too.
export const SIM_BANK_RULES: readonly BankRule[] = simBankRules(ALL, CARDS);

// The same, for the accounts and cards of a setup: her setup's (her rulebook,
// section 1) are checking, savings, the everyday card and her second card.
export function simBankRules(all: readonly AccountId[], cards: readonly AccountId[]): readonly BankRule[] {
  return checkBankRules([
    ...OWN.flatMap((from) =>
      all.filter((to) => to !== from).flatMap((to) => [
        { id: `out-${from}-${to}`, account: from, contains: `${from} TO ${to}`, means: 'transfer', other: to },
        { id: `in-${from}-${to}`, account: to, contains: `SIM TRANSFER FROM ${from}`, means: 'transfer', other: from },
      ]),
    ),
    // The transfers the simulator's bank shows as spending and a deposit (5.6).
    ...OWN.flatMap((from) => {
      const to = from === 'checking' ? 'savings' : 'checking';
      return [
        { id: `online-out-${from}`, account: from, contains: `ONLINE BANKING TRANSFER TO ${to.toUpperCase()}`, means: 'transfer', other: to },
        { id: `online-in-${to}`, account: to, contains: `ONLINE BANKING TRANSFER FROM ${from.toUpperCase()}`, means: 'transfer', other: from },
      ];
    }),
    // Payments to people leave checking or savings (A16).
    ...OWN.map((account) => ({ id: `zelle-${account}`, account, contains: 'ZELLE TO ', means: 'payment-to-person' })),
    ...cards.flatMap((card) => [
      { id: `${card}-fee`, account: card, contains: 'LATE FEE', means: 'card-fee' },
      { id: `${card}-interest`, account: card, contains: 'INTEREST CHARGE', means: 'card-interest' },
    ]),
  ]);
}

// One of the simulator's bank transactions, as Plaid would show it: signed
// amounts (positive is money out), a pending charge posting as the pending
// one removed and the posted one added and linked, a pending charge's new
// amount as the pending one modified (A13), a transaction taken back as the
// posted one removed (A14), and a transfer as two separate transactions, one
// on each account. Descriptions are the simulator's own, so the bank
// connection's book is given what the simulator's book was; only a
// transfer's arriving half says where it came from, for its bank rule.
export function inPlaidFormat(fake: FakePlaid, txn: BankTransaction): void {
  switch (txn.kind) {
    case 'purchase':
    case 'savings-withdrawal':
      if (txn.pending) fake.addPending({ id: txn.id, account: ACCOUNT[txn.account], amount: txn.amount, date: txn.date, description: txn.description });
      else if (txn.pendingId !== undefined) fake.postPending(txn.pendingId, { id: txn.id, date: txn.date, amount: txn.amount });
      else fake.addPosted({ id: txn.id, account: ACCOUNT[txn.account], amount: txn.amount, date: txn.date, description: txn.description });
      return;
    case 'refund':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.account], amount: -txn.amount, date: txn.date, description: txn.description });
      return;
    case 'deposit':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.account], amount: -txn.amount, date: txn.date, description: txn.description });
      return;
    case 'card-charge':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.account], amount: txn.amount, date: txn.date, description: txn.description });
      return;
    case 'payment-to-person':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.account], amount: txn.amount, date: txn.date, description: txn.description });
      return;
    case 'transfer':
      fake.addPosted({ id: `${txn.id}-out`, account: ACCOUNT[txn.from], amount: txn.amount, date: txn.date, description: txn.description });
      fake.addPosted({ id: `${txn.id}-in`, account: ACCOUNT[txn.to], amount: -txn.amount, date: txn.date, description: `SIM TRANSFER FROM ${txn.from}` });
      return;
    case 'transfer-sent':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.from], amount: txn.amount, date: txn.date, description: txn.description });
      return;
    case 'transfer-arrived':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.to], amount: -txn.amount, date: txn.date, description: `SIM TRANSFER FROM ${txn.from}` });
      return;
    case 'pending-dropped':
      fake.dropPending(txn.pendingId);
      return;
    case 'pending-changed':
      fake.modify(txn.pendingId, { amount: txn.amount });
      return;
    case 'taken-back':
      fake.removePosted(txn.takenId, { keepBalance: false });
      return;
  }
}

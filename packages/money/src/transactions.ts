import { ALL_ACCOUNTS, type AccountId } from './accounts.js';
import { assertPositiveCents, type Cents } from './cents.js';
import { assertIsoDate, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';

// Bank activity, already sorted into kinds by the bank connection (Phase 3).
// Every amount is positive; the kind says which way the money went.

// Money arriving in checking or savings.
export interface Deposit {
  readonly kind: 'deposit';
  readonly id: string;
  readonly account: 'checking' | 'savings';
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
}

// A purchase on the debit card (checking), the everyday card, the old
// card, or her second card. A pending purchase is later replaced by its posted version, which
// the bank sends with a new id and pendingId pointing at the pending one
// (rule 4.6).
export interface Purchase {
  readonly kind: 'purchase';
  readonly id: string;
  readonly account: 'checking' | 'everyday-card' | 'old-card' | 'second-card';
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly pending: boolean;
  readonly pendingId?: string;
}

// Other money leaving savings: not a transfer to one of your accounts and
// not a payment to a person, such as a withdrawal or a bill paid straight
// from savings (rule 4.9, QUESTIONS.md A16). Like a purchase, it can show
// pending first, and its posted version replaces the pending one (4.6).
export interface SavingsWithdrawal {
  readonly kind: 'savings-withdrawal';
  readonly id: string;
  readonly account: 'savings';
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly pending: boolean;
  readonly pendingId?: string;
}

// Money back from a store. refundOf names the purchase, when the bank
// connection could tell which one it was.
export interface Refund {
  readonly kind: 'refund';
  readonly id: string;
  readonly account: 'checking' | 'everyday-card' | 'old-card' | 'second-card';
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly refundOf?: string;
}

// A fee or interest charged by a card (rules 4.8, 5.5).
export interface CardCharge {
  readonly kind: 'card-charge';
  readonly id: string;
  readonly account: 'everyday-card' | 'old-card' | 'second-card';
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly charge: 'fee' | 'interest';
}

// Money sent to a person from checking or savings, such as Zelle (7.4, 8.1).
export interface PersonPayment {
  readonly kind: 'payment-to-person';
  readonly id: string;
  readonly account: 'checking' | 'savings';
  readonly date: IsoDate;
  readonly amount: Cents;
  // Who it went to, as the bank shows it.
  readonly description: string;
}

// Money moved between your own accounts, including card payments
// (section 5).
export interface Transfer {
  readonly kind: 'transfer';
  readonly id: string;
  readonly from: 'checking' | 'savings';
  readonly to: AccountId;
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
}

// The two halves of a transfer, for when the bank shows them on different
// days (rule 12.5): a card payment usually leaves checking a day or two
// before it reaches the card. The bank connection sends whichever half it
// sees; the book pairs them.
export interface TransferSent {
  readonly kind: 'transfer-sent';
  readonly id: string;
  readonly from: 'checking' | 'savings';
  readonly to: AccountId;
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
}

export interface TransferArrived {
  readonly kind: 'transfer-arrived';
  readonly id: string;
  readonly from: 'checking' | 'savings';
  readonly to: AccountId;
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  // The id of the half that left, when the bank connection knows it.
  readonly sentId?: string;
}

// A pending charge the bank dropped without posting it, such as a gas station
// or hotel hold that falls off (QUESTIONS.md A2). pendingId names the charge.
export interface PendingDropped {
  readonly kind: 'pending-dropped';
  readonly id: string;
  readonly pendingId: string;
  readonly date: IsoDate;
  readonly description: string;
}

// A pending charge whose amount the bank changed before it posted
// (QUESTIONS.md A13). pendingId names the charge.
export interface PendingChanged {
  readonly kind: 'pending-changed';
  readonly id: string;
  readonly pendingId: string;
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
}

// The bank taking back a transaction it had shown, such as one shown twice
// or a correction (QUESTIONS.md A14). takenId names the transaction.
export interface TakenBack {
  readonly kind: 'taken-back';
  readonly id: string;
  readonly takenId: string;
  readonly date: IsoDate;
  readonly description: string;
}

export type BankTransaction =
  | Deposit
  | Purchase
  | SavingsWithdrawal
  | Refund
  | CardCharge
  | PersonPayment
  | Transfer
  | TransferSent
  | TransferArrived
  | PendingDropped
  | PendingChanged
  | TakenBack;

type BetweenAccounts = 'transfer' | 'transfer-sent' | 'transfer-arrived';

const BETWEEN_ACCOUNTS: readonly string[] = ['transfer', 'transfer-sent', 'transfer-arrived'];

// What the bank says about a transaction it showed before. These have no
// account of their own.
type AboutAnother = 'pending-dropped' | 'pending-changed' | 'taken-back';

const ABOUT_ANOTHER: readonly string[] = ['pending-dropped', 'pending-changed', 'taken-back'];

const ACCOUNTS_FOR: Record<Exclude<BankTransaction['kind'], BetweenAccounts | AboutAnother>, readonly string[]> = {
  deposit: ['checking', 'savings'],
  purchase: ['checking', 'everyday-card', 'old-card', 'second-card'],
  'savings-withdrawal': ['savings'],
  refund: ['checking', 'everyday-card', 'old-card', 'second-card'],
  'card-charge': ['everyday-card', 'old-card', 'second-card'],
  'payment-to-person': ['checking', 'savings'],
};

// Refuses anything malformed before the book changes at all. Bank ids may
// not contain ":" because the book uses it for the ids of its own questions.
export function checkTransaction(txn: BankTransaction): void {
  const bad = (why: string): never => {
    throw new MoneyError('bad-transaction', `${why}: ${JSON.stringify(txn)}`);
  };
  const isId = (id: unknown): boolean => typeof id === 'string' && id !== '' && !id.includes(':');
  if (typeof txn !== 'object' || txn === null) bad('not a transaction');
  if (!(txn.kind in ACCOUNTS_FOR) && !BETWEEN_ACCOUNTS.includes(txn.kind) && !ABOUT_ANOTHER.includes(txn.kind)) bad('unknown kind');
  if (!isId(txn.id)) bad('id must be non-empty text without ":"');
  if (typeof txn.description !== 'string') bad('description must be text');
  if (txn.kind === 'pending-dropped' || txn.kind === 'pending-changed' || txn.kind === 'taken-back') {
    // No account of their own: they are the other transaction's.
    if (!isId(txn.kind === 'taken-back' ? txn.takenId : txn.pendingId)) bad('it must name a transaction id');
    assertIsoDate(txn.date, 'transaction date');
    if (txn.kind === 'pending-changed') assertPositiveCents(txn.amount, 'new amount');
    return;
  }
  if (txn.kind === 'transfer' || txn.kind === 'transfer-sent' || txn.kind === 'transfer-arrived') {
    if (txn.from !== 'checking' && txn.from !== 'savings') bad('a transfer comes from checking or savings');
    if (!ALL_ACCOUNTS.includes(txn.to) || txn.to === txn.from) bad('a transfer goes to one of your other accounts');
  } else if (!ACCOUNTS_FOR[txn.kind].includes(txn.account)) {
    bad(`a ${txn.kind} cannot be on ${String(txn.account)}`);
  }
  switch (txn.kind) {
    case 'purchase':
    case 'savings-withdrawal':
      if (typeof txn.pending !== 'boolean') bad('pending must be true or false');
      if (txn.pendingId !== undefined && (txn.pending || !isId(txn.pendingId))) bad('only a posted charge can replace a pending one');
      break;
    case 'refund':
      if (txn.refundOf !== undefined && !isId(txn.refundOf)) bad('refundOf must be a transaction id');
      break;
    case 'card-charge':
      if (txn.charge !== 'fee' && txn.charge !== 'interest') bad('a card charge is a fee or interest');
      break;
    case 'transfer-arrived':
      if (txn.sentId !== undefined && !isId(txn.sentId)) bad('sentId must be a transaction id');
      break;
    case 'deposit':
    case 'payment-to-person':
    case 'transfer':
    case 'transfer-sent':
      break;
  }
  assertIsoDate(txn.date, 'transaction date');
  assertPositiveCents(txn.amount, 'transaction amount');
}

// Two transactions are the same when every field matches.
export function sameTransaction(a: BankTransaction, b: BankTransaction): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a as unknown as Record<string, unknown>)[key] === (b as unknown as Record<string, unknown>)[key]);
}

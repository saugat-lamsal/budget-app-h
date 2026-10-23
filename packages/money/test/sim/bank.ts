import {
  addDays,
  type BankBalances,
  type BankTransaction,
  type CardCharge,
  type CardStatement,
  type Cents,
  type Deposit,
  type IsoDate,
  type PendingChanged,
  type PendingDropped,
  type PersonPayment,
  type Purchase,
  type Refund,
  type SavingsWithdrawal,
  type TakenBack,
  type Transfer,
  type TransferArrived,
  type TransferSent,
} from '../../src/index.js';

export type Card = 'everyday-card' | 'old-card' | 'second-card';
export type ChargeAccount = 'checking' | Card;
export type OwnAccount = 'checking' | 'savings';
export type Destination = OwnAccount | Card;

// Posted balances. The cards hold what you owe.
export interface Posted {
  checking: Cents;
  savings: Cents;
  everydayCard: Cents;
  oldCard: Cents;
  // Her second card (her rulebook, section 1); none in upstream's lives.
  secondCard?: Cents;
}

// The simulator's bank: its own record of every account, worked out with its
// own arithmetic and kept apart from the book. It behaves the way the real
// bank feed will (Phase 3): posted balances, a list of charges still
// pending, and transfers whose two halves can show on different days. Each
// transaction it makes goes on the feed, and the simulator passes it to the
// book.
export class SimBank {
  readonly posted: Posted;
  readonly feed: BankTransaction[] = [];
  readonly #pending = new Map<string, Purchase>();
  // Transfers with only one half showing so far (12.5).
  readonly #halfway = new Map<string, TransferSent | TransferArrived>();
  #nextId = 1;

  constructor(start: Posted) {
    this.posted = { ...start };
  }

  // 12.1: the balances the self-check is given, posted plus pending charges.
  balances(): BankBalances {
    let { checking, everydayCard, secondCard } = this.posted;
    for (const charge of this.#pending.values()) {
      if (charge.account === 'checking') checking -= charge.amount;
      if (charge.account === 'everyday-card') everydayCard += charge.amount;
      if (charge.account === 'second-card') secondCard = (secondCard ?? 0) + charge.amount;
    }
    return { checking, savings: this.posted.savings, everydayCard, ...(secondCard === undefined ? {} : { secondCard }) };
  }

  postedBalances(): BankBalances {
    const { checking, savings, everydayCard, secondCard } = this.posted;
    return { checking, savings, everydayCard, ...(secondCard === undefined ? {} : { secondCard }) };
  }

  pendingCharges(): Purchase[] {
    return [...this.#pending.values()];
  }

  // What the old card owes, pending charges included: the debt the book shows (12.4).
  oldCardOwed(): Cents {
    let owed = this.posted.oldCard;
    for (const charge of this.#pending.values()) if (charge.account === 'old-card') owed += charge.amount;
    return owed;
  }

  // 12.5: money that has left checking or savings and not landed yet, minus
  // money that has landed before it shows leaving. The old card is left out (12.4).
  inTransit(): Cents {
    let total = 0;
    for (const half of this.#halfway.values()) {
      if (half.to === 'old-card') continue;
      total += half.kind === 'transfer-sent' ? half.amount : -half.amount;
    }
    return total;
  }

  halvesShowing(): (TransferSent | TransferArrived)[] {
    return [...this.#halfway.values()];
  }

  // A card swipe the bank holds as pending until it posts (4.6).
  authorize(date: IsoDate, account: ChargeAccount, amount: Cents, description: string): Purchase {
    const txn: Purchase = { kind: 'purchase', id: this.#id('p'), account, date, amount, description, pending: true };
    this.#pending.set(txn.id, txn);
    return this.#add(txn);
  }

  // The posted version of a pending charge: a new id, and maybe a new amount.
  post(pendingId: string, date: IsoDate, amount: Cents): Purchase {
    const hold = this.#pending.get(pendingId);
    if (hold === undefined) throw new Error(`the bank has no pending charge ${pendingId}`);
    this.#pending.delete(pendingId);
    this.#owe(hold.account, amount);
    return this.#add({ kind: 'purchase', id: this.#id('p'), account: hold.account, date, amount, description: hold.description, pending: false, pendingId });
  }

  // The bank drops a pending charge without posting it, such as a gas pump
  // hold that falls off (QUESTIONS.md A2).
  drop(pendingId: string, date: IsoDate): PendingDropped {
    if (!this.#pending.delete(pendingId)) throw new Error(`the bank has no pending charge ${pendingId}`);
    return this.#add({ kind: 'pending-dropped', id: this.#id('x'), pendingId, date, description: 'HOLD RELEASED' });
  }

  // A charge that posts straight away, with no pending stage.
  purchase(date: IsoDate, account: ChargeAccount, amount: Cents, description: string): Purchase {
    this.#owe(account, amount);
    return this.#add({ kind: 'purchase', id: this.#id('p'), account, date, amount, description, pending: false });
  }

  refund(date: IsoDate, account: ChargeAccount, amount: Cents, description: string, refundOf?: string): Refund {
    this.#owe(account, -amount);
    return this.#add({ kind: 'refund', id: this.#id('r'), account, date, amount, description, ...(refundOf === undefined ? {} : { refundOf }) });
  }

  deposit(date: IsoDate, account: OwnAccount, amount: Cents, description: string): Deposit {
    this.posted[account] += amount;
    return this.#add({ kind: 'deposit', id: this.#id('d'), account, date, amount, description });
  }

  // Money sent to a person (Zelle and the like), from checking or savings (A16).
  payPerson(date: IsoDate, amount: Cents, payee: string, from: OwnAccount = 'checking'): PersonPayment {
    this.posted[from] -= amount;
    return this.#add({ kind: 'payment-to-person', id: this.#id('z'), account: from, date, amount, description: `ZELLE TO ${payee}` });
  }

  // Other money leaving savings, such as a bill paid from it (4.9).
  payFromSavings(date: IsoDate, amount: Cents, description: string): SavingsWithdrawal {
    this.posted.savings -= amount;
    return this.#add({ kind: 'savings-withdrawal', id: this.#id('s'), account: 'savings', date, amount, description, pending: false });
  }

  // The bank changes a pending charge's amount before it posts (A13).
  changePending(pendingId: string, date: IsoDate, amount: Cents): PendingChanged {
    const hold = this.#pending.get(pendingId);
    if (hold === undefined) throw new Error(`the bank has no pending charge ${pendingId}`);
    this.#pending.set(pendingId, { ...hold, amount });
    return this.#add({ kind: 'pending-changed', id: this.#id('k'), pendingId, date, amount, description: hold.description });
  }

  // The bank charges a purchase a second time by mistake...
  chargeTwice(date: IsoDate, first: Purchase): Purchase {
    this.#owe(first.account, first.amount);
    return this.#add({ kind: 'purchase', id: this.#id('p'), account: first.account, date, amount: first.amount, description: first.description, pending: false });
  }

  // ...and then takes the copy back (4.10).
  takeBack(date: IsoDate, copy: Purchase): TakenBack {
    if (copy.pending) throw new Error('the simulated bank only takes back a posted charge');
    this.#owe(copy.account, -copy.amount);
    return this.#add({ kind: 'taken-back', id: this.#id('k'), takenId: copy.id, date, description: 'CORRECTION' });
  }

  // ...or takes back a refund it gave, such as a return the store did not
  // accept after all (4.10).
  takeBackRefund(date: IsoDate, refund: Refund): TakenBack {
    this.#owe(refund.account, refund.amount);
    return this.#add({ kind: 'taken-back', id: this.#id('k'), takenId: refund.id, date, description: 'REFUND REVERSED' });
  }

  cardCharge(date: IsoDate, card: Card, charge: 'fee' | 'interest', amount: Cents): CardCharge {
    this.#owe(card, amount);
    const description = charge === 'fee' ? 'LATE FEE' : 'INTEREST CHARGE';
    return this.#add({ kind: 'card-charge', id: this.#id('c'), account: card, date, amount, description, charge });
  }

  // A transfer that leaves and lands the same day.
  transfer(date: IsoDate, from: OwnAccount, to: Destination, amount: Cents): Transfer {
    this.posted[from] -= amount;
    this.#land(to, amount);
    return this.#add({ kind: 'transfer', id: this.#id('t'), from, to, date, amount, description: `TRANSFER ${from} TO ${to}` });
  }

  // The first half of a transfer: the money leaves now and lands later.
  send(date: IsoDate, from: OwnAccount, to: Destination, amount: Cents): TransferSent {
    this.posted[from] -= amount;
    const txn: TransferSent = { kind: 'transfer-sent', id: this.#id('t'), from, to, date, amount, description: `PAYMENT FROM ${from} TO ${to}` };
    this.#halfway.set(txn.id, txn);
    return this.#add(txn);
  }

  // The second half. The bank names the half that left only sometimes.
  land(date: IsoDate, sent: TransferSent, linked: boolean): TransferArrived {
    if (!this.#halfway.delete(sent.id)) throw new Error(`the bank has no transfer ${sent.id} on its way`);
    this.#land(sent.to, sent.amount);
    const { from, to, amount } = sent;
    return this.#add({ kind: 'transfer-arrived', id: this.#id('t'), from, to, date, amount, description: `PAYMENT RECEIVED FROM ${from}`, ...(linked ? { sentId: sent.id } : {}) });
  }

  // A move between checking and savings that the feed shows as spending on
  // the account it leaves, and later as a deposit on the one it reaches
  // (5.6, QUESTIONS.md A12). The bank's own record has it on its way.
  misreadSend(date: IsoDate, from: OwnAccount, to: OwnAccount, amount: Cents): Purchase | SavingsWithdrawal {
    this.posted[from] -= amount;
    const description = `ONLINE BANKING TRANSFER TO ${to.toUpperCase()}`;
    const id = this.#id('m');
    const txn: Purchase | SavingsWithdrawal =
      from === 'savings'
        ? { kind: 'savings-withdrawal', id, account: 'savings', date, amount, description, pending: false }
        : { kind: 'purchase', id, account: from, date, amount, description, pending: false };
    this.#halfway.set(txn.id, { kind: 'transfer-sent', id: txn.id, from, to, date, amount, description });
    return this.#add(txn);
  }

  misreadLand(date: IsoDate, left: Purchase | SavingsWithdrawal): Deposit {
    const half = this.#halfway.get(left.id);
    if (half?.kind !== 'transfer-sent' || (half.to !== 'checking' && half.to !== 'savings')) throw new Error(`the bank has no transfer ${left.id} on its way`);
    this.#halfway.delete(left.id);
    this.posted[half.to] += half.amount;
    return this.#add({ kind: 'deposit', id: this.#id('m'), account: half.to, date, amount: half.amount, description: `ONLINE BANKING TRANSFER FROM ${half.from.toUpperCase()}` });
  }

  // A transfer that shows landing before it shows leaving.
  landFirst(date: IsoDate, from: OwnAccount, to: Destination, amount: Cents): TransferArrived {
    this.#land(to, amount);
    const txn: TransferArrived = { kind: 'transfer-arrived', id: this.#id('t'), from, to, date, amount, description: `PAYMENT RECEIVED FROM ${from}` };
    this.#halfway.set(txn.id, txn);
    return this.#add(txn);
  }

  sendAfter(date: IsoDate, landed: TransferArrived): TransferSent {
    if (!this.#halfway.delete(landed.id)) throw new Error(`the bank has no transfer ${landed.id} waiting to show leaving`);
    this.posted[landed.from] -= landed.amount;
    const { from, to, amount } = landed;
    return this.#add({ kind: 'transfer-sent', id: this.#id('t'), from, to, date, amount, description: `PAYMENT FROM ${from} TO ${to}` });
  }

  // The statement on a card's closing day. Charges still pending are not on
  // it. The minimum is 2% rounded up to the dollar, at least $35, and never
  // more than what is owed.
  closeStatement(card: Card, date: IsoDate): CardStatement {
    const balance = card === 'everyday-card' ? this.posted.everydayCard : card === 'second-card' ? (this.posted.secondCard ?? 0) : this.posted.oldCard;
    return { card, closingDate: date, dueDate: addDays(date, 25), statementBalance: balance, minimumPayment: minimumFor(balance) };
  }

  // Changes a balance without telling anyone. Only the simulator's own tests
  // use it, to make sure a mismatch is caught and reported.
  changeWithoutTelling(account: keyof Posted, amount: Cents): void {
    this.posted[account] = (this.posted[account] ?? 0) + amount;
  }

  #owe(account: ChargeAccount, amount: Cents): void {
    if (account === 'checking') this.posted.checking -= amount;
    else if (account === 'everyday-card') this.posted.everydayCard += amount;
    else if (account === 'second-card') this.posted.secondCard = (this.posted.secondCard ?? 0) + amount;
    else this.posted.oldCard += amount;
  }

  // Money arriving: checking and savings go up, a card owes less.
  #land(account: Destination, amount: Cents): void {
    if (account === 'checking' || account === 'savings') this.posted[account] += amount;
    else this.#owe(account, -amount);
  }

  #id(prefix: string): string {
    return `${prefix}${this.#nextId++}`;
  }

  #add<T extends BankTransaction>(txn: T): T {
    this.feed.push(txn);
    return txn;
  }
}

function minimumFor(balance: Cents): Cents {
  if (balance <= 0) return 0;
  const twoPercentInHundredths = balance * 2;
  const rest = twoPercentInHundredths % 10_000;
  const dollars = (twoPercentInHundredths - rest) / 10_000 + (rest === 0 ? 0 : 1);
  return Math.min(balance, Math.max(3_500, dollars * 100));
}

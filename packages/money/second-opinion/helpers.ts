// Second-opinion test helpers. Written from the rulebook and the package's
// public type signatures only, without reading the money source or the
// existing tests.
//
// A Life is a book plus a made-up bank that this file keeps by hand, so a
// test can feed a transaction to both and then check that the self-check
// (rulebook 12) still balances. The bank effects below are this author's
// reading of what each transaction does to the real accounts.

import { expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  changeSettings,
  openBook,
  type BankBalances,
  type BankTransaction,
  type Book,
  type Settings,
  type SortingRule,
  type StartingPots,
} from '../src/index.js';

export const PAYROLL = 'ACME PAYROLL';
export const MOM = 'PAT SAMPLE';

// Section 2 settings, plus the two text rules he enters in the app, and
// leftovers set to roll over so payday tests do not stop for a question
// unless they ask for one.
export const SETTINGS: Settings = changeSettings(DEFAULT_SETTINGS, {
  paycheckRule: { contains: PAYROLL },
  momRule: { contains: MOM },
  leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' },
});

// Starting money used by most tests.
//   pots: savings 5,000.00 + needs 1,000.00 + wants 500.00 = 6,500.00
//   bank: checking 3,000.00 + savings 4,000.00 - everyday card 500.00 = 6,500.00
export const START_POTS: StartingPots = {
  savings: 500000,
  needs: 100000,
  wants: 50000,
  momReserve: 0,
  heldForOthers: 0,
};
export const START_BANK: BankBalances = {
  checking: 300000,
  savings: 400000,
  everydayCard: 50000,
};

export interface LifeInput {
  readonly pots?: Partial<StartingPots>;
  readonly bank?: Partial<BankBalances>;
  readonly settings?: Partial<Settings>;
  readonly rules?: readonly SortingRule[];
  readonly date?: string;
  readonly lastPaycheckDate?: string;
  readonly oldCardDebt?: number;
}

interface Pending {
  readonly account: 'checking' | 'everyday-card' | 'old-card' | 'second-card';
  readonly amount: number;
}

export class Life {
  readonly book: Book;
  // Posted balances. Pending charges are kept apart and added in bank().
  posted: { checking: number; savings: number; everydayCard: number };
  readonly pending = new Map<string, Pending>();
  #next = 0;

  constructor(input: LifeInput = {}) {
    const pots = { ...START_POTS, ...input.pots };
    this.posted = { ...START_BANK, ...input.bank };
    this.book = openBook({
      date: input.date ?? '2026-01-05',
      pots,
      oldCardDebt: input.oldCardDebt ?? 300000,
      lastPaycheckDate: input.lastPaycheckDate ?? '2026-01-02',
      settings: changeSettings(SETTINGS, input.settings ?? {}),
      rules: input.rules ?? [],
    });
  }

  id(prefix = 't'): string {
    this.#next += 1;
    return `${prefix}${this.#next}`;
  }

  // Bank balances including pending charges (rulebook 12.1).
  bank(): BankBalances {
    let { checking, everydayCard } = this.posted;
    for (const p of this.pending.values()) {
      if (p.account === 'checking') checking -= p.amount;
      if (p.account === 'everyday-card') everydayCard += p.amount;
    }
    return { checking, savings: this.posted.savings, everydayCard };
  }

  feed(txn: BankTransaction) {
    this.#applyToBank(txn);
    return this.book.receive(txn);
  }

  #applyToBank(txn: BankTransaction): void {
    const b = this.posted;
    switch (txn.kind) {
      case 'deposit':
        b[txn.account] += txn.amount;
        return;
      case 'purchase':
        if (txn.pendingId !== undefined) this.pending.delete(txn.pendingId);
        if (txn.pending) {
          this.pending.set(txn.id, { account: txn.account, amount: txn.amount });
          return;
        }
        if (txn.account === 'checking') b.checking -= txn.amount;
        if (txn.account === 'everyday-card') b.everydayCard += txn.amount;
        return;
      case 'refund':
        if (txn.account === 'checking') b.checking += txn.amount;
        if (txn.account === 'everyday-card') b.everydayCard -= txn.amount;
        return;
      case 'card-charge':
        if (txn.account === 'everyday-card') b.everydayCard += txn.amount;
        return;
      case 'payment-to-person':
        b.checking -= txn.amount;
        return;
      case 'transfer':
        this.#leave(txn.from, txn.amount);
        this.#land(txn.to, txn.amount);
        return;
      case 'transfer-sent':
        this.#leave(txn.from, txn.amount);
        return;
      case 'transfer-arrived':
        this.#land(txn.to, txn.amount);
        return;
    }
  }

  #leave(from: 'checking' | 'savings', amount: number): void {
    this.posted[from] -= amount;
  }

  #land(to: string, amount: number): void {
    if (to === 'checking' || to === 'savings') this.posted[to] += amount;
    if (to === 'everyday-card') this.posted.everydayCard -= amount;
    // old card: not part of the self-check (12.4)
  }

  // --- transaction builders -------------------------------------------

  paycheck(amount: number, date: string, description = PAYROLL) {
    return this.feed({ kind: 'deposit', id: this.id('pay'), account: 'checking', date, amount, description });
  }

  deposit(amount: number, date: string, description: string, account: 'checking' | 'savings' = 'checking') {
    return this.feed({ kind: 'deposit', id: this.id('dep'), account, date, amount, description });
  }

  buy(
    amount: number,
    date: string,
    description: string,
    opts: {
      account?: 'checking' | 'everyday-card' | 'old-card';
      pending?: boolean;
      pendingId?: string;
      id?: string;
    } = {},
  ) {
    const base = {
      kind: 'purchase' as const,
      id: opts.id ?? this.id('buy'),
      account: opts.account ?? 'everyday-card',
      date,
      amount,
      description,
      pending: opts.pending ?? false,
    };
    return this.feed(opts.pendingId === undefined ? base : { ...base, pendingId: opts.pendingId });
  }

  refund(amount: number, date: string, description: string, refundOf?: string) {
    const base = {
      kind: 'refund' as const,
      id: this.id('ref'),
      account: 'everyday-card' as const,
      date,
      amount,
      description,
    };
    return this.feed(refundOf === undefined ? base : { ...base, refundOf });
  }

  payPerson(amount: number, date: string, description: string) {
    return this.feed({ kind: 'payment-to-person', id: this.id('per'), account: 'checking', date, amount, description });
  }

  transfer(amount: number, date: string, from: 'checking' | 'savings', to: 'checking' | 'savings' | 'everyday-card' | 'old-card') {
    return this.feed({ kind: 'transfer', id: this.id('xfer'), from, to, date, amount, description: `TRANSFER ${from} TO ${to}` });
  }

  // --- checks ---------------------------------------------------------

  expectBalanced(): void {
    const check = this.book.selfCheck(this.bank());
    expect(check.difference).toBe(0);
    expect(check.ok).toBe(true);
  }
}

// App side as 12.2 writes it, computed from the pots.
export function appSideOf(book: Book): number {
  const p = book.pots();
  return p.savings + p.needs + p.wants + p.momReserve + p.heldForOthers + p.unsortedIn - p.unsortedOut;
}

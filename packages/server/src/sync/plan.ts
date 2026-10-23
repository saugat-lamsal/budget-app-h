import {
  MoneyError,
  daysBetween,
  formatDollars,
  type AccountId,
  type BankTransaction,
  type Book,
  type Cents,
  type IsoDate,
  type PendingChanged,
  type Purchase,
  type SavingsWithdrawal,
  type TakenBack,
} from '@budget-app/money';
import { readPlaidItem, type PlaidItem } from '../bank/plaid-item.js';
import { totalsOf, type Totals } from '../history/history.js';
import { readBankItem, type BankRule, type Reading } from '../bank/reading.js';

// What one sync does with what Plaid sent: which bank items go to the book,
// as which kind, and which wait or need his decision. The book is given each
// item as it is planned, so anything the money math refuses is known before
// anything is saved; the caller saves the plan, or nothing.
//
// The rules followed, beyond reading each item (bank/reading.ts):
// - Before setup day, everything is history: it is in the starting balances.
// - A pending purchase goes to the book right away (4.6). Anything else that
//   is pending waits until it posts, so it is in neither the book nor the
//   bank side of the self-check meanwhile (B36).
// - Plaid shows a pending charge posting as the pending one removed and the
//   posted one added with pending_transaction_id. The posted one replaces the
//   pending one in the book (4.6), even at a new amount. A pending charge
//   removed with nothing posted in its place was dropped (A2). A pending
//   charge's new amount counts right away, in the same bucket (A13).
// - A posted transaction the bank removes is taken back out of the book
//   (4.10, A14). One whose money the bank changes is taken back, and its new
//   version counted as new.
// - A change the money math cannot follow is not applied: the item waits for
//   his decision, and the self-check shows the difference until then (0.5).

export type ItemStatus = 'history' | 'sent' | 'waiting' | 'held' | 'skipped';

export interface StoredItem {
  readonly transactionId: string;
  accountId: string;
  raw: unknown;
  pending: boolean;
  amountCents: Cents | null;
  removed: boolean;
  status: ItemStatus;
  kind: string | null;
  bookId: string | null;
  replacedBy: string | null;
  readonly firstSync: number;
  lastSync: number;
}

export interface Attention {
  readonly transactionId: string | null;
  readonly what: string;
}

export interface PlanInput {
  readonly stored: ReadonlyMap<string, StoredItem>;
  // Plaid's transactions, new or changed, in their latest version.
  readonly changed: readonly unknown[];
  // Ids Plaid removed.
  readonly removed: readonly string[];
  // Plaid account id -> which of his accounts it is.
  readonly roles: ReadonlyMap<string, AccountId>;
  readonly rules: readonly BankRule[];
  // Null before setup day.
  readonly book: Book | null;
  readonly today: IsoDate;
  readonly sync: number;
}

export interface Plan {
  // New and changed items, to save.
  readonly items: readonly StoredItem[];
  // What the book was given, in order, and the book's totals after each.
  readonly events: readonly BankTransaction[];
  readonly totals: readonly (Totals | null)[];
  readonly attention: readonly Attention[];
}

export function planSync(input: PlanInput): Plan {
  return new Planner(input).run();
}

// A transfer's leaving half that an arriving half can pair with.
interface Leaving {
  readonly id: string;
  readonly from: 'checking' | 'savings';
  readonly to: AccountId;
  readonly amount: Cents;
}

class Planner {
  readonly #in: PlanInput;
  readonly #working = new Map<string, StoredItem>();
  readonly #dirty = new Set<string>();
  readonly #events: BankTransaction[] = [];
  readonly #totals: (Totals | null)[] = [];
  readonly #attention: Attention[] = [];
  // Leaving halves later in this sync, for arriving halves seen first.
  #upcoming: Leaving[] = [];
  // Leaving halves an arriving half has already been paired with here.
  readonly #claimed = new Set<string>();

  constructor(input: PlanInput) {
    this.#in = input;
  }

  run(): Plan {
    const removed = new Set(this.#in.removed);
    const parsed = this.#in.changed.map((raw) => ({ raw, read: readPlaidItem(raw) }));
    // Things that cannot be read are dealt with first; the rest go in the
    // order they happened, keeping Plaid's order within a day (B25).
    const unreadable = parsed.filter((p) => !p.read.ok);
    const readable = parsed
      .flatMap((p) => (p.read.ok ? [{ raw: p.raw, item: p.read.item }] : []))
      .filter((p) => !(removed.has(p.item.id) && !this.#in.stored.has(p.item.id)))
      .map((p, order) => ({ ...p, order }))
      .sort((a, b) => daysBetween(b.item.date, a.item.date) || a.order - b.order);
    for (const p of unreadable) {
      if (!p.read.ok) this.#unreadable(p.raw, p.read.id, p.read.why);
    }
    this.#upcoming = readable.flatMap(({ item }) => {
      const role = this.#in.roles.get(item.accountId);
      if (role === undefined || item.pending || this.#in.book === null) return [];
      const known = this.#in.stored.get(item.id);
      if (known !== undefined && known.status !== 'waiting' && known.status !== 'skipped') return [];
      const reading = readBankItem(role, item.amount, item.description, this.#in.rules);
      if (reading.kind !== 'transfer-sent' || (role !== 'checking' && role !== 'savings')) return [];
      return [{ id: item.id, from: role, to: reading.to, amount: Math.abs(item.amount) }];
    });
    for (const { raw, item } of readable) {
      this.#upcoming = this.#upcoming.filter((leaving) => leaving.id !== item.id);
      this.#changed(raw, item, removed.has(item.id));
    }
    for (const id of removed) this.#removed(id);
    return { items: [...this.#dirty].map((id) => this.#item(id)!), events: this.#events, totals: this.#totals, attention: this.#attention };
  }

  // ----- Items -----

  #item(id: string): StoredItem | undefined {
    const working = this.#working.get(id);
    if (working !== undefined) return working;
    const stored = this.#in.stored.get(id);
    if (stored === undefined) return undefined;
    const copy = { ...stored };
    this.#working.set(id, copy);
    return copy;
  }

  #touch(item: StoredItem): void {
    item.lastSync = this.#in.sync;
    this.#working.set(item.transactionId, item);
    this.#dirty.add(item.transactionId);
  }

  #newItem(item: PlaidItem, raw: unknown): StoredItem {
    return {
      transactionId: item.id,
      accountId: item.accountId,
      raw,
      pending: item.pending,
      amountCents: item.amount,
      removed: false,
      status: 'history',
      kind: null,
      bookId: null,
      replacedBy: null,
      firstSync: this.#in.sync,
      lastSync: this.#in.sync,
    };
  }

  #notice(item: StoredItem | null, what: string): void {
    this.#attention.push({ transactionId: item?.transactionId ?? null, what });
  }

  #unreadable(raw: unknown, id: string | null, why: string): void {
    // Before setup day it is history, already in the starting balances.
    const tracking = this.#in.book !== null;
    if (id === null) {
      if (!tracking) return;
      this.#notice(null, `the bank sent an item the app cannot read: ${why}`);
      return;
    }
    const tx = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const known = this.#item(id);
    const item: StoredItem = known ?? {
      transactionId: id,
      accountId: typeof tx['account_id'] === 'string' ? tx['account_id'] : '',
      raw,
      pending: tx['pending'] === true,
      amountCents: null,
      removed: false,
      status: 'held',
      kind: null,
      bookId: null,
      replacedBy: null,
      firstSync: this.#in.sync,
      lastSync: this.#in.sync,
    };
    item.raw = raw;
    item.amountCents = null;
    if (!tracking) {
      item.status = 'history';
      item.kind = null;
      this.#touch(item);
      return;
    }
    // Something the book already has keeps its place there; the change waits.
    if (item.status !== 'sent') item.status = 'held';
    this.#touch(item);
    this.#notice(item, `the bank sent something the app cannot read: ${why}`);
  }

  // ----- New or changed transactions -----

  // goingAway: Plaid also removed it in this sync, after this change.
  #changed(raw: unknown, item: PlaidItem, goingAway: boolean): void {
    const known = this.#item(item.id);
    if (known === undefined) {
      const fresh = this.#newItem(item, raw);
      this.#touch(fresh);
      this.#take(fresh, item);
      return;
    }
    const sameMoney = known.accountId === item.accountId && known.pending === item.pending && known.amountCents === item.amount;
    // Sent again exactly as before: nothing to do, nothing to save.
    if (sameMoney && JSON.stringify(known.raw) === JSON.stringify(raw)) return;
    const before = { accountId: known.accountId, pending: known.pending, amount: known.amountCents };
    known.raw = raw;
    known.accountId = item.accountId;
    known.pending = item.pending;
    known.amountCents = item.amount;
    this.#touch(known);
    // A new description or category: nothing for the book. Something removed
    // right after is dealt with as removed.
    if (sameMoney || goingAway) return;
    switch (known.status) {
      case 'history':
        if (this.#in.book !== null) this.#notice(known, 'the bank changed a transaction from before setup day, which is already in the starting money');
        return;
      case 'skipped':
        this.#take(known, item);
        return;
      case 'waiting':
        // Posted at last: now it goes to the book.
        if (!item.pending) this.#take(known, item);
        return;
      case 'held':
        this.#notice(known, 'the bank changed an item that is already waiting for your decision');
        return;
      case 'sent':
        this.#changedInBook(known, item, before);
        return;
    }
  }

  // A transaction the book already has, changed by the bank.
  #changedInBook(known: StoredItem, item: PlaidItem, before: { accountId: string; pending: boolean; amount: Cents | null }): void {
    const role = this.#in.roles.get(item.accountId);
    if (known.kind === 'purchase' && before.pending && !item.pending && known.replacedBy === null && role !== undefined && item.amount > 0) {
      // 4.6: it posted under its own id. The posted charge replaces the pending one.
      this.#give({ ...this.#purchase(item, role), id: `${item.id}-posted`, pendingId: known.bookId ?? item.id }, known);
      return;
    }
    if (known.kind === 'purchase' && before.pending && item.pending && known.replacedBy === null && before.accountId === item.accountId && item.amount > 0) {
      // A13: a pending charge's new amount counts right away, in its bucket.
      const change: PendingChanged = {
        kind: 'pending-changed',
        id: `${item.id}-changed-${this.#in.sync}`,
        pendingId: known.bookId ?? item.id,
        date: this.#in.today,
        amount: item.amount,
        description: item.description,
      };
      this.#give(change, known);
      return;
    }
    if (!before.pending && !item.pending && role !== undefined) {
      // 4.10 (A14): a posted transaction the bank changed. The old version
      // is taken back, and the new one counted as new.
      if (!this.#takeBack(known)) return;
      const reading = readBankItem(role, item.amount, item.description, this.#in.rules);
      known.kind = reading.kind;
      if (reading.kind === 'nothing') {
        known.status = 'skipped';
        return;
      }
      const fresh = this.#transaction({ ...item, id: `${item.id}-${this.#in.sync}` }, role, reading);
      if (fresh === null) {
        known.status = 'held';
        this.#notice(known, 'the money math has no place for it');
        return;
      }
      if (this.#give(fresh, known)) known.bookId = fresh.id;
      return;
    }
    const was = before.amount === null ? 'an amount the app could not read' : formatDollars(Math.abs(before.amount));
    this.#notice(known, `the bank changed a transaction the app had already counted in a way the app cannot follow (it was ${was}, now ${formatDollars(Math.abs(item.amount))})`);
  }

  // A transaction seen for the first time, or for the first time as
  // something the book should have.
  #take(stored: StoredItem, item: PlaidItem): void {
    const role = this.#in.roles.get(item.accountId);
    const reading = role === undefined ? null : readBankItem(role, item.amount, item.description, this.#in.rules);
    stored.kind = reading?.kind ?? null;
    // Before setup day it is history, whatever it is.
    if (this.#in.book === null) {
      stored.status = 'history';
      return;
    }
    // Not one of his four accounts, or no money moved.
    if (role === undefined || reading === null || reading.kind === 'nothing') {
      stored.status = 'skipped';
      return;
    }
    if (item.pending) {
      if (reading.kind === 'purchase') this.#give({ ...this.#purchase(item, role), pending: true }, stored);
      else stored.status = 'waiting';
      return;
    }
    // A50b, B226: only a posted purchase replaces its pending one. One the
    // bank rules read as something else (a card payment, a payment to a
    // person) is that; the pending purchase is dropped when the bank removes
    // it (A2), so the books end as if only the posted item had come.
    if (item.pendingTransactionId !== null && item.amount > 0 && reading.kind === 'purchase') {
      const pending = this.#item(item.pendingTransactionId);
      if (
        pending !== undefined &&
        pending.status === 'sent' &&
        pending.kind === 'purchase' &&
        pending.pending &&
        !pending.removed &&
        pending.replacedBy === null &&
        pending.accountId === item.accountId
      ) {
        // 4.6: the posted charge replaces the pending one, even if the amount
        // changed, and keeps the pending one's bucket (B10).
        stored.kind = 'purchase';
        pending.replacedBy = item.id;
        this.#touch(pending);
        this.#give({ ...this.#purchase(item, role), pendingId: pending.bookId ?? pending.transactionId }, stored);
        return;
      }
    }
    const txn = this.#transaction(item, role, reading);
    if (txn === null) {
      stored.status = 'held';
      this.#notice(stored, 'the money math has no place for it');
      return;
    }
    this.#give(txn, stored);
  }

  // Money out that is not a transfer or a payment to a person: a purchase,
  // or out of savings a withdrawal, which always waits in review (4.9).
  #purchase(item: PlaidItem, role: AccountId): Purchase | SavingsWithdrawal {
    const base = { id: item.id, date: item.day, amount: Math.abs(item.amount), description: item.description, pending: false };
    return role === 'savings' ? { ...base, kind: 'savings-withdrawal', account: role } : { ...base, kind: 'purchase', account: role };
  }

  #transaction(item: PlaidItem, role: AccountId, reading: Reading): BankTransaction | null {
    const amount = Math.abs(item.amount);
    const base = { id: item.id, amount, description: item.description };
    switch (reading.kind) {
      case 'purchase':
        return this.#purchase(item, role);
      case 'deposit':
        return role === 'checking' || role === 'savings' ? { ...base, kind: 'deposit', account: role, date: item.date } : null;
      case 'refund':
        return role === 'savings' ? null : { ...base, kind: 'refund', account: role, date: item.date };
      case 'card-charge':
        return role === 'everyday-card' || role === 'old-card' || role === 'second-card' ? { ...base, kind: 'card-charge', account: role, date: item.date, charge: reading.charge } : null;
      case 'payment-to-person':
        return role === 'checking' || role === 'savings' ? { ...base, kind: 'payment-to-person', account: role, date: item.day } : null;
      case 'transfer-sent':
        return role === 'checking' || role === 'savings' ? { ...base, kind: 'transfer-sent', from: role, to: reading.to, date: item.date } : null;
      case 'transfer-arrived': {
        const pair = this.#leavingHalfFor(role, amount, reading.from);
        return { ...base, kind: 'transfer-arrived', from: pair.from, to: role, date: item.date, ...(pair.sentId === undefined ? {} : { sentId: pair.sentId }) };
      }
      case 'nothing':
        return null;
    }
  }

  // Rule 12.5: an arriving half pairs with its leaving half. The bank does
  // not link them, so this looks for money already seen leaving for this
  // account, or leaving later in this same sync, for the same amount. One
  // from the account the rule names is taken first; failing that, any, since
  // a card's statement often does not say where a payment came from.
  #leavingHalfFor(to: AccountId, amount: Cents, ruleFrom: 'checking' | 'savings'): { from: 'checking' | 'savings'; sentId?: string } {
    const inBook: Leaving[] = (this.#in.book?.inTransit().items ?? [])
      .filter((i) => i.seen === 'left')
      .map((i) => ({ id: i.id, from: i.from, to: i.to, amount: i.amount }));
    const candidates = [...inBook, ...this.#upcoming].filter((l) => l.to === to && l.amount === amount && !this.#claimed.has(l.id));
    const pick = candidates.find((l) => l.from === ruleFrom) ?? candidates[0];
    if (pick === undefined) return { from: ruleFrom };
    this.#claimed.add(pick.id);
    return { from: pick.from, sentId: pick.id };
  }

  // Gives the book one transaction. If the money math refuses it, the item
  // waits for his decision instead, and nothing else changes. Says whether
  // the book took it.
  #give(txn: BankTransaction, stored: StoredItem): boolean {
    const book = this.#in.book;
    if (book === null) throw new Error('nothing goes to the book before setup day');
    try {
      book.receive(txn);
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      const aboutIt = txn.kind === 'pending-dropped' || txn.kind === 'pending-changed' || txn.kind === 'taken-back';
      if (aboutIt || ('pendingId' in txn && txn.pendingId !== undefined && txn.id !== stored.transactionId)) {
        // The item itself is still in the book; only this change is not.
        this.#notice(stored, `the money math refused a change to it: ${error.message}`);
      } else {
        stored.status = 'held';
        this.#notice(stored, `the money math refused it: ${error.message}`);
      }
      this.#touch(stored);
      return false;
    }
    this.#events.push(txn);
    this.#totals.push(totalsOf(book));
    if (stored.status !== 'sent') {
      stored.status = 'sent';
      stored.bookId = txn.id;
    }
    this.#touch(stored);
    return true;
  }

  // 4.10 (A14): takes a transaction the book counted back out of it. Says
  // whether the book took it back.
  #takeBack(known: StoredItem): boolean {
    const takenBack: TakenBack = {
      kind: 'taken-back',
      id: `${known.transactionId}-taken-back-${this.#in.sync}`,
      takenId: known.bookId ?? known.transactionId,
      date: this.#in.today,
      description: describe(known),
    };
    return this.#give(takenBack, known);
  }

  // ----- Removed transactions -----

  #removed(id: string): void {
    const known = this.#item(id);
    if (known === undefined || known.removed) return;
    known.removed = true;
    this.#touch(known);
    if (known.status !== 'sent') return;
    if (known.kind === 'purchase' && known.replacedBy !== null) return;
    if (known.kind === 'purchase' && known.pending) {
      // A2: dropped without posting. Its money goes back where it came from.
      this.#give({ kind: 'pending-dropped', id: `${id}-dropped`, pendingId: known.bookId ?? id, date: this.#in.today, description: describe(known) }, known);
      return;
    }
    // 4.10 (A14): the bank took back a transaction the app had counted. Its
    // money goes back where it came from.
    this.#takeBack(known);
  }
}

function describe(item: StoredItem): string {
  const read = readPlaidItem(item.raw);
  return read.ok ? read.item.description : '';
}

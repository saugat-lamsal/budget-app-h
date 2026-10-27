import { addCents, withPendingCharges, type AccountId, type BankBalances, type Cents, type PendingCharge } from '@budget-app/money';
import type { StoredAccount } from './stored-account.js';
import type { StoredItem } from '../sync/plan.js';
import { BankDataError } from '../errors.js';
import type { PendingMoneyIn } from '../views/home.js';
import { centsFromPlaid } from './amounts.js';
import { readPlaidItem } from './plaid-item.js';
import type { AccountAtRead, BankAtRead, CheckAccount, PendingItemNow, PostedItemSince } from './why.js';

// Rule 12.1, the bank side of the self-check: checking + savings - everyday
// card balance (her rulebook: - the second card's too), including pending
// charges.
//
// Plaid's "current" balance is the posted one: what a bank account holds, or
// what a card owes, before anything pending (B36; checked against the test
// bank by the live tests). Pending charges are added from the bank's own list
// of pending transactions, at the bank's latest amounts. Only pending
// purchases count, savings ones included (4.9): they are the only pending
// items the book counts (4.6).
// Pending money in, and pending transfers and payments, count once they post.
//
// Checking and savings (A47, his call, Oct 14, 2026; A54, Oct 16): the bank's
// available balance, with what is still pending that the books count only
// once it posts put back: money going out (a transfer between his accounts,
// a payment to a person, money leaving savings) added back, money coming in
// (a paycheck or other deposit, a refund, a transfer arriving) taken out.
// Bank of America's "current" leaves out items Plaid already sends as posted
// until the bank's overnight processing, and its "available" is current less
// the pending items going out and those (B231), plus the pending money in
// (A54: a paycheck is available the day it shows as pending). So the
// available balance, with the pending items the books do not count yet put
// back, is what the books hold; pending charges are already out of it, as
// the books count them (4.6). When the bank gives no available balance:
// the posted one, as before. The everyday card stays what it owes: its
// available is the limit less what it owes and says nothing about pending
// (B230).
export interface BankView {
  // The posted balances of checking, savings and the everyday card, as the bank gives them.
  readonly posted: BankBalances;
  // What the self-check starts from, before pending charges: for checking
  // and savings the available balance plus every pending item going out and
  // less every pending item coming in (the posted balance when the bank
  // gives no available one); the everyday card's posted balance.
  readonly counted: BankBalances;
  // The available balances of checking and savings as the bank gave them; null when it gave none.
  readonly available: { readonly checking: Cents | null; readonly savings: Cents | null };
  readonly pendingCharges: readonly PendingCharge[];
  // Counted, less pending charges: what the self-check compares (12.1).
  readonly withPending: BankBalances;
  // What the old card owes, posted and with its pending charges. Not part
  // of the self-check (12.4); the book tracks it as debt.
  readonly oldCardPosted: Cents;
  readonly oldCardWithPending: Cents;
  // 11.4 (A56): deposits still pending into checking or savings, which the
  // books count only once they post, for Home; with the sync that first
  // brought each (A57: pending since).
  readonly pendingIn: readonly (PendingMoneyIn & { readonly firstSync: number })[];
  // 12.6 (A57): for each account in the check, the bank's own transactions on
  // it that the books count, added up in Plaid's sign (money out, or onto the
  // card, above zero): the posted ones, and the pending charges (4.6).
  readonly items: Readonly<Record<CheckAccount, Cents>>;
  // 12.6: every pending item Plaid lists on those accounts, in the order first seen.
  readonly pending: readonly PendingItemNow[];
}

export type BankViewResult = { readonly ok: true; readonly view: BankView } | { readonly ok: false; readonly why: string };

// Her rulebook, 12.1 (HA8): with postedBalance (her switch on), checking and
// savings are read as giving no available balance, so the bank side is their
// posted balance less pending charges, and 12.6 reads them the same way.
export function bankView(accounts: readonly StoredAccount[], items: ReadonlyMap<string, StoredItem>, options: { readonly postedBalance?: boolean } = {}): BankViewResult {
  try {
    const roles = new Map<string, AccountId>();
    const posted = (role: AccountId): Cents => {
      const account = accounts.find((a) => a.role === role);
      if (account === undefined) throw new BankDataError(`no account is set as the ${role} account`);
      const currency = account.raw.balances.iso_currency_code;
      if (currency !== 'USD' && currency !== null) throw new BankDataError(`the ${role} balance is not in dollars`);
      if (account.raw.balances.current === null) throw new BankDataError(`the bank did not give the ${role} balance`);
      return centsFromPlaid(account.raw.balances.current, `the ${role} balance`);
    };
    for (const a of accounts) if (a.role !== null) roles.set(a.plaidAccountId, a.role);
    const pendingCharges: PendingCharge[] = [];
    const pendingIn: (PendingMoneyIn & { readonly firstSync: number })[] = [];
    const counts: Record<CheckAccount, Cents> = { checking: 0, savings: 0, 'everyday-card': 0, 'second-card': 0 };
    const pending: PendingItemNow[] = [];
    // Plaid's sign: money going out is above zero, money coming in below.
    const pendingItems = new Map<AccountId, Cents[]>();
    for (const item of items.values()) {
      const role = roles.get(item.accountId);
      if (role === undefined || item.removed || item.amountCents === null || item.amountCents === 0) continue;
      const checked = checkAccountOf(role);
      // 12.6: a posted transaction is counted by the books once it comes.
      if (!item.pending) {
        if (checked !== null) counts[checked] = addCents(counts[checked], item.amountCents);
        continue;
      }
      if (item.replacedBy !== null) continue;
      pendingItems.set(role, [...(pendingItems.get(role) ?? []), item.amountCents]);
      const charge = item.kind === 'purchase' && item.amountCents > 0;
      if (charge) pendingCharges.push({ account: role, amount: item.amountCents });
      if (checked !== null) {
        if (charge) counts[checked] = addCents(counts[checked], item.amountCents);
        const read = readPlaidItem(item.raw);
        pending.push({ id: item.transactionId, account: checked, amount: item.amountCents, description: read.ok ? read.item.description : '', purchase: charge });
      }
      if (item.kind === 'deposit' && item.amountCents < 0 && (role === 'checking' || role === 'savings')) {
        const read = readPlaidItem(item.raw);
        if (read.ok) pendingIn.push({ account: role, amount: -item.amountCents, date: read.item.date, description: read.item.description, firstSync: item.firstSync });
      }
    }
    // 12.1 (A47): checking and savings from the available balance, when the bank gives one.
    const availableOf = (role: 'checking' | 'savings'): Cents | null => {
      if (options.postedBalance === true) return null;
      const available = accounts.find((a) => a.role === role)?.raw.balances.available ?? null;
      return available === null ? null : centsFromPlaid(available, `the ${role} available balance`);
    };
    const counted = (role: 'checking' | 'savings'): Cents => {
      const available = availableOf(role);
      if (available === null) return posted(role);
      return addCents(available, ...(pendingItems.get(role) ?? []));
    };
    // Her second card, when one is picked (1.2): what it owes, as for the everyday card.
    const second = accounts.some((a) => a.role === 'second-card') ? { secondCard: posted('second-card') } : {};
    const balances: BankBalances = { checking: posted('checking'), savings: posted('savings'), everydayCard: posted('everyday-card'), ...second };
    const countedBalances: BankBalances = { checking: counted('checking'), savings: counted('savings'), everydayCard: balances.everydayCard, ...second };
    // "Off in this setup": with no old card, no account is picked as it, and it owes nothing.
    // (Upstream picks all four at once, 1.2, so it always has one here.)
    const oldCardPosted = accounts.some((a) => a.role === 'old-card') ? posted('old-card') : 0;
    const oldCardPending = pendingCharges.filter((c) => c.account === 'old-card').map((c) => c.amount);
    return {
      ok: true,
      view: {
        posted: balances,
        counted: countedBalances,
        available: { checking: availableOf('checking'), savings: availableOf('savings') },
        pendingCharges,
        withPending: withPendingCharges(countedBalances, pendingCharges),
        oldCardPosted,
        oldCardWithPending: addCents(oldCardPosted, ...oldCardPending),
        pendingIn,
        items: counts,
        pending,
      },
    };
  } catch (error) {
    if (error instanceof BankDataError) return { ok: false, why: error.message };
    throw error;
  }
}

function checkAccountOf(role: AccountId): CheckAccount | null {
  return role === 'checking' || role === 'savings' || role === 'everyday-card' || role === 'second-card' ? role : null;
}

// 12.6 (A57): what a read of the bank keeps, from the bank as it is then.
// syncs: the last sync saved by then.
export function bankAtRead(view: BankView, syncs: number): BankAtRead {
  const figures = (account: CheckAccount, posted: Cents, counted: Cents): AccountAtRead => ({
    posted,
    available: account === 'checking' || account === 'savings' ? view.available[account] : null,
    counted,
    items: view.items[account],
  });
  const { posted, withPending } = view;
  // Her second card only when one is picked; upstream's reads stay as they were.
  const second = posted.secondCard === undefined ? {} : { 'second-card': figures('second-card', posted.secondCard, withPending.secondCard ?? 0) };
  return {
    accounts: {
      checking: figures('checking', posted.checking, withPending.checking),
      savings: figures('savings', posted.savings, withPending.savings),
      'everyday-card': figures('everyday-card', posted.everydayCard, withPending.everydayCard),
      ...second,
    },
    pending: view.pending.map((p) => ({ id: p.id, account: p.account, amount: p.amount })),
    syncs,
  };
}

// 12.6: the posted items on the accounts in the check first seen after a
// sync, in the order first seen.
export function postedSince(accounts: readonly StoredAccount[], items: ReadonlyMap<string, StoredItem>, afterSync: number): PostedItemSince[] {
  const roles = new Map(accounts.flatMap((a) => (a.role === null ? [] : [[a.plaidAccountId, a.role] as const])));
  const posted: PostedItemSince[] = [];
  for (const item of items.values()) {
    const role = roles.get(item.accountId);
    const account = role === undefined ? null : checkAccountOf(role);
    if (account === null || item.pending || item.removed || item.firstSync <= afterSync || item.amountCents === null || item.amountCents === 0) continue;
    const read = readPlaidItem(item.raw);
    posted.push({ id: item.transactionId, account, amount: item.amountCents, description: read.ok ? read.item.description : '' });
  }
  return posted;
}

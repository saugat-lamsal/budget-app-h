import {
  daysBetween,
  startTracking,
  startingMoney,
  withPendingCharges,
  type AccountId,
  type BankBalances,
  type Book,
  type Cents,
  type IsoDate,
  type Purchase,
  type SavingsWithdrawal,
  type Settings,
  type SetupInput,
  type SortingRule,
  rolesFor,
  type StartingPots,
  type Switches,
  type TransferArrived,
  type TransferSent,
} from '@budget-app/money';
import { bankView } from './bank/balances.js';
import { readPlaidItem } from './bank/plaid-item.js';
import { readBankItem, readBankItemWithRule, type BankRule } from './bank/reading.js';
import { rolesOf, type StoredAccount } from './bank/stored-account.js';
import type { StoredItem } from './sync/plan.js';

// Rulebook section 14, setup day, from what the bank connection has synced:
// 14.1 the bank's balances today, 14.2 his assignment of the starting money,
// 14.3 tracking starts only if the assignment adds up and the self-check
// passes. Everything synced before setup day is history: it is in the
// starting balances. Charges still pending are in the starting money too
// (A10), and so is money on its way between his accounts (B48).
//
// The logic works on the history handed to it (BankHistory), so the demo,
// which has no database, uses exactly the same. It reads nothing and saves
// nothing: the database part is a thin wrapper around it (setup-day.ts).

export type HalfInTransit = TransferSent | TransferArrived;

// What the bank connection has kept, as setup day reads it.
export interface BankHistory {
  // Null before the bank is connected.
  readonly connection: { readonly historyComplete: boolean } | null;
  // True once setup day is done (the book has begun).
  readonly setUp: boolean;
  readonly accounts: readonly StoredAccount[];
  readonly items: ReadonlyMap<string, StoredItem>;
  readonly rules: readonly BankRule[];
  // What setup day starts with ("Off in this setup"); none is upstream's.
  readonly switches?: Switches;
}

interface History {
  readonly items: ReadonlyMap<string, StoredItem>;
  readonly roles: Map<string, AccountId>;
  readonly rules: readonly BankRule[];
  readonly posted: BankBalances;
  readonly oldCardBalance: Cents;
  readonly pendingCharges: (Purchase | SavingsWithdrawal)[];
  // Each history item read again with today's bank rules.
  readonly reread: Map<string, StoredItem>;
}

// Why setup day cannot be done yet, or null when it can.
export function notReadyWhy(bank: BankHistory): string | null {
  try {
    readHistory(bank);
    return null;
  } catch (error) {
    if (error instanceof SetupNotReady) return error.message;
    throw error;
  }
}

class SetupNotReady extends Error {}

function readHistory(bank: BankHistory): History {
  const connection = bank.connection;
  if (connection === null) throw new SetupNotReady('there is no bank connection yet');
  if (!connection.historyComplete) throw new SetupNotReady('Plaid has not sent all of the history yet; sync again in a little while');
  if (bank.setUp) throw new SetupNotReady('setup day is done already');
  const roles = rolesOf(bank.accounts);
  const asked = bank.switches === undefined ? (['checking', 'savings', 'everyday-card', 'old-card'] as const) : rolesFor(bank.switches);
  const missing = asked.filter((role) => ![...roles.values()].includes(role));
  if (missing.length > 0) throw new SetupNotReady(`these accounts are not set yet: ${missing.join(', ')}`);
  const rules = bank.rules;
  const reread = new Map<string, StoredItem>();
  for (const item of bank.items.values()) {
    const role = roles.get(item.accountId);
    const read = readPlaidItem(item.raw);
    if (role === undefined || !read.ok) continue;
    const kind = readBankItem(role, read.item.amount, read.item.description, rules).kind;
    reread.set(item.transactionId, { ...item, kind });
  }
  const view = bankView(bank.accounts, reread);
  if (!view.ok) throw new SetupNotReady(view.why);
  const pendingCharges: (Purchase | SavingsWithdrawal)[] = [];
  for (const item of reread.values()) {
    const role = roles.get(item.accountId);
    const read = readPlaidItem(item.raw);
    if (!item.pending || item.removed || item.kind !== 'purchase' || role === undefined || !read.ok || read.item.amount <= 0) continue;
    const charge = { id: item.transactionId, date: read.item.day, amount: read.item.amount, description: read.item.description, pending: true };
    pendingCharges.push(role === 'savings' ? { ...charge, kind: 'savings-withdrawal', account: role } : { ...charge, kind: 'purchase', account: role });
  }
  return { items: bank.items, roles, rules, posted: view.view.counted, oldCardBalance: view.view.oldCardPosted, pendingCharges, reread };
}

function halfOf(item: StoredItem, roles: Map<string, AccountId>, rules: readonly BankRule[]): HalfInTransit | null {
  const role = roles.get(item.accountId);
  const read = readPlaidItem(item.raw);
  if (role === undefined || !read.ok || read.item.pending || item.removed) return null;
  const reading = readBankItem(role, read.item.amount, read.item.description, rules);
  const base = { id: item.transactionId, date: read.item.date, amount: Math.abs(read.item.amount), description: read.item.description };
  if (reading.kind === 'transfer-sent' && (role === 'checking' || role === 'savings')) return { ...base, kind: 'transfer-sent', from: role, to: reading.to };
  if (reading.kind === 'transfer-arrived') return { ...base, kind: 'transfer-arrived', from: reading.from, to: role };
  return null;
}

// B48: halves of transfers in the history with no other half seen, from the
// last withinDays days. He says which are still on their way.
export function halvesInTransitIn(bank: BankHistory, today: IsoDate, withinDays: number): HalfInTransit[] {
  const history = readHistory(bank);
  const halves = [...history.reread.values()].flatMap((item) => {
    const half = halfOf(item, history.roles, history.rules);
    return half === null ? [] : [half];
  });
  halves.sort((a, b) => a.date.localeCompare(b.date));
  const paired = new Set<string>();
  for (const arrived of halves.filter((h) => h.kind === 'transfer-arrived')) {
    const candidates = halves.filter((h) => h.kind === 'transfer-sent' && !paired.has(h.id) && h.to === arrived.to && h.amount === arrived.amount);
    const sent = candidates.find((h) => h.from === arrived.from) ?? candidates[0];
    if (sent !== undefined) {
      paired.add(sent.id);
      paired.add(arrived.id);
    }
  }
  return halves.filter((h) => !paired.has(h.id) && daysBetween(h.date, today) >= 0 && daysBetween(h.date, today) <= withinDays);
}

// The bank rule that read a history item as what it is, or null when no rule
// did (section 2): for the screens, so he can see why a half is a transfer.
export function bankRuleOf(bank: BankHistory, transactionId: string): BankRule | null {
  const history = readHistory(bank);
  const item = history.reread.get(transactionId);
  const role = item === undefined ? undefined : history.roles.get(item.accountId);
  const read = item === undefined ? null : readPlaidItem(item.raw);
  if (role === undefined || read === null || !read.ok) return null;
  return readBankItemWithRule(role, read.item.amount, read.item.description, history.rules).rule;
}

export interface SetupPreview {
  // 14.2: checking + savings - everyday card, with pending charges and money in transit.
  readonly startingMoney: Cents;
  readonly posted: BankBalances;
  readonly pendingCharges: readonly (Purchase | SavingsWithdrawal)[];
  readonly inTransit: readonly HalfInTransit[];
  readonly oldCardBalance: Cents;
}

export function setupPreviewOf(bank: BankHistory, inTransitIds: readonly string[]): SetupPreview {
  const history = readHistory(bank);
  const inTransit = chosenHalves(history, inTransitIds);
  return {
    startingMoney: startingMoney(history.posted, history.pendingCharges, inTransit),
    posted: history.posted,
    pendingCharges: history.pendingCharges,
    inTransit,
    oldCardBalance: history.oldCardBalance,
  };
}

function chosenHalves(history: History, ids: readonly string[]): HalfInTransit[] {
  return ids.map((id) => {
    const item = history.reread.get(id);
    const half = item === undefined ? null : halfOf(item, history.roles, history.rules);
    if (half === null) throw new Error(`${id} is not half of a transfer from the history`);
    return half;
  });
}

export interface SetupChoices {
  readonly today: IsoDate;
  readonly assignment: StartingPots;
  readonly lastPaycheckDate: IsoDate;
  readonly settings: Settings;
  readonly rules?: readonly SortingRule[];
  // Ids of halves still on their way (from halvesInTransit).
  readonly inTransit: readonly string[];
}

export type SetupOutcome =
  | { readonly ok: true; readonly startingMoney: Cents }
  // 14.3: not started. difference is starting money minus what was assigned.
  | { readonly ok: false; readonly startingMoney: Cents; readonly assigned: Cents; readonly difference: Cents };

// What setting up does, worked out from the history and changing nothing:
// the book it begins, what the book is given (to keep with its history),
// and the history items whose state changes (to save).
export type SetupPlan =
  | { readonly ok: true; readonly startingMoney: Cents; readonly book: Book; readonly input: SetupInput; readonly items: readonly StoredItem[]; readonly bank: BankBalances }
  | { readonly ok: false; readonly startingMoney: Cents; readonly assigned: Cents; readonly difference: Cents };

export function planSetup(bank: BankHistory, choices: SetupChoices): SetupPlan {
  const history = readHistory(bank);
  const inTransit = chosenHalves(history, choices.inTransit);
  const input: SetupInput = {
    date: choices.today,
    bankBalances: history.posted,
    pendingCharges: history.pendingCharges,
    transfersInTransit: inTransit,
    oldCardBalance: history.oldCardBalance,
    assignment: choices.assignment,
    lastPaycheckDate: choices.lastPaycheckDate,
    settings: choices.settings,
    rules: choices.rules ?? [],
    ...(bank.switches === undefined ? {} : { switches: bank.switches }),
  };
  const result = startTracking(input);
  if (!result.ok) return { ok: false, startingMoney: result.startingMoney, assigned: result.assigned, difference: result.difference };
  const inBook = new Set([...history.pendingCharges.map((c) => c.id), ...inTransit.map((h) => h.id)]);
  const items: StoredItem[] = [];
  for (const item of history.reread.values()) {
    const updated: StoredItem = { ...item };
    if (inBook.has(item.transactionId)) {
      updated.status = 'sent';
      updated.bookId = item.transactionId;
    } else if (item.pending && !item.removed && item.status === 'history') {
      // Pending, but not a purchase: it goes to the book once it posts.
      updated.status = 'waiting';
    }
    if (updated.status !== item.status || updated.kind !== history.items.get(item.transactionId)?.kind || updated.bookId !== item.bookId) items.push(updated);
  }
  // The bank side the book was checked against on setup day (12.1).
  const withPending = withPendingCharges(history.posted, history.pendingCharges);
  return { ok: true, startingMoney: result.startingMoney, book: result.book, input, items, bank: withPending };
}

import { addCents, subtractCents, type Cents } from '@budget-app/money';
import type { WhyAccount, WhyLine } from '../views/home.js';

// Rule 12.6 (QUESTIONS.md A57): why the totals do not match the bank, in
// lines that add up to the difference exactly, to the cent. Worked out from
// the bank alone, with nothing asked of the clock:
//
// - With every read of the bank the app keeps, for each account in the check,
//   its balances as the bank gave them, what the check counted for it (12.1),
//   and the sum of the bank's own transactions on it that the books count
//   (posted ones, and pending charges, 4.6), in Plaid's sign: money out of an
//   account, or onto a card, above zero. And the pending items Plaid listed.
// - At the last read that matched, the bank side plus money in transit was
//   the app side. Every transaction the books count since moves the books by
//   as much as it moves the bank side, so what each account's figure moved
//   beyond its transactions is that account's part of the difference: for
//   checking or savings, what it counted plus its transactions; for a card
//   (the everyday card, and her second card), which the bank side takes away, less what it counted, plus its
//   transactions. What the accounts do not account for is the rest: the
//   books moving otherwise than the bank's transactions (something waiting
//   for his decision, say). So the lines always add up to the difference.
// - A cause is named only when it accounts for an account's move to the cent:
//   the fewest pending items whose parts add up to it, oldest first. Otherwise
//   the whole move is one line: its balance went up or down with no
//   transaction from the bank yet.

export type CheckAccount = WhyAccount;
const ACCOUNTS: readonly CheckAccount[] = ['checking', 'savings', 'everyday-card', 'second-card'];
const isCard = (account: CheckAccount): boolean => account === 'everyday-card' || account === 'second-card';

// One account as a read of the bank left it.
export interface AccountAtRead {
  readonly posted: Cents;
  // Checking and savings: the available balance; null when the bank gave none (always for the card).
  readonly available: Cents | null;
  // What the check counted for it (12.1): BankView.withPending.
  readonly counted: Cents;
  // The bank's own transactions on it that the books count, added up, in Plaid's sign.
  readonly items: Cents;
}

export interface PendingAtRead {
  readonly id: string;
  readonly account: CheckAccount;
  // Plaid's sign: above zero is money out of the account, or onto the card.
  readonly amount: Cents;
}

// What a read of the bank keeps (bank_reads.bank, database step 11).
// Her second card is there only when one is picked: upstream's reads, and
// any kept before it, have none.
export interface BankAtRead {
  readonly accounts: Readonly<Record<Exclude<CheckAccount, 'second-card'>, AccountAtRead>> & { readonly 'second-card'?: AccountAtRead };
  // Every pending item Plaid listed on the three accounts then.
  readonly pending: readonly PendingAtRead[];
  // The last sync saved by then: an item first seen in a later one came since.
  readonly syncs: number;
}

// A pending item listed now, with the bank's words, in the order first seen.
export interface PendingItemNow extends PendingAtRead {
  readonly description: string;
  // A purchase the books count at once (4.6): counted twice once the bank posts it.
  readonly purchase: boolean;
}

// A posted item first seen after the read that matched.
export interface PostedItemSince {
  readonly id: string;
  readonly account: CheckAccount;
  readonly amount: Cents;
  readonly description: string;
}

export interface WhyInput {
  // The check now (12.3): the bank side plus money in transit, minus the app side.
  readonly difference: Cents;
  // The last read that matched; null when none is kept.
  readonly then: BankAtRead | null;
  readonly now: BankAtRead;
  readonly pendingNow: readonly PendingItemNow[];
  readonly postedSince: readonly PostedItemSince[];
}

type Named = Exclude<WhyLine, { kind: 'balance-moved' | 'rest' | 'no-match-kept' }>;

// The fewest items searched among every way; more than this many, only up to SEARCHED_SIZE of them at once, or all.
const SEARCH_ALL_UP_TO = 12;
const SEARCHED_SIZE = 4;

export function whyItDoesNotMatch(input: WhyInput): WhyLine[] {
  const { difference, then, now } = input;
  if (difference === 0) return [];
  if (then === null) return [{ kind: 'no-match-kept', amount: difference }];
  const lines: WhyLine[] = [];
  let explained: Cents = 0;
  for (const account of ACCOUNTS) {
    const before = then.accounts[account];
    const after = now.accounts[account];
    // An account one of the two reads did not have: its part is in the rest.
    if (before === undefined || after === undefined) continue;
    const counted = subtractCents(after.counted, before.counted);
    const move = addCents(isCard(account) ? -counted : counted, subtractCents(after.items, before.items));
    if (move === 0) continue;
    explained = addCents(explained, move);
    const candidates = candidatesOn(account, input).filter((c) => c.amount !== 0);
    const chosen = fewestAddingUpTo(
      candidates.map((c) => c.amount),
      move,
    );
    if (chosen !== null) {
      for (const i of chosen) lines.push(candidates[i]!);
      continue;
    }
    const balance = !isCard(account) && after.available !== null ? 'available' : 'posted';
    // A card's balance going up is the bank side going down.
    const up = isCard(account) ? move < 0 : move > 0;
    lines.push({ kind: 'balance-moved', account, balance, went: up ? 'up' : 'down', by: Math.abs(move), amount: move });
  }
  const rest = subtractCents(difference, explained);
  if (rest !== 0) lines.push({ kind: 'rest', amount: rest });
  return lines;
}

// What could account for an account's move, each with its part of the difference.
function candidatesOn(account: CheckAccount, input: WhyInput): Named[] {
  const then = input.then!;
  const pending = input.pendingNow.filter((p) => p.account === account);
  const available = { then: (then.accounts[account]?.available ?? null) !== null, now: (input.now.accounts[account]?.available ?? null) !== null };
  if (isCard(account) || (!available.then && !available.now)) {
    // The bank posted it, and Plaid still lists it as pending: the posted
    // balance has it, and the check adds a charge again (or leaves money in out).
    return pending.map((p) => ({ kind: 'posted-still-pending', account, description: p.description, charge: p.purchase && p.amount > 0, amount: -p.amount }));
  }
  // Read one way then and the other now: no cause can be named.
  if (!available.then || !available.now) return [];
  const bankAccount = account as 'checking' | 'savings';
  // The available balance already has every pending item (A54), so a change
  // in what Plaid lists that it does not show yet moves the check by as much.
  const listedThen = new Map(then.pending.filter((p) => p.account === account).map((p) => [p.id, p.amount]));
  const paired = new Set<string>();
  const twins: Named[] = [];
  for (const posted of input.postedSince.filter((p) => p.account === account)) {
    const twin = pending.find((p) => p.amount === posted.amount && !paired.has(p.id));
    if (twin === undefined) continue;
    paired.add(twin.id);
    twins.push({ kind: 'posted-and-pending', account: bankAccount, description: posted.description, amount: posted.amount });
  }
  const changed: Named[] = [];
  const fresh: Named[] = [];
  for (const p of pending) {
    if (paired.has(p.id)) continue;
    const was = listedThen.get(p.id);
    if (was === undefined) fresh.push({ kind: 'not-in-available-yet', account: bankAccount, description: p.description, amount: p.amount });
    else if (was !== p.amount) changed.push({ kind: 'amount-changed', account: bankAccount, description: p.description, was: Math.abs(was), now: Math.abs(p.amount), amount: subtractCents(p.amount, was) });
  }
  return [...twins, ...changed, ...fresh];
}

// The indexes of the fewest parts that add up to the target, the earliest
// first among as few; null when none do.
function fewestAddingUpTo(parts: readonly Cents[], target: Cents): number[] | null {
  const n = parts.length;
  const largest = n <= SEARCH_ALL_UP_TO ? n : Math.min(SEARCHED_SIZE, n);
  for (let size = 1; size <= largest; size += 1) {
    const found = firstOfSize(parts, target, size, 0, []);
    if (found !== null) return found;
  }
  if (largest < n && parts.reduce((total, p) => total + p, 0) === target) return parts.map((_, i) => i);
  return null;
}

function firstOfSize(parts: readonly Cents[], target: Cents, size: number, from: number, taken: number[]): number[] | null {
  if (taken.length === size) return taken.reduce((total, i) => total + parts[i]!, 0) === target ? taken : null;
  for (let i = from; i <= parts.length - (size - taken.length); i += 1) {
    const found = firstOfSize(parts, target, size, i + 1, [...taken, i]);
    if (found !== null) return found;
  }
  return null;
}

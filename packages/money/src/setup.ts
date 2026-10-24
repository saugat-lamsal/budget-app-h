import { openBook, type Book, type StartingPots } from './book.js';
import { addCents, assertCents, subtractCents, type Cents } from './cents.js';
import { assertIsoDate, daysBetween, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import type { SortingRule } from './rules.js';
import { bankSide, withPendingCharges, type BankBalances } from './self-check.js';
import type { Settings } from './settings.js';
import { checkSwitches, refuseOffBalances, type Switches } from './switches.js';
import { checkTransaction, type Purchase, type SavingsWithdrawal, type TransferArrived, type TransferSent } from './transactions.js';

// Rulebook section 14: setup day.

export interface SetupInput {
  readonly date: IsoDate;
  // 14.1: the balances as the bank reports them today (posted), and the
  // charges still pending.
  readonly bankBalances: BankBalances;
  readonly pendingCharges: readonly (Purchase | SavingsWithdrawal)[];
  // Transfers with only one half showing (12.5): money that has left one of
  // your accounts and not arrived yet, such as a card payment made
  // yesterday, or one that has arrived but does not show leaving yet.
  readonly transfersInTransit?: readonly (TransferSent | TransferArrived)[];
  // What the old card owes (posted). It becomes the debt (12.4).
  readonly oldCardBalance: Cents;
  // 14.2: where the starting money goes.
  readonly assignment: StartingPots;
  // The pay schedule counts from here until the first paycheck arrives.
  readonly lastPaycheckDate: IsoDate;
  readonly settings: Settings;
  readonly rules?: readonly SortingRule[];
  // Off in this setup (her rulebook): fixed for good from today. None is upstream's.
  readonly switches?: Switches;
}

export type SetupResult =
  | { readonly ok: true; readonly book: Book; readonly startingMoney: Cents }
  // Tracking has not started. difference is starting money minus what was
  // assigned: positive means some is left to assign.
  | { readonly ok: false; readonly startingMoney: Cents; readonly assigned: Cents; readonly difference: Cents };

// 14.2: checking + savings - everyday card balance (her rulebook: - both
// cards' balances), with pending charges included (the same bank side as
// the self-check, 12.1), allowing for money in transit between those
// accounts (12.5, inTransitEffect).
export function startingMoney(
  posted: BankBalances,
  pendingCharges: readonly (Purchase | SavingsWithdrawal)[],
  inTransit: readonly (TransferSent | TransferArrived)[] = [],
): Cents {
  const travelling = inTransit.map(inTransitEffect);
  return addCents(bankSide(withPendingCharges(posted, pendingCharges)), ...travelling);
}

// B48: what one half of a transfer, showing on setup day without its other
// half, does to the starting money. Money that has left and not arrived is
// added: it is still his, on its way. Money that arrived before it shows
// leaving is taken off: it is still counted where it left. A half going to
// the old card does not count either way: the old card is outside the
// starting money (12.4), and its balance already shows whatever has landed.
export function inTransitEffect(half: TransferSent | TransferArrived): Cents {
  checkTransaction(half);
  if (half.kind !== 'transfer-sent' && half.kind !== 'transfer-arrived') {
    throw new MoneyError('bad-transaction', `${String((half as { id?: unknown }).id)} is not half of a transfer`);
  }
  if (half.to === 'old-card') return 0;
  return half.kind === 'transfer-sent' ? half.amount : -half.amount;
}

// 12.4 with A10: the old card debt tracking starts with: what the old card
// owes, posted, plus its charges still pending on setup day.
export function startingDebt(oldCardBalance: Cents, pendingCharges: readonly (Purchase | SavingsWithdrawal)[]): Cents {
  assertCents(oldCardBalance, 'old card balance');
  return addCents(oldCardBalance, ...pendingCharges.filter((c) => c.account === 'old-card').map((c) => c.amount));
}

// 14.2, 14.3: what the assignment adds up to, and what is left to assign:
// the starting money minus what is assigned, below zero when more is
// assigned than there is. Tracking starts only when nothing is left.
export function checkAssignment(money: Cents, assignment: StartingPots): { readonly assigned: Cents; readonly leftToAssign: Cents } {
  assertCents(money, 'starting money');
  const a = assignment;
  for (const [name, value] of Object.entries(a)) assertCents(value, name);
  // Her rulebook, 14.2: and Wishlist, where the setup has it.
  const assigned = addCents(a.savings, a.needs, a.wants, a.momReserve, a.heldForOthers, a.wishlist ?? 0);
  return { assigned, leftToAssign: subtractCents(money, assigned) };
}

// 14.3: tracking starts only when the assignment adds up to the starting
// money exactly, so the self-check passes from day one. Charges pending on
// setup day are already in the starting money, so the book counts them as
// spent at setup (QUESTIONS.md A10).
export function startTracking(input: SetupInput): SetupResult {
  // Her rulebook, 14.2: the second card's balance is part of the starting
  // money only in a setup that has one.
  refuseOffBalances(checkSwitches(input.switches), input.bankBalances);
  const ids = new Set<string>();
  const inTransit = input.transfersInTransit ?? [];
  for (const transfer of inTransit) {
    if (ids.has(transfer.id)) throw new MoneyError('conflicting-id', `two transfers in transit have the id ${transfer.id}`);
    ids.add(transfer.id);
  }
  for (const charge of input.pendingCharges) {
    checkTransaction(charge);
    if ((charge.kind !== 'purchase' && charge.kind !== 'savings-withdrawal') || !charge.pending) throw new MoneyError('bad-transaction', `${charge.id} is not a pending charge`);
    if (ids.has(charge.id)) throw new MoneyError('conflicting-id', `two pending charges have the id ${charge.id}`);
    ids.add(charge.id);
  }
  const money = startingMoney(input.bankBalances, input.pendingCharges, inTransit);
  const { assigned, leftToAssign } = checkAssignment(money, input.assignment);
  if (leftToAssign !== 0) return { ok: false, startingMoney: money, assigned, difference: leftToAssign };
  // B42: the pay schedule counts from his last paycheck, which has come.
  assertIsoDate(input.date, 'setup day');
  if (daysBetween(input.lastPaycheckDate, input.date) < 0) {
    throw new MoneyError('bad-date', `the last paycheck (${input.lastPaycheckDate}) cannot be after setup day (${input.date})`);
  }

  const book = openBook({
    date: input.date,
    pots: input.assignment,
    oldCardDebt: startingDebt(input.oldCardBalance, input.pendingCharges),
    lastPaycheckDate: input.lastPaycheckDate,
    settings: input.settings,
    rules: input.rules ?? [],
    countedAtSetup: input.pendingCharges,
    inTransitAtSetup: inTransit,
    ...(input.switches === undefined ? {} : { switches: input.switches }),
  });
  if (!book.selfCheck(withPendingCharges(input.bankBalances, input.pendingCharges)).ok) {
    throw new MoneyError('broken-book', 'the self-check failed right after setup');
  }
  return { ok: true, book, startingMoney: money };
}

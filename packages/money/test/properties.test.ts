// Random-scenario tests (testing bar point 4): things that must always be
// true, checked against many made-up histories.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  DEFAULT_SETTINGS,
  MoneyError,
  addDays,
  changeSettings,
  daysBetween,
  monthOf,
  payoffCountdown,
  splitPaycheck,
  startTracking,
  startingMoney,
  type AccountId,
  type BankTransaction,
  type Book,
  type Cents,
  type IsoDate,
  type Purchase,
  type SavingsWithdrawal,
  type LeftoverChoice,
  type MoneyInChoice,
  type Pot,
  type SortChoice,
  type SortingRule,
} from '../src/index.js';
import {
  MOM_NAME,
  TEST_SETTINGS,
  TestBank,
  appSide,
  arrived,
  cardCharge,
  deposit,
  dropped,
  openTestBook,
  payPerson,
  paycheck,
  pendingChanged,
  posted,
  purchase,
  refund,
  sent,
  takenBack,
  transfer,
  withdrawal,
  START_DATE,
} from './helpers.js';
import { runs } from './slow.js';

const splitArb = fc
  .integer({ min: 0, max: 100 })
  .chain((savings) => fc.integer({ min: 0, max: 100 - savings }).map((needs) => ({ savings, needs, wants: 100 - savings - needs })));

const paycheckAmountArb = fc.oneof(
  fc.integer({ min: 1, max: 1_000_000 }),
  fc.integer({ min: 1, max: 1_000_000_000_000 }),
  fc.constantFrom(1, 149_999, 150_000, 150_001, 300_000),
);

const leftoverChoiceArb = fc.constantFrom<LeftoverChoice>('ask', 'roll-over', 'move-to-savings');

describe('random scenarios: payday (section 3)', () => {
  it('3.3 the paycheck parts always add up to the paycheck exactly, and each part is right', () => {
    fc.assert(
      fc.property(
        paycheckAmountArb,
        fc.integer({ min: -1_000_000, max: 1_000_000_000 }),
        splitArb,
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (amount, reserveNow, split, perPaycheck, cap) => {
          const rules = changeSettings(DEFAULT_SETTINGS, { split, momReservePerPaycheck: perPaycheck, momReserveCap: cap });
          const s = splitPaycheck(amount, reserveNow, rules);
          expect(s.momReserve + s.savings + s.needs + s.wants).toBe(amount);
          for (const part of [s.momReserve, s.savings, s.needs, s.wants]) {
            expect(Number.isSafeInteger(part) && part >= 0).toBe(true);
          }
          const reserveTaken = Math.min(perPaycheck, amount);
          expect(s.momReserve).toBe(Math.min(reserveTaken, Math.max(0, cap - reserveNow)));
          expect(s.momReserve + s.detail.overflowToSavings).toBe(reserveTaken);
          const rest = BigInt(amount - reserveTaken);
          expect(s.needs).toBe(Number((rest * BigInt(split.needs)) / 100n));
          expect(s.wants).toBe(Number((rest * BigInt(split.wants)) / 100n));
          expect(s.detail.roundingToSavings).toBeGreaterThanOrEqual(0);
          expect(s.detail.roundingToSavings).toBeLessThan(3);
        },
      ),
      { numRuns: runs(2_000) },
    );
  });
});

// One step in a made-up money life. Steps that need something to exist
// (like a question to answer) pick it by index, so every step can run.
type Step =
  | { type: 'paycheck'; gap: number; amount: number }
  | { type: 'deposit'; gap: number; amount: number; description: string; account: 'checking' | 'savings' }
  | { type: 'answer-leftover'; pick: number; choice: 'roll-over' | 'move-to-savings' }
  | { type: 'repeat'; pick: number }
  | { type: 'purchase'; gap: number; amount: number; account: 'checking' | 'savings' | 'everyday-card' | 'old-card'; pending: boolean; description: string }
  | { type: 'post'; pick: number; change: number }
  | { type: 'drop'; pick: number }
  | { type: 'change-pending'; pick: number; change: number }
  | { type: 'take-back'; pick: number }
  | { type: 'mark-transfer'; pick: number; other: AccountId }
  | { type: 'not-for-mom'; pick: number; seed: number }
  | { type: 'refund'; pick: number; amount: number; linked: boolean; account: 'checking' | 'everyday-card' }
  | { type: 'card-charge'; amount: number; charge: 'fee' | 'interest' }
  | { type: 'sort'; pick: number; seed: number }
  | { type: 'resort'; pick: number; seed: number }
  | { type: 'transfer'; amount: number; from: 'checking' | 'savings'; to: 'checking' | 'savings' | 'everyday-card' | 'old-card' }
  | { type: 'old-card'; amount: number; what: 'purchase' | 'pending' | 'fee' | 'interest' | 'refund' }
  | { type: 'acknowledge'; pick: number }
  | { type: 'resort-money-in'; pick: number; seed: number }
  | { type: 'pay-person'; amount: number; payee: string; account: 'checking' | 'savings' }
  | { type: 'pay-mom'; amount: number; account: 'checking' | 'savings' }
  | { type: 'move'; from: Pot; to: Pot; amount: number }
  | { type: 'change-split'; split: { savings: number; needs: number; wants: number }; reserve: number }
  | { type: 'add-rule'; rule: number }
  | { type: 'send-half'; amount: number; from: 'checking' | 'savings'; to: 'checking' | 'savings' | 'everyday-card' | 'old-card'; arrivesFirst: boolean }
  | { type: 'other-half'; pick: number; linked: boolean }
  | { type: 'always'; pick: number; seed: number }
  | { type: 'my-paycheck'; pick: number };

const gapArb = fc.integer({ min: 0, max: 20 });
const potNameArb = fc.constantFrom<Pot>('savings', 'needs', 'wants', 'momReserve', 'heldForOthers');

// Rules that can be added part way through a made-up life (13.2).
// Each gets a fresh id when it is added.
const LATER_RULES: SortingRule[] = [
  { id: 'later', for: 'purchase', contains: 'HARDWARE', bucket: 'needs' },
  { id: 'later', for: 'purchase', contains: 'STORE', bucket: 'wants' },
  { id: 'later', for: 'deposit', contains: 'DEPOSIT', choice: { to: 'other-income' } },
  { id: 'later', for: 'person', contains: 'FRIEND', choice: { to: 'not-mine' } },
];
const smallAmountArb = fc.oneof(fc.integer({ min: 1, max: 50_000 }), fc.constantFrom(1, 2, 100));

const paycheckStepArb = fc.record({ type: fc.constant('paycheck' as const), gap: gapArb, amount: paycheckAmountArb });
const depositStepArb = fc.record({
  type: fc.constant('deposit' as const),
  gap: gapArb,
  amount: fc.integer({ min: 1, max: 1_000_000 }),
  description: fc.constantFrom('MADE UP DEPOSIT', 'MADE UP BONUS', 'MADE UP ROOMMATE', 'MADE UP FRIEND'),
  account: fc.constantFrom('checking' as const, 'savings' as const),
});
const myPaycheckStepArb = fc.record({ type: fc.constant('my-paycheck' as const), pick: fc.nat() });
const resortMoneyInStepArb = fc.record({ type: fc.constant('resort-money-in' as const), pick: fc.nat(), seed: fc.nat() });

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  paycheckStepArb,
  depositStepArb,
  fc.record({ type: fc.constant('answer-leftover' as const), pick: fc.nat(), choice: fc.constantFrom('roll-over' as const, 'move-to-savings' as const) }),
  fc.record({ type: fc.constant('repeat' as const), pick: fc.nat() }),
  fc.record({
    type: fc.constant('purchase' as const),
    gap: fc.integer({ min: 0, max: 3 }),
    amount: smallAmountArb,
    account: fc.constantFrom('checking' as const, 'savings' as const, 'everyday-card' as const, 'old-card' as const),
    pending: fc.boolean(),
    description: fc.constantFrom('MADE UP GROCER', 'MADE UP CAFE', 'MADE UP HARDWARE'),
  }),
  fc.record({ type: fc.constant('post' as const), pick: fc.nat(), change: fc.integer({ min: -5_000, max: 5_000 }) }),
  fc.record({ type: fc.constant('drop' as const), pick: fc.nat() }),
  fc.record({ type: fc.constant('change-pending' as const), pick: fc.nat(), change: fc.integer({ min: -5_000, max: 5_000 }) }),
  fc.record({ type: fc.constant('take-back' as const), pick: fc.nat() }),
  fc.record({
    type: fc.constant('mark-transfer' as const),
    pick: fc.nat(),
    other: fc.constantFrom<AccountId>('checking', 'savings', 'savings', 'everyday-card', 'old-card'),
  }),
  fc.record({ type: fc.constant('not-for-mom' as const), pick: fc.nat(), seed: fc.nat() }),
  fc.record({
    type: fc.constant('refund' as const),
    pick: fc.nat(),
    amount: smallAmountArb,
    linked: fc.boolean(),
    account: fc.constantFrom('checking' as const, 'everyday-card' as const),
  }),
  fc.record({ type: fc.constant('card-charge' as const), amount: smallAmountArb, charge: fc.constantFrom('fee' as const, 'interest' as const) }),
  fc.record({ type: fc.constant('sort' as const), pick: fc.nat(), seed: fc.nat() }),
  fc.record({ type: fc.constant('resort' as const), pick: fc.nat(), seed: fc.nat() }),
  fc.record({
    type: fc.constant('transfer' as const),
    amount: smallAmountArb,
    from: fc.constantFrom('checking' as const, 'savings' as const),
    to: fc.constantFrom('checking' as const, 'savings' as const, 'everyday-card' as const, 'old-card' as const),
  }),
  fc.record({ type: fc.constant('old-card' as const), amount: smallAmountArb, what: fc.constantFrom('purchase' as const, 'pending' as const, 'fee' as const, 'interest' as const, 'refund' as const) }),
  fc.record({ type: fc.constant('acknowledge' as const), pick: fc.nat() }),
  resortMoneyInStepArb,
  fc.record({
    type: fc.constant('pay-person' as const),
    amount: smallAmountArb,
    payee: fc.constantFrom('MADE UP FRIEND', 'MADE UP LANDLORD', 'MADE UP ROOMMATE', 'MADE UP AUNT'),
    account: fc.constantFrom('checking' as const, 'checking' as const, 'savings' as const),
  }),
  fc.record({
    type: fc.constant('pay-mom' as const),
    amount: fc.oneof(smallAmountArb, fc.integer({ min: 100_000, max: 400_000 })),
    account: fc.constantFrom('checking' as const, 'checking' as const, 'savings' as const),
  }),
  fc.record({ type: fc.constant('move' as const), from: potNameArb, to: potNameArb, amount: smallAmountArb }),
  fc.record({ type: fc.constant('change-split' as const), split: splitArb, reserve: fc.integer({ min: 0, max: 300_000 }) }),
  fc.record({ type: fc.constant('add-rule' as const), rule: fc.nat() }),
  fc.record({
    type: fc.constant('send-half' as const),
    amount: smallAmountArb,
    from: fc.constantFrom('checking' as const, 'savings' as const),
    to: fc.constantFrom('checking' as const, 'savings' as const, 'everyday-card' as const, 'old-card' as const),
    arrivesFirst: fc.boolean(),
  }),
  fc.record({ type: fc.constant('other-half' as const), pick: fc.nat(), linked: fc.boolean() }),
  fc.record({ type: fc.constant('always' as const), pick: fc.nat(), seed: fc.nat() }),
  myPaycheckStepArb,
);

// The same, with money in coming much more often (6.1): paychecks, early
// paychecks, deposits, and each of the choices for them.
const moneyInStepArb: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: stepArb, weight: 4 },
  { arbitrary: fc.record({ type: fc.constant('paycheck' as const), gap: fc.integer({ min: 0, max: 15 }), amount: paycheckAmountArb }), weight: 2 },
  { arbitrary: depositStepArb, weight: 3 },
  { arbitrary: myPaycheckStepArb, weight: 2 },
  { arbitrary: resortMoneyInStepArb, weight: 2 },
);

// Lots of sorted spending, so buckets run low and empty often (10.1, 10.2).
const spendingStepArb: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: stepArb, weight: 3 },
  {
    arbitrary: fc.record({
      type: fc.constant('purchase' as const),
      gap: fc.integer({ min: 0, max: 2 }),
      amount: fc.integer({ min: 1, max: 60_000 }),
      account: fc.constantFrom('checking' as const, 'everyday-card' as const),
      pending: fc.boolean(),
      description: fc.constantFrom('MADE UP GROCER', 'MADE UP CAFE'),
    }),
    weight: 6,
  },
);

const potArb = fc.integer({ min: -1_000_000, max: 10_000_000 });
const openingArb = fc.record({ savings: potArb, needs: potArb, wants: potArb, momReserve: fc.integer({ min: 0, max: 400_000 }), heldForOthers: potArb });

const RULES: SortingRule[] = [
  { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
  { id: 'bonus', for: 'deposit', contains: 'BONUS', choice: { to: 'other-income' } },
  { id: 'roommate', for: 'deposit', contains: 'ROOMMATE', choice: { to: 'not-mine' } },
  { id: 'friend', for: 'deposit', contains: 'FRIEND', choice: { to: 'wants' } },
  { id: 'landlord', for: 'person', contains: 'LANDLORD', choice: { to: 'needs' } },
  { id: 'roommate-out', for: 'person', contains: 'ROOMMATE', choice: { to: 'not-mine' } },
];

function pick<T>(list: readonly T[], index: number): T | undefined {
  return list[index % Math.max(1, list.length)];
}

// A valid way to sort spending of this amount, chosen by the seed. A
// payment to a person can also be not mine, for mom (unless part of it was
// refunded), or split across needs, wants, and not mine (7.6). The
// difference on a mom payment cannot be split.
function spendingChoice(amount: number, seed: number, kind: string, canBeMom = false): SortChoice {
  if (kind === 'person-payment') {
    if (seed % 6 === 3 && canBeMom) return { to: 'mom' };
    if (seed % 6 >= 4 && amount >= 3) {
      const needs = 1 + (seed % (amount - 2));
      const wants = 1 + (seed % (amount - needs - 1));
      return {
        split: [
          { bucket: 'needs', amount: needs },
          { bucket: 'wants', amount: wants },
          { bucket: 'not-mine', amount: amount - needs - wants },
        ],
      };
    }
    return { to: (['needs', 'wants', 'not-mine'] as const)[seed % 3] ?? 'needs' };
  }
  // A payment to the old card from savings: savings once confirmed, or needs (QUESTIONS.md A4).
  if (kind === 'old-card-from-savings') return { to: seed % 2 === 0 ? 'savings' : 'needs' };
  if (seed % 3 === 2 && amount >= 2 && kind !== 'mom-difference') {
    const needs = 1 + (seed % (amount - 1));
    return { split: [{ bucket: 'needs', amount: needs }, { bucket: 'wants', amount: amount - needs }] };
  }
  return { to: seed % 3 === 0 ? 'needs' : 'wants' };
}

// A valid choice for money in (6.1). A store refund cannot be income of
// either kind, and a deposit older than the last paycheck cannot be your
// paycheck.
function moneyInChoice(seed: number, isRefund: boolean, canBePaycheck: boolean): { readonly to: MoneyInChoice['to'] } {
  const income: MoneyInChoice['to'][] = isRefund ? [] : ['other-income', ...(canBePaycheck ? ['paycheck' as const] : [])];
  const choices: MoneyInChoice['to'][] = [...BUCKETS, 'not-mine', ...income];
  return { to: choices[seed % choices.length] ?? 'savings' };
}

type HalfDone = { id: string; first: 'left' | 'arrived'; from: 'checking' | 'savings'; to: AccountId; amount: number };

// What the bank can take back (4.10): anything it sent that the app counted,
// except a charge still pending (that is dropped instead) and the bank's own
// notes about other transactions.
function takeable(txn: BankTransaction): boolean {
  switch (txn.kind) {
    case 'purchase':
    case 'savings-withdrawal':
      return !txn.pending;
    case 'deposit':
    case 'refund':
    case 'card-charge':
    case 'payment-to-person':
    case 'transfer':
    case 'transfer-sent':
    case 'transfer-arrived':
      return true;
    case 'pending-dropped':
    case 'pending-changed':
    case 'taken-back':
      return false;
  }
}

// A charge that can be pending first: a purchase, or money leaving savings (4.9).
type Charge = Purchase | SavingsWithdrawal;

// The posted version of a pending charge, at a new amount maybe (4.6).
function postedOf(id: string, target: Charge, date: IsoDate, amount: number): Charge {
  return target.kind === 'savings-withdrawal'
    ? withdrawal(id, date, amount, target.description, { pendingId: target.id })
    : posted(id, target.id, date, amount, target.description, target.account);
}

function runLife(book: Book, bank: TestBank, steps: Step[], pendingAtSetup: readonly Charge[] = [], inTransitAtSetup: readonly HalfDone[] = []): void {
  let date = START_DATE;
  let n = 0;
  const received: BankTransaction[] = [];
  // Pending purchases the bank has not posted yet, on any account.
  const pending: Charge[] = [...pendingAtSetup];
  // Transfers with one half sent so far, waiting for the other (12.5).
  const halfDone: HalfDone[] = [...inTransitAtSetup];
  // The low and empty alerts given, as "period bucket kind" (10.1, 10.2).
  const given = new Set<string>();
  // Money in that can be sorted and re-sorted (not paychecks or matched refunds).
  const moneyIn: { id: string; date: IsoDate; isRefund: boolean }[] = [];
  // Payments marked for mom by hand (7.6), and ones the mom rule matched (8.1).
  const forMom: string[] = [];
  const momRule: string[] = [];
  // What the bank took back (4.10), by the transaction's id and the book's.
  const gone = new Set<string>();
  // Things marked as a transfer's half by hand (5.6), by the book's id: what
  // each adds to the money in transit, worked out here (12.5).
  const marked = new Map<string, { contribution: Cents; amount: Cents }>();
  // What each leftover question asked about at payday (3.4, B4).
  const leftoverAtPayday = new Map<string, Cents>();
  // Marked by hand and then made money in again (5.6): the transfer's half is gone.
  const unmark = (id: string): void => {
    const mark = marked.get(id);
    if (mark === undefined) return;
    bank.inTransit -= mark.contribution;
    marked.delete(id);
    const at = halfDone.findIndex((h) => h.id === id);
    if (at >= 0) halfDone.splice(at, 1);
  };
  // Sorts money in. Once it is your paycheck it is final (6.1).
  const sortMoneyIn = (id: string, txnDate: IsoDate, isRefund: boolean, seed: number | 'paycheck'): void => {
    const choice = seed === 'paycheck' ? { to: 'paycheck' as const } : moneyInChoice(seed, isRefund, daysBetween(book.lastPaycheckDate(), txnDate) >= 0);
    const paychecksBefore = book.paychecks().length;
    book.sort(id, choice, date);
    unmark(id);
    if (choice.to === 'paycheck') {
      expect(book.paychecks().length).toBe(paychecksBefore + 1);
      expect(book.lastPaycheckDate()).toBe(txnDate);
      moneyIn.splice(moneyIn.findIndex((m) => m.id === id), 1);
    }
  };
  const canBeMom = (id: string): boolean => (book.purchases().find((p) => p.id === id)?.refunded ?? 0) === 0;
  const send = (txn: BankTransaction): void => {
    const { outcome } = book.receive(txn);
    bank.apply(txn);
    received.push(txn);
    if ((txn.kind === 'purchase' || txn.kind === 'savings-withdrawal') && txn.pending) pending.push(txn);
    if ((txn.kind === 'deposit' && outcome !== 'paycheck') || (txn.kind === 'refund' && outcome === 'review')) {
      moneyIn.push({ id: txn.id, date: txn.date, isRefund: txn.kind === 'refund' });
    }
  };
  for (const step of steps) {
    switch (step.type) {
      case 'paycheck':
      case 'deposit': {
        date = addDays(date, step.gap);
        const id = `t${n++}`;
        send(step.type === 'paycheck' ? paycheck(id, date, step.amount) : deposit(id, date, step.amount, step.description, step.account));
        break;
      }
      case 'answer-leftover': {
        const item = pick(book.reviewItems().filter((i) => i.type === 'leftover'), step.pick);
        if (item?.type !== 'leftover') break;
        // B4: it moves what the question asks about now, which late spending
        // from before payday has lowered: never below zero, never above what
        // it asked at payday.
        expect(item.amount).toBeGreaterThanOrEqual(0);
        expect(item.amount).toBeLessThanOrEqual(leftoverAtPayday.get(item.id) ?? Number.MAX_SAFE_INTEGER);
        const before = book.pots();
        book.answerLeftover(item.id, step.choice, date);
        const moved = step.choice === 'move-to-savings' ? item.amount : 0;
        expect(book.pots()[item.bucket]).toBe(before[item.bucket] - moved);
        expect(book.pots().savings).toBe(before.savings + moved);
        break;
      }
      case 'repeat': {
        // Nothing is counted twice: the bank sending the same thing again changes nothing.
        const txn = pick(received, step.pick);
        if (txn) expect(book.receive(txn).outcome).toBe('duplicate');
        break;
      }
      case 'purchase':
        date = addDays(date, step.gap);
        send(
          step.account === 'savings'
            ? withdrawal(`t${n++}`, date, step.amount, step.description, { pending: step.pending })
            : purchase(`t${n++}`, date, step.amount, step.description, { account: step.account, pending: step.pending }),
        );
        break;
      case 'post': {
        const index = step.pick % Math.max(1, pending.length);
        const [target] = pending.splice(index, 1);
        if (target) send(postedOf(`t${n++}`, target, date, Math.max(1, target.amount + step.change)));
        break;
      }
      case 'drop': {
        // QUESTIONS.md A2: the bank drops a pending charge without posting it.
        const [target] = pending.splice(step.pick % Math.max(1, pending.length), 1);
        if (target) send(dropped(`t${n++}`, target.id, date));
        break;
      }
      case 'change-pending': {
        // QUESTIONS.md A13: the bank changes a pending charge's amount before it posts.
        const index = step.pick % Math.max(1, pending.length);
        const target = pending[index];
        if (!target) break;
        const amount = Math.max(1, target.amount + step.change);
        send(pendingChanged(`t${n++}`, target.id, date, amount));
        pending[index] = { ...target, amount };
        break;
      }
      case 'take-back': {
        // 4.10 (A14): the bank takes back something it sent, and the app
        // takes it back too, logging it (13.5).
        const target = pick(received.filter((t) => takeable(t) && !gone.has(t.id)), step.pick);
        if (!target) break;
        const logBefore = book.changeLog().length;
        send(takenBack(`t${n++}`, target.id, date));
        const entryId = (target.kind === 'purchase' || target.kind === 'savings-withdrawal') && target.pendingId !== undefined ? target.pendingId : target.id;
        gone.add(target.id);
        gone.add(entryId);
        // A mom payment's difference goes with it (8.3).
        gone.add(`${entryId}:difference`);
        const mark = marked.get(entryId);
        if (mark !== undefined) {
          bank.inTransit -= mark.contribution;
          marked.delete(entryId);
        }
        const waiting = moneyIn.findIndex((m) => m.id === target.id);
        if (waiting >= 0) moneyIn.splice(waiting, 1);
        expect(book.changeLog().length).toBe(logBefore + 1);
        expect(book.changeLog().at(-1)).toMatchObject({ kind: 'bank-took-back', date, id: entryId });
        break;
      }
      case 'mark-transfer': {
        // 5.6 (A12): spending or money in that was really a transfer between
        // your accounts becomes that transfer's half. Refused, it changes nothing.
        const waiting = book.reviewItems().flatMap((i) => (i.type === 'spending' || i.type === 'money-in' ? [{ id: i.id, amount: i.amount }] : []));
        const again = [...marked.entries()].map(([id, m]) => ({ id, amount: m.amount }));
        const target = pick([...waiting, ...again], step.pick);
        const original = received.find((t) => t.id === target?.id);
        if (!target || !original) break;
        if (original.kind !== 'purchase' && original.kind !== 'savings-withdrawal' && original.kind !== 'payment-to-person' && original.kind !== 'deposit' && original.kind !== 'refund') break;
        const before = { pots: book.pots(), inTransit: book.inTransit().total, debt: book.oldCardDebt() };
        try {
          book.sort(target.id, { transfer: step.other }, date);
        } catch (error) {
          if (!(error instanceof MoneyError)) throw error;
          expect({ pots: book.pots(), inTransit: book.inTransit().total, debt: book.oldCardDebt() }).toEqual(before);
          break;
        }
        const leaving = original.kind === 'purchase' || original.kind === 'savings-withdrawal' || original.kind === 'payment-to-person';
        const from = leaving ? original.account : step.other;
        const to = leaving ? step.other : original.account;
        const contribution = to === 'old-card' ? 0 : leaving ? target.amount : -target.amount;
        bank.inTransit += contribution - (marked.get(target.id)?.contribution ?? 0);
        marked.set(target.id, { contribution, amount: target.amount });
        // Its other half shows up later, like any transfer's (12.5).
        const at = halfDone.findIndex((h) => h.id === target.id);
        if (at >= 0) halfDone.splice(at, 1);
        if (from === 'checking' || from === 'savings') halfDone.push({ id: target.id, first: leaving ? 'left' : 'arrived', from, to, amount: target.amount });
        break;
      }
      case 'not-for-mom': {
        // 7.6: a payment marked for mom, sorted another way. It no longer
        // counts toward the month (8.2). One the mom rule matched cannot be (8.1).
        if (step.seed % 4 === 0) {
          const id = pick(momRule, step.pick);
          if (id === undefined) break;
          const before = book.pots();
          expect(() => book.sort(id, { to: 'needs' }, date)).toThrow(MoneyError);
          expect(book.pots()).toEqual(before);
          break;
        }
        const index = step.pick % Math.max(1, forMom.length);
        const id = forMom[index];
        const txn = received.find((t) => t.id === id);
        if (id === undefined || gone.has(id) || txn?.kind !== 'payment-to-person') break;
        forMom.splice(index, 1);
        const month = monthOf(txn.date);
        const sentBefore = book.momSentInMonth(month).sent;
        book.sort(id, spendingChoice(txn.amount, step.seed, 'person-payment'), date);
        expect(book.momSentInMonth(month).sent).toBe(sentBefore - txn.amount);
        break;
      }
      case 'refund': {
        // A refund can only name a bank transaction, not one of the book's own entries.
        const target = pick(book.purchases().filter((p) => !p.id.includes(':')), step.pick);
        send(refund(`t${n++}`, date, step.amount, step.linked ? target?.id : undefined, step.account));
        break;
      }
      case 'card-charge':
        send(cardCharge(`t${n++}`, date, step.amount, step.charge));
        break;
      case 'sort': {
        const item = pick(book.reviewItems().filter((i) => i.type !== 'leftover'), step.pick);
        if (item?.type === 'spending') {
          const choice = spendingChoice(item.amount, step.seed, item.reason, canBeMom(item.id));
          book.sort(item.id, choice, date);
          if ('to' in choice && choice.to === 'mom') forMom.push(item.id);
        }
        if (item?.type === 'money-in') sortMoneyIn(item.id, item.date, item.reason === 'refund', step.seed);
        break;
      }
      case 'resort': {
        const target = pick(book.purchases().filter((p) => p.kind !== 'debt-payoff' && !gone.has(p.id)), step.pick);
        if (!target) break;
        const choice = spendingChoice(target.amount - target.refunded - target.countedAtSetup, step.seed, target.kind, target.refunded === 0);
        book.sort(target.id, choice, date);
        if ('to' in choice && choice.to === 'mom') forMom.push(target.id);
        break;
      }
      case 'transfer': {
        if (step.from === step.to) break;
        const before = book.pots();
        send(transfer(`t${n++}`, date, step.amount, step.from, step.to));
        // A transfer between your own accounts never changes a bucket. A
        // payment to the old card is the exception: it is spending (5.2).
        if (step.to !== 'old-card') expect(book.pots()).toEqual(before);
        break;
      }
      case 'old-card': {
        const id = `t${n++}`;
        if (step.what === 'purchase' || step.what === 'pending') {
          send(purchase(id, date, step.amount, 'MADE UP CAFE', { account: 'old-card', pending: step.what === 'pending' }));
        } else if (step.what === 'refund') {
          send(refund(id, date, step.amount, undefined, 'old-card'));
        } else {
          send(cardCharge(id, date, step.amount, step.what, 'old-card'));
        }
        break;
      }
      case 'my-paycheck': {
        // 6.1: a deposit in review, or already sorted, that you call your paycheck.
        const target = pick(moneyIn.filter((m) => !m.isRefund && daysBetween(book.lastPaycheckDate(), m.date) >= 0), step.pick);
        if (target) sortMoneyIn(target.id, target.date, false, 'paycheck');
        break;
      }
      case 'resort-money-in': {
        const target = pick(moneyIn, step.pick);
        if (target) sortMoneyIn(target.id, target.date, target.isRefund, step.seed);
        break;
      }
      case 'pay-person':
        send(payPerson(`t${n++}`, date, step.amount, step.payee, step.account));
        break;
      case 'pay-mom': {
        const id = `t${n++}`;
        send(payPerson(id, date, step.amount, MOM_NAME, step.account));
        momRule.push(id);
        break;
      }
      case 'move':
        if (step.from !== step.to) book.moveMoney({ from: step.from, to: step.to, amount: step.amount, confirmed: true }, date);
        break;
      case 'change-split':
        book.changeSettings({ split: step.split, momReservePerPaycheck: step.reserve }, date);
        break;
      case 'send-half': {
        if (step.from === step.to) break;
        const before = book.pots();
        const id = `t${n++}`;
        send(step.arrivesFirst ? arrived(id, date, step.amount, step.from, step.to) : sent(id, date, step.amount, step.from, step.to));
        halfDone.push({ id, first: step.arrivesFirst ? 'arrived' : 'left', from: step.from, to: step.to, amount: step.amount });
        // Either half of a transfer between your own accounts never changes
        // a bucket, except money leaving for the old card (5.2).
        if (step.to !== 'old-card' || step.arrivesFirst) expect(book.pots()).toEqual(before);
        break;
      }
      case 'other-half': {
        const [first] = halfDone.splice(step.pick % Math.max(1, halfDone.length), 1);
        if (!first) break;
        const id = `t${n++}`;
        if (first.first === 'left') {
          send(arrived(id, date, first.amount, first.from, first.to, step.linked ? first.id : undefined));
        } else {
          send(sent(id, date, first.amount, first.from, first.to));
        }
        break;
      }
      case 'always': {
        // 13.6: correct a purchase or payment and "always do this". The fix
        // must stick: the next one with the same description lands there too.
        const target = pick(book.purchases().filter((p) => (p.kind === 'purchase' || p.kind === 'person-payment') && !gone.has(p.id)), step.seed);
        const original = received.find((t) => t.id === target?.id);
        if (!target || !original || (original.kind !== 'purchase' && original.kind !== 'savings-withdrawal' && original.kind !== 'payment-to-person')) break;
        // 4.9: no rule sorts money leaving savings, so "always" is refused.
        if (original.kind === 'savings-withdrawal') {
          const before = book.pots();
          expect(() => book.sortAlways(target.id, { to: 'needs' }, { id: `fix${n++}`, contains: target.description }, date)).toThrow(MoneyError);
          expect(book.pots()).toEqual(before);
          break;
        }
        const toPerson = target.kind === 'person-payment';
        // A person rule can say for mom (7.6), unless part of this one was refunded.
        const personChoices = target.refunded === 0 ? (['needs', 'wants', 'not-mine', 'mom'] as const) : (['needs', 'wants', 'not-mine'] as const);
        const to = toPerson ? (personChoices[step.pick % personChoices.length] ?? 'needs') : ((['needs', 'wants'] as const)[step.pick % 2] ?? 'needs');
        book.sortAlways(target.id, { to }, { id: `fix${n++}`, contains: target.description }, date);
        if (to === 'mom') forMom.push(target.id);
        const probeId = `t${n++}`;
        const month = monthOf(date);
        const sentBefore = book.momSentInMonth(month).sent;
        send(toPerson ? payPerson(probeId, date, 100, target.description.replace(/^ZELLE TO /, '')) : purchase(probeId, date, 100, target.description, { account: 'checking' }));
        if (to === 'mom') {
          // For mom: out of the reserve, and counted toward the month (8.2).
          expect(book.purchases().some((p) => p.id === probeId)).toBe(false);
          expect(book.momSentInMonth(month).sent).toBe(sentBefore + 100);
        } else {
          expect(book.purchases().find((p) => p.id === probeId)?.sortedTo).toEqual({ to });
        }
        break;
      }
      case 'add-rule': {
        const rule = LATER_RULES[step.rule % LATER_RULES.length];
        if (rule) book.addRule({ ...rule, id: `rule${n++}` }, date);
        break;
      }
      case 'acknowledge': {
        const item = pick(book.reviewItems().filter((i) => i.type === 'old-card-purchase'), step.pick);
        if (item) book.acknowledge(item.id, date);
        break;
      }
    }
    for (const item of book.reviewItems()) if (item.type === 'leftover' && !leftoverAtPayday.has(item.id)) leftoverAtPayday.set(item.id, item.amount);
    // No cent is created or lost: the buckets always match the bank, with
    // money in transit counted (12.5), and the daily self-check agrees.
    expect(appSide(book.pots())).toBe(bank.side() + bank.inTransit);
    expect(book.selfCheck(bank)).toMatchObject({ ok: true, difference: 0, inTransit: bank.inTransit });
    // The in-transit list adds up to the in-transit total.
    const listed = book
      .inTransit()
      .items.filter((i) => i.to !== 'old-card')
      .reduce((sum, i) => sum + (i.seen === 'left' ? i.amount : -i.amount), 0);
    expect(listed).toBe(book.inTransit().total);
    // Safe to spend is always wants left minus unsorted spending (11.1).
    expect(book.safeToSpend(date).amount).toBe(book.pots().wants - book.pots().unsortedOut);
    // The old card debt always matches the bank, and is kept out of the buckets.
    expect(book.oldCardDebt()).toBe(bank.oldCard);
    // Every paycheck's parts add up to it exactly (3.3), and each one,
    // however it was found, started one pay period (3.1, 6.1).
    for (const p of book.paychecks()) expect(p.split.momReserve + p.split.savings + p.split.needs + p.split.wants).toBe(p.amount);
    expect(book.period().number).toBe(book.paychecks().length);
    // Taking the alerts every step, like a day each: the low and empty
    // alerts come at most once per bucket per pay period, and only when due.
    for (const alert of book.takeAlerts({ bankConnection: 'ok', bankBalances: bank })) {
      if (alert.kind !== 'low-bucket' && alert.kind !== 'empty-bucket') continue;
      const key = `${book.period().number} ${alert.bucket} ${alert.kind}`;
      expect(given.has(key), key).toBe(false);
      given.add(key);
      expect(alert.amount).toBe(book.pots()[alert.bucket]);
      if (alert.kind === 'empty-bucket') {
        expect(alert.amount).toBeLessThanOrEqual(0);
      } else {
        expect(alert.amount).toBeGreaterThan(0);
        expect(alert.startedWith).toBe(book.startedPeriodWith()[alert.bucket]);
        expect(BigInt(alert.amount) * 100n < BigInt(alert.startedWith) * BigInt(book.settings().lowBucketAlertPercent)).toBe(true);
      }
    }
    // The running totals always equal a recount from scratch.
    expect(book.recountPots()).toEqual(book.pots());
    expect(book.recountOldCardDebt()).toBe(book.oldCardDebt());
    for (const value of Object.values(book.pots())) expect(Number.isSafeInteger(value)).toBe(true);
  }
}

describe('random scenarios: the whole book', () => {
  it('no cent is created or lost, and nothing is counted twice, through any mix of bank activity and sorting', () => {
    fc.assert(
      fc.property(openingArb, leftoverChoiceArb, leftoverChoiceArb, splitArb, fc.array(stepArb, { maxLength: 60 }), (pots, needs, wants, split, steps) => {
        const book = openTestBook({ pots, rules: RULES, oldCardDebt: 300_000, settings: { split, leftoverAtPayday: { needs, wants } } });
        const bank = new TestBank({ checking: appSide(book.pots()), oldCard: 300_000 });
        runLife(book, bank, steps);
      }),
      { numRuns: runs(500) },
    );
  });
});

describe('random scenarios: low and empty buckets (10.1, 10.2)', () => {
  it('10.1 the low and empty alerts come once per bucket per pay period, only when due, through heavy spending', () => {
    const smallPotArb = fc.integer({ min: -50_000, max: 200_000 });
    fc.assert(
      fc.property(
        fc.record({ savings: potArb, needs: smallPotArb, wants: smallPotArb, momReserve: fc.integer({ min: 0, max: 400_000 }), heldForOthers: potArb }),
        leftoverChoiceArb,
        leftoverChoiceArb,
        fc.integer({ min: 0, max: 100 }),
        fc.array(spendingStepArb, { maxLength: 60 }),
        (pots, needs, wants, lowBucketAlertPercent, steps) => {
          const book = openTestBook({ pots, rules: RULES, oldCardDebt: 300_000, settings: { lowBucketAlertPercent, leftoverAtPayday: { needs, wants } } });
          const bank = new TestBank({ checking: appSide(book.pots()), oldCard: 300_000 });
          runLife(book, bank, steps);
        },
      ),
      { numRuns: runs(300) },
    );
  });
});

describe('random scenarios: money in (6.1)', () => {
  it('6.1 your paycheck, other income, payback, and not mine, in any order, never create or lose a cent', () => {
    fc.assert(
      fc.property(openingArb, leftoverChoiceArb, leftoverChoiceArb, splitArb, fc.array(moneyInStepArb, { maxLength: 60 }), (pots, needs, wants, split, steps) => {
        const book = openTestBook({ pots, rules: RULES, oldCardDebt: 300_000, settings: { split, leftoverAtPayday: { needs, wants } } });
        const bank = new TestBank({ checking: appSide(book.pots()), oldCard: 300_000 });
        runLife(book, bank, steps);
      }),
      { numRuns: runs(300) },
    );
  });
});

describe('random scenarios: setup day (section 14)', () => {
  const pendingArb = fc.array(
    fc.record({
      amount: fc.integer({ min: 1, max: 50_000 }),
      account: fc.constantFrom('checking' as const, 'savings' as const, 'everyday-card' as const, 'old-card' as const),
    }),
    { maxLength: 4 },
  );

  it('14.3 any setup that adds up starts with a passing self-check, and it keeps passing through a random life', () => {
    fc.assert(
      fc.property(
        fc.record({ checking: fc.integer({ min: 0, max: 5_000_000 }), savings: fc.integer({ min: 0, max: 5_000_000 }), everydayCard: fc.integer({ min: 0, max: 500_000 }) }),
        pendingArb,
        fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 4, maxLength: 4 }),
        fc.array(
          fc.record({
            amount: fc.integer({ min: 1, max: 50_000 }),
            from: fc.constantFrom('checking' as const, 'savings' as const),
            to: fc.constantFrom('savings' as const, 'everyday-card' as const, 'old-card' as const),
            landedFirst: fc.boolean(),
          }),
          { maxLength: 3 },
        ),
        fc.array(stepArb, { maxLength: 40 }),
        (posted, charges, parts, travelling, steps) => {
          const pendingCharges = charges.map((c, i) =>
            c.account === 'savings'
              ? withdrawal(`setup${i}`, '2026-09-30', c.amount, 'MADE UP BILL PAY', { pending: true })
              : purchase(`setup${i}`, '2026-09-30', c.amount, 'MADE UP CAFE', { account: c.account, pending: true }),
          );
          // Transfers with one half showing on setup day (12.5): left and not
          // landed, or landed before it shows leaving.
          const transfersInTransit = travelling
            .filter((t) => t.from !== t.to)
            .map((t, i) => (t.landedFirst ? arrived(`travel${i}`, '2026-09-30', t.amount, t.from, t.to) : sent(`travel${i}`, '2026-09-30', t.amount, t.from, t.to)));
          const money = startingMoney(posted, pendingCharges, transfersInTransit);
          // Any four amounts, with savings taking whatever makes it add up.
          const [needs = 0, wants = 0, momReserve = 0, heldForOthers = 0] = parts;
          const assignment = { savings: money - needs - wants - momReserve - heldForOthers, needs, wants, momReserve, heldForOthers };
          const result = startTracking({
            date: START_DATE,
            bankBalances: posted,
            pendingCharges,
            transfersInTransit,
            oldCardBalance: 300_000,
            assignment,
            lastPaycheckDate: '2026-09-25',
            settings: TEST_SETTINGS,
            rules: RULES,
          });
          if (!result.ok) throw new Error('setup that adds up must start');
          const bank = new TestBank({ ...posted, oldCard: 300_000 });
          for (const charge of pendingCharges) bank.apply(charge);
          // The bank balances already show the money gone; only the in-transit
          // count starts above zero.
          bank.inTransit = transfersInTransit
            .filter((t) => t.to !== 'old-card')
            .reduce((sum, t) => sum + (t.kind === 'transfer-sent' ? t.amount : -t.amount), 0);
          expect(result.book.selfCheck(bank)).toMatchObject({ ok: true });
          const halves = transfersInTransit.map((t) => ({
            id: t.id,
            first: t.kind === 'transfer-sent' ? ('left' as const) : ('arrived' as const),
            from: t.from,
            to: t.to,
            amount: t.amount,
          }));
          runLife(result.book, bank, steps, pendingCharges, halves);
        },
      ),
      { numRuns: runs(300) },
    );
  });
});

describe('random scenarios: the old card payoff countdown (9.5)', () => {
  it('9.5 the shares cover what is owed, one cent less each would not, and the paydays are the ones before the promo ends', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 1_000_000_000_000 }), fc.integer({ min: 0, max: 800 }), fc.integer({ min: 1, max: 31 }), (owed, daysToEnd, every) => {
        const today: IsoDate = '2026-10-06';
        // The last paycheck was today, so paydays fall every `every` days after it.
        const book = {
          settings: () => changeSettings(DEFAULT_SETTINGS, { oldCardPromoEndDate: addDays(today, daysToEnd), payScheduleDays: every }),
          oldCardDebt: () => owed,
          lastPaycheckDate: () => today,
        };
        const countdown = payoffCountdown(book, today);
        expect(countdown.on).toBe(true);
        if (!countdown.on) return;
        // Paydays strictly before the end date: every, 2 x every, ... < daysToEnd.
        const left = daysToEnd === 0 ? 0 : Math.floor((daysToEnd - 1) / every);
        expect(countdown.paydaysLeft).toBe(left);
        if (owed <= 0) {
          expect(countdown.perPayday).toBe(0);
        } else if (left === 0) {
          expect(countdown.perPayday).toBe(owed);
        } else {
          expect(BigInt(countdown.perPayday) * BigInt(left) >= BigInt(owed)).toBe(true);
          expect(BigInt(countdown.perPayday - 1) * BigInt(left) < BigInt(owed)).toBe(true);
        }
      }),
      { numRuns: runs(2_000) },
    );
  });
});

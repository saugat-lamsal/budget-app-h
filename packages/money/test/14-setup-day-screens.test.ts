import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bankSide,
  checkAssignment,
  inTransitEffect,
  nextPayday,
  startTracking,
  startingDebt,
  startingMoney,
  withPendingCharges,
  type BankBalances,
  type Purchase,
  type SetupInput,
  type StartingPots,
  type TransferArrived,
  type TransferSent,
} from '../src/index.js';
import { TEST_SETTINGS, arrived, codeOf, purchase, sent } from './helpers.js';
import { runs } from './slow.js';

// What the Setup day screens show, from the money math (rulebook section 14
// with 12.4, 12.5; QUESTIONS.md A10, B42, B43, B48). Every number is made up.

const ZERO: StartingPots = { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 };
const MAX = Number.MAX_SAFE_INTEGER;

describe('14.2 B48 what each transfer on its way does to the starting money', () => {
  it('14.2 B48 money that left checking and has not arrived is added: it is still his', () => {
    expect(inTransitEffect(sent('s1', '2026-10-05', 20_000, 'checking', 'everyday-card'))).toBe(20_000);
    expect(inTransitEffect(sent('s2', '2026-10-05', 1, 'savings', 'checking'))).toBe(1);
  });

  it('14.2 B48 money that arrived before it shows leaving is taken off: it is still counted where it left', () => {
    expect(inTransitEffect(arrived('a1', '2026-10-05', 50_000, 'checking', 'savings'))).toBe(-50_000);
    expect(inTransitEffect(arrived('a2', '2026-10-05', 1, 'savings', 'everyday-card'))).toBe(-1);
  });

  it('14.2 B48 12.4 a half going to the old card does not change the starting money, either way', () => {
    expect(inTransitEffect(sent('s3', '2026-10-05', 20_000, 'checking', 'old-card'))).toBe(0);
    expect(inTransitEffect(arrived('a3', '2026-10-05', 20_000, 'savings', 'old-card'))).toBe(0);
  });

  it('14.2 B48 a very large half is exact', () => {
    expect(inTransitEffect(sent('s4', '2026-10-05', MAX, 'checking', 'savings'))).toBe(MAX);
    expect(inTransitEffect(arrived('a4', '2026-10-05', MAX, 'checking', 'savings'))).toBe(-MAX);
  });

  it('14.2 B48 only a half of a transfer has an effect, and only a real one', () => {
    expect(codeOf(() => inTransitEffect(purchase('p', '2026-10-05', 100) as unknown as TransferSent))).toBe('bad-transaction');
    expect(codeOf(() => inTransitEffect({ ...sent('s5', '2026-10-05', 0, 'checking', 'savings') }))).toBe('not-positive');
  });

  it('14.2 B48 the starting money is the bank side plus what each half on its way does (random banks)', () => {
    const cents = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });
    const account = fc.constantFrom('checking' as const, 'savings' as const);
    const to = fc.constantFrom('checking' as const, 'savings' as const, 'everyday-card' as const, 'old-card' as const);
    const half = fc.record({ left: fc.boolean(), amount: fc.integer({ min: 1, max: 100_000_000 }), from: account, to });
    fc.assert(
      fc.property(cents, cents, cents, fc.array(half, { maxLength: 6 }), (checking, savings, everydayCard, raw) => {
        const halves = raw
          .filter((h) => h.from !== h.to)
          .map((h, i): TransferSent | TransferArrived =>
            h.left ? sent(`s${i}`, '2026-10-05', h.amount, h.from, h.to) : arrived(`a${i}`, '2026-10-05', h.amount, h.from, h.to),
          );
        const bank: BankBalances = { checking, savings, everydayCard };
        const expected = halves.reduce((sum, h) => sum + inTransitEffect(h), bankSide(bank));
        expect(startingMoney(bank, [], halves)).toBe(expected);
      }),
      { numRuns: runs(500) },
    );
  });
});

describe('12.4 A10 the old card debt tracking starts with', () => {
  const oldPending = (id: string, amount: number): Purchase => purchase(id, '2026-10-05', amount, 'MADE UP STORE', { account: 'old-card', pending: true });

  it('12.4 the old card owes its posted balance, plus its charges still pending (A10)', () => {
    expect(startingDebt(298_000, [])).toBe(298_000);
    expect(startingDebt(298_000, [oldPending('o1', 1_999)])).toBe(299_999);
  });

  it('12.4 pending charges on the other accounts are starting money, not old card debt', () => {
    const others = [purchase('c1', '2026-10-05', 500, 'X', { account: 'checking', pending: true }), purchase('e1', '2026-10-05', 700, 'X', { pending: true })];
    expect(startingDebt(298_000, [...others, oldPending('o2', 1)])).toBe(298_001);
  });

  it('12.4 zero, one cent, a credit, and a very large balance', () => {
    expect(startingDebt(0, [])).toBe(0);
    expect(startingDebt(1, [])).toBe(1);
    expect(startingDebt(-2_500, [])).toBe(-2_500);
    expect(startingDebt(-2_500, [oldPending('o3', 2_500)])).toBe(0);
    expect(startingDebt(MAX - 1, [oldPending('o4', 1)])).toBe(MAX);
    expect(codeOf(() => startingDebt(MAX, [oldPending('o5', 1)]))).toBe('not-cents');
  });

  it('12.4 it is the debt the book starts with', () => {
    const pending = [oldPending('o6', 1_000), purchase('c2', '2026-10-05', 4_500, 'MADE UP CAFE', { pending: true })];
    const input: SetupInput = {
      date: '2026-10-06',
      bankBalances: { checking: 250_000, savings: 400_000, everydayCard: 30_000 },
      pendingCharges: pending,
      oldCardBalance: 290_000,
      assignment: { ...ZERO, needs: startingMoney({ checking: 250_000, savings: 400_000, everydayCard: 30_000 }, pending) },
      lastPaycheckDate: '2026-09-25',
      settings: TEST_SETTINGS,
    };
    const result = startTracking(input);
    expect(result.ok && result.book.oldCardDebt()).toBe(startingDebt(290_000, pending));
  });
});

describe('14.2 14.3 what is assigned, and what is left to assign', () => {
  it('14.2 nothing assigned yet: all of the starting money is left', () => {
    expect(checkAssignment(615_500, ZERO)).toEqual({ assigned: 0, leftToAssign: 615_500 });
  });

  it('14.3 exactly assigned: nothing left', () => {
    expect(checkAssignment(615_500, { savings: 400_000, needs: 100_000, wants: 50_000, momReserve: 60_000, heldForOthers: 5_500 })).toEqual({ assigned: 615_500, leftToAssign: 0 });
  });

  it('14.3 one cent under: one cent left; one cent over: minus one cent left', () => {
    expect(checkAssignment(615_500, { ...ZERO, needs: 615_499 })).toEqual({ assigned: 615_499, leftToAssign: 1 });
    expect(checkAssignment(615_500, { ...ZERO, needs: 615_501 })).toEqual({ assigned: 615_501, leftToAssign: -1 });
  });

  it('14.2 B43 a starting money of zero, of one cent, and below zero', () => {
    expect(checkAssignment(0, ZERO)).toEqual({ assigned: 0, leftToAssign: 0 });
    expect(checkAssignment(1, ZERO)).toEqual({ assigned: 0, leftToAssign: 1 });
    expect(checkAssignment(-175_647, ZERO)).toEqual({ assigned: 0, leftToAssign: -175_647 });
    expect(checkAssignment(-175_647, { ...ZERO, needs: -175_647 })).toEqual({ assigned: -175_647, leftToAssign: 0 });
    // Savings kept, the card's debt carried in needs and wants.
    expect(checkAssignment(-175_647, { ...ZERO, savings: 15_000, needs: -150_000, wants: -40_647 })).toEqual({ assigned: -175_647, leftToAssign: 0 });
  });

  it('14.2 very large amounts are exact, and a total too large to keep exact is refused', () => {
    expect(checkAssignment(MAX, { ...ZERO, savings: MAX - 1 })).toEqual({ assigned: MAX - 1, leftToAssign: 1 });
    expect(checkAssignment(-MAX, { ...ZERO, needs: -MAX })).toEqual({ assigned: -MAX, leftToAssign: 0 });
    expect(codeOf(() => checkAssignment(0, { ...ZERO, savings: MAX, needs: 1 }))).toBe('not-cents');
    expect(codeOf(() => checkAssignment(-1, { ...ZERO, savings: MAX }))).toBe('not-cents');
  });

  it('14.2 every amount must be whole cents', () => {
    expect(codeOf(() => checkAssignment(100, { ...ZERO, wants: 0.5 }))).toBe('not-cents');
    expect(codeOf(() => checkAssignment(0.5, ZERO))).toBe('not-cents');
  });

  it('14.3 what is left to assign is exactly what keeps tracking from starting (random banks, random assignments)', () => {
    const cents = fc.integer({ min: -10_000_000_000, max: 10_000_000_000 });
    const pot = fc.integer({ min: -5_000_000_000, max: 5_000_000_000 });
    const pots = fc.record({ savings: pot, needs: pot, wants: pot, momReserve: pot, heldForOthers: pot });
    const pending = fc.array(
      fc.record({ account: fc.constantFrom('checking' as const, 'savings' as const, 'everyday-card' as const, 'old-card' as const), amount: fc.integer({ min: 1, max: 10_000_000 }) }),
      { maxLength: 5 },
    );
    // Some assignments are made exact on purpose, so both sides are tried often.
    fc.assert(
      fc.property(cents, cents, cents, pending, pots, fc.integer({ min: -2, max: 2 }), fc.boolean(), (checking, savings, everydayCard, raw, picked, nudge, exact) => {
        const charges = raw.map((c, i): Purchase => purchase(`p${i}`, '2026-10-05', c.amount, 'MADE UP STORE', { account: c.account === 'savings' ? 'checking' : c.account, pending: true }));
        const bank = { checking, savings, everydayCard };
        const money = startingMoney(bank, charges);
        const rest = money - picked.savings - picked.momReserve - picked.heldForOthers - picked.wants;
        const assignment = exact ? { ...picked, needs: rest + nudge } : picked;
        const { assigned, leftToAssign } = checkAssignment(money, assignment);
        const result = startTracking({ date: '2026-10-06', bankBalances: bank, pendingCharges: charges, oldCardBalance: 100_000, assignment, lastPaycheckDate: '2026-09-25', settings: TEST_SETTINGS });
        expect(result.ok).toBe(leftToAssign === 0);
        if (!result.ok) {
          expect(result).toEqual({ ok: false, startingMoney: money, assigned, difference: leftToAssign });
          return;
        }
        // After setup: the buckets are what he assigned, and the self-check passes.
        expect(result.book.pots()).toEqual({ ...assignment, unsortedIn: 0, unsortedOut: 0 });
        expect(result.book.selfCheck(withPendingCharges(bank, charges))).toMatchObject({ ok: true, difference: 0 });
      }),
      { numRuns: runs(1_000) },
    );
  });
});

describe('B42 the last paycheck, which the pay schedule counts from', () => {
  const input = (lastPaycheckDate: string): SetupInput => ({
    date: '2026-10-07',
    bankBalances: { checking: 100_000, savings: 0, everydayCard: 0 },
    pendingCharges: [],
    oldCardBalance: 0,
    assignment: { ...ZERO, needs: 100_000 },
    lastPaycheckDate,
    settings: TEST_SETTINGS,
  });

  it('B42 a last paycheck on setup day itself, or before it, starts tracking', () => {
    expect(startTracking(input('2026-10-07')).ok).toBe(true);
    expect(startTracking(input('2026-10-06')).ok).toBe(true);
    expect(startTracking(input('2025-10-07')).ok).toBe(true);
  });

  it('B42 a last paycheck after setup day is refused: it has not come yet', () => {
    expect(codeOf(() => startTracking(input('2026-10-08')))).toBe('bad-date');
    expect(codeOf(() => startTracking(input('2027-01-01')))).toBe('bad-date');
  });

  it('B42 a date that is not a real date is refused', () => {
    expect(codeOf(() => startTracking(input('2026-02-30')))).toBe('not-a-date');
  });
});

describe('11.2 B42 the next payday from the last paycheck', () => {
  it('11.2 the last paycheck plus the pay schedule, and the days to it from today', () => {
    expect(nextPayday('2026-10-02', 14, '2026-10-07')).toEqual({ nextPayday: '2026-10-16', daysToPayday: 9 });
  });

  it('11.2 payday is today: zero days', () => {
    expect(nextPayday('2026-10-02', 14, '2026-10-16')).toEqual({ nextPayday: '2026-10-16', daysToPayday: 0 });
  });

  it('11.2 B35 a payday that has passed with no paycheck is negative, not the one after', () => {
    expect(nextPayday('2026-09-18', 14, '2026-10-07')).toEqual({ nextPayday: '2026-10-02', daysToPayday: -5 });
  });

  it('11.2 it is what the book uses for safe to spend', () => {
    const result = startTracking({
      date: '2026-10-07',
      bankBalances: { checking: 1, savings: 0, everydayCard: 0 },
      pendingCharges: [],
      oldCardBalance: 0,
      assignment: { ...ZERO, wants: 1 },
      lastPaycheckDate: '2026-09-30',
      settings: { ...TEST_SETTINGS, payScheduleDays: 7 },
    });
    if (!result.ok) throw new Error('did not start');
    expect(result.book.safeToSpend('2026-10-07')).toEqual({ amount: 1, ...nextPayday('2026-09-30', 7, '2026-10-07') });
  });

  it('11.2 the pay schedule and the dates must be real', () => {
    expect(codeOf(() => nextPayday('2026-09-30', 1.5, '2026-10-07'))).toBe('not-a-date');
    expect(codeOf(() => nextPayday('2026-13-01', 14, '2026-10-07'))).toBe('not-a-date');
  });
});

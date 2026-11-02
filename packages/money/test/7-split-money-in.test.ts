import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Book } from '../src/index.js';
import { TestBank, appSide, codeOf, deposit, openTestBook, paycheck, takenBack, withdrawal } from './helpers.js';

// Rule 7.8 (QUESTIONS.md A63): money in can be split across Other, savings,
// needs, and wants, such as cash that was part a friend's and part what the
// friend owed. Every number here is made up.

const DAY = '2026-10-05';

function book(): Book {
  return openTestBook({ pots: { needs: 100_000, wants: 50_000, savings: 200_000 } });
}

function splitOf(b: Book, id: string): readonly string[] | null {
  const d = b.reviewDetails().find((x) => x.item.id === id);
  if (d?.options.type !== 'sort') throw new Error(`${id} has no choices`);
  return d.options.split;
}

describe('7.8 money in can be split', () => {
  it('7.8 each part counts where it says, and Wants gets the rest on the screen', () => {
    const b = book();
    b.receive(deposit('d1', DAY, 14_000, 'MADE UP ATM DEPOSIT'));
    expect(splitOf(b, 'd1')).toEqual(['not-mine', 'savings', 'needs', 'wants']);
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 12_500 }, { bucket: 'wants', amount: 1_500 }] }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 12_500, wants: 51_500, needs: 100_000, savings: 200_000, unsortedIn: 0 });
    expect(b.reviewItems()).toEqual([]);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.8 across all four parts, to the cent, and the check with the bank holds', () => {
    const b = book();
    const bank = new TestBank({ checking: appSide(b.pots()) });
    const cash = deposit('d1', DAY, 10_000, 'MADE UP ATM DEPOSIT');
    b.receive(cash);
    bank.apply(cash);
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 1 }, { bucket: 'savings', amount: 2_999 }, { bucket: 'needs', amount: 3_000 }, { bucket: 'wants', amount: 4_000 }] }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 1, savings: 202_999, needs: 103_000, wants: 54_000 });
    expect(b.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard }).ok).toBe(true);
  });

  it('7.8 the parts must add up, a cent short or over is refused, and a refusal changes nothing', () => {
    const b = book();
    b.receive(deposit('d1', DAY, 10_000));
    const before = b.pots();
    expect(codeOf(() => b.sort('d1', { split: [{ bucket: 'not-mine', amount: 5_000 }, { bucket: 'wants', amount: 4_999 }] }, DAY))).toBe('split-does-not-add-up');
    expect(codeOf(() => b.sort('d1', { split: [{ bucket: 'not-mine', amount: 5_000 }, { bucket: 'wants', amount: 5_001 }] }, DAY))).toBe('split-does-not-add-up');
    expect(codeOf(() => b.sort('d1', { split: [{ bucket: 'not-mine', amount: 0 }, { bucket: 'wants', amount: 10_000 }] }, DAY))).not.toBeNull();
    expect(codeOf(() => b.sort('d1', { split: [{ bucket: 'not-mine', amount: -1 }, { bucket: 'wants', amount: 10_001 }] }, DAY))).not.toBeNull();
    expect(b.pots()).toEqual(before);
    expect(b.reviewItems()).toHaveLength(1);
  });

  it('7.8 only those four: not the mom reserve, not income, and not a bucket twice', () => {
    const b = book();
    b.receive(deposit('d1', DAY, 10_000));
    const before = b.pots();
    expect(codeOf(() => b.sort('d1', { split: [{ bucket: 'momReserve' as never, amount: 5_000 }, { bucket: 'wants', amount: 5_000 }] }, DAY))).toBe('bad-choice');
    expect(codeOf(() => b.sort('d1', { split: [{ bucket: 'other-income' as never, amount: 5_000 }, { bucket: 'wants', amount: 5_000 }] }, DAY))).toBe('bad-choice');
    expect(codeOf(() => b.sort('d1', { split: 'nothing' as never }, DAY))).toBe('bad-choice');
    expect(b.pots()).toEqual(before);
  });

  it('7.8 one part is not a split, and a bucket named twice gets both parts', () => {
    const b = book();
    b.receive(deposit('d1', DAY, 10_000));
    expect(codeOf(() => b.sort('d1', { split: [{ bucket: 'needs', amount: 10_000 }] }, DAY))).toBe('bad-choice');
    expect(b.reviewItems()).toHaveLength(1);
    b.sort('d1', { split: [{ bucket: 'wants', amount: 1 }, { bucket: 'wants', amount: 9_999 }] }, DAY);
    expect(b.pots().wants).toBe(60_000);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.8 one cent has nothing to split', () => {
    const b = book();
    b.receive(deposit('d1', DAY, 1));
    expect(splitOf(b, 'd1')).toBeNull();
    b.receive(deposit('d2', DAY, 2));
    expect(splitOf(b, 'd2')).toEqual(['not-mine', 'savings', 'needs', 'wants']);
    b.sort('d2', { split: [{ bucket: 'not-mine', amount: 1 }, { bucket: 'wants', amount: 1 }] }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 1, wants: 50_001 });
  });

  it('7.8 7.3 it can cancel what already went out', () => {
    const b = book();
    b.receive(withdrawal('w1', DAY, 12_500, 'MADE UP ZELLE'));
    b.sort('w1', { to: 'not-mine' }, DAY);
    expect(b.pots().heldForOthers).toBe(-12_500);
    b.receive(deposit('d1', '2026-10-06', 14_000, 'MADE UP ATM DEPOSIT'));
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 12_500 }, { bucket: 'wants', amount: 1_500 }] }, '2026-10-06');
    expect(b.pots()).toMatchObject({ heldForOthers: 0, wants: 51_500, needs: 100_000, savings: 200_000 });
  });

  it('7.8 4.7 sorted again later, the whole split is replaced, in either direction', () => {
    const b = book();
    b.receive(deposit('d1', DAY, 10_000));
    b.sort('d1', { to: 'other-income' }, DAY);
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 6_000 }, { bucket: 'needs', amount: 4_000 }] }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 6_000, needs: 104_000, wants: 50_000, savings: 200_000 });
    expect(b.resortDetail('d1')).toMatchObject({ resortable: true, now: { split: [{ bucket: 'not-mine', amount: 6_000 }, { bucket: 'needs', amount: 4_000 }] } });
    b.sort('d1', { split: [{ bucket: 'savings', amount: 1 }, { bucket: 'wants', amount: 9_999 }] }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 0, needs: 100_000, savings: 200_001, wants: 59_999 });
    b.sort('d1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 10_000, needs: 100_000, savings: 200_000, wants: 50_000 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.8 B97 each bucket lists its own part, and says it was part of a split', () => {
    const b = book();
    b.receive(deposit('d1', DAY, 14_000));
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 12_500 }, { bucket: 'wants', amount: 1_500 }] }, DAY);
    expect(b.activity('heldForOthers').rows.find((r) => r.id === 'd1')).toMatchObject({ what: 'not-mine', amount: 12_500, partOfSplit: true });
    expect(b.activity('wants').rows.find((r) => r.id === 'd1')).toMatchObject({ what: 'payback', amount: 1_500, partOfSplit: true });
  });

  it('7.8 6.1 made a paycheck afterwards, the split is taken back first', () => {
    const b = openTestBook({ pots: { needs: 100_000, wants: 50_000 }, lastPaycheckDate: '2026-09-01' });
    b.receive(deposit('d1', DAY, 10_000));
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 6_000 }, { bucket: 'needs', amount: 4_000 }] }, DAY);
    b.sort('d1', { to: 'paycheck' }, DAY);
    expect(b.pots().heldForOthers).toBe(0);
    expect(b.paychecks()).toHaveLength(1);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.8 4.10 the bank taking it back undoes every part', () => {
    const b = book();
    b.receive(deposit('d1', DAY, 10_000));
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 6_000 }, { bucket: 'needs', amount: 4_000 }] }, DAY);
    b.receive(takenBack('t1', 'd1', '2026-10-06'));
    expect(b.pots()).toMatchObject({ heldForOthers: 0, needs: 100_000, unsortedIn: 0 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.8 13.6 13.8 a rule cannot make a split, and a split offers no rule', () => {
    const b = book();
    b.receive(deposit('d1', DAY, 10_000, 'MADE UP FRIEND'));
    expect(codeOf(() => b.sortAlways('d1', { split: [{ bucket: 'not-mine', amount: 6_000 }, { bucket: 'needs', amount: 4_000 }] }, { id: 'r', contains: 'FRIEND' }, DAY))).toBe('bad-choice');
    b.receive(deposit('d2', DAY, 10_000, 'MADE UP FRIEND'));
    for (const [i, name] of ['ACME PAYROLL', 'BANK INTEREST', 'STORE REBATE'].entries()) b.receive(deposit(`x${i}`, DAY, 100, name));
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 6_000 }, { bucket: 'needs', amount: 4_000 }] }, DAY);
    b.sort('d2', { split: [{ bucket: 'not-mine', amount: 6_000 }, { bucket: 'needs', amount: 4_000 }] }, DAY);
    expect(b.ruleOffer('d2')).toBeNull();
    // The same two sorted one way do offer it, so it is the split that stops it.
    b.sort('d1', { to: 'wants' }, DAY);
    b.sort('d2', { to: 'wants' }, DAY);
    expect(b.ruleOffer('d2')).toMatchObject({ for: 'deposit', to: 'wants' });
  });

  it('7.8 3.1 a paycheck the rule counted cannot be split', () => {
    const b = book();
    b.receive(paycheck('pay', '2026-10-02', 200_000));
    expect(codeOf(() => b.sort('pay', { split: [{ bucket: 'not-mine', amount: 1 }, { bucket: 'wants', amount: 199_999 }] }, DAY))).not.toBeNull();
  });

  it('7.8 very large amounts stay exact', () => {
    const b = book();
    const big = Number.MAX_SAFE_INTEGER - 2_000_000;
    b.receive(deposit('d1', DAY, big));
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: big - 1 }, { bucket: 'wants', amount: 1 }] }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: big - 1, wants: 50_001 });
  });

  it('7.8 random splits: every cent lands in one part, no cent is made or lost, and the check holds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 100_000_000 }), fc.integer({ min: 1, max: 100_000_000 }), fc.integer({ min: 1, max: 100_000_000 }), (amount, x, y) => {
        const b = book();
        const bank = new TestBank({ checking: appSide(b.pots()) });
        const cash = deposit('d1', DAY, amount);
        b.receive(cash);
        bank.apply(cash);
        const other = 1 + (x % (amount - 2));
        const needs = 1 + (y % (amount - other - 1));
        const wants = amount - other - needs;
        b.sort('d1', { split: [{ bucket: 'not-mine', amount: other }, { bucket: 'needs', amount: needs }, { bucket: 'wants', amount: wants }] }, DAY);
        expect(b.pots()).toMatchObject({ heldForOthers: other, needs: 100_000 + needs, wants: 50_000 + wants, savings: 200_000, unsortedIn: 0 });
        expect(b.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard }).ok).toBe(true);
        expect(b.recountPots()).toEqual(b.pots());
      }),
    );
  });
});

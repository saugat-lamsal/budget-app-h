import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Book } from '../src/index.js';
import { TestBank, appSide, cardCharge, codeOf, deposit, openTestBook, posted, purchase, refund, takenBack, withdrawal } from './helpers.js';

// Rule 7.7 (QUESTIONS.md A60): money leaving checking or savings that the app
// read as a purchase or a withdrawal can be marked "not mine": a friend's cash
// he deposited and sent on. It lowers held for others and is not spending.

const DAY = '2026-10-05';

function book(): Book {
  return openTestBook({ pots: { needs: 100_000, wants: 50_000 } });
}

function picks(b: Book, id: string): readonly string[] {
  const d = b.reviewDetails().find((x) => x.item.id === id);
  if (d?.options.type !== 'sort') throw new Error(`${id} has no choices`);
  return d.options.picks.map((p) => p.to);
}

function splitOf(b: Book, id: string): readonly string[] | null {
  const d = b.reviewDetails().find((x) => x.item.id === id);
  if (d?.options.type !== 'sort') throw new Error(`${id} has no choices`);
  return d.options.split;
}

describe('7.7 money leaving an account can be marked not mine', () => {
  it('7.7 money leaving savings is offered not mine, and it lowers held for others, not a bucket', () => {
    const b = book();
    b.receive(withdrawal('w1', DAY, 72_300, 'MADE UP ZELLE PAYMENT'));
    expect(picks(b, 'w1')).toEqual(['needs', 'wants', 'not-mine']);
    expect(splitOf(b, 'w1')).toEqual(['needs', 'not-mine', 'wants']);
    b.sort('w1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, heldForOthers: -72_300, unsortedOut: 0 });
    expect(b.reviewItems()).toEqual([]);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.7 money leaving checking read as a purchase is offered it too', () => {
    const b = book();
    b.receive(purchase('p1', DAY, 8_640, 'MADE UP PAYMENT', { account: 'checking' }));
    expect(picks(b, 'p1')).toEqual(['needs', 'wants', 'not-mine']);
    expect(splitOf(b, 'p1')).toEqual(['needs', 'not-mine', 'wants']);
    b.sort('p1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, heldForOthers: -8_640, unsortedOut: 0 });
  });

  it('7.7 a purchase on the everyday card is offered it too: Other goes down, and the check with the bank holds', () => {
    const b = book();
    const bank = new TestBank({ checking: appSide(b.pots()) });
    const bought = purchase('c1', DAY, 2_000, 'MADE UP SHOP', { account: 'everyday-card' });
    b.receive(bought);
    bank.apply(bought);
    expect(picks(b, 'c1')).toEqual(['needs', 'wants', 'not-mine']);
    expect(splitOf(b, 'c1')).toEqual(['needs', 'not-mine', 'wants']);
    b.sort('c1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, heldForOthers: -2_000, unsortedOut: 0 });
    expect(b.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard }).ok).toBe(true);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.7 7.1 bought for a friend on the card, the friend pays back: it cancels, and safe to spend never moved', () => {
    const b = book();
    const safe = b.safeToSpend(DAY).amount;
    b.receive(purchase('c1', DAY, 2_000, 'MADE UP SHOP', { account: 'everyday-card' }));
    b.sort('c1', { to: 'not-mine' }, DAY);
    b.receive(deposit('d1', '2026-10-06', 2_000, 'MADE UP FRIEND'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-06');
    expect(b.pots().heldForOthers).toBe(0);
    expect(b.safeToSpend('2026-10-06').amount).toBe(safe);
  });

  it('7.7 4.5 on the card, a refund goes back to Other too', () => {
    const b = book();
    b.receive(purchase('c1', DAY, 2_000, 'MADE UP SHOP', { account: 'everyday-card' }));
    b.sort('c1', { to: 'not-mine' }, DAY);
    b.receive(refund('r1', '2026-10-06', 500, 'c1'));
    expect(b.pots()).toMatchObject({ heldForOthers: -1_500, needs: 100_000, wants: 50_000 });
  });

  it('7.7 5.4 a purchase on the old card is not offered it, and the book refuses it, changing nothing', () => {
    const b = book();
    const debt = b.oldCardDebt();
    b.receive(purchase('o1', DAY, 2_000, 'MADE UP SHOP', { account: 'old-card' }));
    const before = b.pots();
    expect(codeOf(() => b.sort('o1', { to: 'not-mine' }, DAY))).not.toBeNull();
    expect(b.pots()).toEqual(before);
    expect(b.oldCardDebt()).toBe(debt + 2_000);
  });

  it('7.7 a card fee is not offered it, and the book refuses it, changing nothing', () => {
    const b = book();
    b.receive(cardCharge('f1', DAY, 2_900, 'fee'));
    expect(picks(b, 'f1')).toEqual(['needs', 'wants']);
    const before = b.pots();
    expect(codeOf(() => b.sort('f1', { to: 'not-mine' }, DAY))).toBe('bad-choice');
    expect(codeOf(() => b.sort('f1', { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'not-mine', amount: 2_899 }] }, DAY))).toBe('bad-choice');
    expect(b.pots()).toEqual(before);
  });

  it("7.7 7.1 a friend's cash, deposited and sent on: the two cancel out, no bucket changes, and the check with the bank holds", () => {
    const b = book();
    const bank = new TestBank({ checking: appSide(b.pots()) });
    const check = () => b.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard });
    const cash = deposit('d1', '2026-10-04', 64_250, 'MADE UP ATM DEPOSIT');
    b.receive(cash);
    bank.apply(cash);
    b.sort('d1', { to: 'not-mine' }, '2026-10-04');
    expect(b.pots().heldForOthers).toBe(64_250);
    expect(check().ok).toBe(true);
    const sent = withdrawal('w1', DAY, 64_250, 'MADE UP ZELLE PAYMENT');
    b.receive(sent);
    bank.apply(sent);
    expect(check().ok).toBe(true);
    b.sort('w1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, heldForOthers: 0, unsortedOut: 0, unsortedIn: 0 });
    expect(check().ok).toBe(true);
    expect(b.othersMoney().meaning).toBe('settled');
  });

  it('7.3 7.7 with the deposit not marked, it says someone owes you', () => {
    const b = book();
    b.receive(withdrawal('w1', DAY, 1, 'MADE UP ZELLE PAYMENT'));
    b.sort('w1', { to: 'not-mine' }, DAY);
    expect(b.othersMoney()).toMatchObject({ heldForOthers: -1, meaning: 'owed-to-you' });
  });

  it('7.7 is not spending: safe to spend and what was spent do not change', () => {
    const b = book();
    const safe = b.safeToSpend(DAY).amount;
    b.receive(withdrawal('w1', DAY, 5_000, 'MADE UP ZELLE PAYMENT'));
    expect(b.safeToSpend(DAY).amount).toBe(safe - 5_000);
    b.sort('w1', { to: 'not-mine' }, DAY);
    expect(b.safeToSpend(DAY).amount).toBe(safe);
    expect(b.spentIn()).toEqual([]);
  });

  it('7.7 split across needs, wants and not mine; the parts must add up, to the cent', () => {
    const b = book();
    b.receive(withdrawal('w1', DAY, 10_000, 'MADE UP ZELLE PAYMENT'));
    const short = [{ bucket: 'needs', amount: 1_000 }, { bucket: 'not-mine', amount: 8_999 }] as const;
    expect(codeOf(() => b.sort('w1', { split: short }, DAY))).toBe('split-does-not-add-up');
    expect(b.pots().unsortedOut).toBe(10_000);
    b.sort('w1', { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 2_000 }, { bucket: 'not-mine', amount: 7_000 }] }, DAY);
    expect(b.pots()).toMatchObject({ needs: 99_000, wants: 48_000, heldForOthers: -7_000, unsortedOut: 0 });
  });

  it('7.7 4.7 sorted again later, the money moves back, in both directions', () => {
    const b = book();
    b.receive(withdrawal('w1', DAY, 5_000, 'MADE UP ZELLE PAYMENT'));
    b.sort('w1', { to: 'needs' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 95_000, heldForOthers: 0 });
    b.sort('w1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 100_000, heldForOthers: -5_000 });
    b.sort('w1', { to: 'wants' }, DAY);
    expect(b.pots()).toMatchObject({ wants: 45_000, heldForOthers: 0 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.7 a sorting rule cannot pick it, and sorting it by hand offers no rule (13.6, 13.8)', () => {
    const b = book();
    b.receive(purchase('p1', DAY, 5_000, 'MADE UP PAYMENT', { account: 'checking' }));
    expect(codeOf(() => b.sortAlways('p1', { to: 'not-mine' }, { id: 'r', contains: 'MADE UP PAYMENT' }, DAY))).toBe('bad-choice');
    expect(b.pots().unsortedOut).toBe(5_000);
    b.receive(purchase('p2', DAY, 6_000, 'MADE UP PAYMENT', { account: 'checking' }));
    b.sort('p1', { to: 'not-mine' }, DAY);
    b.sort('p2', { to: 'not-mine' }, DAY);
    expect(b.ruleOffer('p2')).toBeNull();
  });

  it('7.7 4.6 marked while pending, its posting keeps it there, at the new amount', () => {
    const b = book();
    b.receive(purchase('p1', DAY, 5_000, 'MADE UP PAYMENT', { account: 'checking', pending: true }));
    b.sort('p1', { to: 'not-mine' }, DAY);
    expect(b.pots().heldForOthers).toBe(-5_000);
    b.receive(posted('p2', 'p1', '2026-10-06', 5_200, 'MADE UP PAYMENT', 'checking'));
    expect(b.pots()).toMatchObject({ heldForOthers: -5_200, unsortedOut: 0 });
  });

  it('7.7 4.5 a refund goes back to held for others, where it came from', () => {
    const b = book();
    b.receive(purchase('p1', DAY, 5_000, 'MADE UP PAYMENT', { account: 'checking' }));
    b.sort('p1', { to: 'not-mine' }, DAY);
    b.receive(refund('r1', '2026-10-06', 2_000, 'p1', 'checking'));
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, heldForOthers: -3_000 });
  });

  it('7.7 4.10 the bank taking it back undoes it', () => {
    const b = book();
    b.receive(withdrawal('w1', DAY, 5_000, 'MADE UP ZELLE PAYMENT'));
    b.sort('w1', { to: 'not-mine' }, DAY);
    b.receive(takenBack('t1', 'w1', '2026-10-06'));
    expect(b.pots()).toMatchObject({ heldForOthers: 0, unsortedOut: 0 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.7 5.6 one marked a transfer can be marked not mine instead: it is what the bank sent again, and the old card owes what it did', () => {
    const b = book();
    const debt = b.oldCardDebt();
    b.receive(purchase('p1', DAY, 6_000, 'MADE UP PAYMENT', { account: 'checking' }));
    b.sort('p1', { transfer: 'old-card' }, DAY);
    expect(b.pots().needs).toBe(94_000);
    b.sort('p1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 100_000, heldForOthers: -6_000, unsortedOut: 0 });
    expect(b.oldCardDebt()).toBe(debt);
    expect(b.inTransit().items).toEqual([]);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.7 14.2 4.10 not the difference on one counted on setup day, or the money back on one the bank took back', () => {
    const atSetup = openTestBook({ pots: { needs: 100_000 }, countedAtSetup: [purchase('s1', '2026-09-30', 1_000, 'MADE UP HOLD', { account: 'checking', pending: true })] });
    atSetup.receive(posted('s2', 's1', DAY, 1_250, 'MADE UP GAS', 'checking'));
    expect(picks(atSetup, 's1')).toEqual(['needs', 'wants']);
    expect(codeOf(() => atSetup.sort('s1', { to: 'not-mine' }, DAY))).toBe('bad-choice');

    const back = book();
    back.receive(purchase('p1', DAY, 10_000, 'MADE UP SHOP', { account: 'checking' }));
    back.receive(refund('r1', DAY, 4_000, 'p1', 'checking'));
    back.receive(takenBack('t1', 'p1', '2026-10-06'));
    expect(picks(back, 'p1')).toEqual(['needs', 'wants']);
    expect(codeOf(() => back.sort('p1', { to: 'not-mine' }, DAY))).toBe('bad-choice');
  });

  it('7.7 very large amounts stay exact', () => {
    const b = book();
    const big = Number.MAX_SAFE_INTEGER - 1_000_000;
    b.receive(withdrawal('w1', DAY, big, 'MADE UP ZELLE PAYMENT'));
    b.sort('w1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: -big, needs: 100_000, wants: 50_000, unsortedOut: 0 });
  });

  it('7.7 random amounts, either account: needs and wants never move, no cent is made or lost, and the check holds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000_000 }), fc.boolean(), fc.boolean(), (amount, fromSavings, cashFirst) => {
        const b = book();
        const bank = new TestBank({ checking: appSide(b.pots()) });
        if (cashFirst) {
          const cash = deposit('d1', DAY, amount, 'MADE UP ATM DEPOSIT');
          b.receive(cash);
          bank.apply(cash);
          b.sort('d1', { to: 'not-mine' }, DAY);
        }
        const out = fromSavings ? withdrawal('w1', DAY, amount, 'MADE UP ZELLE') : purchase('w1', DAY, amount, 'MADE UP ZELLE', { account: 'checking' });
        b.receive(out);
        bank.apply(out);
        b.sort('w1', { to: 'not-mine' }, DAY);
        expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, heldForOthers: cashFirst ? 0 : -amount, unsortedOut: 0 });
        expect(b.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard }).ok).toBe(true);
        expect(b.recountPots()).toEqual(b.pots());
      }),
    );
  });
});

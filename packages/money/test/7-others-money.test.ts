import { describe, expect, it } from 'vitest';
import type { SortingRule } from '../src/index.js';
import { codeOf, deposit, openTestBook, payPerson, purchase, refund, type TestBookOptions } from './helpers.js';

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 40_000, heldForOthers: 0 }, ...options });
}

const START = { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 40_000, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0 };

describe('7.1 a deposit marked "not mine" adds to held for others', () => {
  it('7.1 it is not income and is not split', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 6_000, 'MADE UP ROOMMATE'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-05');
    expect(b.pots()).toEqual({ ...START, heldForOthers: 6_000 });
  });

  it('7.1 one cent and very large amounts', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 1, 'MADE UP ROOMMATE'));
    b.receive(deposit('d2', '2026-10-05', 5_000_000_000_000_000, 'MADE UP ROOMMATE'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-05');
    b.sort('d2', { to: 'not-mine' }, '2026-10-05');
    expect(b.pots().heldForOthers).toBe(5_000_000_000_000_001);
  });
});

describe('7.2 a payment out marked "not mine" lowers held for others', () => {
  it('7.2 it is not spending: no bucket changes', () => {
    const b = book({ pots: { heldForOthers: 6_000 } });
    b.receive(payPerson('z1', '2026-10-06', 6_000, 'MADE UP LANDLORD'));
    b.sort('z1', { to: 'not-mine' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 });
  });

  it('7.2 changing a payment from wants to not mine gives wants its money back', () => {
    const b = book({ pots: { wants: 30_000, heldForOthers: 6_000 } });
    b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP LANDLORD'));
    b.sort('z1', { to: 'wants' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ wants: 27_500, heldForOthers: 6_000 });
    b.sort('z1', { to: 'not-mine' }, '2026-10-07');
    expect(b.pots()).toMatchObject({ wants: 30_000, heldForOthers: 3_500 });
  });
});

describe('7.3 held for others is its own number, should return to zero; negative means someone owes you', () => {
  it('7.3 zero means settled', () => {
    expect(book().othersMoney()).toEqual({ heldForOthers: 0, meaning: 'settled' });
  });

  it('7.3 money in and the same money out brings it back to zero', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 6_000, 'MADE UP ROOMMATE'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-05');
    expect(b.othersMoney()).toEqual({ heldForOthers: 6_000, meaning: 'holding-for-others' });
    b.receive(payPerson('z1', '2026-10-06', 6_000, 'MADE UP UTILITY CO'));
    b.sort('z1', { to: 'not-mine' }, '2026-10-06');
    expect(b.othersMoney()).toEqual({ heldForOthers: 0, meaning: 'settled' });
  });

  it('7.3 paying for someone before they pay you makes it negative: they owe you', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 1, 'MADE UP UTILITY CO'));
    b.sort('z1', { to: 'not-mine' }, '2026-10-06');
    expect(b.othersMoney()).toEqual({ heldForOthers: -1, meaning: 'owed-to-you' });
    expect(b.pots()).toEqual({ ...START, heldForOthers: -1 });
  });
});

describe('7.4 payments to people go to the daily review unless there is a rule for that person', () => {
  it('7.4 with no rule, a payment to a person waits in review as unsorted spending', () => {
    const b = book();
    expect(b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP FRIEND')).outcome).toBe('review');
    expect(b.pots()).toEqual({ ...START, unsortedOut: 2_500 });
    expect(b.reviewItems()).toEqual([
      { type: 'spending', id: 'z1', date: '2026-10-06', amount: 2_500, description: 'ZELLE TO MADE UP FRIEND', reason: 'person-payment', suggestion: null },
    ]);
  });

  it('7.4 a rule for that person sorts it right away, ignoring upper and lower case', () => {
    const rules: SortingRule[] = [
      { id: 'landlord', for: 'person', contains: 'made up landlord', choice: { to: 'needs' } },
      { id: 'roommate', for: 'person', contains: 'MADE UP ROOMMATE', choice: { to: 'not-mine' } },
    ];
    const b = book({ rules });
    expect(b.receive(payPerson('z1', '2026-10-06', 150_000, 'MADE UP LANDLORD')).outcome).toBe('sorted');
    expect(b.receive(payPerson('z2', '2026-10-06', 2_000, 'MADE UP ROOMMATE')).outcome).toBe('sorted');
    expect(b.pots()).toEqual({ ...START, needs: 20_000 - 150_000, heldForOthers: -2_000 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('7.4 person rules never apply to purchases, and purchase rules never apply to people', () => {
    const rules: SortingRule[] = [
      { id: 'friend-purchase', for: 'purchase', contains: 'FRIEND', bucket: 'wants' },
      { id: 'cafe-person', for: 'person', contains: 'CAFE', choice: { to: 'needs' } },
    ];
    const b = book({ rules });
    expect(b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP FRIEND')).outcome).toBe('review');
    expect(b.receive(purchase('e1', '2026-10-06', 500, 'MADE UP CAFE')).outcome).toBe('review');
  });

  it('7.4 a payment to a person can be sorted to needs, wants, not mine, or for mom, and nothing else (7.6)', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP FRIEND'));
    for (const choice of [{ to: 'savings' }, { to: 'other-income' }, { to: 'paycheck' }, { to: 'momReserve' }, { split: [{ bucket: 'savings', amount: 2_500 }] }]) {
      expect(codeOf(() => b.sort('z1', choice as never, '2026-10-07')), JSON.stringify(choice)).toBe('bad-choice');
    }
    b.sort('z1', { to: 'needs' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, needs: 17_500 });
  });

  it('7.4 a person rule must pick needs, wants, not mine, or mom', () => {
    for (const choice of [{ to: 'savings' }, { to: 'other-income' }, { to: 'paycheck' }, { to: 'unsorted' }, { to: 'momReserve' }]) {
      expect(codeOf(() => book({ rules: [{ id: 'x', for: 'person', contains: 'A', choice } as never] })), JSON.stringify(choice)).toBe('bad-rule');
    }
  });

  it('7.4 a payment to a person is handled the same from savings as from checking (A16)', () => {
    const b = book({ rules: [{ id: 'barber', for: 'person', contains: 'BARBER', choice: { to: 'wants' } }] });
    expect(b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP FRIEND', 'savings')).outcome).toBe('review');
    expect(b.reviewItems()).toMatchObject([{ type: 'spending', id: 'z1', reason: 'person-payment', amount: 2_500 }]);
    expect(b.pots()).toEqual({ ...START, unsortedOut: 2_500 });
    b.sort('z1', { to: 'not-mine' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, heldForOthers: -2_500 });
    // A rule for the person applies from savings too.
    expect(b.receive(payPerson('z2', '2026-10-08', 4_000, 'MADE UP BARBER', 'savings')).outcome).toBe('sorted');
    expect(b.pots()).toEqual({ ...START, heldForOthers: -2_500, wants: 26_000 });
  });

  it('7.4 a payment to a person comes from checking or savings, never from a card', () => {
    const b = book();
    for (const account of ['everyday-card', 'old-card']) {
      expect(codeOf(() => b.receive({ ...payPerson('z1', '2026-10-06', 2_500, 'MADE UP FRIEND'), account } as never)), account).toBe('bad-transaction');
    }
    expect(b.pots()).toEqual(START);
  });
});

describe('7.6 in review, a payment to a person can go to needs, wants, not mine, or for mom, or be split across needs, wants and not mine', () => {
  it('7.6 for mom: it comes out of the mom reserve and counts toward the month (8.1, 8.2)', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP AUNT'));
    b.sort('z1', { to: 'mom' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, momReserve: 37_500 });
    expect(b.momSentInMonth('2026-10').sent).toBe(2_500);
    expect(b.reviewItems()).toEqual([]);
  });

  it('7.6 a payment partly refunded cannot be for mom, and nothing changes; it can still go to a bucket', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 10_000, 'MADE UP AUNT'));
    b.receive(refund('r1', '2026-10-07', 2_500, 'z1', 'checking'));
    const before = b.pots();
    expect(codeOf(() => b.sort('z1', { to: 'mom' }, '2026-10-07'))).toBe('bad-choice');
    expect(b.pots()).toEqual(before);
    expect(b.momSentInMonth('2026-10').sent).toBe(0);
    b.sort('z1', { to: 'needs' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, needs: 12_500 });
  });

  it('7.6 for mom, bigger than the reserve: the reserve covers what it can, and the difference waits (8.3)', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 50_000, 'MADE UP AUNT'));
    b.sort('z1', { to: 'mom' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, momReserve: 0, unsortedOut: 10_000 });
    expect(b.reviewItems()).toMatchObject([{ type: 'spending', id: 'z1:difference', reason: 'mom-difference', amount: 10_000 }]);
    expect(b.momSentInMonth('2026-10').sent).toBe(50_000);
  });

  it('7.6 one marked for mom by hand can be sorted again; the reserve gets its money back, and the difference goes away', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 50_000, 'MADE UP AUNT'));
    b.sort('z1', { to: 'mom' }, '2026-10-07');
    b.sort('z1:difference', { to: 'needs' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, momReserve: 0, needs: 10_000 });
    b.sort('z1', { to: 'wants' }, '2026-10-08');
    expect(b.pots()).toEqual({ ...START, wants: -20_000 });
    expect(b.momSentInMonth('2026-10').sent).toBe(0);
    expect(b.reviewItems()).toEqual([]);
    // And back to mom again.
    b.sort('z1', { to: 'mom' }, '2026-10-09');
    expect(b.pots()).toEqual({ ...START, momReserve: 0, unsortedOut: 10_000 });
  });

  it('7.6 split across needs, wants and not mine; the parts must add up to the payment, to the cent', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 9_000, 'MADE UP FRIEND'));
    b.sort('z1', { split: [{ bucket: 'needs', amount: 3_000 }, { bucket: 'wants', amount: 1 }, { bucket: 'not-mine', amount: 5_999 }] }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, needs: 17_000, wants: 29_999, heldForOthers: -5_999 });
    expect(codeOf(() => b.sort('z1', { split: [{ bucket: 'needs', amount: 8_999 }] }, '2026-10-07'))).toBe('split-does-not-add-up');
    expect(codeOf(() => b.sort('z1', { split: [{ bucket: 'needs', amount: 9_001 }] }, '2026-10-07'))).toBe('split-does-not-add-up');
    for (const bucket of ['savings', 'mom', 'momReserve', 'unsorted']) {
      expect(codeOf(() => b.sort('z1', { split: [{ bucket, amount: 9_000 }] } as never, '2026-10-07')), bucket).toBe('bad-choice');
    }
    expect(b.pots()).toEqual({ ...START, needs: 17_000, wants: 29_999, heldForOthers: -5_999 });
  });

  it('7.6 7.7 a purchase never splits into savings, and cannot be for mom (4.4)', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-06', 9_000, 'MADE UP STORE'));
    expect(codeOf(() => b.sort('e1', { split: [{ bucket: 'needs', amount: 5_000 }, { bucket: 'savings' as never, amount: 4_000 }] }, '2026-10-07'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('e1', { to: 'mom' } as never, '2026-10-07'))).toBe('bad-choice');
    expect(b.pots()).toEqual({ ...START, unsortedOut: 9_000 });
  });

  it('7.6 a person rule can pick mom: such a payment comes out of the reserve on its own', () => {
    const b = book({ rules: [{ id: 'aunt', for: 'person', contains: 'AUNT', choice: { to: 'mom' } }] });
    expect(b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP AUNT')).outcome).toBe('sorted');
    expect(b.pots()).toEqual({ ...START, momReserve: 37_500 });
    expect(b.momSentInMonth('2026-10').sent).toBe(2_500);
    // Like anything a rule sorted, it can be re-sorted by hand.
    b.sort('z1', { to: 'needs' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, needs: 17_500 });
  });

  it('7.6 "always do this" with for mom makes a person rule that picks mom (13.6)', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP AUNT'));
    b.sortAlways('z1', { to: 'mom' }, { id: 'aunt', contains: 'AUNT' }, '2026-10-07');
    expect(b.rules()).toMatchObject([{ id: 'aunt', for: 'person', choice: { to: 'mom' } }]);
    b.receive(payPerson('z2', '2026-10-08', 1_000, 'MADE UP AUNT'));
    expect(b.pots()).toEqual({ ...START, momReserve: 36_500 });
  });
});

describe('7.5 a friend paying you back is a payback', () => {
  it('7.5 it goes into the bucket you pick, not held for others', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 4_000, 'MADE UP FRIEND'));
    b.sort('z1', { to: 'wants' }, '2026-10-06');
    b.receive(deposit('d1', '2026-10-08', 2_000, 'ZELLE FROM MADE UP FRIEND'));
    b.sort('d1', { to: 'wants' }, '2026-10-08');
    expect(b.pots()).toEqual({ ...START, wants: 28_000 });
    expect(b.othersMoney().meaning).toBe('settled');
  });
});

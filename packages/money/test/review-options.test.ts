import { describe, expect, it } from 'vitest';
import type { Book, ReviewDetail } from '../src/index.js';
import { MOM_NAME, arrived, cardCharge, codeOf, deposit, openTestBook, payPerson, paycheck, posted, purchase, refund, sent, transfer, withdrawal, type TestBookOptions } from './helpers.js';

// What can be done with each kind of item waiting in review: the choices the
// rulebook gives for that kind of item, worked out by the money math so the
// screens only show them (the screens never decide what a rule allows).
// Every offered choice must be accepted by the book and everything else
// refused; review-options-agree.test.ts checks that against the book itself.

function book(options: TestBookOptions = {}): Book {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000 }, ...options });
}

function detail(b: Book, id: string): ReviewDetail {
  const found = b.reviewDetails().find((d) => d.item.id === id);
  if (found === undefined) throw new Error(`nothing waiting with id ${id}`);
  return found;
}

function sorting(d: ReviewDetail) {
  if (d.options.type !== 'sort') throw new Error(`${d.item.id} is not something to sort`);
  return d.options;
}

const toOf = (d: ReviewDetail): string[] => sorting(d).picks.map((p) => p.to);

describe('6.1 a deposit that is not a paycheck: my paycheck, other income, payback, or not mine', () => {
  it('6.1 the choices are my paycheck, other income, payback into any bucket, and not mine', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP TAX REFUND'));
    const d = detail(b, 'd1');
    expect(d.item).toMatchObject({ type: 'money-in', reason: 'deposit' });
    expect(toOf(d)).toEqual(['paycheck', 'other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine']);
  });

  it('6.1 "this is my paycheck" is final, so it asks first; nothing else on a deposit does', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP TAX REFUND'));
    expect(sorting(detail(b, 'd1')).picks.filter((p) => p.final).map((p) => p.to)).toEqual(['paycheck']);
  });

  it('6.2 13.6 "always do this" can make a rule for every choice but my paycheck', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP TAX REFUND'));
    expect(sorting(detail(b, 'd1')).always).toEqual(['other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine']);
  });

  it('5.6 a deposit into checking can be a transfer from savings, and one into savings from checking', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP DEPOSIT', 'checking'));
    b.receive(deposit('d2', '2026-10-05', 25_000, 'MADE UP DEPOSIT', 'savings'));
    expect(sorting(detail(b, 'd1')).transfer).toEqual(['savings']);
    expect(sorting(detail(b, 'd2')).transfer).toEqual(['checking']);
  });

  it('6.1 7.8 a deposit can be split across Other, savings, needs and wants, with Wants getting the rest', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP TAX REFUND'));
    expect(sorting(detail(b, 'd1')).split).toEqual(['not-mine', 'savings', 'needs', 'wants']);
  });

  it('3.7 6.1 a paycheck-looking deposit held back as early gets the same four choices, but no rule', () => {
    const b = book();
    b.receive(paycheck('early', '2026-10-02', 300_000));
    const d = detail(b, 'early');
    expect(d.item).toMatchObject({ type: 'money-in', reason: 'early-paycheck' });
    expect(toOf(d)).toEqual(['paycheck', 'other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine']);
    // B17: paychecks are found by the paycheck rule, never by a deposit rule.
    expect(sorting(d).always).toEqual([]);
  });

  it('B54 a deposit older than the last paycheck cannot be my paycheck, and the screen is told why', () => {
    const b = book({ lastPaycheckDate: '2026-09-25' });
    b.receive(deposit('old', '2026-09-20', 25_000, 'MADE UP LATE ARRIVAL'));
    const o = sorting(detail(b, 'old'));
    expect(o.picks.map((p) => p.to)).not.toContain('paycheck');
    expect(o.unavailable).toEqual([{ what: 'paycheck', why: expect.stringContaining('older than your last paycheck') }]);
    expect(codeOf(() => b.sort('old', { to: 'paycheck' }, '2026-10-06'))).toBe('bad-choice');
    // It can still be other income.
    expect(o.picks.map((p) => p.to)).toContain('other-income');
  });

  it('B54 a deposit on the same day as the last paycheck can be my paycheck', () => {
    const b = book({ lastPaycheckDate: '2026-09-25' });
    b.receive(deposit('same', '2026-09-25', 25_000, 'MADE UP SAME DAY'));
    expect(toOf(detail(b, 'same'))).toContain('paycheck');
    expect(sorting(detail(b, 'same')).unavailable).toEqual([]);
  });
});

describe('4.5 a refund the app could not match: payback into a bucket, or not mine', () => {
  it('4.5 B16 the choices are payback into any bucket and not mine, never income', () => {
    const b = book();
    b.receive(refund('r1', '2026-10-05', 2_317, undefined, 'everyday-card'));
    const d = detail(b, 'r1');
    expect(d.item).toMatchObject({ type: 'money-in', reason: 'refund' });
    expect(toOf(d)).toEqual(['savings', 'needs', 'wants', 'momReserve', 'not-mine']);
    expect(sorting(d).picks.some((p) => p.final)).toBe(false);
    expect(sorting(d).always).toEqual([]);
    expect(sorting(d).split).toEqual(['not-mine', 'savings', 'needs', 'wants']);
    expect(codeOf(() => b.sort('r1', { to: 'other-income' }, '2026-10-06'))).toBe('bad-choice');
  });

  it('5.6 a refund on the card can be a card payment arriving from checking or savings', () => {
    const b = book();
    b.receive(refund('r1', '2026-10-05', 2_317, undefined, 'everyday-card'));
    b.receive(refund('r2', '2026-10-05', 2_317, undefined, 'checking'));
    expect(sorting(detail(b, 'r1')).transfer).toEqual(['checking', 'savings']);
    expect(sorting(detail(b, 'r2')).transfer).toEqual(['savings']);
  });
});

describe('4.2 4.3 4.4 a purchase with no rule: needs or wants, or split between them', () => {
  it('4.2 7.7 the choices are needs and wants, and from checking not mine, never savings or the mom reserve (A3)', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-05', 1_150, 'CORNER STORE', { account: 'checking' }));
    const d = detail(b, 'p1');
    expect(d.item).toMatchObject({ type: 'spending', reason: 'no-rule' });
    expect(toOf(d)).toEqual(['needs', 'wants', 'not-mine']);
    expect(sorting(d).picks.some((p) => p.final)).toBe(false);
    expect(codeOf(() => b.sort('p1', { to: 'savings' }, '2026-10-06'))).toBe('bad-choice');
  });

  it('4.4 7.7 it can be split between needs, Other and wants, with Wants getting the rest', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-05', 1_150, 'CORNER STORE'));
    expect(sorting(detail(b, 'p1')).split).toEqual(['needs', 'not-mine', 'wants']);
  });

  it('4.4 one cent cannot be split, and two cents can (each part is at least a cent)', () => {
    const b = book();
    b.receive(purchase('one', '2026-10-05', 1, 'TINY'));
    b.receive(purchase('two', '2026-10-05', 2, 'TINY'));
    expect(sorting(detail(b, 'one')).split).toBeNull();
    expect(sorting(detail(b, 'two')).split).toEqual(['needs', 'not-mine', 'wants']);
    expect(() => b.sort('two', { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: 1 }] }, '2026-10-06')).not.toThrow();
  });

  it('13.6 "always do this" can make a rule for needs or wants', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-05', 1_150, 'CORNER STORE'));
    expect(sorting(detail(b, 'p1')).always).toEqual(['needs', 'wants']);
  });

  it('5.6 B74 a debit card purchase that posted can be a transfer; the everyday card never', () => {
    const b = book();
    b.receive(purchase('debit', '2026-10-05', 1_150, 'CORNER STORE', { account: 'checking' }));
    b.receive(purchase('card', '2026-10-05', 1_150, 'CORNER STORE', { account: 'everyday-card' }));
    expect(sorting(detail(b, 'debit')).transfer).toEqual(['savings', 'everyday-card', 'old-card']);
    expect(sorting(detail(b, 'card')).transfer).toEqual([]);
    expect(sorting(detail(b, 'card')).unavailable).toEqual([]);
  });

  it('5.6 B74 a pending purchase cannot be marked a transfer yet, and says to wait for it to post', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-05', 1_150, 'CORNER STORE', { account: 'checking', pending: true }));
    const o = sorting(detail(b, 'pend'));
    expect(o.transfer).toEqual([]);
    expect(o.unavailable).toEqual([{ what: 'transfer', why: expect.stringContaining('pending') }]);
    expect(codeOf(() => b.sort('pend', { transfer: 'savings' }, '2026-10-06'))).toBe('still-pending');
    b.receive(posted('post', 'pend', '2026-10-06', 1_150, 'CORNER STORE', 'checking'));
    expect(sorting(detail(b, 'pend')).transfer).toEqual(['savings', 'everyday-card', 'old-card']);
  });

  it('5.6 B74 a partly refunded purchase cannot be marked a transfer, and says why', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-05', 5_000, 'CORNER STORE', { account: 'checking' }));
    b.receive(refund('r1', '2026-10-06', 1_000, 'p1', 'checking'));
    const o = sorting(detail(b, 'p1'));
    expect(o.transfer).toEqual([]);
    expect(o.unavailable).toEqual([{ what: 'transfer', why: expect.stringContaining('refunded') }]);
    expect(codeOf(() => b.sort('p1', { transfer: 'savings' }, '2026-10-07'))).toBe('bad-choice');
    // Only what is left of it waits, and it can still be split (B11).
    expect(detail(b, 'p1').item).toMatchObject({ amount: 4_000 });
  });

  it('4.5 A1 a split purchase whose total changed comes back for a new split, with the same choices', () => {
    const b = book({ rules: [] });
    b.receive(purchase('p1', '2026-10-05', 9_000, 'HARDWARE', { account: 'checking' }));
    b.sort('p1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-05');
    b.receive(refund('r1', '2026-10-06', 1_000, 'p1', 'checking'));
    const d = detail(b, 'p1');
    expect(d.item).toMatchObject({ type: 'spending', reason: 'split-changed', amount: 8_000 });
    expect(toOf(d)).toEqual(['needs', 'wants', 'not-mine']);
    expect(sorting(d).split).toEqual(['needs', 'not-mine', 'wants']);
  });

  it('14.2 A10 a difference from a charge pending on setup day can go to needs or wants, and cannot be a transfer', () => {
    const b = book({ countedAtSetup: [purchase('s1', '2026-09-30', 1_000, 'GAS HOLD', { account: 'checking', pending: true })] });
    b.receive(posted('s2', 's1', '2026-10-02', 1_250, 'GAS STATION', 'checking'));
    const d = detail(b, 's1');
    expect(d.item).toMatchObject({ reason: 'setup-difference', amount: 250 });
    expect(toOf(d)).toEqual(['needs', 'wants']);
    expect(sorting(d).split).toEqual(['needs', 'wants']);
    expect(sorting(d).transfer).toEqual([]);
    expect(sorting(d).unavailable).toEqual([{ what: 'transfer', why: expect.stringContaining('setup day') }]);
  });

  it('14.2 a setup-day charge that posted lower leaves money back, which cannot be split but can go to a bucket', () => {
    const b = book({ countedAtSetup: [purchase('s1', '2026-09-30', 1_000, 'GAS HOLD', { account: 'checking', pending: true })] });
    b.receive(posted('s2', 's1', '2026-10-02', 800, 'GAS STATION', 'checking'));
    const d = detail(b, 's1');
    expect(d.item).toMatchObject({ reason: 'setup-difference', amount: -200 });
    expect(sorting(d).split).toBeNull();
    expect(toOf(d)).toEqual(['needs', 'wants']);
  });
});

describe('4.10 what is left of a purchase the bank took back or dropped after a part of it was refunded', () => {
  it('4.10 only the money back waits, as a negative; it can go to a bucket, cannot be split, and cannot be marked a transfer', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-02', 10_000, 'MADE UP SHOP', { account: 'checking' }));
    b.receive(refund('r1', '2026-10-03', 4_000, 'p1', 'checking'));
    b.receive({ kind: 'taken-back', id: 'tb', takenId: 'p1', date: '2026-10-04', description: 'CORRECTION' });
    const d = detail(b, 'p1');
    expect(d.item).toMatchObject({ amount: -4_000 });
    expect(toOf(d)).toEqual(['needs', 'wants']);
    expect(sorting(d).split).toBeNull();
    expect(sorting(d).transfer).toEqual([]);
    expect(sorting(d).unavailable).toEqual([{ what: 'transfer', why: 'The bank took it back, so it cannot be marked a transfer.' }]);
    expect(codeOf(() => b.sort('p1', { transfer: 'savings' }, '2026-10-05'))).toBe('bad-choice');
  });

  it('4.6 A2 a pending charge the bank dropped after a part of it was refunded is the same', () => {
    const b = book();
    b.receive(purchase('q1', '2026-10-02', 10_000, 'MADE UP SHOP', { account: 'checking', pending: true }));
    b.receive(refund('r2', '2026-10-03', 4_000, 'q1', 'checking'));
    b.receive({ kind: 'pending-dropped', id: 'dr', pendingId: 'q1', date: '2026-10-04', description: 'HOLD RELEASED' });
    const d = detail(b, 'q1');
    expect(d.item).toMatchObject({ amount: -4_000 });
    expect(sorting(d).transfer).toEqual([]);
    expect(sorting(d).unavailable).toEqual([{ what: 'transfer', why: 'The bank took it back, so it cannot be marked a transfer.' }]);
  });
});

describe('4.9 money leaving savings that is not a transfer: always waits, with the usual choices', () => {
  it('4.9 7.7 the choices are needs, wants, not mine, or a split; it can be a transfer to another account; no rule', () => {
    const b = book();
    b.receive(withdrawal('w1', '2026-10-05', 6_410, 'BILL PAY WATER'));
    const d = detail(b, 'w1');
    expect(d.item).toMatchObject({ type: 'spending', reason: 'from-savings' });
    expect(d.account).toBe('savings');
    expect(toOf(d)).toEqual(['needs', 'wants', 'not-mine']);
    expect(sorting(d).split).toEqual(['needs', 'not-mine', 'wants']);
    expect(sorting(d).transfer).toEqual(['checking', 'everyday-card', 'old-card']);
    expect(sorting(d).always).toEqual([]);
  });

  it('4.9 13.6 a rule cannot be made from it, and the book agrees', () => {
    const b = book();
    b.receive(withdrawal('w1', '2026-10-05', 6_410, 'BILL PAY WATER'));
    expect(codeOf(() => b.sortAlways('w1', { to: 'needs' }, { id: 'r', contains: 'WATER' }, '2026-10-06'))).toBe('no-rule-for-this');
  });
});

describe('4.8 fees and interest on the everyday card: suggested needs', () => {
  it('4.8 the choices are needs, wants, or a split; no transfer, no rule', () => {
    const b = book();
    b.receive(cardCharge('f1', '2026-10-05', 3_500, 'fee'));
    b.receive(cardCharge('i1', '2026-10-05', 1_842, 'interest'));
    for (const id of ['f1', 'i1']) {
      const d = detail(b, id);
      expect(d.account).toBe('everyday-card');
      expect(toOf(d)).toEqual(['needs', 'wants']);
      expect(sorting(d).split).toEqual(['needs', 'wants']);
      expect(sorting(d).transfer).toEqual([]);
      expect(sorting(d).unavailable).toEqual([]);
      expect(sorting(d).always).toEqual([]);
    }
    expect(detail(b, 'f1').item).toMatchObject({ suggestion: 'needs', reason: 'card-fee' });
  });
});

describe('5.2 A4 a payment to the old card from savings: out of savings once confirmed, or out of needs', () => {
  it('5.2 the choices are savings or needs, with nothing else', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 20_000, 'savings', 'old-card'));
    const d = detail(b, 't1');
    expect(d.item).toMatchObject({ reason: 'old-card-from-savings', suggestion: 'savings' });
    // It left savings, so that is where it happened.
    expect(d.account).toBe('savings');
    expect(toOf(d)).toEqual(['savings', 'needs']);
    expect(sorting(d).split).toBeNull();
    expect(sorting(d).transfer).toEqual([]);
    expect(sorting(d).always).toEqual([]);
  });

  it('5.2 the leaving half of a payment from savings to the old card is the same', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-05', 20_000, 'savings', 'old-card'));
    expect(toOf(detail(b, 's1'))).toEqual(['savings', 'needs']);
    expect(detail(b, 's1').account).toBe('savings');
  });
});

describe('5.4 a new purchase on the old card is a flag to see', () => {
  it('5.4 the only thing to do is mark it seen, and it moves no money', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-05', 8_000, 'FURNITURE', { account: 'old-card' }));
    const d = detail(b, 'o1');
    expect(d.item.type).toBe('old-card-purchase');
    expect(d.options).toEqual({ type: 'acknowledge' });
    expect(d.account).toBe('old-card');
  });
});

describe('3.4 the leftover question at payday', () => {
  it('3.4 the answers are roll over or move to savings', () => {
    const b = book({ lastPaycheckDate: '2026-09-18' });
    b.receive(paycheck('pay', '2026-10-02', 400_000));
    const questions = b.reviewDetails().filter((d) => d.item.type === 'leftover');
    expect(questions.map((d) => d.item.id)).toEqual(['leftover:pay:needs', 'leftover:pay:wants']);
    for (const q of questions) {
      expect(q.options).toEqual({ type: 'leftover', answers: ['roll-over', 'move-to-savings'] });
      expect(q.account).toBeNull();
    }
  });
});

describe('7.4 7.6 a payment to a person: needs, wants, not mine, or for mom', () => {
  it('7.6 the choices are needs, wants, not mine, and for mom, or a split across needs, wants and not mine', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-05', 4_000, 'MADE UP FRIEND'));
    const d = detail(b, 'z1');
    expect(d.item).toMatchObject({ type: 'spending', reason: 'person-payment' });
    expect(toOf(d)).toEqual(['needs', 'wants', 'not-mine', 'mom']);
    expect(sorting(d).split).toEqual(['needs', 'wants', 'not-mine']);
    expect(sorting(d).always).toEqual(['needs', 'wants', 'not-mine', 'mom']);
  });

  it('7.4 A16 from either account, the same; it can also be a transfer to another account', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-05', 4_000, 'MADE UP FRIEND', 'checking'));
    b.receive(payPerson('z2', '2026-10-05', 4_000, 'MADE UP FRIEND', 'savings'));
    expect(toOf(detail(b, 'z1'))).toEqual(toOf(detail(b, 'z2')));
    expect(sorting(detail(b, 'z1')).transfer).toEqual(['savings', 'everyday-card', 'old-card']);
    expect(sorting(detail(b, 'z2')).transfer).toEqual(['checking', 'everyday-card', 'old-card']);
  });

  it('7.6 B73 a payment that was partly refunded cannot be marked for mom, and the book agrees', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-05', 4_000, 'MADE UP FRIEND'));
    b.receive(refund('r1', '2026-10-06', 1_000, 'z1', 'checking'));
    const d = detail(b, 'z1');
    expect(toOf(d)).toEqual(['needs', 'wants', 'not-mine']);
    expect(sorting(d).always).toEqual(['needs', 'wants', 'not-mine']);
    expect(codeOf(() => b.sort('z1', { to: 'mom' }, '2026-10-07'))).toBe('bad-choice');
  });
});

describe('8.3 the difference on a mom payment the reserve could not cover: needs or wants', () => {
  it('8.3 B23 needs or wants, one bucket, never split, nothing else', () => {
    const b = book({ pots: { momReserve: 10_000 } });
    b.receive(payPerson('m1', '2026-10-05', 25_000, MOM_NAME));
    const d = detail(b, 'm1:difference');
    expect(d.item).toMatchObject({ type: 'spending', reason: 'mom-difference', amount: 15_000 });
    expect(toOf(d)).toEqual(['needs', 'wants']);
    expect(sorting(d).split).toBeNull();
    expect(sorting(d).transfer).toEqual([]);
    expect(sorting(d).always).toEqual([]);
  });
});

describe('3.1 3.2 3.3 what "this is my paycheck" would do, shown before it asks', () => {
  it('3.2 3.3 the preview is the split the paycheck really gets: reserve first, then the percentages', () => {
    const b = book({ pots: { momReserve: 120_000 } });
    b.receive(deposit('d1', '2026-10-05', 420_000, 'MADE UP NEW JOB'));
    const preview = detail(b, 'd1').paycheckPreview;
    expect(preview).toMatchObject({ momReserve: 150_000, needs: 81_000, wants: 54_000, savings: 135_000 });
    b.sort('d1', { to: 'paycheck' }, '2026-10-06');
    expect(b.paychecks().at(-1)?.split).toEqual(preview);
  });

  it('3.2 a preview when the reserve is nearly at its cap: the part that does not fit goes to savings', () => {
    const b = book({ pots: { momReserve: 290_000 } });
    b.receive(deposit('d1', '2026-10-05', 420_000, 'MADE UP NEW JOB'));
    const preview = detail(b, 'd1').paycheckPreview;
    expect(preview).toMatchObject({ momReserve: 10_000, savings: 135_000 + 140_000 });
    b.sort('d1', { to: 'paycheck' }, '2026-10-06');
    expect(b.paychecks().at(-1)?.split).toEqual(preview);
  });

  it('3.2 a deposit smaller than the reserve gives all of it to the reserve', () => {
    const b = book({ pots: { momReserve: 0 } });
    b.receive(deposit('d1', '2026-10-05', 120_000, 'MADE UP NEW JOB'));
    expect(detail(b, 'd1').paycheckPreview).toMatchObject({ momReserve: 120_000, needs: 0, wants: 0, savings: 0 });
  });

  it('3.3 one cent is a paycheck too: the cent goes to savings', () => {
    const b = book({ pots: { momReserve: 300_000 } });
    b.receive(deposit('d1', '2026-10-05', 1, 'MADE UP NEW JOB'));
    expect(detail(b, 'd1').paycheckPreview).toMatchObject({ momReserve: 0, needs: 0, wants: 0, savings: 1 });
  });

  it('13.1 the preview follows a split changed since, as the paycheck would', () => {
    const b = book({ pots: { momReserve: 0 }, settings: { split: { savings: 40, needs: 40, wants: 20 } } });
    b.receive(deposit('d1', '2026-10-05', 420_000, 'MADE UP NEW JOB'));
    const preview = detail(b, 'd1').paycheckPreview;
    expect(preview).toMatchObject({ momReserve: 150_000, needs: 108_000, wants: 54_000, savings: 108_000 });
    b.sort('d1', { to: 'paycheck' }, '2026-10-06');
    expect(b.paychecks().at(-1)?.split).toEqual(preview);
  });

  it('there is no preview for a refund, for spending, or for a deposit that cannot be a paycheck', () => {
    const b = book({ lastPaycheckDate: '2026-09-25' });
    b.receive(refund('r1', '2026-10-05', 2_317, undefined, 'everyday-card'));
    b.receive(purchase('p1', '2026-10-05', 1_150, 'CORNER STORE'));
    b.receive(deposit('old', '2026-09-20', 25_000, 'MADE UP LATE ARRIVAL'));
    expect(detail(b, 'r1').paycheckPreview).toBeNull();
    expect(detail(b, 'p1').paycheckPreview).toBeNull();
    expect(detail(b, 'old').paycheckPreview).toBeNull();
  });
});

describe('20d A15 a refund lists the purchases it likely belongs to', () => {
  function refundBook(): Book {
    const b = book();
    b.receive(purchase('coffee', '2026-10-01', 575, 'BLUE DOOR COFFEE'));
    b.receive(purchase('rest', '2026-10-02', 3_890, 'MAIN ST RESTAURANT'));
    b.receive(purchase('market', '2026-10-03', 2_317, 'ONLINE MARKETPLACE'));
    b.receive(purchase('gas', '2026-10-04', 4_120, 'CORNER GAS STATION'));
    b.sort('coffee', { to: 'wants' }, '2026-10-04');
    return b;
  }
  const ids = (b: Book, id: string): string[] => detail(b, id).likelyPurchases.map((p) => p.id);

  it('20d a purchase with the same name and the same amount comes first', () => {
    const b = refundBook();
    b.receive({ ...refund('r1', '2026-10-06', 2_317, undefined, 'everyday-card'), description: 'ONLINE MARKETPLACE RETURN' });
    expect(detail(b, 'r1').likelyPurchases[0]).toEqual({
      id: 'market',
      date: '2026-10-03',
      description: 'ONLINE MARKETPLACE',
      amount: 2_317,
      left: 2_317,
      sortedTo: { to: 'unsorted' },
      sameName: true,
      sameAmount: true,
    });
  });

  it('20d the same name comes before the same amount, and both before neither', () => {
    const b = book();
    b.receive(purchase('amount-only', '2026-10-05', 2_000, 'UNRELATED SHOP'));
    b.receive(purchase('name-only', '2026-10-01', 5_000, 'BLUE DOOR COFFEE'));
    b.receive(purchase('both', '2026-10-02', 2_000, 'BLUE DOOR COFFEE'));
    // Another store, so the coffee shop's name is on half the purchases, not most (A33).
    b.receive(purchase('deli', '2026-10-01', 300, 'CORNER DELI'));
    b.receive({ ...refund('r1', '2026-10-06', 2_000, undefined, 'everyday-card'), description: 'BLUE DOOR COFFEE' });
    expect(ids(b, 'r1')).toEqual(['both', 'name-only', 'amount-only']);
  });

  it('20d the same amount without the same name still counts; unrelated purchases are left out', () => {
    const b = refundBook();
    b.receive({ ...refund('r1', '2026-10-06', 4_120, undefined, 'everyday-card'), description: 'REFUND 0042' });
    expect(ids(b, 'r1')).toEqual(['gas']);
    expect(detail(b, 'r1').likelyPurchases[0]).toMatchObject({ sameName: false, sameAmount: true });
  });

  it('20d the same name but a different amount is listed when the purchase has at least that much left', () => {
    const b = refundBook();
    b.receive({ ...refund('r1', '2026-10-06', 1_000, undefined, 'everyday-card'), description: 'MAIN ST RESTAURANT' });
    expect(ids(b, 'r1')).toEqual(['rest']);
    expect(detail(b, 'r1').likelyPurchases[0]).toMatchObject({ sameName: true, sameAmount: false, left: 3_890 });
  });

  it('4.5 a purchase with less left than the refund cannot be what it belongs to', () => {
    const b = refundBook();
    b.receive({ ...refund('r1', '2026-10-06', 4_000, undefined, 'everyday-card'), description: 'MAIN ST RESTAURANT' });
    expect(ids(b, 'r1')).toEqual([]);
  });

  it('4.5 what an earlier refund already took back is not left to refund again', () => {
    const b = refundBook();
    b.receive(refund('r0', '2026-10-05', 3_000, 'rest', 'everyday-card'));
    b.receive({ ...refund('r1', '2026-10-06', 1_000, undefined, 'everyday-card'), description: 'MAIN ST RESTAURANT' });
    // 38.90 - 30.00 = 8.90 is left, enough for 10.00? No: 10.00 is more.
    expect(ids(b, 'r1')).toEqual([]);
    b.receive({ ...refund('r2', '2026-10-06', 890, undefined, 'everyday-card'), description: 'MAIN ST RESTAURANT' });
    // The refund is exactly what is left, not what the purchase was.
    expect(detail(b, 'r2').likelyPurchases[0]).toMatchObject({ id: 'rest', left: 890, amount: 3_890, sameAmount: true });
  });

  it('4.5 only purchases on the same card, and not after the refund', () => {
    const b = refundBook();
    b.receive(purchase('debit', '2026-10-01', 2_317, 'ONLINE MARKETPLACE', { account: 'checking' }));
    b.receive(purchase('later', '2026-10-08', 2_317, 'ONLINE MARKETPLACE'));
    b.receive({ ...refund('r1', '2026-10-06', 2_317, undefined, 'everyday-card'), description: 'ONLINE MARKETPLACE' });
    expect(ids(b, 'r1')).toEqual(['market']);
    b.receive({ ...refund('r2', '2026-10-06', 2_317, undefined, 'checking'), description: 'ONLINE MARKETPLACE' });
    expect(ids(b, 'r2')).toEqual(['debit']);
  });

  it('20d a purchase on the day of the refund counts, and the newest comes first among equals', () => {
    const b = book();
    b.receive(purchase('a', '2026-10-01', 1_000, 'MADE UP SHOP'));
    b.receive(purchase('b', '2026-10-03', 1_000, 'MADE UP SHOP'));
    b.receive(purchase('c', '2026-10-06', 1_000, 'MADE UP SHOP'));
    b.receive({ ...refund('r1', '2026-10-06', 1_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    expect(ids(b, 'r1')).toEqual(['c', 'b', 'a']);
  });

  it('20d words of one or two letters are not a name', () => {
    const b = book();
    b.receive(purchase('first', '2026-10-01', 1_000, 'FIRST ST DELI'));
    b.receive({ ...refund('r1', '2026-10-06', 500, undefined, 'everyday-card'), description: 'SECOND ST CAFE' });
    // Only "ST" is the same, and it is not a name; the amounts differ too.
    expect(ids(b, 'r1')).toEqual([]);
  });

  it('20d what the bank calls the item, such as refund, is not a name', () => {
    const b = book();
    b.receive(purchase('depot', '2026-10-01', 2_000, 'REFUND DEPOT'));
    b.receive({ ...refund('r1', '2026-10-06', 500, undefined, 'everyday-card'), description: 'MADE UP REFUND' });
    expect(ids(b, 'r1')).toEqual([]);
  });

  it('20d a name matches whatever the case, and whatever comes between the words', () => {
    const b = book();
    b.receive(purchase('shop', '2026-10-01', 2_000, 'blue-door  COFFEE #12'));
    // Another store, so these words are on half the purchases, not most (A33).
    b.receive(purchase('deli', '2026-10-01', 300, 'CORNER DELI'));
    b.receive({ ...refund('r1', '2026-10-06', 500, undefined, 'everyday-card'), description: 'Coffee, Blue Door (refund)' });
    expect(ids(b, 'r1')).toEqual(['shop']);
  });

  it('20d at most five are listed', () => {
    const b = book();
    for (let i = 1; i <= 8; i += 1) b.receive(purchase(`p${i}`, `2026-10-0${i}`, 1_000, 'MADE UP SHOP'));
    b.receive({ ...refund('r1', '2026-10-09', 1_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    expect(ids(b, 'r1')).toEqual(['p8', 'p7', 'p6', 'p5', 'p4']);
  });

  it('20d things that are not purchases are never listed: fees, mom payments, card payments, old card purchases', () => {
    const b = book();
    b.receive(cardCharge('fee', '2026-10-01', 1_000, 'fee'));
    b.receive(payPerson('z', '2026-10-01', 1_000, 'MADE UP FRIEND'));
    b.receive(transfer('t', '2026-10-01', 1_000, 'savings', 'old-card'));
    b.receive(purchase('o', '2026-10-01', 1_000, 'MADE UP FURNITURE', { account: 'old-card' }));
    b.receive(refund('r1', '2026-10-06', 1_000, undefined, 'everyday-card'));
    expect(ids(b, 'r1')).toEqual([]);
  });

  it('20d only refunds list purchases', () => {
    const b = refundBook();
    b.receive(deposit('d1', '2026-10-06', 2_317, 'ONLINE MARKETPLACE'));
    expect(detail(b, 'd1').likelyPurchases).toEqual([]);
    expect(detail(b, 'market').likelyPurchases).toEqual([]);
  });

  it('20d a purchase the bank took back is not listed', () => {
    const b = book();
    b.receive(purchase('copy', '2026-10-01', 1_000, 'MADE UP SHOP'));
    b.receive({ kind: 'taken-back', id: 'tb', takenId: 'copy', date: '2026-10-02', description: 'CORRECTION' });
    b.receive({ ...refund('r1', '2026-10-06', 1_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    expect(ids(b, 'r1')).toEqual([]);
  });

  it('20d asking changes nothing: the refund still waits and the buckets are the same', () => {
    const b = refundBook();
    b.receive(refund('r1', '2026-10-06', 2_317, undefined, 'everyday-card'));
    const before = { pots: b.pots(), review: b.reviewItems(), log: b.changeLog() };
    b.reviewDetails();
    expect({ pots: b.pots(), review: b.reviewItems(), log: b.changeLog() }).toEqual(before);
  });
});

// QUESTIONS.md A33, option 3: a word counts as a name only when it is not in
// most of his purchases on that account, in the 90 days up to the refund (the
// refund's day and the 90 days before it). So words every purchase has, such
// as "MADE UP" here or a city, never make two things "the same name".
describe('4.5 A33 "Same name" means a word that is not in most of his purchases on that account', () => {
  const ids = (b: Book, id: string): string[] => detail(b, id).likelyPurchases.map((p) => p.id);
  const refundAs = (id: string, date: string, amount: number, description: string, account: 'everyday-card' | 'checking' = 'everyday-card') => ({
    ...refund(id, date, amount, undefined, account),
    description,
  });

  it('4.5 A33 a word every purchase on the card has is not a name, so it lists nothing by name', () => {
    const b = book();
    b.receive(purchase('cafe', '2026-10-01', 1_200, 'MADE UP CAFE'));
    b.receive(purchase('grocer', '2026-10-02', 5_400, 'MADE UP GROCER'));
    b.receive(purchase('cinema', '2026-10-03', 1_800, 'MADE UP CINEMA'));
    b.receive(refundAs('r1', '2026-10-06', 500, 'MADE UP BOOKSHOP'));
    expect(ids(b, 'r1')).toEqual([]);
  });

  it('4.5 A33 the same store is still the same name when its name is not on most purchases', () => {
    const b = book();
    b.receive(purchase('cafe', '2026-10-01', 1_200, 'MADE UP CAFE'));
    b.receive(purchase('grocer', '2026-10-02', 5_400, 'MADE UP GROCER'));
    b.receive(purchase('cinema', '2026-10-03', 1_800, 'MADE UP CINEMA'));
    b.receive(refundAs('r1', '2026-10-06', 1_000, 'MADE UP CINEMA'));
    expect(detail(b, 'r1').likelyPurchases).toMatchObject([{ id: 'cinema', sameName: true, sameAmount: false }]);
  });

  it('4.5 A33 one purchase with the same amount is listed for the amount, not as the same name', () => {
    const b = book();
    b.receive(purchase('cafe', '2026-10-01', 1_200, 'MADE UP CAFE'));
    b.receive(purchase('grocer', '2026-10-02', 5_400, 'MADE UP GROCER'));
    b.receive(refundAs('r1', '2026-10-06', 5_400, 'MADE UP BOOKSHOP'));
    expect(detail(b, 'r1').likelyPurchases).toMatchObject([{ id: 'grocer', sameName: false, sameAmount: true }]);
  });

  it('4.5 A33 "most" is more than half: a word in exactly half of them is a name, one more and it is not', () => {
    const b = book();
    b.receive(purchase('ny1', '2026-10-01', 2_000, 'DELI NEW YORK'));
    b.receive(purchase('ny2', '2026-10-02', 2_000, 'BAGELS NEW YORK'));
    b.receive(purchase('bos1', '2026-10-03', 2_000, 'BOOKS BOSTON'));
    b.receive(purchase('bos2', '2026-10-04', 2_000, 'FUEL BOSTON'));
    b.receive(refundAs('r1', '2026-10-06', 500, 'PIZZA NEW YORK'));
    // "york" is on 2 of 4 purchases: half, not most. ("new" is too short to be a name.)
    expect(ids(b, 'r1')).toEqual(['ny2', 'ny1']);
    b.receive(purchase('ny3', '2026-10-05', 2_000, 'SHOES NEW YORK'));
    b.receive(refundAs('r2', '2026-10-06', 500, 'PIZZA NEW YORK'));
    // Now on 3 of 5: most of them.
    expect(ids(b, 'r2')).toEqual([]);
  });

  it('4.5 A33 the 90 days: a purchase 90 days before the refund counts toward "most", one 91 days before does not', () => {
    const counted = book();
    const notCounted = book();
    for (const [b, day] of [
      [counted, '2026-07-08'],
      [notCounted, '2026-07-07'],
    ] as const) {
      b.receive(purchase('old1', day, 100, 'MADE UP ONE'));
      b.receive(purchase('old2', day, 100, 'MADE UP TWO'));
      b.receive(purchase('shop', '2026-10-01', 2_000, 'MADE UP SHOP'));
      b.receive(purchase('deli', '2026-10-02', 2_000, 'CORNER DELI'));
      b.receive(purchase('cafe', '2026-10-03', 2_000, 'BLUE CAFE'));
      b.receive(refundAs('r1', '2026-10-06', 500, 'MADE UP'));
    }
    // 2026-07-08 is 90 days before 2026-10-06: "made" is then on 3 of 5.
    expect(ids(counted, 'r1')).toEqual([]);
    // 2026-07-07 is 91 days before: "made" is on 1 of 3 in the 90 days, so it
    // is a name. (The two old ones have less left than the refund.)
    expect(ids(notCounted, 'r1')).toEqual(['shop']);
  });

  it('4.5 A33 purchases after the refund do not count toward "most"', () => {
    const b = book();
    b.receive(purchase('shop', '2026-10-01', 2_000, 'MADE UP SHOP'));
    b.receive(purchase('deli', '2026-10-02', 2_000, 'CORNER DELI'));
    b.receive(purchase('later1', '2026-10-08', 2_000, 'MADE UP LATER'));
    b.receive(purchase('later2', '2026-10-09', 2_000, 'MADE UP LATEST'));
    b.receive(refundAs('r1', '2026-10-06', 500, 'MADE UP SHOP'));
    // Up to the refund, "made" and "shop" are each on 1 of 2.
    expect(ids(b, 'r1')).toEqual(['shop']);
  });

  it('4.5 A33 only purchases on the refund\'s own account count toward "most"', () => {
    const b = book();
    for (const [i, day] of ['2026-10-01', '2026-10-02', '2026-10-03'].entries()) b.receive(purchase(`debit${i}`, day, 2_000, `MADE UP DEBIT ${i}`, { account: 'checking' }));
    b.receive(purchase('shop', '2026-10-01', 2_000, 'MADE UP SHOP'));
    b.receive(purchase('deli', '2026-10-02', 2_000, 'CORNER DELI'));
    b.receive(refundAs('r1', '2026-10-06', 500, 'MADE UP'));
    // On the card "made" is on 1 of 2; on checking it is on all 3.
    expect(ids(b, 'r1')).toEqual(['shop']);
    b.receive(refundAs('r2', '2026-10-06', 500, 'MADE UP', 'checking'));
    expect(ids(b, 'r2')).toEqual([]);
  });

  it('4.5 A33 with a single purchase on the card, every word it has is on most of them: only the same amount lists it', () => {
    const b = book();
    b.receive(purchase('shoes', '2026-10-01', 4_500, 'MADE UP SHOES'));
    b.receive(refundAs('r1', '2026-10-06', 1_000, 'MADE UP SHOES'));
    expect(ids(b, 'r1')).toEqual([]);
    b.receive(refundAs('r2', '2026-10-06', 4_500, 'MADE UP SHOES'));
    expect(detail(b, 'r2').likelyPurchases).toMatchObject([{ id: 'shoes', sameName: false, sameAmount: true }]);
  });

  it('4.5 A33 a word written twice in one purchase counts once for that purchase', () => {
    const b = book();
    b.receive(purchase('twice', '2026-10-01', 2_000, 'TOWN TOWN BAKERY'));
    b.receive(purchase('deli', '2026-10-02', 2_000, 'CORNER DELI'));
    b.receive(purchase('cafe', '2026-10-03', 2_000, 'BLUE CAFE'));
    b.receive(refundAs('r1', '2026-10-06', 500, 'TOWN'));
    // "town" is on 1 of 3 purchases, not 2 of 3.
    expect(ids(b, 'r1')).toEqual(['twice']);
  });
});

describe('where each item happened, and whether it is pending', () => {
  it('4.6 a pending charge says so, and its account is where it was charged', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-05', 625, 'COFFEE', { pending: true }));
    expect(detail(b, 'pend')).toMatchObject({ account: 'everyday-card', pending: true });
    b.receive(posted('post', 'pend', '2026-10-06', 625, 'COFFEE'));
    expect(detail(b, 'pend')).toMatchObject({ account: 'everyday-card', pending: false });
  });

  it('a deposit says which account it landed in, and one half of a transfer is never in review', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP DEPOSIT', 'savings'));
    expect(detail(b, 'd1').account).toBe('savings');
    b.receive(arrived('a1', '2026-10-05', 5_000, 'checking', 'savings'));
    expect(b.reviewDetails().map((d) => d.item.id)).toEqual(['d1']);
  });

  it('reviewDetails lists exactly what reviewItems lists, in the same order', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-05', 1_150, 'CORNER STORE'));
    b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP DEPOSIT'));
    b.receive(cardCharge('f1', '2026-10-05', 3_500, 'fee'));
    expect(b.reviewDetails().map((d) => d.item)).toEqual(b.reviewItems());
    expect(openTestBook().reviewDetails()).toEqual([]);
  });
});

import type { Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { busyBook } from '../../money/test/busy-book.js';
import { START_DATE, deposit, openTestBook, payPerson, paycheck, posted, purchase, refund, transfer, withdrawal, type TestBookOptions } from '../../money/test/helpers.js';
import { MoneyError } from '@budget-app/money';
import { ChoiceDesk, explainRefusal, parseChoiceRequest } from '../src/choices.js';
import type { ChoiceRequest, ChoiceResponse } from '../src/views/choice.js';

// How a tap reaches the books: the screen sends the choice, the money math
// decides. Sending the same choice twice changes nothing the second time, and
// a refused choice changes nothing and says why. Made-up numbers only.

const TODAY = '2026-10-20';

function setup(options: TestBookOptions = {}): { book: Book; desk: ChoiceDesk } {
  const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000 }, ...options });
  return { book, desk: new ChoiceDesk(book, () => TODAY) };
}

let counter = 0;
function ask(over: Partial<ChoiceRequest> & Pick<ChoiceRequest, 'item' | 'choice'>): ChoiceRequest {
  counter += 1;
  return { id: `choice-${String(counter).padStart(6, '0')}`, ...over };
}

function snapshot(b: Book): string {
  return JSON.stringify({ pots: b.pots(), review: b.reviewItems(), log: b.changeLog(), purchases: b.purchases(), rules: b.rules(), debt: b.oldCardDebt(), transit: b.inTransit(), period: b.period(), paychecks: b.paychecks(), mom: b.momSentInMonth('2026-10') });
}

function done(response: ChoiceResponse) {
  if (!response.ok) throw new Error(`refused: ${response.code}: ${response.why}`);
  return response;
}

function refused(response: ChoiceResponse) {
  if (response.ok) throw new Error('expected a refusal');
  return response;
}

describe('the money math decides: a choice does what the book would do', () => {
  it('4.2 sorting a purchase to wants is the same as sorting it in the book', () => {
    const a = setup();
    const b = setup();
    for (const { book } of [a, b]) book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    done(a.desk.decide(ask({ item: 'p1', choice: { to: 'wants' } })));
    b.book.sort('p1', { to: 'wants' }, TODAY);
    expect(snapshot(a.book)).toBe(snapshot(b.book));
    expect(a.book.pots().wants).toBe(30_000 - 1_150);
    expect(a.book.reviewItems()).toEqual([]);
  });

  it('4.4 a split: the parts go where they were sent', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const r = done(desk.decide(ask({ item: 'p1', choice: { split: [{ bucket: 'needs', amount: 400 }, { bucket: 'wants', amount: 750 }] } })));
    expect(book.pots()).toMatchObject({ needs: 50_000 - 400, wants: 30_000 - 750, unsortedOut: 0 });
    expect(r.done.choice).toEqual({ split: [{ bucket: 'needs', amount: 400 }, { bucket: 'wants', amount: 750 }] });
  });

  it('4.4 a split can leave one part as "the rest", worked out by the money math', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const r = done(desk.decide(ask({ item: 'p1', choice: { split: [{ bucket: 'needs', amount: 400 }, { bucket: 'wants', amount: 'rest' }] } })));
    expect(book.pots()).toMatchObject({ needs: 50_000 - 400, wants: 30_000 - 750 });
    // The answer says what the rest came to.
    expect(r.done.choice).toEqual({ split: [{ bucket: 'needs', amount: 400 }, { bucket: 'wants', amount: 750 }] });
  });

  it('7.6 a payment to a person split three ways, with not mine as the rest', () => {
    const { book, desk } = setup();
    book.receive(payPerson('z1', START_DATE, 10_000, 'MADE UP FRIEND'));
    done(desk.decide(ask({ item: 'z1', choice: { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 2_500 }, { bucket: 'not-mine', amount: 'rest' }] } })));
    expect(book.pots()).toMatchObject({ needs: 50_000 - 1_000, wants: 30_000 - 2_500, heldForOthers: -6_500 });
  });

  it('7.6 for mom comes out of the mom reserve and counts toward the month', () => {
    const { book, desk } = setup();
    book.receive(payPerson('z1', START_DATE, 10_000, 'MADE UP AUNT'));
    done(desk.decide(ask({ item: 'z1', choice: { to: 'mom' } })));
    expect(book.pots().momReserve).toBe(140_000);
    expect(book.momSentInMonth('2026-10').sent).toBe(10_000);
  });

  it('6.1 payback into a bucket and not mine', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 5_000, 'MADE UP FRIEND PAYBACK'));
    book.receive(deposit('d2', START_DATE, 7_000, 'MADE UP SOMEONE ELSE'));
    done(desk.decide(ask({ item: 'd1', choice: { to: 'wants' } })));
    done(desk.decide(ask({ item: 'd2', choice: { to: 'not-mine' } })));
    expect(book.pots()).toMatchObject({ wants: 35_000, heldForOthers: 7_000, unsortedIn: 0 });
  });

  it('6.1 other income is split by the percentages, with no mom reserve', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 100_000, 'MADE UP BONUS'));
    done(desk.decide(ask({ item: 'd1', choice: { to: 'other-income' } })));
    expect(book.pots()).toMatchObject({ savings: 150_000, needs: 80_000, wants: 50_000, momReserve: 150_000 });
  });

  it('4.5 B16 a store refund goes back into a bucket, and is not income', () => {
    const { book, desk } = setup();
    book.receive(refund('r1', START_DATE, 2_317, undefined, 'everyday-card'));
    expect(refused(desk.decide(ask({ item: 'r1', choice: { to: 'other-income' } }))).code).toBe('refused');
    done(desk.decide(ask({ item: 'r1', choice: { to: 'wants' } })));
    expect(book.pots().wants).toBe(30_000 + 2_317);
  });

  it('5.6 marking a debit card payment as a transfer between my accounts changes no bucket', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 20_000, 'ONLINE TRANSFER', { account: 'checking' }));
    done(desk.decide(ask({ item: 'p1', choice: { transfer: 'savings' } })));
    expect(book.pots()).toMatchObject({ needs: 50_000, wants: 30_000, unsortedOut: 0 });
    expect(book.inTransit().total).toBe(20_000);
  });

  it('5.2 a payment to the old card from savings comes out of savings once confirmed', () => {
    const { book, desk } = setup();
    book.receive(transfer('t1', START_DATE, 20_000, 'savings', 'old-card'));
    done(desk.decide(ask({ item: 't1', choice: { to: 'savings' } })));
    expect(book.pots().savings).toBe(80_000);
  });

  it('3.4 the leftover answer: move to savings moves it, roll over keeps it', () => {
    const { book, desk } = setup({ lastPaycheckDate: '2026-09-18' });
    book.receive(paycheck('pay', '2026-10-02', 420_000));
    done(desk.decide(ask({ item: 'leftover:pay:needs', choice: { leftover: 'move-to-savings' }, confirmed: true })));
    done(desk.decide(ask({ item: 'leftover:pay:wants', choice: { leftover: 'roll-over' }, confirmed: true })));
    expect(book.reviewItems()).toEqual([]);
    // Needs started at 500.00 and 810.00 came in; the 500.00 leftover went to savings.
    expect(book.pots()).toMatchObject({ needs: 81_000, wants: 30_000 + 54_000 });
    expect(book.startedPeriodWith().needs).toBe(81_000);
  });

  it('5.4 a flag on the old card is cleared by seeing it, and no money moves', () => {
    const { book, desk } = setup();
    book.receive(purchase('o1', START_DATE, 8_000, 'FURNITURE', { account: 'old-card' }));
    const before = book.pots();
    done(desk.decide(ask({ item: 'o1', choice: { acknowledge: true } })));
    expect(book.reviewItems()).toEqual([]);
    expect(book.pots()).toEqual(before);
    expect(book.oldCardDebt()).toBe(8_000);
  });
});

describe('6.1 B52 anything final asks first', () => {
  it('6.1 "this is my paycheck" is not done until it is confirmed, and nothing changes', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 420_000, 'MADE UP NEW JOB'));
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'd1', choice: { to: 'paycheck' } })));
    expect(r.code).toBe('needs-confirmation');
    expect(r.why).toMatch(/OK/);
    expect(snapshot(book)).toBe(before);
    expect(refused(desk.decide(ask({ item: 'd1', choice: { to: 'paycheck' }, confirmed: false }))).code).toBe('needs-confirmation');
    done(desk.decide(ask({ item: 'd1', choice: { to: 'paycheck' }, confirmed: true })));
    expect(book.paychecks()).toHaveLength(1);
    expect(book.reviewItems().map((i) => i.type)).toEqual(['leftover', 'leftover']);
  });

  it('3.4 a leftover answer is final, so it asks first, both ways', () => {
    const { book, desk } = setup({ lastPaycheckDate: '2026-09-18' });
    book.receive(paycheck('pay', '2026-10-02', 420_000));
    const before = snapshot(book);
    for (const leftover of ['roll-over', 'move-to-savings'] as const) {
      expect(refused(desk.decide(ask({ item: 'leftover:pay:needs', choice: { leftover } }))).code).toBe('needs-confirmation');
    }
    expect(snapshot(book)).toBe(before);
  });

  it('13.6 "always do this" makes a standing rule, so it asks first', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const before = snapshot(book);
    expect(refused(desk.decide(ask({ item: 'p1', choice: { to: 'wants' }, always: { contains: 'CORNER STORE' } }))).code).toBe('needs-confirmation');
    expect(snapshot(book)).toBe(before);
  });

  it('4.7 nothing else asks first: sorting can always be done again', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    book.receive(deposit('d1', START_DATE, 5_000, 'MADE UP GIFT'));
    done(desk.decide(ask({ item: 'p1', choice: { to: 'wants' } })));
    done(desk.decide(ask({ item: 'd1', choice: { to: 'other-income' } })));
  });
});

describe('sending the same choice twice changes nothing the second time', () => {
  it('a retry with the same decision number gets the same answer and changes nothing', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const request = ask({ item: 'p1', choice: { to: 'wants' } });
    const first = done(desk.decide(request));
    expect(first.replayed).toBe(false);
    const after = snapshot(book);
    const second = done(desk.decide(request));
    expect(second.replayed).toBe(true);
    expect(second.done).toEqual(first.done);
    expect(snapshot(book)).toBe(after);
    expect(book.pots().wants).toBe(30_000 - 1_150);
  });

  it('a retry is the same however the request was written down', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    done(desk.decide({ id: 'same-decision', item: 'p1', choice: { split: [{ bucket: 'needs', amount: 400 }, { bucket: 'wants', amount: 750 }] } }));
    const after = snapshot(book);
    const again = done(desk.decide({ choice: { split: [{ amount: 400, bucket: 'needs' }, { amount: 750, bucket: 'wants' }] }, item: 'p1', id: 'same-decision' }));
    expect(again.replayed).toBe(true);
    expect(snapshot(book)).toBe(after);
  });

  it('a double tap with two different decision numbers: the second finds it already dealt with', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    done(desk.decide(ask({ item: 'p1', choice: { to: 'wants' } })));
    const after = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'p1', choice: { to: 'wants' } })));
    expect(r.code).toBe('not-waiting');
    expect(snapshot(book)).toBe(after);
  });

  it('"always do this" twice makes one rule, not two', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const request = ask({ item: 'p1', choice: { to: 'wants' }, always: { contains: 'CORNER STORE' }, confirmed: true });
    done(desk.decide(request));
    done(desk.decide(request));
    refused(desk.decide({ ...request, id: 'another-decision-number' }));
    expect(book.rules().filter((r) => r.contains === 'CORNER STORE')).toHaveLength(1);
    expect(book.changeLog().filter((e) => e.kind === 'rule-added-from-correction')).toHaveLength(1);
  });

  it('"this is my paycheck" twice starts one pay period', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 420_000, 'MADE UP NEW JOB'));
    const request = ask({ item: 'd1', choice: { to: 'paycheck' }, confirmed: true });
    done(desk.decide(request));
    done(desk.decide(request));
    refused(desk.decide(ask({ item: 'd1', choice: { to: 'paycheck' }, confirmed: true })));
    expect(book.paychecks()).toHaveLength(1);
    expect(book.period().number).toBe(1);
  });

  it('a leftover answer twice moves the money once', () => {
    const { book, desk } = setup({ lastPaycheckDate: '2026-09-18' });
    book.receive(paycheck('pay', '2026-10-02', 420_000));
    const request = ask({ item: 'leftover:pay:needs', choice: { leftover: 'move-to-savings' }, confirmed: true });
    done(desk.decide(request));
    const after = snapshot(book);
    done(desk.decide(request));
    refused(desk.decide(ask({ item: 'leftover:pay:needs', choice: { leftover: 'move-to-savings' }, confirmed: true })));
    expect(snapshot(book)).toBe(after);
    expect(book.pots().savings).toBe(100_000 + 135_000 + 50_000);
  });

  it('the same decision number for a different choice is refused, and changes nothing', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    book.receive(purchase('p2', START_DATE, 1_150, 'CORNER STORE'));
    done(desk.decide({ id: 'decision-one', item: 'p1', choice: { to: 'wants' } }));
    const after = snapshot(book);
    expect(refused(desk.decide({ id: 'decision-one', item: 'p2', choice: { to: 'wants' } })).code).toBe('id-reused');
    expect(refused(desk.decide({ id: 'decision-one', item: 'p1', choice: { to: 'needs' } })).code).toBe('id-reused');
    expect(snapshot(book)).toBe(after);
  });

  it('a refused choice can be sent again with the same decision number once it is fixed', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 420_000, 'MADE UP NEW JOB'));
    const request = ask({ item: 'd1', choice: { to: 'paycheck' } });
    expect(refused(desk.decide(request)).code).toBe('needs-confirmation');
    done(desk.decide({ ...request, confirmed: true }));
    expect(book.paychecks()).toHaveLength(1);
  });

  it('every kind of item in the busy book: asking twice leaves the book as the first time left it', () => {
    for (const detail of busyBook().reviewDetails()) {
      const book = busyBook();
      const desk = new ChoiceDesk(book, () => TODAY);
      const o = detail.options;
      const choice: ChoiceRequest['choice'] =
        o.type === 'leftover' ? { leftover: 'roll-over' } : o.type === 'acknowledge' ? { acknowledge: true } : { to: (o.picks.find((p) => !p.final) ?? o.picks[0])!.to };
      const request = ask({ item: detail.item.id, choice, confirmed: true });
      const first = desk.decide(request);
      const after = snapshot(book);
      const second = desk.decide(request);
      expect(second.ok, `${detail.item.id}`).toBe(first.ok);
      expect(snapshot(book), `${detail.item.id}`).toBe(first.ok ? after : snapshot(busyBook()));
      if (first.ok) expect(second.ok && second.replayed).toBe(true);
    }
  });
});

describe('a refused choice changes nothing and says why', () => {
  it('4.4 a split that does not add up is refused, in dollars and cents', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'p1', choice: { split: [{ bucket: 'needs', amount: 400 }, { bucket: 'wants', amount: 700 }] } })));
    expect(r.code).toBe('refused');
    expect(r.why).toContain('$11.00');
    expect(r.why).toContain('$11.50');
    expect(r.why).toContain('Nothing was changed');
    expect(snapshot(book)).toBe(before);
  });

  it('4.4 "the rest" with nothing left, or less than nothing, is refused', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const before = snapshot(book);
    const none = refused(desk.decide(ask({ item: 'p1', choice: { split: [{ bucket: 'needs', amount: 1_150 }, { bucket: 'wants', amount: 'rest' }] } })));
    expect(none.why).toContain('Wants');
    expect(none.why).toContain('$11.50');
    const less = refused(desk.decide(ask({ item: 'p1', choice: { split: [{ bucket: 'needs', amount: 2_000 }, { bucket: 'wants', amount: 'rest' }] } })));
    expect(less.why).toContain('$20.00');
    expect(snapshot(book)).toBe(before);
  });

  it('B54 a deposit older than the last paycheck cannot be my paycheck, and the answer says why', () => {
    const { book, desk } = setup({ lastPaycheckDate: '2026-09-25' });
    book.receive(deposit('old', '2026-09-20', 25_000, 'MADE UP LATE ARRIVAL'));
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'old', choice: { to: 'paycheck' }, confirmed: true })));
    expect(r.code).toBe('refused');
    expect(r.why).toContain('older than your last paycheck');
    expect(snapshot(book)).toBe(before);
  });

  it('5.6 B74 a pending purchase cannot be marked a transfer, and the answer says to wait', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE', { account: 'checking', pending: true }));
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'p1', choice: { transfer: 'savings' } })));
    expect(r.why).toContain('pending');
    expect(snapshot(book)).toBe(before);
    book.receive(posted('p2', 'p1', START_DATE, 1_150, 'CORNER STORE', 'checking'));
    done(desk.decide(ask({ item: 'p1', choice: { transfer: 'savings' } })));
  });

  it('13.6 B49 a rule whose text does not match the item is refused, and no rule is made', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'p1', choice: { to: 'wants' }, always: { contains: 'SOMETHING ELSE' }, confirmed: true })));
    expect(r.why).toContain('SOMETHING ELSE');
    expect(snapshot(book)).toBe(before);
    expect(book.rules()).toEqual([]);
  });

  it('4.9 13.6 money out of savings cannot get a rule', () => {
    const { book, desk } = setup();
    book.receive(withdrawal('w1', START_DATE, 6_410, 'BILL PAY WATER'));
    const before = snapshot(book);
    expect(refused(desk.decide(ask({ item: 'w1', choice: { to: 'needs' }, always: { contains: 'WATER' }, confirmed: true }))).code).toBe('refused');
    expect(snapshot(book)).toBe(before);
  });


  it('B55 B17 4.9 13.6 a rule that cannot be made says so, rather than something the book said', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 420_000, 'MADE UP NEW JOB'));
    book.receive(withdrawal('w1', START_DATE, 6_410, 'BILL PAY WATER'));
    const paycheckRule = refused(desk.decide(ask({ item: 'd1', choice: { to: 'paycheck' }, always: { contains: 'NEW JOB' }, confirmed: true })));
    expect(paycheckRule.why).toBe("A rule can't do that for this item. Nothing was changed.");
    const savingsRule = refused(desk.decide(ask({ item: 'w1', choice: { to: 'needs' }, always: { contains: 'WATER' }, confirmed: true })));
    expect(savingsRule.why).toBe("A rule can't do that for this item. Nothing was changed.");
  });

  it('a rule cannot split or mark a transfer', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE', { account: 'checking' }));
    for (const choice of [{ split: [{ bucket: 'needs', amount: 400 }, { bucket: 'wants', amount: 'rest' }] }, { transfer: 'savings' }] as ChoiceRequest['choice'][]) {
      expect(refused(desk.decide(ask({ item: 'p1', choice, always: { contains: 'CORNER STORE' }, confirmed: true }))).why).toBe("A rule can't do that for this item. Nothing was changed.");
    }
  });

  it('7.8 a deposit split at the desk: the rest is worked out, and sorted again the same way changes nothing', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 14_000, 'MADE UP ATM DEPOSIT'));
    const before = book.pots();
    const answer = desk.decide(ask({ id: 'split-one', item: 'd1', choice: { split: [{ bucket: 'not-mine', amount: 12_500 }, { bucket: 'wants', amount: 'rest' }] } }));
    expect(answer.ok).toBe(true);
    expect(book.pots().heldForOthers).toBe(before.heldForOthers + 12_500);
    expect(book.pots().wants).toBe(before.wants + 1_500);
    const again = refused(desk.decide(ask({ id: 'split-two', item: 'd1', resort: true, choice: { split: [{ bucket: 'not-mine', amount: 12_500 }, { bucket: 'wants', amount: 'rest' }] } })));
    expect(again.why).toContain('split that way');
    const moved = desk.decide(ask({ id: 'split-three', item: 'd1', resort: true, choice: { split: [{ bucket: 'savings', amount: 1 }, { bucket: 'wants', amount: 'rest' }] } }));
    expect(moved.ok).toBe(true);
    expect(book.pots()).toMatchObject({ heldForOthers: before.heldForOthers, savings: before.savings + 1, wants: before.wants + 13_999 });
  });

  it('7.8 a split with nothing left for the rest, or more than the deposit, is refused, and says so', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 14_000));
    expect(refused(desk.decide(ask({ item: 'd1', choice: { split: [{ bucket: 'not-mine', amount: 14_000 }, { bucket: 'wants', amount: 'rest' }] } }))).why).toContain('Nothing is left for Wants');
    expect(refused(desk.decide(ask({ item: 'd1', choice: { split: [{ bucket: 'not-mine', amount: 14_001 }, { bucket: 'wants', amount: 'rest' }] } }))).why).toContain('more than');
    expect(book.reviewItems()).toHaveLength(1);
  });

  it('a split of a kind the item does not offer is refused, and says so', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    book.receive(purchase('one', START_DATE, 1, 'TINY'));
    expect(refused(desk.decide(ask({ item: 'p1', choice: { split: [{ bucket: 'needs', amount: 400 }, { bucket: 'savings', amount: 'rest' }] } }))).why).toBe("This one can't be split that way. Nothing was changed.");
    expect(refused(desk.decide(ask({ item: 'one', choice: { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: 'rest' }] } }))).why).toBe("This one can't be split. Nothing was changed.");
  });

  it('the words that say what an id was never cut the reason into pieces: short ids are left alone', () => {
    const { book } = setup();
    book.receive(payPerson('a', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(payPerson('b', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(refund('c', START_DATE, 1_000, 'b', 'checking'));
    expect(explainRefusal(new MoneyError('bad-choice', 'b cannot be for mom: part of it was refunded'), book.reviewDetails())).toBe('B cannot be for mom: part of it was refunded');
  });

  it('the words that say what an id was name a waiting item by its description', () => {
    const { book } = setup();
    book.receive(payPerson('zel_aabbccddee', START_DATE, 4_000, 'MADE UP FRIEND'));
    expect(explainRefusal(new MoneyError('bad-choice', 'zel_aabbccddee cannot be for mom: part of it was refunded'), book.reviewDetails())).toBe('"ZELLE TO MADE UP FRIEND" cannot be for mom: part of it was refunded');
  });

  it('a choice that is not one of the choices for that kind of item is refused', () => {
    const { book, desk } = setup({ lastPaycheckDate: '2026-09-18' });
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    book.receive(paycheck('pay', '2026-10-02', 420_000));
    book.receive(purchase('o1', START_DATE, 8_000, 'FURNITURE', { account: 'old-card' }));
    const before = snapshot(book);
    for (const [item, choice] of [
      ['p1', { to: 'savings' }],
      ['p1', { to: 'paycheck' }],
      ['p1', { to: 'mom' }],
      ['o1', { to: 'not-mine' }],
      ['p1', { leftover: 'roll-over' }],
      ['p1', { acknowledge: true }],
      ['p1', { transfer: 'everyday-card' }],
      ['leftover:pay:needs', { to: 'needs' }],
      ['leftover:pay:needs', { acknowledge: true }],
      ['o1', { to: 'needs' }],
      ['o1', { leftover: 'roll-over' }],
    ] as [string, ChoiceRequest['choice']][]) {
      const r = refused(desk.decide(ask({ item, choice, confirmed: true })));
      expect(r.code, `${item} ${JSON.stringify(choice)}`).toBe('refused');
      expect(r.why).toContain('Nothing was changed');
    }
    expect(snapshot(book)).toBe(before);
  });

  it('an item that is not waiting, or never was, is refused', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const before = snapshot(book);
    expect(refused(desk.decide(ask({ item: 'nothing-like-this', choice: { to: 'wants' } }))).code).toBe('not-waiting');
    expect(snapshot(book)).toBe(before);
  });

  it('0.1 a total too large to stay exact is refused and says so in plain words', () => {
    const big = Number.MAX_SAFE_INTEGER - 1_000;
    const { book, desk } = setup({ pots: { wants: big } });
    book.receive(deposit('d1', START_DATE, 5_000, 'MADE UP GIFT'));
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'd1', choice: { to: 'wants' } })));
    expect(r.why).toBe('That would make a total too large to keep exact. Nothing was changed.');
    expect(snapshot(book)).toBe(before);
  });

  it('the reason never shows an internal id, raw cents, or code', () => {
    const idLike = 'txn_8f3a2c9d1b7e';
    const { book, desk } = setup({ lastPaycheckDate: '2026-09-25' });
    book.receive(deposit(idLike, '2026-09-20', 25_000, 'MADE UP LATE ARRIVAL'));
    book.receive(purchase('pur_77aa11bb22cc', START_DATE, 1_150, 'CORNER STORE', { account: 'checking', pending: true }));
    book.receive(payPerson('zel_5566778899', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(payPerson('zel_aabbccddee', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(refund('ref_1', START_DATE, 1_000, 'zel_aabbccddee', 'checking'));
    const why: string[] = [];
    for (const request of [
      ask({ item: idLike, choice: { to: 'paycheck' }, confirmed: true }),
      ask({ item: 'pur_77aa11bb22cc', choice: { transfer: 'savings' } }),
      ask({ item: 'pur_77aa11bb22cc', choice: { split: [{ bucket: 'needs', amount: 5 }, { bucket: 'wants', amount: 5 }] } }),
      ask({ item: 'zel_5566778899', choice: { refundOf: 'pur_77aa11bb22cc' }, confirmed: true }),
      ask({ item: 'pur_77aa11bb22cc', choice: { to: 'wants' }, always: { contains: 'NOT THERE' }, confirmed: true }),
    ]) {
      why.push(refused(desk.decide(request)).why);
    }
    for (const text of why) {
      expect(text, text).not.toMatch(/txn_|pur_|zel_|ref_|\{|\}|\[object|undefined|NaN/);
      expect(text, text).toMatch(/\.$/);
    }
  });
});

describe('13.6 "always do this"', () => {
  it('13.6 the rule goes in, the item is sorted, and the answer says it will stick', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE #12'));
    const r = done(desk.decide(ask({ item: 'p1', choice: { to: 'wants' }, always: { contains: 'CORNER STORE' }, confirmed: true })));
    expect(r.done.sticks).toBe(true);
    expect(book.rules()).toMatchObject([{ for: 'purchase', contains: 'CORNER STORE', bucket: 'wants' }]);
    expect(book.pots().wants).toBe(30_000 - 1_150);
    // The next one goes where the rule says.
    expect(book.receive(purchase('p2', START_DATE, 200, 'CORNER STORE #12')).outcome).toBe('sorted');
  });

  it('13.2 other waiting items the rule matches are sorted too, and the answer counts them', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE #12'));
    book.receive(purchase('p2', START_DATE, 400, 'CORNER STORE #9'));
    book.receive(purchase('p3', START_DATE, 600, 'CORNER STORE #3'));
    book.receive(purchase('p4', START_DATE, 900, 'SOMETHING ELSE'));
    const r = done(desk.decide(ask({ item: 'p1', choice: { to: 'wants' }, always: { contains: 'CORNER STORE' }, confirmed: true })));
    expect(r.done.alsoSorted).toBe(2);
    expect(book.reviewItems().map((i) => i.id)).toEqual(['p4']);
  });

  it('13.6 B49 text that matches only how it posted will not catch the next one while pending, and the answer says so', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'POS DEBIT 4412', { account: 'checking', pending: true }));
    book.receive(posted('p2', 'p1', START_DATE, 1_150, 'CORNER STORE #12', 'checking'));
    const r = done(desk.decide(ask({ item: 'p1', choice: { to: 'wants' }, always: { contains: 'CORNER STORE' }, confirmed: true })));
    expect(r.done.sticks).toBe(false);
  });

  it('13.6 without "always do this" the answer has no sticks, and counts no one else', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE #12'));
    book.receive(purchase('p2', START_DATE, 400, 'CORNER STORE #9'));
    const r = done(desk.decide(ask({ item: 'p1', choice: { to: 'wants' } })));
    expect(r.done.sticks).toBeNull();
    expect(r.done.alsoSorted).toBe(0);
    expect(book.reviewItems().map((i) => i.id)).toEqual(['p2']);
  });

  it('13.6 a rule for a person, and a rule for a deposit', () => {
    const { book, desk } = setup();
    book.receive(payPerson('z1', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(deposit('d1', START_DATE, 5_000, 'MADE UP FRIEND PAYBACK'));
    done(desk.decide(ask({ item: 'z1', choice: { to: 'not-mine' }, always: { contains: 'MADE UP FRIEND' }, confirmed: true })));
    done(desk.decide(ask({ item: 'd1', choice: { to: 'other-income' }, always: { contains: 'PAYBACK' }, confirmed: true })));
    expect(book.rules().map((r) => r.for).sort()).toEqual(['deposit', 'person']);
  });

  it('B55 B17 "this is my paycheck" cannot become a rule', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 420_000, 'MADE UP NEW JOB'));
    const before = snapshot(book);
    expect(refused(desk.decide(ask({ item: 'd1', choice: { to: 'paycheck' }, always: { contains: 'NEW JOB' }, confirmed: true }))).code).toBe('refused');
    expect(snapshot(book)).toBe(before);
  });
});

describe('QUESTIONS.md A19 a rule leaves waiting what it cannot sort, and says which', () => {
  it('A19 13.2 "always do this" sorts this one and the others it can; one that cannot take it stays waiting, by name', () => {
    const { book, desk } = setup();
    book.receive(payPerson('zel_first_0001', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(payPerson('zel_second_0002', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(payPerson('zel_third_0004', START_DATE, 2_500, 'MADE UP FRIEND'));
    book.receive(refund('ref_part_0003', START_DATE, 1_000, 'zel_second_0002', 'checking'));
    const twin = setup().book;
    twin.receive(payPerson('zel_first_0001', START_DATE, 4_000, 'MADE UP FRIEND'));
    twin.receive(payPerson('zel_second_0002', START_DATE, 4_000, 'MADE UP FRIEND'));
    twin.receive(payPerson('zel_third_0004', START_DATE, 2_500, 'MADE UP FRIEND'));
    twin.receive(refund('ref_part_0003', START_DATE, 1_000, 'zel_second_0002', 'checking'));
    const request = ask({ item: 'zel_first_0001', choice: { to: 'mom' }, always: { contains: 'MADE UP FRIEND' }, confirmed: true });
    const r = done(desk.decide(request));
    expect(r.done.alsoSorted).toBe(1);
    expect(r.done.stillWaiting).toEqual([{ item: 'zel_second_0002', name: 'ZELLE TO MADE UP FRIEND' }]);
    expect(book.reviewItems().map((i) => i.id)).toEqual(['zel_second_0002']);
    expect(book.pots().momReserve).toBe(150_000 - 6_500);
    // The same as the book on its own.
    twin.sortAlways('zel_first_0001', { to: 'mom' }, { id: `always-${request.id}`, contains: 'MADE UP FRIEND' }, TODAY);
    expect(snapshot(book)).toBe(snapshot(twin));
    // A repeat says the same and changes nothing.
    const after = snapshot(book);
    const again = done(desk.decide(request));
    expect(again.replayed).toBe(true);
    expect(again.done.stillWaiting).toEqual(r.done.stillWaiting);
    expect(snapshot(book)).toBe(after);
  });

  it('A19 with nothing left waiting, or without "always do this", the list is empty', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE #12'));
    book.receive(purchase('p2', START_DATE, 400, 'CORNER STORE #9'));
    book.receive(purchase('p3', START_DATE, 400, 'SOMETHING ELSE'));
    expect(done(desk.decide(ask({ item: 'p3', choice: { to: 'wants' } }))).done.stillWaiting).toEqual([]);
    expect(done(desk.decide(ask({ item: 'p1', choice: { to: 'wants' }, always: { contains: 'CORNER STORE' }, confirmed: true }))).done.stillWaiting).toEqual([]);
  });

  it('A19 "always do this" for an item that itself cannot take it is refused, and nothing changes', () => {
    const { book, desk } = setup();
    book.receive(payPerson('zel_first_0001', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(payPerson('zel_second_0002', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(refund('ref_part_0003', START_DATE, 1_000, 'zel_second_0002', 'checking'));
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'zel_second_0002', choice: { to: 'mom' }, always: { contains: 'MADE UP FRIEND' }, confirmed: true })));
    expect(r.code).toBe('refused');
    expect(r.why).not.toMatch(/zel_/);
    expect(snapshot(book)).toBe(before);
  });
});

describe('QUESTIONS.md A18 4.5 "this refund is for this one"', () => {
  // A refund the bank did not match, with two purchases it could be for.
  function refundBook() {
    const made = setup();
    made.book.receive(purchase('pur_shoes_0001', START_DATE, 6_000, 'MADE UP SHOE SHOP'));
    made.book.sort('pur_shoes_0001', { to: 'wants' }, TODAY);
    made.book.receive(purchase('pur_mixed_0002', START_DATE, 5_000, 'MADE UP SHOE SHOP'));
    made.book.sort('pur_mixed_0002', { split: [{ bucket: 'needs', amount: 2_000 }, { bucket: 'wants', amount: 3_000 }] }, TODAY);
    // Other stores on the card, so the shop's name is not on most purchases
    // (A33). Each is refunded in full, so every bucket is as before.
    for (const [id, name] of [
      ['pur_deli_0004', 'CORNER DELI'],
      ['pur_cafe_0005', 'BLUE CAFE'],
    ] as const) {
      made.book.receive(purchase(id, START_DATE, 300, name));
      made.book.sort(id, { to: 'needs' }, TODAY);
      made.book.receive(refund(`${id}_back`, START_DATE, 300, id, 'everyday-card'));
    }
    made.book.receive(refund('ref_back_0003', '2026-10-10', 5_000, undefined, 'everyday-card'));
    return made;
  }

  it('A18 the purchases offered are the likely ones', () => {
    const { book } = refundBook();
    const detail = book.reviewDetails().find((d) => d.item.id === 'ref_back_0003')!;
    expect(detail.options.type === 'sort' && detail.options.match).toEqual(detail.likelyPurchases.map((p) => p.id));
    expect(detail.likelyPurchases.map((p) => p.id).sort()).toEqual(['pur_mixed_0002', 'pur_shoes_0001']);
  });

  it('A18 it is final, so it asks first, and nothing changes until he says yes', () => {
    const { book, desk } = refundBook();
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'ref_back_0003', choice: { refundOf: 'pur_mixed_0002' } })));
    expect(r.code).toBe('needs-confirmation');
    expect(snapshot(book)).toBe(before);
  });

  it('A18 matched, it counts exactly as if the bank had matched it: a full refund of a split goes back as it was split', () => {
    const { book, desk } = refundBook();
    const twin = refundBook().book;
    const r = done(desk.decide(ask({ item: 'ref_back_0003', choice: { refundOf: 'pur_mixed_0002' }, confirmed: true })));
    expect(r.done.choice).toEqual({ refundOf: 'pur_mixed_0002' });
    expect(r.done.stillWaiting).toEqual([]);
    twin.sort('ref_back_0003', { refundOf: 'pur_mixed_0002' }, TODAY);
    expect(snapshot(book)).toBe(snapshot(twin));
    expect(book.pots()).toMatchObject({ needs: 50_000, wants: 30_000 - 6_000, unsortedIn: 0 });
    expect(book.reviewItems()).toEqual([]);
  });

  it('A18 matched to a purchase in one bucket, it goes back into that bucket', () => {
    const { book, desk } = refundBook();
    done(desk.decide(ask({ item: 'ref_back_0003', choice: { refundOf: 'pur_shoes_0001' }, confirmed: true })));
    expect(book.pots()).toMatchObject({ needs: 50_000 - 2_000, wants: 30_000 - 3_000 - 6_000 + 5_000, unsortedIn: 0 });
  });

  it('A18 sent twice, it is matched once', () => {
    const { book, desk } = refundBook();
    const request = ask({ item: 'ref_back_0003', choice: { refundOf: 'pur_shoes_0001' }, confirmed: true });
    done(desk.decide(request));
    const after = snapshot(book);
    expect(done(desk.decide(request)).replayed).toBe(true);
    expect(refused(desk.decide(ask({ item: 'ref_back_0003', choice: { refundOf: 'pur_shoes_0001' }, confirmed: true }))).code).toBe('not-waiting');
    expect(snapshot(book)).toBe(after);
  });

  it('A18 a purchase that is not offered is refused, in plain words, and nothing changes', () => {
    const { book, desk } = refundBook();
    book.receive(purchase('pur_late_0004', '2026-10-12', 9_000, 'MADE UP SHOE SHOP'));
    book.receive(purchase('pur_debit_0005', START_DATE, 9_000, 'MADE UP SHOE SHOP', { account: 'checking' }));
    book.receive(deposit('dep_gift_0006', START_DATE, 5_000, 'MADE UP GIFT'));
    const before = snapshot(book);
    for (const of of ['pur_late_0004', 'pur_debit_0005', 'nothing-like-this', 'ref_back_0003', 'dep_gift_0006']) {
      const r = refused(desk.decide(ask({ item: 'ref_back_0003', choice: { refundOf: of }, confirmed: true })));
      expect(r.code, of).toBe('refused');
      expect(r.why, of).toBe("That purchase isn't one this refund can belong to. Nothing was changed.");
    }
    expect(snapshot(book)).toBe(before);
  });

  it('A18 a refund with nothing left to match says which reason, not just "not a choice"', () => {
    const { book, desk } = setup();
    book.receive(refund('ref_alone_0008', START_DATE, 5_000, undefined, 'everyday-card'));
    const detail = book.reviewDetails().find((d) => d.item.id === 'ref_alone_0008')!;
    expect(detail.options.type === 'sort' && detail.options.match).toEqual([]);
    const before = snapshot(book);
    expect(refused(desk.decide(ask({ item: 'ref_alone_0008', choice: { refundOf: 'pur_gone_0009' }, confirmed: true }))).why).toBe("That purchase isn't one this refund can belong to. Nothing was changed.");
    expect(snapshot(book)).toBe(before);
  });

  it('A18 only a refund can be matched, and a rule cannot match one', () => {
    const { book, desk } = refundBook();
    book.receive(deposit('dep_gift_0006', START_DATE, 5_000, 'MADE UP GIFT'));
    book.receive(purchase('pur_new_0007', START_DATE, 1_000, 'MADE UP SHOE SHOP'));
    const before = snapshot(book);
    expect(refused(desk.decide(ask({ item: 'dep_gift_0006', choice: { refundOf: 'pur_shoes_0001' }, confirmed: true }))).why).toBe("That isn't one of the choices for this item. Nothing was changed.");
    expect(refused(desk.decide(ask({ item: 'pur_new_0007', choice: { refundOf: 'pur_shoes_0001' }, confirmed: true }))).why).toBe("That isn't one of the choices for this item. Nothing was changed.");
    expect(refused(desk.decide(ask({ item: 'ref_back_0003', choice: { refundOf: 'pur_shoes_0001' }, always: { contains: 'MADE UP' }, confirmed: true }))).why).toBe("A rule can't do that for this item. Nothing was changed.");
    expect(snapshot(book)).toBe(before);
  });
});

describe('parsing what the phone sends', () => {
  const good = { id: 'abcd1234', item: 'p1', choice: { to: 'wants' } };

  it('a request of exactly the right shape is read', () => {
    expect(parseChoiceRequest(good)).toEqual(good);
    expect(parseChoiceRequest({ ...good, always: { contains: ' CORNER STORE ' }, confirmed: true })).toEqual({ ...good, always: { contains: 'CORNER STORE' }, confirmed: true });
    expect(parseChoiceRequest({ ...good, choice: { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: 'rest' }] } })).not.toBeNull();
    // 7.8: all four parts of a deposit's split.
    const allFour = { split: [{ bucket: 'not-mine', amount: 1 }, { bucket: 'savings', amount: 2 }, { bucket: 'needs', amount: 3 }, { bucket: 'wants', amount: 'rest' }] };
    expect(parseChoiceRequest({ ...good, choice: allFour })).toEqual({ ...good, choice: allFour });
    expect(parseChoiceRequest({ ...good, choice: { transfer: 'savings' } })).not.toBeNull();
    expect(parseChoiceRequest({ ...good, item: 'leftover:pay:needs', choice: { leftover: 'roll-over' } })).not.toBeNull();
    expect(parseChoiceRequest({ ...good, choice: { acknowledge: true } })).not.toBeNull();
    expect(parseChoiceRequest({ ...good, choice: { refundOf: 'pur_1' } })).toEqual({ ...good, choice: { refundOf: 'pur_1' } });
    for (const to of ['paycheck', 'other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine', 'mom']) expect(parseChoiceRequest({ ...good, choice: { to } }), to).not.toBeNull();
  });

  it('the longest and shortest that are allowed are read, and one more or one less is not', () => {
    const at = (over: object): unknown => parseChoiceRequest({ ...good, ...over });
    expect(at({ id: 'x'.repeat(8) })).not.toBeNull();
    expect(at({ id: 'x'.repeat(64) })).not.toBeNull();
    expect(at({ id: 'x'.repeat(7) })).toBeNull();
    expect(at({ id: 'x'.repeat(65) })).toBeNull();
    expect(at({ item: 'x'.repeat(200) })).not.toBeNull();
    expect(at({ item: 'x'.repeat(201) })).toBeNull();
    expect(at({ always: { contains: 'x'.repeat(200) } })).not.toBeNull();
    expect(at({ always: { contains: 'x'.repeat(201) } })).toBeNull();
    expect(at({ choice: { refundOf: 'x' } })).not.toBeNull();
    expect(at({ choice: { refundOf: 'x'.repeat(200) } })).not.toBeNull();
    expect(at({ choice: { refundOf: 'x'.repeat(201) } })).toBeNull();
    expect(at({ choice: { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: Number.MAX_SAFE_INTEGER }] } })).not.toBeNull();
    expect(at({ choice: { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: 1 }, { bucket: 'not-mine', amount: 'rest' }] } })).not.toBeNull();
  });

  it('anything else is not read', () => {
    const bad: unknown[] = [
      null,
      'wants',
      [],
      {},
      { ...good, id: '' },
      { ...good, id: 'short' },
      { ...good, id: 'has spaces in it' },
      { ...good, id: 'x'.repeat(65) },
      { ...good, id: 12345678 },
      { ...good, item: '' },
      { ...good, item: 7 },
      { ...good, item: 'x'.repeat(201) },
      { ...good, extra: true },
      { ...good, choice: undefined },
      { ...good, choice: {} },
      { ...good, choice: { to: 'groceries' } },
      { ...good, choice: { to: 'wants', split: [] } },
      { ...good, choice: { to: 'wants', extra: 1 } },
      { ...good, choice: { transfer: 'mattress' } },
      { ...good, choice: { leftover: 'burn' } },
      { ...good, choice: { acknowledge: false } },
      { ...good, choice: { refundOf: '' } },
      { ...good, choice: { refundOf: 7 } },
      { ...good, choice: { refundOf: null } },
      { ...good, choice: { refundOf: ['pur_1'] } },
      { ...good, choice: { refundOf: 'pur_1', to: 'wants' } },
      { ...good, choice: { split: [] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: 5 }] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: 0 }, { bucket: 'wants', amount: 5 }] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: -5 }, { bucket: 'wants', amount: 5 }] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: 1.5 }, { bucket: 'wants', amount: 5 }] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: '5' }, { bucket: 'wants', amount: 5 }] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: Number.MAX_SAFE_INTEGER + 2 }, { bucket: 'wants', amount: 5 }] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: 5 }, { bucket: 'needs', amount: 5 }] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: 'rest' }, { bucket: 'wants', amount: 'rest' }] } },
      { ...good, choice: { split: [{ bucket: 'momReserve', amount: 5 }, { bucket: 'wants', amount: 5 }] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: 1 }, { bucket: 'not-mine', amount: 1 }, { bucket: 'needs', amount: 1 }] } },
      { ...good, choice: { split: [{ bucket: 'needs', amount: 5, extra: 1 }, { bucket: 'wants', amount: 5 }] } },
      { ...good, always: {} },
      { ...good, always: { contains: '' } },
      { ...good, always: { contains: '   ' } },
      { ...good, always: { contains: 'x'.repeat(201) } },
      { ...good, always: { contains: 'a', extra: 1 } },
      { ...good, always: 'CORNER' },
      { ...good, confirmed: 'yes' },
      { ...good, confirmed: 1 },
    ];
    for (const value of bad) expect(parseChoiceRequest(value), JSON.stringify(value)).toBeNull();
  });
});

describe('the busy book: every offered choice, through the desk, does what the book does', () => {
  it('6.1 4.4 4.5 5.6 7.6 13.6 A18 every offered pick, transfer, match, and leftover answer', () => {
    const problems: string[] = [];
    for (const detail of busyBook().reviewDetails()) {
      const o = detail.options;
      const choices: ChoiceRequest['choice'][] =
        o.type === 'leftover'
          ? o.answers.map((leftover) => ({ leftover }))
          : o.type === 'acknowledge'
            ? [{ acknowledge: true }]
            : [...o.picks.map((p) => ({ to: p.to })), ...o.transfer.map((transfer) => ({ transfer })), ...o.match.map((refundOf) => ({ refundOf }))];
      for (const choice of choices) {
        const viaDesk = busyBook();
        const direct = busyBook();
        const r = new ChoiceDesk(viaDesk, () => TODAY).decide(ask({ item: detail.item.id, choice, confirmed: true }));
        try {
          if ('leftover' in choice) direct.answerLeftover(detail.item.id, choice.leftover, TODAY);
          else if ('acknowledge' in choice) direct.acknowledge(detail.item.id, TODAY);
          else direct.sort(detail.item.id, 'transfer' in choice ? { transfer: choice.transfer } : 'refundOf' in choice ? { refundOf: choice.refundOf } : { to: (choice as { to: never }).to }, TODAY);
        } catch (error) {
          problems.push(`${detail.item.id} ${JSON.stringify(choice)}: the book refused it (${String(error)}) but it was offered`);
          continue;
        }
        if (!r.ok) problems.push(`${detail.item.id} ${JSON.stringify(choice)}: the desk refused it: ${r.why}`);
        else if (snapshot(viaDesk) !== snapshot(direct)) problems.push(`${detail.item.id} ${JSON.stringify(choice)}: the desk and the book disagree`);
        else if (JSON.stringify(viaDesk.recountPots()) !== JSON.stringify(viaDesk.pots())) problems.push(`${detail.item.id} ${JSON.stringify(choice)}: the buckets do not recount`);
      }
    }
    expect(problems).toEqual([]);
  });
});

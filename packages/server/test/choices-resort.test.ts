import { MOVABLE_POTS, type Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { SORTED, sortedBook } from '../../money/test/sorted-book.js';
import { MOM_NAME, START_DATE, deposit, openTestBook, payPerson, paycheck, purchase, refund, takenBack, transfer } from '../../money/test/helpers.js';
import { ChoiceDesk, parseChoiceRequest } from '../src/choices.js';
import type { ChoiceRequest, ChoiceResponse } from '../src/views/choice.js';

// Sorting something again from the list of what went in and out of a bucket
// (rule 4.7, 13.6; QUESTIONS.md B100 to B102). The tap reaches the books the
// same way a tap in Review does: the money math decides, a repeat changes
// nothing, a refusal changes nothing and says why. The request says
// resort: true, so it can only ever change something already sorted.

const TODAY = '2026-10-20';
const RULES = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
] as const;

function setup(): { book: Book; desk: ChoiceDesk } {
  const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000 }, rules: RULES });
  return { book, desk: new ChoiceDesk(book, () => TODAY) };
}

let counter = 0;
function ask(over: Partial<ChoiceRequest> & Pick<ChoiceRequest, 'item' | 'choice'>): ChoiceRequest {
  counter += 1;
  return { id: `resort-${String(counter).padStart(6, '0')}`, resort: true, ...over };
}

function snapshot(b: Book): string {
  return JSON.stringify({ pots: b.pots(), review: b.reviewItems(), log: b.changeLog(), purchases: b.purchases(), rules: b.rules(), debt: b.oldCardDebt(), transit: b.inTransit(), period: b.period(), paychecks: b.paychecks(), lists: MOVABLE_POTS.map((pot) => b.activity(pot)) });
}

function done(response: ChoiceResponse) {
  if (!response.ok) throw new Error(`refused: ${response.code}: ${response.why}`);
  return response;
}

function refused(response: ChoiceResponse) {
  if (response.ok) throw new Error('expected a refusal');
  return response;
}

describe('4.7 B100 a tap on an item in a bucket\'s list sorts it again, the way the book would', () => {
  it('4.7 sorting a purchase from needs to wants is what the book does, and the buckets change right away', () => {
    const a = setup();
    const b = setup();
    for (const { book } of [a, b]) book.receive(purchase('g1', START_DATE, 3_250, 'MADE UP GROCERY'));
    expect(a.book.pots()).toMatchObject({ needs: 50_000 - 3_250, wants: 30_000 });
    done(a.desk.decide(ask({ item: 'g1', choice: { to: 'wants' } })));
    b.book.sort('g1', { to: 'wants' }, TODAY);
    expect(snapshot(a.book)).toBe(snapshot(b.book));
    expect(a.book.pots()).toMatchObject({ needs: 50_000, wants: 30_000 - 3_250 });
    // And the lists say so.
    expect(a.book.activity('needs').rows).toEqual([]);
    expect(a.book.activity('wants').rows.map((r) => r.id)).toEqual(['g1']);
  });

  it('5.6 A20 B110 a payment marked as going to the old card is sorted from the list as what the bank sent, the way the book does', () => {
    const a = setup();
    const b = setup();
    for (const { book } of [a, b]) {
      book.receive(purchase('l1', START_DATE, 6_000, 'MADE UP LANDLORD', { account: 'checking' }));
      book.sort('l1', { transfer: 'old-card' }, TODAY);
    }
    expect(a.book.pots().needs).toBe(50_000 - 6_000);
    // Picking Needs was refused (it was read as keeping the payment); now it is the purchase, in needs.
    done(a.desk.decide(ask({ item: 'l1', choice: { to: 'needs' } })));
    b.book.sort('l1', { to: 'needs' }, TODAY);
    expect(snapshot(a.book)).toBe(snapshot(b.book));
    expect(a.book.resortDetail('l1')).toMatchObject({ now: { to: 'needs' }, marked: null });
    // Wants takes it from wants; marking it again and picking Wants.
    done(a.desk.decide(ask({ item: 'l1', choice: { transfer: 'old-card' } })));
    done(a.desk.decide(ask({ item: 'l1', choice: { to: 'wants' } })));
    expect(a.book.pots()).toMatchObject({ needs: 50_000, wants: 30_000 - 6_000 });
  });

  it('5.6 A20 B110 a repeat of the same tap changes nothing, and a different tap on a payment already undone says where it is', () => {
    const { book, desk } = setup();
    book.receive(purchase('l1', START_DATE, 6_000, 'MADE UP LANDLORD', { account: 'checking' }));
    book.sort('l1', { transfer: 'old-card' }, TODAY);
    const first = ask({ item: 'l1', choice: { to: 'wants' } });
    done(desk.decide(first));
    const after = snapshot(book);
    expect(done(desk.decide(first))).toMatchObject({ replayed: true });
    expect(snapshot(book)).toBe(after);
    // The same pick again, as a new decision: it is already there.
    expect(refused(desk.decide(ask({ item: 'l1', choice: { to: 'wants' } }))).why).toContain('It is already in Wants.');
    expect(snapshot(book)).toBe(after);
  });

  it('5.6 A20 B110 what is not offered for a marked payment is refused and changes nothing: savings, marking it with the old card again', () => {
    const { book, desk } = setup();
    book.receive(purchase('l1', START_DATE, 6_000, 'MADE UP LANDLORD', { account: 'checking' }));
    book.sort('l1', { transfer: 'old-card' }, TODAY);
    const before = snapshot(book);
    refused(desk.decide(ask({ item: 'l1', choice: { to: 'savings' } })));
    refused(desk.decide(ask({ item: 'l1', choice: { transfer: 'old-card' } })));
    expect(snapshot(book)).toBe(before);
  });

  it('13.6 A20 B110 "always do this" on a marked payment makes the rule and sorts it', () => {
    const { book, desk } = setup();
    book.receive(purchase('l1', START_DATE, 6_000, 'MADE UP LANDLORD', { account: 'checking' }));
    book.sort('l1', { transfer: 'old-card' }, TODAY);
    const response = done(desk.decide(ask({ item: 'l1', choice: { to: 'wants' }, always: { contains: 'MADE UP LANDLORD' }, confirmed: true })));
    expect(response).toMatchObject({ ok: true });
    expect(book.resortDetail('l1')).toMatchObject({ now: { to: 'wants' }, marked: null });
    expect(book.rules().some((r) => r.for === 'purchase' && r.contains === 'MADE UP LANDLORD')).toBe(true);
  });

  it('4.4 a purchase can be split from the list, with the rest worked out by the money math', () => {
    const { book, desk } = setup();
    book.receive(purchase('g1', START_DATE, 3_250, 'MADE UP GROCERY'));
    const r = done(desk.decide(ask({ item: 'g1', choice: { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 'rest' }] } })));
    expect(r.done.choice).toEqual({ split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 2_250 }] });
    expect(book.pots()).toMatchObject({ needs: 49_000, wants: 30_000 - 2_250 });
  });

  it('6.1 money that came in can be put somewhere else', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 5_000, 'MADE UP FRIEND'));
    book.sort('d1', { to: 'wants' }, START_DATE);
    done(desk.decide(ask({ item: 'd1', choice: { to: 'needs' } })));
    expect(book.pots()).toMatchObject({ needs: 55_000, wants: 30_000 });
  });

  it('7.6 B73 a payment you marked for mom can be sorted to needs, and the reserve gets its money back', () => {
    const { book, desk } = setup();
    book.receive(payPerson('z1', START_DATE, 4_000, 'MADE UP AUNT'));
    book.sort('z1', { to: 'mom' }, START_DATE);
    expect(book.pots().momReserve).toBe(146_000);
    done(desk.decide(ask({ item: 'z1', choice: { to: 'needs' } })));
    expect(book.pots()).toMatchObject({ momReserve: 150_000, needs: 46_000 });
    expect(book.momSentInMonth('2026-10').sent).toBe(0);
  });

  it('4.5 A18 a refund put into a bucket can be matched to its purchase, once he says yes', () => {
    const { book, desk } = setup();
    book.receive(purchase('g1', '2026-10-01', 3_250, 'MADE UP GROCERY'));
    book.receive(refund('r1', START_DATE, 3_250));
    book.sort('r1', { to: 'wants' }, START_DATE);
    const request = ask({ item: 'r1', choice: { refundOf: 'g1' } });
    const before = snapshot(book);
    expect(refused(desk.decide(request)).code).toBe('needs-confirmation');
    expect(snapshot(book)).toBe(before);
    done(desk.decide({ ...request, confirmed: true }));
    // As if the bank had matched it: back into needs, where the purchase came from.
    expect(book.pots()).toMatchObject({ needs: 50_000, wants: 30_000 });
  });

  it('6.1 B52 a deposit already sorted can still be called your paycheck, once he says yes: it starts a pay period', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 420_000, 'MADE UP NEW JOB'));
    book.sort('d1', { to: 'other-income' }, START_DATE);
    const request = ask({ item: 'd1', choice: { to: 'paycheck' } });
    expect(refused(desk.decide(request)).code).toBe('needs-confirmation');
    expect(book.period().number).toBe(0);
    done(desk.decide({ ...request, confirmed: true }));
    expect(book.period().number).toBe(1);
    expect(book.paychecks().map((p) => p.id)).toEqual(['d1']);
  });
});

describe('B101 sorting it to where it already is changes nothing, and says so', () => {
  it('B101 a purchase already in wants: the answer says it is already there', () => {
    const { book, desk } = setup();
    book.receive(purchase('c1', START_DATE, 1_000, 'MADE UP CAFE'));
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'c1', choice: { to: 'wants' } })));
    expect(r.code).toBe('refused');
    expect(r.why).toBe('It is already in Wants. Nothing was changed.');
    expect(snapshot(book)).toBe(before);
  });

  it('B101 the same for money that came in, for not mine, and for mom', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 5_000, 'MADE UP ROOMMATE'));
    book.sort('d1', { to: 'not-mine' }, START_DATE);
    book.receive(payPerson('z1', START_DATE, 4_000, 'MADE UP AUNT'));
    book.sort('z1', { to: 'mom' }, START_DATE);
    expect(refused(desk.decide(ask({ item: 'd1', choice: { to: 'not-mine' } }))).why).toBe('It is already marked Other. Nothing was changed.');
    expect(refused(desk.decide(ask({ item: 'z1', choice: { to: 'mom' } }))).why).toBe('It is already marked for mom. Nothing was changed.');
  });

  it('B101 a split that is already that split', () => {
    const { book, desk } = setup();
    book.receive(purchase('h1', START_DATE, 9_000, 'MADE UP HARDWARE'));
    done(desk.decide(ask({ item: 'h1', choice: { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 'rest' }] } })));
    const before = snapshot(book);
    const same = refused(desk.decide(ask({ item: 'h1', choice: { split: [{ bucket: 'wants', amount: 3_000 }, { bucket: 'needs', amount: 6_000 }] } })));
    expect(same.why).toBe('It is already split that way. Nothing was changed.');
    expect(snapshot(book)).toBe(before);
    // A different split is fine.
    done(desk.decide(ask({ item: 'h1', choice: { split: [{ bucket: 'needs', amount: 5_000 }, { bucket: 'wants', amount: 'rest' }] } })));
  });

  it('B101 4.7 a double tap with two decision numbers sorts it once and says "already there" to the second', () => {
    const { book, desk } = setup();
    book.receive(purchase('g1', START_DATE, 3_250, 'MADE UP GROCERY'));
    done(desk.decide(ask({ item: 'g1', choice: { to: 'wants' } })));
    const after = snapshot(book);
    expect(refused(desk.decide(ask({ item: 'g1', choice: { to: 'wants' } }))).why).toContain('already in Wants');
    expect(snapshot(book)).toBe(after);
  });

  it('B101 a retry with the same decision number gets the same answer and changes nothing', () => {
    const { book, desk } = setup();
    book.receive(purchase('g1', START_DATE, 3_250, 'MADE UP GROCERY'));
    const request = ask({ item: 'g1', choice: { to: 'wants' } });
    const first = done(desk.decide(request));
    const after = snapshot(book);
    const second = done(desk.decide(request));
    expect(second.replayed).toBe(true);
    expect(second.done).toEqual(first.done);
    expect(snapshot(book)).toBe(after);
  });

  it('B101 without resort: true, an item that is not waiting is still "already dealt with", as in Review', () => {
    const { book, desk } = setup();
    book.receive(purchase('g1', START_DATE, 3_250, 'MADE UP GROCERY'));
    const before = snapshot(book);
    const { resort: _resort, ...review } = ask({ item: 'g1', choice: { to: 'wants' } });
    expect(refused(desk.decide(review)).code).toBe('not-waiting');
    expect(snapshot(book)).toBe(before);
  });

  it('B101 resort: true on an item that is waiting in review sorts it there, the same as in Review', () => {
    const { book, desk } = setup();
    book.receive(purchase('x1', START_DATE, 1_150, 'MADE UP CORNER STORE'));
    done(desk.decide(ask({ item: 'x1', choice: { to: 'wants' } })));
    expect(book.reviewItems()).toEqual([]);
    expect(book.pots().wants).toBe(30_000 - 1_150);
  });
});

describe('13.6 B102 "always do this" from the list', () => {
  it('13.6 it asks first, and does nothing until he says yes', () => {
    const { book, desk } = setup();
    book.receive(purchase('g1', START_DATE, 3_250, 'MADE UP GROCERY'));
    const before = snapshot(book);
    const request = ask({ item: 'g1', choice: { to: 'wants' }, always: { contains: 'GROCERY' } });
    expect(refused(desk.decide(request)).code).toBe('needs-confirmation');
    expect(snapshot(book)).toBe(before);
  });

  it('13.6 it sorts this one and makes the rule just ahead of the rule it corrects, the same as the book', () => {
    const a = setup();
    const b = setup();
    for (const { book } of [a, b]) book.receive(purchase('g1', START_DATE, 3_250, 'MADE UP GROCERY'));
    const request = ask({ item: 'g1', choice: { to: 'wants' }, always: { contains: 'GROCERY' }, confirmed: true });
    const r = done(a.desk.decide(request));
    b.book.sortAlways('g1', { to: 'wants' }, { id: `always-${request.id}`, contains: 'GROCERY' }, TODAY);
    expect(snapshot(a.book)).toBe(snapshot(b.book));
    expect(a.book.rules().map((x) => x.id)).toEqual([`always-${request.id}`, 'grocery', 'cafe']);
    expect(r.done.sticks).toBe(true);
    // The next one goes to wants by itself.
    a.book.receive(purchase('g2', START_DATE, 100, 'MADE UP GROCERY'));
    expect(a.book.pots().wants).toBe(30_000 - 3_250 - 100);
  });

  it('13.2 B102 it also sorts the waiting items it now covers, and the answer says how many', () => {
    const { book, desk } = setup();
    book.receive(purchase('c1', START_DATE, 1_000, 'MADE UP BLUE DOOR CAFE'));
    book.receive(purchase('x1', START_DATE, 700, 'MADE UP BLUE DOOR TAKEOUT'));
    expect(book.reviewItems().map((i) => i.id)).toEqual(['x1']);
    const r = done(desk.decide(ask({ item: 'c1', choice: { to: 'needs' }, always: { contains: 'BLUE DOOR' }, confirmed: true })));
    expect(r.done.alsoSorted).toBe(1);
    expect(book.reviewItems()).toEqual([]);
    expect(book.pots()).toMatchObject({ needs: 50_000 - 1_000 - 700, wants: 30_000 });
  });

  it('13.6 B102 an item already where it should be can still get a rule, which sorts nothing', () => {
    const { book, desk } = setup();
    book.receive(purchase('c1', START_DATE, 1_000, 'MADE UP BLUE DOOR CAFE'));
    const pots = book.pots();
    const r = done(desk.decide(ask({ item: 'c1', choice: { to: 'wants' }, always: { contains: 'BLUE DOOR' }, confirmed: true })));
    expect(book.pots()).toEqual(pots);
    expect(book.rules().some((x) => x.contains === 'BLUE DOOR')).toBe(true);
    expect(r.done.sticks).toBe(true);
  });

  it('13.6 B102 a rule whose text does not match the item is refused, and no rule is made', () => {
    const { book, desk } = setup();
    book.receive(purchase('g1', START_DATE, 3_250, 'MADE UP GROCERY'));
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'g1', choice: { to: 'wants' }, always: { contains: 'SOMETHING ELSE' }, confirmed: true })));
    expect(r.why).toContain('SOMETHING ELSE');
    expect(snapshot(book)).toBe(before);
  });

  it('13.6 4.9 a rule cannot be made for money that left savings, a fee, or a payment marked for mom', () => {
    const { book, desk } = setup();
    book.receive({ kind: 'savings-withdrawal', id: 'w1', account: 'savings', date: START_DATE, amount: 6_410, description: 'BILL PAY WATER', pending: false });
    book.sort('w1', { to: 'needs' }, START_DATE);
    book.receive({ kind: 'card-charge', id: 'f1', account: 'everyday-card', date: START_DATE, amount: 3_500, description: 'LATE FEE', charge: 'fee' });
    book.sort('f1', { to: 'needs' }, START_DATE);
    book.receive(payPerson('z1', START_DATE, 4_000, 'MADE UP AUNT'));
    book.sort('z1', { to: 'mom' }, START_DATE);
    const before = snapshot(book);
    for (const [item, contains] of [['w1', 'WATER'], ['f1', 'LATE FEE'], ['z1', 'AUNT']] as const) {
      const r = refused(desk.decide(ask({ item, choice: { to: 'wants' }, always: { contains }, confirmed: true })));
      expect(r.why, item).toBe("A rule can't do that for this item. Nothing was changed.");
    }
    expect(snapshot(book)).toBe(before);
  });
});

describe('B100 what cannot be sorted again is refused, says why, and changes nothing', () => {
  it('B100 a paycheck, a leftover answer, a hand move, a matched refund, a mom-rule payment, a payment to the old card from checking, and anything the bank took back', () => {
    const { book, desk } = setup();
    book.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    book.receive(refund('rm', START_DATE, 3_250, 'g1'));
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    book.answerLeftover('leftover:p1:needs', 'move-to-savings', '2026-10-10');
    book.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-10');
    book.receive(payPerson('m1', '2026-10-11', 50_000, MOM_NAME));
    book.receive(transfer('o1', '2026-10-11', 20_000, 'checking', 'old-card'));
    book.receive(purchase('t1', '2026-10-11', 1_000, 'MADE UP GROCERY'));
    book.receive(takenBack('tb', 't1', '2026-10-12'));
    const before = snapshot(book);
    for (const item of ['p1', 'leftover:p1:needs', 'move:1', 'rm', 'm1', 'o1', 't1']) {
      const r = refused(desk.decide(ask({ item, choice: { to: 'wants' } })));
      expect(r.code, item).toBe('refused');
      expect(r.why, item).toContain('Nothing was changed');
      expect(r.why, item).not.toContain("That isn't one of the choices");
    }
    expect(snapshot(book)).toBe(before);
  });

  it('B100 the reason is the one the money math gave for that item', () => {
    const { book, desk } = setup();
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    const r = refused(desk.decide(ask({ item: 'p1', choice: { to: 'wants' } })));
    const detail = book.resortDetail('p1');
    if (detail === null || detail.resortable) throw new Error('a paycheck should not be sortable again');
    expect(r.why).toBe(`${detail.why.replace(/\.$/, '')}. Nothing was changed.`);
  });

  it('B100 an item that is not in the book is "already dealt with"', () => {
    const { book, desk } = setup();
    const before = snapshot(book);
    expect(refused(desk.decide(ask({ item: 'nothing-like-this', choice: { to: 'wants' } }))).code).toBe('not-waiting');
    expect(snapshot(book)).toBe(before);
  });

  it('B100 a choice the item does not offer is refused: a purchase cannot be savings or mom, and a card purchase cannot be a transfer', () => {
    const { book, desk } = setup();
    book.receive(purchase('g1', START_DATE, 3_250, 'MADE UP GROCERY'));
    const before = snapshot(book);
    for (const choice of [{ to: 'savings' }, { to: 'mom' }, { to: 'paycheck' }, { transfer: 'savings' }, { leftover: 'roll-over' }, { acknowledge: true }] as ChoiceRequest['choice'][]) {
      const r = refused(desk.decide(ask({ item: 'g1', choice, confirmed: true })));
      expect(r.code, JSON.stringify(choice)).toBe('refused');
    }
    expect(snapshot(book)).toBe(before);
  });

  it('0.1 a re-sort that would make a total too large to keep exact is refused, and the item stays where it was', () => {
    const HUGE = Number.MAX_SAFE_INTEGER - 1_000;
    const book = openTestBook({ pots: { needs: -HUGE } });
    book.receive(purchase('e1', START_DATE, 1_001, 'MADE UP STORE'));
    book.sort('e1', { to: 'wants' }, START_DATE);
    const desk = new ChoiceDesk(book, () => TODAY);
    const before = snapshot(book);
    const r = refused(desk.decide(ask({ item: 'e1', choice: { to: 'needs' } })));
    expect(r.why).toBe('That would make a total too large to keep exact. Nothing was changed.');
    expect(snapshot(book)).toBe(before);
  });

  it('a refused choice can be sent again with the same decision number once it is fixed', () => {
    const { book, desk } = setup();
    book.receive(deposit('d1', START_DATE, 420_000, 'MADE UP NEW JOB'));
    book.sort('d1', { to: 'other-income' }, START_DATE);
    const request = ask({ item: 'd1', choice: { to: 'paycheck' } });
    expect(refused(desk.decide(request)).code).toBe('needs-confirmation');
    done(desk.decide({ ...request, confirmed: true }));
    expect(book.paychecks()).toHaveLength(1);
  });
});

describe('B100 every kind of sorted item: the desk takes exactly what the money math offers', () => {
  const kinds = Object.entries(SORTED);

  it.each(kinds)('4.7 %s: asking twice with the same number leaves the book as the first time left it', (_name, id) => {
    const book = sortedBook();
    const desk = new ChoiceDesk(book, () => TODAY);
    const detail = book.resortDetail(id);
    if (detail === null || !detail.resortable) return;
    const pick = detail.options.picks.find((p) => !p.final && !(('to' in detail.now) && detail.now.to === p.to));
    if (pick === undefined) return;
    const request = ask({ item: id, choice: { to: pick.to }, confirmed: true });
    const first = desk.decide(request);
    expect(first.ok, `${id}: ${first.ok ? '' : first.why}`).toBe(true);
    const after = snapshot(book);
    const second = desk.decide(request);
    expect(second.ok && second.replayed).toBe(true);
    expect(snapshot(book)).toBe(after);
    expect(book.recountPots()).toEqual(book.pots());
  });

  it('4.7 every item the money math says cannot be sorted again is refused by the desk, and nothing changes', () => {
    const book = sortedBook();
    const desk = new ChoiceDesk(book, () => TODAY);
    const before = snapshot(book);
    for (const id of Object.values(SORTED)) {
      const detail = book.resortDetail(id);
      if (detail === null || detail.resortable) continue;
      if (id === SORTED.waiting) continue;
      const r = desk.decide(ask({ item: id, choice: { to: 'wants' }, confirmed: true }));
      expect(r.ok, id).toBe(false);
    }
    expect(snapshot(book)).toBe(before);
  });
});

describe('what the phone sends: resort', () => {
  it('resort must be true when it is there; anything else is not a request', () => {
    const ok = { id: 'abcdefgh12345678', item: 'g1', choice: { to: 'wants' }, resort: true };
    expect(parseChoiceRequest(ok)).toEqual(ok);
    expect(parseChoiceRequest({ ...ok, resort: false })).toBeNull();
    expect(parseChoiceRequest({ ...ok, resort: 'yes' })).toBeNull();
    expect(parseChoiceRequest({ ...ok, resort: 1 })).toBeNull();
    const { resort: _gone, ...plain } = ok;
    expect(parseChoiceRequest(plain)).toEqual(plain);
  });
});

describe('5.6 A21 "It was not a payment to the old card", for one marked from savings', () => {
  function marked() {
    const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000 }, oldCardDebt: 300_000 });
    book.receive({ kind: 'savings-withdrawal', id: 'w1', account: 'savings', date: '2026-10-05', amount: 20_000, description: 'MADE UP WATER UTILITY', pending: false });
    const pots = book.pots();
    book.sort('w1', { transfer: 'old-card' }, '2026-10-06');
    return { book, pots, desk: new ChoiceDesk(book, () => '2026-10-20') };
  }

  it('A21 reads it, and only as true', () => {
    expect(parseChoiceRequest({ id: 'abcdefgh', item: 'w1', choice: { unmark: true } })).toEqual({ id: 'abcdefgh', item: 'w1', choice: { unmark: true } });
    expect(parseChoiceRequest({ id: 'abcdefgh', item: 'w1', choice: { unmark: false } })).toBeNull();
    expect(parseChoiceRequest({ id: 'abcdefgh', item: 'w1', choice: { unmark: 'yes' } })).toBeNull();
  });

  it('A21 4.9 in review it brings back what the bank sent, waiting, and the old card owes what it did', () => {
    const { book, pots, desk } = marked();
    const r = desk.decide({ id: 'unmark-0001', item: 'w1', choice: { unmark: true } });
    expect(r).toMatchObject({ ok: true, done: { item: 'w1', choice: { unmark: true } } });
    expect(book.pots()).toEqual(pots);
    expect(book.oldCardDebt()).toBe(300_000);
    expect(book.reviewItems()).toMatchObject([{ id: 'w1', reason: 'from-savings', amount: 20_000 }]);
  });

  it('A21 A4 from its list, after it was sorted to savings', () => {
    const { book, pots, desk } = marked();
    book.sort('w1', { to: 'savings' }, '2026-10-07');
    expect(desk.decide({ id: 'unmark-0002', item: 'w1', choice: { unmark: true }, resort: true })).toMatchObject({ ok: true });
    expect(book.pots()).toEqual(pots);
  });

  it('A21 offered only there, never with "always do this"; anywhere else it is refused and changes nothing', () => {
    const { book, desk } = marked();
    expect(desk.decide({ id: 'unmark-0003', item: 'w1', choice: { unmark: true }, always: { contains: 'WATER' } })).toMatchObject({ ok: false, code: 'refused', why: "That isn't one of the choices for this item. Nothing was changed." });
    book.receive(purchase('p1', '2026-10-06', 1_000, 'MADE UP CAFE'));
    const before = JSON.stringify({ pots: book.pots(), review: book.reviewItems() });
    expect(desk.decide({ id: 'unmark-0004', item: 'p1', choice: { unmark: true } })).toMatchObject({ ok: false, code: 'refused' });
    // Wants is not one of its choices either: unmark it first (A21).
    expect(desk.decide({ id: 'unmark-0005', item: 'w1', choice: { to: 'wants' } })).toMatchObject({ ok: false, code: 'refused' });
    expect(JSON.stringify({ pots: book.pots(), review: book.reviewItems() })).toBe(before);
  });
});

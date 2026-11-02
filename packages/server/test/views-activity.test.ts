import { MOVABLE_POTS, type Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { MOM_NAME, START_DATE, openTestBook, payPerson, paycheck, purchase } from '../../money/test/helpers.js';
import { POT_SLUGS, activityView, potOfSlug, slugOfPot, type ActivityView } from '../src/views/activity.js';

// The screen for what went in and out of one bucket (QUESTIONS.md B97), worked
// out on the server from the book. The screen only formats it. Made-up
// numbers only.

const RULES = [{ id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' }] as const;

function aBook(): Book {
  const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 20_000, momReserve: 120_000, heldForOthers: 3_000 }, rules: RULES });
  book.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
  book.receive(payPerson('m1', '2026-10-04', 50_000, MOM_NAME));
  book.receive(paycheck('p1', '2026-10-09', 400_000));
  book.receive(purchase('g2', '2026-10-10', 1_000, 'MADE UP GROCERY'));
  return book;
}

function tracking(view: ActivityView): Extract<ActivityView, { state: 'tracking' }> {
  if (view.state !== 'tracking') throw new Error(`expected tracking, got ${view.state}`);
  return view;
}

describe('14 before setup day', () => {
  it('14 there is nothing to show, and it says so', () => {
    expect(activityView({ today: START_DATE, book: null, pot: 'needs', madeUpData: true })).toEqual({ state: 'not-set-up', madeUpData: true });
    expect(activityView({ today: START_DATE, book: null, pot: 'needs', madeUpData: false })).toEqual({ state: 'not-set-up', madeUpData: false });
  });
});

describe('B97 a bucket\'s activity is what the money math says went in and out of it', () => {
  it('B97 every number is the book\'s own, for each of the five buckets', () => {
    const book = aBook();
    for (const pot of MOVABLE_POTS) {
      const v = tracking(activityView({ today: '2026-10-12', book, pot, madeUpData: true }));
      expect(v.pot).toBe(pot);
      expect(v.activity).toEqual(book.activity(pot));
      expect(v.today).toBe('2026-10-12');
      expect(v.madeUpData).toBe(true);
    }
  });

  it('B97 what each bucket holds now comes with it, for the form that moves money', () => {
    const book = aBook();
    const v = tracking(activityView({ today: '2026-10-12', book, pot: 'needs', madeUpData: false }));
    const pots = book.pots();
    expect(v.balances).toEqual({ savings: pots.savings, needs: pots.needs, wants: pots.wants, momReserve: pots.momReserve, heldForOthers: pots.heldForOthers });
  });

  it('B97 the list adds up on the server too: opening plus in plus out is what the bucket holds', () => {
    const book = aBook();
    for (const pot of MOVABLE_POTS) {
      const { activity } = tracking(activityView({ today: '2026-10-12', book, pot, madeUpData: false }));
      expect(activity.opening + activity.in + activity.out).toBe(activity.closing);
      expect(activity.closing).toBe(book.pots()[pot]);
    }
  });

  it('B100 each row carries what the money math says about sorting it again', () => {
    const book = aBook();
    const { activity } = tracking(activityView({ today: '2026-10-12', book, pot: 'needs', madeUpData: false }));
    for (const row of activity.rows) expect(row.resort).toEqual(book.resortDetail(row.id));
    expect(activity.rows.find((r) => r.id === 'g2')?.resort).toMatchObject({ resortable: true });
    expect(activity.rows.find((r) => r.id === 'p1')?.resort).toMatchObject({ resortable: false });
  });

  it('5.6 A20 B110 a payment marked as going to the old card is on needs\' list with what the purchase could be, and says it was marked', () => {
    const book = aBook();
    book.receive(purchase('l1', '2026-10-10', 6_000, 'MADE UP LANDLORD', { account: 'checking' }));
    book.sort('l1', { transfer: 'old-card' }, '2026-10-11');
    const v = tracking(activityView({ today: '2026-10-12', book, pot: 'needs', madeUpData: true }));
    const row = v.activity.rows.find((r) => r.id === 'l1');
    expect(row).toMatchObject({ what: 'debt-payoff', amount: -6_000, resort: { resortable: true, marked: 'old-card', now: { to: 'old-card-payment' }, options: { picks: [{ to: 'needs' }, { to: 'wants' }, { to: 'not-mine' }] } } });
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  it('asking changes nothing in the book', () => {
    const book = aBook();
    const before = JSON.stringify([book.pots(), book.reviewItems(), book.changeLog(), ...MOVABLE_POTS.map((p) => book.activity(p))]);
    for (const pot of MOVABLE_POTS) activityView({ today: '2026-10-12', book, pot, madeUpData: false });
    expect(JSON.stringify([book.pots(), book.reviewItems(), book.changeLog(), ...MOVABLE_POTS.map((p) => book.activity(p))])).toBe(before);
  });

  it('what is sent can go to the phone as JSON and come back the same', () => {
    const book = aBook();
    const v = activityView({ today: '2026-10-12', book, pot: 'needs', madeUpData: false });
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

describe('B97 the addresses of the buckets', () => {
  it('each bucket has its own name in the address, and the names lead back to the buckets', () => {
    expect(POT_SLUGS).toEqual({ savings: 'savings', needs: 'needs', wants: 'wants', 'mom-reserve': 'momReserve', 'held-for-others': 'heldForOthers' });
    for (const pot of MOVABLE_POTS) expect(potOfSlug(slugOfPot(pot))).toBe(pot);
  });

  it('anything else is not a bucket', () => {
    for (const slug of ['', 'unsortedIn', 'momReserve', 'heldForOthers', 'Needs', 'needs/', 'constructor', '__proto__', 'toString', 'old-card']) expect(potOfSlug(slug), slug).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { Book } from '../src/index.js';
import { codeOf, openTestBook, payPerson, purchase, transfer, withdrawal } from './helpers.js';

// QUESTIONS.md A21, option 2: a payment you marked as going to the old card
// FROM SAVINGS (5.6, 5.2, A4) can be unmarked with its own choice, "It was not
// a payment to the old card", in review and from its bucket's list. It brings
// back what the bank sent, which is then taken as the bank sent it: money
// leaving savings waits in review with the usual choices (4.9). The old card
// owes what it did before. Its own choice, so "Needs" keeps meaning "keep it a
// payment to the old card, out of Needs" (A4).

function book(): Book {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 20_000 }, oldCardDebt: 300_000 });
}

// Everything the book can say about itself.
function state(b: Book): unknown {
  return { pots: b.pots(), review: b.reviewItems(), debt: b.oldCardDebt(), transit: b.inTransit(), recount: b.recountPots() };
}

// A bill paid from savings (4.9), marked by mistake as a payment to the old card.
function marked(): { b: Book; before: unknown } {
  const b = book();
  b.receive(withdrawal('w1', '2026-10-05', 20_000, 'MADE UP WATER UTILITY'));
  const before = state(b);
  b.sort('w1', { transfer: 'old-card' }, '2026-10-06');
  return { b, before };
}

describe('5.6 A21 a payment marked from savings to the old card can be unmarked', () => {
  it('5.6 A21 A4 in review it offers savings, needs, and "it was not a payment to the old card"', () => {
    const { b } = marked();
    const d = b.reviewDetails().find((x) => x.item.id === 'w1');
    expect(d?.item).toMatchObject({ type: 'spending', reason: 'old-card-from-savings', amount: 20_000 });
    expect(d?.options).toMatchObject({ type: 'sort', picks: [{ to: 'savings' }, { to: 'needs' }], unmark: true });
  });

  it('5.6 A21 4.9 unmarked in review, it is what the bank sent again: money leaving savings, waiting with the usual choices, and the old card owes what it did', () => {
    const { b, before } = marked();
    b.sort('w1', { unmark: true }, '2026-10-07');
    expect(state(b)).toEqual(before);
    const d = b.reviewDetails().find((x) => x.item.id === 'w1');
    expect(d?.item).toMatchObject({ type: 'spending', reason: 'from-savings', amount: 20_000 });
    expect(d?.options).toMatchObject({ picks: [{ to: 'needs' }, { to: 'wants' }, { to: 'not-mine' }], unmark: false });
  });

  it.each(['savings', 'needs'] as const)('5.6 A21 A4 sorted to %s, it can be unmarked from its list: the bucket gets its money back and it waits in review again', (to) => {
    const { b, before } = marked();
    b.sort('w1', { to }, '2026-10-07');
    expect(b.pots()[to]).toBe((to === 'savings' ? 100_000 : 50_000) - 20_000);
    const detail = b.resortDetail('w1');
    expect(detail).toMatchObject({ resortable: true, options: { picks: [{ to: 'savings' }, { to: 'needs' }], unmark: true } });
    b.sort('w1', { unmark: true }, '2026-10-08');
    expect(state(b)).toEqual(before);
    expect(b.activity(to).rows.find((r) => r.id === 'w1')).toBeUndefined();
  });

  it('5.6 A21 7.4 a payment to a person from savings that was marked comes back as what the bank sent: a payment to a person, waiting', () => {
    const b = book();
    b.receive(payPerson('z2', '2026-10-05', 5_000, 'MADE UP FRIEND', 'savings'));
    const before = state(b);
    b.sort('z2', { transfer: 'old-card' }, '2026-10-06');
    b.sort('z2', { unmark: true }, '2026-10-07');
    expect(state(b)).toEqual(before);
    expect(b.reviewItems().find((i) => i.id === 'z2')).toMatchObject({ reason: 'person-payment', amount: 5_000 });
  });

  it('5.6 A21 marked and unmarked again and again, nothing else changes', () => {
    const { b, before } = marked();
    b.sort('w1', { unmark: true }, '2026-10-07');
    b.sort('w1', { transfer: 'old-card' }, '2026-10-08');
    b.sort('w1', { to: 'savings' }, '2026-10-08');
    b.sort('w1', { unmark: true }, '2026-10-09');
    expect(state(b)).toEqual(before);
  });

  it('5.6 A21 B110 only one marked from savings by hand can be unmarked: anything else is refused, and nothing changes', () => {
    const b = book();
    // The bank's own payment to the old card from savings (A4): nothing was marked.
    b.receive(transfer('t1', '2026-10-05', 10_000, 'savings', 'old-card'));
    // A purchase marked from checking: A20 already offers what it was.
    b.receive(purchase('p1', '2026-10-05', 3_000, 'MADE UP LANDLORD', { account: 'checking' }));
    b.sort('p1', { transfer: 'old-card' }, '2026-10-05');
    // A bill from savings marked as a transfer to checking (no bucket changes, on no list).
    b.receive(withdrawal('w2', '2026-10-05', 2_000, 'MADE UP SAVINGS MOVE'));
    b.sort('w2', { transfer: 'checking' }, '2026-10-05');
    // Plain spending.
    b.receive(purchase('p2', '2026-10-05', 1_000, 'MADE UP CAFE'));
    const before = state(b);
    for (const id of ['t1', 'p1', 'w2', 'p2']) expect(codeOf(() => b.sort(id, { unmark: true }, '2026-10-06')), id).toBe('bad-choice');
    expect(b.reviewDetails().find((d) => d.item.id === 't1')?.options).toMatchObject({ unmark: false });
    expect(b.resortDetail('p1')).toMatchObject({ options: { unmark: false } });
    expect(state(b)).toEqual(before);
  });

  it('5.6 A21 0.1 unmarking keeps every bucket recounting to the cent', () => {
    const { b } = marked();
    b.sort('w1', { to: 'needs' }, '2026-10-07');
    b.sort('w1', { unmark: true }, '2026-10-08');
    expect(b.recountPots()).toEqual(b.pots());
    expect(b.recountOldCardDebt()).toBe(b.oldCardDebt());
  });
});

describe('5.6 A21 what is offered for one marked from savings is exactly what the book accepts', () => {
  const PICKS = ['paycheck', 'other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine', 'mom'] as const;
  const ACCOUNTS = ['checking', 'savings', 'everyday-card', 'old-card'] as const;

  it.each(['waiting', 'sorted to savings', 'sorted to needs'] as const)('5.6 A21 A4 %s: every offered choice works, every other is refused and changes nothing', (where) => {
    const make = (): Book => {
      const { b } = marked();
      if (where !== 'waiting') b.sort('w1', { to: where === 'sorted to savings' ? 'savings' : 'needs' }, '2026-10-07');
      return b;
    };
    const first = make();
    const options = where === 'waiting' ? first.reviewDetails().find((d) => d.item.id === 'w1')?.options : (first.resortDetail('w1') as { options: unknown } | null)?.options;
    if (options === undefined || options === null || (options as { type: string }).type !== 'sort') throw new Error('no choices');
    const o = options as Extract<NonNullable<ReturnType<Book['reviewDetails']>[number]>['options'], { type: 'sort' }>;
    const tries: [string, boolean, (b: Book) => void][] = [
      ...PICKS.map((to): [string, boolean, (b: Book) => void] => [`pick ${to}`, o.picks.some((p) => p.to === to), (b) => b.sort('w1', { to }, '2026-10-08')]),
      ...ACCOUNTS.map((a): [string, boolean, (b: Book) => void] => [`transfer ${a}`, o.transfer.includes(a), (b) => b.sort('w1', { transfer: a }, '2026-10-08')]),
      ['unmark', o.unmark, (b) => b.sort('w1', { unmark: true }, '2026-10-08')],
      ['split', o.split !== null, (b) => b.sort('w1', { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: 19_999 }] }, '2026-10-08')],
    ];
    expect(o.unmark).toBe(true);
    for (const [name, offered, run] of tries) {
      const b = make();
      const before = state(b);
      let accepted = true;
      try {
        run(b);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'MoneyError') throw error;
        accepted = false;
      }
      // Sorting it where it already is changes nothing either way; that is fine (B101 is the desk's).
      if (!(name === 'pick savings' && where === 'sorted to savings') && !(name === 'pick needs' && where === 'sorted to needs')) expect(accepted, `${where}: ${name}`).toBe(offered);
      if (!accepted) expect(state(b), `${where}: ${name}`).toEqual(before);
      else expect(b.recountPots(), `${where}: ${name}`).toEqual(b.pots());
    }
  });
});

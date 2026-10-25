// Her rulebook, PR 9: the Wishlist bucket (section 2's split, 3.3, 3.4, 3.5,
// 3.8, 4.2, 4.4, 11.3, 12.2, 13.1, 13.4, 14.2, 52.4), on her setup. A fourth
// bucket that gets its own percentage of each paycheck, that spending can be
// sorted to, that is never asked about at payday, and that is never part of
// safe to spend. Upstream's setup has no Wishlist (its switch is off), and its
// own tests cover it as it was. 50.4 is in wishlist-move-her.test.ts, and the
// random tests in wishlist-random-her.test.ts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HER_SETTINGS,
  HER_SWITCHES,
  UPSTREAM_SWITCHES,
  cardStatementView,
  changeSettings,
  checkSwitches,
  openBook,
  splitPaycheck,
  startTracking,
  validateSettings,
  type Book,
  type Cents,
  type IsoDate,
  type OpenBookInput,
  type ReviewOptions,
  type Settings,
} from '../src/index.js';
import { LAST_PAYCHECK, PAYROLL, START_DATE, cardCharge, codeOf, deposit, paycheck, payPerson, posted, purchase, refund, takenBack, transfer, withdrawal } from './helpers.js';

const SPLIT = { savings: 40, needs: 30, wants: 20, wishlist: 10 };
const HER: Settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL }, split: SPLIT, askBeforeSplittingPaycheck: false });
const POTS = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0, wishlist: 20_000 };
const MAX = Number.MAX_SAFE_INTEGER;
// LAST_PAYCHECK is Sep 25, so Oct 9 is the next payday (14 days).
const PAYDAY: IsoDate = '2026-10-09';

function herBook(settings: Partial<Settings> = {}, input: Partial<OpenBookInput> = {}): Book {
  return openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: changeSettings(HER, settings), switches: HER_SWITCHES, ...input });
}

// The app side worked out here on its own (12.2), with Wishlist.
function appSide(book: Book): Cents {
  const p = book.pots();
  return p.savings + p.needs + p.wants + (p.wishlist ?? 0) + p.heldForOthers + p.unsortedIn - p.unsortedOut;
}

function sortOptions(book: Book, id: string): Extract<ReviewOptions, { type: 'sort' }> {
  const detail = book.reviewDetails().find((d) => d.item.id === id);
  if (detail === undefined || detail.options.type !== 'sort') throw new Error(`${id} is not waiting to be sorted`);
  return detail.options;
}

// Everything a refused answer must leave as it was.
function state(book: Book): string {
  return JSON.stringify({ pots: book.pots(), review: book.reviewDetails(), log: book.changeLog(), period: book.period(), recount: book.recountPots(), settings: book.settings() });
}

function refused(book: Book, code: string, run: () => unknown): void {
  const before = state(book);
  expect(codeOf(run)).toBe(code);
  expect(state(book)).toBe(before);
}

describe('Section 2: the split names Wishlist', () => {
  it('Section 2: her split is savings, needs, wants and Wishlist, whole percents that add up to 100; Wishlist starts at 0% and she picks it on setup day', () => {
    expect(HER_SWITCHES.wishlist).toBe('on');
    expect(HER_SETTINGS.split).toEqual({ savings: 50, needs: 30, wants: 20, wishlist: 0 });
    expect(validateSettings({ ...HER_SETTINGS, split: { savings: 40, needs: 30, wants: 20, wishlist: 10 } }).split.wishlist).toBe(10);
    expect(validateSettings({ ...HER_SETTINGS, split: { savings: 0, needs: 0, wants: 0, wishlist: 100 } }).split.wishlist).toBe(100);
    for (const split of [
      { savings: 40, needs: 30, wants: 20, wishlist: 11 },
      { savings: 40, needs: 30, wants: 20, wishlist: 9 },
      { savings: 50, needs: 30, wants: 20, wishlist: -1 },
      { savings: 40, needs: 30, wants: 20, wishlist: 10.5 },
      { savings: 0, needs: 0, wants: 0, wishlist: 101 },
    ]) {
      expect(codeOf(() => validateSettings({ ...HER_SETTINGS, split }))).toBe('bad-setting');
    }
  });

  it("Section 2: upstream's settings, and switches saved before Wishlist existed, have no Wishlist: off, as upstream (B242)", () => {
    expect(Object.hasOwn(DEFAULT_SETTINGS.split, 'wishlist')).toBe(false);
    expect(UPSTREAM_SWITCHES.wishlist).toBe('off');
    expect(checkSwitches({ momReserve: 'off', oldCard: 'off', secondCard: 'on' } as never).wishlist).toBe('off');
    expect(checkSwitches(undefined).wishlist).toBe('off');
    expect(codeOf(() => checkSwitches({ ...HER_SWITCHES, wishlist: 'maybe' } as never))).toBe('bad-switch');
    // Upstream's book: no Wishlist anywhere it is read.
    const upstream = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: { savings: 1, needs: 2, wants: 3, momReserve: 4, heldForOthers: 5 }, settings: DEFAULT_SETTINGS });
    expect(Object.hasOwn(upstream.pots(), 'wishlist')).toBe(false);
    expect(Object.hasOwn(upstream.periodSummary().opening, 'wishlist')).toBe(false);
    expect(Object.hasOwn(upstream.periodSummary().byKind, 'wishlist')).toBe(false);
    expect(Object.hasOwn(splitPaycheck(10_000, 0, DEFAULT_SETTINGS), 'wishlist')).toBe(false);
  });

  it('Section 2: with Wishlist off, nothing about it is offered or taken: no share, no starting money, no sorting, no move, no payback', () => {
    const settings = changeSettings(DEFAULT_SETTINGS, { paycheckRule: { contains: PAYROLL } });
    const open = (input: Partial<OpenBookInput>) => () => openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 }, settings, ...input });
    expect(codeOf(open({ settings: { ...settings, split: { ...settings.split, wishlist: 0 } } }))).toBe('off-in-this-setup');
    expect(codeOf(open({ pots: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0, wishlist: 1 } }))).toBe('off-in-this-setup');
    const book = open({})();
    refused(book, 'off-in-this-setup', () => book.changeSettings({ split: { savings: 40, needs: 30, wants: 20, wishlist: 10 } }, '2026-10-02'));
    book.receive(purchase('p1', '2026-10-02', 1_000));
    refused(book, 'off-in-this-setup', () => book.sort('p1', { to: 'wishlist' }, '2026-10-02'));
    refused(book, 'off-in-this-setup', () => book.sort('p1', { split: [{ bucket: 'needs', amount: 500 }, { bucket: 'wishlist', amount: 500 }] }, '2026-10-02'));
    refused(book, 'off-in-this-setup', () => book.moveMoney({ from: 'needs', to: 'wishlist', amount: 1 }, '2026-10-02'));
    book.receive(deposit('d1', '2026-10-02', 1_000));
    refused(book, 'off-in-this-setup', () => book.sort('d1', { to: 'wishlist' }, '2026-10-02'));
    expect(codeOf(() => book.activity('wishlist'))).toBe('off-in-this-setup');
    // Nothing waiting offers it.
    expect(JSON.stringify(book.reviewDetails())).not.toContain('wishlist');
  });

  it('Section 2: with Wishlist on, the split always names it; a split without it is refused, and nothing changes', () => {
    const { wishlist: _wishlist, ...threeWay } = SPLIT;
    expect(codeOf(() => herBook({}, { settings: { ...HER, split: { savings: 50, needs: 30, wants: 20 } } }))).toBe('bad-setting');
    const book = herBook();
    refused(book, 'bad-setting', () => book.changeSettings({ split: { ...threeWay, savings: 50 } }, '2026-10-02'));
  });
});

describe('3.3 the paycheck is split four ways', () => {
  it('3.3 needs, wants and Wishlist are each rounded down to the cent, and savings gets the rest, so the parts add up to the paycheck exactly', () => {
    // 10,001 cents: needs 30% is 3,000.3, wants 20% is 2,000.2, Wishlist 10% is 1,000.1.
    expect(splitPaycheck(10_001, 0, HER)).toMatchObject({ savings: 4_001, needs: 3_000, wants: 2_000, wishlist: 1_000, momReserve: 0 });
    expect(splitPaycheck(10_001, 0, HER).detail).toMatchObject({ rest: 10_001, savingsShare: 4_000, roundingToSavings: 1 });
    // Every share at the edge of a cent: 9,999 cents.
    // 9,999 cents: 3,999.6, 2,999.7, 1,999.8 and 999.9; the 3 cents rounded off go to savings.
    expect(splitPaycheck(9_999, 0, HER)).toMatchObject({ savings: 4_002, needs: 2_999, wants: 1_999, wishlist: 999 });
    expect(splitPaycheck(9_999, 0, HER).detail).toMatchObject({ savingsShare: 3_999, roundingToSavings: 3 });
  });

  it('3.3 a paycheck of one cent: needs, wants and Wishlist get nothing, savings gets the cent', () => {
    expect(splitPaycheck(1, 0, HER)).toMatchObject({ savings: 1, needs: 0, wants: 0, wishlist: 0 });
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 1));
    expect(book.pots()).toMatchObject({ savings: POTS.savings + 1, needs: POTS.needs, wants: POTS.wants, wishlist: POTS.wishlist });
  });

  it('3.3 Wishlist at 100%: all of the paycheck goes to Wishlist, and nothing is left to round', () => {
    const all = changeSettings(HER, { split: { savings: 0, needs: 0, wants: 0, wishlist: 100 } });
    expect(splitPaycheck(123_457, 0, all)).toMatchObject({ savings: 0, needs: 0, wants: 0, wishlist: 123_457 });
    const book = herBook({ split: { savings: 0, needs: 0, wants: 0, wishlist: 100 } });
    book.receive(paycheck('p1', PAYDAY, 123_457));
    expect(book.pots().wishlist).toBe(POTS.wishlist + 123_457);
  });

  it('3.3 Wishlist at 0%: the paycheck splits exactly as the three-way split does', () => {
    const zero = changeSettings(HER, { split: { savings: 50, needs: 30, wants: 20, wishlist: 0 } });
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX }), (amount) => {
        const four = splitPaycheck(amount, 0, zero);
        const three = splitPaycheck(amount, 0, { ...zero, split: { savings: 50, needs: 30, wants: 20 } });
        expect(four.wishlist).toBe(0);
        expect({ savings: four.savings, needs: four.needs, wants: four.wants }).toEqual({ savings: three.savings, needs: three.needs, wants: three.wants });
      }),
    );
  });

  it('3.3 the largest paycheck that stays exact splits exactly, and one too large is refused whole (0.1)', () => {
    const split = splitPaycheck(MAX, 0, HER);
    expect(split.savings + split.needs + split.wants + (split.wishlist ?? 0)).toBe(MAX);
    const book = herBook({}, { pots: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0, wishlist: MAX - 1 } });
    refused(book, 'not-cents', () => book.receive(paycheck('p1', PAYDAY, 100)));
  });

  it('3.3 at payday each bucket gets its part, Wishlist too, whether split by itself or at her yes (3.1)', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 250_000));
    expect(book.pots()).toMatchObject({ savings: 200_000, needs: 125_000, wants: 80_000, wishlist: 45_000 });
    const asking = herBook({ askBeforeSplittingPaycheck: true });
    asking.receive(paycheck('p1', PAYDAY, 250_000));
    expect(asking.pots().wishlist).toBe(POTS.wishlist);
    expect(asking.paychecksWaiting()[0]?.wouldGet).toMatchObject({ wishlist: 25_000 });
    asking.sort('p1', { to: 'paycheck' }, '2026-10-11');
    expect(asking.pots()).toMatchObject({ savings: 200_000, needs: 125_000, wants: 80_000, wishlist: 45_000 });
  });
});

describe('3.4 and 3.5 Wishlist at payday', () => {
  it('3.4 Wishlist is never asked about at payday: it always rolls over, whatever the leftover settings say', () => {
    for (const choice of ['ask', 'move-to-savings', 'roll-over'] as const) {
      const book = herBook({ leftoverAtPayday: { needs: choice, wants: choice } });
      book.receive(paycheck('p1', PAYDAY, 100_000));
      expect(book.pots().wishlist).toBe(POTS.wishlist + 10_000);
      expect(book.reviewItems().filter((item) => item.type === 'leftover').map((item) => item.type === 'leftover' && item.bucket)).toEqual(choice === 'ask' ? ['needs', 'wants'] : []);
      expect(JSON.stringify(book.reviewDetails())).not.toContain('wishlist');
    }
  });

  it('3.5 a negative Wishlist carries over as a negative at payday: nothing is asked, and the new share is added on top', () => {
    const book = herBook({}, { pots: { ...POTS, wishlist: 0 } });
    book.receive(purchase('c1', '2026-10-03', 1_500));
    book.sort('c1', { to: 'wishlist' }, '2026-10-03');
    expect(book.pots().wishlist).toBe(-1_500);
    book.receive(paycheck('p1', PAYDAY, 10_000));
    expect(book.pots().wishlist).toBe(-500);
    expect(book.periodSummary().opening.wishlist).toBe(-1_500);
  });
});

describe('3.8 what should be in the savings account', () => {
  it('3.8 savings plus Wishlist should be sitting in the savings account; the amount to move, and the extra on its own', () => {
    const book = herBook();
    expect(book.savingsTransfer(100_000)).toEqual({ shouldBeInSavings: 120_000, savingsAccountBalance: 100_000, stillToMove: 20_000 });
    expect(book.savingsTransfer(120_000)).toEqual({ shouldBeInSavings: 120_000, savingsAccountBalance: 120_000, stillToMove: 0 });
    expect(book.savingsTransfer(120_001)).toEqual({ shouldBeInSavings: 120_000, savingsAccountBalance: 120_001, stillToMove: 0, extraInSavings: 1 });
    book.receive(paycheck('p1', PAYDAY, 100_000));
    // Savings got 40,000 and Wishlist 10,000.
    expect(book.savingsTransfer(120_000).stillToMove).toBe(50_000);
  });
});

describe('4.2 and 4.4 spending to Wishlist', () => {
  it('4.2 spending goes to needs, wants or Wishlist: a purchase sorted to Wishlist comes out of it, on the day of the purchase', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-03', 4_999, 'MADE UP GADGETS'));
    expect(sortOptions(book, 'c1').picks.map((p) => p.to)).toEqual(['needs', 'wants', 'wishlist']);
    book.sort('c1', { to: 'wishlist' }, '2026-10-05');
    expect(book.pots()).toMatchObject({ wishlist: POTS.wishlist - 4_999, needs: POTS.needs, wants: POTS.wants, unsortedOut: 0 });
    expect(book.activity('wishlist').rows.map((r) => [r.id, r.amount, r.date])).toEqual([['c1', -4_999, '2026-10-03']]);
  });

  it('4.2 a debit card purchase, a fee or interest on a card, and money leaving savings can go to Wishlist too; a payment to a person cannot (7.6)', () => {
    const book = herBook();
    book.receive(purchase('d1', '2026-10-03', 100, 'MADE UP SHOP', { account: 'checking' }));
    book.receive(cardCharge('f1', '2026-10-03', 200, 'fee', 'second-card'));
    book.receive(cardCharge('i1', '2026-10-03', 300, 'interest'));
    book.receive(withdrawal('w1', '2026-10-03', 400));
    for (const id of ['d1', 'f1', 'i1', 'w1']) {
      expect(sortOptions(book, id).picks.map((p) => p.to)).toContain('wishlist');
      book.sort(id, { to: 'wishlist' }, '2026-10-04');
    }
    expect(book.pots().wishlist).toBe(POTS.wishlist - 1_000);
    book.receive(payPerson('z1', '2026-10-04', 500, 'MADE UP FRIEND'));
    expect(sortOptions(book, 'z1').picks.map((p) => p.to)).not.toContain('wishlist');
    expect(sortOptions(book, 'z1').split).not.toContain('wishlist');
    refused(book, 'bad-choice', () => book.sort('z1', { to: 'wishlist' }, '2026-10-04'));
    refused(book, 'bad-choice', () => book.sort('z1', { split: [{ bucket: 'needs', amount: 250 }, { bucket: 'wishlist', amount: 250 }] }, '2026-10-04'));
  });

  it('4.2 a sorting rule picks needs or wants, as before: Wishlist is picked by hand, so "always do this" and the rule offer never make one for it (13.6, 13.8)', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP GADGETS'));
    expect(sortOptions(book, 'c1').always).toEqual(['needs', 'wants']);
    refused(book, 'bad-choice', () => book.sortAlways('c1', { to: 'wishlist' }, { id: 'r1', contains: 'GADGETS' }, '2026-10-03'));
    expect(codeOf(() => book.addRule({ id: 'r1', for: 'purchase', contains: 'GADGETS', bucket: 'wishlist' as never }, '2026-10-03'))).toBe('bad-rule');
    book.sort('c1', { to: 'wishlist' }, '2026-10-03');
    book.receive(purchase('c2', '2026-10-04', 1_000, 'MADE UP GADGETS'));
    book.sort('c2', { to: 'wishlist' }, '2026-10-04');
    expect(book.ruleOffer('c2')).toBeNull();
  });

  it('4.4 a purchase can be split across needs, wants and Wishlist; the parts must add up to the total, a cent each at least', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-03', 10_000));
    expect(sortOptions(book, 'c1').split).toEqual(['needs', 'wants', 'wishlist']);
    refused(book, 'split-does-not-add-up', () => book.sort('c1', { split: [{ bucket: 'needs', amount: 3_000 }, { bucket: 'wants', amount: 3_000 }, { bucket: 'wishlist', amount: 3_999 }] }, '2026-10-03'));
    refused(book, 'not-positive', () => book.sort('c1', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wishlist', amount: 0 }] }, '2026-10-03'));
    book.sort('c1', { split: [{ bucket: 'needs', amount: 3_000 }, { bucket: 'wants', amount: 2_000 }, { bucket: 'wishlist', amount: 5_000 }] }, '2026-10-03');
    expect(book.pots()).toMatchObject({ needs: POTS.needs - 3_000, wants: POTS.wants - 2_000, wishlist: POTS.wishlist - 5_000 });
    // Two cents: one to wants, one to Wishlist.
    book.receive(purchase('c2', '2026-10-03', 2));
    book.sort('c2', { split: [{ bucket: 'wants', amount: 1 }, { bucket: 'wishlist', amount: 1 }] }, '2026-10-03');
    expect(book.pots().wishlist).toBe(POTS.wishlist - 5_001);
  });

  it('4.7 sorting a purchase again, into or out of Wishlist, changes the buckets right away', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-03', 2_500));
    book.sort('c1', { to: 'wants' }, '2026-10-03');
    const detail = book.resortDetail('c1');
    expect(detail?.resortable === true && detail.options.picks.map((p) => p.to)).toEqual(['needs', 'wants', 'wishlist']);
    book.sort('c1', { to: 'wishlist' }, '2026-10-04');
    expect(book.pots()).toMatchObject({ wants: POTS.wants, wishlist: POTS.wishlist - 2_500 });
    book.sort('c1', { to: 'needs' }, '2026-10-05');
    expect(book.pots()).toMatchObject({ needs: POTS.needs - 2_500, wishlist: POTS.wishlist });
  });
});

describe('4.5 and 4.10 Wishlist purchases refunded or taken back', () => {
  it('4.5 a refund of a Wishlist purchase goes back to Wishlist, matched by the bank or by her in review', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-03', 8_000, 'MADE UP GADGETS'));
    book.sort('c1', { to: 'wishlist' }, '2026-10-03');
    book.receive(refund('r1', '2026-10-06', 3_000, 'c1'));
    expect(book.pots().wishlist).toBe(POTS.wishlist - 5_000);
    // Not matched by the bank: it waits, then she matches it.
    book.receive(refund('r2', '2026-10-07', 5_000));
    expect(book.pots().unsortedIn).toBe(5_000);
    book.sort('r2', { refundOf: 'c1' }, '2026-10-07');
    expect(book.pots()).toMatchObject({ wishlist: POTS.wishlist, unsortedIn: 0 });
  });

  it('4.5 a refund of all of a split purchase gives Wishlist its part back; a partial one sends the purchase back to review', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-03', 9_000));
    book.sort('c1', { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 2_000 }, { bucket: 'wishlist', amount: 6_000 }] }, '2026-10-03');
    book.receive(refund('r1', '2026-10-05', 9_000, 'c1'));
    expect(book.pots()).toMatchObject({ needs: POTS.needs, wants: POTS.wants, wishlist: POTS.wishlist });
    book.receive(purchase('c2', '2026-10-06', 9_000));
    book.sort('c2', { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wishlist', amount: 8_000 }] }, '2026-10-06');
    book.receive(refund('r2', '2026-10-07', 1, 'c2'));
    expect(book.reviewItems().map((i) => i.id)).toEqual(['c2']);
    expect(book.pots()).toMatchObject({ wishlist: POTS.wishlist, unsortedOut: 8_999 });
  });

  it('4.5 a refund she cannot match can be payback into Wishlist (6.1)', () => {
    const book = herBook();
    book.receive(refund('r1', '2026-10-05', 700));
    expect(sortOptions(book, 'r1').picks.map((p) => p.to)).toContain('wishlist');
    book.sort('r1', { to: 'wishlist' }, '2026-10-05');
    expect(book.pots()).toMatchObject({ wishlist: POTS.wishlist + 700, unsortedIn: 0 });
  });

  it('4.10 the bank taking back a Wishlist purchase gives Wishlist its money back; taking back its refund takes it out again', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-03', 4_000));
    book.sort('c1', { to: 'wishlist' }, '2026-10-03');
    book.receive(takenBack('t1', 'c1', '2026-10-04'));
    expect(book.pots().wishlist).toBe(POTS.wishlist);
    book.receive(purchase('c2', '2026-10-05', 4_000));
    book.sort('c2', { to: 'wishlist' }, '2026-10-05');
    book.receive(refund('r2', '2026-10-06', 4_000, 'c2'));
    book.receive(takenBack('t2', 'r2', '2026-10-07'));
    expect(book.pots().wishlist).toBe(POTS.wishlist - 4_000);
  });

  it('4.6 a pending Wishlist purchase that posts at a new amount stays in Wishlist at the new amount; one dropped gives it back', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-03', 4_000, 'MADE UP STORE', { pending: true }));
    book.sort('c1', { to: 'wishlist' }, '2026-10-03');
    book.receive(posted('c1p', 'c1', '2026-10-04', 4_400));
    expect(book.pots().wishlist).toBe(POTS.wishlist - 4_400);
    book.receive(purchase('c2', '2026-10-05', 600, 'MADE UP STORE', { pending: true }));
    book.sort('c2', { to: 'wishlist' }, '2026-10-05');
    book.receive({ kind: 'pending-dropped', id: 'x2', pendingId: 'c2', date: '2026-10-06', description: 'HOLD RELEASED' });
    expect(book.pots().wishlist).toBe(POTS.wishlist - 4_400);
  });
});

describe('6.1 money in, and Wishlist', () => {
  it('6.1 other income is split by the percentages, four ways, with Wishlist rounded down too', () => {
    const book = herBook();
    book.receive(deposit('d1', '2026-10-03', 1_009, 'MADE UP GIFT'));
    book.sort('d1', { to: 'other-income' }, '2026-10-03');
    // 403.6, 302.7, 201.8 and 100.9: the 3 cents rounded off go to savings.
    expect(book.pots()).toMatchObject({ savings: POTS.savings + 406, needs: POTS.needs + 302, wants: POTS.wants + 201, wishlist: POTS.wishlist + 100 });
  });

  it('6.1 payback can go into Wishlist; a deposit rule still picks only what it did (6.2)', () => {
    const book = herBook();
    book.receive(deposit('d1', '2026-10-03', 2_000, 'MADE UP FRIEND PAID BACK'));
    const options = sortOptions(book, 'd1');
    expect(options.picks.map((p) => p.to)).toEqual(['paycheck', 'other-income', 'savings', 'needs', 'wants', 'wishlist', 'not-mine']);
    expect(options.always).not.toContain('wishlist');
    book.sort('d1', { to: 'wishlist' }, '2026-10-03');
    expect(book.pots().wishlist).toBe(POTS.wishlist + 2_000);
    expect(codeOf(() => book.addRule({ id: 'r1', for: 'deposit', contains: 'FRIEND', choice: { to: 'wishlist' as never } }, '2026-10-03'))).toBe('bad-rule');
  });
});

describe('10.1, 10.2 and 11.3: Wishlist has no alerts and is not safe to spend', () => {
  it('10.1 and 10.2 the low and empty alerts are for needs and wants only: Wishlist at zero or below gives none', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-03', POTS.wishlist + 1));
    book.sort('c1', { to: 'wishlist' }, '2026-10-03');
    const alerts = book.takeAlerts({ bankBalances: { checking: 0, savings: 0, everydayCard: 0, secondCard: 0 }, bankConnection: 'ok' });
    expect(alerts.filter((a) => a.kind === 'low-bucket' || a.kind === 'empty-bucket')).toEqual([]);
  });

  it('11.3 Wishlist is never part of safe to spend: it is wants left, minus unsorted spending', () => {
    const book = herBook();
    expect(book.safeToSpend('2026-10-02').amount).toBe(POTS.wants);
    book.receive(paycheck('p1', PAYDAY, 100_000));
    book.moveMoney({ from: 'needs', to: 'wishlist', amount: 1_000 }, '2026-10-09');
    book.receive(purchase('c1', '2026-10-10', 700));
    expect(book.safeToSpend('2026-10-10').amount).toBe(POTS.wants + 20_000 - 700);
  });
});

describe('12.2 the app side, with Wishlist', () => {
  it('12.2 the app side is savings + needs + wants + Wishlist + held for others + unsorted money in - unsorted spending', () => {
    const book = herBook();
    expect(book.appSide()).toBe(200_000);
    book.receive(purchase('c1', '2026-10-03', 1_000));
    book.receive(deposit('d1', '2026-10-03', 300));
    expect(book.appSide()).toBe(appSide(book));
    expect(book.appSide()).toBe(199_300);
    // Bank side: checking 150,300 + savings 50,000 - the Capital One card 1,000 - the Amex card 0.
    const bank = { checking: 150_300, savings: 50_000, everydayCard: 1_000, secondCard: 0 };
    expect(book.selfCheck(bank)).toMatchObject({ ok: true, difference: 0 });
    book.sort('c1', { to: 'wishlist' }, '2026-10-03');
    expect(book.selfCheck(bank)).toMatchObject({ ok: true, difference: 0 });
    // A cent off on Wishlist is a cent off the check.
    expect(book.selfCheck({ ...bank, checking: 150_301 })).toMatchObject({ ok: false, difference: 1 });
  });

  it('12.2 a transfer between her own accounts never changes Wishlist (5.1, 5.3)', () => {
    const book = herBook();
    book.receive(transfer('t1', '2026-10-03', 5_000, 'savings', 'checking'));
    book.receive(transfer('t2', '2026-10-03', 5_000, 'checking', 'second-card'));
    book.receive(transfer('t3', '2026-10-03', 1_000, 'checking', 'savings'));
    expect(book.pots()).toMatchObject({ ...POTS, unsortedIn: 0, unsortedOut: 0 });
  });
});

describe('13.1, 13.3 and 13.4: changing the split, and hand moves', () => {
  it("13.1 a change to Wishlist's share waits for the next paycheck, like the rest of the split; other income keeps this pay period's", () => {
    const book = herBook();
    book.changeSettings({ split: { savings: 30, needs: 30, wants: 20, wishlist: 20 } }, '2026-10-02');
    expect(book.splitInForce().split).toEqual(SPLIT);
    book.receive(deposit('d1', '2026-10-03', 1_000));
    book.sort('d1', { to: 'other-income' }, '2026-10-03');
    expect(book.pots().wishlist).toBe(POTS.wishlist + 100);
    book.receive(paycheck('p1', PAYDAY, 10_000));
    expect(book.pots().wishlist).toBe(POTS.wishlist + 100 + 2_000);
    expect(book.splitInForce().split).toEqual({ savings: 30, needs: 30, wants: 20, wishlist: 20 });
  });

  it('13.3 money can be moved into and out of Wishlist by hand, and the move is logged (13.5)', () => {
    const book = herBook();
    expect(book.moveMoney({ from: 'wants', to: 'wishlist', amount: 2_500 }, '2026-10-02')).toEqual({ moved: true });
    expect(book.pots()).toMatchObject({ wants: POTS.wants - 2_500, wishlist: POTS.wishlist + 2_500 });
    expect(book.changeLog().at(-1)).toEqual({ date: '2026-10-02', kind: 'money-moved', from: 'wants', to: 'wishlist', amount: 2_500 });
    expect(book.activity('wishlist').rows[0]).toMatchObject({ what: 'move', amount: 2_500, other: 'wants' });
  });

  it('13.4 moving money out of Wishlist asks her to confirm first, as out of savings does; so does a move that leaves it below zero', () => {
    const book = herBook();
    const before = state(book);
    expect(book.moveMoney({ from: 'wishlist', to: 'wants', amount: 1 }, '2026-10-02')).toEqual({ moved: false, needsConfirmation: true, reasons: ['out-of-wishlist'] });
    expect(book.moveMoney({ from: 'wishlist', to: 'savings', amount: POTS.wishlist + 1 }, '2026-10-02')).toEqual({ moved: false, needsConfirmation: true, reasons: ['out-of-wishlist', 'below-zero'] });
    expect(state(book)).toBe(before);
    expect(book.moveMoney({ from: 'wishlist', to: 'wants', amount: POTS.wishlist, confirmed: true }, '2026-10-02')).toEqual({ moved: true });
    expect(book.pots().wishlist).toBe(0);
    // Into Wishlist from needs asks nothing.
    expect(book.moveMoney({ from: 'needs', to: 'wishlist', amount: 1 }, '2026-10-02')).toEqual({ moved: true });
  });
});

describe('14.2 setup day', () => {
  it('14.2 the starting money is assigned across savings, needs, wants, Wishlist and held for others, and must add up exactly', () => {
    const input = {
      date: START_DATE,
      bankBalances: { checking: 120_000, savings: 80_000, everydayCard: 5_000, secondCard: 3_000 },
      pendingCharges: [],
      oldCardBalance: 0,
      lastPaycheckDate: LAST_PAYCHECK,
      settings: HER,
      switches: HER_SWITCHES,
    };
    const short = startTracking({ ...input, assignment: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0, wishlist: 11_999 } });
    expect(short).toMatchObject({ ok: false, startingMoney: 192_000, assigned: 191_999, difference: 1 });
    const setup = startTracking({ ...input, assignment: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0, wishlist: 12_000 } });
    if (!setup.ok) throw new Error('setup day did not start');
    expect(setup.book.pots()).toMatchObject({ wishlist: 12_000 });
    expect(setup.book.periodSummary().opening.wishlist).toBe(12_000);
    // Assigning nothing to it is 0, not missing.
    const none = startTracking({ ...input, assignment: { savings: 112_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 } });
    expect(none.ok && none.book.pots().wishlist).toBe(0);
  });
});

describe('52.4 the statement, with Wishlist', () => {
  it('52.4 a purchase sorted to Wishlist is listed under Wishlist, between wants and still unsorted, and the lines still add up', () => {
    const book = herBook();
    book.receive(purchase('c1', '2026-10-10', 1_000, 'MADE UP GROCER'));
    book.sort('c1', { to: 'needs' }, '2026-10-10');
    book.receive(purchase('c2', '2026-10-11', 6_000, 'MADE UP GADGETS'));
    book.sort('c2', { split: [{ bucket: 'wants', amount: 1_000 }, { bucket: 'wishlist', amount: 5_000 }] }, '2026-10-11');
    book.receive(purchase('c3', '2026-10-12', 900, 'MADE UP SHOP'));
    book.receive(refund('r3', '2026-10-13', 500));
    book.sort('r3', { to: 'wishlist' }, '2026-10-13');
    const view = cardStatementView({ statement: { card: 'everyday-card', closingDate: '2026-11-05', dueDate: '2026-11-30', statementBalance: 7_400, minimumPayment: 2_500 }, before: { card: 'everyday-card', closingDate: '2026-10-05', dueDate: '2026-10-30', statementBalance: 0, minimumPayment: 0 }, book });
    expect(view.byBucket.map((g) => [g.bucket, g.total])).toEqual([
      ['needs', 1_000],
      ['wants', 1_000],
      ['wishlist', 4_500],
      ['unsorted', 900],
    ]);
    expect(view.notMatched).toBe(0);
    expect(view.carriedIn.amount + view.charges + view.notMatched).toBe(view.statementBalance);
  });
});

describe('40.2 Trends reads what each item spent out of Wishlist (PR 10+11)', () => {
  it("40.2 wishlistSpentIn: each item's Wishlist part, less refunds, in the pay period it was counted in; needs and wants are spentIn's, as before", () => {
    const book = herBook();
    book.receive(purchase('w1', '2026-10-03', 4_500, 'MADE UP LAMPS'));
    book.sort('w1', { to: 'wishlist' }, '2026-10-03');
    book.receive(purchase('s1', '2026-10-04', 9_000, 'MADE UP BIG BOX'));
    book.sort('s1', { split: [{ bucket: 'needs', amount: 7_000 }, { bucket: 'wishlist', amount: 2_000 }] }, '2026-10-04');
    book.receive(refund('w1-back', '2026-10-05', 500, 'w1'));
    expect(book.wishlistSpentIn().map((s) => [s.id, s.pot, s.amount])).toEqual([
      ['w1', 'wishlist', 4_000],
      ['s1', 'wishlist', 2_000],
    ]);
    expect(book.spentIn().map((s) => [s.id, s.pot, s.amount])).toEqual([['s1', 'needs', 7_000]]);
  });

  it("40.2 upstream's setup has no Wishlist part: wishlistSpentIn is refused", () => {
    const book = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 }, settings: DEFAULT_SETTINGS });
    expect(codeOf(() => book.wishlistSpentIn())).toBe('off-in-this-setup');
  });
});

// Her rulebook, PR 4: "Ask before splitting a paycheck" (section 2, 3.1,
// 51.1 to 51.3, and 13.2's added sentence). With the setting off, upstream's
// own tests cover 3.1; these are about the setting, on her setup.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HER_SETTINGS,
  HER_SWITCHES,
  addDays,
  changeSettings,
  daysBetween,
  openBook,
  splitPaycheck,
  validateSettings,
  type Book,
  type Cents,
  type IsoDate,
  type OpenBookInput,
  type ReviewDetail,
  type ReviewOptions,
  type Settings,
} from '../src/index.js';
import { LAST_PAYCHECK, PAYROLL, START_DATE, TestBank, codeOf, deposit, paycheck, purchase, takenBack } from './helpers.js';
import { runs } from './slow.js';

const HER: Settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL } });
const POTS = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 };
// PR 9: her setup has Wishlist, at 0% here.
const START = { ...POTS, unsortedIn: 0, unsortedOut: 0, wishlist: 0 };
const MAX = Number.MAX_SAFE_INTEGER;

// LAST_PAYCHECK is Sep 25, so Oct 9 is the next payday (14 days) and
// anything before Oct 5 is less than 10 days after it (3.7).
const PAYDAY: IsoDate = '2026-10-09';

function herBook(settings: Partial<Settings> = {}, input: Partial<OpenBookInput> = {}): Book {
  return openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: changeSettings(HER, settings), switches: HER_SWITCHES, ...input });
}

// Everything a refused answer must leave as it was.
function state(book: Book): string {
  return JSON.stringify({
    pots: book.pots(),
    review: book.reviewDetails(),
    waiting: book.paychecksWaiting(),
    log: book.changeLog(),
    period: book.period(),
    paychecks: book.paychecks(),
    last: book.lastPaycheckDate(),
    recount: book.recountPots(),
  });
}

function refused(book: Book, code: string, run: () => unknown): void {
  const before = state(book);
  expect(codeOf(run)).toBe(code);
  expect(state(book)).toBe(before);
}

function detailOf(book: Book, id: string): ReviewDetail {
  const detail = book.reviewDetails().find((d) => d.item.id === id);
  if (detail === undefined) throw new Error(`${id} is not waiting`);
  return detail;
}

function sortOptions(detail: ReviewDetail): Extract<ReviewOptions, { type: 'sort' }> {
  if (detail.options.type !== 'sort') throw new Error('expected an item to sort');
  return detail.options;
}

const parts = (amount: Cents, settings: Settings = HER) => splitPaycheck(amount, 0, settings);

describe('Section 2: "Ask before splitting a paycheck"', () => {
  it('Section 2: it is on in her setup; upstream\'s settings do not have it, and without it, it is off, as upstream (B242)', () => {
    expect(HER_SETTINGS.askBeforeSplittingPaycheck).toBe(true);
    expect(Object.hasOwn(DEFAULT_SETTINGS, 'askBeforeSplittingPaycheck')).toBe(false);
    const upstream = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: changeSettings(DEFAULT_SETTINGS, { paycheckRule: { contains: PAYROLL } }) });
    expect(upstream.receive(paycheck('p1', PAYDAY, 400_000)).outcome).toBe('paycheck');
    expect(upstream.paychecksWaiting()).toEqual([]);
    // Upstream's book can turn it on too: it is a setting like any other.
    upstream.changeSettings({ askBeforeSplittingPaycheck: true }, '2026-10-10');
    expect(upstream.receive(paycheck('p2', '2026-10-23', 400_000)).outcome).toBe('review');
  });

  it('Section 2: it is on or off, nothing else', () => {
    for (const value of [1, 'on', null, undefined, 'false']) {
      expect(codeOf(() => validateSettings({ ...HER, askBeforeSplittingPaycheck: value as unknown as boolean })), String(value)).toBe('bad-setting');
    }
  });

  it('Section 2: changing it applies at once and is logged (13.5)', () => {
    const book = herBook();
    book.changeSettings({ askBeforeSplittingPaycheck: false }, '2026-10-02');
    expect(book.settings().askBeforeSplittingPaycheck).toBe(false);
    expect(book.changeLog()).toEqual([{ date: '2026-10-02', kind: 'settings-changed', changes: { askBeforeSplittingPaycheck: false }, before: { askBeforeSplittingPaycheck: true } }]);
    expect(book.receive(paycheck('p1', PAYDAY, 400_000)).outcome).toBe('paycheck');
  });
});

describe('3.1 with "Ask before splitting a paycheck" on, a paycheck waits for your yes', () => {
  it('3.1 a deposit the paycheck rule matches waits in review: nothing is split and no pay period starts', () => {
    const book = herBook();
    expect(book.receive(paycheck('p1', PAYDAY, 400_000)).outcome).toBe('review');
    expect(book.pots()).toEqual({ ...START, unsortedIn: 400_000 });
    expect(book.period()).toEqual({ number: 0, startDate: START_DATE });
    expect(book.paychecks()).toEqual([]);
    expect(book.lastPaycheckDate()).toBe(LAST_PAYCHECK);
    expect(book.reviewItems()).toEqual([{ type: 'money-in', id: 'p1', date: PAYDAY, amount: 400_000, description: `${PAYROLL} DIRECT DEP`, reason: 'paycheck' }]);
    expect(book.recountPots()).toEqual(book.pots());
  });

  it('3.1 it shows the amount and what each bucket would get (3.3)', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    const detail = detailOf(book, 'p1');
    expect(detail.item.amount).toBe(400_000);
    expect(detail.paycheckPreview).toEqual(parts(400_000));
    expect(detail.paycheckPreview).toMatchObject({ momReserve: 0, savings: 200_000, needs: 120_000, wants: 80_000 });
  });

  it('3.1 what it would get is the split the next paycheck uses (13.1), not the one in force', () => {
    const book = herBook();
    book.changeSettings({ split: { savings: 40, needs: 40, wants: 20, wishlist: 0 } }, '2026-10-02');
    book.receive(paycheck('p1', PAYDAY, 400_000));
    expect(book.splitInForce().split).toEqual({ savings: 50, needs: 30, wants: 20, wishlist: 0 });
    expect(detailOf(book, 'p1').paycheckPreview).toMatchObject({ savings: 160_000, needs: 160_000, wants: 80_000 });
  });

  it('3.1 yes splits it exactly as splitPaycheck does, and starts the new pay period on the day it arrived, not the day you answer', () => {
    const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.sort('p1', { to: 'paycheck' }, '2026-10-12');
    const split = parts(400_000);
    expect(book.pots()).toEqual({ ...START, savings: 100_000 + split.savings, needs: 50_000 + split.needs, wants: 30_000 + split.wants });
    expect(book.paychecks()).toEqual([{ id: 'p1', date: PAYDAY, amount: 400_000, split }]);
    expect(book.period()).toEqual({ number: 1, startDate: PAYDAY });
    expect(book.lastPaycheckDate()).toBe(PAYDAY);
    expect(book.reviewItems()).toEqual([]);
    expect(book.recountPots()).toEqual(book.pots());
  });

  it('3.1 the next payday counts from the day it arrived, not the day you said yes (B53)', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.sort('p1', { to: 'paycheck' }, '2026-10-13');
    expect(book.safeToSpend('2026-10-13')).toMatchObject({ nextPayday: '2026-10-23', daysToPayday: 10 });
  });

  it('3.1 the leftover question (3.4) comes at the yes, not before, and asks about what is in each bucket then', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    expect(book.reviewItems().filter((i) => i.type === 'leftover')).toEqual([]);
    book.receive(purchase('c1', '2026-10-10', 2_500, 'MADE UP GROCER', { account: 'checking' }));
    book.sort('c1', { to: 'needs' }, '2026-10-10');
    book.sort('p1', { to: 'paycheck' }, '2026-10-11');
    const questions = book.reviewItems().filter((i) => i.type === 'leftover');
    expect(questions).toMatchObject([
      { bucket: 'needs', amount: 47_500, date: PAYDAY },
      { bucket: 'wants', amount: 30_000, date: PAYDAY },
    ]);
  });

  it('3.1 spending counted between the arrival and the yes stays in the pay period it was counted in; after the yes, the new one (B53, B97)', () => {
    const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.receive(purchase('c1', '2026-10-10', 2_500, 'MADE UP GROCER', { account: 'checking' }));
    book.sort('c1', { to: 'needs' }, '2026-10-10');
    book.sort('p1', { to: 'paycheck' }, '2026-10-11');
    book.receive(purchase('c2', '2026-10-10', 1_000, 'MADE UP GROCER', { account: 'checking' }));
    book.sort('c2', { to: 'needs' }, '2026-10-11');
    const before = book.activity('needs', 0);
    const after = book.activity('needs', 1);
    expect(before.rows.map((r) => r.id)).toEqual(['c1']);
    expect(before.closing).toBe(47_500);
    expect(after.opening).toBe(47_500);
    expect(after.rows.map((r) => r.id)).toEqual(['c2', 'p1']);
    expect(after.closing).toBe(47_500 + parts(400_000).needs - 1_000);
    expect(book.pots().needs).toBe(after.closing);
  });

  it('3.1 "Not a paycheck" gives it the other choices of 6.1: other income, payback, not mine', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    const options = sortOptions(detailOf(book, 'p1'));
    expect(options.picks).toEqual([
      { to: 'paycheck', final: true },
      { to: 'other-income', final: false },
      { to: 'savings', final: false },
      { to: 'needs', final: false },
      { to: 'wants', final: false },
      // PR 9: payback into Wishlist too (6.1).
      { to: 'wishlist', final: false },
      { to: 'not-mine', final: false },
    ]);
    expect(options.unavailable).toEqual([]);
    // A deposit the paycheck rule matches gets no sorting rule (6.2, B55).
    expect(options.always).toEqual([]);
  });

  it('3.1 "Not a paycheck", as other income: split by this pay period\'s percentages, and no pay period starts', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.sort('p1', { to: 'other-income' }, '2026-10-10');
    expect(book.pots()).toEqual({ ...START, savings: 300_000, needs: 170_000, wants: 110_000 });
    expect(book.period().number).toBe(0);
    expect(book.lastPaycheckDate()).toBe(LAST_PAYCHECK);
    expect(book.paychecksWaiting()).toEqual([]);
  });

  it('3.1 "Not a paycheck" as payback or not mine', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.receive(paycheck('p2', PAYDAY, 1_000));
    book.sort('p1', { to: 'not-mine' }, '2026-10-10');
    book.sort('p2', { to: 'wants' }, '2026-10-10');
    expect(book.pots()).toEqual({ ...START, heldForOthers: 400_000, wants: 31_000 });
  });

  it('3.1 one answered "not a paycheck" can still be made your paycheck later, from the day it arrived (B52)', () => {
    const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.sort('p1', { to: 'other-income' }, '2026-10-10');
    const resort = book.resortDetail('p1');
    expect(resort?.resortable && resort.options.picks[0]).toEqual({ to: 'paycheck', final: true });
    book.sort('p1', { to: 'paycheck' }, '2026-10-14');
    const split = parts(400_000);
    expect(book.pots()).toEqual({ ...START, savings: 100_000 + split.savings, needs: 50_000 + split.needs, wants: 30_000 + split.wants });
    expect(book.period()).toEqual({ number: 1, startDate: PAYDAY });
    expect(book.recountPots()).toEqual(book.pots());
  });

  it('3.1 with the setting off, a deposit the paycheck rule matches is split by itself and starts a new pay period', () => {
    const book = herBook({ askBeforeSplittingPaycheck: false, leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    expect(book.receive(paycheck('p1', PAYDAY, 400_000)).outcome).toBe('paycheck');
    expect(book.period()).toEqual({ number: 1, startDate: PAYDAY });
    expect(book.reviewItems()).toEqual([]);
  });

  it('3.1 a deposit the paycheck rule does not match waits as any deposit does (6.1), setting on or off', () => {
    for (const ask of [true, false]) {
      const book = herBook({ askBeforeSplittingPaycheck: ask });
      book.receive(deposit('d1', PAYDAY, 400_000, 'MADE UP NEW JOB'));
      expect(book.reviewItems()).toMatchObject([{ id: 'd1', reason: 'deposit' }]);
      expect(book.paychecksWaiting()).toEqual([]);
    }
  });

  it('3.1 a paycheck of one cent waits, and yes puts the cent in savings (3.3 rounding)', () => {
    const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 1));
    expect(book.pots()).toEqual({ ...START, unsortedIn: 1 });
    expect(detailOf(book, 'p1').paycheckPreview).toMatchObject({ savings: 1, needs: 0, wants: 0 });
    book.sort('p1', { to: 'paycheck' }, PAYDAY);
    expect(book.pots()).toEqual({ ...START, savings: 100_001 });
  });

  it('3.1 a paycheck at each rounding boundary: yes gives exactly the parts it showed', () => {
    // 50/30/20: 100 cents splits evenly; 99 and 101 leave cents to savings.
    for (const [amount, savings, needs, wants] of [
      [100, 50, 30, 20],
      [99, 51, 29, 19],
      [101, 51, 30, 20],
      [9, 6, 2, 1],
      [10, 5, 3, 2],
    ] as const) {
      const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
      book.receive(paycheck('p1', PAYDAY, amount));
      expect(detailOf(book, 'p1').paycheckPreview, String(amount)).toMatchObject({ savings, needs, wants });
      book.sort('p1', { to: 'paycheck' }, PAYDAY);
      expect(book.pots(), String(amount)).toEqual({ ...START, savings: 100_000 + savings, needs: 50_000 + needs, wants: 30_000 + wants });
    }
  });

  it('3.1 a yes on the day the next paycheck is due still starts the pay period on the day it arrived', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    expect(book.safeToSpend('2026-10-23')).toMatchObject({ nextPayday: PAYDAY, daysToPayday: -14 });
    book.sort('p1', { to: 'paycheck' }, '2026-10-23');
    expect(book.period()).toEqual({ number: 1, startDate: PAYDAY });
    expect(book.safeToSpend('2026-10-23')).toMatchObject({ nextPayday: '2026-10-23', daysToPayday: 0 });
    // The next one, that same day, waits for its own yes.
    expect(book.receive(paycheck('p2', '2026-10-23', 400_000)).outcome).toBe('review');
  });

  it('3.1 a very large paycheck: a yes too large to stay exact (0.1) is refused, and it keeps waiting with nothing changed', () => {
    const book = herBook({}, { pots: { ...POTS, savings: MAX - 100_000 } });
    book.receive(paycheck('p1', PAYDAY, 1_000_000));
    refused(book, 'not-cents', () => book.sort('p1', { to: 'paycheck' }, PAYDAY));
    expect(book.paychecksWaiting().map((p) => p.id)).toEqual(['p1']);
    book.sort('p1', { to: 'not-mine' }, PAYDAY);
    expect(book.pots().heldForOthers).toBe(1_000_000);
  });

  it('3.1 a paycheck too large for the waiting money itself is refused when it arrives, and the book is unchanged (0.1)', () => {
    const book = herBook();
    book.receive(deposit('d0', '2026-10-02', MAX - 1_000, 'MADE UP INHERITANCE'));
    refused(book, 'not-cents', () => book.receive(paycheck('p1', PAYDAY, 2_000)));
  });

  it('3.1 the bank taking back a waiting paycheck takes it out of review, and no bucket changes (4.10)', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.receive(takenBack('t1', 'p1', '2026-10-10'));
    expect(book.pots()).toEqual(START);
    expect(book.reviewItems()).toEqual([]);
    expect(book.paychecksWaiting()).toEqual([]);
    expect(codeOf(() => book.sort('p1', { to: 'paycheck' }, '2026-10-10'))).toBe('not-sortable');
  });

  it('3.1 a deposit rule that matches a waiting paycheck does not sort it: it still waits for your yes (6.2, B55)', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    const { stillWaiting } = book.addRule({ id: 'r1', for: 'deposit', contains: PAYROLL, choice: { to: 'other-income' } }, '2026-10-10');
    expect(stillWaiting).toEqual([]);
    expect(book.reviewItems()).toMatchObject([{ id: 'p1', reason: 'paycheck' }]);
    expect(codeOf(() => book.sortAlways('p1', { to: 'other-income' }, { id: 'r2', contains: PAYROLL }, '2026-10-10'))).toBe('no-rule-for-this');
  });
});

describe('51.1 a paycheck waiting for your yes', () => {
  it('51.1 it is money in waiting in review: it counts in the self-check (12.2) and not in safe to spend (11.3)', () => {
    const book = herBook();
    const bank = { checking: 80_000, savings: 100_000, everydayCard: 0 };
    expect(book.selfCheck(bank).ok).toBe(true);
    const safe = book.safeToSpend('2026-10-09').amount;
    book.receive(paycheck('p1', PAYDAY, 400_000));
    expect(book.selfCheck({ ...bank, checking: bank.checking + 400_000 })).toMatchObject({ ok: true, difference: 0 });
    expect(book.appSide()).toBe(180_000 + 400_000);
    expect(book.safeToSpend('2026-10-09').amount).toBe(safe);
  });

  it('51.1 Home lists it with its amount: the paychecks waiting, oldest first, with what each would get', () => {
    const book = herBook();
    book.receive(paycheck('p2', '2026-10-23', 300_000));
    book.receive(paycheck('p1', PAYDAY, 400_000));
    expect(book.paychecksWaiting()).toEqual([
      { id: 'p1', date: PAYDAY, amount: 400_000, description: `${PAYROLL} DIRECT DEP`, early: false, wouldGet: parts(400_000) },
      { id: 'p2', date: '2026-10-23', amount: 300_000, description: `${PAYROLL} DIRECT DEP`, early: false, wouldGet: parts(300_000) },
    ]);
  });

  it('51.1 if the split it would get changes while it waits (13.1), Review shows the new parts, and yes splits by them', () => {
    const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    const shown = detailOf(book, 'p1').paycheckPreview;
    book.changeSettings({ split: { savings: 60, needs: 25, wants: 15, wishlist: 0 } }, '2026-10-10');
    const now = detailOf(book, 'p1').paycheckPreview;
    expect(now).not.toEqual(shown);
    expect(now).toMatchObject({ savings: 240_000, needs: 100_000, wants: 60_000 });
    expect(book.paychecksWaiting()[0]?.wouldGet).toEqual(now);
    book.sort('p1', { to: 'paycheck' }, '2026-10-11');
    expect(book.paychecks()[0]?.split).toEqual(now);
    expect(book.splitInForce().split).toEqual({ savings: 60, needs: 25, wants: 15, wishlist: 0 });
  });

  it('51.1 it is no longer waiting once answered either way', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.receive(paycheck('p2', '2026-10-23', 400_000));
    book.sort('p1', { to: 'paycheck' }, '2026-10-23');
    book.sort('p2', { to: 'other-income' }, '2026-10-23');
    expect(book.paychecksWaiting()).toEqual([]);
  });
});

describe('51.2 two paychecks waiting: the older one is answered first', () => {
  function twoWaiting(settings: Partial<Settings> = {}): Book {
    const book = herBook(settings);
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.receive(paycheck('p2', '2026-10-23', 300_000));
    return book;
  }

  it('51.2 a yes to the newer one is refused while the older one waits, and says so; nothing changes', () => {
    const book = twoWaiting();
    refused(book, 'older-paycheck-waiting', () => book.sort('p2', { to: 'paycheck' }, '2026-10-23'));
    try {
      book.sort('p2', { to: 'paycheck' }, '2026-10-23');
    } catch (error) {
      expect(String(error)).toContain('older paycheck from 2026-10-09 is still waiting');
    }
  });

  it('51.2 Review says so on the newer one: its yes is not offered until the older one is answered', () => {
    const book = twoWaiting();
    const newer = sortOptions(detailOf(book, 'p2'));
    expect(newer.picks.map((p) => p.to)).not.toContain('paycheck');
    expect(newer.unavailable).toEqual([{ what: 'paycheck', why: 'An older paycheck is still waiting. Answer it first.' }]);
    expect(sortOptions(detailOf(book, 'p1')).picks[0]).toEqual({ to: 'paycheck', final: true });
    // What the newer one would get is still shown.
    expect(detailOf(book, 'p2').paycheckPreview).toEqual(parts(300_000));
  });

  it('51.2 "not a paycheck" on the newer one is not a yes: it can be answered', () => {
    const book = twoWaiting();
    book.sort('p2', { to: 'not-mine' }, '2026-10-23');
    expect(book.paychecksWaiting().map((p) => p.id)).toEqual(['p1']);
  });

  it('51.2 once the older one is answered, by yes or by "not a paycheck", the newer one can be', () => {
    for (const first of ['paycheck', 'other-income'] as const) {
      const book = twoWaiting({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
      book.sort('p1', { to: first }, '2026-10-23');
      book.sort('p2', { to: 'paycheck' }, '2026-10-23');
      expect(book.period(), first).toEqual({ number: first === 'paycheck' ? 2 : 1, startDate: '2026-10-23' });
    }
  });

  it('51.2 calling another deposit your paycheck (B52) is refused too while an older paycheck waits', () => {
    const book = herBook();
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.receive(deposit('d1', '2026-10-12', 50_000, 'MADE UP NEW JOB'));
    refused(book, 'older-paycheck-waiting', () => book.sort('d1', { to: 'paycheck' }, '2026-10-12'));
    book.sort('d1', { to: 'other-income' }, '2026-10-12');
    refused(book, 'older-paycheck-waiting', () => book.sort('d1', { to: 'paycheck' }, '2026-10-12'));
    // A deposit from before the waiting paycheck is the older one itself.
    book.receive(deposit('d0', '2026-10-08', 50_000, 'MADE UP NEW JOB'));
    book.sort('d0', { to: 'paycheck' }, '2026-10-12');
    expect(book.lastPaycheckDate()).toBe('2026-10-08');
  });

  it('51.2 two on the same day: neither is older, so either can be answered first', () => {
    const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.receive(paycheck('p2', PAYDAY, 100_000));
    book.sort('p2', { to: 'paycheck' }, PAYDAY);
    book.sort('p1', { to: 'paycheck' }, PAYDAY);
    expect(book.paychecks().map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('51.2 one older than the last paycheck, which can no longer be your paycheck (B54), holds no newer one up', () => {
    const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.sort('p1', { to: 'paycheck' }, PAYDAY);
    // The bank sends one dated before it, late.
    book.receive(paycheck('p0', '2026-10-06', 50_000));
    book.receive(paycheck('p2', '2026-10-23', 400_000));
    expect(sortOptions(detailOf(book, 'p0')).unavailable.map((u) => u.what)).toEqual(['paycheck']);
    // 51.1: it can no longer be her paycheck, so Home says what it would get for none.
    expect(book.paychecksWaiting().find((p) => p.id === 'p0')?.wouldGet).toBeNull();
    expect(detailOf(book, 'p0').paycheckPreview).toBeNull();
    book.sort('p2', { to: 'paycheck' }, '2026-10-23');
    expect(book.lastPaycheckDate()).toBe('2026-10-23');
  });

  it('51.2 with the setting off, paychecks waiting in review can be answered in any order, as upstream', () => {
    const book = herBook({ askBeforeSplittingPaycheck: false, leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } }, { lastPaycheckDate: '2026-10-01' });
    book.receive(paycheck('p1', '2026-10-03', 400_000));
    book.receive(paycheck('p2', '2026-10-05', 400_000));
    expect(book.reviewItems().map((i) => i.type === 'money-in' && i.reason)).toEqual(['early-paycheck', 'early-paycheck']);
    book.sort('p2', { to: 'paycheck' }, '2026-10-05');
    expect(book.lastPaycheckDate()).toBe('2026-10-05');
  });
});

describe('51.3 the early paycheck check (3.7) still applies', () => {
  it('51.3 a paycheck less than 10 days after the last one waits, and says so: early', () => {
    const book = herBook();
    expect(book.receive(paycheck('p1', '2026-10-04', 400_000)).outcome).toBe('review');
    expect(book.reviewItems()).toMatchObject([{ id: 'p1', reason: 'early-paycheck' }]);
    expect(book.paychecksWaiting()).toEqual([{ id: 'p1', date: '2026-10-04', amount: 400_000, description: `${PAYROLL} DIRECT DEP`, early: true, wouldGet: parts(400_000) }]);
    expect(sortOptions(detailOf(book, 'p1')).picks[0]).toEqual({ to: 'paycheck', final: true });
  });

  it('51.3 exactly 10 days after is not early: it waits as any paycheck does', () => {
    const book = herBook();
    book.receive(paycheck('p1', '2026-10-05', 400_000));
    expect(book.reviewItems()).toMatchObject([{ id: 'p1', reason: 'paycheck' }]);
    expect(book.paychecksWaiting()[0]?.early).toBe(false);
  });

  it('51.3 an early paycheck waiting is answered in order with the others (51.2)', () => {
    const book = herBook();
    book.receive(paycheck('p1', '2026-10-04', 400_000));
    book.receive(paycheck('p2', '2026-10-16', 400_000));
    refused(book, 'older-paycheck-waiting', () => book.sort('p2', { to: 'paycheck' }, '2026-10-16'));
    book.sort('p1', { to: 'paycheck' }, '2026-10-16');
    // p2 is now 12 days after the last paycheck.
    book.sort('p2', { to: 'paycheck' }, '2026-10-16');
    expect(book.paychecks().map((p) => p.date)).toEqual(['2026-10-04', '2026-10-16']);
  });

  it('51.3 with the setting off, an early paycheck waits as upstream, and is not one waiting for a yes', () => {
    const book = herBook({ askBeforeSplittingPaycheck: false });
    book.receive(paycheck('p1', '2026-10-04', 400_000));
    expect(book.reviewItems()).toMatchObject([{ id: 'p1', reason: 'early-paycheck' }]);
    expect(book.paychecksWaiting()).toEqual([]);
  });
});

describe('13.2 setting the paycheck rule while "Ask before splitting a paycheck" is on', () => {
  it('13.2 matching deposits become paychecks waiting for your yes; none is split', () => {
    const book = herBook({ paycheckRule: null });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.receive(paycheck('p0', '2026-10-03', 100_000));
    expect(book.reviewItems().map((i) => i.type === 'money-in' && i.reason)).toEqual(['deposit', 'deposit']);
    const preview = book.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-10-10');
    expect(preview.items).toEqual([
      { kind: 'early-paycheck', id: 'p0', date: '2026-10-03', amount: 100_000, description: `${PAYROLL} DIRECT DEP` },
      { kind: 'paycheck-waiting', id: 'p1', date: PAYDAY, amount: 400_000, description: `${PAYROLL} DIRECT DEP`, wouldGet: parts(400_000) },
    ]);
    expect(preview.potsAfter).toEqual(preview.potsBefore);
    expect(preview.waitingAfter).toBe(2);
    const { rechecked } = book.changeSettings({ paycheckRule: { contains: PAYROLL } }, '2026-10-10');
    expect(rechecked).toEqual(preview.items);
    expect(book.pots()).toEqual({ ...START, unsortedIn: 500_000 });
    expect(book.paychecks()).toEqual([]);
    expect(book.reviewItems().map((i) => i.type === 'money-in' && i.reason)).toEqual(['paycheck', 'early-paycheck']);
    expect(book.paychecksWaiting().map((p) => p.id)).toEqual(['p0', 'p1']);
  });

  it('13.2 with the setting off, setting the paycheck rule still splits what it matches, as upstream', () => {
    const book = herBook({ paycheckRule: null, askBeforeSplittingPaycheck: false, leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    const { rechecked } = book.changeSettings({ paycheckRule: { contains: PAYROLL } }, '2026-10-10');
    expect(rechecked).toMatchObject([{ kind: 'paycheck', id: 'p1' }]);
    expect(book.period()).toEqual({ number: 1, startDate: PAYDAY });
  });
});

describe('Section 2: turning "Ask before splitting a paycheck" off or on (docs/her-questions.txt HB1)', () => {
  it('Section 2: turned off, a paycheck already waiting keeps waiting for your yes; the next one is split by itself', () => {
    const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    const before = book.pots();
    book.changeSettings({ askBeforeSplittingPaycheck: false }, '2026-10-10');
    expect(book.pots()).toEqual(before);
    expect(book.reviewItems()).toMatchObject([{ id: 'p1', reason: 'paycheck' }]);
    book.sort('p1', { to: 'paycheck' }, '2026-10-11');
    expect(book.receive(paycheck('p2', '2026-10-23', 400_000)).outcome).toBe('paycheck');
  });

  it('Section 2: 51.2 turned off with two waiting, they can be answered in any order, as upstream', () => {
    const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    book.receive(paycheck('p2', '2026-10-23', 400_000));
    book.changeSettings({ askBeforeSplittingPaycheck: false }, '2026-10-23');
    expect(sortOptions(detailOf(book, 'p2')).unavailable).toEqual([]);
    book.sort('p2', { to: 'paycheck' }, '2026-10-23');
    expect(book.lastPaycheckDate()).toBe('2026-10-23');
  });

  it('Section 2: turned on, nothing already split or waiting changes; the next one waits', () => {
    const book = herBook({ askBeforeSplittingPaycheck: false, leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
    book.receive(paycheck('p1', PAYDAY, 400_000));
    const before = state(book);
    const { rechecked } = book.changeSettings({ askBeforeSplittingPaycheck: true }, '2026-10-10');
    expect(rechecked).toEqual([]);
    expect(JSON.parse(state(book)).pots).toEqual(JSON.parse(before).pots);
    expect(book.receive(paycheck('p2', '2026-10-23', 400_000)).outcome).toBe('review');
  });
});

// ----- Random lives -----

const DAYS = 120;

type Step =
  | { readonly type: 'paycheck'; readonly day: number; readonly amount: Cents; readonly wait: number }
  | { readonly type: 'purchase'; readonly day: number; readonly amount: Cents; readonly to: 'needs' | 'wants'; readonly account: 'checking' | 'everyday-card' }
  | { readonly type: 'deposit'; readonly day: number; readonly amount: Cents; readonly to: 'other-income' | 'wants' | 'not-mine' };

const amountArb = fc.oneof(fc.integer({ min: 1, max: 600_000 }), fc.constantFrom(1, 2, 99, 100, 101));
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ type: fc.constant('paycheck' as const), day: fc.integer({ min: 0, max: DAYS - 1 }), amount: amountArb, wait: fc.integer({ min: 0, max: 20 }) }),
  fc.record({ type: fc.constant('purchase' as const), day: fc.integer({ min: 0, max: DAYS - 1 }), amount: fc.integer({ min: 1, max: 40_000 }), to: fc.constantFrom('needs' as const, 'wants' as const), account: fc.constantFrom('checking' as const, 'everyday-card' as const) }),
  fc.record({ type: fc.constant('deposit' as const), day: fc.integer({ min: 0, max: DAYS - 1 }), amount: fc.integer({ min: 1, max: 50_000 }), to: fc.constantFrom('other-income' as const, 'wants' as const, 'not-mine' as const) }),
);
const lifeArb = fc.record({
  steps: fc.array(stepArb, { maxLength: 40 }),
  leftover: fc.constantFrom('ask' as const, 'roll-over' as const, 'move-to-savings' as const),
});

// What a life does with a paycheck waiting in review: say yes, say "not a
// paycheck" (as other income), or leave it for now.
type Answer = 'paycheck' | 'other-income' | 'wait';

// The paychecks waiting in review, the setting on or off: a deposit the
// paycheck rule matched (3.1) and an early one (3.7), oldest first.
function paychecksInReview(book: Book): { readonly id: string; readonly date: IsoDate; readonly early: boolean }[] {
  const found = book.reviewItems().flatMap((i) => (i.type === 'money-in' && (i.reason === 'paycheck' || i.reason === 'early-paycheck') ? [{ id: i.id, date: i.date, early: i.reason === 'early-paycheck' }] : []));
  return found.sort((a, b) => daysBetween(b.date, a.date));
}

// One life, day by day: each day's bank activity, then the answers, then
// check(today). With yesAtOnce, a paycheck that waits for a yes (and is not
// early) gets it the moment it arrives, before the rest of the day's
// activity, as when it is split by itself. Waiting paychecks are answered
// oldest first (51.2); one left waiting leaves the newer ones waiting too.
function live(book: Book, steps: readonly Step[], life: { readonly yesAtOnce?: boolean; readonly answer: (id: string, early: boolean, arrived: number, today: number) => Answer; readonly check: (today: IsoDate) => void; readonly bank?: TestBank }): void {
  const byDay = new Map<number, { step: Step; n: number }[]>();
  steps.forEach((step, n) => byDay.set(step.day, [...(byDay.get(step.day) ?? []), { step, n }]));
  const arrivedOn = new Map<string, number>();
  for (let day = 0; day < DAYS; day++) {
    const today = addDays(START_DATE, day);
    for (const { step, n } of byDay.get(day) ?? []) {
      const id = `${step.type}-${n}`;
      const txn =
        step.type === 'paycheck'
          ? paycheck(id, today, step.amount)
          : step.type === 'purchase'
            ? purchase(id, today, step.amount, 'MADE UP STORE', { account: step.account })
            : deposit(id, today, step.amount, 'MADE UP GIFT');
      book.receive(txn);
      life.bank?.apply(txn);
      arrivedOn.set(id, day);
      if (step.type === 'paycheck' && life.yesAtOnce === true && book.reviewItems().some((i) => i.id === id && i.type === 'money-in' && i.reason === 'paycheck')) book.sort(id, { to: 'paycheck' }, today);
      if (step.type === 'purchase') book.sort(id, { to: step.to }, today);
      if (step.type === 'deposit') book.sort(id, { to: step.to }, today);
    }
    for (const waiting of paychecksInReview(book)) {
      const what = life.answer(waiting.id, waiting.early, arrivedOn.get(waiting.id) ?? day, day);
      if (what === 'wait') break;
      const older = daysBetween(book.lastPaycheckDate(), waiting.date) < 0;
      book.sort(waiting.id, { to: what === 'paycheck' && !older ? 'paycheck' : 'other-income' }, today);
    }
    for (const item of book.reviewItems()) if (item.type === 'leftover') book.answerLeftover(item.id, 'roll-over', today);
    life.check(today);
  }
}

describe('3.1 random lives: "Ask before splitting a paycheck"', () => {
  it('3.1 twin: with the setting on and a yes at once, every bucket on every day is the same as a book with it off', () => {
    fc.assert(
      fc.property(lifeArb, ({ steps, leftover }) => {
        const settings = { leftoverAtPayday: { needs: leftover, wants: leftover } };
        const on = herBook(settings);
        const off = herBook({ ...settings, askBeforeSplittingPaycheck: false });
        const seen = (book: Book, today: IsoDate): string => JSON.stringify({ today, pots: book.pots(), period: book.period(), paychecks: book.paychecks(), review: book.reviewItems(), last: book.lastPaycheckDate() });
        // An early paycheck (3.7) waits in both books; both make it other income that evening.
        const answer = (): Answer => 'other-income';
        const days: string[] = [];
        live(off, steps, { answer, check: (today) => days.push(seen(off, today)) });
        let i = 0;
        live(on, steps, {
          yesAtOnce: true,
          answer,
          check: (today) => {
            expect(seen(on, today)).toBe(days[i]);
            i++;
          },
        });
        expect(i).toBe(DAYS);
      }),
      { numRuns: runs(300) },
    );
  });

  it('3.3 random lives with yes some days late, or "not a paycheck": no cent is made or lost, the parts add up, and the self-check holds every day', () => {
    fc.assert(
      fc.property(lifeArb, fc.integer({ min: 0, max: 1_000 }), ({ steps, leftover }, seed) => {
        const book = herBook({ leftoverAtPayday: { needs: leftover, wants: leftover } });
        const bank = new TestBank({ checking: 80_000, savings: 100_000 });
        live(book, steps, {
          bank,
          answer: (id, _early, arrived, today) => {
            const wait = (seed + id.length * 7 + arrived) % 6;
            if (today - arrived < wait) return 'wait';
            return (seed + arrived) % 5 === 0 ? 'other-income' : 'paycheck';
          },
          check: () => {
            expect(book.recountPots()).toEqual(book.pots());
            expect(book.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard }).difference).toBe(0);
            for (const p of book.paychecks()) {
              const s = p.split;
              expect(s.momReserve + s.savings + s.needs + s.wants).toBe(p.amount);
            }
            const waiting = book.paychecksWaiting();
            expect(book.pots().unsortedIn).toBe(waiting.reduce((sum, p) => sum + p.amount, 0));
            for (let k = 1; k < waiting.length; k++) expect(daysBetween((waiting[k - 1] as { date: IsoDate }).date, (waiting[k] as { date: IsoDate }).date)).toBeGreaterThanOrEqual(0);
            const dates = book.paychecks().map((x) => x.date);
            expect([...dates].sort()).toEqual(dates);
          },
        });
      }),
      { numRuns: runs(300) },
    );
  });

  it('51.2 random lives: a yes is refused, changing nothing, exactly when an older paycheck that can still be one waits; pay periods never run backwards', () => {
    fc.assert(
      fc.property(lifeArb, fc.array(fc.nat(), { minLength: 1, maxLength: 20 }), ({ steps }, picks) => {
        const book = herBook({ leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } });
        let p = 0;
        for (let day = 0; day < DAYS; day++) {
          const today = addDays(START_DATE, day);
          steps.forEach((step, n) => {
            if (step.day === day && step.type === 'paycheck') book.receive(paycheck(`p${n}`, today, step.amount));
          });
          const waiting = book.paychecksWaiting();
          const pick = waiting[(picks[p++ % picks.length] ?? 0) % Math.max(1, waiting.length)];
          if (pick === undefined) continue;
          const last = book.lastPaycheckDate();
          const canBe = (date: IsoDate): boolean => daysBetween(last, date) >= 0;
          const blocked = waiting.some((w) => canBe(w.date) && daysBetween(w.date, pick.date) > 0);
          const before = state(book);
          const code = codeOf(() => book.sort(pick.id, { to: 'paycheck' }, today));
          if (!canBe(pick.date)) expect(code).toBe('bad-choice');
          else if (blocked) expect(code).toBe('older-paycheck-waiting');
          else expect(code).toBe('no error');
          if (code !== 'no error') expect(state(book)).toBe(before);
          const dates = book.paychecks().map((x) => x.date);
          expect([...dates].sort()).toEqual(dates);
        }
      }),
      { numRuns: runs(300) },
    );
  });
});

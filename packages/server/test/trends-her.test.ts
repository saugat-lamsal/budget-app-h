// Her rulebook, PR 10+11: Trends for her setup, with Wishlist's parts (60f,
// HA6). 40.2 and 40.4: Wishlist spending is its own part of each pay
// period's bar. 40.5: Wishlist over time beside savings, its own amount.
// 40.11: no estimate for Wishlist. What she sees has no old card part and no
// mom reserve ("Off in this setup"). Readings HB27 and HB28: "against your
// usual" (40.7) stays on needs and wants, as her plan says, and the parts
// that read 40.2's spending (40.6, 40.14 to 40.16) count Wishlist with it.
// Upstream's Trends are as they were (trends.test.ts). Every name and number
// is made up.
import { describe, expect, it } from 'vitest';
import { HER_SETTINGS, HER_SWITCHES, changeSettings, openBook, type Book, type Cents, type IsoDate } from '@budget-app/money';
import { LAST_PAYCHECK, PAYROLL, START_DATE, paycheck, purchase, refund } from '../../money/test/helpers.js';
import { appSide } from '../../money/test/helpers.js';
import { trendsView } from '../src/trends.js';
import { shownTrends } from '../src/views/off.js';
import type { TrendsPeriod, TrendsView } from '../src/views/trends.js';

type Tracking = Extract<TrendsView, { state: 'tracking' }>;
const sum = (values: readonly Cents[]): Cents => values.reduce((a, b) => a + b, 0);

const RULES = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
] as const;

// Her books: savings 1,000.00, needs 500.00, wants 300.00, Wishlist 200.00;
// the split gives Wishlist 10%. Setup day Oct 1, the last paycheck Sep 25, so
// the next payday is Oct 9.
function herBook(): Book {
  const settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL }, split: { savings: 40, needs: 30, wants: 20, wishlist: 10 }, askBeforeSplittingPaycheck: false });
  const b = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0, wishlist: 20_000 }, settings, switches: HER_SWITCHES });
  for (const rule of RULES) b.addRule(rule, START_DATE);
  return b;
}

// A grocery 32.50 (needs), a cafe 10.00 (wants), a lamp 45.00 sorted to
// Wishlist, a 90.00 split 70.00 needs and 20.00 Wishlist, and 5.00 of the
// lamp refunded: Wishlist spent 60.00 in all.
function scenario(): Book {
  const b = herBook();
  b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
  b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE'));
  b.receive(purchase('w1', '2026-10-03', 4_500, 'MADE UP LAMPS'));
  b.sort('w1', { to: 'wishlist' }, '2026-10-03');
  b.receive(purchase('s1', '2026-10-04', 9_000, 'MADE UP BIG BOX'));
  b.sort('s1', { split: [{ bucket: 'needs', amount: 7_000 }, { bucket: 'wishlist', amount: 2_000 }] }, '2026-10-04');
  b.receive(refund('w1-back', '2026-10-05', 500, 'w1'));
  return b;
}

function view(b: Book, today: IsoDate): Tracking {
  const pots = b.pots();
  const v = trendsView({ today, book: b, bank: { checking: appSide(pots) + (pots.wishlist ?? 0) - b.inTransit().total, savings: 0, everydayCard: 0, secondCard: 0 }, madeUpData: false, before: null });
  if (v.state !== 'tracking') throw new Error(`expected tracking, got ${v.state}`);
  return v;
}

function partsAddUp(p: TrendsPeriod): void {
  for (const part of ['needs', 'wants', 'old-card', 'unsorted', 'wishlist'] as const) expect(sum(p.items.filter((i) => i.part === part).map((i) => i.amount))).toBe(p.spent[part] ?? 0);
  expect(p.total).toBe(sum(Object.values(p.spent)));
}

describe('40.2 40.4 Wishlist spending is its own part of each pay period', () => {
  it('40.2 40.4 Wishlist is its own part beside needs, wants and unsorted, less refunds, and the parts add up to the bar', () => {
    const p = view(scenario(), '2026-10-06').periods[0] as TrendsPeriod;
    expect(p.spent).toEqual({ needs: 3_250 + 7_000, wants: 1_000, 'old-card': 0, unsorted: 0, wishlist: 6_000 });
    expect(p.total).toBe(3_250 + 7_000 + 1_000 + 6_000);
    expect(p.items.filter((i) => i.part === 'wishlist').map((i) => [i.id, i.amount])).toEqual([
      ['s1', 2_000],
      ['w1', 4_000],
    ]);
    partsAddUp(p);
  });

  it('40.2 40.4 what she sees: Wishlist, and no old card part ("Off in this setup")', () => {
    const shown = shownTrends(view(scenario(), '2026-10-06'), HER_SWITCHES);
    expect(shown.state === 'tracking' && shown.periods[0]?.spent).toEqual({ needs: 10_250, wants: 1_000, unsorted: 0, wishlist: 6_000 });
  });

  it('40.2 a Wishlist purchase refunded in full spends nothing, and one cent counts', () => {
    const b = herBook();
    b.receive(purchase('w1', '2026-10-03', 4_500, 'MADE UP LAMPS'));
    b.sort('w1', { to: 'wishlist' }, '2026-10-03');
    b.receive(refund('w1-back', '2026-10-05', 4_500, 'w1'));
    b.receive(purchase('w2', '2026-10-05', 1, 'MADE UP STICKERS'));
    b.sort('w2', { to: 'wishlist' }, '2026-10-05');
    const p = view(b, '2026-10-06').periods[0] as TrendsPeriod;
    expect(p.spent.wishlist).toBe(1);
    expect(p.items.filter((i) => i.part === 'wishlist').map((i) => i.id)).toEqual(['w2']);
  });

  it('40.2 Wishlist spending is in the pay period it was counted in', () => {
    const b = scenario();
    b.receive(paycheck('pay', '2026-10-09', 400_000));
    b.receive(purchase('w3', '2026-10-10', 1_500, 'MADE UP LAMPS'));
    b.sort('w3', { to: 'wishlist' }, '2026-10-10');
    const v = view(b, '2026-10-10');
    expect(v.periods.map((p) => p.spent.wishlist)).toEqual([6_000, 1_500]);
    for (const p of v.periods) partsAddUp(p);
  });
});

describe('40.5 Wishlist over time, beside savings', () => {
  it('40.5 what Wishlist held when tracking started, at the end of each pay period, and now, its own amount beside savings', () => {
    const b = scenario();
    b.receive(paycheck('pay', '2026-10-09', 400_000));
    const v = view(b, '2026-10-10');
    // 200.00 at the start, less 60.00 spent: 140.00 at the end of the first pay
    // period; then 10% of the 4,000.00 paycheck: 540.00.
    expect(v.savings.map((p) => [p.at, p.wishlist])).toEqual([
      ['start', 20_000],
      ['end', 14_000],
      ['now', 54_000],
    ]);
    // Savings is its own amount: Wishlist is not added to it.
    expect(v.savings.map((p) => p.savings)).toEqual([100_000, 100_000, 100_000 + 160_000]);
    expect(shownTrends(v, HER_SWITCHES)).toMatchObject({ savings: [{ wishlist: 20_000 }, { wishlist: 14_000 }, { wishlist: 54_000 }] });
  });
});

describe('40.11 no estimate for Wishlist', () => {
  it('40.11 where the buckets land by payday is for needs and wants only; Wishlist is not spent at a pace', () => {
    const v = view(scenario(), '2026-10-06');
    expect(Object.keys(v.future.landing).sort()).toEqual(['needs', 'nextPayday', 'waitingInReview', 'wants']);
    // Needs' pace counts only needs: 102.50 over 6 days.
    expect(v.future.landing.needs).toMatchObject({ state: 'estimate', spentSoFar: 10_250 });
    expect(v.future.landing.wants).toMatchObject({ state: 'estimate', spentSoFar: 1_000 });
  });
});

describe('40.7 40.6 40.15 the rest of Trends with Wishlist (HB27, HB28)', () => {
  it('40.7 this pay period against your usual stays on needs and wants: Wishlist purchases are not in it (HB27)', () => {
    expect(view(scenario(), '2026-10-06').now.spentSoFar).toBe(10_250 + 1_000);
  });

  it('40.6 40.15 where it went and the days of the week read the same spending as the bars: Wishlist purchases are in them (HB28)', () => {
    const v = view(scenario(), '2026-10-06');
    expect(v.places.total).toBe(17_250);
    expect(v.places.groups.flatMap((g) => g.items.map((i) => i.id))).toContain('w1');
    expect(sum(v.habits.weekdays.days.map((d) => d.total))).toBe(17_250);
  });
});

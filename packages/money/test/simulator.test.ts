import { describe, expect, it } from 'vitest';
import { SimBank } from './sim/bank.js';
import { HER_STAT_NAMES, OFF_IN_HER_LIFE, STAT_NAMES, describeFailure, liveALife, type LifeResult, type Stats } from './sim/life.js';
import { Random } from './sim/random.js';
import { SLOW, lives as count } from './slow.js';

// How many lives, and how long. npm test runs a few; scripts/simulate.mjs
// sets these to run thousands of simulated years, or one seed to replay it.
const FIRST_SEED = Number(process.env['SIM_FIRST_SEED'] ?? 1);
const SEED_COUNT = Number(process.env['SIM_SEEDS'] ?? count(6, 1));
const YEARS = Number(process.env['SIM_YEARS'] ?? count(2, 0.5));
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => FIRST_SEED + i);

let lives: LifeResult[] | undefined;
function livedLives(): LifeResult[] {
  lives ??= SEEDS.map((seed) => liveALife({ seed, years: YEARS }));
  return lives;
}

// Lives shaped like hers (her rulebook, "Off in this setup"). npm test runs a
// few; `node scripts/simulate.mjs --profile her` sets these to run thousands.
const HER_FIRST_SEED = Number(process.env['SIM_HER_FIRST_SEED'] ?? 1);
const HER_SEED_COUNT = Number(process.env['SIM_HER_SEEDS'] ?? count(6, 1));
const HER_YEARS = Number(process.env['SIM_HER_YEARS'] ?? count(2, 0.5));
const HER_SEEDS = Array.from({ length: HER_SEED_COUNT }, (_, i) => HER_FIRST_SEED + i);

let herLives: LifeResult[] | undefined;
function livedHerLives(): LifeResult[] {
  herLives ??= HER_SEEDS.map((seed) => liveALife({ seed, years: HER_YEARS, profile: 'her' }));
  return herLives;
}

// Phase 2, the simulated you. The simulator has its own bank, kept apart from
// the book, so the daily self-check compares two things worked out separately.

describe('simulator: random numbers', () => {
  it('the same seed gives the same numbers, and another seed gives others', () => {
    const a = new Random(42);
    const b = new Random(42);
    const c = new Random(43);
    const first = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(first);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(first);
  });

  it('whole numbers stay in range and reach both ends', () => {
    const random = new Random(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const n = random.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });
});

describe('simulator: its own bank', () => {
  const start = { checking: 100_000, savings: 50_000, everydayCard: 20_000, oldCard: 300_000 };

  it('12.1 a pending card charge is in the balances the self-check sees, not in the posted balance', () => {
    const bank = new SimBank(start);
    bank.authorize('2026-10-01', 'everyday-card', 5_000, 'MADE UP CAFE');
    expect(bank.posted.everydayCard).toBe(20_000);
    expect(bank.balances()).toEqual({ checking: 100_000, savings: 50_000, everydayCard: 25_000 });
  });

  it('4.6 the posting replaces the pending charge, even at a new amount, with a new id', () => {
    const bank = new SimBank(start);
    const hold = bank.authorize('2026-10-01', 'checking', 10_000, 'MADE UP GAS');
    expect(bank.balances().checking).toBe(90_000);
    const final = bank.post(hold.id, '2026-10-03', 4_217);
    expect(final).toMatchObject({ kind: 'purchase', pending: false, pendingId: hold.id, amount: 4_217, account: 'checking' });
    expect(final.id).not.toBe(hold.id);
    expect(bank.posted.checking).toBe(95_783);
    expect(bank.balances().checking).toBe(95_783);
    expect(bank.pendingCharges()).toEqual([]);
  });

  it('12.4 a pending old card charge is owed on the old card, and never in the self-check balances', () => {
    const bank = new SimBank(start);
    bank.authorize('2026-10-01', 'old-card', 2_500, 'MADE UP CAFE');
    expect(bank.oldCardOwed()).toBe(302_500);
    expect(bank.balances()).toEqual({ checking: 100_000, savings: 50_000, everydayCard: 20_000 });
  });

  it('12.5 a card payment leaves checking first and reaches the card later', () => {
    const bank = new SimBank(start);
    const left = bank.send('2026-10-01', 'checking', 'everyday-card', 15_000);
    expect(bank.balances()).toEqual({ checking: 85_000, savings: 50_000, everydayCard: 20_000 });
    expect(bank.inTransit()).toBe(15_000);
    const landed = bank.land('2026-10-03', left, true);
    expect(landed).toMatchObject({ kind: 'transfer-arrived', sentId: left.id, amount: 15_000, from: 'checking', to: 'everyday-card' });
    expect(bank.balances().everydayCard).toBe(5_000);
    expect(bank.inTransit()).toBe(0);
  });

  it('12.4 money on its way to the old card is not in transit for the self-check; the debt drops when it lands', () => {
    const bank = new SimBank(start);
    const left = bank.send('2026-10-01', 'checking', 'old-card', 9_000);
    expect(bank.inTransit()).toBe(0);
    expect(bank.oldCardOwed()).toBe(300_000);
    bank.land('2026-10-02', left, false);
    expect(bank.oldCardOwed()).toBe(291_000);
  });

  it('12.5 a payment seen arriving before it is seen leaving is in transit as a negative', () => {
    const bank = new SimBank(start);
    const landed = bank.landFirst('2026-10-01', 'checking', 'everyday-card', 7_000);
    expect(bank.inTransit()).toBe(-7_000);
    bank.sendAfter('2026-10-02', landed);
    expect(bank.inTransit()).toBe(0);
    expect(bank.balances()).toEqual({ checking: 93_000, savings: 50_000, everydayCard: 13_000 });
  });

  it('a statement shows the posted balance and a minimum of 2% rounded up to the dollar, at least $35, due 25 days later', () => {
    const bank = new SimBank(start);
    // Still pending on the closing day, so not on this statement.
    bank.authorize('2026-10-01', 'everyday-card', 9_999, 'MADE UP CAFE');
    expect(bank.closeStatement('everyday-card', '2026-10-03')).toEqual({
      card: 'everyday-card',
      closingDate: '2026-10-03',
      dueDate: '2026-10-28',
      statementBalance: 20_000,
      minimumPayment: 3_500,
    });
    // 2% of 2,500.01 is 50.0002, rounded up to 51.00.
    expect(new SimBank({ ...start, everydayCard: 250_001 }).closeStatement('everyday-card', '2026-10-03').minimumPayment).toBe(5_100);
    // Never more than what is owed, and nothing when nothing is owed.
    expect(new SimBank({ ...start, everydayCard: 1_200 }).closeStatement('everyday-card', '2026-10-03').minimumPayment).toBe(1_200);
    expect(new SimBank({ ...start, everydayCard: -500 }).closeStatement('everyday-card', '2026-10-03').minimumPayment).toBe(0);
    expect(new SimBank(start).closeStatement('old-card', '2026-10-10')).toMatchObject({ statementBalance: 300_000, minimumPayment: 6_000 });
  });

  it('every transaction it sends has an id it has not used before, and it keeps them all in order', () => {
    const bank = new SimBank(start);
    const hold = bank.authorize('2026-10-01', 'everyday-card', 1_000, 'MADE UP CAFE');
    bank.post(hold.id, '2026-10-02', 1_000);
    bank.deposit('2026-10-02', 'checking', 250_000, 'ACME PAYROLL DIRECT DEP');
    bank.payPerson('2026-10-02', 30_000, 'Made Up Mom');
    bank.refund('2026-10-03', 'everyday-card', 500, 'MADE UP STORE REFUND', hold.id);
    bank.cardCharge('2026-10-03', 'everyday-card', 'fee', 2_900);
    bank.transfer('2026-10-03', 'checking', 'savings', 10_000);
    const ids = bank.feed.map((txn) => txn.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(bank.feed.map((txn) => txn.kind)).toEqual(['purchase', 'purchase', 'deposit', 'payment-to-person', 'refund', 'card-charge', 'transfer']);
  });
});

describe('simulator: a simulated life', () => {
  it('the same seed lives the same life, and another seed a different one', () => {
    const once = liveALife({ seed: 7, years: 0.5 });
    expect(liveALife({ seed: 7, years: 0.5 })).toEqual(once);
    expect(liveALife({ seed: 8, years: 0.5 }).stats).not.toEqual(once.stats);
  });

  it.runIf(SLOW)('13.2 B73 a payment to mom left waiting by the mom rule is left waiting again when the rule is set again (the simulator lost track of it: seed 233, day 1551)', { timeout: 120_000 }, () => {
    expect(liveALife({ seed: 233, years: 4.3 })).toMatchObject({ ok: true });
  });

  it('10.1 13.1 raising the low alert level above where a bucket stands sends the low alert right then (the simulator still had the old level: seed 1507, day 80)', { timeout: 120_000 }, () => {
    expect(liveALife({ seed: 1507, years: 0.4 })).toMatchObject({ ok: true });
  });

  it('12.3 a balance the book was never told about fails that day\'s self-check, and the report names the seed and the day', () => {
    const result = liveALife({ seed: 3, years: 1, sabotageOnDay: 40 });
    expect(result).toMatchObject({ ok: false, seed: 3, day: 40, check: '12.3 daily self-check' });
    if (result.ok) return;
    const report = describeFailure(result, 1);
    expect(report).toContain('seed 3, day 40');
    expect(report).toContain('difference -1');
    expect(report).toContain('node scripts/simulate.mjs --seed 3 --years 1');
  });

  it(`12.3 the self-check and every other check pass on every simulated day (${SEED_COUNT} lives of ${YEARS} years)`, { timeout: 3_600_000 }, () => {
    const failures = livedLives().filter((result) => !result.ok);
    // scripts/simulate.mjs reads these lines for its summary.
    if (process.env['SIM_REPORT']) {
      console.log(`SIM-TOTALS ${JSON.stringify(totalsOf(livedLives()))}`);
      console.log(`SIM-FAILED ${JSON.stringify(failures.map((f) => f.seed))}`);
      for (const f of failures) if (!f.ok) console.log(`SIM-REPORT-BEGIN\n${describeFailure(f, YEARS)}\nSIM-REPORT-END`);
    }
    if (failures.length > 0) {
      expect.fail(`${failures.length} of ${SEED_COUNT} lives failed.\n\n${failures.map((f) => (f.ok ? '' : describeFailure(f, YEARS))).join('\n\n')}`);
    }
  });

  it.runIf(SLOW)('the simulated lives cover everything they are meant to', { timeout: 3_600_000 }, () => {
    const totals = totalsOf(livedLives());
    const missing = STAT_NAMES.filter((name) => totals[name] === 0);
    expect(missing, `never happened in ${SEED_COUNT} lives of ${YEARS} years`).toEqual([]);
  });
});

describe('simulator: lives shaped like hers', () => {
  it('Off in this setup: her life is not the upstream life: the same seed lives another life', { timeout: 60_000 }, () => {
    expect(liveALife({ seed: 7, years: 0.5, profile: 'her' }).stats).not.toEqual(liveALife({ seed: 7, years: 0.5 }).stats);
    expect(liveALife({ seed: 7, years: 0.5, profile: 'her' })).toEqual(liveALife({ seed: 7, years: 0.5, profile: 'her' }));
  });

  it(`Off in this setup: her setup: every check passes, every day, in lives shaped like hers (${HER_SEED_COUNT} lives of ${HER_YEARS} years)`, { timeout: 3_600_000 }, () => {
    const failures = livedHerLives().filter((result) => !result.ok);
    if (process.env['SIM_REPORT']) {
      console.log(`SIM-TOTALS ${JSON.stringify(totalsOf(livedHerLives(), [...STAT_NAMES, ...HER_STAT_NAMES]))}`);
      console.log(`SIM-FAILED ${JSON.stringify(failures.map((f) => f.seed))}`);
      for (const f of failures) if (!f.ok) console.log(`SIM-REPORT-BEGIN\n${describeFailure(f, HER_YEARS, 'her')}\nSIM-REPORT-END`);
    }
    if (failures.length > 0) {
      expect.fail(`${failures.length} of ${HER_SEED_COUNT} lives shaped like hers failed.\n\n${failures.map((f) => (f.ok ? '' : describeFailure(f, HER_YEARS, 'her'))).join('\n\n')}`);
    }
  });

  it.runIf(SLOW)('Off in this setup: her lives cover everything but the mom reserve and the old card, which never happen', { timeout: 3_600_000 }, () => {
    const totals = totalsOf(livedHerLives(), [...STAT_NAMES, ...HER_STAT_NAMES]);
    const expected = [...STAT_NAMES.filter((name) => !OFF_IN_HER_LIFE.includes(name)), ...HER_STAT_NAMES];
    expect(expected.filter((name) => totals[name] === 0), `never happened in ${HER_SEED_COUNT} lives of ${HER_YEARS} years`).toEqual([]);
    expect(Object.fromEntries(OFF_IN_HER_LIFE.map((name) => [name, totals[name]]))).toEqual(Object.fromEntries(OFF_IN_HER_LIFE.map((name) => [name, 0])));
  });
});

function totalsOf(results: readonly LifeResult[], names: readonly (keyof Stats)[] = STAT_NAMES): Stats {
  const totals = Object.fromEntries(names.map((name) => [name, 0])) as Stats;
  for (const result of results) for (const name of names) totals[name] += result.stats[name];
  return totals;
}

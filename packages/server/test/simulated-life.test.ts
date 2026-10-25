import { bankSide, type BankTransaction, type SetupInput } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import type { Posted } from '../../money/test/sim/bank.js';
import { liveALife, type BookTotals, type RecordedBankDay } from '../../money/test/sim/life.js';
import { setUpTracking } from '../src/setup-day.js';
import { bankStatus } from '../src/status.js';
import { ACCOUNT, SIM_BANK_RULES, inPlaidFormat } from './sim-bank.js';
import { connected } from './harness.js';
import { lives as count } from './slow.js';

// The simulated you (Phase 2), through the bank connection. The simulator
// lives its life as always: its own bank, which posts transactions, holds
// pending charges, and moves its balances like a bank, feeding its own book
// directly. Here each day the same bank activity is also handed to a
// made-up bank in Plaid's format, and the bank connection syncs it, reads
// it, and gives it to a second book. After every day:
// - the made-up bank in Plaid's format shows the simulator's own balances;
// - the self-check passes, against the bank connection's reading of those
//   balances and against the simulator's bank;
// - the second book has the same money as the simulator's book: the same
//   app side, money in transit, and old card debt (his answers only move
//   money between buckets, so they do not change these, and only the
//   simulator's book gets them; the transfers his bank shows as spending
//   and a deposit, which he marks as transfers in review (5.6), are read
//   here by bank rules, the way he would set them up, A12);
// - the money in transit is the same list the simulator's bank shows;
// - nothing waits for a decision.
// SIM_BANK_SEEDS, SIM_BANK_FIRST_SEED and SIM_BANK_YEARS run more of it.

interface Recorded {
  setup?: { readonly start: Posted; readonly feed: readonly BankTransaction[]; readonly input: SetupInput; readonly totals: BookTotals };
  readonly days: RecordedBankDay[];
}

function liveAndRecord(seed: number, years: number): Required<Recorded> {
  const recorded: Recorded = { days: [] };
  const result = liveALife({
    seed,
    years,
    record: {
      setupDay: (setup) => {
        recorded.setup = setup;
      },
      day: (day) => recorded.days.push(day),
    },
  });
  if (!result.ok) throw new Error(`the simulated life failed on its own: seed ${seed}, ${result.date}, ${result.check}: ${result.message}`);
  if (recorded.setup === undefined) throw new Error('no setup day was recorded');
  return { setup: recorded.setup, days: recorded.days };
}

async function throughTheBankConnection(seed: number, years: number): Promise<{ days: number; transactions: number }> {
  const { setup, days } = liveAndRecord(seed, years);
  const h = await connected({
    posted: { checking: setup.start.checking, savings: setup.start.savings, everyday: setup.start.everydayCard, old: setup.start.oldCard },
    history: (fake) => {
      for (const txn of setup.feed) inPlaidFormat(fake, txn);
    },
    rules: SIM_BANK_RULES,
    today: setup.input.date,
  });
  // 14: setup day from what the bank connection synced, with his own
  // assignment, and the payments he confirms are on their way (B48).
  const outcome = setUpTracking(h.db, {
    today: setup.input.date,
    assignment: setup.input.assignment,
    lastPaycheckDate: setup.input.lastPaycheckDate,
    settings: setup.input.settings,
    rules: setup.input.rules ?? [],
    inTransit: (setup.input.transfersInTransit ?? []).map((half) => half.id),
  });
  expect(outcome, `seed ${seed}: setup day`).toEqual({ ok: true, startingMoney: setup.totals.appSide });
  let transactions = setup.feed.length;
  for (const day of days) {
    for (const txn of day.feed) inPlaidFormat(h.fake, txn);
    transactions += day.feed.length;
    await h.sync(day.date, { pageSize: 100 });
    const where = `seed ${seed}, ${day.date}`;
    expect([h.fake.posted(ACCOUNT.checking), h.fake.posted(ACCOUNT.savings), h.fake.posted(ACCOUNT['everyday-card']), h.fake.posted(ACCOUNT['old-card'])], `${where}: posted balances`).toEqual([
      day.posted.checking,
      day.posted.savings,
      day.posted.everydayCard,
      day.posted.oldCard,
    ]);
    const status = bankStatus(h.db);
    expect(status.selfCheck, `${where}: the self-check`).toMatchObject({ ok: true, difference: 0 });
    const check = status.selfCheck;
    if (check === null) throw new Error(`${where}: no self-check`);
    expect(bankSide(day.balances) + check.inTransit - check.appSide, `${where}: the self-check against the simulator's own bank`).toBe(0);
    expect({ appSide: check.appSide, inTransit: check.inTransit, oldCardDebt: status.oldCard?.book }, `${where}: the same money as the simulator's book`).toEqual(day.totals);
    expect(status.inTransit?.items.map((i) => `${i.from} ${i.to} ${i.amount} ${i.seen}`).sort(), `${where}: money in transit`).toEqual(day.halvesShowing);
    expect(status.oldCard?.difference, `${where}: the old card`).toBe(0);
    expect(status.attention, `${where}: nothing waits for a decision`).toEqual([]);
  }
  return { days: days.length, transactions };
}

const FIRST_SEED = Number(process.env['SIM_BANK_FIRST_SEED'] ?? 1);
const SEEDS = Number(process.env['SIM_BANK_SEEDS'] ?? count(2, 1));
const YEARS = Number(process.env['SIM_BANK_YEARS'] ?? count(1, 0.25));

describe('the simulated you, through the bank connection in Plaid\'s format', () => {
  it.each(Array.from({ length: SEEDS }, (_, i) => FIRST_SEED + i))(
    'simulator: seed %i, every day the self-check passes and the money matches the simulator\'s book',
    async (seed) => {
      const { days, transactions } = await throughTheBankConnection(seed, YEARS);
      expect(days).toBe(Math.round(YEARS * 365));
      expect(transactions).toBeGreaterThan(days);
    },
    600_000,
  );
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HER_SWITCHES, bankSide, type BankTransaction, type SetupInput } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import type { Posted } from '../../money/test/sim/bank.js';
import { liveALife, type BookTotals, type RecordedAnswer, type RecordedBankDay } from '../../money/test/sim/life.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { readAccounts } from '../src/db/store.js';
import { bookOfSetup, replayCall, totalsOf, type BookCall } from '../src/history/history.js';
import { appendEvent, readHistory } from '../src/history/history-db.js';
import { Keeper } from '../src/history/keeper.js';
import { setUpTracking } from '../src/setup-day.js';
import { bankStatus } from '../src/status.js';
import { ACCOUNT, inPlaidFormat, simBankRules } from './sim-bank.js';
import { connected } from './harness.js';

// Her rulebook, "Off in this setup": the simulated life shaped like hers (no
// mom reserve, no old card) through the bank connection and through the
// database, the way upstream's simulated lives go (simulated-life.test.ts,
// simulated-life-restarts.test.ts), with what her setup adds:
// - only her four accounts are picked (PR 5: with her second card); the made-up bank's old card account
//   has its own made-up activity now and then, which is never read, so the
//   self-check and the money stay the simulator's;
// - every day her book has her switches, nothing in a mom reserve, and no
//   old card debt, the server stopped and started again or not.
// SIM_HER_BANK_SEEDS, SIM_HER_BANK_FIRST_SEED, SIM_HER_BANK_YEARS and
// SIM_HER_DB_SEEDS, SIM_HER_DB_FIRST_SEED, SIM_HER_DB_YEARS run more.

// PR 5: her second card's rules too (her rulebook, section 1).
const HER_SIM_BANK_RULES = simBankRules(['checking', 'savings', 'everyday-card', 'second-card'], ['everyday-card', 'second-card']);

interface Day extends RecordedBankDay {
  readonly answers: readonly RecordedAnswer[];
}

interface Recorded {
  readonly setup: { readonly start: Posted; readonly feed: readonly BankTransaction[]; readonly input: SetupInput; readonly totals: BookTotals };
  readonly days: readonly Day[];
}

function liveHerLife(seed: number, years: number): Recorded {
  let setup: Recorded['setup'] | undefined;
  const days: Day[] = [];
  let answers: RecordedAnswer[] = [];
  const result = liveALife({
    seed,
    years,
    profile: 'her',
    record: {
      setupDay: (s) => {
        setup = s;
      },
      day: (day) => {
        days.push({ ...day, answers });
        answers = [];
      },
      answer: (a) => answers.push(a),
    },
  });
  if (!result.ok) throw new Error(`the simulated life failed on its own: seed ${seed}, ${result.date}, ${result.check}: ${result.message}`);
  if (setup === undefined) throw new Error('no setup day was recorded');
  expect(setup.input.switches, `seed ${seed}: her switches on setup day`).toEqual(HER_SWITCHES);
  return { setup, days };
}

async function throughTheBankConnection(seed: number, years: number): Promise<{ days: number; unread: number }> {
  const { setup, days } = liveHerLife(seed, years);
  const h = await connected({
    posted: { checking: setup.start.checking, savings: setup.start.savings, everyday: setup.start.everydayCard, old: 123_456 },
    history: (fake) => {
      for (const txn of setup.feed) inPlaidFormat(fake, txn);
    },
    rules: HER_SIM_BANK_RULES,
    today: setup.input.date,
    herSetup: true,
    secondCard: setup.start.secondCard ?? 0,
  });
  expect(readAccounts(h.db).map((a) => a.role).filter((r) => r !== null).sort(), `seed ${seed}: her four accounts`).toEqual(['checking', 'everyday-card', 'savings', 'second-card']);
  const outcome = setUpTracking(
    h.db,
    {
      today: setup.input.date,
      assignment: setup.input.assignment,
      lastPaycheckDate: setup.input.lastPaycheckDate,
      settings: setup.input.settings,
      rules: setup.input.rules ?? [],
      inTransit: (setup.input.transfersInTransit ?? []).map((half) => half.id),
    },
    setup.input.switches,
  );
  expect(outcome, `seed ${seed}: setup day`).toEqual({ ok: true, startingMoney: setup.totals.appSide });
  let unread = 0;
  for (const [i, day] of days.entries()) {
    for (const txn of day.feed) inPlaidFormat(h.fake, txn);
    // Made-up activity on the account she never picked.
    if (i % 9 === 0) {
      h.fake.addPosted({ id: `unread-${i}`, account: ACCOUNT['old-card'], amount: 1_000 + i, date: day.date, description: 'MADE UP SHOP ON THE OTHER CARD' });
      unread += 1;
    }
    await h.sync(day.date, { pageSize: 100 });
    const where = `seed ${seed}, ${day.date}`;
    expect([h.fake.posted(ACCOUNT.checking), h.fake.posted(ACCOUNT.savings), h.fake.posted(ACCOUNT['everyday-card'])], `${where}: posted balances`).toEqual([day.posted.checking, day.posted.savings, day.posted.everydayCard]);
    const status = bankStatus(h.db);
    expect(status.selfCheck, `${where}: the self-check`).toMatchObject({ ok: true, difference: 0 });
    const check = status.selfCheck;
    if (check === null) throw new Error(`${where}: no self-check`);
    expect(bankSide(day.balances) + check.inTransit - check.appSide, `${where}: the self-check against the simulator's own bank`).toBe(0);
    expect({ appSide: check.appSide, inTransit: check.inTransit, oldCardDebt: status.oldCard?.book }, `${where}: the same money as the simulator's book`).toEqual(day.totals);
    expect(status.inTransit?.items.map((i) => `${i.from} ${i.to} ${i.amount} ${i.seen}`).sort(), `${where}: money in transit`).toEqual(day.halvesShowing);
    expect(status.oldCard, `${where}: no old card, and nothing of the account she never picked`).toEqual({ book: 0, bank: 0, difference: 0 });
    expect(status.pots?.momReserve, `${where}: no mom reserve`).toBe(0);
    expect(status.statements.map((s) => s.card), `${where}: statements`).not.toContain('old-card');
    expect(status.attention, `${where}: nothing waits for a decision`).toEqual([]);
  }
  return { days: days.length, unread };
}

function throughTheDatabase(seed: number, years: number): { days: number; answers: number; restarts: number } {
  const { setup, days } = liveHerLife(seed, years);
  const { input, totals } = setup;
  const dir = mkdtempSync(join(tmpdir(), 'budget-sim-her-'));
  const path = join(dir, 'books.sqlite');
  let db: Db = openDatabase(path);
  let answers = 0;
  let restarts = 0;
  try {
    const started = bookOfSetup(input);
    expect(started.appSide(), `seed ${seed}: setup day`).toBe(totals.appSide);
    expect(started.switches(), `seed ${seed}: her switches`).toEqual(HER_SWITCHES);
    appendEvent(db, { event: { kind: 'setup', input }, date: input.date, sync: null, totals: totalsOf(started) });
    const restart = (date: string): Keeper => {
      db.close();
      db = openDatabase(path);
      restarts += 1;
      return Keeper.open({ db, now: () => new Date(`${date}T16:00:00Z`) });
    };
    let keeper = restart(input.date);
    for (const day of days) {
      const where = `seed ${seed}, ${day.date}`;
      const book = keeper.book();
      if (book === null) throw new Error(`${where}: no book`);
      const receive = (txn: BankTransaction): void => {
        book.receive(txn);
        appendEvent(db, { event: { kind: 'receive', txn }, date: day.date, sync: null, totals: totalsOf(book) });
      };
      let given = 0;
      for (const answer of day.answers) {
        while (given < answer.afterFeed) receive(day.feed[given++] as BankTransaction);
        const call: BookCall = { method: answer.method as BookCall['method'], args: answer.args };
        replayCall(book, call);
        appendEvent(db, { event: { kind: 'answer', answer: { book: [call] } }, date: day.date, sync: null, totals: totalsOf(book) });
        answers += 1;
      }
      while (given < day.feed.length) receive(day.feed[given++] as BankTransaction);
      keeper = restart(day.date);
      const reopened = keeper.book();
      if (reopened === null) throw new Error(`${where}: no book after the restart`);
      expect(reopened.switches(), `${where}: her switches after the restart`).toEqual(HER_SWITCHES);
      expect(reopened.selfCheck(day.balances), `${where}: the self-check`).toMatchObject({ ok: true, difference: 0 });
      expect({ pots: reopened.pots(), waiting: reopened.reviewItems().length }, `${where}: the simulator's own book`).toEqual({ pots: day.pots, waiting: day.waiting });
      expect(reopened.pots().momReserve, `${where}: no mom reserve`).toBe(0);
      const check = reopened.selfCheck(day.balances);
      expect({ appSide: check.appSide, inTransit: check.inTransit, oldCardDebt: reopened.oldCardDebt() }, `${where}: the same money as the simulator's book`).toEqual(day.totals);
    }
    expect(readHistory(db).filter((e) => e.event.kind === 'answer')).toHaveLength(answers);
    return { days: days.length, answers, restarts };
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const seeds = (first: string, count: string, firstDefault: number, countDefault: number): number[] =>
  Array.from({ length: Number(process.env[count] ?? countDefault) }, (_, i) => Number(process.env[first] ?? firstDefault) + i);
const BANK_YEARS = Number(process.env['SIM_HER_BANK_YEARS'] ?? 1);
const DB_YEARS = Number(process.env['SIM_HER_DB_YEARS'] ?? 1);

describe('her simulated life, through the bank connection in Plaid\'s format', () => {
  it.each(seeds('SIM_HER_BANK_FIRST_SEED', 'SIM_HER_BANK_SEEDS', 1, 1))(
    "Off in this setup: her setup: seed %i, every day the self-check passes, the money matches the simulator's book, and the account she never picked is never read",
    async (seed) => {
      const { days, unread } = await throughTheBankConnection(seed, BANK_YEARS);
      expect(days).toBe(Math.round(BANK_YEARS * 365));
      expect(unread).toBeGreaterThan(0);
    },
    1_800_000,
  );
});

describe('her simulated life, through the database, the server started again every simulated day', () => {
  it.each(seeds('SIM_HER_DB_FIRST_SEED', 'SIM_HER_DB_SEEDS', 1, 1))(
    "Off in this setup: her setup: seed %i, every day the history replays with her switches, the self-check passes, and every bucket is the simulator's",
    (seed) => {
      const { days, answers, restarts } = throughTheDatabase(seed, DB_YEARS);
      expect(days).toBe(Math.round(DB_YEARS * 365));
      expect(restarts).toBe(days + 1);
      expect(answers).toBeGreaterThan(days / 2);
    },
    1_800_000,
  );
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Cents } from '@budget-app/money';
import { bankView } from '../src/bank/balances.js';
import type { StoredAccount } from '../src/bank/stored-account.js';
import type { BankAtRead } from '../src/bank/why.js';
import type { PlaidAccount } from '../src/plaid/types.js';
import type { StoredItem } from '../src/sync/plan.js';
import type { WhyLine } from '../src/views/home.js';
import { bankStatus } from '../src/status.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { herLife, setUpHer } from './her-harness.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { runs } from './slow.js';

// Her rulebook, 12.1 (HA8, his OK Oct 26, 2026, 60h): her checking and
// savings are at Capital One, which sends Plaid no pending items (Plaid's
// build kit), so the bank side starts them from the posted balance less
// pending charges, as 12.1 does when the bank gives no available balance.
// A purchase Capital One holds but Plaid does not list moves the available
// balance only; the posted balance and the books both move when it posts.
// The made-up bank's holdAvailable stands for what Capital One holds: the
// available balance differs from the posted one, and Plaid lists nothing.
// Upstream's setup keeps the available balance (A47). Every name and number
// is made up.

const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;

// The difference the screens show: null when the totals match.
function difference(life: Life): number | null {
  const s = life.keeper.home();
  if (s.state !== 'tracking') throw new Error('not tracking');
  return s.safeToSpend.shown ? null : s.safeToSpend.why === 'totals-do-not-match' ? s.safeToSpend.check.difference : NaN;
}

function homeWhy(life: Life): readonly WhyLine[] {
  const s = life.keeper.home();
  if (s.state !== 'tracking' || s.safeToSpend.shown || s.safeToSpend.why !== 'totals-do-not-match') throw new Error('the totals match');
  return s.safeToSpend.detail?.why ?? [];
}

function lastRead(life: Life): BankAtRead {
  const row = life.h.db.prepare('SELECT bank FROM bank_reads ORDER BY id DESC LIMIT 1').get() as { bank: string | null } | undefined;
  if (row?.bank == null) throw new Error('no read kept');
  return JSON.parse(row.bank) as BankAtRead;
}

async function her(): Promise<Life> {
  const life = await herLife();
  setUpHer(life);
  life.now = noonInNewYork('2026-10-02');
  return life;
}

async function upstream(): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  return life;
}

async function within(make: () => Promise<Life>, run: (life: Life) => Promise<void>): Promise<void> {
  const life = await make();
  try {
    await run(life);
  } finally {
    life.done();
  }
}

describe('12.1 her setup: the posted balance for her Capital One checking and savings (HA8)', () => {
  it('12.1 a debit card purchase Capital One holds and Plaid does not list moves only the available balance: the totals still match', () =>
    within(her, async (life) => {
      life.h.fake.holdAvailable(C, 4_210);
      await life.sync();
      expect(difference(life)).toBeNull();
      // The Status page (0.7) reads the same check.
      expect(bankStatus(life.h.db).selfCheck).toMatchObject({ ok: true, difference: 0 });
    }));

  it("12.1 the same purchase in upstream's setup is a difference until it posts: upstream keeps the available balance (A47)", () =>
    within(upstream, async (life) => {
      life.h.fake.holdAvailable(C, 4_210);
      await life.sync();
      expect(difference(life)).toBe(-4_210);
      expect(bankStatus(life.h.db).selfCheck).toMatchObject({ difference: -4_210 });
    }));

  it('12.1 when it posts, the posted balance and the books move together, and the totals still match', () =>
    within(her, async (life) => {
      life.h.fake.holdAvailable(C, 4_210);
      await life.sync();
      life.now = noonInNewYork('2026-10-04');
      life.h.fake.holdAvailable(C, 0);
      life.h.fake.addPosted({ id: 'grocer-1', account: C, amount: 4_210, date: '2026-10-02', description: 'MADE UP GROCER' });
      await life.sync();
      expect(difference(life)).toBeNull();
      expect(lastRead(life).accounts.checking.counted).toBe(lastRead(life).accounts.checking.posted);
    }));

  it('12.1 money Capital One makes available before it posts (an early paycheck) makes no gap', () =>
    within(her, async (life) => {
      life.h.fake.holdAvailable(C, -250_000);
      await life.sync();
      expect(difference(life)).toBeNull();
    }));

  it('12.1 savings too: money leaving savings that Capital One holds makes no gap', () =>
    within(her, async (life) => {
      life.h.fake.holdAvailable(S, 60_000);
      await life.sync();
      expect(difference(life)).toBeNull();
    }));

  it('12.1 one cent held, and a very large amount held, change nothing', () =>
    within(her, async (life) => {
      life.h.fake.holdAvailable(C, 1);
      await life.sync();
      expect(difference(life)).toBeNull();
      life.h.fake.holdAvailable(C, 0);
      life.h.fake.holdAvailable(S, 999_999_999_99);
      await life.sync();
      expect(difference(life)).toBeNull();
    }));

  it('12.1 a pending charge Plaid does list is still counted once: the posted balance less pending charges', () =>
    within(her, async (life) => {
      life.h.fake.addPending({ id: 'p-cafe', account: C, amount: 3_000, date: '2026-10-02', description: 'MADE UP CAFE' });
      await life.sync();
      expect(difference(life)).toBeNull();
      const read = lastRead(life).accounts.checking;
      expect(read.counted).toBe(read.posted - 3_000);
    }));

  it('12.1 each read keeps her checking and savings with no available balance and the posted one counted, so 12.6 reads them by the posted balance', () =>
    within(her, async (life) => {
      life.h.fake.holdAvailable(C, 4_210);
      await life.sync();
      const read = lastRead(life);
      expect(read.accounts.checking).toMatchObject({ available: null, counted: read.accounts.checking.posted });
      expect(read.accounts.savings).toMatchObject({ available: null, counted: read.accounts.savings.posted });
    }));

  it("12.1 the risk HA8 names (B231): a posted item Capital One's posted balance has not taken in yet is a difference until the bank's overnight run, and 12.6 names the posted balance", () =>
    within(her, async (life) => {
      await life.sync();
      life.now = noonInNewYork('2026-10-03');
      life.h.fake.addPosted({ id: 'grocer-2', account: C, amount: 1_500, date: '2026-10-03', description: 'MADE UP GROCER' });
      life.h.fake.notInCurrentYet(C, 1_500);
      await life.sync();
      expect(difference(life)).toBe(1_500);
      expect(homeWhy(life)).toEqual([{ kind: 'balance-moved', account: 'checking', balance: 'posted', went: 'up', by: 1_500, amount: 1_500 }]);
      life.now = noonInNewYork('2026-10-04');
      life.h.fake.overnightProcessing();
      await life.sync();
      expect(difference(life)).toBeNull();
    }));
});

describe("12.1 her setup day's starting money (14.1, 14.2) from the posted balance (HA8)", () => {
  async function bankSideAt(make: () => Promise<Life>, held: Cents): Promise<number> {
    const life = await make();
    try {
      life.h.fake.holdAvailable(C, held);
      await life.sync();
      const view = life.keeper.setupView();
      if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
      return view.bankSide;
    } finally {
      life.done();
    }
  }

  it('12.1 her setup day counts the posted balance: what Capital One holds does not change the starting money', async () => {
    expect(await bankSideAt(herLife, 7_777)).toBe(await bankSideAt(herLife, 0));
  });

  it("12.1 upstream's setup day still counts the available balance", async () => {
    expect(await bankSideAt(() => lifeInAFile(), 7_777)).toBe((await bankSideAt(() => lifeInAFile(), 0)) - 7_777);
  });
});

// The lowest level: bankView itself, with her accounts as the bank connection keeps them.
function account(id: string, role: StoredAccount['role'], kind: 'depository' | 'credit', current: Cents, available: Cents | null): StoredAccount {
  const raw = {
    account_id: id,
    balances: { available: available === null ? null : available / 100, current: current / 100, iso_currency_code: 'USD', limit: null, unofficial_currency_code: null },
    mask: '0000',
    name: `Made-up ${id}`,
    official_name: null,
    subtype: kind === 'credit' ? 'credit card' : 'checking',
    type: kind,
  } as unknown as PlaidAccount;
  return { plaidAccountId: id, role, raw, rawText: JSON.stringify(raw) };
}

function pendingCharge(id: string, accountId: string, amount: Cents): StoredItem {
  return { transactionId: id, accountId, raw: {}, pending: true, amountCents: amount, removed: false, status: 'history', kind: 'purchase', bookId: null, replacedBy: null, firstSync: 1, lastSync: 1 };
}

describe('12.1 her bank side, whatever the available balances (HA8)', () => {
  it('12.1 random balances: with the posted balance on, checking and savings are the posted balance less the pending charges Plaid lists, and the available balance never moves them', () => {
    const cents = fc.integer({ min: -10_000_000_00, max: 10_000_000_00 });
    const orNull = fc.option(cents, { nil: null });
    fc.assert(
      fc.property(cents, cents, orNull, orNull, fc.array(fc.integer({ min: 1, max: 100_000_00 }), { maxLength: 4 }), (checking, savings, checkingAvailable, savingsAvailable, charges) => {
        const accounts = [
          account('c', 'checking', 'depository', checking, checkingAvailable),
          account('s', 'savings', 'depository', savings, savingsAvailable),
          account('e', 'everyday-card', 'credit', 12_345, null),
          account('x', 'second-card', 'credit', 6_789, null),
        ];
        const items = new Map(charges.map((amount, i) => [`p${i}`, pendingCharge(`p${i}`, i % 2 === 0 ? 'c' : 's', amount)] as const));
        const view = bankView(accounts, items, { postedBalance: true });
        if (!view.ok) throw new Error(view.why);
        const chargedOn = (id: string): number => charges.filter((_, i) => (i % 2 === 0 ? 'c' : 's') === id).reduce((a, b) => a + b, 0);
        expect(view.view.withPending.checking).toBe(checking - chargedOn('c'));
        expect(view.view.withPending.savings).toBe(savings - chargedOn('s'));
        expect(view.view.available).toEqual({ checking: null, savings: null });
        // Upstream's way, from the same bank, unchanged: with no posted
        // balance asked for, an available balance is used where one is given.
        const upstreamView = bankView(accounts, items);
        if (!upstreamView.ok) throw new Error(upstreamView.why);
        expect(upstreamView.view.available).toEqual({ checking: checkingAvailable, savings: savingsAvailable });
      }),
      { numRuns: runs(1_000) },
    );
  });
});

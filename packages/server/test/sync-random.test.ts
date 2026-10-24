import { addDays, startTracking, type BankBalances, type BankTransaction, type Book, type Cents, type Pots, type SetupInput } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { bookEvents } from '../src/db/store.js';
import { setupPreview, setUpTracking } from '../src/setup-day.js';
import { ACCOUNT_IDS, type FakePlaid } from './fake-plaid.js';
import { SETTINGS, SETUP_DAY, SORTING_RULES, book, connected, status, type Harness } from './harness.js';
import { lives as count } from './slow.js';

// Random scenarios (testing bar point 4): made-up weeks of bank activity,
// run through two copies of the app. One syncs every day, with pages of
// random sizes, and with syncs that get cut off partway or fail while saving
// and are run again. The other syncs every few days in big pages. What must
// always be true:
// - the self-check passes after every sync, against the bank's own balances,
//   worked out here from the made-up bank and not from the app;
// - every bucket adds up again from scratch, and the old card debt matches
//   the old card;
// - nothing the bank sent waits for a decision (every item is understood,
//   and the app follows the bank when it changes or takes back something
//   already counted: A13, A14);
// - a transfer between his own accounts never changes a bucket;
// - however the syncs fell, both copies end with the same money.
// A failure names its seed: SEED=n replays one.

const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;
const E = ACCOUNT_IDS.everyday;
const O = ACCOUNT_IDS.old;

// sfc32: small, fast, and the same everywhere for a seed.
function random(seed: number): () => number {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i += 1) next();
  return next;
}

type Op = (fake: FakePlaid) => void;

interface Scenario {
  // What the bank does on each day after setup day.
  readonly days: Op[][];
  // Pending charges that are purchases: they count in the bank side while pending.
  readonly pendingPurchases: Set<string>;
}

const SHOPS = ['COFFEE SHOP', 'GROCERY OUTLET', 'GAS STATION 9', 'SOMEWHERE NEW', 'BOOKSTORE'];

function scenario(seed: number, activeDays: number, quietDays: number): Scenario {
  const r = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const chance = (p: number): boolean => r() < p;
  const days: Op[][] = Array.from({ length: activeDays + quietDays }, () => []);
  const pendingPurchases = new Set<string>();
  let n = 0;
  const id = (what: string): string => `${what}${(n += 1)}`;
  const amount = (): Cents => (chance(0.1) ? 1 : chance(0.1) ? 10_000 : 1 + Math.floor(r() * 20_000));
  const at = (day: number, op: Op): void => {
    days[Math.min(day, days.length - 1)]?.push(op);
  };
  const dateOf = (day: number): string => addDays(SETUP_DAY, day + 1);

  for (let day = 0; day < activeDays; day += 1) {
    const date = dateOf(day);
    const events = 2 + Math.floor(r() * 6);
    for (let e = 0; e < events; e += 1) {
      const roll = r();
      if (roll < 0.4) {
        // A purchase, on checking or the everyday card.
        const account = chance(0.4) ? C : E;
        const description = pick(SHOPS);
        const cents = amount();
        const tx = id('buy');
        // Every random choice is made here, once, so both copies see the same bank.
        if (chance(0.5)) {
          pendingPurchases.add(tx);
          at(day, (f) => f.addPending({ id: tx, account, amount: cents, date, description }));
          const later = day + 1 + Math.floor(r() * 3);
          // A13: now and then the amount changes while it is still pending,
          // the day before it posts or drops (maybe the day it showed up).
          const changed = chance(0.2) ? 1 + Math.floor(r() * 20_000) : null;
          if (changed !== null) at(later - 1, (f) => f.modify(tx, { amount: changed }));
          const end = r();
          const final = chance(0.3) ? cents + 1 + Math.floor(r() * 2_000) : cents;
          const inPlace = chance(0.5) ? { amount: cents + 100 } : {};
          if (end < 0.55) at(later, (f) => f.postPending(tx, { id: `${tx}p`, date: dateOf(later), amount: final }));
          else if (end < 0.65) at(later, (f) => f.postPending(tx, { id: `${tx}p`, date: dateOf(later) }, { link: false }));
          else if (end < 0.85) at(later, (f) => f.dropPending(tx));
          else at(later, (f) => f.postInPlace(tx, { date: dateOf(later), ...inPlace }));
        } else {
          const authorizedDate = chance(0.3) ? addDays(date, -1) : date;
          at(day, (f) => f.addPosted({ id: tx, account, amount: cents, date, description, authorizedDate }));
          // A14: now and then the bank takes it back (a copy shown twice, say),
          // or corrects its amount.
          const fate = r();
          const when = day + 1 + Math.floor(r() * 3);
          const fixed = 1 + Math.floor(r() * 20_000);
          if (fate < 0.08) at(when, (f) => f.removePosted(tx, { keepBalance: false }));
          else if (fate < 0.16) at(when, (f) => f.modify(tx, { amount: fixed }));
        }
      } else if (roll < 0.47) {
        // Something on the old card: a purchase (5.4) or interest (5.5).
        const tx = id('old');
        const description = chance(0.5) ? 'HARDWARE STORE' : 'INTEREST CHARGE ON PURCHASES';
        const cents = amount();
        at(day, (f) => f.addPosted({ id: tx, account: O, amount: cents, date, description }));
      } else if (roll < 0.52) {
        const tx = id('ref');
        const cents = amount();
        at(day, (f) => f.addPosted({ id: tx, account: E, amount: -cents, date, description: 'STORE RETURN' }));
        if (chance(0.1)) at(day + 1 + Math.floor(r() * 2), (f) => f.removePosted(tx, { keepBalance: false }));
      } else if (roll < 0.55) {
        const tx = id('int');
        const cents = amount();
        at(day, (f) => f.addPosted({ id: tx, account: E, amount: cents, date, description: 'INTEREST CHARGE ON PURCHASES' }));
      } else if (roll < 0.62) {
        // Money in: a pending deposit first, sometimes.
        const tx = id('dep');
        const account = chance(0.7) ? C : S;
        const cents = amount();
        if (chance(0.4)) {
          at(day, (f) => f.addPending({ id: tx, account, amount: -cents, date, description: 'MOBILE DEPOSIT' }));
          at(day + 1, (f) => f.postPending(tx, { id: `${tx}p`, date: dateOf(day + 1) }));
        } else {
          at(day, (f) => f.addPosted({ id: tx, account, amount: -cents, date, description: 'MOBILE DEPOSIT' }));
        }
      } else if (roll < 0.7) {
        // A payment to mom or a friend, sometimes pending first, now and then
        // from savings (A16).
        const tx = id('zel');
        const description = chance(0.5) ? 'Zelle payment to MOM MADEUP' : 'Zelle payment to FRIEND MADEUP';
        const account = chance(0.2) ? S : C;
        const cents = amount();
        if (chance(0.3)) {
          at(day, (f) => f.addPending({ id: tx, account, amount: cents, date, description }));
          at(day + 1, (f) => f.postInPlace(tx, { date: dateOf(day + 1) }));
        } else {
          at(day, (f) => f.addPosted({ id: tx, account, amount: cents, date, description }));
        }
      } else if (roll < 0.92) {
        // A transfer between his accounts, as two halves, the landing up to
        // three days later, or now and then a day before it shows leaving.
        const routes = [
          [C, 'Online Banking transfer to SAV 2222', S, 'Online Banking transfer from CHK 1111'],
          [S, 'Online Banking transfer to CHK 1111', C, 'Online Banking transfer from SAV 2222'],
          [C, 'Online payment to CRD 3333', E, 'PAYMENT - THANK YOU'],
          [C, 'Online payment to CRD 4444', O, 'PAYMENT - THANK YOU'],
          [S, 'Online payment to CRD 3333', E, 'PAYMENT - THANK YOU'],
        ] as const;
        const [from, leaves, to, lands] = pick(routes);
        // Distinct amounts, so two transfers in flight cannot be mixed up.
        const cents = 10_000 + (n + 1) * 7;
        const out = id('out');
        const into = id('in');
        const lag = chance(0.15) ? -1 : Math.floor(r() * 4);
        const leaveDay = lag < 0 ? day + 1 : day;
        const landDay = lag < 0 ? day : day + lag;
        at(leaveDay, (f) => f.addPosted({ id: out, account: from, amount: cents, date: dateOf(leaveDay), description: leaves }));
        at(landDay, (f) => f.addPosted({ id: into, account: to, amount: -cents, date: dateOf(landDay), description: lands }));
      } else if (roll < 0.95) {
        // A bill paid straight from savings: spending to sort (4.9, A16).
        const tx = id('bill');
        const cents = amount();
        at(day, (f) => f.addPosted({ id: tx, account: S, amount: cents, date, description: 'BILL PAY MADE UP INSURANCE' }));
      } else {
        // The bank tidies up a description: nothing changes in the book.
        const tx = id('tidy');
        const cents = amount();
        at(day, (f) => f.addPosted({ id: tx, account: C, amount: cents, date, description: 'COFFEE SHOP' }));
        at(day + 1, (f) => f.modify(tx, { description: 'COFFEE SHOP DOWNTOWN' }));
      }
    }
    // Paychecks every 14 days from the last one (Sep 25).
    if (date === '2026-10-09' || date === '2026-10-23' || date === '2026-11-06') {
      const tx = id('pay');
      at(day, (f) => f.addPosted({ id: tx, account: C, amount: -250_000, date, description: 'MADEUP CORP PAYROLL' }));
    }
  }
  return { days, pendingPurchases };
}

// The bank side, worked out from the made-up bank itself (12.1): posted
// balances, with the pending purchases added.
function bankSideFromFake(fake: FakePlaid, pendingPurchases: ReadonlySet<string>): { bank: BankBalances; oldCard: Cents } {
  const pending = (account: string): Cents =>
    [...fake.transactions.values()]
      .filter((t) => t.pending && t.account_id === account && pendingPurchases.has(t.transaction_id))
      .reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
  return {
    bank: { checking: fake.posted(C) - pending(C), savings: fake.posted(S), everydayCard: fake.posted(E) + pending(E) },
    oldCard: fake.posted(O) + pending(O),
  };
}

function checkAfterSync(h: Harness, s: Scenario, where: string): void {
  const b = book(h);
  const own = status(h);
  expect(own.selfCheck?.ok, `${where}: the self-check`).toBe(true);
  const fromFake = bankSideFromFake(h.fake, s.pendingPurchases);
  expect(b.selfCheck(fromFake.bank), `${where}: against the bank's own balances`).toMatchObject({ ok: true });
  expect(b.recountPots(), `${where}: buckets add up from scratch`).toEqual(b.pots());
  expect(b.oldCardDebt(), `${where}: the old card debt`).toBe(fromFake.oldCard);
  expect(own.attention, `${where}: nothing waits for a decision`).toEqual([]);
}

// A transfer between checking, savings and the everyday card changes no
// bucket (5.1, 5.3): replayed one at a time, no transfer half moves a pot.
function checkTransfersTouchNoBucket(h: Harness): void {
  const [setup, ...rest] = bookEvents(h.db);
  const result = startTracking(setup?.payload as SetupInput);
  if (!result.ok) throw new Error('the setup in the book history does not add up');
  const replay: Book = result.book;
  let pots: Pots = replay.pots();
  for (const event of rest) {
    const txn = event.payload as BankTransaction;
    replay.receive(txn);
    const now = replay.pots();
    if ((txn.kind === 'transfer-sent' || txn.kind === 'transfer-arrived') && txn.to !== 'old-card') {
      expect(now, `transfer ${txn.id} changed a bucket`).toEqual(pots);
    }
    pots = now;
  }
}

function moneyOf(h: Harness): unknown {
  const b = book(h);
  const review = b
    .reviewItems()
    .map((item) => `${item.type} ${'reason' in item ? item.reason : ''} ${'amount' in item ? item.amount : ''}`)
    .sort();
  return { pots: b.pots(), debt: b.oldCardDebt(), inTransit: b.inTransit().total, review };
}

async function setUpBoth(): Promise<Harness> {
  const h = await connected();
  const money = setupPreview(h.db, []).startingMoney;
  const outcome = setUpTracking(h.db, {
    today: SETUP_DAY,
    assignment: { savings: 400_000, momReserve: 100_000, wants: 20_000, heldForOthers: 0, needs: money - 520_000 },
    lastPaycheckDate: '2026-09-25',
    settings: SETTINGS,
    rules: SORTING_RULES,
    inTransit: [],
  });
  if (!outcome.ok) throw new Error('setup did not add up');
  return h;
}

async function run(seed: number): Promise<void> {
  const s = scenario(seed, 16, 6);
  const daily = await setUpBoth();
  const rarely = await setUpBoth();
  const r = random(seed * 7919 + 1);
  for (let day = 0; day < s.days.length; day += 1) {
    const today = addDays(SETUP_DAY, day + 1);
    for (const op of s.days[day] ?? []) {
      op(daily.fake);
      op(rarely.fake);
    }
    // The daily copy: random pages, and now and then a sync that is cut off
    // partway, or fails while saving, and is run again.
    const pageSize = 1 + Math.floor(r() * 5);
    const trouble = r();
    if (trouble < 0.15) {
      const failAt = 1 + Math.floor(r() * 4);
      let calls = 0;
      daily.fake.beforeCall = () => ((calls += 1) === failAt ? 'network' : undefined);
      await daily.sync(today, { pageSize }).catch(() => undefined);
      daily.fake.beforeCall = undefined;
    } else if (trouble < 0.25) {
      await daily
        .sync(today, {
          pageSize,
          beforeCommit: () => {
            throw new Error('made-up crash while saving');
          },
        })
        .catch(() => undefined);
    }
    await daily.sync(today, { pageSize });
    checkAfterSync(daily, s, `seed ${seed}, daily copy, ${today}`);
    // The other copy: every third day, and on the last day.
    if (day % 3 === 2 || day === s.days.length - 1) {
      await rarely.sync(today, { pageSize: 100 });
      checkAfterSync(rarely, s, `seed ${seed}, rarely copy, ${today}`);
    }
  }
  expect(moneyOf(daily), `seed ${seed}: both copies end with the same money`).toEqual(moneyOf(rarely));
  expect(book(daily).inTransit().total, `seed ${seed}: everything landed`).toBe(0);
  checkTransfersTouchNoBucket(daily);
  checkTransfersTouchNoBucket(rarely);
}

describe('random scenarios through the bank connection', () => {
  const only = process.env['SEED'];
  const runs = Number(process.env['BANK_SCENARIOS'] ?? count(25, 10));
  const seeds = only === undefined ? Array.from({ length: runs }, (_, i) => i + 1) : [Number(only)];
  it.each(seeds)('random: seed %i keeps every rule above', async (seed) => {
    await run(seed);
  }, 60_000);
});

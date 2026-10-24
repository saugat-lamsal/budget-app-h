import { HER_SETTINGS, HER_SWITCHES, addDays, startTracking, type BankBalances, type BankTransaction, type Book, type Cents, type Pots, type SetupInput } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { checkBankRules } from '../src/bank/reading.js';
import { bookEvents } from '../src/db/store.js';
import { memoryLog } from '../src/log.js';
import { setupPreview, setUpTracking } from '../src/setup-day.js';
import { syncBank } from '../src/sync/sync.js';
import { ACCOUNT_IDS, type FakePlaid } from './fake-plaid.js';
import { SETUP_DAY, SORTING_RULES, book, bothBanks, connected, status, type Harness } from './harness.js';
import { HER_BANK_RULES } from './her-harness.js';

// Her rulebook, PR 6 (testing bar point 4): random weeks of activity at her
// two banks, each its own connection (1.1), through two copies of the app.
// One syncs every day with pages of random sizes, and now and then one bank
// cannot be read that day while the other is (section 2: what the other
// read is kept, and the failed one is read at the next time). The other
// copy syncs every few days in big pages. What must always be true:
// - after every sync the self-check passes against what each bank last sent
//   (12.3: each bank's latest good read); on a day both banks were read, also
//   against both made-up banks' own balances, worked out here;
// - every bucket adds up again from scratch;
// - a payment from checking at one bank to the card at the other never
//   changes a bucket (5.1), whichever bank shows its half first;
// - however the syncs fell, both copies end with the same money.
// A failure names its seed: SEED=n replays one. Every name and number is made up.

const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;
const E = ACCOUNT_IDS.everyday;
const A = ACCOUNT_IDS.second;

const RULES = checkBankRules([
  ...HER_BANK_RULES,
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'sav-pays-second', account: 'savings', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'second-interest', account: 'second-card', contains: 'INTEREST CHARGE', means: 'card-interest' },
]);

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

// What the banks do on one day: given both banks as one (bothBanks). Every
// random choice is made when the scenario is made, once, so both copies see
// the same banks.
type Op = (banks: FakePlaid) => void;

interface Scenario {
  readonly days: Op[][];
  // Pending charges that are purchases: they count in the bank side while pending.
  readonly pendingPurchases: Set<string>;
}

const SHOPS = ['COFFEE SHOP', 'GROCERY OUTLET', 'GAS STATION 9', 'SOMEWHERE NEW'];

function scenario(seed: number, activeDays: number, quietDays: number): Scenario {
  const r = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const chance = (p: number): boolean => r() < p;
  const days: Op[][] = Array.from({ length: activeDays + quietDays }, () => []);
  const pendingPurchases = new Set<string>();
  let n = 0;
  const id = (what: string): string => `${what}${(n += 1)}`;
  const amount = (): Cents => (chance(0.1) ? 1 : chance(0.05) ? 99_999_999 : 1 + Math.floor(r() * 20_000));
  const at = (day: number, op: Op): void => {
    days[Math.min(day, days.length - 1)]?.push(op);
  };
  const dateOf = (day: number): string => addDays(SETUP_DAY, day + 1);
  for (let day = 0; day < activeDays; day += 1) {
    const date = dateOf(day);
    const events = 2 + Math.floor(r() * 6);
    for (let e = 0; e < events; e += 1) {
      const roll = r();
      if (roll < 0.45) {
        // A purchase on the debit card, the everyday card, or the second card (4.1).
        const account = pick([C, E, A, A]);
        const description = pick(SHOPS);
        const cents = amount();
        const tx = id('buy');
        if (chance(0.5)) {
          pendingPurchases.add(tx);
          at(day, (f) => f.addPending({ id: tx, account, amount: cents, date, description }));
          const later = day + 1 + Math.floor(r() * 3);
          const end = r();
          const final = chance(0.3) ? cents + 1 + Math.floor(r() * 2_000) : cents;
          if (end < 0.6) at(later, (f) => f.postPending(tx, { id: `${tx}p`, date: dateOf(later), amount: final }));
          else if (end < 0.8) at(later, (f) => f.dropPending(tx));
          else at(later, (f) => f.postInPlace(tx, { date: dateOf(later) }));
        } else {
          at(day, (f) => f.addPosted({ id: tx, account, amount: cents, date, description }));
          if (chance(0.08)) at(day + 1 + Math.floor(r() * 3), (f) => f.removePosted(tx, { keepBalance: false }));
        }
      } else if (roll < 0.52) {
        // Money back on a card.
        const tx = id('ref');
        const account = pick([E, A]);
        const cents = amount();
        at(day, (f) => f.addPosted({ id: tx, account, amount: -cents, date, description: 'STORE RETURN' }));
      } else if (roll < 0.56) {
        // Interest on either card (4.8).
        const tx = id('int');
        const account = pick([E, A]);
        const cents = amount();
        at(day, (f) => f.addPosted({ id: tx, account, amount: cents, date, description: 'INTEREST CHARGE ON PURCHASES' }));
      } else if (roll < 0.62) {
        const tx = id('dep');
        const account = pick([C, S]);
        const cents = amount();
        at(day, (f) => f.addPosted({ id: tx, account, amount: -cents, date, description: 'MOBILE DEPOSIT' }));
      } else {
        // A transfer between her accounts as two halves, maybe at two banks,
        // the landing up to three days later or a day before it shows leaving.
        const routes = [
          [C, 'Online Banking transfer to SAV 2222', S, 'Online Banking transfer from CHK 1111'],
          [S, 'Online Banking transfer to CHK 1111', C, 'Online Banking transfer from SAV 2222'],
          [C, 'Online payment to CRD 3333', E, 'PAYMENT - THANK YOU'],
          [C, 'Online payment to CRD 5555', A, 'PAYMENT - THANK YOU'],
          [C, 'Online payment to CRD 5555', A, 'PAYMENT - THANK YOU'],
          [S, 'Online payment to CRD 5555', A, 'PAYMENT - THANK YOU'],
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
      }
    }
  }
  return { days, pendingPurchases };
}

// The bank side from both made-up banks themselves (12.1): posted balances,
// with the pending purchases added.
function bankSideFromFakes(first: FakePlaid, second: FakePlaid, pendingPurchases: ReadonlySet<string>): BankBalances {
  const pending = (fake: FakePlaid, account: string): Cents =>
    [...fake.transactions.values()].filter((t) => t.pending && t.account_id === account && pendingPurchases.has(t.transaction_id)).reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
  return { checking: first.posted(C) - pending(first, C), savings: first.posted(S), everydayCard: first.posted(E) + pending(first, E), secondCard: second.posted(A) + pending(second, A) };
}

function secondOf(h: Harness): FakePlaid {
  if (h.second === undefined) throw new Error('her second bank is not there');
  return h.second;
}

function checkAfterSync(h: Harness, s: Scenario, where: string, bothRead: boolean): void {
  const b = book(h);
  const own = status(h);
  expect(own.selfCheck?.ok, `${where}: the self-check, each bank as it last sent`).toBe(true);
  if (bothRead) expect(b.selfCheck(bankSideFromFakes(h.fake, secondOf(h), s.pendingPurchases)), `${where}: against both banks' own balances`).toMatchObject({ ok: true });
  expect(b.recountPots(), `${where}: buckets add up from scratch`).toEqual(b.pots());
  expect(own.attention, `${where}: nothing waits for a decision`).toEqual([]);
}

// 5.1, 5.3: no transfer half between her own accounts moves a bucket, at either bank.
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
    if (txn.kind === 'transfer-sent' || txn.kind === 'transfer-arrived') expect(now, `transfer ${txn.id} changed a bucket`).toEqual(pots);
    pots = now;
  }
}

function moneyOf(h: Harness): unknown {
  const b = book(h);
  const review = b
    .reviewItems()
    .map((item) => `${item.type} ${'reason' in item ? item.reason : ''} ${'amount' in item ? item.amount : ''}`)
    .sort();
  return { pots: b.pots(), inTransit: b.inTransit().total, review };
}

async function setUpHer(): Promise<Harness> {
  const h = await connected({ herSetup: true, twoBanks: true, secondCard: 25_000, rules: RULES });
  const money = setupPreview(h.db, [], HER_SWITCHES).startingMoney;
  const outcome = setUpTracking(
    h.db,
    {
      today: SETUP_DAY,
      // Nothing in a mom reserve: her setup has none ("Off in this setup").
      assignment: { savings: 400_000, momReserve: 0, wants: 20_000, heldForOthers: 0, needs: money - 420_000 },
      lastPaycheckDate: '2026-09-25',
      settings: { ...HER_SETTINGS, leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } },
      rules: SORTING_RULES,
      inTransit: [],
    },
    HER_SWITCHES,
  );
  if (!outcome.ok) throw new Error(`setup did not add up: ${JSON.stringify(outcome)}`);
  return h;
}

// One sync of each bank, the first first; the bank that cannot be read that day fails.
async function syncEach(h: Harness, today: string, pageSize: number, unreadable: 1 | 2 | null): Promise<void> {
  for (const bank of [1, 2] as const) {
    const fake = bank === 1 ? h.fake : secondOf(h);
    if (unreadable === bank) fake.beforeCall = () => 'network';
    await syncBank({ db: h.db, plaid: h.plaid, box: h.box, log: memoryLog([]), today, pageSize, ...(bank === 2 ? { bank } : {}) }).catch((error: unknown) => {
      if (unreadable !== bank) throw error;
    });
    fake.beforeCall = undefined;
  }
}

async function run(seed: number): Promise<void> {
  const s = scenario(seed, 14, 6);
  const daily = await setUpHer();
  const rarely = await setUpHer();
  const r = random(seed * 7919 + 1);
  for (let day = 0; day < s.days.length; day += 1) {
    const today = addDays(SETUP_DAY, day + 1);
    for (const op of s.days[day] ?? []) {
      op(bothBanks(daily.fake, secondOf(daily)));
      op(bothBanks(rarely.fake, secondOf(rarely)));
    }
    // The daily copy: random pages, and now and then one bank not read that
    // day; never on the last day, so both end read.
    const last = day === s.days.length - 1;
    const roll = r();
    const unreadable = last ? null : roll < 0.12 ? 1 : roll < 0.24 ? 2 : null;
    await syncEach(daily, today, 1 + Math.floor(r() * 5), unreadable);
    checkAfterSync(daily, s, `seed ${seed}, daily copy, ${today}${unreadable === null ? '' : `, bank ${unreadable} not read`}`, unreadable === null);
    if (day % 3 === 2 || last) {
      await syncEach(rarely, today, 100, null);
      checkAfterSync(rarely, s, `seed ${seed}, rarely copy, ${today}`, true);
    }
  }
  expect(moneyOf(daily), `seed ${seed}: both copies end with the same money`).toEqual(moneyOf(rarely));
  expect(book(daily).inTransit().total, `seed ${seed}: everything landed`).toBe(0);
  checkTransfersTouchNoBucket(daily);
  checkTransfersTouchNoBucket(rarely);
}

describe('her random scenarios through two bank connections', () => {
  const only = process.env['SEED'];
  const runs = Number(process.env['HER_BANK_SCENARIOS'] ?? 20);
  const seeds = only === undefined ? Array.from({ length: runs }, (_, i) => i + 1) : [Number(only)];
  it.each(seeds)('section 2 12.3 5.1 random: seed %i, her two banks, keeps every rule above', async (seed) => {
    await run(seed);
  }, 120_000);
});

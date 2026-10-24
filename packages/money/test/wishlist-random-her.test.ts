// Her rulebook, PR 9, random scenarios: things that must always be true with
// the Wishlist bucket. For every amount and every four-way split the parts add
// up to the paycheck exactly (3.3). Through random lives of paydays, purchases
// sorted to needs, wants, Wishlist or split across them, refunds, take-backs,
// hand moves and transfers between her own accounts: no cent is made or lost
// (the books recount to what they hold, and every change on the app side is
// the same change at a bank kept here on its own), a transfer between her own
// accounts never changes Wishlist, the self-check holds, and 50.4's $X is never
// above the extra in savings nor the Wishlist purchases not yet moved, is
// $0.00 right after a move of exactly $X, and never goes up with a refund.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HER_SETTINGS, HER_SWITCHES, changeSettings, openBook, splitPaycheck, wishlistMove, type Book, type Cents, type IsoDate, type SortChoice } from '../src/index.js';
import { LAST_PAYCHECK, PAYROLL, START_DATE, deposit, paycheck, purchase, refund, takenBack, transfer } from './helpers.js';

const MAX = Number.MAX_SAFE_INTEGER;
const RUNS = Number(process.env['WISHLIST_RANDOM_RUNS'] ?? 150);

// Four whole percents that add up to 100.
const splitArb = fc
  .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }))
  .map(([a, b, c]) => {
    const [x, y, z] = [a, b, c].sort((p, q) => p - q) as [number, number, number];
    return { savings: x, needs: y - x, wants: z - y, wishlist: 100 - z };
  });

describe('3.3 random: the four parts add up to the paycheck exactly', () => {
  it('3.3 for every amount from 1 cent to the largest exact total and every four-way split, the parts add up exactly, needs, wants and Wishlist rounded down and the rest to savings', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ min: 1, max: 1_000 }), fc.integer({ min: 1, max: MAX }), fc.constantFrom(1, 99, 100, 101, MAX)), splitArb, (amount, split) => {
        const parts = splitPaycheck(amount, 0, { split, momReservePerPaycheck: 0, momReserveCap: 0 });
        expect(parts.savings + parts.needs + parts.wants + (parts.wishlist ?? 0)).toBe(amount);
        const floor = (percent: number): number => Number((BigInt(amount) * BigInt(percent)) / 100n);
        expect([parts.needs, parts.wants, parts.wishlist]).toEqual([floor(split.needs), floor(split.wants), floor(split.wishlist)]);
        expect(parts.savings - floor(split.savings)).toBeGreaterThanOrEqual(0);
        expect(parts.savings - floor(split.savings)).toBeLessThan(4);
        expect(parts.momReserve).toBe(0);
      }),
      { numRuns: 2_000 },
    );
  });
});

type Account = 'checking' | 'savings' | 'everyday-card' | 'second-card';
type Step =
  | { kind: 'paycheck'; amount: Cents }
  | { kind: 'purchase'; account: 'checking' | 'everyday-card' | 'second-card'; amount: Cents; sort: 'needs' | 'wants' | 'wishlist' | 'split' | 'unsorted' }
  | { kind: 'refund'; pick: number; part: number }
  | { kind: 'take-back'; pick: number }
  | { kind: 'resort'; pick: number; to: 'needs' | 'wants' | 'wishlist' }
  | { kind: 'transfer'; from: 'checking' | 'savings'; to: Account; amount: Cents }
  | { kind: 'move'; from: 'savings' | 'needs' | 'wants' | 'wishlist' | 'heldForOthers'; to: 'savings' | 'needs' | 'wants' | 'wishlist' | 'heldForOthers'; amount: Cents }
  | { kind: 'other-income'; amount: Cents }
  | { kind: 'split'; split: { savings: number; needs: number; wants: number; wishlist: number } }
  | { kind: 'move-x' };

const pot = fc.constantFrom('savings', 'needs', 'wants', 'wishlist', 'heldForOthers') as fc.Arbitrary<'savings' | 'needs' | 'wants' | 'wishlist' | 'heldForOthers'>;
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('paycheck' as const), amount: fc.oneof(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 600_000 })) }) },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('purchase' as const),
      account: fc.constantFrom('checking', 'everyday-card', 'second-card') as fc.Arbitrary<'checking' | 'everyday-card' | 'second-card'>,
      amount: fc.oneof(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 80_000 })),
      sort: fc.constantFrom('needs', 'wants', 'wishlist', 'wishlist', 'split', 'unsorted') as fc.Arbitrary<'needs' | 'wants' | 'wishlist' | 'split' | 'unsorted'>,
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('refund' as const), pick: fc.nat(), part: fc.integer({ min: 1, max: 100 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('take-back' as const), pick: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('resort' as const), pick: fc.nat(), to: fc.constantFrom('needs', 'wants', 'wishlist') as fc.Arbitrary<'needs' | 'wants' | 'wishlist'> }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('transfer' as const),
      from: fc.constantFrom('checking', 'savings') as fc.Arbitrary<'checking' | 'savings'>,
      to: fc.constantFrom('checking', 'savings', 'everyday-card', 'second-card') as fc.Arbitrary<Account>,
      amount: fc.integer({ min: 1, max: 100_000 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('move' as const), from: pot, to: pot, amount: fc.integer({ min: 1, max: 50_000 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('other-income' as const), amount: fc.integer({ min: 1, max: 50_000 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('split' as const), split: splitArb }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('move-x' as const) }) },
);

// Her bank, kept here with its own arithmetic: what each account holds or owes.
class Bank {
  readonly held: Record<Account, Cents> = { checking: 300_000, savings: 150_000, 'everyday-card': 20_000, 'second-card': 10_000 };
  readonly #done = new Map<string, { account: Account; amount: Cents } | { from: Account; to: Account; amount: Cents }>();

  spend(id: string, account: Account, amount: Cents): void {
    this.#change(account, amount);
    this.#done.set(id, { account, amount });
  }

  move(id: string, from: Account, to: Account, amount: Cents): void {
    this.held[from] -= amount;
    this.#change(to, -amount);
    this.#done.set(id, { from, to, amount });
  }

  undo(id: string): void {
    const done = this.#done.get(id);
    if (done === undefined) throw new Error(`the bank never did ${id}`);
    if ('account' in done) this.#change(done.account, -done.amount);
    else {
      this.held[done.from] += done.amount;
      this.#change(done.to, done.amount);
    }
  }

  // Money spent on an account: checking and savings go down, a card owes more.
  #change(account: Account, amount: Cents): void {
    if (account === 'checking' || account === 'savings') this.held[account] -= amount;
    else this.held[account] += amount;
  }

  balances() {
    return { checking: this.held.checking, savings: this.held.savings, everydayCard: this.held['everyday-card'], secondCard: this.held['second-card'] };
  }

  side(): Cents {
    return this.held.checking + this.held.savings - this.held['everyday-card'] - this.held['second-card'];
  }
}

function appSide(book: Book): Cents {
  const p = book.pots();
  return p.savings + p.needs + p.wants + (p.wishlist ?? 0) + p.heldForOthers + p.unsortedIn - p.unsortedOut;
}

function day(n: number): IsoDate {
  const d = new Date(Date.UTC(2026, 9, 2) + n * 86_400_000);
  return d.toISOString().slice(0, 10) as IsoDate;
}

function newBook(split: { savings: number; needs: number; wants: number; wishlist: number }): { book: Book; bank: Bank } {
  const bank = new Bank();
  const settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL }, split, askBeforeSplittingPaycheck: false, leftoverAtPayday: { needs: 'roll-over', wants: 'move-to-savings' } });
  // The starting money (14.2), all assigned.
  const pots = { savings: 120_000, needs: 60_000, wants: 30_000, momReserve: 0, heldForOthers: 0, wishlist: bank.side() - 210_000 };
  return { book: openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots, settings, switches: HER_SWITCHES }), bank };
}

function moveNow(book: Book, bank: Bank, today: IsoDate) {
  return wishlistMove(book, { savingsAccountBalance: bank.held.savings, statements: {}, today });
}

// Lives one random life, checking everything after every step. Returns how
// many steps did something.
function live(split: { savings: number; needs: number; wants: number; wishlist: number }, steps: readonly Step[]): number {
  const { book, bank } = newBook(split);
  const purchases: { id: string; amount: Cents; refunded: Cents; gone: boolean }[] = [];
  let did = 0;
  let n = 0;
  for (const [i, step] of steps.entries()) {
    const today = day(Math.floor(i / 3));
    const id = `s${i}`;
    const before = book.pots();
    const sideBefore = appSide(book);
    const bankBefore = bank.side();
    const xBefore = moveNow(book, bank, today);
    switch (step.kind) {
      case 'paycheck': {
        bank.spend(id, 'checking', -step.amount);
        const outcome = book.receive(paycheck(id, addDaysTo(LAST_PAYCHECK, 14 * (++n)), step.amount)).outcome;
        if (outcome === 'paycheck') {
          const made = book.paychecks().at(-1);
          const parts = made?.split;
          if (parts === undefined) throw new Error('no paycheck made');
          expect(parts.savings + parts.needs + parts.wants + (parts.wishlist ?? 0)).toBe(step.amount);
          // Wishlist is never asked about and always rolls over (3.4).
          expect(book.pots().wishlist).toBe((before.wishlist ?? 0) + (parts.wishlist ?? 0));
        } else {
          book.sort(id, { to: 'other-income' }, today);
        }
        break;
      }
      case 'purchase': {
        bank.spend(id, step.account, step.amount);
        book.receive(purchase(id, today, step.amount, 'MADE UP STORE', { account: step.account }));
        let choice: SortChoice | null = step.sort === 'unsorted' ? null : step.sort === 'split' ? null : { to: step.sort };
        if (step.sort === 'split' && step.amount >= 3) {
          const a = Math.floor(step.amount / 3);
          choice = { split: [{ bucket: 'needs', amount: a }, { bucket: 'wants', amount: a }, { bucket: 'wishlist', amount: step.amount - 2 * a }] };
        }
        if (choice !== null) book.sort(id, choice, today);
        purchases.push({ id, amount: step.amount, refunded: 0, gone: false });
        break;
      }
      case 'refund': {
        const live = purchases.filter((p) => !p.gone && p.refunded < p.amount);
        const target = live[step.pick % Math.max(live.length, 1)];
        if (target === undefined) continue;
        const amount = Math.max(1, Math.floor(((target.amount - target.refunded) * step.part) / 100));
        const account = accountOf(book, target.id);
        bank.spend(id, account, -amount);
        book.receive(refund(id, today, amount, target.id, account));
        target.refunded += amount;
        // 50.4: a refund never raises $X, and a Wishlist refund lowers it.
        const xAfter = moveNow(book, bank, today);
        if (xBefore === null || xAfter === null) throw new Error('the bank was read');
        expect(xAfter.amount).toBeLessThanOrEqual(xBefore.amount);
        break;
      }
      case 'take-back': {
        const live = purchases.filter((p) => !p.gone && p.refunded === 0);
        const target = live[step.pick % Math.max(live.length, 1)];
        if (target === undefined) continue;
        bank.undo(target.id);
        book.receive(takenBack(id, target.id, today));
        target.gone = true;
        break;
      }
      case 'resort': {
        const sorted = purchases.filter((p) => !p.gone && p.refunded === 0 && book.resortDetail(p.id)?.resortable === true);
        const target = sorted[step.pick % Math.max(sorted.length, 1)];
        if (target === undefined) continue;
        book.sort(target.id, { to: step.to }, today);
        break;
      }
      case 'transfer': {
        if (step.from === step.to) continue;
        bank.move(id, step.from, step.to, step.amount);
        book.receive(transfer(id, today, step.amount, step.from, step.to));
        // 5.1, 5.3: no bucket changes, Wishlist least of all.
        expect(book.pots()).toEqual(before);
        break;
      }
      case 'move': {
        if (step.from === step.to) continue;
        expect(book.moveMoney({ from: step.from, to: step.to, amount: step.amount, confirmed: true }, today)).toEqual({ moved: true });
        break;
      }
      case 'other-income': {
        bank.spend(id, 'checking', -step.amount);
        book.receive(deposit(id, today, step.amount, 'MADE UP SIDE JOB'));
        book.sort(id, { to: 'other-income' }, today);
        break;
      }
      case 'split':
        book.changeSettings({ split: step.split }, today);
        break;
      case 'move-x': {
        // 50.4: she moves exactly $X from savings to checking.
        if (xBefore === null || xBefore.amount === 0) continue;
        bank.move(id, 'savings', 'checking', xBefore.amount);
        book.receive(transfer(id, today, xBefore.amount, 'savings', 'checking'));
        expect(moveNow(book, bank, today)?.amount).toBe(0);
        break;
      }
    }
    did++;
    // No cent made or lost: the books recount to what they hold, and the app
    // side moved exactly as the bank did.
    expect(book.recountPots()).toEqual(book.pots());
    expect(appSide(book)).toBe(book.appSide());
    expect(appSide(book) - sideBefore).toBe(bank.side() - bankBefore);
    // 12.3: the self-check holds (every transfer here is whole, so nothing is in transit).
    expect(book.selfCheck(bank.balances())).toMatchObject({ ok: true, difference: 0 });
    // 50.4: never above either amount, never below zero.
    const x = moveNow(book, bank, today);
    if (x === null) throw new Error('the bank was read');
    const extra = book.savingsTransfer(bank.held.savings).extraInSavings ?? 0;
    expect(x.amount).toBe(Math.min(x.extra, x.notMoved));
    expect(x.extra).toBe(extra);
    expect(x.amount).toBeGreaterThanOrEqual(0);
    expect(x.notMoved).toBeGreaterThanOrEqual(0);
    expect(x.when === null).toBe(x.amount === 0);
  }
  return did;
}

function addDaysTo(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) as IsoDate;
}

function accountOf(book: Book, id: string): 'checking' | 'everyday-card' | 'second-card' {
  for (const card of ['everyday-card', 'second-card'] as const) if (book.cardEntries(card).some((e) => e.id === id)) return card;
  return 'checking';
}

describe('PR 9 random lives with Wishlist', () => {
  it('12.3 random lives: no cent made or lost, own-account transfers never change Wishlist, the self-check holds, and 50.4 stays within its two amounts', () => {
    let steps = 0;
    fc.assert(
      fc.property(splitArb, fc.array(stepArb, { minLength: 20, maxLength: 60 }), (split, life) => {
        steps += live(split, life);
      }),
      { numRuns: RUNS },
    );
    expect(steps).toBeGreaterThan(RUNS * 10);
  });

  it('3.3 random lives at Wishlist 0% hold the same cents in every other bucket as the same life with its share put on savings', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 600_000 }), { minLength: 1, maxLength: 20 }), (amounts) => {
        const zero = newBook({ savings: 50, needs: 30, wants: 20, wishlist: 0 }).book;
        for (const [i, amount] of amounts.entries()) {
          zero.receive(paycheck(`p${i}`, addDaysTo(LAST_PAYCHECK, 14 * (i + 1)), amount));
          const parts = zero.paychecks().at(-1)?.split;
          const three = splitPaycheck(amount, 0, { split: { savings: 50, needs: 30, wants: 20 }, momReservePerPaycheck: 0, momReserveCap: 0 });
          expect(parts).toMatchObject({ savings: three.savings, needs: three.needs, wants: three.wants, wishlist: 0 });
        }
      }),
      { numRuns: 200 },
    );
  });
});

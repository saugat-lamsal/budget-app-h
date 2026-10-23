// Her rulebook, "Off in this setup": the mom reserve and the old card are
// switched off on her setup day. These rules keep their own tests on
// upstream's switches; these tests are about the switches.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HER_SETTINGS,
  HER_SWITCHES,
  UPSTREAM_SWITCHES,
  addDays,
  changeSettings,
  checkSwitches,
  openBook,
  startTracking,
  type Book,
  type IsoDate,
  type OpenBookInput,
  type ReviewDetail,
  type ReviewOptions,
  type Settings,
  type SortChoice,
  type Switches,
} from '../src/index.js';
import { PAYROLL, START_DATE, LAST_PAYCHECK, ZERO_POTS, cardCharge, codeOf, deposit, payPerson, paycheck, posted, purchase, refund, sent, arrived, transfer } from './helpers.js';

const HER: Settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL } });
const POTS = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 };

function herBook(input: Partial<OpenBookInput> = {}): Book {
  return openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: HER, switches: HER_SWITCHES, ...input });
}

// Everything a refused answer must leave as it was.
function state(book: Book): string {
  return JSON.stringify({ pots: book.pots(), review: book.reviewDetails(), log: book.changeLog(), settings: book.settings(), rules: book.rules(), debt: book.oldCardDebt(), purchases: book.purchases() });
}

function refusedOff(book: Book, run: () => unknown): void {
  const before = state(book);
  expect(codeOf(run)).toBe('off-in-this-setup');
  expect(state(book)).toBe(before);
}

function sortOptions(detail: ReviewDetail | undefined): Extract<ReviewOptions, { type: 'sort' }> {
  if (detail?.options.type !== 'sort') throw new Error('expected an item to sort');
  return detail.options;
}

describe('Off in this setup: her setup day starts with both switched off', () => {
  it('Off in this setup: her switches are both off, and upstream keeps both on', () => {
    // PR 5: her second card is on (her rulebook, section 1).
    expect(HER_SWITCHES).toEqual({ momReserve: 'off', oldCard: 'off', secondCard: 'on' });
    expect(UPSTREAM_SWITCHES).toEqual({ momReserve: 'on', oldCard: 'on', secondCard: 'off' });
    expect(Object.isFrozen(HER_SWITCHES)).toBe(true);
  });

  it('Off in this setup: her starting settings have nothing for mom or the old card; the rest are upstream\'s', () => {
    expect(HER_SETTINGS).toEqual({
      ...DEFAULT_SETTINGS,
      momReservePerPaycheck: 0,
      momReserveCap: 0,
      momMonthlyTarget: { low: 0, high: 0 },
      momRule: null,
      oldCardPromoEndDate: null,
      oldCardClosingDay: null,
      // PR 4: her paychecks wait for her yes (3.1).
      askBeforeSplittingPaycheck: true,
      // PR 5: her second card's closing day, not set yet (9.8).
      secondCardClosingDay: null,
    });
    // Upstream's defaults stay upstream's.
    expect(DEFAULT_SETTINGS.momReservePerPaycheck).toBe(150_000);
    expect(DEFAULT_SETTINGS.momReserveCap).toBe(300_000);
  });

  it('Off in this setup: a book opened with no switches (upstream, or history saved before them) has both on', () => {
    const book = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: ZERO_POTS, settings: DEFAULT_SETTINGS });
    expect(book.switches()).toEqual(UPSTREAM_SWITCHES);
    expect(herBook().switches()).toEqual(HER_SWITCHES);
  });

  it('Off in this setup: a switch is on or off, nothing else', () => {
    expect(codeOf(() => checkSwitches({ momReserve: 'zero', oldCard: 'off' } as unknown as Switches))).toBe('bad-switch');
    expect(codeOf(() => herBook({ switches: { momReserve: 'off' } as unknown as Switches }))).toBe('bad-switch');
  });

  it('Off in this setup: off is not zero: nothing can be assigned to the mom reserve, not even a cent', () => {
    expect(codeOf(() => herBook({ pots: { ...POTS, momReserve: 1 } }))).toBe('off-in-this-setup');
    expect(codeOf(() => herBook({ pots: { ...POTS, momReserve: -1 } }))).toBe('off-in-this-setup');
  });

  it('Off in this setup: the mom settings must be empty: a reserve, a cap, a target or a mom rule is refused', () => {
    for (const patch of [{ momReservePerPaycheck: 1 }, { momReserveCap: 300_000 }, { momMonthlyTarget: { low: 0, high: 1 } }, { momRule: { contains: 'MADE UP MOM' } }] as Partial<Settings>[]) {
      expect(codeOf(() => herBook({ settings: changeSettings(HER, patch) }))).toBe('off-in-this-setup');
    }
  });

  it('Off in this setup: the old card owes nothing and has no promo end date or closing day', () => {
    expect(codeOf(() => herBook({ oldCardDebt: 1 }))).toBe('off-in-this-setup');
    expect(codeOf(() => herBook({ settings: changeSettings(HER, { oldCardPromoEndDate: '2027-06-01' }) }))).toBe('off-in-this-setup');
    expect(codeOf(() => herBook({ settings: changeSettings(HER, { oldCardClosingDay: 1 }) }))).toBe('off-in-this-setup');
  });

  it('Off in this setup: nothing pending on the old card, and nothing on its way to it, on setup day', () => {
    expect(codeOf(() => herBook({ countedAtSetup: [purchase('p1', START_DATE, 500, 'MADE UP CAFE', { account: 'old-card', pending: true })] }))).toBe('off-in-this-setup');
    expect(codeOf(() => herBook({ inTransitAtSetup: [sent('s1', START_DATE, 500, 'checking', 'old-card')] }))).toBe('off-in-this-setup');
  });

  it('Off in this setup: setup day refuses an old card balance, and starts her book with both off', () => {
    const input = {
      date: START_DATE,
      bankBalances: { checking: 80_000, savings: 100_000, everydayCard: 0 },
      pendingCharges: [],
      oldCardBalance: 0,
      assignment: POTS,
      lastPaycheckDate: LAST_PAYCHECK,
      settings: HER,
      switches: HER_SWITCHES,
    };
    const result = startTracking(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.book.switches()).toEqual(HER_SWITCHES);
    expect(codeOf(() => startTracking({ ...input, oldCardBalance: 1 }))).toBe('off-in-this-setup');
    expect(codeOf(() => startTracking({ ...input, assignment: { ...POTS, savings: 99_999, momReserve: 1 } }))).toBe('off-in-this-setup');
  });

  it('Off in this setup: the switches cannot be changed afterwards: they are not settings', () => {
    const book = herBook();
    expect(codeOf(() => book.changeSettings({ switches: UPSTREAM_SWITCHES } as unknown as Partial<Settings>, '2026-10-02'))).toBe('bad-setting');
    expect(book.switches()).toEqual(HER_SWITCHES);
  });
});

describe('Off in this setup: 3.2, 8.1 to 8.4 no mom reserve', () => {
  it('3.2 off: a paycheck takes no reserve; the parts are 3.3\'s, for every size of paycheck', () => {
    for (const amount of [1, 2, 149_999, 150_000, 150_001, 300_000, 400_000, 1_000_000_000_000]) {
      const book = herBook();
      // PR 4: her paycheck waits for her yes (3.1).
      expect(book.receive(paycheck('p', '2026-10-09', amount)).outcome).toBe('review');
      book.sort('p', { to: 'paycheck' }, '2026-10-09');
      const split = book.paychecks()[0]?.split;
      expect(split?.momReserve).toBe(0);
      expect(split?.detail.reserveTaken).toBe(0);
      expect(split?.detail.overflowToSavings).toBe(0);
      expect(split?.detail.rest).toBe(amount);
      expect((split?.savings ?? 0) + (split?.needs ?? 0) + (split?.wants ?? 0)).toBe(amount);
      expect(book.pots().momReserve).toBe(0);
    }
  });

  it('7.6 off: a payment to a person is never offered "for mom", in review or sorting it again', () => {
    const book = herBook();
    book.receive(payPerson('z1', '2026-10-02', 2_500, 'MADE UP AUNT'));
    const options = sortOptions(book.reviewDetails()[0]);
    expect(options.picks.map((p) => p.to)).toEqual(['needs', 'wants', 'not-mine']);
    expect(options.always).toEqual(['needs', 'wants', 'not-mine']);
    book.sort('z1', { to: 'wants' }, '2026-10-02');
    const again = book.resortDetail('z1');
    expect(again?.resortable).toBe(true);
    if (again?.resortable === true) expect(again.options.picks.map((p) => p.to)).not.toContain('mom');
  });

  it('7.6 off: an answer "for mom" is refused, and nothing changes; in review and sorting again', () => {
    const book = herBook();
    book.receive(payPerson('z1', '2026-10-02', 2_500, 'MADE UP AUNT'));
    refusedOff(book, () => book.sort('z1', { to: 'mom' }, '2026-10-02'));
    refusedOff(book, () => book.sortAlways('z1', { to: 'mom' }, { id: 'aunt', contains: 'AUNT' }, '2026-10-02'));
    book.sort('z1', { to: 'needs' }, '2026-10-02');
    refusedOff(book, () => book.sort('z1', { to: 'mom' }, '2026-10-03'));
  });

  it('6.1 off: money in is never offered as payback into the mom reserve, and that answer is refused', () => {
    const book = herBook();
    book.receive(deposit('d1', '2026-10-02', 4_000, 'ZELLE FROM MADE UP FRIEND'));
    const options = sortOptions(book.reviewDetails()[0]);
    expect(options.picks.map((p) => p.to)).not.toContain('momReserve');
    expect(options.always).not.toContain('momReserve');
    refusedOff(book, () => book.sort('d1', { to: 'momReserve' }, '2026-10-02'));
  });

  it('8.1 off: there is no mom rule to set, and a rule for a person cannot say "for mom"', () => {
    const book = herBook();
    refusedOff(book, () => book.changeSettings({ momRule: { contains: 'MADE UP MOM' } }, '2026-10-02'));
    refusedOff(book, () => book.previewSettingsChange({ momRule: { contains: 'MADE UP MOM' } }, '2026-10-02'));
    // Clearing it is refused too: there is nothing to clear.
    refusedOff(book, () => book.changeSettings({ momRule: null }, '2026-10-02'));
    refusedOff(book, () => book.addRule({ id: 'm', for: 'person', contains: 'MADE UP MOM', choice: { to: 'mom' } }, '2026-10-02'));
    refusedOff(book, () => book.addRule({ id: 'r', for: 'deposit', contains: 'REFUND', choice: { to: 'momReserve' } }, '2026-10-02'));
    book.addRule({ id: 'aunt', for: 'person', contains: 'AUNT', choice: { to: 'wants' } }, '2026-10-02');
    refusedOff(book, () => book.changeRule({ id: 'aunt', for: 'person', contains: 'AUNT', choice: { to: 'mom' } }, '2026-10-03'));
  });

  it('8.1 off: opening with a rule for a person "for mom" is refused', () => {
    expect(codeOf(() => herBook({ rules: [{ id: 'm', for: 'person', contains: 'MADE UP MOM', choice: { to: 'mom' } }] }))).toBe('off-in-this-setup');
  });

  it('13.1 off: the reserve, its cap and the monthly target cannot be changed', () => {
    const book = herBook();
    for (const patch of [{ momReservePerPaycheck: 0 }, { momReservePerPaycheck: 150_000 }, { momReserveCap: 1 }, { momMonthlyTarget: { low: 0, high: 0 } }] as Partial<Settings>[]) {
      refusedOff(book, () => book.changeSettings(patch, '2026-10-02'));
    }
    // A change to the split alone is fine.
    book.changeSettings({ split: { savings: 40, needs: 40, wants: 20 } }, '2026-10-02');
    expect(book.settings().split).toEqual({ savings: 40, needs: 40, wants: 20 });
  });

  it('13.3 and 13.4 off: no money can be moved in or out of the mom reserve by hand', () => {
    const book = herBook();
    refusedOff(book, () => book.moveMoney({ from: 'savings', to: 'momReserve', amount: 1, confirmed: true }, '2026-10-02'));
    refusedOff(book, () => book.moveMoney({ from: 'momReserve', to: 'needs', amount: 1, confirmed: true }, '2026-10-02'));
    expect(book.moveMoney({ from: 'savings', to: 'needs', amount: 1, confirmed: true }, '2026-10-02')).toEqual({ moved: true });
  });

  it('3.8 off: what should be in savings is the savings bucket alone', () => {
    expect(herBook().savingsTransfer(90_000)).toEqual({ shouldBeInSavings: 100_000, savingsAccountBalance: 90_000, stillToMove: 10_000 });
  });

  it('12.2 her setup: the app side is savings + needs + wants + held for others + unsorted money in - unsorted spending', () => {
    const book = herBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: -2_000 } });
    book.receive(deposit('d1', '2026-10-02', 4_000, 'MADE UP DEPOSIT'));
    book.receive(purchase('p1', '2026-10-02', 1_500, 'MADE UP SHOP'));
    expect(book.appSide()).toBe(100_000 + 50_000 + 30_000 - 2_000 + 4_000 - 1_500);
    expect(book.selfCheck({ checking: 82_000, savings: 100_000, everydayCard: 1_500 }).ok).toBe(true);
  });
});

describe('Off in this setup: 5.2, 5.4, 5.5, 9.2, 9.5, 12.4 no old card', () => {
  it('5.4 and 5.5 off: a purchase, a pending charge, a refund, a fee or interest on the old card is refused, and nothing changes', () => {
    const book = herBook();
    refusedOff(book, () => book.receive(purchase('o1', '2026-10-02', 500, 'MADE UP CAFE', { account: 'old-card' })));
    refusedOff(book, () => book.receive(purchase('o2', '2026-10-02', 500, 'MADE UP CAFE', { account: 'old-card', pending: true })));
    refusedOff(book, () => book.receive(refund('o3', '2026-10-02', 500, undefined, 'old-card')));
    refusedOff(book, () => book.receive(cardCharge('o4', '2026-10-02', 500, 'fee', 'old-card')));
    refusedOff(book, () => book.receive(cardCharge('o5', '2026-10-02', 500, 'interest', 'old-card')));
  });

  it('5.2 off: a payment to the old card is refused, whole or either half, from checking or savings', () => {
    const book = herBook();
    refusedOff(book, () => book.receive(transfer('t1', '2026-10-02', 5_000, 'checking', 'old-card')));
    refusedOff(book, () => book.receive(transfer('t2', '2026-10-02', 5_000, 'savings', 'old-card')));
    refusedOff(book, () => book.receive(sent('t3', '2026-10-02', 5_000, 'checking', 'old-card')));
    refusedOff(book, () => book.receive(arrived('t4', '2026-10-02', 5_000, 'checking', 'old-card')));
    // A payment to the everyday card is as always (5.1).
    expect(book.receive(transfer('t5', '2026-10-02', 5_000, 'checking', 'everyday-card')).outcome).toBe('sorted');
  });

  it('5.6 off: a purchase is never offered as a transfer to the old card, and that answer is refused', () => {
    const book = herBook();
    book.receive(purchase('p1', '2026-10-02', 5_000, 'MADE UP BILL PAY', { account: 'checking' }));
    const options = sortOptions(book.reviewDetails()[0]);
    // PR 5: her second card is a transfer too, as the everyday card is (5.6).
    expect(options.transfer).toEqual(['savings', 'everyday-card', 'second-card']);
    expect(Object.keys(options.transferOutcome).sort()).toEqual(['everyday-card', 'savings', 'second-card']);
    refusedOff(book, () => book.sort('p1', { transfer: 'old-card' }, '2026-10-02'));
    book.sort('p1', { to: 'needs' }, '2026-10-02');
    const again = book.resortDetail('p1');
    if (again?.resortable === true) expect(again.options.transfer).not.toContain('old-card');
    refusedOff(book, () => book.sort('p1', { transfer: 'old-card' }, '2026-10-03'));
  });

  it('9.5 off: there is no promo end date to set, so no payoff countdown', () => {
    const book = herBook();
    refusedOff(book, () => book.changeSettings({ oldCardPromoEndDate: '2027-06-01' }, '2026-10-02'));
    refusedOff(book, () => book.changeSettings({ oldCardPromoEndDate: null }, '2026-10-02'));
  });

  it('9.2 and 9.8 off: there is no closing day to set for the old card; the everyday card\'s can be set', () => {
    const book = herBook();
    refusedOff(book, () => book.changeSettings({ oldCardClosingDay: 12 }, '2026-10-02'));
    book.changeSettings({ everydayCardClosingDay: 12 }, '2026-10-02');
    expect(book.settings().everydayCardClosingDay).toBe(12);
  });

  it('12.4 off: the old card owes nothing, ever', () => {
    const book = herBook();
    book.receive(purchase('p1', '2026-10-02', 5_000));
    expect(book.oldCardDebt()).toBe(0);
    expect(book.recountOldCardDebt()).toBe(0);
  });
});

// ---- Off is not zero: the twin test -------------------------------------
//
// A book with the mom reserve off, and a book with it on at $0.00 a paycheck
// and a $0.00 cap, live the same random life. Every bucket holds the same
// cents after every step. Only what is offered differs: "for mom" and payback
// into the reserve are never offered with it off (and the old card, which is
// off too, is never offered as a transfer), and an answer about them is
// refused with nothing changed.

type Step =
  | { type: 'paycheck'; gap: number; amount: number }
  | { type: 'deposit'; gap: number; amount: number; account: 'checking' | 'savings' }
  | { type: 'purchase'; gap: number; amount: number; account: 'checking' | 'everyday-card'; pending: boolean; description: string }
  | { type: 'post'; pick: number; change: number }
  | { type: 'refund'; pick: number; amount: number }
  | { type: 'pay-person'; amount: number; payee: string; account: 'checking' | 'savings' }
  | { type: 'card-payment'; amount: number; from: 'checking' | 'savings' }
  | { type: 'own-transfer'; amount: number; from: 'checking' | 'savings' }
  | { type: 'sort'; pick: number; seed: number }
  | { type: 'resort'; pick: number; seed: number }
  | { type: 'move'; from: 'savings' | 'needs' | 'wants' | 'heldForOthers'; to: 'savings' | 'needs' | 'wants' | 'heldForOthers'; amount: number }
  | { type: 'change-split'; savings: number; needs: number }
  | { type: 'try-off'; which: number; pick: number };

const amountArb = fc.oneof(fc.integer({ min: 1, max: 60_000 }), fc.constantFrom(1, 2, 3, 100));
const potArb = fc.constantFrom('savings' as const, 'needs' as const, 'wants' as const, 'heldForOthers' as const);
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ type: fc.constant('paycheck' as const), gap: fc.integer({ min: 0, max: 16 }), amount: fc.oneof(fc.integer({ min: 1, max: 500_000 }), fc.constantFrom(1, 150_000, 150_001)) }),
  fc.record({ type: fc.constant('deposit' as const), gap: fc.integer({ min: 0, max: 5 }), amount: amountArb, account: fc.constantFrom('checking' as const, 'savings' as const) }),
  fc.record({
    type: fc.constant('purchase' as const),
    gap: fc.integer({ min: 0, max: 3 }),
    amount: amountArb,
    account: fc.constantFrom('checking' as const, 'everyday-card' as const),
    pending: fc.boolean(),
    description: fc.constantFrom('MADE UP GROCER', 'MADE UP CAFE', 'MADE UP SHOP'),
  }),
  fc.record({ type: fc.constant('post' as const), pick: fc.nat(), change: fc.integer({ min: -500, max: 500 }) }),
  fc.record({ type: fc.constant('refund' as const), pick: fc.nat(), amount: amountArb }),
  fc.record({ type: fc.constant('pay-person' as const), amount: amountArb, payee: fc.constantFrom('MADE UP AUNT', 'MADE UP FRIEND', 'MADE UP LANDLORD'), account: fc.constantFrom('checking' as const, 'savings' as const) }),
  fc.record({ type: fc.constant('card-payment' as const), amount: amountArb, from: fc.constantFrom('checking' as const, 'savings' as const) }),
  fc.record({ type: fc.constant('own-transfer' as const), amount: amountArb, from: fc.constantFrom('checking' as const, 'savings' as const) }),
  fc.record({ type: fc.constant('sort' as const), pick: fc.nat(), seed: fc.nat() }),
  fc.record({ type: fc.constant('sort' as const), pick: fc.nat(), seed: fc.nat() }),
  fc.record({ type: fc.constant('resort' as const), pick: fc.nat(), seed: fc.nat() }),
  fc.record({ type: fc.constant('move' as const), from: potArb, to: potArb, amount: amountArb }),
  fc.record({ type: fc.constant('change-split' as const), savings: fc.integer({ min: 0, max: 100 }), needs: fc.integer({ min: 0, max: 100 }) }),
  fc.record({ type: fc.constant('try-off' as const), which: fc.nat(), pick: fc.nat() }),
);

// Every choice an item's options allow, in a fixed order.
function choicesOf(options: Extract<ReviewOptions, { type: 'sort' }>, amount: number): SortChoice[] {
  const choices: SortChoice[] = options.picks.map((p) => ({ to: p.to }) as SortChoice);
  for (const account of options.transfer) choices.push({ transfer: account });
  if (options.split !== null && amount >= 2) {
    const [first, second] = options.split;
    if (first !== undefined && second !== undefined) choices.push({ split: [{ bucket: first, amount: 1 }, { bucket: second, amount: amount - 1 }] });
  }
  return choices;
}

// The options with it off: the ones with it on, less mom, the reserve and the old card.
function lessWhatIsOff(options: Extract<ReviewOptions, { type: 'sort' }>): unknown {
  const keep = (to: string): boolean => to !== 'mom' && to !== 'momReserve';
  return {
    ...options,
    picks: options.picks.filter((p) => keep(p.to)),
    always: options.always.filter(keep),
    transfer: options.transfer.filter((a) => a !== 'old-card'),
    transferOutcome: Object.fromEntries(Object.entries(options.transferOutcome).filter(([a]) => a !== 'old-card')),
  };
}

function sameOffers(off: ReviewDetail[], on: ReviewDetail[]): void {
  expect(off.length).toBe(on.length);
  off.forEach((detail, i) => {
    const twin = on[i] as ReviewDetail;
    expect({ ...detail, options: null }).toEqual({ ...twin, options: null });
    if (twin.options.type === 'sort') {
      expect(detail.options).toEqual(lessWhatIsOff(twin.options));
      if (detail.options.type === 'sort') {
        expect(detail.options.picks.map((p) => p.to)).not.toContain('mom');
        expect(detail.options.picks.map((p) => p.to)).not.toContain('momReserve');
        expect(detail.options.transfer).not.toContain('old-card');
      }
    } else expect(detail.options).toEqual(twin.options);
  });
}

function liveTwins(steps: Step[]): void {
  // Her settings but with mom on at $0.00: upstream's, with no reserve, and
  // (PR 4) asking before splitting a paycheck, as hers does.
  const twinSettings = changeSettings(DEFAULT_SETTINGS, { paycheckRule: { contains: PAYROLL }, momReservePerPaycheck: 0, momReserveCap: 0, askBeforeSplittingPaycheck: true });
  // (PR 5) And with her second card on, as hers has: only mom differs.
  const on = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: twinSettings, switches: { ...UPSTREAM_SWITCHES, secondCard: 'on' } });
  const off = herBook();
  const both = (run: (book: Book) => void): void => {
    run(on);
    run(off);
  };
  let date: IsoDate = START_DATE;
  let n = 0;
  const purchases: { id: string; account: 'checking' | 'everyday-card'; amount: number; pending: boolean; description: string; date: IsoDate }[] = [];
  for (const step of steps) {
    switch (step.type) {
      case 'paycheck':
      case 'deposit': {
        date = addDays(date, step.gap);
        const txn = step.type === 'paycheck' ? paycheck(`t${n++}`, date, step.amount) : deposit(`t${n++}`, date, step.amount, 'MADE UP DEPOSIT', step.account);
        both((b) => b.receive(txn));
        break;
      }
      case 'purchase': {
        date = addDays(date, step.gap);
        const id = `t${n++}`;
        both((b) => b.receive(purchase(id, date, step.amount, step.description, { account: step.account, pending: step.pending })));
        purchases.push({ id, account: step.account, amount: step.amount, pending: step.pending, description: step.description, date });
        break;
      }
      case 'post': {
        const target = purchases.filter((p) => p.pending)[step.pick % Math.max(1, purchases.filter((p) => p.pending).length)];
        if (target === undefined) break;
        target.pending = false;
        const amount = Math.max(1, target.amount + step.change);
        const id = `t${n++}`;
        both((b) => b.receive(posted(id, target.id, date, amount, target.description, target.account)));
        target.id = id;
        target.amount = amount;
        break;
      }
      case 'refund': {
        const target = purchases.filter((p) => !p.pending)[step.pick % Math.max(1, purchases.filter((p) => !p.pending).length)];
        if (target === undefined) break;
        const txn = refund(`t${n++}`, date, step.amount, target.id, target.account === 'checking' ? 'checking' : 'everyday-card');
        both((b) => {
          try {
            b.receive(txn);
          } catch {
            // More than is left to refund: refused by both, as the next check shows.
          }
        });
        break;
      }
      case 'pay-person': {
        const txn = payPerson(`t${n++}`, date, step.amount, step.payee, step.account);
        both((b) => b.receive(txn));
        break;
      }
      case 'card-payment': {
        const txn = transfer(`t${n++}`, date, step.amount, step.from, 'everyday-card');
        both((b) => b.receive(txn));
        break;
      }
      case 'own-transfer': {
        const txn = transfer(`t${n++}`, date, step.amount, step.from, step.from === 'checking' ? 'savings' : 'checking');
        both((b) => b.receive(txn));
        break;
      }
      case 'sort': {
        const details = off.reviewDetails();
        const detail = details[step.pick % Math.max(1, details.length)];
        if (detail === undefined) break;
        if (detail.options.type === 'leftover') {
          const answer = step.seed % 2 === 0 ? 'roll-over' : 'move-to-savings';
          both((b) => b.answerLeftover(detail.item.id, answer, date));
          break;
        }
        if (detail.options.type !== 'sort') break;
        const amount = 'amount' in detail.item ? detail.item.amount : 0;
        const choices = choicesOf(detail.options, amount);
        const choice = choices[step.seed % Math.max(1, choices.length)];
        if (choice === undefined) break;
        both((b) => b.sort(detail.item.id, choice, date));
        break;
      }
      case 'resort': {
        const ids = off.purchases().map((p) => p.id);
        const id = ids[step.pick % Math.max(1, ids.length)];
        if (id === undefined) break;
        const detail = off.resortDetail(id);
        const twin = on.resortDetail(id);
        if (detail === null || detail.resortable !== true || twin === null || twin.resortable !== true) {
          expect(detail?.resortable ?? null).toEqual(twin?.resortable ?? null);
          break;
        }
        expect(detail.options).toEqual(lessWhatIsOff(twin.options));
        const choices = choicesOf(detail.options, detail.amount);
        const choice = choices[step.seed % Math.max(1, choices.length)];
        if (choice === undefined) break;
        both((b) => b.sort(id, choice, date));
        break;
      }
      case 'move':
        if (step.from === step.to) break;
        both((b) => b.moveMoney({ from: step.from, to: step.to, amount: step.amount, confirmed: true }, date));
        break;
      case 'change-split': {
        const split = { savings: Math.min(step.savings, 100), needs: Math.min(step.needs, 100 - Math.min(step.savings, 100)), wants: 0 };
        split.wants = 100 - split.savings - split.needs;
        both((b) => b.changeSettings({ split }, date));
        break;
      }
      case 'try-off': {
        // Only on the book with it off; the twin is not asked.
        const waiting = off.reviewItems().filter((i) => i.type === 'spending' || i.type === 'money-in');
        const item = waiting[step.pick % Math.max(1, waiting.length)];
        const tries: (() => unknown)[] = [
          () => off.moveMoney({ from: 'savings', to: 'momReserve', amount: 1, confirmed: true }, date),
          () => off.changeSettings({ momRule: { contains: 'MADE UP AUNT' } }, date),
          () => off.addRule({ id: `mom${n++}`, for: 'person', contains: 'MADE UP AUNT', choice: { to: 'mom' } }, date),
          () => off.receive(purchase(`t${n++}`, date, 500, 'MADE UP CAFE', { account: 'old-card' })),
          () => off.receive(transfer(`t${n++}`, date, 500, 'checking', 'old-card')),
          ...(item === undefined ? [] : [() => off.sort(item.id, { to: 'mom' }, date), () => off.sort(item.id, { to: 'momReserve' }, date), () => off.sort(item.id, { transfer: 'old-card' }, date)]),
        ];
        const attempt = tries[step.which % tries.length] as () => unknown;
        refusedOff(off, attempt);
        break;
      }
    }
    expect(off.pots()).toEqual(on.pots());
    expect(off.pots().momReserve).toBe(0);
    expect(off.recountPots()).toEqual(off.pots());
    expect(off.oldCardDebt()).toBe(0);
    expect(off.paychecks()).toEqual(on.paychecks());
    expect(off.purchases()).toEqual(on.purchases());
    sameOffers(off.reviewDetails(), on.reviewDetails());
  }
}

describe('Off in this setup: off is not zero (a twin test, 500 random lives)', () => {
  it('Off in this setup: mom off and mom at $0.00 hold the same cents every day; only the offers differ', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 1, maxLength: 60 }), (steps) => liveTwins(steps)),
      { numRuns: 500 },
    );
  });
});

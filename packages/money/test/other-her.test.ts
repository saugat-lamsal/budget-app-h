// Her rulebook, 7.7, 7.8 and 52.4 (60j, docs/her-questions.txt HA12): Other on
// her accounts, with Wishlist as a part of a split. Upstream's tests of the same
// rules are in 7-not-mine-from-accounts.test.ts and 7-split-money-in.test.ts;
// these are what her setup adds. Every number and name is made up.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, HER_SETTINGS, HER_SWITCHES, cardStanding, cardStatementView, changeSettings, openBook, wishlistMove, type BankBalances, type Book, type CardStatement, type Cents, type OpenBookInput, type ReviewOptions, type Settings, type SortChoice } from '../src/index.js';
import { LAST_PAYCHECK, PAYROLL, START_DATE, cardCharge, codeOf, deposit, posted, purchase, refund, takenBack, withdrawal } from './helpers.js';
import { runs } from './slow.js';

const DAY = '2026-10-05';
type Card = 'everyday-card' | 'second-card';
const CARDS: readonly Card[] = ['everyday-card', 'second-card'];

const HER: Settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL }, split: { savings: 40, needs: 30, wants: 20, wishlist: 10 }, askBeforeSplittingPaycheck: false });
const POTS = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0, wishlist: 20_000 };
// Checking + savings - both cards = the pots above (200,000).
const BANK: BankBalances = { checking: 130_000, savings: 100_000, everydayCard: 20_000, secondCard: 10_000 };

function herBook(input: Partial<OpenBookInput> = {}): Book {
  return openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: HER, rules: [], switches: HER_SWITCHES, ...input });
}

function options(book: Book, id: string): Extract<ReviewOptions, { type: 'sort' }> {
  const d = book.reviewDetails().find((x) => x.item.id === id);
  if (d?.options.type !== 'sort') throw new Error(`${id} has no choices`);
  return d.options;
}
const picks = (book: Book, id: string): readonly string[] => options(book, id).picks.map((p) => p.to);

describe('7.7 Other on her accounts', () => {
  it.each(CARDS)('7.7 a purchase on her %s is offered Other, with Wishlist, and Wants gets the rest', (card) => {
    const b = herBook();
    b.receive(purchase('c1', DAY, 2_000, 'MADE UP SHOP', { account: card }));
    expect(picks(b, 'c1')).toEqual(['needs', 'wants', 'wishlist', 'not-mine']);
    expect(options(b, 'c1').split).toEqual(['needs', 'not-mine', 'wishlist', 'wants']);
    b.sort('c1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 50_000, wants: 30_000, wishlist: 20_000, heldForOthers: -2_000, unsortedOut: 0 });
    expect(b.reviewItems()).toEqual([]);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it.each(CARDS)('7.7 11.3 12.2 on her %s it leaves safe to spend alone, and the check with the bank holds', (card) => {
    const b = herBook();
    const safe = b.safeToSpend(DAY).amount;
    b.receive(purchase('c1', DAY, 2_000, 'MADE UP SHOP', { account: card }));
    b.sort('c1', { to: 'not-mine' }, DAY);
    expect(b.safeToSpend(DAY).amount).toBe(safe);
    const bank = card === 'everyday-card' ? { ...BANK, everydayCard: 22_000 } : { ...BANK, secondCard: 12_000 };
    expect(b.selfCheck(bank).ok).toBe(true);
  });

  it('7.7 money leaving checking or savings has Wishlist and Other too', () => {
    const b = herBook();
    b.receive(purchase('p1', DAY, 8_640, 'MADE UP PAYMENT', { account: 'checking' }));
    b.receive(withdrawal('w1', DAY, 7_230, 'MADE UP ZELLE'));
    for (const id of ['p1', 'w1']) {
      expect(picks(b, id)).toEqual(['needs', 'wants', 'wishlist', 'not-mine']);
      expect(options(b, id).split).toEqual(['needs', 'not-mine', 'wishlist', 'wants']);
    }
  });

  it('7.7 split across needs, wants, Wishlist and Other, to the cent; a cent short or over is refused and changes nothing', () => {
    const b = herBook();
    b.receive(purchase('c1', DAY, 10_000, 'MADE UP SHOP', { account: 'second-card' }));
    const before = b.pots();
    const split = (needs: Cents, other: Cents, wishlist: Cents, wants: Cents): SortChoice => ({
      split: [
        { bucket: 'needs', amount: needs },
        { bucket: 'not-mine', amount: other },
        { bucket: 'wishlist', amount: wishlist },
        { bucket: 'wants', amount: wants },
      ],
    });
    expect(codeOf(() => b.sort('c1', split(1, 1, 1, 9_996), DAY))).toBe('split-does-not-add-up');
    expect(codeOf(() => b.sort('c1', split(1, 1, 1, 9_998), DAY))).toBe('split-does-not-add-up');
    expect(b.pots()).toEqual(before);
    b.sort('c1', split(1, 1, 1, 9_997), DAY);
    expect(b.pots()).toMatchObject({ needs: 49_999, heldForOthers: -1, wishlist: 19_999, wants: 20_003, unsortedOut: 0 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.7 one cent: Other is offered, and there is nothing to split', () => {
    const b = herBook();
    b.receive(purchase('c1', DAY, 1, 'MADE UP SHOP', { account: 'second-card' }));
    expect(picks(b, 'c1')).toContain('not-mine');
    expect(options(b, 'c1').split).toBeNull();
    b.sort('c1', { to: 'not-mine' }, DAY);
    expect(b.pots().heldForOthers).toBe(-1);
  });

  it('7.7 a very large purchase marked Other stays exact', () => {
    const b = herBook();
    const large = 2 ** 40;
    b.receive(purchase('c1', DAY, large, 'MADE UP SHOP', { account: 'second-card' }));
    b.sort('c1', { to: 'not-mine' }, DAY);
    expect(b.pots().heldForOthers).toBe(-large);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it.each(CARDS)('7.7 14.2 4.10 on her %s, not the difference on one counted on setup day, or what is left of one the bank took back', (card) => {
    const atSetup = herBook({ pots: { ...POTS, wants: 29_000 }, countedAtSetup: [purchase('s1', '2026-09-30', 1_000, 'MADE UP HOLD', { account: card, pending: true })] });
    atSetup.receive(posted('s2', 's1', DAY, 1_250, 'MADE UP GAS', card));
    expect(picks(atSetup, 's1')).toEqual(['needs', 'wants', 'wishlist']);
    expect(codeOf(() => atSetup.sort('s1', { to: 'not-mine' }, DAY))).toBe('bad-choice');

    const back = herBook();
    back.receive(purchase('p1', DAY, 10_000, 'MADE UP SHOP', { account: card }));
    back.receive(refund('r1', DAY, 4_000, 'p1', card));
    back.receive(takenBack('t1', 'p1', '2026-10-06'));
    expect(picks(back, 'p1')).toEqual(['needs', 'wants', 'wishlist']);
    expect(codeOf(() => back.sort('p1', { to: 'not-mine' }, DAY))).toBe('bad-choice');
  });

  it.each(CARDS)('7.7 4.8 a fee on her %s is not offered Other', (card) => {
    const b = herBook();
    b.receive(cardCharge('f1', DAY, 2_900, 'fee', card));
    expect(picks(b, 'f1')).toEqual(['needs', 'wants', 'wishlist']);
    expect(codeOf(() => b.sort('f1', { to: 'not-mine' }, DAY))).toBe('bad-choice');
    expect(codeOf(() => b.sort('f1', { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'not-mine', amount: 2_899 }] }, DAY))).toBe('bad-choice');
  });

  it('4.4 7.7 a purchase with no Other keeps Wishlist as a part, and Wants still gets the rest', () => {
    const b = herBook();
    b.receive(cardCharge('f1', DAY, 2_900, 'fee', 'second-card'));
    expect(options(b, 'f1').split).toEqual(['needs', 'wishlist', 'wants']);
  });

  it('7.6 a payment to a person keeps its parts: Other, never Wishlist', () => {
    const b = herBook();
    b.receive({ kind: 'payment-to-person', id: 'z1', account: 'checking', date: DAY, amount: 5_000, description: 'ZELLE MADE UP FRIEND' });
    expect(picks(b, 'z1')).toEqual(['needs', 'wants', 'not-mine']);
    expect(options(b, 'z1').split).toEqual(['needs', 'wants', 'not-mine']);
    expect(codeOf(() => b.sort('z1', { split: [{ bucket: 'wishlist', amount: 1 }, { bucket: 'not-mine', amount: 4_999 }] }, DAY))).toBe('bad-choice');
  });

  it('7.7 50.4 only the Wishlist part of a split with Other counts as a Wishlist purchase', () => {
    const b = herBook();
    b.receive(purchase('c1', DAY, 10_000, 'MADE UP SHOP', { account: 'everyday-card' }));
    b.sort('c1', { split: [{ bucket: 'not-mine', amount: 7_000 }, { bucket: 'wishlist', amount: 3_000 }] }, DAY);
    expect(b.wishlistFlows().purchases.map((p) => [p.id, p.amount])).toEqual([['c1', 3_000]]);
  });

  it.each(CARDS)('7.7 4.5 on her %s a refund of one marked Other goes back to Other, and sorting it again changes it back', (card) => {
    const b = herBook();
    b.receive(purchase('c1', DAY, 2_000, 'MADE UP SHOP', { account: card }));
    b.sort('c1', { to: 'not-mine' }, DAY);
    b.receive(refund('r1', '2026-10-06', 500, 'c1', card));
    expect(b.pots()).toMatchObject({ heldForOthers: -1_500, needs: 50_000, wants: 30_000, wishlist: 20_000 });
    b.sort('c1', { to: 'wishlist' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ heldForOthers: 0, wishlist: 18_500 });
  });
});

describe('7.8 money in split, with Wishlist', () => {
  it('7.8 the parts are Other, savings, needs, Wishlist and wants, and Wants gets the rest', () => {
    const b = herBook();
    b.receive(deposit('d1', DAY, 14_000, 'MADE UP ATM DEPOSIT'));
    expect(options(b, 'd1').split).toEqual(['not-mine', 'savings', 'needs', 'wishlist', 'wants']);
  });

  it('7.8 across all five parts, to the cent, and the check with the bank holds', () => {
    const b = herBook();
    b.receive(deposit('d1', DAY, 10_000, 'MADE UP ATM DEPOSIT'));
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 1 }, { bucket: 'savings', amount: 2_000 }, { bucket: 'needs', amount: 3_000 }, { bucket: 'wishlist', amount: 999 }, { bucket: 'wants', amount: 4_000 }] }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 1, savings: 102_000, needs: 53_000, wishlist: 20_999, wants: 34_000, unsortedIn: 0 });
    expect(b.selfCheck({ ...BANK, checking: 140_000 }).ok).toBe(true);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.8 one cent has nothing to split; two cents do', () => {
    const b = herBook();
    b.receive(deposit('d1', DAY, 1));
    b.receive(deposit('d2', DAY, 2));
    expect(options(b, 'd1').split).toBeNull();
    expect(options(b, 'd2').split).toEqual(['not-mine', 'savings', 'needs', 'wishlist', 'wants']);
    b.sort('d2', { split: [{ bucket: 'wishlist', amount: 1 }, { bucket: 'wants', amount: 1 }] }, DAY);
    expect(b.pots()).toMatchObject({ wishlist: 20_001, wants: 30_001 });
  });

  it('7.8 50.4 a part into Wishlist counts like a payback into Wishlist, and lowers what she is told to move', () => {
    const whole = herBook();
    const split = herBook();
    for (const b of [whole, split]) {
      b.receive(purchase('c1', DAY, 5_000, 'MADE UP LAMP', { account: 'checking' }));
      b.sort('c1', { to: 'wishlist' }, DAY);
      b.receive(deposit('d1', DAY, 4_000));
    }
    whole.sort('d1', { to: 'wishlist' }, DAY);
    split.receive(deposit('d2', DAY, 1_000));
    whole.receive(deposit('d2', DAY, 1_000));
    whole.sort('d2', { to: 'wants' }, DAY);
    split.sort('d1', { split: [{ bucket: 'wishlist', amount: 3_000 }, { bucket: 'wants', amount: 1_000 }] }, DAY);
    split.sort('d2', { split: [{ bucket: 'wishlist', amount: 500 }, { bucket: 'wants', amount: 500 }] }, DAY);
    expect(split.wishlistFlows().paidBack).toBe(3_500);
    expect(whole.wishlistFlows().paidBack).toBe(4_000);
    const input = { savingsAccountBalance: 200_000, statements: {}, today: DAY };
    expect(wishlistMove(split, input)?.amount).toBe(1_500);
    expect(wishlistMove(whole, input)?.amount).toBe(1_000);
  });

  it('7.8 a Wishlist list shows its part, and sorting it again replaces the whole split', () => {
    const b = herBook();
    b.receive(deposit('d1', DAY, 10_000));
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 7_000 }, { bucket: 'wishlist', amount: 3_000 }] }, DAY);
    const row = b.activity('wishlist').rows.find((r) => r.id === 'd1');
    expect(row).toMatchObject({ what: 'payback', amount: 3_000, partOfSplit: true });
    b.sort('d1', { to: 'needs' }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 0, wishlist: 20_000, needs: 60_000 });
  });

  it('7.8 3.1 a paycheck she says is not one can be split: no pay period starts', () => {
    const b = herBook({ settings: { ...HER, askBeforeSplittingPaycheck: true } });
    b.receive(deposit('d1', DAY, 10_000, `${PAYROLL} DIRECT DEP`));
    expect(options(b, 'd1').split).toEqual(['not-mine', 'savings', 'needs', 'wishlist', 'wants']);
    const period = b.period().number;
    b.sort('d1', { split: [{ bucket: 'not-mine', amount: 4_000 }, { bucket: 'wishlist', amount: 6_000 }] }, DAY);
    expect(b.period().number).toBe(period);
    expect(b.pots()).toMatchObject({ heldForOthers: 4_000, wishlist: 26_000 });
  });

  it.each(CARDS)('7.8 a refund on her %s that waits can be split too', (card) => {
    const b = herBook();
    b.receive(refund('r1', DAY, 4_000, undefined, card));
    expect(options(b, 'r1').split).toEqual(['not-mine', 'savings', 'needs', 'wishlist', 'wants']);
    b.sort('r1', { split: [{ bucket: 'not-mine', amount: 1_000 }, { bucket: 'wishlist', amount: 3_000 }] }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 1_000, wishlist: 23_000, unsortedIn: 0 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.8 upstream\'s setup has no Wishlist part, and refuses one', () => {
    const b = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 }, settings: DEFAULT_SETTINGS });
    b.receive(deposit('d1', DAY, 10_000));
    expect(options(b, 'd1').split).toEqual(['not-mine', 'savings', 'needs', 'wants']);
    const before = b.pots();
    expect(codeOf(() => b.sort('d1', { split: [{ bucket: 'wishlist', amount: 5_000 }, { bucket: 'wants', amount: 5_000 }] }, DAY))).not.toBeNull();
    expect(b.pots()).toEqual(before);
  });
});

describe('52.4 Other on a card statement', () => {
  const BEFORE: CardStatement = { card: 'everyday-card', closingDate: '2026-09-05', dueDate: '2026-09-30', statementBalance: 0, minimumPayment: 0 };
  const statementOf = (statementBalance: Cents, card: Card = 'everyday-card'): CardStatement => ({ card, closingDate: '2026-10-05', dueDate: '2026-10-30', statementBalance, minimumPayment: 2_500 });
  const totals = (view: ReturnType<typeof cardStatementView>): Readonly<Record<string, Cents>> => Object.fromEntries(view.byBucket.map((g) => [g.bucket, g.total]));

  it.each(CARDS)('52.4 7.7 on her %s, a purchase marked Other is its own group, not still unsorted, and the lines add up', (card) => {
    const b = herBook();
    b.receive(purchase('c1', '2026-09-20', 2_000, 'MADE UP GIFT', { account: card }));
    b.sort('c1', { to: 'not-mine' }, DAY);
    b.receive(purchase('c2', '2026-09-21', 700, 'MADE UP SHOP', { account: card }));
    const view = cardStatementView({ statement: statementOf(2_700, card), before: { ...BEFORE, card }, book: b });
    expect(view.byBucket.map((g) => g.bucket)).toEqual(['other', 'unsorted']);
    expect(totals(view)).toEqual({ other: 2_000, unsorted: 700 });
    expect(view.notMatched).toBe(0);
    expect(view.byPayPeriod.flatMap((g) => g.items.map((i) => i.id)).sort()).toEqual(['c1', 'c2']);
  });

  it('52.4 7.7 a split with Other, each part under its own group, after Wishlist', () => {
    const b = herBook();
    b.receive(purchase('c1', '2026-09-20', 10_000, 'MADE UP SHOP'));
    b.sort('c1', { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'not-mine', amount: 2_000 }, { bucket: 'wishlist', amount: 3_000 }, { bucket: 'wants', amount: 4_999 }] }, DAY);
    const view = cardStatementView({ statement: statementOf(10_000), before: BEFORE, book: b });
    expect(view.byBucket.map((g) => [g.bucket, g.total])).toEqual([
      ['needs', 1],
      ['wants', 4_999],
      ['wishlist', 3_000],
      ['other', 2_000],
    ]);
    expect(view.notMatched).toBe(0);
  });

  it('52.4 7.7 4.5 a refund of a purchase marked Other is under Other, less the refund', () => {
    const b = herBook();
    b.receive(purchase('c1', '2026-09-20', 2_000, 'MADE UP GIFT'));
    b.sort('c1', { to: 'not-mine' }, DAY);
    b.receive(refund('r1', '2026-09-25', 500, 'c1'));
    const view = cardStatementView({ statement: statementOf(1_500), before: BEFORE, book: b });
    expect(totals(view)).toEqual({ other: 1_500 });
    expect(view.byBucket[0]?.items.map((i) => [i.id, i.amount])).toEqual([
      ['c1', 2_000],
      ['r1', -500],
    ]);
    expect(view.notMatched).toBe(0);
  });

  it('52.4 7.8 a refund on the card split in review: a part in a bucket is under it, and the others are credits, and the lines add up', () => {
    const b = herBook();
    b.receive(purchase('c1', '2026-09-20', 5_000, 'MADE UP SHOP'));
    b.sort('c1', { to: 'needs' }, DAY);
    b.receive(refund('r1', '2026-09-25', 4_000));
    b.sort('r1', { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wishlist', amount: 500 }, { bucket: 'not-mine', amount: 2_500 }] }, DAY);
    const view = cardStatementView({ statement: statementOf(1_000), before: BEFORE, book: b });
    expect(totals(view)).toEqual({ needs: 4_000, wishlist: -500 });
    expect(view.carriedIn).toMatchObject({ kind: 'from-statement-before', paymentsAndCredits: -2_500, amount: -2_500 });
    expect(view.notMatched).toBe(0);
  });
});

describe('9.9 cardStanding on her second card', () => {
  const STATEMENT: CardStatement = { card: 'second-card', closingDate: '2026-09-28', dueDate: '2026-10-25', statementBalance: 25_000, minimumPayment: 2_500 };
  const paid = (amount: Cents) => [{ date: '2026-10-01', amount, landedOn: '2026-10-01' }];

  it('9.9 9.1 9.3 it has a statement balance, and only the whole of it is paid', () => {
    expect(cardStanding('2026-10-02', STATEMENT, paid(24_999))).toMatchObject({ card: 'second-card', statementBalance: 25_000, paid: 24_999, standing: 'to-pay' });
    expect(cardStanding('2026-10-02', STATEMENT, paid(25_000))).toMatchObject({ standing: 'paid' });
  });

  it('9.9 9.4 the day after the due date, one cent under the minimum is overdue, and exactly the minimum is not', () => {
    expect(cardStanding('2026-10-25', STATEMENT, [])).toMatchObject({ daysLeft: 0, standing: 'to-pay' });
    expect(cardStanding('2026-10-26', STATEMENT, paid(2_499))).toMatchObject({ daysLeft: -1, standing: 'overdue' });
    expect(cardStanding('2026-10-26', STATEMENT, paid(2_500))).toMatchObject({ standing: 'minimum-paid' });
  });
});

describe('52.4 a split refund the bank took back', () => {
  it('52.4 4.10 7.8 its parts come back out on the statement it came in, and the lines still add up', () => {
    const b = herBook();
    b.receive(purchase('c1', '2026-09-20', 5_000, 'MADE UP SHOP'));
    b.sort('c1', { to: 'needs' }, DAY);
    b.receive(refund('r1', '2026-09-25', 4_000));
    b.sort('r1', { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'not-mine', amount: 3_000 }] }, DAY);
    b.receive(takenBack('t1', 'r1', '2026-09-28'));
    const view = cardStatementView({ statement: { card: 'everyday-card', closingDate: '2026-10-05', dueDate: '2026-10-30', statementBalance: 5_000, minimumPayment: 2_500 }, before: { card: 'everyday-card', closingDate: '2026-09-05', dueDate: '2026-09-30', statementBalance: 0, minimumPayment: 0 }, book: b });
    expect(view.byBucket.map((g) => [g.bucket, g.total])).toEqual([['needs', 5_000]]);
    expect(view.notMatched).toBe(0);
    expect(b.pots()).toMatchObject({ heldForOthers: 0 });
  });
});

describe('7.7 7.8 random', () => {
  it('7.7 7.8 through random purchases, withdrawals and deposits sorted with Other and split with Wishlist, no cent is made or lost, and the self-check holds', () => {
    const amount = fc.integer({ min: 2, max: 500_000 });
    const step = fc.record({
      kind: fc.constantFrom('everyday-card', 'second-card', 'checking', 'savings', 'in'),
      amount,
      // How much of it goes to the first part, out of a thousand.
      share: fc.integer({ min: 1, max: 999 }),
      how: fc.constantFrom('other', 'wishlist', 'split', 'split-all', 'wait'),
    });
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        const b = herBook();
        const bank = { ...BANK };
        steps.forEach((s, n) => {
          const id = `t${n}`;
          const first = Math.max(1, Math.min(s.amount - 1, Math.floor((s.amount * s.share) / 1000)));
          const second = s.amount - first;
          const rest = Math.floor(second / 2);
          if (s.kind === 'in') {
            b.receive(deposit(id, DAY, s.amount));
            bank.checking += s.amount;
            if (s.how === 'other') b.sort(id, { to: 'not-mine' }, DAY);
            if (s.how === 'wishlist') b.sort(id, { to: 'wishlist' }, DAY);
            if (s.how === 'split') b.sort(id, { split: [{ bucket: 'not-mine', amount: first }, { bucket: 'wishlist', amount: second }] }, DAY);
            if (s.how === 'split-all') b.sort(id, { split: [{ bucket: 'savings', amount: first }, { bucket: 'needs', amount: second }] }, DAY);
          } else {
            if (s.kind === 'savings') {
              b.receive(withdrawal(id, DAY, s.amount));
              bank.savings -= s.amount;
            } else {
              b.receive(purchase(id, DAY, s.amount, `MADE UP ${n}`, { account: s.kind }));
              if (s.kind === 'checking') bank.checking -= s.amount;
              if (s.kind === 'everyday-card') bank.everydayCard += s.amount;
              if (s.kind === 'second-card') bank.secondCard = (bank.secondCard ?? 0) + s.amount;
            }
            if (s.how === 'other') b.sort(id, { to: 'not-mine' }, DAY);
            if (s.how === 'wishlist') b.sort(id, { to: 'wishlist' }, DAY);
            if (s.how === 'split') b.sort(id, { split: [{ bucket: 'not-mine', amount: first }, { bucket: 'wishlist', amount: second }] }, DAY);
            if (s.how === 'split-all') {
              const parts = rest === 0 ? [{ bucket: 'needs', amount: first }, { bucket: 'not-mine', amount: second }] : [{ bucket: 'needs', amount: first }, { bucket: 'not-mine', amount: rest }, { bucket: 'wants', amount: second - rest }];
              b.sort(id, { split: parts } as SortChoice, DAY);
            }
          }
          expect(b.selfCheck(bank).ok).toBe(true);
          expect(b.recountPots()).toEqual(b.pots());
        });
      }),
      { numRuns: runs(150) },
    );
  });
});

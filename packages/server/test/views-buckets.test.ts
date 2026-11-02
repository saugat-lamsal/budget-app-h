import { bucketLevel, cardStanding, type BankBalances, type Book, type CardStatement, type Cents } from '@budget-app/money';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MOM_NAME, START_DATE, appSide, arrived, deposit, openTestBook, payPerson, paycheck, purchase, refund, sent, transfer } from '../../money/test/helpers.js';
import { bucketsView, type BucketsInput, type BucketsView } from '../src/views/buckets.js';

// The Buckets screen's numbers (Phase 4), worked out on the server from the
// book. Made-up numbers only.

function matchingBank(book: Book): BankBalances {
  return { checking: appSide(book.pots()) - book.inTransit().total, savings: 0, everydayCard: 0 };
}

function input(book: Book | null, over: Partial<BucketsInput> = {}): BucketsInput {
  return { today: START_DATE, book, bank: book === null ? null : matchingBank(book), madeUpData: false, ...over };
}

function tracking(view: BucketsView): Extract<BucketsView, { state: 'tracking' }> {
  if (view.state !== 'tracking') throw new Error(`expected tracking, got ${view.state}`);
  return view;
}

const view = (book: Book, over: Partial<BucketsInput> = {}) => tracking(bucketsView(input(book, over)));

describe('14 before setup day', () => {
  it('14 there is nothing to show, and it says so', () => {
    expect(bucketsView(input(null, { madeUpData: true }))).toEqual({ state: 'not-set-up', madeUpData: true });
    expect(bucketsView(input(null))).toEqual({ state: 'not-set-up', madeUpData: false });
  });
});

describe('what is left in each bucket', () => {
  it('10.1 needs and wants show what is left and what they started the pay period with', () => {
    const book = openTestBook({ pots: { needs: 93_075, wants: 65_711 } });
    const v = view(book);
    expect(v.needs).toEqual({ left: 93_075, startedWith: 93_075, level: 'ok' });
    expect(v.wants).toEqual({ left: 65_711, startedWith: 65_711, level: 'ok' });
  });

  it('10.1 10.2 low and empty are named, with the level from the setting', () => {
    const book = openTestBook({ pots: { needs: 100_000, wants: 100_000 }, rules: [{ id: 'r', for: 'purchase', contains: 'SHOP', bucket: 'wants' }, { id: 's', for: 'purchase', contains: 'MARKET', bucket: 'needs' }] });
    book.receive(purchase('p1', START_DATE, 85_000, 'MADE UP SHOP'));
    book.receive(purchase('p2', START_DATE, 100_000, 'MADE UP MARKET'));
    const v = view(book);
    expect(v.wants).toEqual({ left: 15_000, startedWith: 100_000, level: bucketLevel(15_000, 100_000, 20) });
    expect(v.wants.level).toBe('low');
    expect(v.needs).toEqual({ left: 0, startedWith: 100_000, level: 'empty' });
  });

  it('3.5 an overspent bucket shows its negative amount', () => {
    const book = openTestBook({ pots: { wants: 1_000 }, rules: [{ id: 'r', for: 'purchase', contains: 'SHOP', bucket: 'wants' }] });
    book.receive(purchase('p1', START_DATE, 1_001, 'MADE UP SHOP'));
    expect(view(book).wants.left).toBe(-1);
  });

  it('savings is the savings bucket', () => {
    expect(view(openTestBook({ pots: { savings: 955_000 } })).savings).toBe(955_000);
  });
});

describe('12.2 everything in the buckets', () => {
  it('12.2 the total is the app side of the self-check, with unsorted money counted', () => {
    const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000, heldForOthers: 7_000 } });
    book.receive(deposit('d1', START_DATE, 25_000, 'MADE UP TAX REFUND'));
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const v = view(book);
    expect(v.total).toBe(337_000 + 25_000 - 1_150);
    expect(v.total).toBe(book.appSide());
    // The same number the self-check compares with the bank.
    expect(v.total).toBe(book.selfCheck(matchingBank(book)).appSide);
  });

  it('12.2 money waiting in review shows apart from the buckets: how many, money in, and spending', () => {
    const book = openTestBook();
    book.receive(deposit('d1', START_DATE, 25_000, 'MADE UP TAX REFUND'));
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    book.receive(purchase('p2', START_DATE, 2_317, 'ONLINE MARKETPLACE'));
    expect(view(book).waiting).toEqual({ count: 3, moneyIn: 25_000, spending: 3_467 });
    expect(view(openTestBook()).waiting).toEqual({ count: 0, moneyIn: 0, spending: 0 });
  });

  it('12.4 the old card is not part of the total', () => {
    const book = openTestBook({ pots: { savings: 100_000 }, oldCardDebt: 298_000 });
    const v = view(book);
    expect(v.total).toBe(100_000);
    expect(v.oldCard).toBe(298_000);
  });

  it('5.4 5.5 the old card debt follows what the app tracks; paying more than it owes is a credit shown as negative (B14)', () => {
    const book = openTestBook({ oldCardDebt: 1_000 });
    book.receive(refund('r1', START_DATE, 1_500, undefined, 'old-card'));
    expect(view(book).oldCard).toBe(-500);
  });
});

describe('0.5 the daily check, shown on Buckets too', () => {
  it('12.3 when the totals match the bank it says so', () => {
    expect(view(openTestBook({ pots: { savings: 100 } })).check).toEqual({ state: 'matches' });
  });

  it('0.5 12.3 when they do not, it says by how much (the bank side plus in transit, minus the app side)', () => {
    const book = openTestBook({ pots: { savings: 100_000 } });
    expect(view(book, { bank: { checking: 98_766, savings: 0, everydayCard: 0 } }).check).toEqual({ state: 'does-not-match', difference: -1_234, catchingUp: false, why: null });
    expect(view(book, { bank: { checking: 100_001, savings: 0, everydayCard: 0 } }).check).toEqual({ state: 'does-not-match', difference: 1, catchingUp: false, why: null });
    expect(view(book, { bank: { checking: 100_001, savings: 0, everydayCard: 0 }, catchingUp: true }).check).toEqual({ state: 'does-not-match', difference: 1, catchingUp: true, why: null });
    // 12.6 (A57): the lines why, as they are given (the Keeper works them out).
    const why = [{ kind: 'balance-moved', account: 'checking', balance: 'available', went: 'up', by: 1, amount: 1 }] as const;
    expect(view(book, { bank: { checking: 100_001, savings: 0, everydayCard: 0 }, why }).check).toEqual({ state: 'does-not-match', difference: 1, catchingUp: false, why });
  });

  it('12.5 money on its way between accounts is not a mismatch', () => {
    const book = openTestBook({ pots: { savings: 100_000 } });
    book.receive(sent('s1', START_DATE, 5_000, 'checking', 'savings'));
    expect(book.inTransit().total).toBe(5_000);
    // Checking dropped by 5,000 and savings has not gained it yet.
    expect(view(book, { bank: { checking: 95_000, savings: 0, everydayCard: 0 } }).check).toEqual({ state: 'matches' });
    book.receive(arrived('a1', START_DATE, 5_000, 'checking', 'savings', 's1'));
    expect(view(book, { bank: { checking: 95_000, savings: 5_000, everydayCard: 0 } }).check).toEqual({ state: 'matches' });
  });

  it('0.5 when the bank cannot be read it says that, and the numbers still show', () => {
    const book = openTestBook({ pots: { savings: 100_000 } });
    const v = view(book, { bank: null });
    expect(v.check).toEqual({ state: 'bank-not-read' });
    expect(v.savings).toBe(100_000);
  });
});

describe('7.3 held for others', () => {
  it('7.3 B22 settled, holding money for others, or someone owes you', () => {
    expect(view(openTestBook()).heldForOthers).toEqual({ heldForOthers: 0, meaning: 'settled' });
    expect(view(openTestBook({ pots: { heldForOthers: 12_000 } })).heldForOthers).toEqual({ heldForOthers: 12_000, meaning: 'holding-for-others' });
    expect(view(openTestBook({ pots: { heldForOthers: -3_500 } })).heldForOthers).toEqual({ heldForOthers: -3_500, meaning: 'owed-to-you' });
    expect(view(openTestBook({ pots: { heldForOthers: 1 } })).heldForOthers.meaning).toBe('holding-for-others');
    expect(view(openTestBook({ pots: { heldForOthers: -1 } })).heldForOthers.meaning).toBe('owed-to-you');
  });
});

describe('8.2 the mom reserve and this month against the target', () => {
  // The target is 2,000.00 to 3,000.00 a month (section 2).
  function sentThisMonth(amount: Cents, today = '2026-10-07'): Extract<BucketsView, { state: 'tracking' }>['momReserve'] {
    const book = openTestBook({ pots: { momReserve: 3_000_000 } });
    if (amount > 0) book.receive(payPerson('m1', '2026-10-03', amount, MOM_NAME));
    return view(book, { today }).momReserve;
  }

  it('8.2 the reserve, what was sent this month, and the target', () => {
    const book = openTestBook({ pots: { momReserve: 220_000 } });
    book.receive(payPerson('m1', '2026-10-03', 50_000, MOM_NAME));
    expect(view(book, { today: '2026-10-07' }).momReserve).toEqual({ amount: 170_000, month: '2026-10', sent: 50_000, target: { low: 200_000, high: 300_000 }, position: 'under' });
  });

  it('8.2 nothing sent yet this month is zero, under the target', () => {
    expect(sentThisMonth(0)).toMatchObject({ sent: 0, position: 'under' });
  });

  it('8.2 one cent short of the low end is under; exactly the low end is within', () => {
    expect(sentThisMonth(199_999).position).toBe('under');
    expect(sentThisMonth(200_000).position).toBe('within');
  });

  it('8.2 exactly the high end is within; one cent more is over', () => {
    expect(sentThisMonth(300_000).position).toBe('within');
    expect(sentThisMonth(300_001).position).toBe('over');
    expect(sentThisMonth(300_001)).toMatchObject({ sent: 300_001 });
  });

  it('8.2 only this calendar month counts: last month and next month do not', () => {
    const book = openTestBook({ pots: { momReserve: 3_000_000 } });
    book.receive(payPerson('m1', '2026-09-30', 80_000, MOM_NAME));
    book.receive(payPerson('m2', '2026-10-01', 10_000, MOM_NAME));
    expect(view(book, { today: '2026-10-07' }).momReserve).toMatchObject({ month: '2026-10', sent: 10_000 });
    expect(view(book, { today: '2026-09-30' }).momReserve).toMatchObject({ month: '2026-09', sent: 80_000 });
    expect(view(book, { today: '2026-11-02' }).momReserve).toMatchObject({ month: '2026-11', sent: 0 });
  });

  it('8.2 the target comes from the setting', () => {
    const book = openTestBook({ pots: { momReserve: 3_000_000 }, settings: { momMonthlyTarget: { low: 10_000, high: 20_000 } } });
    book.receive(payPerson('m1', '2026-10-03', 15_000, MOM_NAME));
    expect(view(book).momReserve).toMatchObject({ target: { low: 10_000, high: 20_000 }, position: 'within' });
  });

  it('8.3 a payment bigger than the reserve counts in full toward the month', () => {
    const book = openTestBook({ pots: { momReserve: 10_000 } });
    book.receive(payPerson('m1', '2026-10-03', 25_000, MOM_NAME));
    expect(view(book).momReserve).toMatchObject({ amount: 0, sent: 25_000 });
  });

  it('7.6 a payment marked for mom counts toward the month, and counts again only once', () => {
    const book = openTestBook({ pots: { momReserve: 100_000 } });
    book.receive(payPerson('z1', '2026-10-03', 40_000, 'MADE UP AUNT'));
    expect(view(book).momReserve.sent).toBe(0);
    book.sort('z1', { to: 'mom' }, '2026-10-04');
    expect(view(book).momReserve).toMatchObject({ amount: 60_000, sent: 40_000 });
  });

  it('3.2 a new paycheck adds to the reserve up to the cap', () => {
    const book = openTestBook({ lastPaycheckDate: '2026-09-18', pots: { momReserve: 290_000 } });
    book.receive(paycheck('pay', '2026-10-02', 420_000));
    expect(view(book).momReserve.amount).toBe(300_000);
  });
});

describe('random books: every number on Buckets is what the money math says', () => {
  it('12.2 10.1 7.3 8.2 every number matches the book, whatever happened', () => {
    const txn = fc.record({
      kind: fc.constantFrom('buy', 'mom', 'deposit', 'refund', 'sort'),
      cents: fc.integer({ min: 1, max: 2_000_000 }),
      day: fc.integer({ min: 1, max: 28 }),
    });
    fc.assert(
      fc.property(fc.array(txn, { maxLength: 25 }), fc.integer({ min: 1, max: 28 }), (steps, todayDay) => {
        const book = openTestBook({ pots: { savings: 500_000, needs: 100_000, wants: 80_000, momReserve: 250_000 }, rules: [{ id: 'g', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
        let n = 0;
        for (const s of steps) {
          n += 1;
          const date = `2026-10-${String(s.day).padStart(2, '0')}`;
          if (s.kind === 'buy') book.receive(purchase(`t${n}`, date, s.cents, n % 2 === 0 ? 'MADE UP GROCER' : 'MADE UP SHOP'));
          if (s.kind === 'mom') book.receive(payPerson(`t${n}`, date, s.cents, MOM_NAME));
          if (s.kind === 'deposit') book.receive(deposit(`t${n}`, date, s.cents, 'MADE UP GIFT'));
          if (s.kind === 'refund') book.receive(refund(`t${n}`, date, s.cents, undefined, 'everyday-card'));
          if (s.kind === 'sort') for (const item of book.reviewItems().slice(0, 1)) if (item.type === 'money-in') book.sort(item.id, { to: 'wants' }, date);
        }
        const today = `2026-10-${String(todayDay).padStart(2, '0')}`;
        const v = tracking(bucketsView(input(book, { today })));
        const pots = book.pots();
        const started = book.startedPeriodWith();
        expect(v.total).toBe(appSide(pots));
        expect(v.needs).toEqual({ left: pots.needs, startedWith: started.needs, level: bucketLevel(pots.needs, started.needs, 20) });
        expect(v.wants).toEqual({ left: pots.wants, startedWith: started.wants, level: bucketLevel(pots.wants, started.wants, 20) });
        expect(v.savings).toBe(pots.savings);
        expect(v.momReserve.amount).toBe(pots.momReserve);
        expect(v.momReserve.sent).toBe(book.momSentInMonth('2026-10').sent);
        expect(v.heldForOthers).toEqual(book.othersMoney());
        expect(v.oldCard).toBe(book.oldCardDebt());
        expect(v.waiting).toEqual({ count: book.reviewItems().length, moneyIn: pots.unsortedIn, spending: pots.unsortedOut });
        expect(JSON.parse(JSON.stringify(v))).toEqual(v);
      }),
      { numRuns: 150 },
    );
  });
});

describe('12.5 money on its way', () => {
  it('12.5 B44 every transfer with one side showing is listed: what left and has not landed, and what landed before it showed leaving; the old card\'s is listed but not counted (12.4)', () => {
    const book = openTestBook({ pots: { savings: 100_000, needs: 80_000, wants: 30_000 } });
    book.receive(sent('to-savings', '2026-10-02', 235_000, 'checking', 'savings'));
    book.receive(sent('to-old', '2026-10-03', 15_000, 'checking', 'old-card'));
    book.receive(arrived('landed-first', '2026-10-04', 20_000, 'checking', 'everyday-card'));
    const v = view(book);
    expect(v.onItsWay).toEqual({
      counted: 235_000 - 20_000,
      items: [
        { id: 'to-savings', date: '2026-10-02', from: 'checking', to: 'savings', amount: 235_000, seen: 'left', counted: true },
        { id: 'to-old', date: '2026-10-03', from: 'checking', to: 'old-card', amount: 15_000, seen: 'left', counted: false },
        { id: 'landed-first', date: '2026-10-04', from: 'checking', to: 'everyday-card', amount: 20_000, seen: 'arrived', counted: true },
      ],
    });
    // The counted part is the money math's own (12.5).
    expect(v.onItsWay.counted).toBe(book.inTransit().total);
  });

  it('12.5 with nothing on its way, the list is empty', () => {
    expect(view(openTestBook()).onItsWay).toEqual({ counted: 0, items: [] });
  });

  it('12.5 once the other side shows, it is no longer listed', () => {
    const book = openTestBook();
    book.receive(sent('to-old', '2026-10-03', 15_000, 'checking', 'old-card'));
    book.receive(arrived('to-old-landed', '2026-10-05', 15_000, 'checking', 'old-card', 'to-old'));
    expect(view(book).onItsWay).toEqual({ counted: 0, items: [] });
  });
});

describe("9.9 each card's statement, at any time", () => {
  const OLD: CardStatement = { card: 'old-card', closingDate: '2026-09-29', dueDate: '2026-11-20', statementBalance: 200_000, minimumPayment: 4_000 };
  const EVERYDAY: CardStatement = { card: 'everyday-card', closingDate: '2026-09-28', dueDate: '2026-11-11', statementBalance: 45_025, minimumPayment: 3_500 };

  it('9.9 long before the first reminder day, both are shown, the everyday card first, as the money math has them', () => {
    const book = openTestBook();
    const cards = view(book, { statements: [OLD, EVERYDAY] }).cards;
    expect(cards.statements).toEqual([cardStanding(START_DATE, EVERYDAY, []), cardStanding(START_DATE, OLD, [])]);
    expect(cards.statements.map((c) => c.card)).toEqual(['everyday-card', 'old-card']);
    expect(cards.statements[0]).toMatchObject({ statementBalance: 45_025, standing: 'to-pay' });
    expect(cards.statements[1]).toMatchObject({ statementBalance: null, minimumPayment: 4_000 });
    expect(cards.off).toEqual([]);
  });

  it('9.9 9.3 a payment the book has seen counts toward it', () => {
    const book = openTestBook();
    book.receive(transfer('t1', START_DATE, 3_999, 'checking', 'old-card'));
    expect(view(book, { statements: [OLD] }).cards.statements[0]).toMatchObject({ paid: 3_999, standing: 'to-pay' });
    book.receive(transfer('t2', START_DATE, 1, 'checking', 'old-card'));
    expect(view(book, { statements: [OLD] }).cards.statements[0]).toMatchObject({ paid: 4_000, standing: 'paid' });
  });

  it('9.9 9.8 a card whose reminders are off says so, and none is an empty list', () => {
    const book = openTestBook();
    expect(view(book).cards).toEqual({ statements: [], off: [] });
    const off = [{ card: 'old-card', why: 'no-statement-date' }] as const;
    expect(view(book, { statements: [EVERYDAY], cardsOff: off }).cards).toEqual({ statements: [cardStanding(START_DATE, EVERYDAY, [])], off });
  });
});

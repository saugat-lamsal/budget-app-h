// Her rulebook, section 52 (PR 7+8): what is set aside for each card (52.2),
// and each card's statement in lines that add up to its balance (52.4). Both
// only read the book. Made-up numbers only. The random lives are in
// cards-random-her.test.ts.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HER_SETTINGS,
  HER_SWITCHES,
  cardStatementView,
  changeSettings,
  openBook,
  owedAtSetup,
  setAside,
  cardOwes,
  type BankBalances,
  type Book,
  type CardStatement,
  type Cents,
  type IsoDate,
  type OpenBookInput,
  type Purchase,
  type Settings,
  type SortingRule,
  type StatementView,
} from '../src/index.js';
import { LAST_PAYCHECK, PAYROLL, START_DATE, arrived, cardCharge, codeOf, dropped, paycheck, pendingChanged, posted, purchase, refund, sent, takenBack, transfer } from './helpers.js';

const RULES: readonly SortingRule[] = [
  { id: 'r1', for: 'purchase', contains: 'MADE UP GROCER', bucket: 'needs' },
  { id: 'r2', for: 'purchase', contains: 'MADE UP CINEMA', bucket: 'wants' },
];
const HER: Settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL }, askBeforeSplittingPaycheck: false });
const POTS = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 };
// Checking + savings - both cards = the pots above (180,000).
const BANK: BankBalances = { checking: 110_000, savings: 100_000, everydayCard: 20_000, secondCard: 10_000 };
const AT_SETUP = { 'everyday-card': 20_000, 'second-card': 10_000 } as const;
const MAX = Number.MAX_SAFE_INTEGER;

function herBook(input: Partial<OpenBookInput> = {}): Book {
  return openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: HER, rules: RULES, switches: HER_SWITCHES, ...input });
}

const grocer = (id: string, date: IsoDate, amount: Cents, card: Purchase['account'] = 'everyday-card', pending = false): Purchase => purchase(id, date, amount, 'MADE UP GROCER', { account: card, pending });
const cinema = (id: string, date: IsoDate, amount: Cents, card: Purchase['account'] = 'everyday-card'): Purchase => purchase(id, date, amount, 'MADE UP CINEMA', { account: card });

function state(book: Book): string {
  return JSON.stringify({ pots: book.pots(), review: book.reviewDetails(), log: book.changeLog(), purchases: book.purchases(), transit: book.inTransit(), cards: [book.cardEntries('everyday-card'), book.cardEntries('second-card')] });
}

describe('52.2 set aside: what each card owes as the app counts it', () => {
  it('52.2 on setup day, each card has set aside what it owed then, its pending charges included', () => {
    const pending = grocer('p0', '2026-09-30', 2_500, 'second-card', true);
    const atSetup = owedAtSetup({ bankBalances: BANK, pendingCharges: [pending] }, 'second-card');
    expect(atSetup).toBe(12_500);
    expect(owedAtSetup({ bankBalances: BANK, pendingCharges: [pending] }, 'everyday-card')).toBe(20_000);
    const b = herBook({ pots: { ...POTS, wants: 27_500 }, countedAtSetup: [pending] });
    expect(cardOwes(b, 'second-card', atSetup)).toBe(12_500);
    expect(setAside(b, { 'everyday-card': 20_000, 'second-card': atSetup }, null).cards).toEqual([
      { card: 'everyday-card', owes: 20_000, setAside: 20_000 },
      { card: 'second-card', owes: 12_500, setAside: 12_500 },
    ]);
  });

  it('52.2 a purchase raises it by exactly its amount the day it is made, while pending, and by the new amount once it posts at another', () => {
    const b = herBook();
    b.receive(grocer('p1', '2026-10-02', 1, 'everyday-card', true));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(20_001);
    b.receive(pendingChanged('k1', 'p1', '2026-10-02', 1_000));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(21_000);
    b.receive(posted('p1b', 'p1', '2026-10-03', 1_250, 'MADE UP GROCER'));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(21_250);
    // The other card is not touched.
    expect(cardOwes(b, 'second-card', 10_000)).toBe(10_000);
  });

  it('52.2 a refund and a payment that reached the card lower it; a payment still on its way does not', () => {
    const b = herBook();
    b.receive(cinema('p1', '2026-10-02', 3_000, 'second-card'));
    b.receive(refund('r1', '2026-10-03', 1_000, 'p1', 'second-card'));
    expect(cardOwes(b, 'second-card', 10_000)).toBe(12_000);
    b.receive(sent('s1', '2026-10-04', 5_000, 'checking', 'second-card'));
    expect(cardOwes(b, 'second-card', 10_000)).toBe(12_000);
    b.receive(arrived('a1', '2026-10-06', 5_000, 'checking', 'second-card', 's1'));
    expect(cardOwes(b, 'second-card', 10_000)).toBe(7_000);
    b.receive(transfer('t1', '2026-10-07', 7_000, 'savings', 'second-card'));
    expect(cardOwes(b, 'second-card', 10_000)).toBe(0);
  });

  it('52.2 one seen landing on the card before it shows leaving counts from the day it lands', () => {
    const b = herBook();
    b.receive(arrived('a1', '2026-10-02', 4_000, 'checking', 'everyday-card'));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(16_000);
    b.receive(sent('s1', '2026-10-03', 4_000, 'checking', 'everyday-card'));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(16_000);
  });

  it('52.2 fees, interest and purchases still waiting to be sorted count too', () => {
    const b = herBook();
    b.receive(cardCharge('f1', '2026-10-02', 2_900, 'fee', 'second-card'));
    b.receive(cardCharge('i1', '2026-10-02', 137, 'interest', 'second-card'));
    b.receive(purchase('p1', '2026-10-02', 999, 'MADE UP NEW PLACE', { account: 'second-card' }));
    expect(b.reviewItems().length).toBe(3);
    expect(cardOwes(b, 'second-card', 10_000)).toBe(14_036);
  });

  it('52.2 a hold the bank drops and a charge it takes back put it back where it was', () => {
    const b = herBook();
    b.receive(grocer('p1', '2026-10-02', 4_500, 'everyday-card', true));
    b.receive(dropped('x1', 'p1', '2026-10-03'));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(20_000);
    b.receive(grocer('p2', '2026-10-04', 800));
    b.receive(grocer('p3', '2026-10-04', 800));
    b.receive(takenBack('k1', 'p3', '2026-10-05'));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(20_800);
    // A refund the bank takes back raises it again.
    b.receive(refund('r1', '2026-10-06', 800, 'p2'));
    b.receive(takenBack('k2', 'r1', '2026-10-07'));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(20_800);
  });

  it('52.2 a charge pending on setup day moves it by only the difference when it posts, and by all of it when dropped', () => {
    const p0 = grocer('p0', '2026-09-30', 2_500, 'everyday-card', true);
    const q0 = grocer('q0', '2026-09-30', 1_000, 'second-card', true);
    const b = herBook({ pots: { ...POTS, wants: 26_500 }, countedAtSetup: [p0, q0] });
    const atSetup = { 'everyday-card': 22_500, 'second-card': 11_000 };
    b.receive(posted('p0b', 'p0', '2026-10-02', 3_000, 'MADE UP GROCER'));
    b.receive(dropped('x1', 'q0', '2026-10-02'));
    expect(cardOwes(b, 'everyday-card', atSetup['everyday-card'])).toBe(23_000);
    expect(cardOwes(b, 'second-card', atSetup['second-card'])).toBe(10_000);
  });

  it('52.2 a payment on its way to the card on setup day lowers it when it lands; one that had landed is already in the balance', () => {
    const left = sent('s0', '2026-09-30', 3_000, 'checking', 'everyday-card');
    const landed = arrived('a0', '2026-09-30', 2_000, 'checking', 'second-card');
    // Starting money: 180,000 + 3,000 on its way - 2,000 landed before it showed leaving.
    const b = herBook({ pots: { ...POTS, wants: 31_000 }, inTransitAtSetup: [left, landed] });
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(20_000);
    expect(cardOwes(b, 'second-card', 10_000)).toBe(10_000);
    b.receive(arrived('a1', '2026-10-02', 3_000, 'checking', 'everyday-card', 's0'));
    b.receive(sent('s1', '2026-10-02', 2_000, 'checking', 'second-card'));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(17_000);
    expect(cardOwes(b, 'second-card', 10_000)).toBe(10_000);
  });

  it('52.2 when the totals match the bank, the two cards together have set aside what the bank says they owe', () => {
    const b = herBook();
    b.receive(grocer('p1', '2026-10-02', 4_000, 'everyday-card', true));
    b.receive(cinema('p2', '2026-10-02', 1_500, 'second-card'));
    b.receive(transfer('t1', '2026-10-03', 6_000, 'checking', 'everyday-card'));
    const bank: BankBalances = { checking: 104_000, savings: 100_000, everydayCard: 18_000, secondCard: 11_500 };
    expect(b.selfCheck(bank).ok).toBe(true);
    const aside = setAside(b, AT_SETUP, bank.savings);
    expect(aside.cards.map((c) => c.owes)).toEqual([bank.everydayCard, bank.secondCard]);
    expect(aside.total).toBe(bank.everydayCard + (bank.secondCard ?? 0));
  });

  it('52.2 the part in savings is the extra the savings account holds, and never more than all that is set aside', () => {
    const b = herBook();
    // The savings bucket is 100,000; both cards owe 30,000 in all.
    expect(setAside(b, AT_SETUP, 100_000).inSavings).toBe(0);
    expect(setAside(b, AT_SETUP, 99_999).inSavings).toBe(0);
    expect(setAside(b, AT_SETUP, 100_001).inSavings).toBe(1);
    expect(setAside(b, AT_SETUP, 129_999).inSavings).toBe(29_999);
    expect(setAside(b, AT_SETUP, 130_000).inSavings).toBe(30_000);
    expect(setAside(b, AT_SETUP, 150_000).inSavings).toBe(30_000);
    // The bank cannot be read: not known.
    expect(setAside(b, AT_SETUP, null).inSavings).toBeNull();
  });

  it('52.2 a card that owes less than nothing (a credit) has nothing set aside, and the rest of the total is the other card', () => {
    const b = herBook();
    b.receive(refund('r1', '2026-10-02', 10_001, undefined, 'second-card'));
    const aside = setAside(b, AT_SETUP, 200_000);
    expect(aside.cards[1]).toEqual({ card: 'second-card', owes: -1, setAside: 0 });
    expect(aside.total).toBe(20_000);
    expect(aside.inSavings).toBe(20_000);
  });

  it('52.2 a card that owes nothing has $0.00 set aside, and very large amounts stay exact', () => {
    const b = herBook();
    expect(setAside(b, { 'everyday-card': 0, 'second-card': 0 }, 100_000).cards.map((c) => c.setAside)).toEqual([0, 0]);
    b.receive(grocer('p1', '2026-10-02', MAX - 20_000));
    expect(cardOwes(b, 'everyday-card', 20_000)).toBe(MAX);
    expect(codeOf(() => cardOwes(b, 'everyday-card', 20_001))).toBe('not-cents');
  });

  it('52.2 it only reads the book', () => {
    const b = herBook();
    b.receive(grocer('p1', '2026-10-02', 4_000));
    const before = state(b);
    setAside(b, AT_SETUP, 120_000);
    cardOwes(b, 'second-card', 10_000);
    expect(state(b)).toBe(before);
  });

  it('52.2 is for the two cards used day to day, and the second card only where the setup has one', () => {
    const upstream = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: DEFAULT_SETTINGS });
    expect(codeOf(() => cardOwes(upstream, 'second-card', 0))).toBe('off-in-this-setup');
    expect(codeOf(() => cardOwes(herBook(), 'old-card' as 'second-card', 0))).toBe('bad-card');
    expect(codeOf(() => cardOwes(herBook(), 'everyday-card', 0.5))).toBe('not-cents');
  });
});

// 52.4: one statement of a card. Her card closes on the 5th; the statement
// before closed Oct 5 with 20,000 on it.
const BEFORE: CardStatement = { card: 'everyday-card', closingDate: '2026-10-05', dueDate: '2026-10-30', statementBalance: 20_000, minimumPayment: 3_500 };
const statementOf = (balance: Cents, card: CardStatement['card'] = 'everyday-card'): CardStatement => ({ card, closingDate: '2026-11-05', dueDate: '2026-11-30', statementBalance: balance, minimumPayment: 3_500 });

// Every line adds up: the carried-in line, the purchases, and what is not matched.
function expectAddsUp(view: StatementView): void {
  const sum = (groups: readonly { total: Cents; items: readonly { amount: Cents }[] }[]): Cents => groups.reduce((s, g) => s + g.total, 0);
  for (const g of [...view.byBucket, ...view.byPayPeriod]) expect(g.items.reduce((s, i) => s + i.amount, 0)).toBe(g.total);
  expect(sum(view.byBucket)).toBe(view.charges);
  expect(sum(view.byPayPeriod)).toBe(view.charges);
  expect(view.carriedIn.amount + view.charges + view.notMatched).toBe(view.statementBalance);
  if (view.carriedIn.kind === 'from-statement-before') {
    expect(view.carriedIn.before + view.carriedIn.paymentsAndCredits).toBe(view.carriedIn.amount);
    expect(view.carriedIn.items.reduce((s, i) => s + i.amount, 0)).toBe(view.carriedIn.paymentsAndCredits);
  }
}

const totals = (view: StatementView): Record<string, Cents> => Object.fromEntries(view.byBucket.map((g) => [g.bucket, g.total]));
const periodTotals = (view: StatementView): Record<string, Cents> => Object.fromEntries(view.byPayPeriod.map((g) => [g.period === 'before-setup' ? 'before-setup' : `${g.period.number} ${g.period.startDate}`, g.total]));

describe('52.4 the statement, per card', () => {
  function monthOnTheCard(): Book {
    const b = herBook();
    b.receive(grocer('p1', '2026-10-10', 4_000));
    b.receive(cinema('p2', '2026-10-12', 1_500));
    b.receive(paycheck('pay1', '2026-10-16', 250_000));
    b.receive(purchase('p3', '2026-10-20', 700, 'MADE UP NEW PLACE'));
    b.receive(arrived('a1', '2026-10-25', 20_000, 'checking', 'everyday-card'));
    b.receive(refund('r1', '2026-10-28', 1_000, 'p1'));
    b.receive(cardCharge('f1', '2026-11-01', 2_900));
    // On the closing day, posted that day: on this statement.
    b.receive(grocer('p4', '2026-11-05', 300));
    // Pending before the closing day, posted after it: on the next one.
    b.receive(grocer('p5', '2026-11-03', 650, 'everyday-card', true));
    b.receive(posted('p5b', 'p5', '2026-11-06', 650, 'MADE UP GROCER'));
    return b;
  }

  it('52.4 the lines add up to the statement balance exactly: carried in less payments, then each purchase by its bucket now', () => {
    const view = cardStatementView({ statement: statementOf(8_400), before: BEFORE, book: monthOnTheCard() });
    expectAddsUp(view);
    expect(view.from).toBe('2026-10-06');
    expect(view.carriedIn).toMatchObject({ kind: 'from-statement-before', before: 20_000, paymentsAndCredits: -20_000, amount: 0 });
    expect(totals(view)).toEqual({ needs: 3_300, wants: 1_500, unsorted: 3_600 });
    expect(view.charges).toBe(8_400);
    expect(view.notMatched).toBe(0);
    expect(view.byBucket.find((g) => g.bucket === 'needs')?.items.map((i) => [i.id, i.amount])).toEqual([
      ['p1', 4_000],
      ['r1', -1_000],
      ['p4', 300],
    ]);
  });

  it('52.4 and again by the pay period each was counted in', () => {
    const view = cardStatementView({ statement: statementOf(8_400), before: BEFORE, book: monthOnTheCard() });
    expect(periodTotals(view)).toEqual({ '0 2026-10-01': 5_500, '1 2026-10-16': 2_900 });
  });

  it('52.4 what the lines do not account for is one more line, Not matched, and the lines still add up', () => {
    for (const off of [1, -1, 123_456]) {
      const view = cardStatementView({ statement: statementOf(8_400 + off), before: BEFORE, book: monthOnTheCard() });
      expectAddsUp(view);
      expect(view.notMatched).toBe(off);
    }
  });

  it('52.4 a purchase pending over the closing day is on the statement it posts on, counted once', () => {
    const view = cardStatementView({ statement: { ...BEFORE, closingDate: '2026-12-05', dueDate: '2026-12-30', statementBalance: 650 }, before: { ...statementOf(0), statementBalance: 0 }, book: monthOnTheCard() });
    expectAddsUp(view);
    expect(view.charges).toBe(650);
    expect(view.notMatched).toBe(0);
  });

  it('52.4 the day a purchase posted is the bank\'s, when the caller knows it', () => {
    // The bank says p4 posted the day after the closing day: on the next statement.
    const postedOn = (id: string): IsoDate | null => (id === 'p4' ? '2026-11-06' : null);
    const view = cardStatementView({ statement: statementOf(8_100), before: BEFORE, book: monthOnTheCard(), postedOn });
    expectAddsUp(view);
    expect(totals(view)['needs']).toBe(3_000);
    expect(view.notMatched).toBe(0);
  });

  it('52.4 the first statement the app sees says From before the app saw this card, and its days start a month before', () => {
    const view = cardStatementView({ statement: statementOf(8_400), before: null, book: monthOnTheCard() });
    expectAddsUp(view);
    expect(view.from).toBe('2026-10-06');
    expect(view.carriedIn).toEqual({ kind: 'before-the-app', amount: 0 });
    expect(view.notMatched).toBe(0);
    const later = cardStatementView({ statement: statementOf(9_999), before: null, book: monthOnTheCard() });
    expect(later.carriedIn).toEqual({ kind: 'before-the-app', amount: 1_599 });
    // A month too short for the closing day: its last day.
    const march = cardStatementView({ statement: { ...BEFORE, closingDate: '2027-03-31', dueDate: '2027-04-25', statementBalance: 0 }, before: null, book: herBook() });
    expect(march.from).toBe('2027-03-01');
  });

  it('52.4 purchases from before setup day are marked Before setup day; a payment then is with the payments', () => {
    const b = herBook();
    b.receive(grocer('p1', '2026-10-02', 2_000));
    const view = cardStatementView({
      statement: { ...BEFORE, statementBalance: 12_000 },
      before: { ...BEFORE, closingDate: '2026-09-05', dueDate: '2026-09-30', statementBalance: 15_000 },
      book: b,
      beforeSetup: [
        { id: 'h1', date: '2026-09-27', postedOn: '2026-09-28', description: 'MADE UP GROCER', amount: 1_000, payment: false },
        { id: 'h2', date: '2026-09-29', postedOn: '2026-09-29', description: 'PAYMENT RECEIVED', amount: -5_000, payment: true },
        { id: 'h3', date: '2026-09-01', postedOn: '2026-09-02', description: 'MADE UP GROCER', amount: 999, payment: false },
      ],
    });
    expectAddsUp(view);
    expect(view.carriedIn).toMatchObject({ before: 15_000, paymentsAndCredits: -5_000, amount: 10_000 });
    expect(totals(view)).toEqual({ needs: 2_000, 'before-setup': 1_000 });
    expect(periodTotals(view)).toEqual({ 'before-setup': 1_000, '0 2026-10-01': 2_000 });
    expect(view.notMatched).toBe(-1_000);
  });

  it('52.4 a charge pending on setup day is Before setup day for what setup day counted; what changed later is under its bucket', () => {
    const p0 = grocer('p0', '2026-09-30', 2_500, 'everyday-card', true);
    const b = herBook({ pots: { ...POTS, wants: 27_500 }, countedAtSetup: [p0] });
    b.receive(posted('p0b', 'p0', '2026-10-02', 3_000, 'MADE UP GROCER'));
    b.sort('p0', { to: 'needs' }, '2026-10-03');
    const view = cardStatementView({ statement: { ...BEFORE, statementBalance: 23_000 }, before: { ...BEFORE, closingDate: '2026-09-05', dueDate: '2026-09-30', statementBalance: 20_000 }, book: b });
    expectAddsUp(view);
    expect(totals(view)).toEqual({ 'before-setup': 2_500, needs: 500 });
    expect(view.notMatched).toBe(0);
  });

  it('52.4 a split purchase is under each of its buckets, and a refund of all of it gives each its part back', () => {
    const b = herBook();
    b.receive(purchase('p1', '2026-10-10', 10_000, 'MADE UP SHOP'));
    b.sort('p1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 4_000 }] }, '2026-10-10');
    const view = cardStatementView({ statement: statementOf(10_000), before: { ...BEFORE, statementBalance: 0 }, book: b });
    expect(totals(view)).toEqual({ needs: 6_000, wants: 4_000 });
    b.receive(refund('r1', '2026-10-12', 10_000, 'p1'));
    const refunded = cardStatementView({ statement: statementOf(0), before: { ...BEFORE, statementBalance: 0 }, book: b });
    expectAddsUp(refunded);
    expect(totals(refunded)).toEqual({ needs: 0, wants: 0 });
    expect(refunded.byBucket.find((g) => g.bucket === 'wants')?.items.map((i) => i.amount)).toEqual([4_000, -4_000]);
  });

  it('52.4 a partly refunded split, split again, keeps each bucket to what it holds', () => {
    const b = herBook();
    b.receive(purchase('p1', '2026-10-10', 10_000, 'MADE UP SHOP'));
    b.receive(refund('r1', '2026-10-11', 3_000, 'p1'));
    b.sort('p1', { split: [{ bucket: 'needs', amount: 4_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-12');
    const view = cardStatementView({ statement: statementOf(7_000), before: { ...BEFORE, statementBalance: 0 }, book: b });
    expectAddsUp(view);
    expect(totals(view)).toEqual({ needs: 4_000, wants: 3_000 });
  });

  it('52.4 a refund still waiting in review is under Still unsorted; one that is not hers is a credit with the payments', () => {
    const b = herBook();
    b.receive(refund('r1', '2026-10-10', 500, undefined, 'everyday-card'));
    b.receive(refund('r2', '2026-10-11', 700, undefined, 'everyday-card'));
    b.sort('r2', { to: 'not-mine' }, '2026-10-12');
    const view = cardStatementView({ statement: statementOf(18_800), before: BEFORE, book: b });
    expectAddsUp(view);
    expect(totals(view)).toEqual({ unsorted: -500 });
    expect(view.carriedIn).toMatchObject({ paymentsAndCredits: -700, amount: 19_300 });
    expect(view.notMatched).toBe(0);
  });

  it('52.4 a charge the bank takes back after the closing day stays on its statement; the take-back is on the next one', () => {
    const b = herBook();
    b.receive(grocer('p1', '2026-11-04', 800));
    b.receive(takenBack('k1', 'p1', '2026-11-08'));
    const first = cardStatementView({ statement: statementOf(800), before: { ...BEFORE, statementBalance: 0 }, book: b });
    expectAddsUp(first);
    expect(first.notMatched).toBe(0);
    expect(totals(first)).toEqual({ needs: 800 });
    const next = cardStatementView({ statement: { ...statementOf(0), closingDate: '2026-12-05', dueDate: '2026-12-30' }, before: statementOf(800), book: b });
    expectAddsUp(next);
    expect(totals(next)).toEqual({ needs: -800 });
    expect(next.notMatched).toBe(0);
  });

  it('52.4 each card has its own statement: the other card\'s purchases are never on it', () => {
    const b = herBook();
    b.receive(grocer('p1', '2026-10-10', 4_000, 'second-card'));
    b.receive(cinema('p2', '2026-10-11', 1_000, 'everyday-card'));
    const view = cardStatementView({ statement: statementOf(4_000, 'second-card'), before: { ...BEFORE, card: 'second-card', statementBalance: 0 }, book: b });
    expectAddsUp(view);
    expect(totals(view)).toEqual({ needs: 4_000 });
  });

  it('52.4 a statement with nothing on it, and one of a cent', () => {
    const b = herBook();
    const empty = cardStatementView({ statement: statementOf(0), before: { ...BEFORE, statementBalance: 0 }, book: b });
    expect(empty).toMatchObject({ charges: 0, notMatched: 0, byBucket: [], byPayPeriod: [] });
    b.receive(grocer('p1', '2026-10-10', 1));
    const cent = cardStatementView({ statement: statementOf(1), before: { ...BEFORE, statementBalance: 0 }, book: b });
    expectAddsUp(cent);
    expect(totals(cent)).toEqual({ needs: 1 });
  });

  it('52.4 before setup day there is no book: the history alone, and what it does not account for', () => {
    const view = cardStatementView({
      statement: statementOf(1_000),
      before: { ...BEFORE, statementBalance: 0 },
      book: null,
      beforeSetup: [{ id: 'h1', date: '2026-10-10', postedOn: '2026-10-10', description: 'MADE UP GROCER', amount: 1_000, payment: false }],
    });
    expectAddsUp(view);
    expect(totals(view)).toEqual({ 'before-setup': 1_000 });
  });

  it('52.4 it only reads the book', () => {
    const b = monthOnTheCard();
    const before = state(b);
    cardStatementView({ statement: statementOf(8_400), before: BEFORE, book: b });
    expect(state(b)).toBe(before);
  });

  it('52.4 is for a card used day to day, and the statement before is an older one of the same card', () => {
    const b = herBook();
    expect(codeOf(() => cardStatementView({ statement: { ...statementOf(0), card: 'old-card' }, before: null, book: b }))).toBe('bad-card');
    expect(codeOf(() => cardStatementView({ statement: statementOf(0), before: { ...BEFORE, card: 'second-card' }, book: b }))).toBe('bad-statement');
    expect(codeOf(() => cardStatementView({ statement: statementOf(0), before: statementOf(0), book: b }))).toBe('bad-statement');
  });
});

// Every example in worked-examples-h.txt (her setup) is also a test. The
// expected numbers come from the "Check:" line in the text file itself, as
// in worked-examples.test.ts, so the file checked by hand and the test can
// never drift apart.
import { describe, expect, it } from 'vitest';
import { HER_SETTINGS, HER_SWITCHES, bankSide, cardNotices, cardOwes, cardStatementView, changeSettings, owedAtSetup, setAside, daysBetween, openBook, parseDollars, startTracking, wishlistMove, withPendingCharges, type Book, type CardStatement, type Cents, type IsoDate } from '../src/index.js';
import text from '../worked-examples-h.txt?raw';
import { LAST_PAYCHECK, PAYROLL, START_DATE, ZERO_POTS, arrived, deposit, paycheck, posted, purchase, refund, sent, transfer } from './helpers.js';

interface Example {
  number: number;
  title: string;
  checks: Map<string, Cents>;
}

function readExamples(): Example[] {
  const blocks = text.split(/^EXAMPLE /m).slice(1);
  return blocks.map((block) => {
    const header = /^(\d+)\.\s+(.*)$/m.exec(block);
    const checkLines = [...block.matchAll(/^Check: (.*)$/gm)].map((m) => m[1] ?? '');
    if (!header || checkLines.length === 0) throw new Error(`example is missing its number or Check line:\n${block.slice(0, 200)}`);
    const checks = new Map<string, Cents>();
    for (const part of checkLines.join(' | ').split('|')) {
      const m = /^\s*([a-z][a-z ]*?)\s+(-?[\d,]+\.\d{2})\s*$/.exec(part);
      if (!m) throw new Error(`cannot read "${part}" in example ${header[1]}`);
      checks.set(m[1] ?? '', parseDollars(m[2] ?? ''));
    }
    return { number: Number(header[1]), title: header[2] ?? '', checks };
  });
}

const HER = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL } });

// Her setup: no mom reserve and no old card, her starting settings, and the
// paycheck rule set.
function herBook(pots: Partial<Record<keyof typeof ZERO_POTS | 'wishlist', Cents>> = {}): Book {
  return openBook({
    date: START_DATE,
    lastPaycheckDate: LAST_PAYCHECK,
    oldCardDebt: 0,
    pots: { ...ZERO_POTS, ...pots },
    settings: HER,
    switches: HER_SWITCHES,
  });
}

function buckets(book: Book): Record<string, Cents> {
  const p = book.pots();
  return {
    savings: p.savings,
    needs: p.needs,
    wants: p.wants,
    'mom reserve': p.momReserve,
    'held for others': p.heldForOthers,
    'unsorted money in': p.unsortedIn,
    'unsorted spending': p.unsortedOut,
    'app side': book.appSide(),
  };
}

// Each example, set up in code exactly as the text describes it.
const examples: Record<number, () => Record<string, Cents>> = {
  // PR 4: her paycheck waits for her yes (3.1).
  1: () => {
    const book = herBook();
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,345.67')));
    book.sort('pay', { to: 'paycheck' }, '2026-10-09');
    return buckets(book);
  },
  2: () => {
    const book = herBook();
    book.receive(paycheck('pay', '2026-10-09', parseDollars('0.01')));
    book.sort('pay', { to: 'paycheck' }, '2026-10-09');
    return buckets(book);
  },
  3: () => {
    const book = herBook({ savings: parseDollars('4,000.00'), needs: parseDollars('1,000.00'), wants: parseDollars('200.00') });
    book.receive(deposit('friend', '2026-10-02', parseDollars('60.00'), 'MADE UP FRIEND'));
    book.receive(purchase('shop', '2026-10-02', parseDollars('12.50')));
    return buckets(book);
  },
  4: () => {
    const book = herBook({ savings: parseDollars('3,000.00'), needs: parseDollars('400.00'), wants: parseDollars('150.00') });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('1,987.65')));
    return { ...buckets(book), 'safe to spend': book.safeToSpend('2026-10-09').amount };
  },
  5: () => {
    const book = herBook({ savings: parseDollars('3,000.00'), needs: parseDollars('400.00'), wants: parseDollars('150.00') });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('1,987.65')));
    book.receive(purchase('gas', '2026-10-10', parseDollars('41.20'), 'MADE UP GAS'));
    book.sort('gas', { to: 'needs' }, '2026-10-10');
    book.sort('pay', { to: 'paycheck' }, '2026-10-12');
    const asked = book.reviewItems().find((i) => i.type === 'leftover' && i.bucket === 'needs');
    return { ...buckets(book), 'needs question': asked?.type === 'leftover' ? asked.amount : -1, 'days to the next payday': book.safeToSpend('2026-10-12').daysToPayday * 100 };
  },
  6: () => {
    const book = herBook({ savings: parseDollars('3,000.00'), needs: parseDollars('400.00'), wants: parseDollars('150.00') });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('1,987.65')));
    book.sort('pay', { to: 'other-income' }, '2026-10-10');
    return buckets(book);
  },
  // PR 5: her second card.
  7: () => ({ 'bank side': bankSide(withPendingCharges(EXAMPLE_7_POSTED, EXAMPLE_7_PENDING)) }),
  8: () => {
    const onItsWay = sent('pay-amex', '2026-09-30', parseDollars('200.00'), 'checking', 'second-card');
    const result = startTracking({
      date: START_DATE,
      bankBalances: EXAMPLE_7_POSTED,
      pendingCharges: EXAMPLE_7_PENDING,
      transfersInTransit: [onItsWay],
      oldCardBalance: 0,
      assignment: { savings: parseDollars('6,300.00'), needs: parseDollars('452.98'), wants: parseDollars('300.00'), momReserve: 0, heldForOthers: 0 },
      lastPaycheckDate: LAST_PAYCHECK,
      settings: HER,
      switches: HER_SWITCHES,
    });
    if (!result.ok) throw new Error('setup day did not add up');
    const book = result.book;
    const atSetup = book.selfCheck(withPendingCharges(EXAMPLE_7_POSTED, EXAMPLE_7_PENDING));
    book.receive(arrived('landed', '2026-10-02', parseDollars('200.00'), 'checking', 'second-card'));
    const landed = book.selfCheck(withPendingCharges({ ...EXAMPLE_7_POSTED, secondCard: parseDollars('875.92') }, EXAMPLE_7_PENDING));
    return {
      'starting money': result.startingMoney,
      'in transit on setup day': atSetup.inTransit,
      'difference on setup day': atSetup.difference,
      'in transit after it lands': landed.inTransit,
      'difference after it lands': landed.difference,
      needs: book.pots().needs,
    };
  },
  9: () => {
    const book = herBook({ savings: parseDollars('1,000.00'), needs: parseDollars('500.00'), wants: parseDollars('250.00') });
    const bank = (checking: string, everyday: string, second: string) => ({ checking: parseDollars(checking), savings: parseDollars('1,000.00'), everydayCard: parseDollars(everyday), secondCard: parseDollars(second) });
    book.receive(sent('to-everyday', '2026-10-05', parseDollars('300.00'), 'checking', 'everyday-card'));
    book.receive(sent('to-second', '2026-10-05', parseDollars('300.00'), 'checking', 'second-card'));
    const bothLeft = book.selfCheck(bank('800.00', '300.00', '350.00'));
    book.receive(arrived('second-lands', '2026-10-06', parseDollars('300.00'), 'checking', 'second-card'));
    const secondLanded = book.selfCheck(bank('800.00', '300.00', '50.00'));
    book.receive(arrived('everyday-lands', '2026-10-07', parseDollars('300.00'), 'checking', 'everyday-card'));
    const bothLanded = book.selfCheck(bank('800.00', '0.00', '50.00'));
    if (bothLeft.difference !== 0) throw new Error('the check failed when both left');
    return {
      'in transit after both leave': bothLeft.inTransit,
      'in transit after the second lands': secondLanded.inTransit,
      'difference after the second lands': secondLanded.difference,
      'in transit after both land': bothLanded.inTransit,
      'difference after both land': bothLanded.difference,
      needs: book.pots().needs,
    };
  },
  10: () => {
    const book = herBook({ savings: parseDollars('2,000.00') });
    const statement: CardStatement = { card: 'second-card', closingDate: '2026-10-01', dueDate: '2026-10-26', statementBalance: parseDollars('812.40'), minimumPayment: parseDollars('35.00') };
    const paidBy = (day: IsoDate): Cents => book.cardPayments('second-card').filter((p) => daysBetween(p.date, day) >= 0).reduce((sum, p) => sum + p.amount, 0);
    const reminders = (day: IsoDate): Cents => cardNotices(day, statement, book.cardPayments('second-card'), HER).filter((n) => n.kind === 'reminder').length * 100;
    book.receive(transfer('minimum', '2026-10-10', parseDollars('35.00'), 'checking', 'second-card'));
    const first = { paid: paidBy('2026-10-19'), reminders: reminders('2026-10-19') };
    book.receive(transfer('most', '2026-10-20', parseDollars('777.39'), 'checking', 'second-card'));
    const second = { paid: paidBy('2026-10-24'), reminders: reminders('2026-10-24') };
    book.receive(transfer('last-cent', '2026-10-24', parseDollars('0.01'), 'checking', 'second-card'));
    return {
      'paid by the first reminder': first.paid,
      'reminders on the first reminder day': first.reminders,
      'paid by the second reminder': second.paid,
      'reminders on the second reminder day': second.reminders,
      'still to pay on the second reminder day': statement.statementBalance - second.paid,
      'reminders after the last cent': reminders('2026-10-24'),
    };
  },
  11: () => {
    const book = herCardsMonth();
    const owes = (card: 'everyday-card' | 'second-card'): Cents => cardOwes(book, card, owedAtSetup(EXAMPLE_11_SETUP, card));
    const capitalOne = owes('everyday-card');
    const onItsWay = owes('second-card');
    book.receive(arrived('lands', '2026-10-11', parseDollars('500.00'), 'checking', 'second-card', 'sends'));
    const aside = setAside(book, { 'everyday-card': owedAtSetup(EXAMPLE_11_SETUP, 'everyday-card'), 'second-card': owedAtSetup(EXAMPLE_11_SETUP, 'second-card') }, parseDollars('6,300.00'));
    return {
      'capital one card owes': capitalOne,
      'amex card owes while the payment is on its way': onItsWay,
      'amex card owes once it lands': owes('second-card'),
      'all set aside': aside.total,
      'in savings': aside.inSavings ?? -1,
    };
  },
  12: () => {
    const book = herCardsMonth();
    book.receive(purchase('movie', '2026-10-12', parseDollars('18.00'), 'MADE UP CINEMA', { account: 'everyday-card' }));
    book.sort('movie', { to: 'wants' }, '2026-10-12');
    book.receive(purchase('new-place', '2026-10-20', parseDollars('30.00'), 'MADE UP NEW PLACE', { account: 'everyday-card' }));
    book.receive(refund('back', '2026-10-22', parseDollars('5.00'), 'groceries'));
    book.receive(purchase('next', '2026-11-01', parseDollars('9.99'), 'MADE UP SHOP', { account: 'everyday-card' }));
    const before: CardStatement = { card: 'everyday-card', closingDate: '2026-09-30', dueDate: '2026-10-25', statementBalance: parseDollars('435.58'), minimumPayment: parseDollars('35.00') };
    const view = cardStatementView({ statement: { ...before, closingDate: '2026-10-31', dueDate: '2026-11-25', statementBalance: parseDollars('117.17') }, before, book });
    const group = (bucket: string): Cents => view.byBucket.find((g) => g.bucket === bucket)?.total ?? 0;
    return {
      'carried in': view.carriedIn.amount,
      needs: group('needs'),
      wants: group('wants'),
      'still unsorted': group('unsorted'),
      'before setup day': group('before-setup'),
      'not matched': view.notMatched,
    };
  },
  13: () => {
    const book = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: ZERO_POTS, settings: changeSettings(HER, { split: { savings: 40, needs: 30, wants: 20, wishlist: 10 } }), switches: HER_SWITCHES });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,345.67')));
    book.sort('pay', { to: 'paycheck' }, '2026-10-09');
    const split = book.paychecks()[0]?.split;
    if (split === undefined) throw new Error('no paycheck');
    return { savings: split.savings, needs: split.needs, wants: split.wants, wishlist: split.wishlist ?? -1, 'rounding to savings': split.detail.roundingToSavings };
  },
  14: () => {
    const { book, move } = example14();
    const wishlist = book.pots().wishlist ?? -1;
    const should = book.savingsTransfer(parseDollars('2,300.00')).shouldBeInSavings;
    const toMove = move(parseDollars('2,300.00'));
    book.receive(transfer('moves', '2026-10-05', parseDollars('129.99'), 'savings', 'checking'));
    return { wishlist, 'should be in savings': should, 'to move': toMove, 'safe to spend': book.safeToSpend('2026-10-05').amount, 'to move after she moves it': move(parseDollars('2,170.01')) };
  },
  15: () => {
    const { book, move } = example14();
    book.receive(transfer('moves', '2026-10-05', parseDollars('129.99'), 'savings', 'checking'));
    book.receive(refund('back', '2026-10-10', parseDollars('40.00'), 'headphones', 'second-card'));
    return { wishlist: book.pots().wishlist ?? -1, 'still to move into savings': book.savingsTransfer(parseDollars('2,170.01')).stillToMove, 'to move to checking': move(parseDollars('2,170.01')) };
  },
  16: () => {
    const book = herBook({ needs: parseDollars('500.00'), wants: parseDollars('200.00'), wishlist: parseDollars('300.00') });
    book.receive(purchase('big-box', '2026-10-04', parseDollars('250.00'), 'MADE UP BIG BOX', { account: 'everyday-card' }));
    book.sort('big-box', { split: [{ bucket: 'needs', amount: parseDollars('80.00') }, { bucket: 'wants', amount: parseDollars('45.50') }, { bucket: 'wishlist', amount: parseDollars('124.50') }] }, '2026-10-04');
    const p = book.pots();
    return { needs: p.needs, wants: p.wants, wishlist: p.wishlist ?? -1, 'safe to spend': book.safeToSpend('2026-10-04').amount };
  },
  17: () => {
    const book = herBook({ savings: parseDollars('2,000.00'), needs: parseDollars('500.00'), wants: parseDollars('200.00'), wishlist: parseDollars('300.00') });
    book.receive(deposit('in', '2026-10-03', parseDollars('25.00')));
    book.receive(purchase('out', '2026-10-03', parseDollars('60.00'), 'MADE UP NEW PLACE', { account: 'everyday-card' }));
    const before = book.appSide();
    const asked = book.moveMoney({ from: 'wishlist', to: 'wants', amount: parseDollars('50.00') }, '2026-10-03');
    if (asked.moved) throw new Error('a move out of Wishlist did not ask first');
    book.moveMoney({ from: 'wishlist', to: 'wants', amount: parseDollars('50.00'), confirmed: true }, '2026-10-03');
    return { 'app side': before, 'wishlist after the move': book.pots().wishlist ?? -1, 'wants after the move': book.pots().wants, 'app side after the move': book.appSide(), 'safe to spend': book.safeToSpend('2026-10-03').amount };
  },
};

// Example 14: savings 2,000.00, Wishlist 300.00 and wants 150.00; headphones
// on the Amex card sorted to Wishlist. move is 50.4's amount for what the
// savings account holds.
function example14(): { readonly book: Book; readonly move: (inSavings: Cents) => Cents } {
  const book = herBook({ savings: parseDollars('2,000.00'), wants: parseDollars('150.00'), wishlist: parseDollars('300.00') });
  book.receive(purchase('headphones', '2026-10-04', parseDollars('129.99'), 'MADE UP AUDIO', { account: 'second-card' }));
  book.sort('headphones', { to: 'wishlist' }, '2026-10-04');
  const amex = [{ closingDate: '2026-10-08', dueDate: '2026-11-03' }];
  const move = (inSavings: Cents): Cents => wishlistMove(book, { savingsAccountBalance: inSavings, statements: { 'second-card': amex }, today: '2026-10-09' })?.amount ?? -1;
  return { book, move };
}

// Examples 11 and 12: setup day with both cards owing, and charges still
// pending on each; then her first days on them.
const EXAMPLE_11_PENDING = [
  purchase('held-c1', '2026-09-30', parseDollars('23.40'), 'MADE UP DINER', { account: 'everyday-card', pending: true }),
  purchase('held-amex', '2026-09-30', parseDollars('61.07'), 'MADE UP PHARMACY', { account: 'second-card', pending: true }),
];
const EXAMPLE_11_SETUP = { bankBalances: { checking: parseDollars('2,140.55'), savings: parseDollars('6,300.00'), everydayCard: parseDollars('412.18'), secondCard: parseDollars('1,075.92') }, pendingCharges: EXAMPLE_11_PENDING };

function herCardsMonth(): Book {
  const book = openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: { ...ZERO_POTS, savings: parseDollars('6,000.00') }, settings: HER, switches: HER_SWITCHES, countedAtSetup: EXAMPLE_11_PENDING });
  book.receive(purchase('groceries', '2026-10-02', parseDollars('48.27'), 'MADE UP GROCER', { account: 'everyday-card' }));
  book.sort('groceries', { to: 'needs' }, '2026-10-02');
  book.receive(posted('held-c1-posted', 'held-c1', '2026-10-03', parseDollars('25.90'), 'MADE UP DINER'));
  book.sort('held-c1', { to: 'needs' }, '2026-10-03');
  book.receive(transfer('pays-c1', '2026-10-08', parseDollars('435.58'), 'checking', 'everyday-card'));
  book.receive(purchase('amex-buy', '2026-10-04', parseDollars('120.00'), 'MADE UP SHOP', { account: 'second-card' }));
  book.receive(refund('amex-back', '2026-10-06', parseDollars('20.00'), 'amex-buy', 'second-card'));
  book.receive(sent('sends', '2026-10-09', parseDollars('500.00'), 'checking', 'second-card'));
  return book;
}

// Example 7's bank: posted balances, and the charges still pending.
const EXAMPLE_7_POSTED = { checking: parseDollars('2,140.55'), savings: parseDollars('6,300.00'), everydayCard: parseDollars('412.18'), secondCard: parseDollars('1,075.92') };
const EXAMPLE_7_PENDING = [
  purchase('debit', '2026-09-30', parseDollars('15.00'), 'MADE UP DINER', { account: 'checking', pending: true }),
  purchase('everyday', '2026-09-30', parseDollars('23.40'), 'MADE UP GROCER', { account: 'everyday-card', pending: true }),
  purchase('second', '2026-09-30', parseDollars('61.07'), 'MADE UP PHARMACY', { account: 'second-card', pending: true }),
];

describe('worked examples, her setup (worked-examples-h.txt)', () => {
  const all = readExamples();

  it('every example in the file has a test, and every test has an example', () => {
    expect(all.map((e) => e.number)).toEqual(Object.keys(examples).map(Number));
  });

  for (const example of all) {
    it(`Example ${example.number}: ${example.title}`, () => {
      const run = examples[example.number];
      expect(run, `no test for example ${example.number}`).toBeDefined();
      const actual = run?.() ?? {};
      for (const [name, expected] of example.checks) {
        expect(actual[name], `"${name}" in example ${example.number}`).toBe(expected);
      }
    });
  }
});

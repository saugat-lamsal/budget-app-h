// Every example in worked-examples-h.txt (her setup) is also a test. The
// expected numbers come from the "Check:" line in the text file itself, as
// in worked-examples.test.ts, so the file checked by hand and the test can
// never drift apart.
import { describe, expect, it } from 'vitest';
import { HER_SETTINGS, HER_SWITCHES, bankSide, cardNotices, changeSettings, daysBetween, openBook, parseDollars, startTracking, withPendingCharges, type Book, type CardStatement, type Cents, type IsoDate } from '../src/index.js';
import text from '../worked-examples-h.txt?raw';
import { LAST_PAYCHECK, PAYROLL, START_DATE, ZERO_POTS, arrived, deposit, paycheck, purchase, sent, transfer } from './helpers.js';

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
function herBook(pots: Partial<Record<keyof typeof ZERO_POTS, Cents>> = {}): Book {
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
};

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

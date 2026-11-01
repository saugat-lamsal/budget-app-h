// Every example in worked-examples.txt is also a test. The expected numbers
// come from the "Check:" line in the text file itself, so the file you
// check by hand and the test can never drift apart.
import { describe, expect, it } from 'vitest';
import { cardStanding, checkAssignment, nextPayday, parseDollars, payoffCountdown, startTracking, startingMoney, withPendingCharges, type Book, type Cents } from '../src/index.js';
import text from '../worked-examples.txt?raw';
import { describeFailure, liveALife } from './sim/life.js';
import { PAY_PERIOD, PAY_PERIOD_SEED } from './sim/pay-period.js';
import { MOM_NAME, TEST_SETTINGS, appSide, arrived, cardCharge, deposit, dropped, openTestBook, payPerson, paycheck, pendingChanged, posted, purchase, refund, sent, takenBack, transfer, withdrawal } from './helpers.js';

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
  };
}

// Each example, set up in code exactly as the text describes it.
const examples: Record<number, () => Record<string, Cents>> = {
  1: () => {
    const book = openTestBook();
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,345.67')));
    return buckets(book);
  },
  2: () => {
    const book = openTestBook({ pots: { momReserve: parseDollars('2,600.00') } });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('3,000.00')));
    return buckets(book);
  },
  3: () => {
    const book = openTestBook({ pots: { momReserve: parseDollars('2,000.00') } });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('1,200.00')));
    return buckets(book);
  },
  4: () => {
    const book = openTestBook({
      pots: { needs: parseDollars('85.20'), wants: parseDollars('-12.50'), momReserve: parseDollars('3,000.00') },
    });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,800.00')));
    book.answerLeftover('leftover:pay:needs', 'move-to-savings', '2026-10-09');
    return { ...buckets(book), 'still to move': book.savingsTransfer(parseDollars('3,000.00')).stillToMove };
  },
  5: () => {
    const book = openTestBook({
      pots: { needs: parseDollars('750.00'), wants: parseDollars('500.00') },
      rules: [
        { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
        { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
      ],
    });
    book.receive(purchase('dinner', '2026-10-05', parseDollars('40.00'), 'MADE UP CAFE', { pending: true }));
    book.receive(posted('dinner-posted', 'dinner', '2026-10-07', parseDollars('48.00'), 'MADE UP CAFE'));
    book.receive(purchase('hardware', '2026-10-06', parseDollars('120.00'), 'MADE UP HARDWARE'));
    book.sort('hardware', { split: [{ bucket: 'needs', amount: parseDollars('100.00') }, { bucket: 'wants', amount: parseDollars('20.00') }] }, '2026-10-06');
    book.receive(purchase('lunch', '2026-10-08', parseDollars('35.00'), 'MADE UP CAFE'));
    book.receive(refund('lunch-refund', '2026-10-09', parseDollars('35.00'), 'lunch'));
    book.receive(cardCharge('fee', '2026-10-10', parseDollars('29.00'), 'fee'));
    book.sort('fee', { to: 'needs' }, '2026-10-10');
    return buckets(book);
  },
  6: () => {
    const book = openTestBook({
      pots: { savings: parseDollars('1,000.00'), needs: parseDollars('900.00'), momReserve: parseDollars('500.00') },
      oldCardDebt: parseDollars('3,000.00'),
    });
    book.receive(transfer('pay-card', '2026-10-05', parseDollars('450.00'), 'checking', 'everyday-card'));
    book.receive(transfer('to-savings', '2026-10-05', parseDollars('600.00'), 'checking', 'savings'));
    book.receive(transfer('pay-old', '2026-10-06', parseDollars('200.00'), 'checking', 'old-card'));
    book.receive(cardCharge('interest', '2026-10-07', parseDollars('35.50'), 'interest', 'old-card'));
    book.receive(purchase('subscription', '2026-10-08', parseDollars('12.99'), 'MADE UP STREAMING', { account: 'old-card' }));
    return {
      ...buckets(book),
      'old card debt': book.oldCardDebt(),
      'still to move': book.savingsTransfer(parseDollars('900.00') + parseDollars('600.00')).stillToMove,
    };
  },
  7: () => {
    const book = openTestBook({ pots: { momReserve: parseDollars('2,800.00') } });
    book.receive(deposit('tax', '2026-10-05', parseDollars('2,000.01'), 'MADE UP TAX REFUND'));
    book.sort('tax', { to: 'other-income' }, '2026-10-05');
    book.receive(deposit('friend', '2026-10-06', parseDollars('25.00'), 'MADE UP FRIEND'));
    book.sort('friend', { to: 'wants' }, '2026-10-06');
    book.receive(deposit('roommate', '2026-10-07', parseDollars('60.00'), 'MADE UP ROOMMATE'));
    book.sort('roommate', { to: 'not-mine' }, '2026-10-07');
    return buckets(book);
  },
  8: () => {
    const book = openTestBook({ pots: { wants: parseDollars('200.00') } });
    book.receive(deposit('roommate', '2026-10-05', parseDollars('90.00'), 'MADE UP ROOMMATE'));
    book.sort('roommate', { to: 'not-mine' }, '2026-10-05');
    book.receive(payPerson('landlord', '2026-10-06', parseDollars('90.00'), 'MADE UP LANDLORD'));
    book.sort('landlord', { to: 'not-mine' }, '2026-10-06');
    book.receive(payPerson('ticket', '2026-10-07', parseDollars('45.00'), 'MADE UP TICKETS'));
    book.sort('ticket', { to: 'wants' }, '2026-10-07');
    book.receive(deposit('payback', '2026-10-08', parseDollars('45.00'), 'MADE UP FRIEND'));
    book.sort('payback', { to: 'wants' }, '2026-10-08');
    book.receive(payPerson('package', '2026-10-09', parseDollars('30.00'), 'MADE UP COURIER'));
    book.sort('package', { to: 'not-mine' }, '2026-10-09');
    return buckets(book);
  },
  9: () => {
    const book = openTestBook({
      pots: { momReserve: parseDollars('1,500.00'), needs: parseDollars('600.00') },
      settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } },
    });
    book.receive(payPerson('mom1', '2026-10-03', parseDollars('1,000.00'), MOM_NAME));
    book.receive(paycheck('pay', '2026-10-09', parseDollars('4,000.00')));
    book.receive(payPerson('mom2', '2026-10-20', parseDollars('2,500.00'), MOM_NAME));
    book.sort('mom2:difference', { to: 'needs' }, '2026-10-20');
    return { ...buckets(book), 'sent this month': book.momSentInMonth('2026-10').sent };
  },
  10: () => {
    const book = openTestBook({
      lastPaycheckDate: '2026-10-09',
      pots: {
        savings: parseDollars('2,000.00'),
        needs: parseDollars('500.00'),
        wants: parseDollars('300.00'),
        momReserve: parseDollars('1,500.00'),
        heldForOthers: parseDollars('60.00'),
      },
    });
    book.receive(purchase('hardware', '2026-10-12', parseDollars('45.00'), 'MADE UP HARDWARE'));
    book.receive(deposit('gift', '2026-10-13', parseDollars('200.00'), 'MADE UP GIFT'));
    const safe = book.safeToSpend('2026-10-14');
    if (safe.daysToPayday !== 9 || safe.nextPayday !== '2026-10-23') throw new Error(`days to payday: ${JSON.stringify(safe)}`);
    return { ...buckets(book), 'safe to spend': safe.amount };
  },
  11: () => {
    const book = openTestBook({
      lastPaycheckDate: '2026-10-09',
      oldCardDebt: parseDollars('2,900.00'),
      pots: {
        savings: parseDollars('2,000.00'),
        needs: parseDollars('500.00'),
        wants: parseDollars('300.00'),
        momReserve: parseDollars('1,500.00'),
        heldForOthers: parseDollars('60.00'),
      },
    });
    book.receive(purchase('hardware', '2026-10-12', parseDollars('45.00'), 'MADE UP HARDWARE', { pending: true }));
    book.receive(deposit('gift', '2026-10-13', parseDollars('200.00'), 'MADE UP GIFT'));
    const posted = { checking: parseDollars('1,200.00'), savings: parseDollars('3,500.00'), everydayCard: parseDollars('140.00') };
    const bank = withPendingCharges(posted, [{ account: 'everyday-card', amount: parseDollars('45.00') }]);
    const check = book.selfCheck(bank);
    const afterFee = book.checkedSafeToSpend('2026-10-15', { ...bank, checking: parseDollars('1,190.00') });
    if (afterFee.ok) throw new Error('safe to spend should not be shown when the totals do not match');
    return { 'app side': check.appSide, 'bank side': check.bankSide, difference: check.difference, 'difference after the fee': afterFee.difference };
  },
  12: () => {
    const book = openTestBook({
      pots: { savings: parseDollars('1,000.00'), needs: parseDollars('400.00'), wants: parseDollars('250.00') },
      settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } },
    });
    book.changeSettings({ split: { savings: 60, needs: 25, wants: 15 } }, '2026-10-12');
    book.moveMoney({ from: 'wants', to: 'needs', amount: parseDollars('100.00') }, '2026-10-13');
    const asked = book.moveMoney({ from: 'savings', to: 'wants', amount: parseDollars('200.00') }, '2026-10-14');
    if (asked.moved) throw new Error('moving out of savings should ask first');
    book.moveMoney({ from: 'savings', to: 'wants', amount: parseDollars('200.00'), confirmed: true }, '2026-10-14');
    book.receive(paycheck('pay', '2026-10-23', parseDollars('3,000.00')));
    if (book.changeLog().length !== 3) throw new Error(`change log: ${JSON.stringify(book.changeLog())}`);
    return buckets(book);
  },
  13: () => {
    const bankBalances = { checking: parseDollars('2,500.00'), savings: parseDollars('4,000.00'), everydayCard: parseDollars('300.00') };
    const pendingCharges = [purchase('dinner', '2026-10-05', parseDollars('45.00'), 'MADE UP CAFE', { pending: true })];
    const input = {
      date: '2026-10-06',
      bankBalances,
      pendingCharges,
      oldCardBalance: parseDollars('2,900.00'),
      lastPaycheckDate: '2026-09-25',
      settings: TEST_SETTINGS,
    };
    const assignment = {
      savings: parseDollars('4,000.00'),
      needs: parseDollars('1,000.00'),
      wants: parseDollars('500.00'),
      momReserve: parseDollars('600.00'),
      heldForOthers: parseDollars('50.00'),
    };
    const first = startTracking({ ...input, assignment });
    if (first.ok) throw new Error('the first try should not start');
    const second = startTracking({ ...input, assignment: { ...assignment, heldForOthers: parseDollars('55.00') } });
    if (!second.ok) throw new Error('the second try should start');
    const book = second.book;
    book.receive(posted('dinner-posted', 'dinner', '2026-10-07', parseDollars('52.00'), 'MADE UP CAFE'));
    book.sort('dinner', { to: 'wants' }, '2026-10-07');
    return { ...buckets(book), 'old card debt': book.oldCardDebt(), 'left to assign on the first try': first.difference };
  },
  14: () => {
    const book = openTestBook({
      oldCardDebt: parseDollars('2,000.00'),
      pots: { savings: parseDollars('2,000.00'), needs: parseDollars('500.00'), wants: parseDollars('300.00'), momReserve: parseDollars('1,500.00') },
    });
    book.receive(sent('card', '2026-10-12', parseDollars('600.00'), 'checking', 'everyday-card'));
    book.receive(sent('old', '2026-10-12', parseDollars('150.00'), 'checking', 'old-card'));
    const onItsWay = { checking: parseDollars('1,050.00'), savings: parseDollars('3,500.00'), everydayCard: parseDollars('1,000.00') };
    const whileOnItsWay = book.selfCheck(onItsWay);
    const shown = book.checkedSafeToSpend('2026-10-12', onItsWay);
    if (!shown.ok) throw new Error('safe to spend should be shown while the payment is on its way');
    book.receive(arrived('card-landed', '2026-10-14', parseDollars('600.00'), 'checking', 'everyday-card', 'card'));
    book.receive(arrived('old-landed', '2026-10-14', parseDollars('150.00'), 'checking', 'old-card', 'old'));
    const afterItLands = book.selfCheck({ ...onItsWay, everydayCard: parseDollars('400.00') });
    return {
      ...buckets(book),
      'in transit while on its way': whileOnItsWay.inTransit,
      'difference while on its way': whileOnItsWay.difference,
      'difference after it lands': afterItLands.difference,
      'old card debt': book.oldCardDebt(),
      'safe to spend': shown.safeToSpend.amount,
    };
  },
  15: () => {
    const book = openTestBook({
      lastPaycheckDate: '2026-09-25',
      pots: { savings: parseDollars('500.00'), needs: parseDollars('200.00'), wants: parseDollars('100.00'), momReserve: parseDollars('1,000.00') },
    });
    book.receive(deposit('new-job', '2026-10-02', parseDollars('2,000.00'), 'MADE UP NEW EMPLOYER'));
    book.sort('new-job', { to: 'paycheck' }, '2026-10-02');
    if (book.safeToSpend('2026-10-02').nextPayday !== '2026-10-16') throw new Error('the pay schedule should count from Oct 2');
    book.answerLeftover('leftover:new-job:needs', 'roll-over', '2026-10-02');
    book.answerLeftover('leftover:new-job:wants', 'move-to-savings', '2026-10-02');
    if (book.receive(paycheck('bonus', '2026-10-06', parseDollars('300.00'))).outcome !== 'review') throw new Error('4 days after a paycheck goes to review');
    book.sort('bonus', { to: 'other-income' }, '2026-10-06');
    if (book.safeToSpend('2026-10-06').nextPayday !== '2026-10-16') throw new Error('other income does not move the pay schedule');
    return buckets(book);
  },
  16: () => {
    const book = openTestBook({
      pots: { needs: parseDollars('50.00'), wants: parseDollars('-20.00') },
      settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } },
      rules: [
        { id: 'needs', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
        { id: 'wants', for: 'purchase', contains: 'FUN', bucket: 'wants' },
      ],
    });
    const found: Record<string, Cents> = {};
    const take = (): void => {
      const bankBalances = { checking: appSide(book.pots()), savings: 0, everydayCard: 0 };
      for (const alert of book.takeAlerts({ bankConnection: 'ok', bankBalances })) {
        if (alert.kind === 'low-bucket' || alert.kind === 'empty-bucket') {
          const name = `${alert.bucket} ${alert.kind === 'low-bucket' ? 'low' : 'empty'} alert at`;
          if (name in found) throw new Error(`${name} came twice`);
          found[name] = alert.amount;
        }
      }
    };
    book.receive(paycheck('pay', '2026-10-09', parseDollars('4,000.00')));
    const started = book.startedPeriodWith();
    take();
    for (const [id, amount, what] of [
      ['groceries', '640.00', 'MADE UP GROCER'],
      ['charge', '0.01', 'MADE UP GROCER'],
      ['concert', '385.00', 'MADE UP FUN'],
      ['dinner', '95.00', 'MADE UP FUN'],
    ] as const) {
      book.receive(purchase(id, '2026-10-10', parseDollars(amount), what));
      take();
    }
    return { ...buckets(book), 'needs started with': started.needs, 'wants started with': started.wants, ...found };
  },
  17: () => {
    // The test book's last paycheck is Sep 25.
    const book = openTestBook({ oldCardDebt: parseDollars('3,000.00'), settings: { oldCardPromoEndDate: '2027-01-10' } });
    const first = payoffCountdown(book, '2026-10-06');
    book.changeSettings({ oldCardPromoEndDate: '2027-01-01' }, '2026-10-06');
    const onPayday = payoffCountdown(book, '2026-10-06');
    const ended = payoffCountdown(book, '2027-01-02');
    if (!first.on || !onPayday.on || !ended.on) throw new Error('the countdown should be on');
    return {
      'per payday': first.perPayday,
      'last payment': first.owed - (first.paydaysLeft - 1) * first.perPayday,
      'with the end on a payday': onPayday.perPayday,
      'with no paydays left': ended.perPayday,
    };
  },
  18: () => {
    const book = openTestBook({ pots: { needs: parseDollars('500.00') }, rules: [{ id: 'gas', for: 'purchase', contains: 'MADE UP GAS', bucket: 'needs' }] });
    book.receive(purchase('hold', '2026-10-05', parseDollars('100.00'), 'MADE UP GAS', { pending: true }));
    book.receive(dropped('drop', 'hold', '2026-10-07'));
    book.receive(purchase('gas', '2026-10-07', parseDollars('42.17'), 'MADE UP GAS'));
    return buckets(book);
  },
  19: () => {
    const book = openTestBook({ pots: { wants: parseDollars('300.00') }, rules: [{ id: 'bistro', for: 'purchase', contains: 'MADE UP BISTRO', bucket: 'wants' }] });
    book.receive(purchase('dinner', '2026-10-05', parseDollars('48.00'), 'MADE UP BISTRO', { pending: true }));
    book.receive(pendingChanged('tip', 'dinner', '2026-10-06', parseDollars('57.60')));
    book.receive(posted('dinner-posted', 'dinner', '2026-10-08', parseDollars('57.60'), 'MADE UP BISTRO'));
    return buckets(book);
  },
  20: () => {
    const book = openTestBook({
      pots: { savings: parseDollars('2,000.00'), needs: parseDollars('400.00'), momReserve: parseDollars('800.00') },
      rules: [{ id: 'utility', for: 'purchase', contains: 'MADE UP UTILITY', bucket: 'needs' }],
    });
    book.receive(withdrawal('bill', '2026-10-05', parseDollars('120.35'), 'MADE UP UTILITY'));
    book.sort('bill', { to: 'needs' }, '2026-10-05');
    book.moveMoney({ from: 'savings', to: 'needs', amount: parseDollars('120.35'), confirmed: true }, '2026-10-05');
    book.receive(payPerson('mom', '2026-10-06', parseDollars('300.00'), MOM_NAME, 'savings'));
    return buckets(book);
  },
  21: () => {
    const book = openTestBook({ pots: { wants: parseDollars('200.00') }, rules: [{ id: 'cinema', for: 'purchase', contains: 'MADE UP CINEMA', bucket: 'wants' }] });
    book.receive(purchase('tickets', '2026-10-05', parseDollars('31.50'), 'MADE UP CINEMA', { account: 'checking' }));
    book.receive(purchase('copy', '2026-10-05', parseDollars('31.50'), 'MADE UP CINEMA', { account: 'checking' }));
    book.receive(takenBack('fix', 'copy', '2026-10-07'));
    const alerts = book.takeAlerts({ bankConnection: 'ok', bankBalances: { checking: appSide(book.pots()), savings: 0, everydayCard: 0 } });
    const taken = alerts.reduce((sum, a) => sum + (a.kind === 'bank-took-back' ? a.amount : 0), 0);
    return { ...buckets(book), 'taken back': taken };
  },
  22: () => {
    const book = openTestBook({ pots: { needs: parseDollars('500.00') } });
    book.receive(purchase('out', '2026-10-05', parseDollars('250.00'), 'ONLINE BANKING TRANSFER', { account: 'checking' }));
    book.sort('out', { transfer: 'savings' }, '2026-10-05');
    const afterFirst = book.inTransit().total;
    book.receive(deposit('in', '2026-10-06', parseDollars('250.00'), 'ONLINE BANKING TRANSFER', 'savings'));
    book.sort('in', { transfer: 'checking' }, '2026-10-06');
    return { ...buckets(book), 'in transit after the first half': afterFirst, 'in transit': book.inTransit().total };
  },
  23: () => {
    const book = openTestBook({ pots: { needs: parseDollars('400.00'), wants: parseDollars('150.00'), momReserve: parseDollars('250.00') } });
    book.receive(payPerson('aunt', '2026-10-05', parseDollars('300.00'), 'MADE UP AUNT'));
    book.sort('aunt', { to: 'mom' }, '2026-10-05');
    book.sort('aunt:difference', { to: 'needs' }, '2026-10-05');
    book.receive(payPerson('friend', '2026-10-06', parseDollars('90.00'), 'MADE UP FRIEND'));
    book.sort(
      'friend',
      {
        split: [
          { bucket: 'wants', amount: parseDollars('30.00') },
          { bucket: 'needs', amount: parseDollars('15.00') },
          { bucket: 'not-mine', amount: parseDollars('45.00') },
        ],
      },
      '2026-10-06',
    );
    return { ...buckets(book), 'sent to mom': book.momSentInMonth('2026-10').sent };
  },
  24: () => {
    const book = openTestBook({
      pots: { savings: parseDollars('1,000.00'), needs: parseDollars('300.00'), wants: parseDollars('120.00'), momReserve: parseDollars('3,000.00') },
      rules: [{ id: 'cafe', for: 'purchase', contains: 'MADE UP CAFE', bucket: 'wants' }],
      settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'ask' } },
    });
    // Friday Oct 9 is payday; Thursday's cafe charge shows up on Saturday.
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,000.00')));
    book.receive(purchase('late', '2026-10-08', parseDollars('45.00'), 'MADE UP CAFE'));
    const before = book.pots().savings;
    book.answerLeftover('leftover:pay:wants', 'move-to-savings', '2026-10-10');
    return { ...buckets(book), 'moved to savings': book.pots().savings - before };
  },
  25: () => {
    const book = openTestBook({ pots: { needs: parseDollars('400.00'), wants: parseDollars('200.00') } });
    book.receive(purchase('home', '2026-10-05', parseDollars('90.00'), 'MADE UP HOME STORE'));
    book.sort('home', { split: [{ bucket: 'needs', amount: parseDollars('60.00') }, { bucket: 'wants', amount: parseDollars('30.00') }] }, '2026-10-05');
    book.receive(refund('back', '2026-10-07', parseDollars('90.00'), undefined, 'everyday-card'));
    book.sort('back', { refundOf: 'home' }, '2026-10-07');
    return buckets(book);
  },
  26: () => {
    const book = openTestBook({ pots: { momReserve: parseDollars('500.00') } });
    book.receive(payPerson('first', '2026-10-05', parseDollars('40.00'), 'MADE UP FRIEND'));
    book.receive(payPerson('second', '2026-10-05', parseDollars('40.00'), 'MADE UP FRIEND'));
    book.receive(refund('some-back', '2026-10-06', parseDollars('10.00'), 'second', 'checking'));
    book.sortAlways('first', { to: 'mom' }, { id: 'friend-for-mom', contains: 'MADE UP FRIEND' }, '2026-10-06');
    return { ...buckets(book), 'sent to mom': book.momSentInMonth('2026-10').sent };
  },
  27: () => {
    const rules = [
      { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
      { id: 'gas', for: 'purchase', contains: 'GAS', bucket: 'needs' },
    ] as const;
    const book = openTestBook({ pots: { needs: parseDollars('500.00'), wants: parseDollars('200.00') }, rules });
    book.receive(purchase('grocery', '2026-10-02', parseDollars('32.50'), 'MADE UP GROCERY'));
    book.receive(purchase('gas', '2026-10-08', parseDollars('40.00'), 'MADE UP GAS', { pending: true }));
    book.receive(paycheck('pay', '2026-10-09', parseDollars('4,000.00')));
    book.answerLeftover('leftover:pay:needs', 'roll-over', '2026-10-09');
    book.answerLeftover('leftover:pay:wants', 'roll-over', '2026-10-09');
    book.receive(posted('gas-posted', 'gas', '2026-10-10', parseDollars('42.00'), 'MADE UP GAS'));
    book.sort('grocery', { to: 'wants' }, '2026-10-12');
    book.moveMoney({ from: 'wants', to: 'needs', amount: parseDollars('5.00') }, '2026-10-12');
    const old = book.activity('needs', 0);
    const now = book.activity('needs');
    // The list, newest first (B99).
    expect(now.rows.map((r) => r.id)).toEqual(['move:1', 'pay', 'gas', 'grocery']);
    return {
      'before payday carried in': old.opening,
      'before payday went out': old.out,
      'before payday now': old.closing,
      'carried in': now.opening,
      'came in': now.in,
      'went out': now.out,
      now: now.closing,
    };
  },
  28: () => {
    const book = openTestBook({ pots: { savings: parseDollars('1,000.00'), needs: parseDollars('100.00'), wants: parseDollars('50.00'), momReserve: parseDollars('500.00') } });
    const total = (): Cents => appSide(book.pots());
    const day = '2026-10-05';
    expect(book.moveMoney({ from: 'wants', to: 'needs', amount: parseDollars('25.00') }, day)).toEqual({ moved: true });
    // Out of savings asks first, and until he says yes nothing moves.
    expect(book.moveMoney({ from: 'savings', to: 'needs', amount: parseDollars('75.00') }, day)).toEqual({ moved: false, needsConfirmation: true, reasons: ['out-of-savings'] });
    expect(book.pots().needs).toBe(parseDollars('125.00'));
    expect(book.moveMoney({ from: 'savings', to: 'needs', amount: parseDollars('75.00'), confirmed: true }, day)).toEqual({ moved: true });
    // Leaving exactly zero asks nothing; one cent more would leave it below zero, and asks.
    expect(book.moveMoney({ from: 'needs', to: 'wants', amount: parseDollars('200.00') }, day)).toEqual({ moved: true });
    expect(book.moveMoney({ from: 'needs', to: 'wants', amount: 1 }, day)).toEqual({ moved: false, needsConfirmation: true, reasons: ['below-zero'] });
    expect(book.pots().needs).toBe(0);
    expect(book.moveMoney({ from: 'momReserve', to: 'savings', amount: parseDollars('100.00') }, day)).toEqual({ moved: false, needsConfirmation: true, reasons: ['out-of-mom-reserve'] });
    expect(book.moveMoney({ from: 'momReserve', to: 'savings', amount: parseDollars('100.00'), confirmed: true }, day)).toEqual({ moved: true });
    // Moving money never changes how much there is.
    expect(total()).toBe(parseDollars('1,650.00'));
    return buckets(book);
  },
  29: () => {
    const book = openTestBook({ pots: { momReserve: parseDollars('2,900.00'), needs: parseDollars('120.00'), wants: parseDollars('45.50') } });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,345.67')));
    const report = book.paydayReport();
    const paid = report.paycheck!;
    const d = paid.split.detail;
    // What payday asked: needs 120.00 and wants 45.50.
    expect(report.leftovers.map((l) => [l.bucket, l.leftAtPayday, l.outcome])).toEqual([['needs', parseDollars('120.00'), 'waiting'], ['wants', parseDollars('45.50'), 'waiting']]);
    book.answerLeftover('leftover:pay:needs', 'roll-over', '2026-10-09');
    book.answerLeftover('leftover:pay:wants', 'move-to-savings', '2026-10-09');
    const after = book.paydayReport().leftovers;
    expect(after.map((l) => l.outcome)).toEqual(['kept', 'moved-to-savings']);
    const now = book.pots();
    return {
      'reserve taken': d.reserveTaken,
      'into reserve': paid.split.momReserve,
      'did not fit': d.overflowToSavings,
      'left to split': d.rest,
      'savings share': d.savingsShare,
      rounding: d.roundingToSavings,
      'to savings': paid.split.savings,
      'to needs': paid.split.needs,
      'to wants': paid.split.wants,
      'needs left at payday': report.leftovers[0]!.leftAtPayday,
      'wants moved': after[1]!.amount,
      'savings now': now.savings,
      'needs now': now.needs,
      'wants now': now.wants,
    };
  },
  30: () => {
    const book = openTestBook({ pots: { needs: parseDollars('650.00'), wants: parseDollars('300.00') } });
    book.receive(purchase('landlord', '2026-10-03', parseDollars('412.50'), 'MADE UP LANDLORD', { account: 'checking' }));
    book.sort('landlord', { transfer: 'old-card' }, '2026-10-03');
    const marked = book.pots();
    // The row on Needs' list offers what the purchase could be, and Wants makes it that purchase again.
    const offered = book.resortDetail('landlord');
    expect(offered).toMatchObject({ resortable: true, marked: 'old-card', options: { picks: [{ to: 'needs' }, { to: 'wants' }, { to: 'not-mine' }] } });
    book.sort('landlord', { to: 'wants' }, '2026-10-06');
    const undone = book.pots();
    book.sort('landlord', { transfer: 'old-card' }, '2026-10-07');
    return {
      'needs when marked': marked.needs,
      'wants when marked': marked.wants,
      'needs after undoing': undone.needs,
      'wants after undoing': undone.wants,
      'needs when marked again': book.pots().needs,
    };
  },
  31: () => {
    const book = openTestBook({ pots: { needs: parseDollars('500.00'), wants: parseDollars('200.00') }, rules: [{ id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' }] });
    book.receive(purchase('cafe', '2026-10-08', parseDollars('10.00'), 'MADE UP CAFE', { pending: true }));
    book.receive(paycheck('pay', '2026-10-09', parseDollars('4,000.00')));
    const atPayday = book.paydayReport().leftovers[1]!;
    expect(atPayday).toMatchObject({ outcome: 'waiting', lessSincePayday: 0 });
    book.receive(posted('cafe-posted', 'cafe', '2026-10-10', parseDollars('12.50'), 'MADE UP CAFE'));
    const asked = book.paydayReport().leftovers[1]!;
    book.answerLeftover('leftover:pay:wants', 'roll-over', '2026-10-11');
    const kept = book.paydayReport().leftovers[1]!;
    expect(kept.outcome).toBe('kept');
    return {
      'wants at payday': asked.leftAtPayday,
      'wants asked': asked.amount,
      'wants less since payday': asked.lessSincePayday,
      'wants kept': kept.amount,
      'wants kept less since payday': kept.lessSincePayday,
    };
  },
  32: () => {
    const book = openTestBook();
    book.receive(paycheck('pay1', '2026-10-09', parseDollars('3,000.00')));
    book.changeSettings({ split: { savings: 40, needs: 40, wants: 20 }, momReservePerPaycheck: parseDollars('1,000.00') }, '2026-10-12');
    // Settings shows both: this pay period's, and what comes from the next paycheck (13.1).
    expect(book.splitInForce()).toEqual({ split: { savings: 50, needs: 30, wants: 20 }, momReservePerPaycheck: parseDollars('1,500.00'), momReserveCap: parseDollars('3,000.00') });
    expect(book.settings()).toMatchObject({ split: { savings: 40, needs: 40, wants: 20 }, momReservePerPaycheck: parseDollars('1,000.00'), momReserveCap: parseDollars('3,000.00') });
    book.receive(deposit('side', '2026-10-13', parseDollars('200.00'), 'MADE UP SIDE JOB'));
    const needsBefore = book.pots().needs;
    book.sort('side', { to: 'other-income' }, '2026-10-13');
    const otherIncomeNeeds = book.pots().needs - needsBefore;
    book.receive(paycheck('pay2', '2026-10-23', parseDollars('3,000.00')));
    expect(book.splitInForce().split).toEqual({ savings: 40, needs: 40, wants: 20 });
    const [first, second] = book.paychecks();
    return {
      ...buckets(book),
      'first paycheck needs': first!.split.needs,
      'other income needs': otherIncomeNeeds,
      'second paycheck needs': second!.split.needs,
      'second paycheck mom reserve': second!.split.momReserve,
    };
  },
  33: () => {
    const book = openTestBook({
      pots: { savings: parseDollars('1,000.00'), needs: parseDollars('500.00'), wants: parseDollars('300.00') },
      settings: { paycheckRule: null, momRule: null, leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } },
    });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,500.00')));
    book.receive(payPerson('mom', '2026-10-10', parseDollars('300.00'), MOM_NAME));
    book.receive({ ...paycheck('bonus', '2026-10-12', parseDollars('400.00')), description: 'ACME PAYROLL BONUS' });
    expect(book.reviewItems().map((i) => i.id)).toEqual(['pay', 'mom', 'bonus']);
    const preview = book.previewSettingsChange({ paycheckRule: { contains: 'ACME PAYROLL' } }, '2026-10-13');
    expect(preview.items.map((i) => [i.id, i.kind])).toEqual([
      ['pay', 'paycheck'],
      ['bonus', 'early-paycheck'],
    ]);
    const paid = preview.items[0]!;
    if (paid.kind !== 'paycheck') throw new Error('expected a paycheck');
    book.changeSettings({ paycheckRule: { contains: 'ACME PAYROLL' } }, '2026-10-13');
    expect(book.pots()).toEqual(preview.potsAfter);
    expect(book.previewSettingsChange({ momRule: { contains: MOM_NAME } }, '2026-10-13').items).toMatchObject([{ id: 'mom', fromReserve: parseDollars('300.00'), difference: 0 }]);
    book.changeSettings({ momRule: { contains: MOM_NAME } }, '2026-10-13');
    return {
      ...buckets(book),
      'paycheck needs': paid.split.needs,
      'preview mom reserve': preview.potsAfter.momReserve,
      'preview savings': preview.potsAfter.savings,
      'preview needs': preview.potsAfter.needs,
      'preview wants': preview.potsAfter.wants,
      'preview unsorted money in': preview.potsAfter.unsortedIn,
      'preview unsorted spending': preview.potsAfter.unsortedOut,
    };
  },
  34: () => {
    const book = openTestBook({ pots: { momReserve: parseDollars('1,000.00') }, settings: { momRule: null } });
    book.receive(payPerson('mom1', '2026-10-06', parseDollars('40.00'), MOM_NAME));
    book.receive(refund('back', '2026-10-07', parseDollars('10.00'), 'mom1', 'checking'));
    const preview = book.previewSettingsChange({ momRule: { contains: MOM_NAME } }, '2026-10-08');
    expect(preview.items).toMatchObject([{ kind: 'still-waiting', id: 'mom1' }]);
    const { rechecked } = book.changeSettings({ momRule: { contains: MOM_NAME } }, '2026-10-08');
    expect(rechecked).toEqual(preview.items);
    const afterRule = book.pots();
    const still = book.reviewItems().find((i) => i.id === 'mom1');
    book.receive(payPerson('mom2', '2026-10-09', parseDollars('25.00'), MOM_NAME));
    return {
      ...buckets(book),
      'still waiting': still?.amount ?? -1,
      'reserve after the rule': afterRule.momReserve,
      'in your buckets after the rule': appSide(afterRule),
      'in your buckets': appSide(book.pots()),
    };
  },
  35: () => {
    const book = openTestBook({ pots: { savings: parseDollars('1,000.00'), needs: parseDollars('500.00') }, oldCardDebt: parseDollars('2,980.00') });
    book.receive(withdrawal('water', '2026-10-05', parseDollars('64.10'), 'BILL PAY WATER UTILITY'));
    book.sort('water', { transfer: 'old-card' }, '2026-10-06');
    book.sort('water', { to: 'savings' }, '2026-10-06');
    const marked = book.pots();
    expect(book.resortDetail('water')).toMatchObject({ resortable: true, options: { unmark: true } });
    book.sort('water', { unmark: true }, '2026-10-07');
    const unmarked = book.pots();
    const owes = book.oldCardDebt();
    book.sort('water', { to: 'needs' }, '2026-10-07');
    book.moveMoney({ from: 'savings', to: 'needs', amount: parseDollars('64.10'), confirmed: true }, '2026-10-07');
    return {
      ...buckets(book),
      'savings when marked': marked.savings,
      'savings after unmarking': unmarked.savings,
      'unsorted spending after unmarking': unmarked.unsortedOut,
      'old card owes': owes,
    };
  },
  36: () => {
    const book = openTestBook({
      pots: { needs: parseDollars('500.00'), wants: parseDollars('300.00') },
      rules: [
        { id: 'store', for: 'purchase', contains: 'STORE', bucket: 'needs' },
        { id: 'big', for: 'purchase', contains: 'BIG STORE', bucket: 'wants' },
      ],
    });
    book.receive(purchase('a', '2026-10-05', parseDollars('40.00'), 'MADE UP BIG STORE'));
    book.moveRule('big', 'up', '2026-10-05');
    book.receive(purchase('b', '2026-10-06', parseDollars('25.00'), 'MADE UP BIG STORE'));
    book.receive(purchase('c', '2026-10-06', parseDollars('10.00'), 'MADE UP CORNER STORE'));
    expect(book.rules().map((r) => r.id)).toEqual(['big', 'store']);
    expect(book.changeLog()).toMatchObject([{ kind: 'rule-moved', direction: 'up', position: 1 }]);
    return buckets(book);
  },
  37: () => {
    const d = parseDollars;
    const bank = { checking: d('3,214.56'), savings: d('8,000.00'), everydayCard: d('612.48') };
    const pending = [
      purchase('grocery', '2026-10-06', d('86.43'), 'GROCERY OUTLET #12', { account: 'checking', pending: true }),
      { ...withdrawal('water', '2026-10-06', d('64.10'), 'BILL PAY WATER UTILITY'), pending: true },
      purchase('gas', '2026-10-06', d('41.20'), 'CORNER GAS STATION', { pending: true }),
      purchase('coffee', '2026-10-07', d('6.25'), 'BLUE DOOR COFFEE', { pending: true }),
      purchase('hardware', '2026-10-05', d('19.99'), 'MADE UP HARDWARE', { account: 'old-card', pending: true }),
    ];
    const onItsWay = [
      sent('card', '2026-10-06', d('300.00'), 'checking', 'everyday-card'),
      arrived('landed', '2026-10-07', d('150.00'), 'checking', 'savings'),
      sent('old', '2026-10-05', d('200.00'), 'checking', 'old-card'),
    ];
    const money = startingMoney(bank, pending, onItsWay);
    const assign = (needs: string) => ({ savings: d('8,000.00'), momReserve: d('1,200.00'), wants: d('400.00'), heldForOthers: 0, needs: d(needs) });
    const input = { date: '2026-10-07', bankBalances: bank, pendingCharges: pending, transfersInTransit: onItsWay, oldCardBalance: d('2,980.00'), lastPaycheckDate: '2026-10-02', settings: TEST_SETTINGS };
    const short = startTracking({ ...input, assignment: assign('954.09') });
    const result = startTracking({ ...input, assignment: assign('954.10') });
    if (short.ok || !result.ok) throw new Error('example 37 did not start as it says');
    const book = result.book;
    const withPending = withPendingCharges(bank, pending);
    const check = book.selfCheck(withPending);
    expect(check.ok).toBe(true);
    expect(nextPayday('2026-10-02', TEST_SETTINGS.payScheduleDays, '2026-10-07')).toEqual({ nextPayday: '2026-10-16', daysToPayday: 9 });
    return {
      ...buckets(book),
      'starting money': money,
      'bank side': check.bankSide,
      'in transit': check.inTransit,
      'old card debt': book.oldCardDebt(),
      'one cent short left': short.difference,
      'left to assign': checkAssignment(money, assign('954.10')).leftToAssign,
      'safe to spend': book.safeToSpend('2026-10-07').amount,
      'still to move': book.savingsTransfer(withPending.savings).stillToMove,
    };
  },
  38: () => {
    const d = parseDollars;
    const bank = { checking: d('412.30'), savings: d('150.00'), everydayCard: d('2,318.77') };
    const money = startingMoney(bank, []);
    const result = startTracking({
      date: '2026-10-07',
      bankBalances: bank,
      pendingCharges: [],
      oldCardBalance: 0,
      assignment: { savings: d('150.00'), needs: d('-1,500.00'), wants: d('-406.47'), momReserve: 0, heldForOthers: 0 },
      lastPaycheckDate: '2026-10-02',
      settings: TEST_SETTINGS,
    });
    if (!result.ok) throw new Error('example 38 did not start');
    expect(result.book.selfCheck(bank).ok).toBe(true);
    return { ...buckets(result.book), 'starting money': money, 'safe to spend': result.book.safeToSpend('2026-10-07').amount };
  },
  39: () => {
    const d = parseDollars;
    const book = openTestBook({ pots: { needs: d('500.00'), wants: d('300.00') } });
    book.receive(purchase('tent', '2026-10-03', d('120.00'), 'MADE UP OUTDOOR SHOP'));
    expect(book.reviewItems()).toHaveLength(1);
    expect(book.safeToSpend('2026-10-03').amount).toBe(d('180.00'));
    book.receive(refund('back', '2026-10-06', d('120.00'), 'tent'));
    expect(book.reviewItems()).toHaveLength(0);
    const refunded = { unsorted: book.pots().unsortedOut, safe: book.safeToSpend('2026-10-06').amount };
    book.receive(takenBack('reversed', 'back', '2026-10-09'));
    expect(book.reviewItems()).toHaveLength(1);
    const reversed = { unsorted: book.pots().unsortedOut, safe: book.safeToSpend('2026-10-09').amount };
    book.sort('tent', { to: 'wants' }, '2026-10-10');
    return {
      ...buckets(book),
      'refunded unsorted spending': refunded.unsorted,
      'refunded safe to spend': refunded.safe,
      'taken back unsorted spending': reversed.unsorted,
      'taken back safe to spend': reversed.safe,
      'safe to spend': book.safeToSpend('2026-10-10').amount,
    };
  },
  40: () => {
    const d = parseDollars;
    const shoes = (refunded: Cents): Book => {
      const book = openTestBook({ pots: { needs: d('525.00'), wants: d('305.00') } });
      book.receive(purchase('groceries', '2026-10-01', d('25.00'), 'CORNER GROCER', { account: 'checking' }));
      book.sort('groceries', { to: 'needs' }, '2026-10-01');
      book.receive(purchase('coffee', '2026-10-01', d('5.00'), 'BLUE DOOR CAFE', { account: 'checking' }));
      book.sort('coffee', { to: 'wants' }, '2026-10-01');
      expect(book.pots()).toMatchObject({ needs: d('500.00'), wants: d('300.00') });
      book.receive(purchase('shoes', '2026-10-02', d('90.00'), 'MADE UP SHOE STORE', { account: 'checking' }));
      book.sort('shoes', { split: [{ bucket: 'needs', amount: d('60.00') }, { bucket: 'wants', amount: d('30.00') }] }, '2026-10-02');
      book.receive(deposit('back', '2026-10-06', refunded, 'MADE UP SHOE STORE REFUND'));
      expect(book.pots().unsortedIn).toBe(refunded);
      expect(book.reviewDetails().find((r) => r.item.id === 'back')?.likelyPurchases).toMatchObject([{ id: 'shoes', sameName: true }]);
      book.sort('back', { refundOf: 'shoes' }, '2026-10-06');
      return book;
    };
    const full = shoes(d('90.00'));
    const partial = shoes(d('10.00'));
    expect(partial.reviewItems()).toMatchObject([{ id: 'shoes', reason: 'split-changed' }]);
    return {
      'full needs': full.pots().needs,
      'full wants': full.pots().wants,
      'full unsorted money in': full.pots().unsortedIn,
      'partial needs': partial.pots().needs,
      'partial wants': partial.pots().wants,
      'partial unsorted spending': partial.pots().unsortedOut,
      'partial safe to spend': partial.safeToSpend('2026-10-06').amount,
    };
  },
  41: () => {
    // The planned pay period, lived by the simulator with all its checks.
    const at: Record<string, Record<string, Cents>> = {};
    const result = liveALife({
      seed: PAY_PERIOD_SEED,
      years: 0,
      plan: PAY_PERIOD,
      record: {
        setupDay: () => undefined,
        day: () => undefined,
        endOfDay: ({ date, book }) => {
          const needs = book.paydayReport().leftovers.find((l) => l.bucket === 'needs');
          at[date] = { ...buckets(book), appSide: book.appSide(), debt: book.oldCardDebt(), needsQuestion: needs?.amount ?? -1 };
        },
      },
    });
    if (!result.ok) throw new Error(describeFailure(result, 0));
    const day = (date: string): Record<string, Cents> => at[date] ?? {};
    return {
      'starting money': day('2026-10-01')['appSide'] ?? -1,
      'first payday savings': day('2026-10-02')['savings'] ?? -1,
      'first payday needs': day('2026-10-02')['needs'] ?? -1,
      'first payday wants': day('2026-10-02')['wants'] ?? -1,
      'lowered needs question': day('2026-10-03')['needsQuestion'] ?? -1,
      'after the questions savings': day('2026-10-03')['savings'] ?? -1,
      'after the questions wants': day('2026-10-03')['wants'] ?? -1,
      'last savings': day('2026-10-16')['savings'] ?? -1,
      'last needs': day('2026-10-16')['needs'] ?? -1,
      'last wants': day('2026-10-16')['wants'] ?? -1,
      'last mom reserve': day('2026-10-16')['mom reserve'] ?? -1,
      'old card debt': day('2026-10-16')['debt'] ?? -1,
    };
  },

  42: () => {
    const twice = { paySchedule: 'twice-a-month', payScheduleDays: 14 } as const;
    expect(nextPayday('2026-10-15', twice, '2026-10-16')).toEqual({ nextPayday: '2026-10-30', daysToPayday: 14 });
    expect(nextPayday('2026-10-29', twice, '2026-10-29').nextPayday).toBe('2026-11-13');
    const share = (paySchedule: 'twice-a-month' | 'every-n-days') => {
      const book = openTestBook({ date: '2026-10-15', lastPaycheckDate: '2026-10-15', oldCardDebt: 234_567, settings: { paySchedule, oldCardPromoEndDate: '2027-01-10' } });
      const countdown = payoffCountdown(book, '2026-10-16');
      return countdown.on ? countdown.perPayday : -1;
    };
    return { 'twice a month share': share('twice-a-month'), 'every fourteen days share': share('every-n-days') };
  },

  43: () => {
    const book = openTestBook({ pots: { needs: 100_000, wants: 50_000 } });
    book.receive(deposit('cash', '2026-10-05', 20_000, 'MADE UP ATM DEPOSIT'));
    book.sort('cash', { to: 'not-mine' }, '2026-10-05');
    const afterDeposit = book.pots().heldForOthers;
    book.receive(withdrawal('sent', '2026-10-06', 20_000, 'MADE UP ZELLE PAYMENT'));
    book.sort('sent', { to: 'not-mine' }, '2026-10-06');
    const afterSending = book.pots().heldForOthers;
    book.receive(withdrawal('dinner', '2026-10-07', 8_500, 'MADE UP ZELLE PAYMENT'));
    book.sort('dinner', { split: [{ bucket: 'wants', amount: 1_500 }, { bucket: 'not-mine', amount: 7_000 }] }, '2026-10-07');
    const pots = book.pots();
    return { 'held after the deposit': afterDeposit, 'held after sending it on': afterSending, 'last needs': pots.needs, 'last wants': pots.wants, 'last held': pots.heldForOthers };
  },

  44: () => {
    const statement = { card: 'everyday-card', closingDate: '2026-10-05', dueDate: '2026-11-01', statementBalance: 25_000, minimumPayment: 2_500 } as const;
    const some = [{ date: '2026-10-10', amount: 10_000 }];
    const all = [{ date: '2026-10-10', amount: 25_000 }];
    const before = cardStanding('2026-10-10', statement, []);
    expect(before).toMatchObject({ daysLeft: 22, standing: 'to-pay' });
    expect(cardStanding('2026-10-10', statement, some).standing).toBe('to-pay');
    expect(cardStanding('2026-10-10', statement, all).standing).toBe('paid');
    expect(cardStanding('2026-11-02', statement, some).standing).toBe('minimum-paid');
    expect(cardStanding('2026-11-02', statement, []).standing).toBe('overdue');
    return { 'statement balance': before.statementBalance ?? -1, minimum: before.minimumPayment, 'paid in part': cardStanding('2026-10-10', statement, some).paid };
  },

  45: () => {
    const book = openTestBook({ pots: { needs: 100_000, wants: 50_000 } });
    book.receive(withdrawal('sent', '2026-10-05', 12_500, 'MADE UP ZELLE PAYMENT'));
    book.sort('sent', { to: 'not-mine' }, '2026-10-05');
    const afterSending = book.pots().heldForOthers;
    book.receive(deposit('cash', '2026-10-08', 14_000, 'MADE UP ATM DEPOSIT'));
    book.sort('cash', { split: [{ bucket: 'not-mine', amount: 12_500 }, { bucket: 'wants', amount: 1_500 }] }, '2026-10-08');
    const pots = book.pots();
    return { 'other after sending it on': afterSending, 'other after the deposit': pots.heldForOthers, 'last wants': pots.wants, 'last needs': pots.needs };
  },

  46: () => {
    const book = openTestBook({ pots: { needs: 100_000, wants: 50_000 } });
    const safe = book.safeToSpend('2026-10-05').amount;
    book.receive(purchase('tickets', '2026-10-05', 8_000, 'MADE UP TICKETS', { account: 'everyday-card' }));
    book.sort('tickets', { to: 'not-mine' }, '2026-10-05');
    const afterBuying = book.pots().heldForOthers;
    const unchanged = book.safeToSpend('2026-10-05').amount;
    expect(unchanged).toBe(safe);
    book.receive(deposit('back', '2026-10-09', 8_000, 'MADE UP FRIEND'));
    book.sort('back', { to: 'not-mine' }, '2026-10-09');
    return { 'other after buying': afterBuying, 'other after being paid back': book.pots().heldForOthers, 'safe to spend': unchanged };
  },
};

describe('worked examples (worked-examples.txt)', () => {
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

// Rule 9.3 (her rulebook, 60i; docs/her-questions.txt HA9, his answer of
// Oct 27, 2026): a payment that reached a card after its statement date and
// before setup day counts toward that statement, read from the bank history
// the app keeps by today's bank rules. Found in her rehearsal on the test
// bank: the books start on setup day, so a statement she had already paid
// showed "$0.00 paid", the reminders kept coming, and after its due date the
// overdue alert would have come every evening. Both setups. Every name,
// number and date is made up.
import type { Book, CardStatement } from '@budget-app/money';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestBook } from '../../money/test/helpers.js';
import { NO_ALERTS, applyAlerts, nextAlertsEvent, stillTrueNow, type AlertLedger, type AlertWorld } from '../src/alerts/plan.js';
import { cardPaymentsSeen, paidBeforeSetup, type PaidBeforeSetup } from '../src/bank/paid-before-setup.js';
import { checkBankRules } from '../src/bank/reading.js';
import { HER_START } from '../src/setup-start.js';
import type { StoredItem } from '../src/sync/plan.js';
import { ACCOUNT_IDS, type FakePlaid } from './fake-plaid.js';
import { HER_BANK_RULES, setUpHer } from './her-harness.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;
const SECOND = ACCOUNT_IDS.second;

// ----- Reading the history -----

function stored(id: string, accountId: string, amount: number, date: string, description: string, more: Partial<StoredItem> = {}): [string, StoredItem] {
  return [
    id,
    {
      transactionId: id,
      accountId,
      raw: { transaction_id: id, account_id: accountId, amount: amount / 100, iso_currency_code: 'USD', unofficial_currency_code: null, date, authorized_date: null, pending: false, pending_transaction_id: null, name: description },
      pending: false,
      amountCents: amount,
      removed: false,
      status: 'history',
      kind: null,
      bookId: null,
      replacedBy: null,
      firstSync: 1,
      lastSync: 1,
      ...more,
    },
  ];
}

const ROLES = new Map([
  [C, 'checking'],
  [E, 'everyday-card'],
  [ACCOUNT_IDS.old, 'old-card'],
  [SECOND, 'second-card'],
] as const);
const RULES = checkBankRules([
  ...HER_BANK_RULES,
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'old-paid-1', account: 'old-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);

describe('9.3 payments from before setup day, from the history the app keeps', () => {
  it('9.3 a credit on a card that a bank rule reads as a transfer from checking is a payment, dated the day it posted', () => {
    const items = new Map([stored('paid-1', E, -45_000, '2026-09-25', 'PAYMENT - THANK YOU'), stored('paid-2', SECOND, -1, '2026-09-26', 'PAYMENT - THANK YOU')]);
    expect(paidBeforeSetup(items, ROLES, RULES)).toEqual({
      'everyday-card': [{ date: '2026-09-25', amount: 45_000, landedOn: '2026-09-25' }],
      'second-card': [{ date: '2026-09-26', amount: 1, landedOn: '2026-09-26' }],
    });
  });

  it('9.3 the old card\'s too (upstream\'s setup)', () => {
    const items = new Map([stored('paid-old', ACCOUNT_IDS.old, -6_000, '2026-09-27', 'PAYMENT - THANK YOU')]);
    expect(paidBeforeSetup(items, ROLES, RULES)).toEqual({ 'old-card': [{ date: '2026-09-27', amount: 6_000, landedOn: '2026-09-27' }] });
  });

  it('9.3 by today\'s bank rules: a credit no bank rule names is a refund, not a payment; a purchase is not one either', () => {
    const items = new Map([stored('refund-1', E, -2_500, '2026-09-25', 'MADE UP SHOP REFUND'), stored('shop-1', E, 2_500, '2026-09-24', 'MADE UP SHOP')]);
    expect(paidBeforeSetup(items, ROLES, RULES)).toEqual({});
    // The same credit, once a bank rule names it, is a payment.
    const named = checkBankRules([...RULES, { id: 'shop-pays', account: 'everyday-card', contains: 'MADE UP SHOP REFUND', means: 'transfer', other: 'savings' }]);
    expect(paidBeforeSetup(items, ROLES, named)).toEqual({ 'everyday-card': [{ date: '2026-09-25', amount: 2_500, landedOn: '2026-09-25' }] });
  });

  it('9.3 only the history: an item the books have (after setup day), one still pending, one the bank removed, and one on checking are not read', () => {
    const items = new Map([
      stored('sent-1', E, -1_000, '2026-10-02', 'PAYMENT - THANK YOU', { status: 'sent' }),
      stored('pending-1', E, -1_000, '2026-09-29', 'PAYMENT - THANK YOU', { pending: true }),
      stored('removed-1', E, -1_000, '2026-09-28', 'PAYMENT - THANK YOU', { removed: true }),
      stored('left-1', C, 1_000, '2026-09-28', 'payment to CRD 3333'),
      stored('unpicked-1', 'acct-not-picked', -1_000, '2026-09-28', 'PAYMENT - THANK YOU'),
    ]);
    expect(paidBeforeSetup(items, ROLES, RULES)).toEqual({});
  });

  it('9.3 the payments seen are the books\' and the history\'s together, oldest first', () => {
    const book = openTestBook({ date: '2026-10-01' });
    book.receive({ kind: 'transfer', id: 't1', from: 'checking', to: 'everyday-card', date: '2026-10-03', amount: 2_000, description: 'PAYMENT' });
    const before: PaidBeforeSetup = { 'everyday-card': [{ date: '2026-09-25', amount: 45_000, landedOn: '2026-09-25' }] };
    expect(cardPaymentsSeen(book, 'everyday-card', before)).toEqual([
      { date: '2026-09-25', amount: 45_000, landedOn: '2026-09-25' },
      { date: '2026-10-03', amount: 2_000, landedOn: '2026-10-03' },
    ]);
    expect(cardPaymentsSeen(book, 'everyday-card', undefined)).toEqual([{ date: '2026-10-03', amount: 2_000, landedOn: '2026-10-03' }]);
    expect(cardPaymentsSeen(book, 'old-card', before)).toEqual([]);
  });
});

// ----- On the real server's books -----

let lives: Life[] = [];
afterEach(() => {
  for (const life of lives) life.done();
  lives = [];
});

const SECOND_CARD_RULES = checkBankRules([
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);

// Her statement on the everyday card: closed Sep 20, due Oct 15, 450.00;
// she paid it in full before setup day (Oct 1). Reminder days: Oct 8 and Oct 13.
const PAID_STATEMENT = { is_overdue: false, last_payment_amount: null, last_payment_date: null, last_statement_issue_date: '2026-09-20', last_statement_balance: 450, minimum_payment_amount: 35, next_payment_due_date: '2026-10-15' };

function paidBefore(landed: string, amount = 45_000): (fake: FakePlaid) => void {
  return (fake) => {
    fake.setStatement(E, PAID_STATEMENT);
    fake.addPosted({ id: 'pay-c', account: C, amount, date: landed, description: 'payment to CRD 3333' });
    fake.addPosted({ id: 'paid-e', account: E, amount: -amount, date: landed, description: 'PAYMENT - THANK YOU' });
  };
}

async function her(history: (fake: FakePlaid) => void): Promise<Life> {
  const life = await lifeInAFile({ herSetup: true, secondCard: 25_000, rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]), start: HER_START, history });
  lives.push(life);
  setUpHer(life);
  return life;
}

async function day(life: Life, date: string): Promise<void> {
  life.now = noonInNewYork(date);
  await life.sync();
}

function tracking(life: Life) {
  const home = life.keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  return home;
}

const cardLines = (life: Life) => tracking(life).attention.filter((a) => a.kind === 'card-due' || a.kind === 'card-overdue').map((a) => [a.kind, 'card' in a ? a.card : null]);
const everydayRow = (life: Life) => tracking(life).cards?.cards.find((c) => c.card === 'everyday-card')?.statement;

describe('9.3 9.6 52.1 a statement paid before setup day, on her books', () => {
  it('9.3 52.1 Home\'s card row counts it as paid toward the statement, and 9.6 no due line comes on the reminder days', async () => {
    const life = await her(paidBefore('2026-09-25'));
    await day(life, '2026-10-08');
    expect(everydayRow(life)).toMatchObject({ closingDate: '2026-09-20', paid: 45_000, state: { kind: 'paid' } });
    expect(cardLines(life)).toEqual([]);
  });

  it('9.4 9.6 after the due date it is not overdue', async () => {
    const life = await her(paidBefore('2026-09-25'));
    await day(life, '2026-10-16');
    expect(everydayRow(life)).toMatchObject({ paid: 45_000, state: { kind: 'paid' } });
    expect(cardLines(life)).toEqual([]);
  });

  it('9.3 9.4 paid less than the minimum before setup day: it counts, and the card is still due, then overdue', async () => {
    const life = await her(paidBefore('2026-09-25', 1_000));
    await day(life, '2026-10-08');
    expect(everydayRow(life)).toMatchObject({ paid: 1_000, state: { kind: 'due', daysLeft: 7 } });
    await day(life, '2026-10-16');
    expect(cardLines(life)).toEqual([['card-overdue', 'everyday-card']]);
  });

  it('9.3 B28 one that landed on the statement date counts toward the statement before, not this one; the day after counts', async () => {
    const onTheDay = await her(paidBefore('2026-09-20'));
    await day(onTheDay, '2026-10-08');
    expect(everydayRow(onTheDay)).toMatchObject({ paid: 0, state: { kind: 'due' } });
    expect(cardLines(onTheDay)).toEqual([['card-due', 'everyday-card']]);
    const dayAfter = await her(paidBefore('2026-09-21'));
    await day(dayAfter, '2026-10-08');
    expect(everydayRow(dayAfter)).toMatchObject({ paid: 45_000, state: { kind: 'paid' } });
  });

  it('9.3 9.7 no reminder is kept for it on the evening of a reminder day; the other card\'s still comes', async () => {
    const life = await her((fake) => {
      paidBefore('2026-09-25')(fake);
      fake.setStatement(SECOND, { ...PAID_STATEMENT, last_statement_balance: 250 });
    });
    await day(life, '2026-10-08');
    life.keeper.checkAlerts();
    // 8:30 PM in New York.
    life.now = new Date('2026-10-09T00:30:00Z');
    life.keeper.checkAlerts();
    expect(life.keeper.toSend().map((a) => a.id)).toEqual(['card-reminder second-card due 2026-10-15 7 days before']);
  });
});

describe('9.3 a statement paid before setup day, in upstream\'s setup', () => {
  it('9.3 9.6 upstream\'s Home has no due line for it either', async () => {
    const life = await lifeInAFile({ history: paidBefore('2026-09-25') });
    lives.push(life);
    setUpThroughTheDesk(life);
    await day(life, '2026-10-08');
    expect(cardLines(life)).toEqual([]);
  });
});

// ----- The alerts, from what is known at one moment -----

describe('9.4 9.7 10.9 the reminders and the overdue alert count it too', () => {
  const statement: CardStatement = { card: 'everyday-card', closingDate: '2026-09-20', dueDate: '2026-10-15', statementBalance: 45_000, minimumPayment: 3_500 };
  const PAID: PaidBeforeSetup = { 'everyday-card': [{ date: '2026-09-25', amount: 45_000, landedOn: '2026-09-25' }] };

  function world(book: Book, now: string, extra: Partial<AlertWorld> = {}): AlertWorld {
    return { book, now: new Date(now), zone: 'America/New_York', bank: null, needsLogin: false, statements: [statement], lastRead: null, ...extra };
  }

  function look(w: AlertWorld, ledger: AlertLedger): { readonly keys: string[]; readonly ledger: AlertLedger } {
    const keys: string[] = [];
    for (let next = nextAlertsEvent(w, ledger); next !== null; next = nextAlertsEvent(w, ledger)) {
      keys.push(...next.given.map((g) => g.key));
      ledger = applyAlerts(ledger, next);
    }
    return { keys, ledger };
  }

  // 8:00 PM in New York on each day from Oct 8 to Oct 17.
  const evenings = Array.from({ length: 10 }, (_, i) => `2026-10-${String(9 + i).padStart(2, '0')}T00:00:00Z`);

  function cardKeys(extra: Partial<AlertWorld>): string[] {
    const book = openTestBook({ date: '2026-10-01' });
    let ledger = look(world(book, '2026-10-08T16:00:00Z', extra), NO_ALERTS).ledger;
    const keys: string[] = [];
    for (const now of evenings) {
      const l = look(world(book, now, extra), ledger);
      ledger = l.ledger;
      keys.push(...l.keys.filter((k) => k.startsWith('card')));
    }
    return keys;
  }

  it('9.4 without it, the reminders and the overdue alert come (as before)', () => {
    expect(cardKeys({})).toEqual([
      'card-reminder everyday-card due 2026-10-15 7 days before',
      'card-reminder everyday-card due 2026-10-15 2 days before',
      'card-overdue everyday-card due 2026-10-15 on 2026-10-16',
      'card-overdue everyday-card due 2026-10-15 on 2026-10-17',
    ]);
  });

  it('9.3 9.4 with it, none comes', () => {
    expect(cardKeys({ paidBeforeSetup: PAID })).toEqual([]);
  });

  it('10.9 A40 a reminder kept before and not sent yet is no longer true once it counts', () => {
    const book = openTestBook({ date: '2026-10-01' });
    const facts = { kind: 'card-reminder', card: 'everyday-card', dueDate: '2026-10-15', daysBefore: 2, minimumPayment: 3_500, statementBalance: 45_000 } as const;
    const now = '2026-10-13T16:00:00Z';
    const ledger = look(world(book, '2026-10-13T15:00:00Z'), NO_ALERTS).ledger;
    expect(stillTrueNow(world(book, now), ledger, facts)).toBe(true);
    expect(stillTrueNow(world(book, now, { paidBeforeSetup: PAID }), ledger, facts)).toBe(false);
  });
});

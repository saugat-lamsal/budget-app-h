// Her rulebook, section 52 (PR 7+8) on the server: both cards on Home, with
// what is set aside for each (52.1, 52.2), reminders per card (52.3), each
// card's statement (52.4), and every statement the bank sends kept (52.5).
// Every name, number and date is made up.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HER_SETTINGS, HER_SWITCHES, changeSettings, openBook, type BankBalances, type Book, type CardStatement, type IsoDate, type OpenBookInput } from '@budget-app/money';
import { afterEach, describe, expect, it } from 'vitest';
import { keepStatement, keptStatements, statementKey } from '../src/bank/kept-statements.js';
import { checkBankRules } from '../src/bank/reading.js';
import { openDatabase } from '../src/db/database.js';
import { HER_SCHEMA_VERSION, HER_STEPS, hasHerSteps, migrateHer } from '../src/db/her-steps.js';
import { saveStatement } from '../src/db/store.js';
import { cardsNamed } from '../src/http/card-names.js';
import { HER_SCREEN_PATHS, ROUTES, SCREEN_PATHS, STATEMENT_CARDS, createAppServer } from '../src/http/server.js';
import type { PlaidCreditCard } from '../src/plaid/types.js';
import { HER_START } from '../src/setup-start.js';
import { homeView, type HomeInput } from '../src/views/home.js';
import { homeCards, withCards, type HomeCards } from '../src/views/home-cards.js';
import { statementScreenView } from '../src/views/statement.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { HER_BANK_RULES, setUpHer } from './her-harness.js';
import { choose, lifeInAFile, noonInNewYork, type Life } from './keeper-harness.js';

const E = ACCOUNT_IDS.everyday;
const SECOND = ACCOUNT_IDS.second;
const C = ACCOUNT_IDS.checking;

// ----- Home's card rows, from the view alone -----

const HER = changeSettings(HER_SETTINGS, { paycheckRule: { contains: 'MADE UP PAYROLL' } });
const POTS = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 };
const BANK: BankBalances = { checking: 110_000, savings: 100_000, everydayCard: 20_000, secondCard: 10_000 };
const AT_SETUP = { 'everyday-card': 20_000, 'second-card': 10_000 } as const;
const TODAY = '2026-10-20';

function herBook(input: Partial<OpenBookInput> = {}): Book {
  return openBook({ date: '2026-10-01', lastPaycheckDate: '2026-09-25', oldCardDebt: 0, pots: POTS, settings: HER, switches: HER_SWITCHES, ...input });
}

const statement = (card: 'everyday-card' | 'second-card', dueDate: IsoDate, balance = 20_000): CardStatement => ({ card, closingDate: '2026-10-05', dueDate, statementBalance: balance, minimumPayment: 3_500 });

function homeInput(book: Book, more: Partial<HomeInput> = {}): HomeInput {
  return { today: TODAY, book, bank: BANK, needsLogin: false, statements: [], madeUpData: false, seenTakeBacks: new Set(), lastChecked: null, ...more };
}

// Home as her server sends it: upstream's Home, with the cards added (as the keeper does).
function herHome(input: HomeInput) {
  if (input.book === null) throw new Error('no book');
  return withCards(homeView(input), homeCards({ atSetup: AT_SETUP }, input.today, input.book, input.bank, input.statements, input.cardsOff ?? []));
}

function cardsOf(input: HomeInput): HomeCards {
  const view = herHome(input);
  if (view.state !== 'tracking' || view.cards === undefined) throw new Error('no cards on Home');
  return view.cards;
}

describe('52.1 Home shows each card', () => {
  it('52.1 its statement balance and due date, what is paid toward it, what it owes now in all, and what is set aside', () => {
    const b = herBook();
    b.receive({ kind: 'transfer', id: 't1', from: 'checking', to: 'everyday-card', date: '2026-10-08', amount: 5_000, description: 'PAYMENT' });
    b.receive({ kind: 'purchase', id: 'p1', account: 'everyday-card', date: '2026-10-09', amount: 1_200, description: 'MADE UP SHOP', pending: false });
    const cards = cardsOf(homeInput(b, { bank: { ...BANK, checking: 105_000, everydayCard: 16_200 }, statements: [statement('everyday-card', '2026-10-30'), statement('second-card', '2026-11-25', 10_000)] }));
    expect(cards.cards[0]).toEqual({
      card: 'everyday-card',
      owes: 16_200,
      setAside: 16_200,
      statement: { shown: true, closingDate: '2026-10-05', dueDate: '2026-10-30', statementBalance: 20_000, minimumPayment: 3_500, paid: 5_000, state: { kind: 'not-due-yet' } },
    });
    expect(cards.cards[1]).toMatchObject({ card: 'second-card', owes: 10_000, setAside: 10_000, statement: { shown: true, paid: 0, state: { kind: 'not-due-yet' } } });
    expect(cards.total).toBe(26_200);
  });

  it('52.1 from the first reminder day it says due, after the due date overdue, and paid once all of it is paid', () => {
    const b = herBook();
    const due = (dueDate: IsoDate) => cardsOf(homeInput(b, { statements: [statement('everyday-card', dueDate)] })).cards[0]?.statement;
    // 7 days and 2 days before (section 2): due from 7 days before.
    expect(due('2026-10-28')).toMatchObject({ state: { kind: 'not-due-yet' } });
    expect(due('2026-10-27')).toMatchObject({ state: { kind: 'due', daysLeft: 7 } });
    expect(due('2026-10-20')).toMatchObject({ state: { kind: 'due', daysLeft: 0 } });
    expect(due('2026-10-19')).toMatchObject({ state: { kind: 'overdue' } });
    b.receive({ kind: 'transfer', id: 't1', from: 'checking', to: 'everyday-card', date: '2026-10-08', amount: 3_500, description: 'PAYMENT' });
    expect(due('2026-10-19')).toMatchObject({ paid: 3_500, state: { kind: 'minimum-paid' } });
    b.receive({ kind: 'transfer', id: 't2', from: 'checking', to: 'everyday-card', date: '2026-10-09', amount: 16_499, description: 'PAYMENT' });
    expect(due('2026-10-27')).toMatchObject({ paid: 19_999, state: { kind: 'due' } });
    b.receive({ kind: 'transfer', id: 't3', from: 'checking', to: 'everyday-card', date: '2026-10-10', amount: 1, description: 'PAYMENT' });
    expect(due('2026-10-27')).toMatchObject({ paid: 20_000, state: { kind: 'paid' } });
  });

  it('52.1 with the card\'s reminders off it says so instead, and with no statement yet, that', () => {
    const b = herBook();
    const cards = cardsOf(homeInput(b, { statements: [statement('everyday-card', '2026-10-30')], cardsOff: [{ card: 'second-card', why: 'no-statement-date' }] }));
    expect(cards.cards[1]?.statement).toEqual({ shown: false, why: 'no-statement-date' });
    // Reminders off wins over a statement it may still have (break-it: a card whose reminders are off showed a statement).
    const both = cardsOf(homeInput(b, { statements: [statement('second-card', '2026-10-30', 10_000)], cardsOff: [{ card: 'second-card', why: 'unreadable' }] }));
    expect(both.cards[1]?.statement).toEqual({ shown: false, why: 'unreadable' });
    expect(cardsOf(homeInput(b, { statements: [] })).cards.map((c) => c.statement)).toEqual([
      { shown: false, why: 'none-yet' },
      { shown: false, why: 'none-yet' },
    ]);
  });

  it('52.1 upstream\'s Home has no cards: the view is upstream\'s', () => {
    const view = homeView(homeInput(herBook()));
    expect(view.state === 'tracking' && 'cards' in view).toBe(false);
    expect(withCards(view, null)).toBe(view);
  });
});

describe('52.3 reminders per card', () => {
  it('52.3 each card\'s due line and overdue line are its own, 7 and 2 days before its own due date', () => {
    const b = herBook();
    const view = herHome(homeInput(b, { statements: [statement('everyday-card', '2026-10-22'), statement('second-card', '2026-10-15', 10_000)] }));
    if (view.state !== 'tracking') throw new Error('not tracking');
    expect(view.attention.filter((a) => a.kind === 'card-due' || a.kind === 'card-overdue').map((a) => [a.kind, 'card' in a ? a.card : null])).toEqual([
      ['card-overdue', 'second-card'],
      ['card-due', 'everyday-card'],
    ]);
    expect(view.cards?.cards.map((c) => c.statement.shown && c.statement.state.kind)).toEqual(['due', 'overdue']);
  });
});

// ----- On the real server's books -----

const SECOND_CARD_RULES = checkBankRules([
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);
// What the second card owes on setup day; the everyday card owes 450.00.
const SECOND_OWES = 25_000;

let lives: Life[] = [];
afterEach(() => {
  for (const life of lives) life.done();
  lives = [];
});

async function herWithTwoCards(): Promise<Life> {
  const life = await lifeInAFile({ herSetup: true, secondCard: SECOND_OWES, rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]), start: HER_START });
  lives.push(life);
  return life;
}

async function day(life: Life, date: string, items: () => void = () => undefined): Promise<void> {
  items();
  life.now = noonInNewYork(date);
  await life.sync();
}

const plaidStatement = (closing: string | null, due: string, balance: number, lastPayment: number | null = null): Omit<PlaidCreditCard, 'account_id'> => ({
  is_overdue: false,
  last_payment_amount: lastPayment,
  last_payment_date: null,
  last_statement_issue_date: closing,
  last_statement_balance: balance,
  minimum_payment_amount: 35,
  next_payment_due_date: due,
});

// Her month on the everyday card: the statement before (Sep 25, 450.00, what
// it owed on setup day), groceries, the payment, a refund, and the statement
// after (Oct 25).
async function herMonth(): Promise<Life> {
  const life = await herWithTwoCards();
  life.h.fake.setStatement(E, plaidStatement('2026-09-25', '2026-10-20', 450));
  life.h.fake.setStatement(SECOND, plaidStatement('2026-09-28', '2026-10-23', 250));
  await life.sync();
  setUpHer(life);
  await day(life, '2026-10-02', () => life.h.fake.addPosted({ id: 'grocery-1', account: E, amount: 6_412, date: '2026-10-02', description: 'MADE UP GROCERY' }));
  await day(life, '2026-10-09', () => {
    life.h.fake.addPosted({ id: 'pay-e', account: C, amount: 45_000, date: '2026-10-09', description: 'payment to CRD 3333' });
    life.h.fake.addPosted({ id: 'paid-e', account: E, amount: -45_000, date: '2026-10-09', description: 'PAYMENT - THANK YOU' });
    life.h.fake.addPosted({ id: 'cafe-1', account: E, amount: 1_250, date: '2026-10-09', description: 'MADE UP CAFE' });
  });
  for (const [item, choice] of [
    ['grocery-1', { to: 'needs' }],
    ['cafe-1', { to: 'wants' }],
  ] as const) {
    const answer = choose(life.keeper, { item, choice });
    if (!answer.ok) throw new Error(`${item}: ${answer.why}`);
  }
  await day(life, '2026-10-26', () => {
    life.h.fake.addPosted({ id: 'pharmacy-1', account: E, amount: 1_999, date: '2026-10-26', description: 'MADE UP PHARMACY' });
    life.h.fake.setStatement(E, plaidStatement('2026-10-25', '2026-11-20', 76.62));
  });
  return life;
}

function tracking(life: Life) {
  const home = life.keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  return home;
}

describe('52.2 set aside, on her books', () => {
  it('52.2 on setup day each card has set aside what it owed then; a purchase raises it and a payment that reached the card lowers it', async () => {
    const life = await herWithTwoCards();
    life.h.fake.addPending({ id: 'held-2', account: SECOND, amount: 1_250, date: '2026-10-01', description: 'MADE UP PHARMACY' });
    await life.sync();
    setUpHer(life);
    expect(tracking(life).cards?.cards.map((c) => [c.card, c.owes])).toEqual([
      ['everyday-card', 45_000],
      ['second-card', SECOND_OWES + 1_250],
    ]);
    await day(life, '2026-10-02', () => {
      life.h.fake.addPosted({ id: 'shop-1', account: E, amount: 2_000, date: '2026-10-02', description: 'MADE UP SHOP' });
      life.h.fake.addPosted({ id: 'pay-2', account: C, amount: 10_000, date: '2026-10-02', description: 'payment to CRD 5555' });
      life.h.fake.addPosted({ id: 'paid-2', account: SECOND, amount: -10_000, date: '2026-10-02', description: 'PAYMENT - THANK YOU' });
    });
    const home = tracking(life);
    expect(home.safeToSpend.shown).toBe(true);
    expect(home.cards?.cards.map((c) => [c.card, c.owes, c.setAside])).toEqual([
      ['everyday-card', 47_000, 47_000],
      ['second-card', SECOND_OWES + 1_250 - 10_000, SECOND_OWES + 1_250 - 10_000],
    ]);
    // The totals match the bank, so the set-aside total is what the bank says both cards owe.
    expect(home.cards?.total).toBe(life.h.fake.posted(E) + life.h.fake.posted(SECOND) + 1_250);
  });

  it('52.2 upstream\'s Home has no cards', async () => {
    const life = await lifeInAFile();
    lives.push(life);
    const k = life.keeper;
    for (const setup of [{ lastPaycheck: '2026-09-25' }, { assign: { pot: 'savings' as const, amount: 400_000 } }, { assign: { pot: 'needs' as const, rest: true as const } }]) k.setup({ id: `d-${JSON.stringify(setup)}`, setup });
    const view = k.setupView();
    if (view.state === 'not-set-up' && view.ready) k.setup({ id: 'start', setup: { start: true }, confirmed: true, seen: view.key });
    const home = k.home();
    expect(home.state).toBe('tracking');
    expect('cards' in home).toBe(false);
    expect(k.statement('everyday-card')).toEqual({ state: 'off' });
  });
});

describe('52.4 the statement, on her books', () => {
  it('52.4 the everyday card\'s statement: carried in less the payment, each purchase by its bucket, adding up with nothing not matched', async () => {
    const life = await herMonth();
    const view = life.keeper.statement('everyday-card');
    if (view.state !== 'ready') throw new Error(`no statement: ${JSON.stringify(view)}`);
    const s = view.statement;
    expect(s).toMatchObject({ card: 'everyday-card', closingDate: '2026-10-25', from: '2026-09-26', statementBalance: 7_662, charges: 7_662, notMatched: 0 });
    expect(s.carriedIn).toMatchObject({ kind: 'from-statement-before', before: 45_000, paymentsAndCredits: -45_000, amount: 0 });
    expect(s.byBucket.map((g) => [g.bucket, g.total, g.items.map((i) => i.id)])).toEqual([
      ['needs', 6_412, ['grocery-1']],
      ['wants', 1_250, ['cafe-1']],
    ]);
    // The pharmacy posted after the closing day: on the next one.
    expect(s.byPayPeriod.map((g) => (g.period === 'before-setup' ? 'before-setup' : g.period.startDate))).toEqual(['2026-10-01']);
  });

  it('52.4 the first statement the app sees says From before the app saw this card', async () => {
    const life = await herWithTwoCards();
    life.h.fake.setStatement(SECOND, plaidStatement('2026-09-28', '2026-10-23', 250));
    await life.sync();
    setUpHer(life);
    const view = life.keeper.statement('second-card');
    if (view.state !== 'ready') throw new Error('no statement');
    expect(view.statement.carriedIn).toEqual({ kind: 'before-the-app', amount: 25_000 });
    expect(view.statement.notMatched).toBe(0);
  });

  it('52.4 with no statement yet, or one that cannot be read for want of its closing day, it says so', async () => {
    const life = await herWithTwoCards();
    setUpHer(life);
    expect(life.keeper.statement('second-card')).toEqual({ state: 'no-statement', madeUpData: false, card: 'second-card', why: 'none-yet' });
    await day(life, '2026-10-02', () => life.h.fake.setStatement(SECOND, plaidStatement(null, '2026-10-23', 250)));
    expect(life.keeper.statement('second-card')).toMatchObject({ state: 'no-statement', why: 'no-statement-date' });
    // Once its closing day is set (9.8), it reads.
    const k = life.keeper;
    const asked = k.settingsChange({ id: 'closing', settings: { secondCardClosingDay: 28 } });
    if (!asked.ok && asked.code === 'needs-confirmation' && asked.preview !== undefined) k.settingsChange({ id: 'closing', settings: { secondCardClosingDay: 28 }, confirmed: true, seen: asked.preview.key });
    expect(life.keeper.statement('second-card')).toMatchObject({ state: 'ready', statement: { closingDate: '2026-09-28' } });
  });

  it('52.4 it only reads: the books and the database are the same after', async () => {
    const life = await herMonth();
    const home = JSON.stringify(life.keeper.home());
    // Read after Home, which notes the last checked safe to spend (0.5).
    const written = (): unknown => [life.h.db.prepare('SELECT COUNT(*) AS n FROM book_events').get(), life.h.db.prepare('SELECT total_changes() AS n').get()];
    const before = JSON.stringify(written());
    life.keeper.statement('everyday-card');
    life.keeper.statement('second-card');
    expect(JSON.stringify(written())).toBe(before);
    expect(JSON.stringify(life.keeper.home())).toBe(home);
  });

  it('52.4 purchases from before setup day, from the history the bank sent, are marked Before setup day', () => {
    const items = new Map(
      [
        { id: 'old-1', amount: 1_000, date: '2026-09-27', description: 'MADE UP GROCERY' },
        { id: 'old-2', amount: -5_000, date: '2026-09-28', description: 'PAYMENT - THANK YOU' },
      ].map((t) => [
        t.id,
        { transactionId: t.id, accountId: E, raw: { transaction_id: t.id, account_id: E, amount: t.amount / 100, iso_currency_code: 'USD', unofficial_currency_code: null, date: t.date, authorized_date: null, pending: false, pending_transaction_id: null, name: t.description }, pending: false, amountCents: t.amount, removed: false, status: 'history' as const, kind: null, bookId: null, replacedBy: null, firstSync: 1, lastSync: 1 },
      ]),
    );
    const view = statementScreenView({
      today: '2026-10-01',
      card: 'everyday-card',
      kept: [{ account_id: E, ...plaidStatement('2026-09-05', '2026-09-30', 100) }, { account_id: E, ...plaidStatement('2026-10-05', '2026-10-30', 60) }],
      closingDay: null,
      book: null,
      items,
      accountId: E,
      bankRules: HER_BANK_RULES,
      madeUpData: false,
    });
    if (view.state !== 'ready') throw new Error('no statement');
    expect(view.statement.carriedIn).toMatchObject({ before: 10_000, paymentsAndCredits: -5_000 });
    expect(view.statement.byBucket).toMatchObject([{ bucket: 'before-setup', total: 1_000 }]);
    expect(view.statement.notMatched).toBe(0);
  });
});

describe('52.5 each statement the bank sends is kept', () => {
  it('52.5 her setup keeps each one, by its statement date; the same one sent again with a change replaces it', async () => {
    const life = await herMonth();
    expect(keptStatements(life.h.db, E).map((s) => [s.last_statement_issue_date, s.last_statement_balance])).toEqual([
      ['2026-09-25', 450],
      ['2026-10-25', 76.62],
    ]);
    await day(life, '2026-10-27', () => life.h.fake.setStatement(E, plaidStatement('2026-10-25', '2026-11-20', 76.62, 10)));
    expect(keptStatements(life.h.db, E).map((s) => [s.last_statement_issue_date, s.last_payment_amount])).toEqual([
      ['2026-09-25', null],
      ['2026-10-25', 10],
    ]);
    // Kept after a restart, and the statement before is still known.
    life.restart({ start: HER_START });
    expect(life.keeper.statement('everyday-card')).toMatchObject({ state: 'ready', statement: { carriedIn: { kind: 'from-statement-before', before: 45_000 } } });
  });

  it('52.5 one with no statement date is told apart by its due date', () => {
    expect(statementKey({ account_id: E, ...plaidStatement(null, '2026-10-23', 250) })).toBe('due 2026-10-23');
    expect(statementKey({ account_id: E, ...plaidStatement('2026-09-28', '2026-10-23', 250) })).toBe('2026-09-28');
    expect(statementKey({ account_id: E, ...plaidStatement(null, '2026-10-23', 250), next_payment_due_date: null })).toBeNull();
  });

  it('52.5 upstream\'s database keeps none, and gets no table of hers', () => {
    const db = openDatabase(':memory:');
    keepStatement(db, E, { account_id: E, ...plaidStatement('2026-09-25', '2026-10-20', 450) }, 1);
    expect(hasHerSteps(db)).toBe(false);
    expect(keptStatements(db, E)).toEqual([]);
    db.close();
  });

  it('52.5 her step 3 starts from the statement each card already had', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE her_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
    for (const step of HER_STEPS.slice(0, 2)) db.exec(step);
    db.prepare('INSERT INTO her_schema (id, version) VALUES (1, 2)').run();
    saveStatement(db, E, JSON.stringify({ account_id: E, ...plaidStatement('2026-09-25', '2026-10-20', 450) }), 4);
    saveStatement(db, SECOND, JSON.stringify({ account_id: SECOND, ...plaidStatement(null, '2026-10-23', 250) }), 5);
    migrateHer(db);
    expect(db.prepare('SELECT version FROM her_schema').get()).toEqual({ version: HER_SCHEMA_VERSION });
    expect(db.prepare('SELECT plaid_account_id, statement_key, first_sync FROM her_statements ORDER BY plaid_account_id').all()).toEqual([
      { plaid_account_id: E, statement_key: '2026-09-25', first_sync: 4 },
      { plaid_account_id: SECOND, statement_key: 'due 2026-10-23', first_sync: 5 },
    ]);
    db.close();
  });
});

describe('52.4 the statement screen\'s address', () => {
  it('52.4 each card has its own, kept apart from upstream\'s screens, and every one needs a login', () => {
    expect(HER_SCREEN_PATHS).toEqual(['/statement/everyday-card', '/statement/second-card']);
    for (const path of HER_SCREEN_PATHS) expect(SCREEN_PATHS).not.toContain(path);
    for (const card of STATEMENT_CARDS) {
      expect(ROUTES).toContainEqual({ method: 'GET', path: `/statement/${card}`, login: true });
      expect(ROUTES).toContainEqual({ method: 'GET', path: `/api/statement/${card}`, login: true });
    }
  });

  it('52.4 the server answers it with the card\'s statement, named as its bank names it, and the screen with the app', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'budget-statement-'));
    const webRoot = join(folder, 'dist');
    mkdirSync(webRoot, { recursive: true });
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
    const asked: string[] = [];
    const names = { 'everyday-card': { name: 'Made Up Cash Card', mask: '3333' }, 'second-card': { name: 'Made Up Gold Card', mask: '5555' } };
    const server = createAppServer(
      cardsNamed(() => names as never, {
        webRoot,
        home: () => ({ state: 'not-set-up', madeUpData: true }),
        statement: (_request, card) => {
          asked.push(card);
          return { state: 'no-statement', madeUpData: true, card, why: 'none-yet' };
        },
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const get = (path: string): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        httpRequest({ host: '127.0.0.1', port, path }, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        })
          .on('error', reject)
          .end();
      });
    try {
      const api = await get('/api/statement/second-card');
      expect(api.status).toBe(200);
      expect(JSON.parse(api.body)).toEqual({ state: 'no-statement', madeUpData: true, card: 'second-card', why: 'none-yet', cardNames: names });
      expect(asked).toEqual(['second-card']);
      expect((await get('/api/statement/old-card')).status).toBe(404);
      const page = await get('/statement/everyday-card');
      expect(page.status).toBe(200);
      expect(page.body).toContain('<title>app</title>');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

// Her rulebook, PR 5: her second card on the server (section 1, 1.2, 4.1,
// 4.8, 5.1, 9.1, 9.3, 9.8, 12.1, 12.6, 14.2): the bank's balances with two
// cards, each card's statement, setup day's starting money, bank rules on
// the second card, its names on the screens and in the alerts, and where its
// pick is kept. Every name, number and date is made up.
import { HER_SWITCHES } from '@budget-app/money';
import { afterEach, describe, expect, it } from 'vitest';
import { alertWords, type AlertFacts } from '../src/alerts/alerts.js';
import { readOutbox } from '../src/alerts/outbox.js';
import { bankView } from '../src/bank/balances.js';
import { cardNamesOf } from '../src/bank/card-names.js';
import { checkBankRules } from '../src/bank/reading.js';
import { parseSettingsRequest } from '../src/choices.js';
import type { StoredAccount } from '../src/bank/stored-account.js';
import { openDatabase } from '../src/db/database.js';
import { HER_SCHEMA_VERSION, hasHerSteps, migrateHer } from '../src/db/her-steps.js';
import { readAccounts, readItems, saveAccount, setAccountRoles } from '../src/db/store.js';
import { cardsNamed } from '../src/http/card-names.js';
import type { AppServerOptions } from '../src/http/server.js';
import { memoryLog } from '../src/log.js';
import type { PlaidAccount, PlaidCreditCard } from '../src/plaid/types.js';
import { AlertTimer } from '../src/serve/alert-timer.js';
import { HER_START } from '../src/setup-start.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { HER_BANK_RULES, setUpHer } from './her-harness.js';
import { decision, lifeInAFile, noonInNewYork, type Life } from './keeper-harness.js';

const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;
const E = ACCOUNT_IDS.everyday;
const SECOND = ACCOUNT_IDS.second;

// How the made-up bank shows her second card's payments, fees and interest.
const SECOND_CARD_RULES = checkBankRules([
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'sav-pays-second', account: 'savings', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'second-fee', account: 'second-card', contains: 'LATE FEE', means: 'card-fee' },
  { id: 'second-interest', account: 'second-card', contains: 'INTEREST CHARGE', means: 'card-interest' },
]);

// What the second card owes on setup day.
const SECOND_OWES = 25_000;
// Checking 3,000.00 + savings 5,000.00 - the everyday card 450.00 - the second card 250.00.
const STARTING_MONEY = 730_000;

let lives: Life[] = [];
afterEach(() => {
  for (const life of lives) life.done();
  lives = [];
});

// The made-up bank connected and her four accounts picked, before setup day.
async function herWithTwoCards(): Promise<Life> {
  const life = await lifeInAFile({ herSetup: true, secondCard: SECOND_OWES, rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]), start: HER_START });
  lives.push(life);
  return life;
}

async function setUp(): Promise<Life> {
  const life = await herWithTwoCards();
  setUpHer(life);
  return life;
}

async function day(life: Life, date: string, items: () => void = () => undefined): Promise<void> {
  items();
  life.now = noonInNewYork(date);
  await life.sync();
}

function tracking(life: Life) {
  const home = life.keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  return home;
}

describe('1.2 her four accounts, picked on one connection', () => {
  it('1.2 the second card is picked, the old card\'s account is not, and the pick is kept in her own table', async () => {
    const life = await herWithTwoCards();
    expect(readAccounts(life.h.db).map((a) => [a.plaidAccountId, a.role]).sort()).toEqual([
      [C, 'checking'],
      [E, 'everyday-card'],
      [ACCOUNT_IDS.old, null],
      [S, 'savings'],
      [SECOND, 'second-card'],
    ]);
    expect(hasHerSteps(life.h.db)).toBe(true);
    expect(life.h.db.prepare('SELECT role FROM accounts WHERE plaid_account_id = ?').get(SECOND)).toEqual({ role: null });
    expect(life.h.db.prepare('SELECT plaid_account_id, role FROM her_account_roles').all()).toEqual([{ plaid_account_id: SECOND, role: 'second-card' }]);
    // Kept after a restart.
    life.restart({ start: HER_START });
    expect(readAccounts(life.h.db).find((a) => a.plaidAccountId === SECOND)?.role).toBe('second-card');
  });
});

describe('her database steps, after upstream\'s', () => {
  const account = (id: string): PlaidAccount => ({ account_id: id, balances: { current: 0, available: null, limit: null, iso_currency_code: 'USD', unofficial_currency_code: null }, mask: null, name: id, official_name: null, type: 'credit', subtype: 'credit card' });

  it('upstream\'s database never gets her tables, and reads its accounts as before', () => {
    const db = openDatabase(':memory:');
    saveAccount(db, account('a1'), JSON.stringify(account('a1')), 1);
    setAccountRoles(db, { a1: 'everyday-card' });
    expect(hasHerSteps(db)).toBe(false);
    expect(readAccounts(db).map((a) => a.role)).toEqual(['everyday-card']);
    db.close();
  });

  it('her steps run once, are kept with their version, and a newer version of her setup is refused', () => {
    const db = openDatabase(':memory:');
    migrateHer(db);
    migrateHer(db);
    expect(db.prepare('SELECT version FROM her_schema').all()).toEqual([{ version: HER_SCHEMA_VERSION }]);
    db.prepare('UPDATE her_schema SET version = ?').run(HER_SCHEMA_VERSION + 1);
    expect(() => migrateHer(db)).toThrow(/newer version of her setup/);
    db.close();
  });

  it('one account cannot be both a card of upstream\'s and her second card, and only one is her second card', () => {
    const db = openDatabase(':memory:');
    for (const id of ['a1', 'a2']) saveAccount(db, account(id), JSON.stringify(account(id)), 1);
    setAccountRoles(db, { a1: 'everyday-card', a2: 'second-card' });
    expect(readAccounts(db).map((a) => a.role)).toEqual(['everyday-card', 'second-card']);
    // Picked again the other way round: each keeps one role.
    setAccountRoles(db, { a2: 'everyday-card', a1: 'second-card' });
    expect(readAccounts(db).map((a) => a.role)).toEqual(['second-card', 'everyday-card']);
    expect(() => db.prepare("INSERT INTO her_account_roles (plaid_account_id, role) VALUES ('a2', 'second-card')").run()).toThrow();
    db.close();
  });
});

describe('12.1 the bank side with both cards, as the server reads the bank', () => {
  it('12.1 both cards come off, and a pending charge on the second card raises what it owes', async () => {
    const life = await herWithTwoCards();
    life.h.fake.addPending({ id: 'p-second', account: SECOND, amount: 1_250, date: '2026-10-01', description: 'MADE UP PHARMACY' });
    await life.sync();
    const view = bankView(readAccounts(life.h.db), readItems(life.h.db));
    if (!view.ok) throw new Error(view.why);
    expect(view.view.posted).toEqual({ checking: 300_000, savings: 500_000, everydayCard: 45_000, secondCard: SECOND_OWES });
    expect(view.view.withPending.secondCard).toBe(SECOND_OWES + 1_250);
    expect(view.view.pendingCharges).toEqual([{ account: 'second-card', amount: 1_250 }]);
  });

  it('12.1 upstream\'s bank side has no second card at all', async () => {
    const life = await lifeInAFile();
    lives.push(life);
    const view = bankView(readAccounts(life.h.db), readItems(life.h.db));
    if (!view.ok) throw new Error(view.why);
    expect('secondCard' in view.view.posted).toBe(false);
    expect('secondCard' in view.view.withPending).toBe(false);
  });
});

describe('14.2 setup day: checking + savings - both cards\' balances', () => {
  it('14.2 the setup screen shows the second card, and the starting money takes both cards off', async () => {
    const life = await herWithTwoCards();
    life.h.fake.addPending({ id: 'p-second', account: SECOND, amount: 1_250, date: '2026-10-01', description: 'MADE UP PHARMACY' });
    await life.sync();
    const view = life.keeper.setupView();
    if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
    expect(view.secondCard).toEqual({ posted: SECOND_OWES, pending: 1_250, withPending: SECOND_OWES + 1_250 });
    expect(view.bankSide).toBe(STARTING_MONEY - 1_250);
    expect(setUpHer(life)).toMatchObject({ ok: true });
    expect(life.keeper.book()?.switches()).toEqual(HER_SWITCHES);
    const pots = life.keeper.book()?.pots();
    expect((pots?.savings ?? 0) + (pots?.needs ?? 0) + (pots?.wants ?? 0)).toBe(STARTING_MONEY - 1_250);
    expect(tracking(life).safeToSpend.shown).toBe(true);
  });

  it('14.2 upstream\'s setup screen has no second card', async () => {
    const life = await lifeInAFile();
    lives.push(life);
    const view = life.keeper.setupView();
    if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
    expect('secondCard' in view).toBe(false);
  });
});

describe('4.1, 4.8, 5.1 activity on the second card', () => {
  it('4.1 a purchase on the second card is counted on its day, and the totals still match', async () => {
    const life = await setUp();
    await day(life, '2026-10-02', () => life.h.fake.addPosted({ id: 'grocery-2', account: SECOND, amount: 4_210, date: '2026-10-02', description: 'MADE UP GROCERY' }));
    expect(life.keeper.book()?.purchases().map((p) => [p.id, p.amount, p.date])).toEqual([['grocery-2', 4_210, '2026-10-02']]);
    expect(tracking(life).safeToSpend.shown).toBe(true);
  });

  it('4.8 a fee and interest on the second card, read by its bank rules, wait in review with needs suggested', async () => {
    const life = await setUp();
    await day(life, '2026-10-02', () => {
      life.h.fake.addPosted({ id: 'fee-2', account: SECOND, amount: 2_900, date: '2026-10-02', description: 'LATE FEE' });
      life.h.fake.addPosted({ id: 'int-2', account: SECOND, amount: 1, date: '2026-10-02', description: 'INTEREST CHARGE' });
    });
    expect(life.keeper.book()?.reviewItems()).toMatchObject([
      { id: 'fee-2', reason: 'card-fee', suggestion: 'needs' },
      { id: 'int-2', reason: 'card-interest', suggestion: 'needs' },
    ]);
    expect(tracking(life).safeToSpend.shown).toBe(true);
  });

  it('5.1 12.5 a payment to the second card leaves checking, is on its way a day, lands, and no bucket moves', async () => {
    const life = await setUp();
    const before = life.keeper.book()?.pots();
    await day(life, '2026-10-05', () => life.h.fake.addPosted({ id: 'pay-out', account: C, amount: 10_000, date: '2026-10-05', description: 'Online payment to CRD 5555' }));
    expect(life.keeper.book()?.inTransit()).toMatchObject({ total: 10_000, items: [{ id: 'pay-out', to: 'second-card', seen: 'left' }] });
    expect(tracking(life).safeToSpend.shown).toBe(true);
    await day(life, '2026-10-06', () => life.h.fake.addPosted({ id: 'pay-in', account: SECOND, amount: -10_000, date: '2026-10-06', description: 'PAYMENT - THANK YOU' }));
    expect(life.keeper.book()?.inTransit()).toEqual({ total: 0, items: [] });
    expect(life.keeper.book()?.pots()).toEqual(before);
    expect(life.keeper.book()?.cardPayments('second-card')).toEqual([{ date: '2026-10-05', amount: 10_000, landedOn: '2026-10-06' }]);
    expect(life.keeper.book()?.cardPayments('everyday-card')).toEqual([]);
    expect(tracking(life).safeToSpend.shown).toBe(true);
  });

  it('5.1 a payment to the second card from savings is not spending either', async () => {
    const life = await setUp();
    const before = life.keeper.book()?.pots();
    await day(life, '2026-10-05', () => {
      life.h.fake.addPosted({ id: 'pay-out', account: S, amount: 5_000, date: '2026-10-05', description: 'Online payment to CRD 5555' });
      life.h.fake.addPosted({ id: 'pay-in', account: SECOND, amount: -5_000, date: '2026-10-05', description: 'PAYMENT - THANK YOU' });
    });
    expect(life.keeper.book()?.pots()).toEqual(before);
    expect(tracking(life).safeToSpend.shown).toBe(true);
  });
});

describe('bank rules on the second card', () => {
  it('her setup takes a bank rule on the second card; upstream\'s refuses one, and nothing changes', async () => {
    const rule = { account: 'second-card' as const, contains: 'MADE UP ANNUAL FEE', means: 'card-fee' as const };
    const her = await herWithTwoCards();
    const id = decision();
    const asked = her.keeper.bankRule({ id, bankRule: { add: rule } });
    expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation' });
    const key = asked.ok ? '' : (asked.preview?.key ?? '');
    expect(her.keeper.bankRule({ id, bankRule: { add: rule }, confirmed: true, seen: key })).toMatchObject({ ok: true });
    const upstream = await lifeInAFile();
    lives.push(upstream);
    expect(upstream.keeper.bankRule({ id: decision(), bankRule: { add: rule }, confirmed: true })).toMatchObject({ ok: false, code: 'refused', why: 'This setup has no second card. Nothing was changed.' });
    const transfer = { account: 'checking' as const, contains: 'payment to CRD 5555', means: 'transfer' as const, other: 'second-card' as const };
    expect(upstream.keeper.bankRule({ id: decision(), bankRule: { add: transfer }, confirmed: true })).toMatchObject({ ok: false, code: 'refused', why: 'This setup has no second card. Nothing was changed.' });
  });
});

// Due Oct 26: the reminder days are Oct 19 and Oct 24 (7 and 2 before).
const STATEMENT: Omit<PlaidCreditCard, 'account_id'> = {
  is_overdue: false,
  last_payment_amount: 35,
  last_payment_date: '2026-09-06',
  last_statement_issue_date: '2026-09-30',
  last_statement_balance: 812.4,
  minimum_payment_amount: 35,
  next_payment_due_date: '2026-10-26',
};

function cardLines(life: Life) {
  return tracking(life).attention.filter((a) => a.kind === 'card-due' || a.kind === 'card-overdue' || a.kind === 'card-reminders-off');
}

describe('9.1, 9.3, 9.8 each card\'s statement', () => {
  it('9.1 9.6 both cards due from their first reminder day, each with its own statement balance, the everyday card first', async () => {
    const life = await setUp();
    life.h.fake.setStatement(E, { ...STATEMENT, last_statement_balance: 450.25, next_payment_due_date: '2026-10-23' });
    life.h.fake.setStatement(SECOND, STATEMENT);
    await day(life, '2026-10-19');
    expect(cardLines(life)).toEqual([
      { kind: 'card-due', card: 'everyday-card', dueDate: '2026-10-23', daysLeft: 4, statementBalance: 45_025, minimumPayment: 3_500 },
      { kind: 'card-due', card: 'second-card', dueDate: '2026-10-26', daysLeft: 7, statementBalance: 81_240, minimumPayment: 3_500 },
    ]);
  });

  it('9.3 paying the everyday card in full does not stop the second card\'s; paying the second card in full does', async () => {
    const life = await setUp();
    life.h.fake.setStatement(E, { ...STATEMENT, last_statement_balance: 100 });
    life.h.fake.setStatement(SECOND, STATEMENT);
    await day(life, '2026-10-10', () => {
      life.h.fake.addPosted({ id: 'pay-e', account: C, amount: 10_000, date: '2026-10-10', description: 'Online payment to CRD 3333' });
      life.h.fake.addPosted({ id: 'pay-e-in', account: E, amount: -10_000, date: '2026-10-10', description: 'PAYMENT - THANK YOU' });
    });
    await day(life, '2026-10-19');
    expect(cardLines(life).map((a) => 'card' in a && a.card)).toEqual(['second-card']);
    await day(life, '2026-10-20', () => life.h.fake.addPosted({ id: 'pay-s', account: C, amount: 81_240, date: '2026-10-20', description: 'Online payment to CRD 5555' }));
    // Counted from the day it left, still on its way (B47).
    expect(cardLines(life)).toEqual([]);
  });

  it('9.8 the second card with no statement date and no closing day: its reminders are off, said on Home and Settings; its own closing day reads it', async () => {
    const life = await setUp();
    life.h.fake.setStatement(SECOND, { ...STATEMENT, last_statement_issue_date: null });
    await day(life, '2026-10-19');
    expect(cardLines(life)).toEqual([{ kind: 'card-reminders-off', card: 'second-card', why: 'no-statement-date' }]);
    const settings = life.keeper.settings();
    if (settings.state !== 'tracking') throw new Error('not tracking');
    expect(settings.cardsOff).toEqual([{ card: 'second-card', why: 'no-statement-date' }]);
    // The everyday card's closing day does not read the second card's statement.
    expect(life.keeper.settingsChange({ id: decision(), settings: { everydayCardClosingDay: 30 } })).toMatchObject({ ok: true });
    expect(cardLines(life)).toEqual([{ kind: 'card-reminders-off', card: 'second-card', why: 'no-statement-date' }]);
    expect(life.keeper.settingsChange({ id: decision(), settings: { secondCardClosingDay: 30 } })).toMatchObject({ ok: true });
    expect(cardLines(life)).toEqual([{ kind: 'card-due', card: 'second-card', dueDate: '2026-10-26', daysLeft: 7, statementBalance: 81_240, minimumPayment: 3_500 }]);
    life.restart({ start: HER_START });
    expect(life.keeper.book()?.settings().secondCardClosingDay).toBe(30);
  });

  it("9.8 the screens can send the second card's closing day: a day of the month, or none", () => {
    expect(parseSettingsRequest({ id: 'abcdefgh', settings: { secondCardClosingDay: 27 } })).toEqual({ id: 'abcdefgh', settings: { secondCardClosingDay: 27 } });
    expect(parseSettingsRequest({ id: 'abcdefgh', settings: { secondCardClosingDay: null } })).toEqual({ id: 'abcdefgh', settings: { secondCardClosingDay: null } });
    expect(parseSettingsRequest({ id: 'abcdefgh', settings: { secondCardClosingDay: 'soon' } })).toBeNull();
  });

  it('9.8 upstream\'s settings refuse a closing day for a second card', async () => {
    const life = await lifeInAFile();
    lives.push(life);
    setUpHer(life as Life);
    expect(life.keeper.settingsChange({ id: decision(), settings: { secondCardClosingDay: 5 }, confirmed: true })).toMatchObject({ ok: false });
  });
});

describe('9.1 the second card\'s reminder, named by its bank', () => {
  it('9.1 9.7 it comes at the review time, says the card\'s name, its statement balance and minimum', async () => {
    const life = await setUp();
    life.h.fake.setStatement(SECOND, STATEMENT);
    await day(life, '2026-10-18');
    const clock = new FakeClock(life);
    const phone = new FakePhone(() => life.now);
    const timer = new AlertTimer({ alerter: life.keeper, sender: phone, clock, log: memoryLog([]) });
    try {
      life.keeper.whenChanged(() => timer.poke());
      timer.start();
      await timer.idle();
      await clock.advance(Date.parse('2026-10-20T00:30:00Z') - life.now.getTime(), () => timer.idle());
      const row = readOutbox(life.h.db, 50).rows.find((r) => r.kind === 'card-reminder');
      expect(row).toMatchObject({ key: 'card-reminder second-card due 2026-10-26 7 days before', facts: { kind: 'card-reminder', card: 'second-card', name: 'Made-up Second Card', statementBalance: 81_240 } });
      expect(phone.shown.find((s) => s.id === 'card-reminder second-card due 2026-10-26 7 days before')).toMatchObject({ title: 'Made-up Second Card payment due in 7 days', body: 'Due Mon, Oct 26.' });
    } finally {
      await timer.stop();
    }
  });

  it('9.1 the words: the name when there is one, "Second card" when there is none', () => {
    const facts: AlertFacts = { kind: 'card-reminder', card: 'second-card', dueDate: '2026-10-26', daysBefore: 2, minimumPayment: 3_500, statementBalance: 81_240 };
    expect(alertWords(facts)).toEqual({ title: 'Second card payment due in 2 days', body: 'Statement balance $812.40, minimum $35.00. Due Mon, Oct 26.' });
    expect(alertWords({ ...facts, name: 'Made-up Second Card' }).title).toBe('Made-up Second Card payment due in 2 days');
    expect(alertWords({ kind: 'card-overdue', card: 'second-card', dueDate: '2026-10-26', minimumPayment: 3_500, date: '2026-10-27', name: 'Made-up Second Card' }).title).toBe('Made-up Second Card payment is overdue');
  });
});

describe('12.6 why the totals do not match, with lines for the second card', () => {
  it('12.6 the second card\'s balance moving with no transaction is its own line, and the lines add up to the difference', async () => {
    const life = await setUp();
    await day(life, '2026-10-02');
    expect(tracking(life).safeToSpend.shown).toBe(true);
    life.h.fake.drift(SECOND, 700);
    await day(life, '2026-10-03');
    const safe = tracking(life).safeToSpend;
    if (safe.shown || safe.why !== 'totals-do-not-match') throw new Error('the totals should not match');
    expect(safe.check.difference).toBe(-700);
    expect(safe.detail?.accounts.find((a) => a.account === 'second-card')).toEqual({ account: 'second-card', posted: SECOND_OWES + 700, available: null, counted: SECOND_OWES + 700 });
    expect(safe.detail?.why).toEqual([{ kind: 'balance-moved', account: 'second-card', balance: 'posted', went: 'up', by: 700, amount: -700 }]);
  });
});

describe('HB6 each card named by its bank, on the screens of her setup only', () => {
  const stored = (role: StoredAccount['role'], name: string, mask: string | null): StoredAccount => {
    const raw: PlaidAccount = { account_id: `${name}-${mask ?? ''}`, balances: { current: 0, available: null, limit: null, iso_currency_code: 'USD', unofficial_currency_code: null }, mask, name, official_name: null, type: 'credit', subtype: 'credit card' };
    return { plaidAccountId: raw.account_id, role, raw, rawText: JSON.stringify(raw) };
  };

  it('HB6 her two cards by the names their banks give them; upstream\'s, with no second card, by none', async () => {
    const life = await setUp();
    expect(life.keeper.cardNames()).toEqual({ 'everyday-card': 'Made-up Everyday Card', 'second-card': 'Made-up Second Card' });
    expect(cardNamesOf([stored('everyday-card', 'Made Up Card', '3333')])).toBeNull();
  });

  it('HB6 two cards the banks name the same are told apart by their last digits; with no name, the plain words', () => {
    expect(cardNamesOf([stored('everyday-card', 'Made Up Card', '3333'), stored('second-card', 'Made Up Card', '5555')])).toEqual({ 'everyday-card': 'Made Up Card ••3333', 'second-card': 'Made Up Card ••5555' });
    expect(cardNamesOf([stored('everyday-card', 'Made Up Card', null), stored('second-card', 'Made Up Card', null)])).toEqual({ 'everyday-card': 'Everyday card', 'second-card': 'Second card' });
    expect(cardNamesOf([stored('everyday-card', '  ', '3333'), stored('second-card', 'Made Up Second', '5555')])).toEqual({ 'everyday-card': 'Everyday card', 'second-card': 'Made Up Second' });
  });

  it("HB6 the names go with Home, Buckets, Review, a bucket's list, Settings and Setup day; nothing is added without them", async () => {
    const names = { 'everyday-card': 'A', 'second-card': 'B' } as const;
    const view = { state: 'tracking' };
    const options = { webRoot: '', gate: {}, home: () => view, buckets: () => view, review: () => view, activity: (_r: unknown, pot: string) => ({ ...view, pot }), settings: () => view, setupView: () => view, trends: () => view } as unknown as AppServerOptions;
    const named = cardsNamed(() => names, options);
    const request = {} as never;
    for (const key of ['home', 'buckets', 'review', 'settings', 'setupView'] as const) expect(await named[key]?.(request)).toEqual({ state: 'tracking', cardNames: names });
    expect(await named.activity?.(request, 'needs')).toEqual({ state: 'tracking', pot: 'needs', cardNames: names });
    expect(await named.trends?.(request)).toEqual(view);
    const plain = cardsNamed(() => null, options);
    expect(await plain.home(request)).toEqual(view);
  });
});

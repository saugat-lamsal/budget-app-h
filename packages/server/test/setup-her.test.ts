import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, HER_SETTINGS, HER_SWITCHES, UPSTREAM_SWITCHES, openBook, rolesFor, settingsWhenOff, validateSettings } from '@budget-app/money';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenBox } from '../src/crypto/token-box.js';
import { openDatabase } from '../src/db/database.js';
import { readAccounts, readConnection } from '../src/db/store.js';
import { Keeper, type SyncBank } from '../src/history/keeper.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { connectLikeHis } from '../src/serve/test-bank.js';
import { HER_START, UPSTREAM_START, setupStartOf } from '../src/setup-start.js';
import { ACCOUNT_IDS, FakePlaid, fourAccounts, secondCardAccount } from './fake-plaid.js';
import { POSTED_AT_START, TOKEN_KEY } from './harness.js';
import { herLife, setUpHer } from './her-harness.js';
import { choose, decision, lifeInAFile, noonInNewYork, type Life } from './keeper-harness.js';

// Her setup on the server (her rulebook, "Off in this setup"): setup day
// starts with the mom reserve and the old card switched off. Every name and
// number is made up.

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;
const OLD = ACCOUNT_IDS.old;

let lives: Life[] = [];
afterEach(() => {
  for (const life of lives) life.done();
  lives = [];
});
async function her(): Promise<Life> {
  const life = await herLife();
  lives.push(life);
  return life;
}

describe('Off in this setup: what setup day starts from', () => {
  it('Off in this setup: BUDGET_SETUP=her starts from her setup; unset or upstream, from upstream\'s', () => {
    expect(setupStartOf('her')).toBe(HER_START);
    expect(HER_START).toEqual({ settings: HER_SETTINGS, switches: HER_SWITCHES });
    for (const value of [undefined, '', 'upstream']) expect(setupStartOf(value)).toBe(UPSTREAM_START);
    expect(UPSTREAM_START.switches).toEqual(UPSTREAM_SWITCHES);
    expect(() => setupStartOf('hers')).toThrow(/BUDGET_SETUP/);
  });

  // PR 5: her four (her rulebook, 1.2): the second card is picked too.
  it('1.2 her setup: four accounts are picked, with the second card; the old card is never asked about', () => {
    expect(rolesFor(HER_SWITCHES)).toEqual(['checking', 'savings', 'everyday-card', 'second-card']);
    expect(rolesFor(UPSTREAM_SWITCHES)).toEqual(['checking', 'savings', 'everyday-card', 'old-card']);
  });
});

describe('1.2 her setup: which account is which', () => {
  async function connectedHer() {
    const db = openDatabase(':memory:');
    const fake = new FakePlaid([...fourAccounts(POSTED_AT_START), secondCardAccount(25_000)]);
    const lines: LogLine[] = [];
    const log = memoryLog(lines, [fake.clientId, fake.secret]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const keeper = Keeper.open({ db, now: () => noonInNewYork('2026-10-01'), log, start: HER_START });
    const bank: SyncBank = { plaid, box: new TokenBox(TOKEN_KEY), log, pageSize: 3 };
    const desk = keeper.bankDesk(bank);
    expect(await desk.link({ mode: 'connect', yes: true })).toMatchObject({ ok: true });
    // PR 6 (HB8): her setup takes Link's answer only with the bank it names.
    expect(await desk.connected({ publicToken: fake.publicToken, institution: { id: fake.institutionId, name: 'Made-up Bank' } })).toMatchObject({ ok: true });
    return { db, desk };
  }

  it("1.2 her setup: the screen asks for four; with them picked the bank is read, and the old card's account never is", async () => {
    const { db, desk } = await connectedHer();
    const view = desk.view();
    expect(view.state === 'connected' && view.roles).toEqual(['checking', 'savings', 'everyday-card', 'second-card']);
    const picks = { checking: C, savings: ACCOUNT_IDS.savings, 'everyday-card': E, 'second-card': ACCOUNT_IDS.second };
    expect(desk.roles({ roles: picks, yes: true })).toMatchObject({ ok: true });
    expect(readAccounts(db).find((a) => a.plaidAccountId === OLD)?.role).toBeNull();
    expect(readAccounts(db).find((a) => a.plaidAccountId === ACCOUNT_IDS.second)?.role).toBe('second-card');
    const after = desk.view();
    expect(after.state === 'connected' && after.rolesSet).toBe(true);
  });

  it('1.2 her setup: picking an old card is refused, and so is a pick without the second card', async () => {
    const { db, desk } = await connectedHer();
    const pickEach = 'Pick each of the four: checking, savings, the everyday card, and the second card.';
    for (const roles of [
      { checking: C, savings: ACCOUNT_IDS.savings, 'everyday-card': E, 'old-card': OLD },
      { checking: C, savings: ACCOUNT_IDS.savings, 'everyday-card': E },
      { checking: C, savings: ACCOUNT_IDS.savings, 'everyday-card': E, 'second-card': ACCOUNT_IDS.second, 'old-card': OLD },
    ]) {
      const refused = desk.roles({ roles, yes: true });
      expect(refused).toMatchObject({ ok: false, code: 'not-roles' });
      expect(refused.ok ? '' : refused.why).toBe(pickEach);
    }
    // One account cannot be both cards.
    const twice = desk.roles({ roles: { checking: C, savings: ACCOUNT_IDS.savings, 'everyday-card': E, 'second-card': E }, yes: true });
    expect(twice).toMatchObject({ ok: false, code: 'not-roles', why: 'An account can be only one of the four.' });
    expect(readAccounts(db).every((a) => a.role === null)).toBe(true);
  });
});

describe('Off in this setup: setup day and after, through the real server', () => {
  it('14.2 her setup: the starting money goes to savings, needs, wants and held for others; the mom reserve cannot be given any', async () => {
    const life = await her();
    const refused = life.keeper.setup({ id: decision(), setup: { assign: { pot: 'momReserve', amount: 1 } } });
    expect(refused).toMatchObject({ ok: false, code: 'refused', why: 'This setup has no mom reserve. Nothing was changed.' });
    // 13.1: what is still to set after setup day is the paycheck rule alone; she has no mom rule.
    expect(setUpHer(life)).toMatchObject({ ok: true, done: { step: 'started', stillToSet: ['paycheckRule'] } });
    const book = life.keeper.book();
    expect(book?.switches()).toEqual(HER_SWITCHES);
    expect(book?.settings()).toEqual(HER_SETTINGS);
    expect(book?.pots().momReserve).toBe(0);
    expect(book?.oldCardDebt()).toBe(0);
  });

  it('Off in this setup: fixed on setup day: her book opens with both off after a restart', async () => {
    const life = await her();
    setUpHer(life);
    life.restart({ start: HER_START });
    expect(life.keeper.book()?.switches()).toEqual(HER_SWITCHES);
    // Even a server told to start upstream's way keeps the book's own switches.
    life.restart({ start: UPSTREAM_START });
    expect(life.keeper.book()?.switches()).toEqual(HER_SWITCHES);
    // And it serves them: a bank rule on the old card is still refused.
    const rule = { account: 'old-card' as const, contains: 'INTEREST CHARGE', means: 'card-interest' as const };
    expect(life.keeper.bankRule({ id: decision(), bankRule: { add: rule }, confirmed: true })).toMatchObject({ ok: false, why: 'This setup has no old card. Nothing was changed.' });
  });

  it('Off in this setup: each switch is its own: with only the mom reserve off, a bank rule on the old card is taken', async () => {
    const switches = { momReserve: 'off', oldCard: 'on', secondCard: 'off', wishlist: 'off', postedBalance: 'off' } as const;
    const life = await lifeInAFile({ start: { settings: validateSettings({ ...DEFAULT_SETTINGS, ...settingsWhenOff(switches) }), switches } });
    lives.push(life);
    const rule = { account: 'old-card' as const, contains: 'MADE UP LATE FEE', means: 'card-fee' as const };
    const id = decision();
    const asked = life.keeper.bankRule({ id, bankRule: { add: rule } });
    expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation' });
    const key = asked.ok ? '' : (asked.preview?.key ?? '');
    expect(life.keeper.bankRule({ id, bankRule: { add: rule }, confirmed: true, seen: key })).toMatchObject({ ok: true });
  });

  it('1.2 her setup: activity on the account nobody picked is never read, and the self-check holds', async () => {
    const life = await her();
    setUpHer(life);
    life.h.fake.addPosted({ id: 'old-1', account: OLD, amount: 2_500, date: '2026-10-02', description: 'MADE UP CAFE' });
    life.h.fake.addPosted({ id: 'store-1', account: E, amount: 1_500, date: '2026-10-02', description: 'MADE UP SHOP' });
    life.now = noonInNewYork('2026-10-02');
    await life.sync();
    const book = life.keeper.book();
    expect(book?.purchases().map((p) => p.id)).toEqual(['store-1']);
    const home = life.keeper.home();
    expect(home.state === 'tracking' && home.safeToSpend.shown).toBe(true);
  });

  it('5.6 her setup: a bank rule about the old card is refused', async () => {
    const life = await her();
    setUpHer(life);
    for (const rule of [
      { account: 'checking' as const, contains: 'payment to CRD 4444', means: 'transfer' as const, other: 'old-card' as const },
      { account: 'old-card' as const, contains: 'INTEREST CHARGE', means: 'card-interest' as const },
    ]) {
      const answer = life.keeper.bankRule({ id: decision(), bankRule: { add: rule }, confirmed: true });
      expect(answer).toMatchObject({ ok: false, code: 'refused', why: 'This setup has no old card. Nothing was changed.' });
    }
  });

  it('7.6, 8.1, 13.3 her setup: "for mom", a mom rule, and a move to the mom reserve are refused by the server, and nothing changes', async () => {
    const life = await her();
    setUpHer(life);
    life.h.fake.addPosted({ id: 'aunt-1', account: C, amount: 6_000, date: '2026-10-02', description: 'Zelle payment to AUNT MADEUP' });
    life.now = noonInNewYork('2026-10-02');
    await life.sync();
    const before = JSON.stringify(life.keeper.book()?.reviewDetails());
    const pots = life.keeper.book()?.pots();
    expect(choose(life.keeper, { item: 'aunt-1', choice: { to: 'mom' } })).toMatchObject({ ok: false, code: 'refused', why: "That isn't one of the choices for this item. Nothing was changed." });
    expect(life.keeper.settingsChange({ id: decision(), settings: { momRule: { contains: 'MOM MADEUP' } }, confirmed: true })).toMatchObject({ ok: false, code: 'refused' });
    expect(life.keeper.settingsChange({ id: decision(), settings: { oldCardPromoEndDate: '2027-06-01' }, confirmed: true })).toMatchObject({ ok: false, code: 'refused' });
    expect(life.keeper.move({ id: decision(), move: { from: 'savings', to: 'momReserve', amount: 100 }, confirmed: true })).toMatchObject({ ok: false, code: 'refused' });
    expect(life.keeper.ruleChange({ id: decision(), rule: { add: { for: 'person', contains: 'AUNT', to: 'mom' } } })).toMatchObject({ ok: false, code: 'refused' });
    expect(life.keeper.ruleChange({ id: decision(), rule: { add: { for: 'deposit', contains: 'AUNT', to: 'momReserve' } } })).toMatchObject({ ok: false, code: 'refused' });
    expect(JSON.stringify(life.keeper.book()?.reviewDetails())).toBe(before);
    expect(life.keeper.book()?.pots()).toEqual(pots);
    expect(choose(life.keeper, { item: 'aunt-1', choice: { to: 'wants' } })).toMatchObject({ ok: true });
  });

  it('Off in this setup: a book saved before the switches existed (upstream\'s history) opens with both on', () => {
    // B242: the setup event of a history saved before the switches has none.
    const book = openBook({ date: '2026-10-01', lastPaycheckDate: '2026-09-25', oldCardDebt: 0, pots: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 }, settings: UPSTREAM_START.settings });
    expect(book.switches()).toEqual(UPSTREAM_SWITCHES);
  });

  // PR 5: on its one connection, the test bank's second card (4444) is hers.
  it("1.2 her setup: her app's first start connects the test bank and picks her four accounts, its second card as hers", async () => {
    const fake = new FakePlaid(fourAccounts(POSTED_AT_START));
    const db = openDatabase(':memory:');
    const log = memoryLog([]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    await connectLikeHis({ db, plaid, box: new TokenBox(TOKEN_KEY), log, today: '2026-10-09', wait: async () => {}, roles: rolesFor(HER_SWITCHES) });
    expect(readConnection(db)?.historyComplete).toBe(true);
    expect(readAccounts(db).map((a) => [a.raw.mask, a.role]).sort()).toEqual([
      ['1111', 'checking'],
      ['2222', 'savings'],
      ['3333', 'everyday-card'],
      ['4444', 'second-card'],
    ]);
    db.close();
  });

  // PR 12, break-it: each switch is its own. With the old card off and no
  // second card (PR 3's setup, before PR 5), three accounts are picked; her
  // tests since PR 5 always had the second card on, so nothing held this.
  it('Off in this setup: 1.2 each switch is its own: with the old card off and no second card, three accounts are asked for, said as three, and the first start picks those three only', async () => {
    const three = { ...HER_SWITCHES, secondCard: 'off' as const, wishlist: 'off' as const };
    expect(rolesFor(three)).toEqual(['checking', 'savings', 'everyday-card']);

    const fake = new FakePlaid(fourAccounts(POSTED_AT_START));
    const db = openDatabase(':memory:');
    const log = memoryLog([], [fake.clientId, fake.secret]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const keeper = Keeper.open({ db, now: () => noonInNewYork('2026-10-01'), log, start: { settings: HER_SETTINGS, switches: three } });
    const desk = keeper.bankDesk({ plaid, box: new TokenBox(TOKEN_KEY), log, pageSize: 3 });
    expect(await desk.link({ mode: 'connect', yes: true })).toMatchObject({ ok: true });
    expect(await desk.connected({ publicToken: fake.publicToken })).toMatchObject({ ok: true });
    const refused = desk.roles({ roles: { checking: C, savings: ACCOUNT_IDS.savings }, yes: true });
    expect(refused).toMatchObject({ ok: false, code: 'not-roles', why: 'Pick each of the three: checking, savings, and the everyday card.' });
    db.close();

    // The first start's test bank (main.ts): its old card (4444) is not picked.
    const first = openDatabase(':memory:');
    await connectLikeHis({ db: first, plaid, box: new TokenBox(TOKEN_KEY), log, today: '2026-10-09', wait: async () => {}, roles: rolesFor(three) });
    expect(readAccounts(first).map((a) => [a.raw.mask, a.role]).sort()).toEqual([
      ['1111', 'checking'],
      ['2222', 'savings'],
      ['3333', 'everyday-card'],
      ['4444', null],
    ]);
    first.close();
  });

  it('her setup: the real server starts from BUDGET_SETUP, and connects the test bank with its accounts: what main.ts does', () => {
    const main = readFileSync(new URL('../src/serve/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("start: setupStartOf(process.env['BUDGET_SETUP'])");
    expect(main).toContain('push: { keys: push }, start });');
    expect(main.split('roles: rolesFor(start.switches)')).toHaveLength(3);
    expect(main.split('connectLikeHis(')).toHaveLength(3);
  });
});

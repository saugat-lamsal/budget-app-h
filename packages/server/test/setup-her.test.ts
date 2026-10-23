import { readFileSync } from 'node:fs';
import { HER_SETTINGS, HER_SWITCHES, UPSTREAM_SWITCHES, openBook, rolesFor } from '@budget-app/money';
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
import { ACCOUNT_IDS, FakePlaid, fourAccounts } from './fake-plaid.js';
import { POSTED_AT_START, TOKEN_KEY } from './harness.js';
import { herLife, setUpHer } from './her-harness.js';
import { choose, decision, noonInNewYork, type Life } from './keeper-harness.js';

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

  it('1.2 her setup: three accounts are picked; the old card is never asked about', () => {
    expect(rolesFor(HER_SWITCHES)).toEqual(['checking', 'savings', 'everyday-card']);
    expect(rolesFor(UPSTREAM_SWITCHES)).toEqual(['checking', 'savings', 'everyday-card', 'old-card']);
  });
});

describe('1.2 her setup: which account is which', () => {
  async function connectedHer() {
    const db = openDatabase(':memory:');
    const fake = new FakePlaid(fourAccounts(POSTED_AT_START));
    const lines: LogLine[] = [];
    const log = memoryLog(lines, [fake.clientId, fake.secret]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const keeper = Keeper.open({ db, now: () => noonInNewYork('2026-10-01'), log, start: HER_START });
    const bank: SyncBank = { plaid, box: new TokenBox(TOKEN_KEY), log, pageSize: 3 };
    const desk = keeper.bankDesk(bank);
    expect(await desk.link({ mode: 'connect', yes: true })).toMatchObject({ ok: true });
    expect(await desk.connected({ publicToken: fake.publicToken })).toMatchObject({ ok: true });
    return { db, desk };
  }

  it('1.2 her setup: the screen asks for three; with them picked the bank is read, and the fourth account never is', async () => {
    const { db, desk } = await connectedHer();
    const view = desk.view();
    expect(view.state === 'connected' && view.roles).toEqual(['checking', 'savings', 'everyday-card']);
    const picks = { checking: C, savings: ACCOUNT_IDS.savings, 'everyday-card': E };
    expect(desk.roles({ roles: picks, yes: true })).toMatchObject({ ok: true });
    expect(readAccounts(db).find((a) => a.plaidAccountId === OLD)?.role).toBeNull();
    const after = desk.view();
    expect(after.state === 'connected' && after.rolesSet).toBe(true);
  });

  it('1.2 her setup: picking an old card is refused, and so is a pick of four', async () => {
    const { db, desk } = await connectedHer();
    const refused = desk.roles({ roles: { checking: C, savings: ACCOUNT_IDS.savings, 'everyday-card': E, 'old-card': OLD }, yes: true });
    expect(refused).toMatchObject({ ok: false, code: 'not-roles' });
    expect(refused.ok ? '' : refused.why).toBe('Pick each of the three: checking, savings, and the everyday card.');
    expect(readAccounts(db).every((a) => a.role === null)).toBe(true);
  });
});

describe('Off in this setup: setup day and after, through the real server', () => {
  it('14.2 her setup: the starting money goes to savings, needs, wants and held for others; the mom reserve cannot be given any', async () => {
    const life = await her();
    const refused = life.keeper.setup({ id: decision(), setup: { assign: { pot: 'momReserve', amount: 1 } } });
    expect(refused).toMatchObject({ ok: false, code: 'refused', why: 'This setup has no mom reserve. Nothing was changed.' });
    setUpHer(life);
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

  it("1.2 her setup: her app's first start connects the test bank and picks her three accounts; the old card's is left unpicked", async () => {
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
      ['4444', null],
    ]);
    db.close();
  });

  it('her setup: the real server starts from BUDGET_SETUP, and connects the test bank with its accounts: what main.ts does', () => {
    const main = readFileSync(new URL('../src/serve/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("start: setupStartOf(process.env['BUDGET_SETUP'])");
    expect(main).toContain('push: { keys: push }, start });');
    expect(main.split('roles: rolesFor(start.switches)')).toHaveLength(3);
    expect(main.split('connectLikeHis(')).toHaveLength(3);
  });
});

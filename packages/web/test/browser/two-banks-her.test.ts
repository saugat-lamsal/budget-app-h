import type { Server } from 'node:http';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectionsOf } from '../../../server/src/bank/connections.js';
import { TokenBox } from '../../../server/src/crypto/token-box.js';
import { openDatabase } from '../../../server/src/db/database.js';
import { readAccounts, setBankRules } from '../../../server/src/db/store.js';
import { Keeper, type SyncBank } from '../../../server/src/history/keeper.js';
import { memoryLog } from '../../../server/src/log.js';
import { PlaidClient } from '../../../server/src/plaid/client.js';
import { plaidKeysFromEnv } from '../../../server/src/plaid/sandbox-lock.js';
import { HER_START } from '../../../server/src/setup-start.js';
import { ACCOUNT_IDS, FakePlaid, SECOND_BANK, secondCardAccount, twoBanks } from '../../../server/test/fake-plaid.js';
import { TOKEN_KEY } from '../../../server/test/harness.js';
import { HER_BANK_RULES } from '../../../server/test/her-harness.js';
import { decision, noonInNewYork } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, textAt, untilQuiet, waitOrReport } from './harness.js';

// Her rulebook, PR 6, in a browser on the real server: her two banks on the
// Bank page, connected one after the other (1.1), her four accounts picked
// across both (1.2), and each bank logged in to again on its own (1.3); and
// Home naming the bank that wants a new login (0.5, 10.5). A stand-in for
// Plaid Link's script logs in at once each time it is opened, handing back
// the next made-up bank's answer, with the bank it names, as the real one
// does. Every name and number is made up.

const LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const FIRST_NAME = 'Made-up First Bank';
const SECOND_NAME = 'Made-up Second Bank';

interface Running {
  readonly server: Server;
  readonly base: string;
  readonly context: BrowserContext;
  readonly first: FakePlaid;
  readonly second: FakePlaid;
  readonly db: ReturnType<typeof openDatabase>;
  readonly keeper: Keeper;
  readonly bank: SyncBank;
  readonly clock: { now: Date };
}

describe.each(ENGINES)('her two banks on the screens, in %s', (_name, engine) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function realServer(): Promise<Running> {
    const db = openDatabase(':memory:');
    const first = new FakePlaid([
      { id: ACCOUNT_IDS.checking, name: 'Made-up Checking', mask: '1111', kind: 'checking', posted: 300_000 },
      { id: ACCOUNT_IDS.savings, name: 'Made-up Savings', mask: '2222', kind: 'savings', posted: 500_000 },
      { id: ACCOUNT_IDS.everyday, name: 'Made-up Everyday Card', mask: '3333', kind: 'credit card', posted: 45_000, limit: 500_000 },
    ]);
    const second = new FakePlaid([secondCardAccount(25_000)], SECOND_BANK);
    const log = memoryLog([], [first.clientId, first.secret]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: first.clientId, PLAID_SECRET: first.secret }), { fetch: twoBanks(first, second), log });
    const clock = { now: noonInNewYork('2026-10-01') };
    const keeper = Keeper.open({ db, now: () => clock.now, log, start: HER_START });
    const bank: SyncBank = { plaid, box: new TokenBox(TOKEN_KEY), log, pageSize: 3 };
    const r = { server: undefined as unknown as Server, base: '', context: undefined as unknown as BrowserContext, first, second, db, keeper, bank, clock };
    (r as { server: Server }).server = keeper.server(WEB_ROOT, () => r.base, undefined, { bank });
    r.base = await listen(r.server);
    (r as { context: BrowserContext }).context = await browser!.newContext(phone());
    await r.context.addCookies([loginCookieForTests(db, clock.now, r.base)]);
    // Each time Link is opened: the next bank's answer, with the bank it names.
    const answers = [
      { token: first.publicToken, institution: { institution_id: first.institutionId, name: FIRST_NAME } },
      { token: second.publicToken, institution: { institution_id: second.institutionId, name: SECOND_NAME } },
    ];
    await r.context.route(LINK_SCRIPT, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `window.__linkOpened = 0; window.__answers = ${JSON.stringify(answers)};
window.Plaid = { create(config) { return { open() {
  const answer = window.__answers[Math.min(window.__linkOpened, window.__answers.length - 1)];
  window.__linkOpened += 1; window.__linkToken = config.token;
  setTimeout(() => config.onSuccess(answer.token, { institution: answer.institution }), 20);
}, destroy() {} }; } };`,
      }),
    );
    return r;
  }

  async function done(r: Running): Promise<void> {
    await r.context.close();
    await close(r.server);
    r.db.close();
  }

  async function open(r: Running, path: string): Promise<Page> {
    const page = await r.context.newPage();
    await page.goto(`${r.base}${path}`);
    await waitOrReport(page, 'main[aria-busy="false"]');
    await untilQuiet(page);
    return page;
  }

  async function connect(page: Page): Promise<string> {
    await page.getByTestId('bank-connect').click();
    await waitOrReport(page, '[data-testid="bank-ask"]');
    await page.getByTestId('bank-ask-yes').click();
    await waitOrReport(page, '[data-testid="bank-said"]');
    await untilQuiet(page);
    return textAt(page, 'bank-said');
  }

  it('1.1 1.2 1.3 two banks one after the other, each by its name; her four picked across both; each logged in to again on its own', async () => {
    const r = await realServer();
    try {
      const page = await open(r, '/bank');
      expect(await textAt(page, 'bank-connect-card')).toContain('Connect a bank');
      expect(await textAt(page, 'bank-connect-card')).toContain("Plaid's test bank, with made-up accounts, as two banks.");
      expect(await connect(page)).toContain(`${FIRST_NAME} is connected. Now connect your other bank.`);
      // Her other bank is still to connect.
      await waitOrReport(page, '[data-testid="bank-state-1"]');
      expect(await textAt(page, 'bank-state-1')).toContain(FIRST_NAME);
      // Card titles are shown in capitals.
      expect((await textAt(page, 'bank-connect-card')).toLowerCase()).toContain('connect your other bank');
      expect(await connect(page)).toContain('Both banks are connected. Now say which account is which.');
      await waitOrReport(page, '[data-testid="bank-state-2"]');
      expect(await textAt(page, 'bank-state-2')).toContain(SECOND_NAME);
      expect(await page.getByTestId('bank-connect-card').count()).toBe(0);
      expect(connectionsOf(r.db).map((c) => [c.bank, c.itemId, c.name])).toEqual([
        [1, r.first.itemId, FIRST_NAME],
        [2, r.second.itemId, SECOND_NAME],
      ]);
      // 1.2: the four, from either bank.
      for (const [role, id] of [['checking', ACCOUNT_IDS.checking], ['savings', ACCOUNT_IDS.savings], ['everyday-card', ACCOUNT_IDS.everyday], ['second-card', ACCOUNT_IDS.second]] as const) {
        await page.getByTestId(`bank-pick-${role}`).click();
        await waitOrReport(page, '[data-testid="bank-pick-sheet"]');
        await page.getByTestId(`bank-pick-account-${id}`).click();
        await page.getByTestId('bank-pick-sheet').waitFor({ state: 'detached' });
      }
      await page.getByTestId('bank-pick-save').click();
      await waitOrReport(page, '[data-testid="bank-keep"]');
      await page.getByTestId('bank-keep-yes').click();
      await waitOrReport(page, '[data-testid="bank-role-second-card"]');
      await untilQuiet(page);
      expect(Object.fromEntries(readAccounts(r.db).map((a) => [a.role, a.plaidAccountId]))).toEqual({ checking: ACCOUNT_IDS.checking, savings: ACCOUNT_IDS.savings, 'everyday-card': ACCOUNT_IDS.everyday, 'second-card': ACCOUNT_IDS.second });
      expect(r.second.calls.some((c) => c.endpoint === '/transactions/sync')).toBe(true);
      // 1.3: each bank its own button, by name; the second's makes its link key with its own key.
      expect(await textAt(page, 'bank-login-again-1')).toContain(`Log in to ${FIRST_NAME} again`);
      expect(await textAt(page, 'bank-login-again-2')).toContain(`Log in to ${SECOND_NAME} again`);
      await page.getByTestId('bank-login-again-2').click();
      await waitOrReport(page, '[data-testid="bank-said"]');
      await untilQuiet(page);
      expect(r.second.calls.filter((c) => c.endpoint === '/link/token/create').at(-1)?.body).toMatchObject({ access_token: r.second.accessToken });
      expect(connectionsOf(r.db)).toHaveLength(2);
    } finally {
      await done(r);
    }
  });

  // Both banks connected, her four picked and setup day done, on the server, as the screens would.
  async function tracking(r: Running): Promise<void> {
    const desk = r.keeper.bankDesk(r.bank);
    for (const fake of [r.first, r.second]) {
      await desk.link({ mode: 'connect', yes: true });
      await desk.connected({ publicToken: fake.publicToken, institution: { id: fake.institutionId, name: fake === r.first ? FIRST_NAME : SECOND_NAME } });
    }
    setBankRules(r.db, HER_BANK_RULES, '2026-10-01');
    r.keeper.reload();
    desk.roles({ roles: { checking: ACCOUNT_IDS.checking, savings: ACCOUNT_IDS.savings, 'everyday-card': ACCOUNT_IDS.everyday, 'second-card': ACCOUNT_IDS.second }, yes: true });
    await r.keeper.sync(r.bank);
    for (const setup of [{ lastPaycheck: '2026-09-25' }, { assign: { pot: 'savings' as const, amount: 400_000 } }, { assign: { pot: 'wants' as const, amount: 20_000 } }, { assign: { pot: 'needs' as const, rest: true as const } }]) r.keeper.setup({ id: decision(), setup });
    const view = r.keeper.setupView();
    if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
    r.keeper.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: view.key });
  }

  it('0.5 10.5 the second bank wants a new login: Home greys the last checked safe to spend and names the bank, and the Bank page says so', async () => {
    const r = await realServer();
    try {
      await tracking(r);
      r.clock.now = noonInNewYork('2026-10-02');
      await r.keeper.sync(r.bank);
      // Home on the 2nd keeps the safe to spend both banks backed up (0.5).
      await (await open(r, '/home')).close();
      r.second.needsLogin = true;
      r.clock.now = noonInNewYork('2026-10-03');
      await r.keeper.sync(r.bank);
      const home = await open(r, '/home');
      expect(await textAt(home, 'as-of')).toContain(`Can't reach ${SECOND_NAME} to check it now.`);
      expect(await textAt(home, 'attention-bank-login-2')).toContain(`Log in to ${SECOND_NAME} again`);
      expect(await home.getByTestId('attention-bank-login-1').count()).toBe(0);
      const bank = await open(r, '/bank');
      expect(await textAt(bank, 'bank-needs-login-2')).toContain(`${SECOND_NAME} wants you to log in again.`);
      expect(await bank.getByTestId('bank-needs-login-1').count()).toBe(0);
    } finally {
      await done(r);
    }
  });

  // HB8 13.5, found while writing her connection-day sheet: the change log
  // said "Bank of America, through Plaid" for every real connection.
  it('HB8 13.5 Settings\' change log names each bank she connected, as Plaid named it, and never Bank of America', async () => {
    const r = await realServer();
    try {
      await tracking(r);
      // Under the tests Plaid is always its test bank (the lock); on her real books the desk's lines say 'real'.
      r.db.prepare("UPDATE change_log SET detail = json_set(detail, '$.bank', 'real') WHERE what = 'bank connected'").run();
      const page = await open(r, '/settings');
      const log = await textAt(page, 'log');
      expect(log).toContain(`Bank connected ${FIRST_NAME}, through Plaid`);
      expect(log).toContain(`Bank connected ${SECOND_NAME}, through Plaid`);
      expect(log).not.toContain('Bank of America');
    } finally {
      await done(r);
    }
  });

  // Found in her rehearsal: after "Yes, keep them" the screen said Saved, but
  // the list above still showed the old pick until the bank had been read,
  // which with two banks and their history takes a while.
  it('1.2 a changed pick shows in the list as soon as it is kept, while the bank is still being read', async () => {
    const r = await realServer();
    try {
      const desk = r.keeper.bankDesk(r.bank);
      for (const fake of [r.first, r.second]) {
        await desk.link({ mode: 'connect', yes: true });
        await desk.connected({ publicToken: fake.publicToken, institution: { id: fake.institutionId, name: fake === r.first ? FIRST_NAME : SECOND_NAME } });
      }
      desk.roles({ roles: { checking: ACCOUNT_IDS.checking, savings: ACCOUNT_IDS.savings, 'everyday-card': ACCOUNT_IDS.everyday, 'second-card': ACCOUNT_IDS.second }, yes: true });
      const page = await open(r, '/bank');
      expect(await textAt(page, 'bank-role-second-card')).toContain('Made-up Second Card ••5555');
      // The bank's read is held back until the list has been looked at.
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/bank/read', async (route) => {
        await held;
        await route.continue();
      });
      try {
        await page.getByTestId('bank-change-picks').click();
        for (const [role, id] of [['everyday-card', ACCOUNT_IDS.second], ['second-card', ACCOUNT_IDS.everyday]] as const) {
          await page.getByTestId(`bank-pick-${role}`).click();
          await waitOrReport(page, '[data-testid="bank-pick-sheet"]');
          await page.getByTestId(`bank-pick-account-${id}`).click();
          await page.getByTestId('bank-pick-sheet').waitFor({ state: 'detached' });
        }
        await page.getByTestId('bank-pick-save').click();
        await waitOrReport(page, '[data-testid="bank-keep"]');
        await page.getByTestId('bank-keep-yes').click();
        await expect.poll(() => textAt(page, 'bank-said'), { timeout: 5_000 }).toContain('Saved.');
        await expect.poll(() => textAt(page, 'bank-role-second-card'), { timeout: 5_000 }).toContain('Made-up Everyday Card ••3333');
        expect(await textAt(page, 'bank-role-everyday-card')).toContain('Made-up Second Card ••5555');
      } finally {
        release();
      }
      await untilQuiet(page);
      expect(await textAt(page, 'bank-role-second-card')).toContain('Made-up Everyday Card ••3333');
    } finally {
      await done(r);
    }
  });
});

import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkBankRules } from '../../../server/src/bank/reading.js';
import { memoryLog } from '../../../server/src/log.js';
import { HER_START } from '../../../server/src/setup-start.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { HER_BANK_RULES, setUpHer } from '../../../server/test/her-harness.js';
import { lifeInAFile, noonInNewYork, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, untilAnswered, untilQuiet, waitOrReport } from './harness.js';

// Her rulebook, PR 5: her second card on the screens of the real server, used
// in a browser like a person would. Each card is named as its bank names it
// (HB6): the made-up bank calls them "Made-up Everyday Card" and "Made-up
// Second Card". Every name and number is made up.

const SECOND_CARD_RULES = checkBankRules([
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);

const words = (text: string): string => text.replace(/\s+/g, ' ').trim();

async function herWithTwoCards(): Promise<Life> {
  return lifeInAFile({ herSetup: true, secondCard: 25_000, rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]), start: HER_START });
}

// Set up, then on Oct 19: a purchase on each card, a payment to the second
// card on its way, a checking purchase no rule reads, and both statements,
// the second card's with no statement date (9.8).
async function herNineteenth(): Promise<Life> {
  const life = await herWithTwoCards();
  setUpHer(life);
  const fake = life.h.fake;
  fake.addPosted({ id: 'grocery-e', account: ACCOUNT_IDS.everyday, amount: 3_210, date: '2026-10-18', description: 'MADE UP GROCERY' });
  fake.addPosted({ id: 'cafe-s', account: ACCOUNT_IDS.second, amount: 875, date: '2026-10-18', description: 'MADE UP CAFE' });
  fake.addPosted({ id: 'pay-s', account: ACCOUNT_IDS.checking, amount: 5_000, date: '2026-10-19', description: 'Online payment to CRD 5555' });
  fake.addPosted({ id: 'shop-c', account: ACCOUNT_IDS.checking, amount: 1_999, date: '2026-10-19', description: 'MADE UP ONLINE SHOP' });
  const statement = { is_overdue: false, last_payment_amount: 35, last_payment_date: '2026-09-06', last_statement_balance: 812.4, minimum_payment_amount: 35 };
  fake.setStatement(ACCOUNT_IDS.everyday, { ...statement, last_statement_issue_date: '2026-09-28', next_payment_due_date: '2026-10-23' });
  fake.setStatement(ACCOUNT_IDS.second, { ...statement, last_statement_issue_date: null, next_payment_due_date: '2026-10-26' });
  life.now = noonInNewYork('2026-10-19');
  await life.sync();
  return life;
}

async function open(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`);
  await waitOrReport(page, 'main[aria-busy="false"], [data-testid="settings"]');
  await untilAnswered(page);
  await untilQuiet(page);
}

describe.each(ENGINES)('her second card on the screens, in %s', (_name, engine) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function served(life: Life, run: (page: Page, base: string) => Promise<void>): Promise<void> {
    let server: Server | undefined;
    try {
      let base = '';
      server = life.keeper.server(WEB_ROOT, () => base, undefined, { bank: { plaid: life.h.plaid, box: life.h.box, log: memoryLog([]) } });
      base = await listen(server);
      const context = await browser!.newContext(phone());
      await context.addCookies([loginCookieForTests(life.h.db, life.now, base)]);
      await run(await context.newPage(), base);
      await context.close();
    } finally {
      if (server !== undefined) await close(server);
      life.done();
    }
  }

  it('9.1 9.6 9.8 Home names each card: the everyday card is due, the second card\'s reminders are off; its own closing day on Settings turns them on', async () => {
    await served(await herNineteenth(), async (page, base) => {
      await open(page, base, '/home');
      const home = words(await page.locator('main').innerText());
      expect(home).toContain('Made-up Everyday Card due in 4 days');
      expect(home).toContain('Card reminders are off for Made-up Second Card');
      // Settings: each card's own closing day, by its name.
      await open(page, base, '/settings');
      const row = page.getByTestId('row-closing-day-second');
      expect(words(await row.innerText())).toContain('Made-up Second Card: statement closing day');
      expect(words(await page.getByTestId('row-closing-day-everyday').innerText())).toContain('Made-up Everyday Card: statement closing day');
      expect(await page.getByTestId('row-closing-day-old').count()).toBe(0);
      await row.click();
      await page.getByTestId('field-closing-day').fill('30');
      await page.getByTestId('sheet-save').click();
      await untilAnswered(page);
      await untilQuiet(page);
      await open(page, base, '/home');
      const after = words(await page.locator('main').innerText());
      expect(after).toContain('Made-up Second Card due in 7 days');
      expect(after).not.toContain('Card reminders are off');
    });
  });

  it('5.1 5.6 12.5 the payment on its way to the second card says its name; Review offers it as a transfer, after the everyday card', async () => {
    await served(await herNineteenth(), async (page, base) => {
      await open(page, base, '/buckets');
      expect(words(await page.locator('main').innerText())).toContain('Payment to Made-up Second Card');
      await open(page, base, '/review');
      const shop = page.locator('[data-testid^="item-"]', { hasText: 'MADE UP ONLINE SHOP' }).first();
      await shop.getByTestId('more').click();
      const sheet = page.locator('dialog[open]');
      await sheet.getByTestId('sheet-transfer').waitFor();
      const transfers = await sheet.locator('[data-testid^="choice-transfer-"]').evaluateAll((all) => all.map((e) => e.getAttribute('data-testid')));
      expect(transfers).toEqual(['choice-transfer-savings', 'choice-transfer-everyday-card', 'choice-transfer-second-card']);
      expect(words(await sheet.getByTestId('choice-transfer-second-card').innerText())).toContain('To Made-up Second Card');
    });
  });

  it('14.2 setup day: both cards come off the starting money, each by its name', async () => {
    await served(await herWithTwoCards(), async (page, base) => {
      await open(page, base, '/setup/bank');
      const text = words(await page.locator('main').innerText());
      expect(text).toContain('Checking + savings − both cards');
      expect(text).toContain('Made-up Everyday Card owes');
      expect(text).toContain('Made-up Second Card owes');
      expect(await page.getByTestId('second-card-counts').innerText()).toBe('$250.00');
      expect(await page.getByTestId('bank-side-total').innerText()).toBe('$7,300.00');
    });
  });
});

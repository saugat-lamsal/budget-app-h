import type { Server } from 'node:http';
import type { Book } from '@budget-app/money';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { herLife, setUpHer } from '../../../server/test/her-harness.js';
import { decision, noonInNewYork, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { memoryLog } from '../../../server/src/log.js';
import { axeViolations, tappable } from './design-helpers.js';
import { ENGINES, WEB_ROOT, centsAt, close, launch, listen, phone, untilAnswered, untilQuiet, waitOrReport } from './harness.js';
import { item, watchChoices } from './screens.js';

// Her rulebook, PR 4: "Ask before splitting a paycheck" (3.1, 51.1, 51.2) on
// the real server, her setup, used in a browser like a person would: Home's
// card, Review's paycheck card with what each bucket would get, yes (asked
// first) and "Not a paycheck", an older one first, and a double tap. The
// numbers are compared with the books. Every name and number is made up.

const PAYROLL = 'MADEUP CORP PAYROLL';

// Her setup day, the paycheck rule set, and her paychecks posted (each with
// its id, day and amount), waiting for her yes.
async function herPaychecks(paychecks: readonly (readonly [string, string, number])[]): Promise<Life> {
  const life = await herLife();
  setUpHer(life);
  const id = decision();
  const settings = { paycheckRule: { contains: PAYROLL } };
  const asked = life.keeper.settingsChange({ id, settings });
  if (asked.ok || asked.preview === undefined) throw new Error('the paycheck rule was not asked about');
  if (!life.keeper.settingsChange({ id, settings, confirmed: true, seen: asked.preview.key }).ok) throw new Error('the paycheck rule was not set');
  for (const [pay, date, amount] of paychecks) {
    life.h.fake.addPosted({ id: pay, account: ACCOUNT_IDS.checking, amount: -amount, date, description: `${PAYROLL} DIRECT DEP` });
    life.now = noonInNewYork(date);
    await life.sync();
  }
  return life;
}

function bookOf(life: Life): Book {
  const book = life.keeper.book();
  if (book === null) throw new Error('no books');
  return book;
}

async function open(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`);
  await waitOrReport(page, 'main[aria-busy="false"]');
  await untilAnswered(page);
  await untilQuiet(page);
}

describe.each(ENGINES)('3.1 51.1 a paycheck waiting for her yes, in %s', (_name, engine) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
  });

  // bypassCSP: axe is added to the page as a script of its own (design-helpers.ts).
  async function served(life: Life, run: (page: Page, base: string) => Promise<void>, options: { readonly bypassCSP?: boolean } = {}): Promise<void> {
    let server: Server | undefined;
    try {
      let base = '';
      server = life.keeper.server(WEB_ROOT, () => base, undefined, { bank: { plaid: life.h.plaid, box: life.h.box, log: memoryLog([]) } });
      base = await listen(server);
      const context = await browser!.newContext({ ...phone(), ...options });
      await context.addCookies([loginCookieForTests(life.h.db, life.now, base)]);
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      await run(page, base);
      await context.close();
    } finally {
      if (server !== undefined) await close(server);
      life.done();
    }
  }

  it('51.1 Home says "Paycheck waiting for your yes" with its amount, and a tap opens Review; safe to spend leaves it out', async () => {
    const life = await herPaychecks([['pay-1', '2026-10-09', 250_000]]);
    await served(life, async (page, base) => {
      await open(page, base, '/home');
      const row = page.getByTestId('attention-paycheck-waiting-pay-1');
      expect(await row.innerText()).toContain('Paycheck waiting for your yes');
      expect(await centsAt(page, 'paycheck-waiting-amount')).toBe(250_000);
      expect(await centsAt(page, 'safe-to-spend')).toBe(bookOf(life).safeToSpend('2026-10-09').amount);
      await row.click();
      await page.waitForURL(/\/review$/);
      await item(page, 'pay-1').waitFor();
    });
  });

  it('3.1 Review shows the parts it would get; yes asks first, then splits it from the day it arrived', async () => {
    const life = await herPaychecks([['pay-1', '2026-10-09', 250_000]]);
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      const card = item(page, 'pay-1');
      expect(await card.innerText()).toContain('Paycheck waiting for your yes');
      const would = bookOf(life).paychecksWaiting()[0]?.wouldGet;
      expect({ savings: await centsAt(page, 'item-savings'), needs: await centsAt(page, 'item-needs'), wants: await centsAt(page, 'item-wants') }).toEqual({ savings: would?.savings, needs: would?.needs, wants: would?.wants });
      // Her setup has no mom reserve: no reserve part.
      expect(await page.getByTestId('item-mom').count()).toBe(0);
      await card.getByTestId('pick-paycheck').click();
      // Asked first, with the same parts; nothing is split yet.
      await page.getByTestId('confirm-yes').waitFor();
      expect(await centsAt(page, 'preview-needs')).toBe(would?.needs);
      expect(bookOf(life).paychecks()).toEqual([]);
      await page.getByTestId('confirm-yes').click();
      await card.waitFor({ state: 'detached' });
      expect(bookOf(life).period()).toEqual({ number: 1, startDate: '2026-10-09' });
    });
  });

  it('3.1 "Not a paycheck" opens the other choices (other income, payback, not mine), with no paycheck among them; "It is a paycheck after all" goes back', async () => {
    const life = await herPaychecks([['pay-1', '2026-10-09', 250_000]]);
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      await item(page, 'pay-1').getByTestId('pick-not-a-paycheck').click();
      const sheet = page.getByTestId('review-sheet');
      await sheet.getByTestId('sheet-picks').waitFor();
      const choices = await sheet.locator('[data-testid^="choice-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      // And, as for any money in, a transfer from her other account (5.6).
      expect(choices).toEqual(['choice-other-income', 'choice-savings', 'choice-needs', 'choice-wants', 'choice-not-mine', 'choice-transfer-savings']);
      await sheet.getByTestId('a-paycheck-after-all').click();
      await sheet.getByTestId('paycheck-ask').waitFor();
      expect(await sheet.getByTestId('paycheck-yes').isVisible()).toBe(true);
      await sheet.getByTestId('not-a-paycheck').click();
      await sheet.getByTestId('choice-other-income').click();
      await item(page, 'pay-1').waitFor({ state: 'detached' });
      expect(bookOf(life).period().number).toBe(0);
      expect(bookOf(life).paychecksWaiting()).toEqual([]);
    });
  });

  it('51.2 with two waiting, the newer one says the older is answered first, and offers no yes until it is', async () => {
    const life = await herPaychecks([
      ['pay-1', '2026-10-09', 250_000],
      ['pay-2', '2026-10-23', 240_000],
    ]);
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      const newer = item(page, 'pay-2');
      expect(await newer.getByTestId('item-paycheck-ask').innerText()).toBe('An older paycheck is still waiting. Answer it first.');
      expect(await newer.getByTestId('pick-paycheck').count()).toBe(0);
      await item(page, 'pay-1').getByTestId('pick-paycheck').click();
      await page.getByTestId('confirm-yes').click();
      await item(page, 'pay-1').waitFor({ state: 'detached' });
      await newer.getByTestId('pick-paycheck').waitFor();
      expect(await newer.getByTestId('item-paycheck-ask').innerText()).toBe('Nothing is split until you say yes.');
    });
  });

  it('B92 a double tap on her yes sends one decision, and splits it once', async () => {
    const life = await herPaychecks([['pay-1', '2026-10-09', 250_000]]);
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      const watch = watchChoices(page);
      await item(page, 'pay-1').getByTestId('pick-paycheck').click();
      await page.getByTestId('confirm-yes').dblclick();
      await item(page, 'pay-1').waitFor({ state: 'detached' });
      await untilQuiet(page);
      expect(new Set(watch.ids()).size).toBe(1);
      expect(bookOf(life).paychecks()).toHaveLength(1);
    });
  });

  it('the design rules on the new card and row: readable contrast, and every tap at least 44 by 44 points', async () => {
    const life = await herPaychecks([['pay-1', '2026-10-09', 250_000]]);
    await served(life, async (page, base) => {
      const small: string[] = [];
      const problems: string[] = [];
      for (const path of ['/home', '/review']) {
        await open(page, base, path);
        problems.push(...(await axeViolations(page)).map((p) => `${path}: ${p}`));
        for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`${path}: ${t.what} is ${t.width}x${t.height}`);
      }
      await item(page, 'pay-1').getByTestId('more').click();
      await page.getByTestId('paycheck-ask').waitFor();
      problems.push(...(await axeViolations(page)).map((p) => `the sheet: ${p}`));
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`the sheet: ${t.what} is ${t.width}x${t.height}`);
      expect(problems).toEqual([]);
      expect(small).toEqual([]);
    }, { bypassCSP: true });
  });
});

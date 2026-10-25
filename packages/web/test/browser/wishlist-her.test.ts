import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryLog } from '../../../server/src/log.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { herLife } from '../../../server/test/her-harness.js';
import { choose, decision, noonInNewYork, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { amountAt, readActivity } from './activity-screens.js';
import { axeViolations, tappable } from './design-helpers.js';
import { ENGINES, WEB_ROOT, centsAt, close, launch, listen, phone, textAt, untilAnswered, untilQuiet, waitOrReport } from './harness.js';
import { item, watchChoices } from './screens.js';

// Her rulebook, PR 9, on the screens of the real server, used in a browser
// like a person would: a purchase sorted to Wishlist from Review's "More
// choices", Wishlist in the Savings card on Buckets with its own list, Home
// saying what to move from savings to checking (50.4), and a hand move out of
// Wishlist asking first (13.4). Every name and number is made up.

const E = ACCOUNT_IDS.everyday;
const words = (text: string): string => text.replace(/\s+/g, ' ').trim();

// Setup day with Wishlist 300.00, then a 50.00 purchase on the everyday card
// waiting in review.
async function herWithAPurchase(): Promise<Life> {
  const life = await herLife();
  const k = life.keeper;
  for (const setup of [
    { lastPaycheck: '2026-09-25' },
    { assign: { pot: 'savings' as const, amount: 400_000 } },
    { assign: { pot: 'wishlist' as const, amount: 30_000 } },
    { assign: { pot: 'wants' as const, amount: 20_000 } },
    { assign: { pot: 'needs' as const, rest: true as const } },
  ]) {
    const answer = k.setup({ id: decision(), setup });
    if (!answer.ok) throw new Error(`setup day refused ${JSON.stringify(setup)}: ${answer.why}`);
  }
  const view = k.setupView();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
  const started = k.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: view.key });
  if (!started.ok) throw new Error(`tracking did not start: ${started.why}`);
  life.h.fake.addPosted({ id: 'gadget-1', account: E, amount: 5_000, date: '2026-10-03', description: 'MADE UP GADGETS' });
  life.now = noonInNewYork('2026-10-03');
  await life.sync();
  return life;
}

async function open(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`);
  await waitOrReport(page, 'main[aria-busy="false"]');
  await untilAnswered(page);
  await untilQuiet(page);
}

describe.each(ENGINES)('her Wishlist on the screens, in %s', (_name, engine) => {
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
      // axe is put on the page by the test, which the real server's page rules would refuse.
      const context = await browser!.newContext(phone({ bypassCSP: true }));
      await context.addCookies([loginCookieForTests(life.h.db, life.now, base)]);
      await run(await context.newPage(), base);
      await context.close();
    } finally {
      if (server !== undefined) await close(server);
      life.done();
    }
  }

  it('4.2 Review offers Wishlist under "More choices"; sorting to it takes it out of Wishlist, and Buckets shows Wishlist in the Savings card', async () => {
    const life = await herWithAPurchase();
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      // The two quick choices stay needs and wants (HB25).
      expect(await item(page, 'gadget-1').getByTestId('pick-wishlist').count()).toBe(0);
      await item(page, 'gadget-1').getByTestId('more').click();
      const sheet = page.getByTestId('review-sheet');
      await sheet.waitFor();
      expect(words(await sheet.getByTestId('choice-wishlist').innerText())).toContain('Wishlist');
      expect(await axeViolations(page)).toEqual([]);
      await sheet.getByTestId('choice-wishlist').click();
      await item(page, 'gadget-1').waitFor({ state: 'detached' });
      expect(life.keeper.book()?.pots().wishlist).toBe(25_000);

      await open(page, base, '/buckets');
      const row = page.getByTestId('row-wishlist');
      expect(words(await row.innerText())).toContain('Wishlist');
      expect(await centsAt(page, 'wishlist')).toBe(25_000);
      for (const t of await tappable(page)) expect(Math.min(t.width, t.height), t.what).toBeGreaterThanOrEqual(44);
      expect(await axeViolations(page)).toEqual([]);

      // Its own list, with the purchase on it (B97).
      await row.click();
      await waitOrReport(page, '[data-testid="activity-now"]');
      await untilQuiet(page);
      expect(new URL(page.url()).pathname).toBe('/buckets/wishlist');
      const shown = await readActivity(page);
      const books = life.keeper.book()!.activity('wishlist');
      expect({ now: shown.now, opening: shown.opening, out: shown.out }).toEqual({ now: books.closing, opening: books.opening, out: books.out });
      expect(shown.rows.map((r) => r.id)).toContain('gadget-1');
      expect(await axeViolations(page)).toEqual([]);
    });
  });

  // PR 12, found by the agent on her screens (HB30).
  it('4.4 the split sheet splits a purchase across needs and wants only: Wishlist, which gets the rest, gets nothing, and it is not refused (HB30)', async () => {
    const life = await herWithAPurchase();
    const before = life.keeper.book()!.pots();
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      await item(page, 'gadget-1').getByTestId('more').click();
      const sheet = page.getByTestId('review-sheet');
      await sheet.waitFor();
      expect(words(await sheet.getByTestId('split-rest').innerText())).toBe('Wishlist gets the rest.');
      await sheet.getByTestId('split-needs').fill('30.00');
      await sheet.getByTestId('split-wants').fill('20.00');
      await sheet.getByTestId('split-submit').click();
      await item(page, 'gadget-1').waitFor({ state: 'detached' });
      const after = life.keeper.book()!.pots();
      expect([after.needs, after.wants, after.wishlist]).toEqual([before.needs - 3_000, before.wants - 2_000, before.wishlist]);
    });
  });

  // PR 12, found by the agent on her screens: the sheet showed "Mom reserve
  // $0.00" and had no Wishlist row.
  it('Off in this setup: the paycheck rule\'s "what it would do" sheet lists her buckets with Wishlist, and nothing about a mom reserve', async () => {
    const life = await herWithAPurchase();
    await served(life, async (page, base) => {
      await open(page, base, '/settings');
      await page.getByTestId('row-paycheck-rule').click();
      await page.getByTestId('field-paycheck-rule').fill('MADEUP CORP PAYROLL');
      await page.getByTestId('sheet-save').click();
      const preview = page.getByTestId('preview');
      await preview.waitFor();
      expect(await preview.getByTestId('preview-momReserve').count()).toBe(0);
      expect(words(await preview.innerText()).toLowerCase()).not.toContain('mom');
      expect(words(await preview.getByTestId('preview-wishlist').innerText())).toBe('Wishlist $300.00 $300.00');
    });
  });

  it('50.4 Home says to move the Wishlist purchase from savings to checking, and when', async () => {
    const life = await herWithAPurchase();
    const sorted = choose(life.keeper, { item: 'gadget-1', choice: { to: 'wishlist' } });
    if (!sorted.ok) throw new Error(`gadget-1: ${sorted.why}`);
    await served(life, async (page, base) => {
      await open(page, base, '/home');
      expect(words(await page.getByTestId('wishlist-move-row').innerText())).toBe(
        "Move $50.00 from savings to checking For what you bought from Wishlist, whose money is kept in savings. Before the Made-up Everyday Card's next due date.",
      );
      expect(await axeViolations(page)).toEqual([]);
    });
  });

  it('Section 2 Settings changes the split four ways: each share is sent as typed, Wishlist too (13.1)', async () => {
    const life = await herWithAPurchase();
    await served(life, async (page, base) => {
      await open(page, base, '/settings');
      const watch = watchChoices(page);
      await page.getByTestId('row-split').click();
      await page.getByTestId('settings-sheet').waitFor();
      for (const [testId, value] of [['field-savings', '45'], ['field-needs', '30'], ['field-wants', '15'], ['field-wishlist', '10']] as const) await page.getByTestId(testId).fill(value);
      expect(await axeViolations(page)).toEqual([]);
      await page.getByTestId('sheet-save').click();
      await expect.poll(() => watch.posts.length).toBeGreaterThan(0);
      expect(JSON.parse(watch.posts[0]?.postData() ?? '{}')).toMatchObject({ settings: { split: { savings: 45, needs: 30, wants: 15, wishlist: 10 } } });
    });
  });

  it('13.4 a hand move out of Wishlist asks first, and lists Wishlist among the buckets', async () => {
    const life = await herWithAPurchase();
    await served(life, async (page, base) => {
      await open(page, base, '/buckets');
      await page.getByTestId('move-open').click();
      expect(await page.getByTestId('move-from').locator('option').allInnerTexts()).toContain('Wishlist · $300.00');
      await page.getByTestId('move-from').selectOption('wishlist');
      await page.getByTestId('move-to').selectOption('wants');
      await page.getByTestId('move-amount').fill('10.00');
      await page.getByTestId('move-submit').click();
      await page.getByTestId('move-confirm-ask').waitFor();
      expect(await textAt(page, 'move-confirm-ask')).toContain('takes money out of Wishlist');
      expect(life.keeper.book()?.pots().wishlist).toBe(30_000);
      await page.getByTestId('move-confirm-yes').click();
      await page.getByTestId('move-sheet').waitFor({ state: 'hidden' });
      await untilQuiet(page);
      expect(life.keeper.book()?.pots().wishlist).toBe(29_000);
      expect(await amountAt(page, 'wishlist')).toBe(29_000);
    });
  });
});

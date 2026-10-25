import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryLog } from '../../../server/src/log.js';
import { parseRequest } from '../../../server/src/choices.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { herLife } from '../../../server/test/her-harness.js';
import { decision, noonInNewYork, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { axeViolations, tappable } from './design-helpers.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, untilAnswered, untilQuiet, waitOrReport } from './harness.js';
import { item } from './screens.js';

// Her rulebook, PR 10+11, on the screens of the real server, used in a
// browser like a person would: her Wishlist list on Wishlist's screen (50.1,
// 50.2: added, moved, changed and removed, each item's progress in words), and
// Review asking which thing a Wishlist purchase was (50.3: marked bought, the
// bucket down by what it cost, and changed back). Every name and number is
// made up.

const E = ACCOUNT_IDS.everyday;
const words = (text: string): string => text.replace(/\s+/g, ' ').trim();

// Setup day with Wishlist 300.00, then a 43.12 purchase on the everyday card
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
  life.h.fake.addPosted({ id: 'lamp-1', account: E, amount: 4_312, date: '2026-10-03', description: 'MADE UP LAMPS' });
  life.now = noonInNewYork('2026-10-03');
  await life.sync();
  return life;
}

function add(life: Life, name: string, price: number): void {
  const request = parseRequest({ id: decision(), wishlist: { add: { name, price } } });
  if (request === null || !('wishlist' in request) || !life.keeper.wishlist(request).ok) throw new Error(`could not add ${name}`);
}

async function open(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`);
  await waitOrReport(page, 'main[aria-busy="false"]');
  await untilAnswered(page);
  await untilQuiet(page);
}

describe.each(ENGINES)('her Wishlist list on the screens, in %s', (_name, engine) => {
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

  it('50.1 50.2 Wishlist\'s screen: an empty list says so; items are added, moved and removed (asking first), and each says how far along it is in words', async () => {
    const life = await herWithAPurchase();
    await served(life, async (page, base) => {
      await open(page, base, '/buckets/wishlist');
      expect(words(await page.getByTestId('wishlist-empty').innerText())).toContain('Nothing on your list yet');

      for (const [name, price] of [['Rain jacket', '250'], ['Desk lamp', '45']] as const) {
        await page.getByTestId('wishlist-add').click();
        await page.getByTestId('wishlist-sheet').waitFor();
        await page.getByTestId('item-name').fill(name);
        await page.getByTestId('item-price-field').fill(price);
        await page.getByTestId('item-save').click();
        await page.getByTestId('wishlist-sheet').waitFor({ state: 'hidden' });
        await untilQuiet(page);
      }
      // Wishlist 300.00 fills the jacket (250.00), then 50.00 of the lamp's 45.00, and 5.00 more than the list needs.
      expect(words(await page.getByTestId('wishlist-item-item-1').getByTestId('item-progress').innerText())).toBe('Ready Ready: $250.00 of $250.00');
      expect(words(await page.getByTestId('wishlist-item-item-2').getByTestId('item-progress').innerText())).toBe('Ready Ready: $45.00 of $45.00');
      expect(words(await page.getByTestId('wishlist-more').innerText())).toBe('More than the list needs: $5.00');
      for (const t of await tappable(page)) expect(Math.min(t.width, t.height), t.what).toBeGreaterThanOrEqual(44);
      expect(await axeViolations(page)).toEqual([]);

      // A price change that leaves the jacket short says so, in words.
      await page.getByTestId('wishlist-item-item-1').getByTestId('item-change').click();
      await page.getByTestId('item-price-field').fill('400');
      await page.getByTestId('item-save').click();
      await page.getByTestId('wishlist-sheet').waitFor({ state: 'hidden' });
      await untilQuiet(page);
      expect(words(await page.getByTestId('wishlist-item-item-1').getByTestId('item-progress').innerText())).toBe('$300.00 of $400.00, 75% of the way');
      expect(words(await page.getByTestId('wishlist-item-item-2').getByTestId('item-progress').innerText())).toBe('Nothing yet of $45.00');

      // The lamp moved up gets the money first.
      await page.getByTestId('wishlist-item-item-2').getByTestId('item-up').click();
      await untilQuiet(page);
      expect(await page.locator('[data-testid^="wishlist-item-"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid')))).toEqual(['wishlist-item-item-2', 'wishlist-item-item-1']);

      // Removing asks first; "Keep it" changes nothing.
      await page.getByTestId('wishlist-item-item-1').getByTestId('item-remove').click();
      await page.getByTestId('remove-no').click();
      await untilQuiet(page);
      expect(life.keeper.activity('wishlist')).toMatchObject({ list: { items: [{ id: 'item-2' }, { id: 'item-1' }] } });
      await page.getByTestId('wishlist-item-item-1').getByTestId('item-remove').click();
      await page.getByTestId('remove-yes').click();
      await page.getByTestId('wishlist-sheet').waitFor({ state: 'hidden' });
      await untilQuiet(page);
      expect(await page.getByTestId('wishlist-item-item-1').count()).toBe(0);
      expect(await page.getByTestId('wishlist-log-line').allInnerTexts()).toHaveLength(5);
      expect(life.keeper.book()?.pots().wishlist).toBe(30_000);
    });
  });

  it('50.3 Review asks which thing on her list the purchase was; the one picked is bought, Wishlist goes down by what it cost, and it can be changed back', async () => {
    const life = await herWithAPurchase();
    add(life, 'Desk lamp', 4_500);
    add(life, 'Rain jacket', 25_000);
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      await item(page, 'lamp-1').getByTestId('more').click();
      const sheet = page.getByTestId('review-sheet');
      await sheet.getByTestId('choice-wishlist').click();
      await sheet.getByTestId('which-item-title').waitFor();
      expect(words(await sheet.getByTestId('which-item-1').innerText())).toBe('Desk lamp Price $45.00');
      expect(await sheet.getByTestId('which-none').count()).toBe(1);
      expect(await axeViolations(page)).toEqual([]);
      await sheet.getByTestId('which-item-1').click();
      await item(page, 'lamp-1').waitFor({ state: 'detached' });
      // What it cost, 43.12, never the price, 45.00.
      expect(life.keeper.book()?.pots().wishlist).toBe(30_000 - 4_312);

      await open(page, base, '/buckets/wishlist');
      expect(words(await page.getByTestId('bought-lamp-1').innerText())).toContain('Desk lamp Bought Sat, Oct 3 for $43.12. Its price was $45.00.');
      expect(words(await page.getByTestId('row-lamp-1').innerText())).toContain('Bought: Desk lamp');
      await page.getByTestId('bought-lamp-1').getByTestId('bought-undo').click();
      await page.getByTestId('wishlist-item-item-1').waitFor();
      expect(await page.getByTestId('bought-lamp-1').count()).toBe(0);
      expect(life.keeper.book()?.pots().wishlist).toBe(30_000 - 4_312);
    });
  });
});

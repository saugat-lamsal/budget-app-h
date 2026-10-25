import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryLog } from '../../../server/src/log.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { herLife } from '../../../server/test/her-harness.js';
import { choose, decision, noonInNewYork, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { axeViolations, tappable } from './design-helpers.js';
import { ENGINES, WEB_ROOT, centsAt, close, launch, listen, phone, untilAnswered, untilQuiet, waitOrReport } from './harness.js';
import { barWords } from '../../src/screens/trends-text.js';
import { shownTrends } from '../../../server/src/views/off.js';
import { HER_SWITCHES } from '@budget-app/money';

// Her rulebook, PR 10+11, on the screens of the real server: Trends with
// Wishlist's parts. Wishlist is its own part of the pay period's bar (40.2,
// 40.4), said in words too, and Wishlist over time is beside savings (40.5).
// No old card part and no mom reserve. Every name and number is made up.

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

async function open(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`);
  await waitOrReport(page, 'main[aria-busy="false"]');
  await untilAnswered(page);
  await untilQuiet(page);
}

describe.each(ENGINES)('her Trends with Wishlist on the screens, in %s', (_name, engine) => {
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

  it('40.2 40.4 40.5 the bar has a Wishlist part with its amount and words; Wishlist now is beside savings; no old card part', async () => {
    const life = await herWithAPurchase();
    const sorted = choose(life.keeper, { item: 'lamp-1', choice: { to: 'wishlist' } });
    if (!sorted.ok) throw new Error(`lamp-1: ${sorted.why}`);
    await served(life, async (page, base) => {
      await open(page, base, '/trends');
      const view = shownTrends(life.keeper.trends(), HER_SWITCHES);
      if (view.state !== 'tracking') throw new Error('not tracking');
      const last = view.periods[view.periods.length - 1];
      expect(last?.spent.wishlist).toBe(4_312);
      expect(await centsAt(page, 'period-part-wishlist')).toBe(4_312);
      expect(await page.getByTestId('period-part-old-card').count()).toBe(0);
      const bars = page.getByTestId('trends-periods').locator('.pbar');
      expect(await bars.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(view.periods.map(barWords));
      expect(words((await bars.last().getAttribute('aria-label')) ?? '')).toContain('wishlist $43.12');
      expect(await centsAt(page, 'wishlist-now')).toBe(30_000 - 4_312);
      expect(await page.getByTestId('mom-now').count()).toBe(0);
      expect(await page.getByTestId('savings-chart').getAttribute('aria-label')).toContain('Wishlist from $300.00 to $256.88');
      for (const t of await tappable(page)) expect(Math.min(t.width, t.height), t.what).toBeGreaterThanOrEqual(44);
      expect(await axeViolations(page)).toEqual([]);
    });
  });
});

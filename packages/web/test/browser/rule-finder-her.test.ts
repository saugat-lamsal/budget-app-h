import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryLog } from '../../../server/src/log.js';
import { finderLife, setUpHer } from '../../../server/test/her-harness.js';
import type { Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, untilAnswered, untilQuiet, waitOrReport } from './harness.js';

// Her rulebook, section 53: the rule finder on her setup day's rules step,
// used in a browser like a person would, on the real server with a made-up
// history in two wording styles. Each answer reaches the server and the
// screen shows it. Every name and number is made up.

describe.each(ENGINES)('53.1 the rule finder on her setup day, in %s', (_name, engine) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function served(run: (page: Page, life: Life) => Promise<void>): Promise<void> {
    const life = await finderLife();
    let server: Server | undefined;
    try {
      let base = '';
      server = life.keeper.server(WEB_ROOT, () => base, undefined, { bank: { plaid: life.h.plaid, box: life.h.box, log: memoryLog([]) } });
      base = await listen(server);
      const context = await browser!.newContext(phone());
      await context.addCookies([loginCookieForTests(life.h.db, life.now, base)]);
      const page = await context.newPage();
      await page.goto(`${base}/setup/rules`);
      await waitOrReport(page, 'main[aria-busy="false"]');
      await untilAnswered(page);
      await untilQuiet(page);
      await run(page, life);
      await context.close();
    } finally {
      if (server !== undefined) await close(server);
      life.done();
    }
  }

  const settle = async (page: Page): Promise<void> => {
    await untilAnswered(page);
    await untilQuiet(page);
  };

  it('53.1 53.8 53.9 her groups, each suggestion with what it matched; keep, keep as needs, change its words (checked first), and skip a group', async () => {
    await served(async (page, life) => {
      const main = page.locator('main');
      // In place of the labels' suggestions, the finder's groups.
      await expect(main.getByTestId('suggestions').count()).resolves.toBe(0);
      for (const group of ['card-payments', 'people-fees', 'paycheck', 'places']) await expect(main.getByTestId(`found-group-${group}`).count()).resolves.toBe(1);
      const cards = main.getByTestId('found-group-card-payments');
      await expect(cards.innerText()).resolves.toContain('“TO CRD 0412”');
      await expect(cards.innerText()).resolves.toContain('It would have matched 3 items on checking');

      // Keep the Capital One card's side of the card payments.
      const capitalOne = cards.locator('article', { hasText: '“CAPITAL ONE PYMT RECEIVED”' });
      await capitalOne.getByTestId('found-keep').click();
      await settle(page);
      await expect(cards.locator('article', { hasText: '“CAPITAL ONE PYMT RECEIVED”' }).getByTestId('found-status').innerText()).resolves.toBe('Kept');
      await expect(main.getByTestId('setup-bank-rules').innerText()).resolves.toContain('CAPITAL ONE PYMT RECEIVED');

      // The place, kept as needs.
      const leaf = main.getByTestId('found-group-places').locator('article', { hasText: '“GREEN LEAF MARKET”' });
      await expect(leaf.innerText()).resolves.toContain('Suggested: Needs');
      await leaf.getByTestId('found-keep-needs').click();
      await settle(page);
      await expect(main.getByTestId('found-group-places').getByTestId('found-status').first().innerText()).resolves.toBe('Kept as needs');

      // Change the checking side's words: it asks first, with what they match.
      const leaving = cards.locator('article', { hasText: '“TO CRD 0412”' });
      await leaving.getByTestId('found-change').click();
      await leaving.getByTestId('found-words').fill('ONLINE PMT');
      await leaving.getByTestId('found-check').click();
      await settle(page);
      await expect(leaving.getByTestId('found-preview').innerText()).resolves.toContain('It would have matched 3 items on checking');
      await leaving.getByTestId('found-keep-changed').click();
      await settle(page);
      await expect(main.getByTestId('setup-bank-rules').innerText()).resolves.toContain('ONLINE PMT');

      // Skip the rest of the card payments.
      await main.getByTestId('skip-group-card-payments').click();
      await settle(page);
      await expect(main.getByTestId('skip-group-card-payments').count()).resolves.toBe(0);

      // The sheet, in plain words.
      await main.getByTestId('row-finder-about').click();
      await expect(page.locator('dialog[open]').innerText()).resolves.toContain('Your buckets don’t change');

      // What the server keeps: two bank rules from the finder, the place waiting for tracking.
      const view = life.keeper.setupView();
      if (view.state !== 'not-set-up' || !view.ready || view.found === undefined) throw new Error('not ready');
      expect(view.found.filter((l) => l.status === 'added' || l.status === 'changed').map((l) => l.rule.contains).sort()).toEqual(['CAPITAL ONE PYMT RECEIVED', 'GREEN LEAF MARKET', 'ONLINE PMT']);
    });
  });

  // Found in her rehearsal: the bucket picked while changing a place's words
  // showed by its color only, and a kept place did not say what it was kept as.
  it('53.1 a place: the bucket picked is marked by more than color, and what it was kept as is said in words', async () => {
    await served(async (page) => {
      const leaf = page.locator('main').getByTestId('found-group-places').locator('article', { hasText: 'GREEN LEAF' });
      await leaf.getByTestId('found-change').click();
      const needs = leaf.getByTestId('found-bucket-needs');
      const wants = leaf.getByTestId('found-bucket-wants');
      // The suggestion, needs, is picked to start: pressed, with a check.
      await expect(needs.getAttribute('aria-pressed')).resolves.toBe('true');
      await expect(wants.getAttribute('aria-pressed')).resolves.toBe('false');
      await expect(needs.locator('svg').count()).resolves.toBe(1);
      await expect(wants.locator('svg').count()).resolves.toBe(0);
      await wants.click();
      await expect(wants.getAttribute('aria-pressed')).resolves.toBe('true');
      await expect(needs.getAttribute('aria-pressed')).resolves.toBe('false');
      await expect(wants.locator('svg').count()).resolves.toBe(1);
      await expect(needs.locator('svg').count()).resolves.toBe(0);
      await leaf.getByTestId('found-words').fill('GREEN LEAF');
      await leaf.getByTestId('found-check').click();
      await settle(page);
      await leaf.getByTestId('found-keep-changed').click();
      await settle(page);
      await expect(leaf.getByTestId('found-status').innerText()).resolves.toBe('Kept as wants, with your words');
      // The bucket it was kept as has the check; the words no longer call it a suggestion.
      await expect(leaf.getByTestId('found-keep-wants').locator('svg').count()).resolves.toBe(1);
      await expect(leaf.getByTestId('found-keep-needs').locator('svg').count()).resolves.toBe(0);
      await expect(leaf.innerText()).resolves.not.toContain('Suggested');
    });
  });

  // HA10: once tracking starts, Settings' change log names what she kept.
  it('13.5 53.1 after setup day, Settings\' change log says so, with the rules she kept from the finder', async () => {
    await served(async (page, life) => {
      const leaf = page.locator('main').getByTestId('found-group-places').locator('article', { hasText: 'GREEN LEAF' });
      await leaf.getByTestId('found-keep-needs').click();
      await settle(page);
      setUpHer(life);
      await page.goto(page.url().replace('/setup/rules', '/settings'));
      await waitOrReport(page, 'main[aria-busy="false"]');
      await settle(page);
      const log = page.locator('main').getByTestId('log');
      await expect(log.innerText()).resolves.toContain('Setup day');
      await expect(log.innerText()).resolves.toContain('Tracking started. Kept from your history: “GREEN LEAF MARKET” → Needs.');
    });
  });
});

import type { Server } from 'node:http';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HER_START } from '../../../server/src/setup-start.js';
import { HER_BANK_RULES, setUpHer } from '../../../server/test/her-harness.js';
import { lifeInAFile, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { statusLines } from '../../src/screens/status-text.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, textAt, untilAnswered, waitOrReport } from './harness.js';

// Her rulebook, 0.7 (PR 6), on the real server in a browser: the status page
// with her two banks shows each bank's last read and last sync, by name, in
// "The bank" card. Found by the agent on her screens in PR 12: the lines were
// sent and counted in "needs a look" but drawn in no card. Every name and
// number is made up.

// Her two made-up banks, set up, read, then a sync where the second fails.
async function herTwoBanks(): Promise<Life> {
  const life = await lifeInAFile({ herSetup: true, twoBanks: true, secondCard: 25_000, rules: HER_BANK_RULES, start: HER_START });
  setUpHer(life);
  life.now = new Date('2026-10-02T13:00:00Z');
  await life.sync();
  const second = life.h.second;
  if (second === undefined) throw new Error('her second bank is not connected');
  life.now = new Date('2026-10-02T14:00:00Z');
  second.beforeCall = () => 'network';
  await life.sync().catch(() => undefined);
  second.beforeCall = undefined;
  return life;
}

describe.each(ENGINES)('her status page with two banks, in %s', (_name, engine) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('0.7 each bank\'s last read and last sync, by name, are in "The bank" card, and the one that needs a look is the one counted', async () => {
    const life = await herTwoBanks();
    let server: Server | undefined;
    try {
      let base = '';
      server = life.keeper.server(WEB_ROOT, () => base);
      base = await listen(server);
      const lines = statusLines(life.keeper.statusView());
      expect(lines.filter((l) => l.id.startsWith('last-')).map((l) => l.id)).toEqual(['last-read-1', 'last-sync-1', 'last-read-2', 'last-sync-2']);
      const context = await browser!.newContext(phone());
      await context.addCookies([loginCookieForTests(life.h.db, life.now, base)]);
      const page = await context.newPage();
      await page.goto(`${base}/status`);
      await waitOrReport(page, '[data-testid="status-summary"]');
      await untilAnswered(page);
      const card = page.getByTestId('status-card-bank');
      for (const line of lines.filter((l) => l.id.startsWith('last-'))) {
        expect(await card.getByTestId(`status-${line.id}`).count(), line.id).toBe(1);
        expect(await textAt(page, `status-${line.id}`)).toBe(`${line.title} ${line.detail}`);
      }
      expect(await textAt(page, 'status-last-sync-2')).toContain('Made-up Second Bank: last sync');
      // Every line counted in "needs a look" is drawn, with the warning icon.
      for (const line of lines.filter((l) => l.look)) expect(await page.getByTestId(`status-${line.id}`).locator('[data-icon="alert"]').count(), line.id).toBe(1);
      expect(await textAt(page, 'status-summary')).toBe('1 thing needs a look');
      await context.close();
    } finally {
      if (server !== undefined) await close(server);
      life.done();
    }
  });
});

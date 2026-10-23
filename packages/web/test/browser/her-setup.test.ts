import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POT_SLUGS } from '../../../server/src/views/activity.js';
import { herLife, herWeeks } from '../../../server/test/her-harness.js';
import type { Life } from '../../../server/test/keeper-harness.js';
import { memoryLog } from '../../../server/src/log.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, untilAnswered, untilQuiet, waitOrReport } from './harness.js';

// Her rulebook, "Off in this setup": the real server on her setup (no mom
// reserve, no old card), used in a browser like a person would. Every screen,
// every sheet its rows open, and every choice in its lists is read, and none
// says anything about the mom reserve or the old card. Every name and number
// is made up.

// What must never be read on her screens.
const OFF_WORDS = /\bmom\b|old.?card|reserve|promo|payoff|\bdebt/i;

const SCREENS = ['/home', '/buckets', '/review', '/trends', '/settings', '/payday', '/alerts', '/bank', '/status', ...Object.keys(POT_SLUGS).map((slug) => `/buckets/${slug}`)];
const SETUP_STEPS = ['bank', 'rules', 'transfers', 'paycheck', 'assign', 'check'] as const;

// Card titles are in capitals on the screen; what they say is compared as written.
const words = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

// The text of what is in view, with the words of every choice in its lists.
async function readOf(page: Page, selector: string): Promise<string> {
  const where = page.locator(selector).first();
  const options = await where.locator('option').allTextContents();
  return words(`${await where.innerText()} ${options.join(' ')}`);
}

async function open(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`);
  await waitOrReport(page, 'main[aria-busy="false"], [data-testid="settings"]');
  await untilAnswered(page);
  await untilQuiet(page);
}

// Opens the sheet a tap on this opens, reads it, and closes it. Null when the
// tap opened none.
async function sheetOf(page: Page, base: string, path: string, opener: string, index: number): Promise<string | null> {
  await open(page, base, path);
  await page.locator(opener).nth(index).click();
  const sheet = page.locator('dialog[open]');
  try {
    await sheet.first().waitFor({ timeout: 2_000 });
  } catch {
    return null;
  }
  await untilQuiet(page);
  return readOf(page, 'dialog[open]');
}

// Every sheet the buttons on a screen open, by the button's test id.
async function sheetsOn(page: Page, base: string, path: string, opener: string): Promise<Record<string, string>> {
  await open(page, base, path);
  const ids = await page.locator(opener).evaluateAll((all) => all.map((e) => e.getAttribute('data-testid') ?? e.textContent ?? ''));
  const read: Record<string, string> = {};
  for (const [i, id] of ids.entries()) {
    const text = await sheetOf(page, base, path, opener, i);
    if (text !== null) read[`${path} ${id} (${i})`] = text;
  }
  return read;
}

function expectNothingOff(read: Record<string, string>): void {
  for (const [where, text] of Object.entries(read)) expect(text, `${where}: ${text}`).not.toMatch(OFF_WORDS);
}

describe.each(ENGINES)('Off in this setup: her setup, in %s', (_name, engine) => {
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
      // The Bank screen reads the made-up bank through Plaid's made-up client.
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

  it('Off in this setup: weeks into her setup, no screen, sheet, or list says anything about a mom reserve or an old card', async () => {
    await served(await herWeeks(), async (page, base) => {
      const read: Record<string, string> = {};
      for (const path of SCREENS) {
        await open(page, base, path);
        read[path] = await readOf(page, 'main');
      }
      // Her screens have what they should: her buckets, her paycheck, her friend's money waiting.
      expect(read['/buckets']).toContain('savings');
      expect(read['/review']).toContain('made up friend paid back');
      expect(read['/settings']).toContain('paycheck split');
      expect(read['/buckets/mom-reserve']).toContain('not in your setup');
      Object.assign(
        read,
        await sheetsOn(page, base, '/settings', 'main button[data-testid^="row-"]'),
        await sheetsOn(page, base, '/review', 'main [data-testid="more"]'),
        await sheetsOn(page, base, '/buckets', 'main [data-testid="move-open"]'),
      );
      // The sheets were opened: the split, a bank rule, the moves, the choices for her friend's money.
      const sheets = Object.keys(read).filter((k) => !SCREENS.includes(k));
      // Every Settings row that opens a sheet: 20 of them on her setup.
      expect(sheets.filter((k) => k.startsWith('/settings')).length).toBeGreaterThanOrEqual(20);
      expect(sheets.some((k) => k.includes('row-split'))).toBe(true);
      expect(sheets.some((k) => k.includes('row-add-bank-rule'))).toBe(true);
      expect(sheets.some((k) => k.startsWith('/review'))).toBe(true);
      expect(sheets.some((k) => k.startsWith('/buckets'))).toBe(true);
      // A bank rule is on one of her four accounts.
      const bankRule = read[sheets.find((k) => k.includes('row-add-bank-rule')) ?? ''] ?? '';
      expect(bankRule).toContain('everyday card');
      expectNothingOff(read);
    });
  });

  // PR 5: her four accounts, with her second card (her rulebook, 1.2).
  it('Off in this setup: before setup day, her setup asks for four accounts with the second card, and setup day says nothing about a mom reserve or an old card', async () => {
    await served(await herLife(), async (page, base) => {
      const read: Record<string, string> = {};
      for (const step of SETUP_STEPS) {
        await open(page, base, `/setup/${step}`);
        read[`/setup/${step}`] = await readOf(page, 'main');
      }
      Object.assign(read, await sheetsOn(page, base, '/setup/rules', 'main [data-testid="row-add-bank-rule"]'));
      await open(page, base, '/bank');
      read['/bank'] = await readOf(page, 'main');
      // The accounts she picks, four of them: the second card, never the old card.
      const change = page.getByTestId('bank-change-picks');
      if ((await change.count()) > 0) await change.click();
      await page.getByTestId('bank-pick').waitFor();
      read['/bank picking'] = await readOf(page, 'main');
      expect(read['/bank picking']).toContain('four');
      expect(read['/bank picking']).not.toContain('three');
      expect(read['/bank picking']).toContain('second card');
      expect(await page.locator('[data-testid^="bank-pick-"][data-testid$="card"], [data-testid="bank-pick-checking"], [data-testid="bank-pick-savings"]').count()).toBe(4);
      expectNothingOff(read);
    });
  });
});

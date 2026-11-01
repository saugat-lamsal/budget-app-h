import type { Server } from 'node:http';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readHistory } from '../../../server/src/history/history-db.js';
import { serverLinesIn } from '../../../server/src/server-log.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { choose, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { axeViolations } from './design-helpers.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, readCents, textAt, untilAnswered, untilQuiet, waitOrReport } from './harness.js';

// Step 3 on the real server, in a browser like a person would use it: Home's
// "Checked at", the sync card on Settings, and a tap on Review about an item
// a sync changed after the screen showed it, which is refused with why and
// shows the item as it is now. Logged in the tests' way (login-for-tests.ts).
// Every name and number is made up.

const E = ACCOUNT_IDS.everyday;

interface Running {
  readonly life: Life;
  readonly server: Server;
  readonly base: string;
  readonly context: BrowserContext;
}

describe.each(ENGINES)('syncing on the real server in %s', (_name, engine) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function realServer(colorScheme: 'light' | 'dark' = 'light'): Promise<Running> {
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    life.now = noonInNewYork('2026-10-03');
    const r = { life, server: undefined as unknown as Server, base: '', context: undefined as unknown as BrowserContext };
    (r as { server: Server }).server = life.keeper.server(WEB_ROOT, () => r.base);
    r.base = await listen(r.server);
    (r as { context: BrowserContext }).context = await browser!.newContext(phone({ colorScheme, bypassCSP: true }));
    await r.context.addCookies([loginCookieForTests(life.h.db, life.now, r.base)]);
    return r;
  }

  async function done(r: Running): Promise<void> {
    await r.context.close();
    await close(r.server);
    r.life.done();
  }

  const amountOf = async (page: Page, id: string): Promise<number> => readCents(await page.getByTestId(`item-${id}`).getByTestId('item-amount').innerText());

  async function open(r: Running, path: string): Promise<Page> {
    const page = await r.context.newPage();
    await page.goto(`${r.base}${path}`);
    await waitOrReport(page, 'main[aria-busy="false"], [data-testid="settings"]');
    await untilAnswered(page);
    return page;
  }

  it('Step 3 Home says when the bank was last read, in his home time zone, and moves on with each sync', async () => {
    const r = await realServer();
    try {
      await r.life.sync();
      const page = await open(r, '/home');
      expect(await textAt(page, 'checked-at')).toBe('Checked at 12:00 PM');
      r.life.now = new Date('2026-10-03T21:05:00Z');
      await r.life.sync();
      await page.reload();
      await waitOrReport(page, 'main[aria-busy="false"]');
      await untilQuiet(page);
      expect(await textAt(page, 'checked-at')).toBe('Checked at 5:05 PM');
    } finally {
      await done(r);
    }
  });

  it('Step 3 section 2 Settings: how often it syncs and when it last read the bank; changed on its sheet, it applies at once and is in the change log', async () => {
    const r = await realServer();
    try {
      await r.life.sync();
      const page = await open(r, '/settings');
      await waitOrReport(page, '[data-testid="row-sync-every"]');
      expect(await textAt(page, 'row-sync-every')).toContain('Every 60 minutes · Checked at 12:00 PM');
      await page.getByTestId('row-sync-every').click();
      await page.getByTestId('sync-minutes').fill('14');
      await page.getByTestId('sheet-save').click();
      await waitOrReport(page, '[data-testid="sheet-problem"]');
      expect(await textAt(page, 'sheet-problem')).toBe('Syncing with the bank takes a whole number of minutes, 15 to 1,440. Nothing was changed.');
      await page.getByTestId('sync-minutes').fill('30');
      await page.getByTestId('sheet-save').click();
      await waitOrReport(page, '[data-testid="notice"]');
      await untilQuiet(page);
      expect(await textAt(page, 'notice')).toContain('Sync with the bank: every 30 minutes, from now on.');
      expect(r.life.keeper.syncEveryMinutes()).toBe(30);
      expect(await textAt(page, 'row-sync-every')).toContain('Every 30 minutes');
      expect(serverLinesIn(r.life.h.db).at(-1)).toMatchObject({ action: 'sync-every-changed', before: 60, after: 30 });
      expect(await textAt(page, 'log')).toContain('Every 60 minutes → every 30 minutes');
    } finally {
      await done(r);
    }
  });

  it('Step 3 13.7 A31 a tap on Review about an item a sync changed since the screen showed it: refused with how it is now, nothing changed, and the screen shows it as it is', async () => {
    const r = await realServer();
    try {
      r.life.h.fake.addPending({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-03', description: 'MADE UP CAFE' });
      await r.life.sync();
      const page = await open(r, '/review');
      await waitOrReport(page, '[data-testid="item-cafe-1"]');
      expect(await amountOf(page, 'cafe-1')).toBe(1_150);
      // The bank posts it with a tip, and a sync reads it, while Review stays open.
      r.life.h.fake.postPending('cafe-1', { id: 'cafe-1-posted', date: '2026-10-04', amount: 1_350 });
      await r.life.sync();
      const events = readHistory(r.life.h.db).length;
      await page.getByTestId('item-cafe-1').getByTestId('pick-wants').click();
      await waitOrReport(page, '[data-testid="notice"]');
      await untilQuiet(page);
      expect((await page.getByTestId('notice').locator('.notice__text').innerText()).trim()).toBe('MADE UP CAFE changed since you looked: it is now $13.50. Look at it again, then choose. Nothing was changed.');
      expect(await page.getByTestId('notice').getAttribute('role')).toBe('alert');
      expect(readHistory(r.life.h.db)).toHaveLength(events);
      expect(r.life.keeper.book()?.pots().wants).toBe(20_000);
      // The screen asked for its numbers again: the cafe as it is now.
      await waitOrReport(page, '[data-testid="item-cafe-1"]');
      expect(await amountOf(page, 'cafe-1')).toBe(1_350);
      await page.getByTestId('item-cafe-1').getByTestId('pick-wants').click();
      await expect.poll(() => r.life.keeper.book()?.pots().wants).toBe(20_000 - 1_350);
      await untilQuiet(page);
    } finally {
      await done(r);
    }
  });

  // QUESTIONS.md A32, his answer (option 2), rule 13.7: Review sat in the
  // background showing the cinema at $18.00, pending; brought forward, it reads
  // its numbers again and the card shows $21.50, posted. The card says so, and
  // takes no tap for about a second, so a tap meant for what was there before is
  // not sent. The tap is made inside the page the moment the new amount shows,
  // so a slow machine cannot make it late.
  it('13.7 A32 a card whose item changed when the screen read its numbers again says so, and takes no tap for about a second', async () => {
    const r = await realServer();
    try {
      r.life.h.fake.addPending({ id: 'cinema-1', account: E, amount: 1_800, date: '2026-10-03', description: 'MADE UP CINEMA' });
      await r.life.sync();
      const page = await open(r, '/review');
      await waitOrReport(page, '[data-testid="item-cinema-1"]');
      expect(await amountOf(page, 'cinema-1')).toBe(1_800);
      expect(await page.getByTestId('item-cinema-1').getByTestId('changed').count()).toBe(0);
      const choices: string[] = [];
      page.on('request', (request) => {
        if (request.url().endsWith('/api/choice')) choices.push(request.postData() ?? '');
      });
      // In the background, the bank posts it with a tip and a sync reads it.
      await setVisibility(page, 'hidden');
      r.life.h.fake.postPending('cinema-1', { id: 'cinema-1-posted', date: '2026-10-04', amount: 2_150 });
      await r.life.sync();
      const events = readHistory(r.life.h.db).length;
      const shownAt = page.evaluate(
        () =>
          new Promise<{ readonly changed: string; readonly disabled: boolean; readonly at: number }>((resolve) => {
            const look = (): void => {
              const card = document.querySelector('[data-testid="item-cinema-1"]');
              const amount = card?.querySelector('[data-testid="item-amount"]')?.textContent ?? '';
              if (!amount.includes('21.50')) return;
              watcher.disconnect();
              const pick = card?.querySelector<HTMLButtonElement>('[data-testid="pick-wants"]');
              const at = performance.now();
              // A tap the moment the new amount shows.
              pick?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              pick?.click();
              resolve({ changed: card?.querySelector('[data-testid="changed"]')?.textContent ?? '', disabled: pick?.disabled ?? false, at });
            };
            // Looks at each change to the page the moment it is made (not on the next frame, which a slow machine
            // may draw late), so the time taken is the time the card showed the new amount.
            const watcher = new MutationObserver(look);
            watcher.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
            look();
          }),
      );
      await setVisibility(page, 'visible');
      const shown = await shownAt;
      expect(shown.changed.replace(/\s+/g, ' ').trim()).toBe('Changed: now $21.50, posted');
      expect(shown.disabled).toBe(true);
      // About a second later it takes a tap again; the tap made meanwhile sent nothing.
      const pick = page.getByTestId('item-cinema-1').getByTestId('pick-wants');
      await expect.poll(() => pick.isEnabled(), { timeout: 5_000 }).toBe(true);
      const heldFor = await page.evaluate((at) => performance.now() - at, shown.at);
      expect(heldFor).toBeGreaterThanOrEqual(950);
      expect(choices).toEqual([]);
      expect(readHistory(r.life.h.db)).toHaveLength(events);
      expect(r.life.keeper.book()?.pots().wants).toBe(20_000);
      // The card still says what changed; a tap now goes through, about the item as it is.
      expect(await textAt(page, 'changed')).toContain('Changed: now $21.50, posted');
      await pick.click();
      await expect.poll(() => r.life.keeper.book()?.pots().wants).toBe(20_000 - 2_150);
      await untilQuiet(page);
      expect(choices).toHaveLength(1);
    } finally {
      await done(r);
    }
  });

  it.each(['light', 'dark'] as const)('13.7 A32 design: the changed card is readable in %s mode, in words and not only colour', async (scheme) => {
    const r = await realServer(scheme);
    try {
      r.life.h.fake.addPending({ id: 'cinema-1', account: E, amount: 1_800, date: '2026-10-03', description: 'MADE UP CINEMA' });
      await r.life.sync();
      const page = await open(r, '/review');
      await waitOrReport(page, '[data-testid="item-cinema-1"]');
      await setVisibility(page, 'hidden');
      r.life.h.fake.postPending('cinema-1', { id: 'cinema-1-posted', date: '2026-10-04', amount: 2_150 });
      await r.life.sync();
      await setVisibility(page, 'visible');
      await waitOrReport(page, '[data-testid="changed"]');
      await untilQuiet(page);
      expect(await textAt(page, 'changed')).toContain('Changed: now $21.50, posted');
      expect(await axeViolations(page)).toEqual([]);
    } finally {
      await done(r);
    }
  });

  it('13.7 A32 with its sheet open, an item that changed as the screen read its numbers again takes no tap in the sheet either, for about a second', async () => {
    const r = await realServer();
    try {
      r.life.h.fake.addPending({ id: 'cinema-1', account: E, amount: 1_800, date: '2026-10-03', description: 'MADE UP CINEMA' });
      await r.life.sync();
      const page = await open(r, '/review');
      await waitOrReport(page, '[data-testid="item-cinema-1"]');
      await page.getByTestId('item-cinema-1').getByTestId('more').click();
      await waitOrReport(page, '[data-testid="sheet-picks"]');
      const choices: string[] = [];
      page.on('request', (request) => {
        if (request.url().endsWith('/api/choice')) choices.push(request.postData() ?? '');
      });
      await setVisibility(page, 'hidden');
      r.life.h.fake.postPending('cinema-1', { id: 'cinema-1-posted', date: '2026-10-04', amount: 2_150 });
      await r.life.sync();
      const tapped = page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const look = (): void => {
              const amount = document.querySelector('[data-testid="sheet-amount"]')?.textContent ?? '';
              if (!amount.includes('21.50')) {
                requestAnimationFrame(look);
                return;
              }
              document.querySelector<HTMLButtonElement>('[data-testid="choice-wants"]')?.click();
              resolve(amount);
            };
            look();
          }),
      );
      await setVisibility(page, 'visible');
      expect(await tapped).toContain('21.50');
      await page.waitForTimeout(300);
      expect(choices).toEqual([]);
      await page.waitForTimeout(900);
      await page.getByTestId('choice-wants').click();
      await expect.poll(() => r.life.keeper.book()?.pots().wants).toBe(20_000 - 2_150);
      await untilQuiet(page);
      expect(choices).toHaveLength(1);
    } finally {
      await done(r);
    }
  });

  // B281 (CI's WebKit, PR 54): the second was counted from when the screen worked
  // out the new numbers, so a slow first frame could use it up before the change
  // could be seen. Here the frame is held back on purpose, longer than the hold.
  it('13.7 A32 B281 the second starts when the change can be seen: a slow first frame does not use it up, and the sheet takes a tap after it', async () => {
    const r = await realServer();
    try {
      r.life.h.fake.addPending({ id: 'cinema-1', account: E, amount: 1_800, date: '2026-10-03', description: 'MADE UP CINEMA' });
      await r.life.sync();
      const page = await open(r, '/review');
      await waitOrReport(page, '[data-testid="item-cinema-1"]');
      await page.getByTestId('item-cinema-1').getByTestId('more').click();
      await waitOrReport(page, '[data-testid="sheet-picks"]');
      const choices: string[] = [];
      page.on('request', (request) => {
        if (request.url().endsWith('/api/choice')) choices.push(request.postData() ?? '');
      });
      await setVisibility(page, 'hidden');
      r.life.h.fake.postPending('cinema-1', { id: 'cinema-1-posted', date: '2026-10-04', amount: 2_150 });
      await r.life.sync();
      const tapped = page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const watch = new MutationObserver(() => {
              const amount = document.querySelector('[data-testid="sheet-amount"]')?.textContent ?? '';
              if (!amount.includes('21.50')) return;
              watch.disconnect();
              // The frame that would show it is late, by more than the hold, and
              // whatever timers came due run first. Then a tap meant for what was there.
              const until = performance.now() + 1_300;
              while (performance.now() < until);
              setTimeout(() => {
                document.querySelector<HTMLButtonElement>('[data-testid="choice-wants"]')?.click();
                resolve(amount);
              }, 20);
            });
            watch.observe(document.body, { subtree: true, childList: true, characterData: true });
          }),
      );
      await setVisibility(page, 'visible');
      expect(await tapped).toContain('21.50');
      await page.waitForTimeout(300);
      expect(choices).toEqual([]);
      await page.waitForTimeout(1_500);
      await page.getByTestId('choice-wants').click();
      await expect.poll(() => r.life.keeper.book()?.pots().wants).toBe(20_000 - 2_150);
      await untilQuiet(page);
      expect(choices).toHaveLength(1);
    } finally {
      await done(r);
    }
  });

  it('13.7 A32 3.4 on Payday, a question that spending from before payday made smaller says so, and takes no tap for about a second', async () => {
    const r = await realServer();
    try {
      const k = r.life.keeper;
      const asked = k.settingsChange({ id: 'payroll-rule', settings: { paycheckRule: { contains: 'MADEUP CORP PAYROLL' } } });
      if (asked.ok || asked.preview === undefined) throw new Error('the paycheck rule did not ask first');
      expect(k.settingsChange({ id: 'payroll-rule', settings: { paycheckRule: { contains: 'MADEUP CORP PAYROLL' } }, confirmed: true, seen: asked.preview.key })).toMatchObject({ ok: true });
      r.life.now = noonInNewYork('2026-10-09');
      r.life.h.fake.addPosted({ id: 'pay-1', account: ACCOUNT_IDS.checking, amount: -250_000, date: '2026-10-09', description: 'MADEUP CORP PAYROLL' });
      await r.life.sync();
      const page = await open(r, '/payday');
      const card = page.locator('[data-testid^="item-"]').filter({ hasText: 'Wants' }).first();
      await card.waitFor();
      const before = readCents(await card.getByTestId('item-amount').innerText());
      await setVisibility(page, 'hidden');
      // A purchase from before payday shows up after it, and is sorted into wants.
      r.life.h.fake.addPosted({ id: 'late-1', account: E, amount: 2_500, date: '2026-10-08', description: 'MADE UP DINER' });
      await r.life.sync();
      expect(choose(k, { item: 'late-1', choice: { to: 'wants' } })).toMatchObject({ ok: true });
      const now = ((before - 2_500) / 100).toFixed(2);
      const shown = page.evaluate(
        (text) =>
          new Promise<{ readonly changed: string; readonly disabled: boolean }>((resolve) => {
            const look = (): void => {
              const cards = [...document.querySelectorAll('[data-testid^="item-"]')].filter((c) => (c.textContent ?? '').includes('Wants'));
              const it = cards.find((c) => (c.querySelector('[data-testid="item-amount"]')?.textContent ?? '').includes(text));
              if (it === undefined) {
                requestAnimationFrame(look);
                return;
              }
              const answer = it.querySelector<HTMLButtonElement>('[data-testid="answer-move-to-savings"]');
              resolve({ changed: it.querySelector('[data-testid="changed"]')?.textContent ?? '', disabled: answer?.disabled ?? false });
            };
            look();
          }),
        now,
      );
      await setVisibility(page, 'visible');
      const seen = await shown;
      expect(seen.changed.replace(/\s+/g, ' ').trim()).toBe(`Changed: now $${now}`);
      expect(seen.disabled).toBe(true);
      await expect.poll(() => card.getByTestId('answer-move-to-savings').isEnabled(), { timeout: 5_000 }).toBe(true);
      await untilQuiet(page);
    } finally {
      await done(r);
    }
  });

  it('13.7 A32 read again with nothing changed, no card says so and every card takes a tap at once', async () => {
    const r = await realServer();
    try {
      r.life.h.fake.addPending({ id: 'cinema-1', account: E, amount: 1_800, date: '2026-10-03', description: 'MADE UP CINEMA' });
      await r.life.sync();
      const page = await open(r, '/review');
      await waitOrReport(page, '[data-testid="item-cinema-1"]');
      await setVisibility(page, 'hidden');
      await r.life.sync();
      await setVisibility(page, 'visible');
      await untilQuiet(page);
      expect(await page.getByTestId('changed').count()).toBe(0);
      expect(await page.getByTestId('item-cinema-1').getByTestId('pick-wants').isEnabled()).toBe(true);
      await page.getByTestId('item-cinema-1').getByTestId('pick-wants').click();
      await expect.poll(() => r.life.keeper.book()?.pots().wants).toBe(20_000 - 1_800);
      await untilQuiet(page);
    } finally {
      await done(r);
    }
  });

  it('13.7 A32 on a bucket\'s list, a row he sorted again himself is not marked changed; one a sync changed is, and opens only after about a second', async () => {
    const r = await realServer();
    try {
      r.life.h.fake.addPosted({ id: 'books-1', account: E, amount: 4_210, date: '2026-10-03', description: 'MADE UP BOOKSHOP' });
      r.life.h.fake.addPending({ id: 'cinema-1', account: E, amount: 1_800, date: '2026-10-03', description: 'MADE UP CINEMA' });
      await r.life.sync();
      for (const item of ['books-1', 'cinema-1']) expect(choose(r.life.keeper, { item, choice: { to: 'wants' } })).toMatchObject({ ok: true });
      const page = await open(r, '/buckets/wants');
      await waitOrReport(page, '[data-testid="row-books-1"]');
      // He splits the books from the list, 10.00 to needs and the rest still
      // in wants: his own change, so its row stays here with a new key, and is
      // not marked.
      const before = await r.life.keeper.activity('wants');
      await page.getByTestId('row-books-1').click();
      await page.getByTestId('split-needs').fill('10.00');
      await page.getByTestId('split-submit').click();
      await waitOrReport(page, '[data-testid="notice"]');
      await untilQuiet(page);
      const after = await r.life.keeper.activity('wants');
      if (before.state !== 'tracking' || after.state !== 'tracking') throw new Error('not tracking');
      expect(after.keys['books-1']).not.toBe(before.keys['books-1']);
      expect(await page.getByTestId('row-books-1').innerText()).toContain('Part of a split');
      expect(await page.getByTestId('changed').count()).toBe(0);
      expect(await page.getByTestId('row-books-1').isEnabled()).toBe(true);
      // The cinema posts with a tip while the list is in the background.
      await setVisibility(page, 'hidden');
      r.life.h.fake.postPending('cinema-1', { id: 'cinema-1-posted', date: '2026-10-04', amount: 2_150 });
      await r.life.sync();
      const opened = page.evaluate(
        () =>
          new Promise<{ readonly changed: boolean; readonly sheetOpened: boolean }>((resolve) => {
            const look = (): void => {
              const row = document.querySelector<HTMLButtonElement>('[data-testid="row-cinema-1"]');
              if (!(row?.textContent ?? '').includes('21.50')) {
                requestAnimationFrame(look);
                return;
              }
              row?.click();
              // The sheet would open in the same step as the tap (a layout effect).
              requestAnimationFrame(() => resolve({ changed: row?.querySelector('[data-testid="changed"]') !== null, sheetOpened: document.querySelector('[data-testid="sheet-picks"]') !== null }));
            };
            look();
          }),
      );
      await setVisibility(page, 'visible');
      expect(await opened).toEqual({ changed: true, sheetOpened: false });
      await page.waitForTimeout(1_100);
      await page.getByTestId('row-cinema-1').click();
      await waitOrReport(page, '[data-testid="sheet-picks"]');
      expect(await page.getByTestId('sheet-amount').innerText()).toContain('21.50');
      await page.keyboard.press('Escape');
      await untilQuiet(page);
    } finally {
      await done(r);
    }
  });
});

// What a phone does when the app goes to the background and comes back.
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

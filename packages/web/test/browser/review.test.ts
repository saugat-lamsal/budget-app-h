import type { BankBalances, Book, IsoDate, ReviewDetail } from '@budget-app/money';
import type { Browser, BrowserContext, Page, Route } from 'playwright';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { START_DATE, appSide, deposit, openTestBook, payPerson, purchase, refund } from '../../../money/test/helpers.js';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { itemKey } from '../../../server/src/item-key.js';
import { ENGINES, launch, centsAt, close, openScenario, phone, readCents, textAt, untilQuiet, useEngine } from './harness.js';
import { openLive, startLive } from './live.js';
import { bucketsOf, bucketsOnScreen, item, listed, tapThenTapWhereItWas, watchChoices } from './screens.js';

// Review, used in a browser like a person would. Every item and every choice
// on the screen is compared to the money math for the same made-up life; a
// tap is compared to the same answer given to a twin of the book directly.
// The expected numbers come straight from the book (the money package), not
// from the view the server sends.

interface Life {
  readonly book: Book;
  readonly bank: BankBalances;
  readonly today: IsoDate;
}

// A fresh copy of a made-up life: the same book, as the demo starts it.
function life(name: string): Life {
  const input = demoScenario(name)?.input?.();
  if (input === undefined || input.book === null || input.bank === null) throw new Error(`no made-up life called ${name}`);
  return { book: input.book, bank: input.bank, today: input.today };
}

function detailOf(book: Book, id: string): ReviewDetail {
  const found = book.reviewDetails().find((d) => d.item.id === id);
  if (found === undefined) throw new Error(`nothing waiting with id ${id}`);
  return found;
}

// The id of the waiting item with this description (and amount, if given).
function idOf(book: Book, description: string, amount?: number): string {
  const found = book.reviewItems().find((i) => 'description' in i && i.description === description && (amount === undefined || i.amount === amount));
  if (found === undefined) throw new Error(`nothing waiting called ${description}`);
  return found.id;
}

async function openReview(context: BrowserContext, base: string, name: string): Promise<Page> {
  const page = await openScenario(context, base, name, '/review');
  page.setDefaultTimeout(15_000);
  return page;
}

describe.each(ENGINES)('Review in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  // ----- What is listed -----

  it('10.3 B32 everything waiting is listed, with the amount, the count, and what is held back from the money math', async () => {
    const { book } = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const items = book.reviewItems();
    expect([...(await listed(page))].sort()).toEqual(items.map((i) => i.id).sort());
    expect(await page.getByTestId('review-count').innerText()).toBe(String(items.length));
    expect(await centsAt(page, 'held-back')).toBe(book.pots().unsortedOut);
    for (const i of items) {
      expect(readCents(await item(page, i.id).getByTestId('item-amount').innerText()), i.id).toBe(i.amount);
      const title = await item(page, i.id).locator('.decision__title').innerText();
      expect(title, i.id).toBe(i.type === 'leftover' ? `${i.bucket === 'needs' ? 'Needs' : 'Wants'} leftover` : i.description);
    }
    // The tab's badge says the same.
    expect(await page.getByTestId('review-badge').innerText()).toBe(String(items.length));
    await page.context().close();
  });

  it('B226 a pending item the bank labels as a card payment, read as a purchase, names the bank rule for its wording and links to Settings', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    // The real server adds what the bank's label says (keeper.review); the demo has no labels, so it is added here.
    let marked = '';
    await page.route('**/api/review', async (route: Route) => {
      const response = await route.fetch();
      const view = (await response.json()) as { items: { item: { id: string; type: string }; pending: boolean | null; labeled?: unknown }[] };
      const target = view.items.find((d) => d.item.type === 'spending' && d.pending === true);
      if (target !== undefined) {
        marked = target.item.id;
        target.labeled = { account: 'checking', contains: 'PAYMENT TO ACCT', means: 'transfer', other: null };
      }
      await route.fulfill({ response, json: view });
    });
    await page.goto(`${base()}/demo/review-busy`);
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.goto(`${base()}/review`);
    await page.getByTestId('item-labeled').waitFor();
    expect(marked).not.toBe('');
    const card = page.getByTestId(`item-${marked}`);
    expect(await card.getByTestId('item-labeled').innerText()).toBe(
      'Your bank labels this a transfer between your accounts (a card payment is one), but no bank rule reads it as one, so it counts as spending while it is pending. A bank rule for “PAYMENT TO ACCT” on checking reads the next ones right: add it on Settings, Bank rules. This one you can mark “Transfer between my accounts” once it posts.',
    );
    expect(await card.getByTestId('item-labeled-settings').getAttribute('href')).toBe('/settings');
    // Only that item says it.
    expect(await page.getByTestId('item-labeled').count()).toBe(1);
    await untilQuiet(page);
    await context.close();
  });

  it('3.4 payday questions come first, then money in, spending, and old card flags', async () => {
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const groups = await page.locator('[data-testid^="group-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(groups).toEqual(['group-leftover', 'group-money-in', 'group-spending', 'group-old-card-purchase']);
    expect(await page.locator('[data-testid^="group-"] h2').allInnerTexts()).toEqual(['PAYDAY QUESTIONS', 'MONEY IN', 'SPENDING', 'OLD CARD']);
    await page.context().close();
  });

  it('4.2 4.4 4.9 5.2 6.1 7.6 8.3 the choices on every item are the ones the money math offers for it', async () => {
    const { book } = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const problems: string[] = [];
    for (const d of book.reviewDetails()) {
      const card = item(page, d.item.id);
      const o = d.options;
      const inline = await card.locator('[data-testid^="pick-"], [data-testid^="answer-"], [data-testid="acknowledge"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
      if (o.type === 'leftover') {
        if (inline.join() !== o.answers.map((a) => `answer-${a}`).join()) problems.push(`${d.item.id}: answers ${inline.join()}`);
        continue;
      }
      if (o.type === 'acknowledge') {
        if (inline.join() !== 'acknowledge') problems.push(`${d.item.id}: ${inline.join()}`);
        continue;
      }
      // A couple of the offered picks on the item, and nothing that is not offered.
      const offered = o.picks.map((p) => `pick-${p.to}`);
      if (inline.length !== Math.min(2, offered.length) || inline.some((t) => !offered.includes(t))) problems.push(`${d.item.id}: inline ${inline.join()} of ${offered.join()}`);
      // The rest are under "More choices": all of them.
      await card.getByTestId('more').click();
      const sheet = page.getByTestId('review-sheet');
      await sheet.waitFor();
      const rows = await sheet.locator('[data-testid^="choice-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
      const picks = rows.filter((r) => !r.startsWith('choice-transfer-'));
      const transfers = rows.filter((r) => r.startsWith('choice-transfer-')).map((r) => r.slice('choice-transfer-'.length));
      if (picks.join() !== o.picks.map((p) => `choice-${p.to}`).join()) problems.push(`${d.item.id}: rows ${picks.join()} but offered ${offered.join()}`);
      if (transfers.join() !== o.transfer.join()) problems.push(`${d.item.id}: transfers ${transfers.join()} but offered ${o.transfer.join()}`);
      const splitShown = (await sheet.getByTestId('sheet-split').count()) === 1;
      if (splitShown !== (o.split !== null)) problems.push(`${d.item.id}: split shown ${String(splitShown)}`);
      if (o.split !== null) {
        const fields = await sheet.locator('[data-testid^="split-"][data-testid$="s"], [data-testid="split-needs"], [data-testid="split-wants"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-testid') ?? ''))]);
        const expectFields = o.split.slice(0, -1).map((b) => `split-${b}`);
        if (fields.filter((f) => expectFields.includes(f)).join() !== expectFields.join()) problems.push(`${d.item.id}: split fields ${fields.join()} but ${expectFields.join()}`);
        const restWord = o.split[o.split.length - 1] === 'not-mine' ? 'Not mine' : o.split[o.split.length - 1] === 'wants' ? 'Wants' : 'Needs';
        if ((await sheet.getByTestId('split-rest').innerText()) !== `${restWord} gets the rest.`) problems.push(`${d.item.id}: rest line`);
      }
      const alwaysShown = (await sheet.getByTestId('always-toggle').count()) === 1;
      if (alwaysShown !== o.always.length > 0) problems.push(`${d.item.id}: always shown ${String(alwaysShown)}`);
      const unavailable = await sheet.locator('[data-testid^="unavailable-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
      if (unavailable.join() !== o.unavailable.map((u) => `unavailable-${u.what}`).join()) problems.push(`${d.item.id}: unavailable ${unavailable.join()}`);
      for (const u of o.unavailable) {
        if (!(await sheet.getByTestId(`unavailable-${u.what}`).innerText()).includes(u.why)) problems.push(`${d.item.id}: unavailable text for ${u.what}`);
      }
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'hidden' });
    }
    expect(problems).toEqual([]);
    await page.context().close();
  });

  it('20d A15 a refund lists the purchases it likely belongs to, best first, with why', async () => {
    const { book } = life('review-busy');
    const refund = detailOf(book, 'busy-refund');
    expect(refund.likelyPurchases.map((p) => p.sameName)).toEqual([true, true]);
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const shown = await item(page, 'busy-refund').locator('li[data-testid^="likely-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')?.slice('likely-'.length) ?? ''));
    expect(shown).toEqual(refund.likelyPurchases.map((p) => p.id));
    const first = item(page, 'busy-refund').getByTestId(`likely-${refund.likelyPurchases[0]!.id}`);
    expect((await first.innerText()).replace(/\s+/g, ' ')).toBe('ONLINE MARKETPLACE $23.17 Tue, Oct 6 · Not sorted yet · Same name · Same amount This refund is for this one');
    expect(await textAt(page, 'likely')).toContain('If you know which one it is for, tap it. The refund then goes back where that purchase came from.');
    await page.context().close();
  });

  it('20d sorting a purchase does not take it off a refund\'s list: it is still what the refund could belong to', async () => {
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const mine = life('review-busy');
    const id = idOf(mine.book, 'ONLINE MARKETPLACE', 2_317);
    await item(page, id).getByTestId('pick-wants').click();
    await item(page, id).waitFor({ state: 'detached' });
    const first = item(page, 'busy-refund').getByTestId(`likely-${id}`);
    expect((await first.innerText()).replace(/\s+/g, ' ')).toBe('ONLINE MARKETPLACE $23.17 Tue, Oct 6 · In Wants · Same name · Same amount This refund is for this one');
    await page.context().close();
  });

  it('A18 4.5 every likely purchase has "This refund is for this one", exactly the ones the money math offers', async () => {
    const { book } = life('review-busy');
    const refund = detailOf(book, 'busy-refund');
    const o = refund.options;
    if (o.type !== 'sort') throw new Error('not sortable');
    expect(o.match.length).toBeGreaterThan(0);
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const buttons = await item(page, 'busy-refund').locator('[data-testid^="match-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')?.slice('match-'.length) ?? ''));
    expect(buttons).toEqual(o.match);
    // Nothing else waiting has one.
    expect(await page.locator('[data-testid^="match-"]').count()).toBe(o.match.length);
    await page.context().close();
  });

  it('A18 4.5 "this refund is for this one" asks first; Cancel sends nothing; yes counts it as if the bank had matched it', async () => {
    const twin = life('review-busy');
    const { book } = life('review-busy');
    const of = detailOf(book, 'busy-refund').likelyPurchases[0]!.id;
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    await item(page, 'busy-refund').getByTestId(`match-${of}`).click();
    expect(await textAt(page, 'confirm-title')).toBe('Match this refund?');
    expect(await textAt(page, 'confirm-ask')).toBe('ONLINE MARKETPLACE REFUND, $23.17, is for ONLINE MARKETPLACE, $23.17, on Tue, Oct 6. It then counts as if the bank had matched it, and goes back where that purchase came from. This can\'t be undone here.');
    await page.getByTestId('confirm-cancel').click();
    expect(watch.posts).toHaveLength(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('review-sheet').waitFor({ state: 'hidden' });
    expect(await item(page, 'busy-refund').count()).toBe(1);

    await item(page, 'busy-refund').getByTestId(`match-${of}`).click();
    await page.getByTestId('confirm-yes').click();
    await item(page, 'busy-refund').waitFor({ state: 'detached' });
    twin.book.sort('busy-refund', { refundOf: of }, twin.today);
    expect(await textAt(page, 'notice')).toBe('ONLINE MARKETPLACE REFUND matched to ONLINE MARKETPLACE, as if the bank had matched it. OK');
    expect(watch.posts).toHaveLength(1);
    expect(JSON.parse(watch.posts[0]!.postData() ?? '{}')).toMatchObject({ item: 'busy-refund', choice: { refundOf: of }, confirmed: true });
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    expect([...(await listed(page))].sort()).toEqual(twin.book.reviewItems().map((i) => i.id).sort());
    await page.context().close();
  });

  it('5.6 5.2 each "transfer between my accounts" row says what it does: to the old card from checking comes out of needs', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'ZELLE TO MADE UP FRIEND');
    const o = detailOf(mine.book, id).options;
    if (o.type !== 'sort') throw new Error('not sortable');
    expect(o.transferOutcome).toEqual({ savings: 'no-bucket-change', 'everyday-card': 'no-bucket-change', 'old-card': 'out-of-needs' });
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    expect(await textAt(page, 'choice-transfer-savings')).toBe('To Savings No bucket changes. It is money moving between your accounts.');
    expect(await textAt(page, 'choice-transfer-everyday-card')).toBe('To Everyday card No bucket changes. It is money moving between your accounts.');
    expect(await textAt(page, 'choice-transfer-old-card')).toBe('To Old card A payment to the old card. It comes out of Needs.');
    await page.getByTestId('choice-transfer-old-card').click();
    await item(page, id).waitFor({ state: 'detached' });
    const needsBefore = twin.book.pots().needs;
    twin.book.sort(id, { transfer: 'old-card' }, twin.today);
    expect(twin.book.pots().needs).toBe(needsBefore - detailOf(mine.book, id).item.amount);
    expect(await textAt(page, 'notice')).toBe('ZELLE TO MADE UP FRIEND marked as a payment to the old card. It came out of Needs. OK');
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('5.6 5.2 A4 to the old card from savings: the row and the answer say it comes back to pick savings or needs', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = 'busy-water';
    const o = detailOf(mine.book, id).options;
    if (o.type !== 'sort') throw new Error('not sortable');
    expect(o.transferOutcome['old-card']).toBe('savings-or-needs');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    expect(await textAt(page, 'choice-transfer-checking')).toBe('To Checking No bucket changes. It is money moving between your accounts.');
    expect(await textAt(page, 'choice-transfer-old-card')).toBe('To Old card A payment to the old card from savings. It comes back here for you to pick Savings or Needs.');
    await page.getByTestId('choice-transfer-old-card').click();
    await page.getByTestId('notice').waitFor();
    twin.book.sort(id, { transfer: 'old-card' }, twin.today);
    expect(await textAt(page, 'notice')).toBe('BILL PAY WATER UTILITY marked as a payment to the old card. It is waiting again, for you to pick Savings or Needs. OK');
    expect(detailOf(twin.book, id).item).toMatchObject({ type: 'spending', reason: 'old-card-from-savings' });
    await item(page, id).locator('[data-testid="pick-savings"]').waitFor();
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('5.6 money coming in marked as a transfer: no bucket changes', async () => {
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, 'busy-tax').getByTestId('more').click();
    expect(await textAt(page, 'choice-transfer-savings')).toBe('From Savings No bucket changes. It is money moving between your accounts.');
    await page.context().close();
  });

  it('4.6 a pending charge says Pending, with an icon', async () => {
    const { book } = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const deli = item(page, idOf(book, 'CORNER DELI'));
    expect(await deli.locator('[data-status="pending"]').innerText()).toBe('Pending');
    expect(await deli.locator('[data-status="pending"] [data-icon="clock"]').count()).toBe(1);
    await page.context().close();
  });

  // ----- One tap -----

  it('4.2 4.7 one tap on Wants sorts the purchase: it leaves the list, and every number matches the money math', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    const before = await bucketsOnScreen(page);
    expect(before).toEqual(bucketsOf(twin.book));

    await item(page, id).getByTestId('pick-wants').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.sort(id, { to: 'wants' }, twin.today);

    expect(watch.posts).toHaveLength(1);
    expect(await page.getByTestId('review-count').innerText()).toBe(String(twin.book.reviewItems().length));
    expect(await centsAt(page, 'held-back')).toBe(twin.book.pots().unsortedOut);
    // What was done is said back to him.
    expect(await textAt(page, 'notice')).toContain('CORNER STORE sorted to Wants.');
    expect(await page.getByTestId('notice').locator('[data-icon="check"]').count()).toBe(1);
    // Buckets, from the money math.
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    expect((await bucketsOnScreen(page)).wants).toBe(before.wants - 1_150);
    // The tab's badge and Home follow.
    expect(await page.getByTestId('review-badge').innerText()).toBe(String(twin.book.reviewItems().length));
    await page.getByTestId('tab-home').click();
    await page.getByTestId('safe-to-spend').waitFor();
    expect(await centsAt(page, 'safe-to-spend')).toBe(twin.book.safeToSpend(twin.today).amount);
    await page.context().close();
  });

  it('4.7 a choice stays made after a reload, because the server keeps it', async () => {
    const mine = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('pick-needs').click();
    await item(page, id).waitFor({ state: 'detached' });
    await page.reload();
    await page.getByTestId('review-count').waitFor();
    expect(await item(page, id).count()).toBe(0);
    expect(await page.getByTestId('review-count').innerText()).toBe(String(mine.book.reviewItems().length - 1));
    await page.context().close();
  });

  it('a double tap sends one request, and changes the books once', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    await item(page, id).getByTestId('pick-wants').dblclick();
    await item(page, id).waitFor({ state: 'detached' });
    await page.waitForLoadState('networkidle');
    twin.book.sort(id, { to: 'wants' }, twin.today);
    expect(watch.posts).toHaveLength(1);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('B194 the rest of a double tap on a choice in its sheet does not land on the list under it: one decision, nothing else sorted or opened', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    await item(page, id).getByTestId('more').click();
    await page.getByTestId('review-sheet').waitFor();
    expect(await tapThenTapWhereItWas(page, page.getByTestId('review-sheet').getByTestId('choice-wants'), 'review-sheet'), 'what of the screen the second tap reached').toBe('nothing');
    await untilQuiet(page);
    twin.book.sort(id, { to: 'wants' }, twin.today);
    expect(watch.posts).toHaveLength(1);
    expect(await page.locator('dialog[open]').evaluateAll((open) => open.map((d) => d.getAttribute('data-testid'))), 'a sheet opened under the second tap').toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/review');
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  // What the double tap above did on his PC under full load (Oct 11, WebKit):
  // the second tap came after the first answer was back but before Review
  // showed the numbers asked for after it, with the card's buttons on again,
  // and it sent a second decision. Here those numbers are held at exactly
  // that moment, whatever the timing of the taps (as for Setup day, B92).
  it('B92 an answer already given cannot be sent again while Review still shows the numbers from before it', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    const button = item(page, id).getByTestId('pick-wants');
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = false;
    await page.route('**/api/review', async (route) => {
      asked = true;
      await held;
      await route.continue();
    });
    await button.click();
    // The answer is back and the screen has asked for its fresh numbers.
    await expect.poll(() => asked).toBe(true);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))));
    expect(await button.isDisabled()).toBe(true);
    await button.click({ force: true });
    release();
    await item(page, id).waitFor({ state: 'detached' });
    await page.unrouteAll({ behavior: 'wait' });
    twin.book.sort(id, { to: 'wants' }, twin.today);
    expect(watch.posts).toHaveLength(1);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    // Once the fresh numbers are shown, the next item takes a tap again.
    const next = idOf(mine.book, 'CORNER DELI');
    expect(await item(page, next).getByTestId('pick-needs').isDisabled()).toBe(false);
    await page.context().close();
  });

  it('a retry on bad signal: it says so, Try again sends the same decision, and the books change once', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    let failures = 1;
    await page.route('**/api/choice', async (route: Route) => {
      if (failures > 0) {
        failures -= 1;
        await route.abort('connectionfailed');
      } else await route.continue();
    });
    await item(page, id).getByTestId('pick-wants').click();
    await page.getByTestId('notice-retry').waitFor();
    expect(await textAt(page, 'notice')).toContain("Couldn't save that.");
    expect(await textAt(page, 'notice')).toContain('Nothing is counted twice.');
    // Nothing changed: it is still waiting.
    expect(await item(page, id).count()).toBe(1);
    await page.getByTestId('notice-retry').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.sort(id, { to: 'wants' }, twin.today);
    // The same decision, sent twice.
    expect(watch.ids()).toHaveLength(2);
    expect(new Set(watch.ids()).size).toBe(1);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('Try again tapped twice sends one request', async () => {
    const mine = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    let failures = 1;
    const held: Route[] = [];
    await page.route('**/api/choice', async (route: Route) => {
      if (failures > 0) {
        failures -= 1;
        await route.abort('connectionfailed');
      } else held.push(route);
    });
    await item(page, id).getByTestId('pick-wants').click();
    await page.getByTestId('notice-retry').waitFor();
    // Both taps land while the first retry is still on its way.
    await page.getByTestId('notice-retry').dblclick();
    await expect.poll(() => held.length).toBe(1);
    await page.waitForTimeout(300);
    expect(held).toHaveLength(1);
    expect(watch.posts).toHaveLength(2);
    await held[0]!.continue();
    await item(page, id).waitFor({ state: 'detached' });
    expect(watch.posts).toHaveLength(2);
    await page.context().close();
  });

  it('the answer lost after the server did it: Try again gets the same answer and nothing is counted twice', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    let lose = 1;
    await page.route('**/api/choice', async (route: Route) => {
      if (lose > 0) {
        lose -= 1;
        // The server gets it and does it; the answer never arrives.
        await route.fetch();
        await route.abort('connectionreset');
      } else await route.continue();
    });
    await item(page, id).getByTestId('pick-wants').click();
    await page.getByTestId('notice-retry').waitFor();
    // The page does not know, so it still shows it waiting until it asks again.
    await page.getByTestId('notice-retry').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.sort(id, { to: 'wants' }, twin.today);
    expect(new Set(watch.ids()).size).toBe(1);
    expect(watch.ids()).toHaveLength(2);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('a server error while sending says so and leaves the item waiting', async () => {
    const mine = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await page.route('**/api/choice', (route) => route.fulfill({ status: 500, body: 'Something went wrong.' }));
    await item(page, id).getByTestId('pick-wants').click();
    await page.getByTestId('notice-retry').waitFor();
    expect(await item(page, id).count()).toBe(1);
    expect(await page.getByTestId('review-count').innerText()).toBe(String(mine.book.reviewItems().length));
    await page.context().close();
  });

  // ----- A refused choice -----

  it('4.4 a split with nothing left for the rest is refused: it says why, and nothing changes', async () => {
    const mine = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const before = await bucketsOnScreen(page);
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    await sheet.getByTestId('split-needs').fill('11.50');
    await sheet.getByTestId('split-submit').click();
    await sheet.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toBe('Nothing is left for Wants: the other parts already add up to $11.50. Nothing was changed. OK');
    expect(await sheet.getByTestId('notice').getAttribute('role')).toBe('alert');
    // Still waiting, and nothing moved.
    await page.keyboard.press('Escape');
    expect(await item(page, id).count()).toBe(1);
    expect(await bucketsOnScreen(page)).toEqual(before);
    await page.context().close();
  });

  it('4.4 a split bigger than the purchase is refused in dollars and cents', async () => {
    const mine = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    await sheet.getByTestId('split-needs').fill('20.00');
    await sheet.getByTestId('split-submit').click();
    await sheet.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('$20.00');
    expect(await textAt(page, 'notice')).toContain('$11.50');
    expect(await item(page, id).count()).toBe(1);
    await page.context().close();
  });

  it('an item dealt with somewhere else is not changed again: it says so, and the list catches up', async () => {
    const mine = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const context = await browser().newContext(phone());
    const page = await openReview(context, base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    await sheet.waitFor();
    // Meanwhile, the phone's other window sorts it (the same browser's request, no page of its own: showLive in live.ts says why).
    const answer = await context.request.post(`${base()}/api/choice`, { headers: { 'Content-Type': 'application/json' }, data: { id: 'another-window-1', item: id, choice: { to: 'needs' } } });
    expect(answer.status()).toBe(200);
    const twin = life('review-busy');
    twin.book.sort(id, { to: 'needs' }, twin.today);
    await sheet.getByTestId('choice-wants').click();
    await page.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('That one was already dealt with. Nothing was changed.');
    await item(page, id).waitFor({ state: 'detached' });
    // It stays where the other window put it.
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await context.close();
  });

  // ----- Anything final asks first -----

  it('6.1 B52 3.2 3.3 "this is my paycheck" asks first, showing the split it would get; Cancel sends nothing', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const preview = detailOf(twin.book, 'busy-early').paycheckPreview!;
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    await item(page, 'busy-early').getByTestId('pick-paycheck').click();
    const sheet = page.getByTestId('review-sheet');
    await sheet.getByTestId('confirm-yes').waitFor();
    expect(await textAt(page, 'confirm-title')).toBe('Start a new pay period?');
    expect(await textAt(page, 'confirm-ask')).toContain('This starts a new pay period on Tue, Oct 6, the day it arrived.');
    // The split, from the money math.
    expect(await centsAt(page, 'preview-mom')).toBe(preview.momReserve);
    expect(await centsAt(page, 'preview-savings')).toBe(preview.savings);
    expect(await centsAt(page, 'preview-needs')).toBe(preview.needs);
    expect(await centsAt(page, 'preview-wants')).toBe(preview.wants);
    expect(preview.momReserve + preview.savings + preview.needs + preview.wants).toBe(30_000);
    expect(watch.posts).toHaveLength(0);
    await sheet.getByTestId('confirm-cancel').click();
    await page.keyboard.press('Escape');
    expect(watch.posts).toHaveLength(0);
    expect(await item(page, 'busy-early').count()).toBe(1);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(mine.book));
    await page.context().close();
  });

  it('6.1 B52 3.1 to 3.5 confirming my paycheck starts the pay period, and the money matches the twin', async () => {
    const twin = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    await item(page, 'busy-early').getByTestId('pick-paycheck').click();
    await page.getByTestId('confirm-yes').click();
    await item(page, 'busy-early').waitFor({ state: 'detached' });
    twin.book.sort('busy-early', { to: 'paycheck' }, twin.today);
    expect(watch.posts).toHaveLength(1);
    expect(JSON.parse(watch.posts[0]!.postData() ?? '{}')).toMatchObject({ item: 'busy-early', choice: { to: 'paycheck' }, confirmed: true });
    expect(await textAt(page, 'notice')).toContain('This is your paycheck'.replace('This', 'MADE UP EMPLOYER PAYROLL BONUS'));
    expect(await page.getByTestId('review-count').innerText()).toBe(String(twin.book.reviewItems().length));
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('3.4 B4 B109 the payday question that late spending made smaller says why here too, and the one it did not touch does not', async () => {
    const twin = life('payday-paid');
    const [needs, wants] = twin.book.paydayReport().leftovers;
    const page = await openReview(await browser().newContext(phone()), base(), 'payday-paid');
    expect(await item(page, wants!.question!).getByTestId('leftover-why').innerText()).toBe('$657.11 at payday, less $34.67 spent before payday and sorted since.');
    expect(await item(page, needs!.question!).getByTestId('leftover-why').count()).toBe(0);
    await page.context().close();
  });

  it('3.4 a leftover answer asks first, both ways, and then does what the money math does', async () => {
    const twin = life('review-busy');
    const needs = twin.book.reviewItems().find((i) => i.type === 'leftover' && i.bucket === 'needs')!;
    const wants = twin.book.reviewItems().find((i) => i.type === 'leftover' && i.bucket === 'wants')!;
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    await item(page, needs.id).getByTestId('answer-move-to-savings').click();
    expect(await textAt(page, 'confirm-title')).toBe('Answer for good?');
    expect(await textAt(page, 'confirm-ask')).toContain('Move $248.38 from Needs to Savings?');
    expect(watch.posts).toHaveLength(0);
    await page.getByTestId('confirm-yes').click();
    await item(page, needs.id).waitFor({ state: 'detached' });
    twin.book.answerLeftover(needs.id, 'move-to-savings', twin.today);

    await item(page, wants.id).getByTestId('answer-roll-over').click();
    expect(await textAt(page, 'confirm-ask')).toContain('Keep $178.25 in Wants for this pay period?');
    await page.getByTestId('confirm-yes').click();
    await item(page, wants.id).waitFor({ state: 'detached' });
    twin.book.answerLeftover(wants.id, 'roll-over', twin.today);

    expect(watch.posts).toHaveLength(2);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  // ----- 13.8: a rule offered the second time -----

  it('13.8 the second purchase from a place sorted the same way by hand: the notice offers the rule, and Yes, always makes it with the place\'s name', async () => {
    const twin = life('rule-offer');
    const id = idOf(twin.book, 'SUNRISE BAKERY #208');
    const page = await openReview(await browser().newContext(phone()), base(), 'rule-offer');
    const watch = watchChoices(page);
    await item(page, id).getByTestId('pick-wants').click();
    await page.getByTestId('notice-offer').waitFor();
    // What the money math offers for the same answer.
    twin.book.sort(id, { to: 'wants' }, twin.today);
    expect(twin.book.ruleOffer(id)).toEqual({ for: 'purchase', contains: 'SUNRISE BAKERY', to: 'wants' });
    expect(await textAt(page, 'notice-offer-text')).toBe('You sorted “SUNRISE BAKERY” the same way before. Make it a rule so the next one sorts itself?');
    await page.getByTestId('notice-offer').click();
    const sheet = page.getByTestId('offer-sheet');
    await sheet.getByTestId('offer-yes').waitFor();
    expect(await sheet.getByTestId('offer-text').inputValue()).toBe('SUNRISE BAKERY');
    expect(await textAt(page, 'offer-sentence')).toBe('From now on, purchases whose description contains “SUNRISE BAKERY” are sorted as: Wants. Anything waiting that matches is sorted now too, if it can be.');
    expect(watch.posts).toHaveLength(1);
    await sheet.getByTestId('offer-yes').click();
    await sheet.waitFor({ state: 'hidden' });
    expect(await textAt(page, 'notice')).toContain('From now on it goes there by itself.');
    expect(watch.posts).toHaveLength(2);
    expect(JSON.parse(watch.posts[1]!.postData() ?? '{}')).toMatchObject({ item: id, choice: { to: 'wants' }, always: { contains: 'SUNRISE BAKERY' }, confirmed: true, resort: true });
    twin.book.sortAlways(id, { to: 'wants' }, { id: 'rule-1', contains: 'SUNRISE BAKERY' }, twin.today);
    // The rule moved no money: the buckets are the twin's.
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('13.8 Not now closes it and sends nothing', async () => {
    const twin = life('rule-offer');
    const id = idOf(twin.book, 'SUNRISE BAKERY #208');
    const page = await openReview(await browser().newContext(phone()), base(), 'rule-offer');
    const watch = watchChoices(page);
    await item(page, id).getByTestId('pick-wants').click();
    await page.getByTestId('notice-offer').click();
    const sheet = page.getByTestId('offer-sheet');
    await sheet.getByTestId('offer-not-now').click();
    await sheet.waitFor({ state: 'hidden' });
    expect(watch.posts).toHaveLength(1);
    expect(await page.getByTestId('notice-offer').count()).toBe(0);
    await page.context().close();
  });

  it('13.8 the rule\'s text can be changed before the yes; with none it cannot be sent', async () => {
    const twin = life('rule-offer');
    const id = idOf(twin.book, 'SUNRISE BAKERY #208');
    const page = await openReview(await browser().newContext(phone()), base(), 'rule-offer');
    const watch = watchChoices(page);
    await item(page, id).getByTestId('pick-wants').click();
    await page.getByTestId('notice-offer').click();
    const sheet = page.getByTestId('offer-sheet');
    await sheet.getByTestId('offer-text').fill('  ');
    expect(await sheet.getByTestId('offer-yes').isDisabled()).toBe(true);
    await sheet.getByTestId('offer-text').fill('SUNRISE');
    expect(await textAt(page, 'offer-sentence')).toContain('whose description contains “SUNRISE” are sorted as: Wants.');
    await sheet.getByTestId('offer-yes').click();
    await sheet.waitFor({ state: 'hidden' });
    expect(JSON.parse(watch.posts[1]!.postData() ?? '{}')).toMatchObject({ always: { contains: 'SUNRISE' } });
    await page.context().close();
  });

  it('13.8 a text that does not match the item is refused: nothing changes, and the sheet stays open with the reason', async () => {
    const twin = life('rule-offer');
    const id = idOf(twin.book, 'SUNRISE BAKERY #208');
    const page = await openReview(await browser().newContext(phone()), base(), 'rule-offer');
    const watch = watchChoices(page);
    await item(page, id).getByTestId('pick-wants').click();
    await page.getByTestId('notice-offer').click();
    const sheet = page.getByTestId('offer-sheet');
    await sheet.getByTestId('offer-text').fill('MOON DINER');
    await sheet.getByTestId('offer-yes').click();
    await sheet.getByTestId('notice').waitFor();
    expect(await sheet.getByTestId('offer-yes').isVisible()).toBe(true);
    expect(watch.posts).toHaveLength(2);
    await sheet.getByTestId('offer-not-now').click();
    await sheet.waitFor({ state: 'hidden' });
    twin.book.sort(id, { to: 'wants' }, twin.today);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('13.8 13.6 "always do this" on a waiting item starts from the place\'s name, not the bank\'s store number', async () => {
    const { book } = life('rule-offer');
    const id = idOf(book, 'SUNRISE BAKERY #208');
    const page = await openReview(await browser().newContext(phone()), base(), 'rule-offer');
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    await sheet.getByTestId('always-toggle').click();
    expect(await sheet.getByTestId('always-text').inputValue()).toBe('SUNRISE BAKERY');
    await page.context().close();
  });

  it('13.8 the first time a place is sorted, and a sort another way, offer nothing; "always do this" starts from the place\'s name', async () => {
    const { book } = life('normal');
    const id = idOf(book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'normal');
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    await sheet.getByTestId('always-toggle').click();
    expect(await sheet.getByTestId('always-text').inputValue()).toBe(book.ruleText(id));
    await sheet.getByTestId('always-toggle').click();
    await sheet.getByTestId('choice-wants').click();
    await page.getByTestId('notice').waitFor();
    expect(await page.getByTestId('notice-offer').count()).toBe(0);
    await page.context().close();
  });

  // ----- Always do this -----

  it('13.6 B49 "always do this": a rule for the text, the item sorted, and the others it matches sorted too', async () => {
    const twin = life('review-busy');
    const mine = life('review-busy');
    const id = idOf(mine.book, 'ONLINE MARKETPLACE', 2_317);
    const other = idOf(mine.book, 'ONLINE MARKETPLACE', 5_400);
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    await sheet.getByTestId('always-toggle').click();
    // The text starts as what the bank called it, and can be shortened.
    expect(await sheet.getByTestId('always-text').inputValue()).toBe('ONLINE MARKETPLACE');
    // With a rule on, only what a rule can do is offered.
    expect(await sheet.locator('[data-testid^="choice-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(['choice-needs', 'choice-wants']);
    expect(await sheet.getByTestId('sheet-split').count()).toBe(0);
    await sheet.getByTestId('choice-wants').click();
    expect(await textAt(page, 'confirm-title')).toBe('Make this a rule?');
    expect(await textAt(page, 'confirm-ask')).toContain('From now on, purchases whose description contains “ONLINE MARKETPLACE” are sorted as: Wants.');
    expect(watch.posts).toHaveLength(0);
    await sheet.getByTestId('confirm-yes').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.sortAlways(id, { to: 'wants' }, { id: 'rule-1', contains: 'ONLINE MARKETPLACE' }, twin.today);

    // The other one it matches was sorted too, and the answer says so.
    expect(await item(page, other).count()).toBe(0);
    expect(await textAt(page, 'notice')).toContain('1 other waiting item matched and was sorted too.');
    expect(await textAt(page, 'notice')).toContain('From now on it goes there by itself.');
    expect(await textAt(page, 'notice')).not.toContain('may still wait');
    expect(watch.posts).toHaveLength(1);
    expect(JSON.parse(watch.posts[0]!.postData() ?? '{}')).toMatchObject({ always: { contains: 'ONLINE MARKETPLACE' }, confirmed: true });
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    expect(await page.getByTestId('review-count').innerText()).toBe(String(twin.book.reviewItems().length));
    await page.context().close();
  });

  it('13.6 a rule whose text does not match is refused, and no rule is made', async () => {
    const mine = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    await sheet.getByTestId('always-toggle').click();
    await sheet.getByTestId('always-text').fill('NOT THERE AT ALL');
    await sheet.getByTestId('choice-needs').click();
    await sheet.getByTestId('confirm-yes').click();
    await sheet.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('NOT THERE AT ALL');
    expect(await textAt(page, 'notice')).toContain('Nothing was changed.');
    // Back at the choices, with the item still waiting.
    expect(await sheet.getByTestId('always-text').inputValue()).toBe('NOT THERE AT ALL');
    await page.keyboard.press('Escape');
    expect(await item(page, id).count()).toBe(1);
    await page.context().close();
  });

  it('13.6 a rule needs some text; and fees, money out of savings, and early paychecks cannot get a rule', async () => {
    const { book } = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    for (const id of ['busy-fee', 'busy-interest', idOf(book, 'BILL PAY WATER UTILITY'), 'busy-early', 'busy-refund']) {
      await item(page, id).getByTestId('more').click();
      expect(await page.getByTestId('always-toggle').count(), id).toBe(0);
      await page.keyboard.press('Escape');
      await page.getByTestId('review-sheet').waitFor({ state: 'hidden' });
    }
    const store = idOf(book, 'CORNER STORE');
    await item(page, store).getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').fill('   ');
    const watch = watchChoices(page);
    await page.getByTestId('choice-wants').click();
    expect(watch.posts).toHaveLength(0);
    expect(await page.getByTestId('confirm-yes').count()).toBe(0);
    await page.context().close();
  });

  // ----- Splitting -----

  it('4.4 a split: the amount typed goes to needs and wants gets the rest, and the money matches the twin', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    // Nothing typed yet: it cannot be sent, and the screen says what to do.
    expect(await sheet.getByTestId('split-submit').isDisabled()).toBe(true);
    await sheet.getByTestId('split-needs').fill('4.00');
    expect(await sheet.getByTestId('split-submit').isEnabled()).toBe(true);
    await sheet.getByTestId('split-submit').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.sort(id, { split: [{ bucket: 'needs', amount: 400 }, { bucket: 'wants', amount: 750 }] }, twin.today);
    // The answer says what the rest came to, from the money math.
    expect(await textAt(page, 'notice')).toBe('CORNER STORE split: Needs $4.00, Wants $7.50. OK');
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('7.6 a payment to a person: split three ways, with not mine as the rest', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'ZELLE TO MADE UP FRIEND');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    expect(await sheet.getByTestId('split-rest').innerText()).toBe('Not mine gets the rest.');
    await sheet.getByTestId('split-needs').fill('10.00');
    await sheet.getByTestId('split-wants').fill('5.00');
    await sheet.getByTestId('split-submit').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.sort(id, { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 500 }, { bucket: 'not-mine', amount: 2_500 }] }, twin.today);
    expect(await textAt(page, 'notice')).toBe('ZELLE TO MADE UP FRIEND split: Needs $10.00, Wants $5.00, Not mine $25.00. OK');
    const numbers = await bucketsOnScreen(page);
    expect(numbers).toEqual(bucketsOf(twin.book));
    expect(numbers.heldForOthers).toBe(-2_500);
    await page.context().close();
  });

  it('4.4 an amount that cannot be read, or is zero, is said so and cannot be sent', async () => {
    const mine = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    await item(page, id).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    for (const [typed, said] of [
      ['abc', 'Needs: enter an amount like 4.00'],
      ['4.5.0', 'Needs: enter an amount like 4.00'],
      ['0', 'Needs: enter more than zero'],
      ['0.00', 'Needs: enter more than zero'],
    ] as const) {
      await sheet.getByTestId('split-needs').fill(typed);
      expect(await sheet.getByTestId('split-problem').innerText(), typed).toBe(said);
      expect(await sheet.getByTestId('split-submit').isDisabled(), typed).toBe(true);
    }
    await sheet.getByTestId('split-needs').fill('$1,000.00');
    await sheet.getByTestId('split-submit').click();
    // Too big: the money math refuses it, and says so in dollars.
    await sheet.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('$1,000.00');
    expect(watch.posts).toHaveLength(1);
    await page.context().close();
  });

  // ----- The other choices -----

  it('6.1 other income, payback into a bucket, and not mine, each as the money math does them', async () => {
    const twin = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    // Other income, from the item itself.
    await item(page, 'busy-tax').getByTestId('pick-other-income').click();
    await item(page, 'busy-tax').waitFor({ state: 'detached' });
    twin.book.sort('busy-tax', { to: 'other-income' }, twin.today);
    // Payback into Savings, and not mine, from the sheet.
    await item(page, 'busy-refund').getByTestId('more').click();
    await page.getByTestId('choice-savings').click();
    await item(page, 'busy-refund').waitFor({ state: 'detached' });
    twin.book.sort('busy-refund', { to: 'savings' }, twin.today);
    expect(await textAt(page, 'notice')).toContain('ONLINE MARKETPLACE REFUND put back into Savings.');
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('4.5 B16 a store refund goes back into a bucket from the item itself, and is never income', async () => {
    const twin = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const inline = await item(page, 'busy-refund').locator('[data-testid^="pick-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(inline).toEqual(['pick-needs', 'pick-wants']);
    expect(await item(page, 'busy-refund').getByTestId('pick-needs').innerText()).toBe('Into Needs');
    await item(page, 'busy-refund').getByTestId('pick-wants').click();
    await item(page, 'busy-refund').waitFor({ state: 'detached' });
    twin.book.sort('busy-refund', { to: 'wants' }, twin.today);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('5.6 B74 marking a payment as a transfer between my accounts changes no bucket', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'ZELLE TO MADE UP FRIEND');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    await page.getByTestId('choice-transfer-savings').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.sort(id, { transfer: 'savings' }, twin.today);
    expect(await textAt(page, 'notice')).toContain('ZELLE TO MADE UP FRIEND marked as a transfer with Savings.');
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('5.6 B74 a partly refunded purchase cannot be marked a transfer, and the sheet says why', async () => {
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, idOf(life('review-busy').book, 'HARDWARE SUPERSTORE')).getByTestId('more').click();
    expect(await page.getByTestId('sheet-transfer').count()).toBe(0);
    expect(await textAt(page, 'unavailable-transfer')).toBe('Part of it was refunded, so it cannot be marked a transfer.');
    await page.context().close();
  });

  it('5.2 A4 a payment to the old card from savings comes out of savings once confirmed, or needs', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'PAYMENT TO OLD CARD');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    expect(await item(page, id).locator('[data-testid^="pick-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(['pick-savings', 'pick-needs']);
    await item(page, id).getByTestId('pick-savings').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.sort(id, { to: 'savings' }, twin.today);
    expect(await textAt(page, 'notice')).toContain('PAYMENT TO OLD CARD taken out of Savings.');
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('7.6 for mom comes out of the mom reserve', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'ZELLE TO MADE UP FRIEND');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    await page.getByTestId('choice-mom').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.sort(id, { to: 'mom' }, twin.today);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('8.3 B23 the difference on a mom payment goes to needs or wants, and cannot be split', async () => {
    const { book } = life('review-busy');
    const id = 'busy-mom:difference';
    expect(detailOf(book, id).item).toMatchObject({ amount: 30_000 });
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('more').click();
    expect(await page.getByTestId('sheet-split').count()).toBe(0);
    expect(await page.locator('[data-testid^="choice-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(['choice-needs', 'choice-wants']);
    await page.getByTestId('choice-needs').click();
    await item(page, id).waitFor({ state: 'detached' });
    await page.context().close();
  });

  it('5.4 an old card flag is cleared with one tap and moves no money', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'MADE UP FURNITURE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, id).getByTestId('acknowledge').click();
    await item(page, id).waitFor({ state: 'detached' });
    twin.book.acknowledge(id, twin.today);
    expect(await textAt(page, 'notice')).toContain('Seen: MADE UP FURNITURE.');
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.getByTestId('tab-buckets').click();
    expect(await centsAt(page, 'old-card-debt')).toBe(twin.book.oldCardDebt());
    await page.context().close();
  });

  it('every item can be taken through, one after another, until nothing is waiting, and the money always matches', async () => {
    const twin = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    // First choice offered on each: the money math decides what happens.
    for (let guard = 0; guard < 40; guard += 1) {
      const waiting = twin.book.reviewDetails();
      const d = waiting[0];
      if (d === undefined) break;
      const card = (await item(page, d.item.id).count()) === 1 ? item(page, d.item.id) : null;
      if (card === null) throw new Error(`${d.item.id} is waiting in the money math but not on the screen`);
      const o = d.options;
      if (o.type === 'leftover') {
        await card.getByTestId('answer-roll-over').click();
        await page.getByTestId('confirm-yes').click();
        twin.book.answerLeftover(d.item.id, 'roll-over', twin.today);
      } else if (o.type === 'acknowledge') {
        await card.getByTestId('acknowledge').click();
        twin.book.acknowledge(d.item.id, twin.today);
      } else {
        const pick = o.picks.find((p) => !p.final)!;
        await card.getByTestId('more').click();
        await page.getByTestId(`choice-${pick.to}`).click();
        twin.book.sort(d.item.id, { to: pick.to }, twin.today);
      }
      await card.waitFor({ state: 'detached' });
    }
    expect(twin.book.reviewItems()).toEqual([]);
    expect(await page.getByTestId('review-count').innerText()).toBe('0');
    expect(await page.getByTestId('review-empty').count()).toBe(1);
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    expect(twin.book.selfCheck(twin.bank).ok).toBe(true);
    await page.context().close();
  });

  // ----- States -----

  it('with nothing waiting, Review says so and there is no badge', async () => {
    const page = await openReview(await browser().newContext(phone()), base(), 'all-clear');
    expect(await textAt(page, 'review-empty')).toBe('All sorted New activity that needs a decision shows up here.');
    expect(await page.getByTestId('review-count').innerText()).toBe('0');
    expect(await textAt(page, 'review-hero')).toContain("You're all caught up.");
    expect(await page.getByTestId('review-badge').count()).toBe(0);
    expect(await page.locator('[data-testid^="item-"]').count()).toBe(0);
    await page.context().close();
  });

  it('14 before setup day, Review says there is nothing yet', async () => {
    const page = await openReview(await browser().newContext(phone()), base(), 'not-set-up');
    expect(await textAt(page, 'review-not-set-up')).toContain('Nothing to review yet');
    await page.context().close();
  });

  it('while loading, Review shows a placeholder and no numbers; when it cannot load, it says so and Try again loads it', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => (release = done));
    let failing = true;
    await page.route('**/api/review', async (route) => {
      await held;
      if (failing) await route.fulfill({ status: 500, body: '{"error":"review-unavailable"}', contentType: 'application/json' });
      else await route.continue();
    });
    await page.goto(`${base()}/demo/normal`);
    // Home's numbers are in before leaving it (see openScenario).
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.goto(`${base()}/review`);
    await page.getByTestId('review-loading').waitFor();
    expect(await page.getByTestId('review').getAttribute('aria-busy')).toBe('true');
    expect(await page.locator('main [data-money]').count()).toBe(0);
    release();
    await page.getByTestId('review-error').waitFor();
    expect(await textAt(page, 'review-error')).toBe("Couldn't load what is waiting Check your connection, then try again. Try again");
    failing = false;
    await page.getByTestId('retry').click();
    await page.getByTestId('review-count').waitFor();
    expect(await page.getByTestId('review-count').innerText()).toBe(String(life('normal').book.reviewItems().length));
    await context.close();
  });

  it('the made-up numbers say they are made up', async () => {
    const page = await openReview(await browser().newContext(phone()), base(), 'normal');
    expect(await textAt(page, 'made-up')).toBe('MADE-UP DATA');
    await page.context().close();
  });
});

// Books made here, so cases the made-up lives do not reach are shown exactly.
describe.each(ENGINES)('Review, books made for the test, in %s', (_name, engine) => {
  let browser: Browser;
  const servers: Server[] = [];
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
    for (const server of servers) await close(server);
  });

  async function show(book: Book, today: IsoDate = START_DATE) {
    const bank: BankBalances = { checking: appSide(book.pots()) - book.inTransit().total, savings: 0, everydayCard: 0 };
    const live = await startLive({ book, bank, today });
    servers.push(live.server);
    const context = await browser.newContext(phone());
    return { page: await openLive(context, live.base, '/review'), context };
  }

  it('20d a refund with no likely purchase says so', async () => {
    const book = openTestBook();
    book.receive(refund('r1', START_DATE, 2_317, undefined, 'everyday-card'));
    const { page, context } = await show(book);
    expect(await textAt(page, 'likely-none')).toBe('No likely purchase found.');
    // It can still go back into a bucket.
    await page.getByTestId('pick-needs').click();
    await item(page, 'r1').waitFor({ state: 'detached' });
    expect(book.pots().needs).toBe(2_317);
    await context.close();
  });

  it('B54 a deposit older than the last paycheck cannot be my paycheck: the sheet says why, and other income still works', async () => {
    const book = openTestBook({ lastPaycheckDate: '2026-09-25' });
    book.receive(deposit('old', '2026-09-20', 25_000, 'MADE UP LATE ARRIVAL'));
    const { page, context } = await show(book);
    expect(await item(page, 'old').getByTestId('pick-paycheck').count()).toBe(0);
    expect(await item(page, 'old').locator('[data-testid^="pick-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(['pick-other-income', 'pick-needs']);
    await item(page, 'old').getByTestId('more').click();
    expect(await page.getByTestId('choice-paycheck').count()).toBe(0);
    expect(await textAt(page, 'unavailable-paycheck')).toBe('This deposit is older than your last paycheck, so it cannot start a new pay period. It can still be other income.');
    await context.close();
  });

  it('5.6 a pending purchase cannot be marked a transfer yet, and the sheet says to wait', async () => {
    const book = openTestBook();
    book.receive(purchase('pend', START_DATE, 1_150, 'CORNER STORE', { account: 'checking', pending: true }));
    const { page, context } = await show(book);
    await item(page, 'pend').getByTestId('more').click();
    expect(await page.getByTestId('sheet-transfer').count()).toBe(0);
    expect(await textAt(page, 'unavailable-transfer')).toBe('It is still pending. Mark it as a transfer once it posts.');
    await context.close();
  });

  it('14.2 money back from a charge counted on setup day shows as a negative, with a minus sign, and cannot be split', async () => {
    const book = openTestBook({ countedAtSetup: [purchase('s1', '2026-09-30', 1_000, 'GAS HOLD', { account: 'checking', pending: true })] });
    book.receive({ kind: 'purchase', id: 's2', account: 'checking', date: '2026-10-02', amount: 800, description: 'GAS STATION', pending: false, pendingId: 's1' });
    const { page, context } = await show(book);
    expect(await item(page, 's1').getByTestId('item-amount').innerText()).toBe('−$2.00');
    expect(await item(page, 's1').getByTestId('item-amount').getAttribute('aria-label')).toBe('minus $2.00');
    // Money back that is not sorted yet makes safe to spend higher (11.1).
    expect(await centsAt(page, 'raised-by')).toBe(200);
    expect(await page.getByTestId('held-back').count()).toBe(0);
    await item(page, 's1').getByTestId('more').click();
    expect(await page.getByTestId('sheet-split').count()).toBe(0);
    await context.close();
  });

  it('13.6 B49 text that only matches how it looked after it posted: the answer says a new one may still wait', async () => {
    const book = openTestBook();
    book.receive(purchase('p1', START_DATE, 1_150, 'POS DEBIT 4412', { account: 'checking', pending: true }));
    book.receive({ kind: 'purchase', id: 'p2', account: 'checking', date: START_DATE, amount: 1_150, description: 'CORNER STORE #12', pending: false, pendingId: 'p1' });
    const { page, context } = await show(book);
    await item(page, 'p1').getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').fill('CORNER STORE');
    await page.getByTestId('choice-wants').click();
    await page.getByTestId('confirm-yes').click();
    await item(page, 'p1').waitFor({ state: 'detached' });
    expect(await textAt(page, 'notice')).toContain('The text only matches how it looked after it posted, so a new one may still wait while it is pending.');
    expect(await textAt(page, 'notice')).not.toContain('From now on it goes there by itself.');
    await context.close();
  });

  it('A19 13.2 a rule sorts what it can, leaves waiting what it cannot, and says which', async () => {
    const book = openTestBook({ pots: { momReserve: 150_000 } });
    book.receive(payPerson('a', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(payPerson('b', START_DATE, 4_000, 'MADE UP FRIEND'));
    book.receive(payPerson('c', START_DATE, 2_500, 'MADE UP FRIEND'));
    book.receive(refund('r', START_DATE, 1_000, 'b', 'checking'));
    const { page, context } = await show(book);
    await item(page, 'a').getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').fill('MADE UP FRIEND');
    await page.getByTestId('choice-mom').click();
    expect(await textAt(page, 'confirm-ask')).toBe('From now on, payments to people whose description contains “MADE UP FRIEND” are sorted as: For mom. Anything waiting that matches is sorted now too, if it can be.');
    await page.getByTestId('confirm-yes').click();
    await item(page, 'a').waitFor({ state: 'detached' });
    await item(page, 'c').waitFor({ state: 'detached' });
    expect(await textAt(page, 'notice')).toBe('ZELLE TO MADE UP FRIEND marked for mom. 1 other waiting item matched and was sorted too. 1 that matched could not take it, so it is still waiting: ZELLE TO MADE UP FRIEND. From now on it goes there by itself. OK');
    expect(await listed(page)).toEqual(['b']);
    expect(book.reviewItems().map((i) => i.id)).toEqual(['b']);
    expect(book.pots().momReserve).toBe(150_000 - 6_500);
    await context.close();
  });

  it('A18 a refund matched to a purchase that is gone by the time he taps: refused in plain words, and nothing changes', async () => {
    const book = openTestBook({ pots: { needs: 100_000, wants: 100_000 } });
    book.receive(purchase('hw', '2026-10-01', 9_000, 'HARDWARE SUPERSTORE'));
    book.sort('hw', { to: 'wants' }, START_DATE);
    book.receive({ ...refund('r1', START_DATE, 9_000, undefined, 'everyday-card'), description: 'HARDWARE SUPERSTORE' });
    const { page, context } = await show(book);
    await item(page, 'r1').getByTestId('match-hw').click();
    // Meanwhile the bank takes the purchase back.
    book.receive({ kind: 'taken-back', id: 'tb', takenId: 'hw', date: START_DATE, description: 'MADE UP CORRECTION' });
    const before = JSON.stringify(book.pots());
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('review-sheet').getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toBe("That purchase isn't one this refund can belong to. Nothing was changed. OK");
    expect(JSON.stringify(book.pots())).toBe(before);
    expect(book.reviewItems().map((i) => i.id)).toContain('r1');
    await context.close();
  });

  it('4.5 20d a split purchase is listed with how it was split', async () => {
    const book = openTestBook({ pots: { needs: 100_000, wants: 100_000 } });
    book.receive(purchase('hw', '2026-10-01', 9_000, 'HARDWARE SUPERSTORE'));
    book.sort('hw', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, START_DATE);
    // Another store on the card, so the store's name is not on most purchases (A33).
    book.receive(purchase('deli', '2026-10-01', 300, 'CORNER DELI'));
    book.sort('deli', { to: 'needs' }, START_DATE);
    book.receive({ ...refund('r1', START_DATE, 9_000, undefined, 'everyday-card'), description: 'HARDWARE SUPERSTORE' });
    const { page, context } = await show(book);
    const text = (await item(page, 'r1').getByTestId('likely-hw').innerText()).replace(/\s+/g, ' ');
    expect(text).toBe('HARDWARE SUPERSTORE $90.00 Thu, Oct 1 · Split: Needs $60.00, Wants $30.00 · Same name · Same amount This refund is for this one');
    await context.close();
  });

  it('4.4 one cent cannot be split, and two cents can', async () => {
    const book = openTestBook();
    book.receive(purchase('one', START_DATE, 1, 'TINY'));
    book.receive(purchase('two', START_DATE, 2, 'TINY'));
    const { page, context } = await show(book);
    await item(page, 'one').getByTestId('more').click();
    expect(await page.getByTestId('sheet-split').count()).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('review-sheet').waitFor({ state: 'hidden' });
    await item(page, 'two').getByTestId('more').click();
    await page.getByTestId('split-needs').fill('0.01');
    await page.getByTestId('split-submit').click();
    await item(page, 'two').waitFor({ state: 'detached' });
    expect(book.pots()).toMatchObject({ needs: -1, wants: -1 });
    await context.close();
  });

  it('very large amounts are shown and sorted exactly', async () => {
    const huge = 123_456_789_012_345;
    const book = openTestBook({ pots: { wants: 1 } });
    book.receive(purchase('big', START_DATE, huge, 'MADE UP YACHT'));
    const { page, context } = await show(book);
    expect(readCents(await item(page, 'big').getByTestId('item-amount').innerText())).toBe(huge);
    await item(page, 'big').getByTestId('pick-wants').click();
    await item(page, 'big').waitFor({ state: 'detached' });
    expect(book.pots().wants).toBe(1 - huge);
    await context.close();
  });

  it('0.1 a sort that would make a total too large to keep exact is refused in plain words, and nothing changes', async () => {
    const book = openTestBook({ pots: { wants: Number.MAX_SAFE_INTEGER - 1_000 } });
    book.receive(deposit('d1', START_DATE, 5_000, 'MADE UP GIFT'));
    const { page, context } = await show(book);
    await item(page, 'd1').getByTestId('more').click();
    await page.getByTestId('choice-wants').click();
    await page.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('That would make a total too large to keep exact. Nothing was changed.');
    await page.keyboard.press('Escape');
    expect(await item(page, 'd1').count()).toBe(1);
    await context.close();
  });
});

describe.each(ENGINES)('Review keeps up with what he decides, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('a refresh already on its way when a choice goes through is followed by one more, so the list always ends up after the choice', async () => {
    const mine = life('review-busy');
    const twin = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    // The phone coming back to the app asks again. The server answers at once, so that answer is from
    // before the choice; it reaches the phone late.
    const late: (() => Promise<void>)[] = [];
    let holding = true;
    let gets = 0;
    await page.route('**/api/review', async (route) => {
      gets += 1;
      if (!holding) return route.continue();
      const answer = await route.fetch();
      late.push(() => route.fulfill({ response: answer }));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => late.length).toBe(1);
    // Meanwhile he sorts one. The server does it, and the refresh asked before it is still out.
    await item(page, id).getByTestId('pick-wants').click();
    await page.getByTestId('notice').waitFor();
    twin.book.sort(id, { to: 'wants' }, twin.today);
    // The late answer, from before the choice, still has the item in it.
    holding = false;
    for (const deliver of late.splice(0)) await deliver();
    // Without one more ask the list would stay as that late answer left it. With it, the list is the one after the choice.
    await item(page, id).waitFor({ state: 'detached' });
    expect(gets).toBe(2);
    expect(await page.getByTestId('review-count').innerText()).toBe(String(twin.book.reviewItems().length));
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });
});

describe.each(ENGINES)('Review, details, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('what each item is, in words, and where it happened', async () => {
    const { book } = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    // Written out here, on its own: the words are the spec.
    const reasons: Record<string, string> = {
      'money-in:deposit': 'Deposit',
      'money-in:early-paycheck': 'Looks like a paycheck, but it came early',
      'money-in:refund': 'Refund the bank did not match to a purchase',
      'spending:no-rule': 'No rule matched',
      'spending:from-savings': 'Money out of savings',
      'spending:card-fee': 'Card fee',
      'spending:card-interest': 'Card interest',
      'spending:split-changed': 'The split no longer adds up',
      'spending:old-card-from-savings': 'Payment to the old card from savings',
      'spending:person-payment': 'Payment to a person',
      'spending:mom-difference': 'Left over from a mom payment bigger than the reserve',
      'old-card-purchase': 'New purchase on the old card',
      leftover: 'Left over at payday',
    };
    const accounts = { checking: 'Checking', savings: 'Savings', 'everyday-card': 'Everyday card', 'old-card': 'Old card', 'second-card': 'Second card' } as const;
    for (const d of book.reviewDetails()) {
      const key = d.item.type === 'spending' || d.item.type === 'money-in' ? `${d.item.type}:${d.item.reason}` : d.item.type;
      const parts = (await item(page, d.item.id).locator('.decision__detail').first().innerText()).replace(/\s+/g, ' ').replace(/^Pending /, '').split(' · ');
      expect(parts[0], d.item.id).toBe(reasons[key]);
      if (d.account !== null) expect(parts[parts.length - 1], d.item.id).toBe(accounts[d.account]);
    }
    await page.context().close();
  });

  it('what was said about one item is not shown again on the sheet of the next', async () => {
    const mine = life('review-busy');
    const store = idOf(mine.book, 'CORNER STORE');
    const deli = idOf(mine.book, 'CORNER DELI');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, store).getByTestId('pick-wants').click();
    await page.getByTestId('notice').waitFor();
    await item(page, deli).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    await sheet.waitFor();
    expect(await sheet.getByTestId('notice').count()).toBe(0);
    // Nor on the question that asks first.
    await page.keyboard.press('Escape');
    await item(page, deli).getByTestId('pick-needs').click();
    await page.getByTestId('notice').waitFor();
    await item(page, 'busy-early').getByTestId('pick-paycheck').click();
    await page.getByTestId('confirm-yes').waitFor();
    expect(await page.getByTestId('review-sheet').getByTestId('notice').count()).toBe(0);
    await page.context().close();
  });

  it('the message about what was just done stays in view, under the notch, however far down he was', async () => {
    const mine = life('review-busy');
    const deli = idOf(mine.book, 'CORNER DELI');
    const context = await browser().newContext(phone({ bypassCSP: true }));
    const page = await openReview(context, base(), 'review-busy');
    await page.addStyleTag({ content: ':root { --safe-top: 59px !important; }' });
    await item(page, deli).scrollIntoViewIfNeeded();
    await item(page, deli).getByTestId('pick-needs').click();
    const notice = page.getByTestId('notice');
    await notice.waitFor();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    const box = await notice.boundingBox();
    // In view, and below the notch (59) rather than under it.
    expect(box!.y).toBeGreaterThanOrEqual(59);
    expect(box!.y).toBeLessThan(120);
    await context.close();
  });

  it('a tap sends exactly the choice, its decision number, and what the screen showed of the item (Step 3, A31), and nothing else', async () => {
    const mine = life('review-busy');
    const id = idOf(mine.book, 'CORNER STORE');
    const detail = mine.book.reviewDetails().find((d) => d.item.id === id)!;
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const watch = watchChoices(page);
    await item(page, id).getByTestId('pick-wants').click();
    await item(page, id).waitFor({ state: 'detached' });
    expect(JSON.parse(watch.posts[0]!.postData() ?? '{}')).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), item: id, choice: { to: 'wants' }, seen: itemKey(detail) });
    await page.context().close();
  });

  it('while a choice is being saved, nothing else on the screen can be tapped, and it is all back once it is saved', async () => {
    const mine = life('review-busy');
    const store = idOf(mine.book, 'CORNER STORE');
    const deli = idOf(mine.book, 'CORNER DELI');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    const held: Route[] = [];
    let holding = true;
    await page.route('**/api/choice', async (route) => {
      if (holding) held.push(route);
      else await route.continue();
    });
    await item(page, store).getByTestId('pick-wants').click();
    await expect.poll(() => held.length).toBe(1);
    for (const testId of ['pick-needs', 'pick-wants', 'more']) expect(await item(page, deli).getByTestId(testId).isDisabled(), testId).toBe(true);
    expect(await item(page, 'busy-early').getByTestId('pick-paycheck').isDisabled()).toBe(true);
    expect(await item(page, 'busy-furniture').getByTestId('acknowledge').isDisabled()).toBe(true);
    expect(await page.locator('[data-testid^="answer-"]').first().isDisabled()).toBe(true);
    holding = false;
    await held[0]!.continue();
    await item(page, store).waitFor({ state: 'detached' });
    expect(await item(page, deli).getByTestId('pick-needs').isDisabled()).toBe(false);
    await page.context().close();
  });

  it('13.6 6.2 B17 B55 with "always do this" on, a deposit cannot be called my paycheck, and the rest are the choices a rule can make', async () => {
    const { book } = life('review-busy');
    const options = detailOf(book, 'busy-tax').options;
    if (options.type !== 'sort') throw new Error('not something to sort');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, 'busy-tax').getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    expect(await sheet.locator('[data-testid^="choice-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toContain('choice-paycheck');
    expect(await sheet.getByTestId('sheet-transfer').count()).toBe(1);
    await sheet.getByTestId('always-toggle').click();
    expect(await sheet.getByTestId('sheet-transfer').count()).toBe(0);
    const rows = await sheet.locator('[data-testid^="choice-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(rows).toEqual(options.always.map((to) => `choice-${to}`));
    expect(rows).not.toContain('choice-paycheck');
    expect(rows).toContain('choice-other-income');
    await page.context().close();
  });

  it('the amount fields bring up the number pad on the phone', async () => {
    const mine = life('review-busy');
    const page = await openReview(await browser().newContext(phone()), base(), 'review-busy');
    await item(page, idOf(mine.book, 'CORNER STORE')).getByTestId('more').click();
    expect(await page.getByTestId('split-needs').getAttribute('inputmode')).toBe('decimal');
    await page.getByTestId('always-toggle').click();
    expect(await page.getByTestId('always-text').getAttribute('inputmode')).toBe('text');
    await page.context().close();
  });
});

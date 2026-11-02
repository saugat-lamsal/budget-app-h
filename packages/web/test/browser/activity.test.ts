import { MOVABLE_POTS, type BankBalances, type Book, type IsoDate, type Pot } from '@budget-app/money';
import type { Server } from 'node:http';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { START_DATE, appSide, openTestBook, purchase, refund, takenBack } from '../../../money/test/helpers.js';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { activityOf, amountAt, numbersOf, pathOfPot, readActivity, rowOf } from './activity-screens.js';
import { ENGINES, close, openScenario, phone, showScenario, textAt, untilQuiet, useEngine, launch } from './harness.js';
import { openLive, startLive } from './live.js';
import { sheetGapsAfterAnAnswer, tapThenTapWhereItWas, watchChoices, watchSheetsAfterAnAnswer } from './screens.js';

// What went in and out of each bucket, used in a browser like a person would
// (QUESTIONS.md B97 to B102). Every number and row on the screen is compared
// with the money math for the same made-up life; a tap is compared with the
// same answer given to a twin of the book directly. The expected numbers come
// straight from the book (the money package), not from the view the server
// sends.

interface Life {
  readonly book: Book;
  readonly bank: BankBalances;
  readonly today: IsoDate;
}

function life(name: string): Life {
  const input = demoScenario(name)?.input?.();
  if (input === undefined || input.book === null || input.bank === null) throw new Error(`no made-up life called ${name}`);
  return { book: input.book, bank: input.bank, today: input.today };
}

describe.each(ENGINES)('what went in and out of a bucket, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  // ----- What is listed -----

  it('B97 B98 B99 every row and every number of every bucket\'s list is the money math\'s, in the same order', async () => {
    const { book } = life('activity-busy');
    // One page, moved from list to list, the life started over each time (showLive in live.ts says why).
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const pot of MOVABLE_POTS) {
      await showScenario(page, base(), 'activity-busy', pathOfPot(pot));
      const shown = await readActivity(page);
      expect(numbersOf(shown), pot).toEqual(numbersOf(activityOf(book, pot)));
    }
    await context.close();
  });

  it('12.2 B97 it adds up on the screen: what it held, plus what came in, plus what went out, is what it holds now', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const name of ['activity-busy', 'normal', 'payday-paid'] as const) {
      for (const pot of MOVABLE_POTS) {
        await showScenario(page, base(), name, pathOfPot(pot));
        const s = await readActivity(page);
        expect(s.opening + s.in + s.out, `${name} ${pot}`).toBe(s.closing);
        expect(s.rows.reduce((sum, r) => sum + r.amount, 0), `${name} ${pot}`).toBe(s.in + s.out);
        expect(s.now, `${name} ${pot}`).toBe(life(name).book.pots()[pot]);
      }
    }
    await context.close();
  });

  it('B98 each row says what it is, when, where, and what happened to it, in words', async () => {
    const { book } = life('activity-busy');
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/needs');
    const shown = await readActivity(page);
    const text = (id: string): string => shown.rows.find((r) => r.id === id)?.text ?? '';
    const grocery = rowOf(book, 'needs', (r) => r.what === 'purchase' && r.refunded > 0);
    expect(text(grocery.id)).toBe('GROCERY OUTLET #12 Purchase · Sat, Oct 3 · Checking · Refunded $15.00 −$71.43');
    const hardware = rowOf(book, 'needs', (r) => r.partOfSplit);
    expect(text(hardware.id)).toBe('HARDWARE SUPERSTORE Purchase · Sun, Oct 4 · Checking · Part of a split −$60.00');
    expect(text('act-fee')).toBe('LATE FEE Card fee · Sun, Oct 4 · Everyday card −$35.00');
    expect(text('move:1')).toBe('Moved in from Wants Moved by hand · Tue, Oct 6 +$25.00');
    expect(text('demo-pay')).toBe('MADE UP EMPLOYER PAYROLL DIR DEP Paycheck · Fri, Oct 2 · Checking +$810.00');
    expect(text('leftover:demo-pay:needs')).toBe('Leftover moved to Savings Left over at payday · Fri, Oct 2 −$248.38');
    await page.context().close();
  });

  it('B97 B4 a charge pending before payday that posted after it with a tip is a small row in this pay period, on the day of the purchase', async () => {
    const { book } = life('activity-busy');
    const tipId = rowOf(book, 'wants', (r) => r.description === 'BLUE DOOR COFFEE' && r.date === '2026-10-01').id;
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/wants');
    const shown = await readActivity(page);
    const tip = shown.rows.find((r) => r.id === tipId);
    expect(tip?.text).toBe('BLUE DOOR COFFEE Purchase · Thu, Oct 1 · Everyday card −$1.25');
    await page.context().close();
  });

  it('4.6 a charge that is still pending says so, in words as well as an icon', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/wants');
    const pending = page.locator('.row[data-testid^="row-"]', { hasText: 'Pending' });
    expect(await pending.count()).toBe(1);
    expect(await pending.first().locator('[data-status="pending"] [data-icon]').count()).toBe(1);
    expect(await pending.first().innerText()).toContain('BLUE DOOR COFFEE');
    await page.context().close();
  });

  it('7.3 the mom reserve and held for others have lists too, and a bucket with nothing says so', async () => {
    const context = await browser().newContext(phone());
    const page = await openScenario(context, base(), 'activity-busy', '/buckets/mom-reserve');
    const m = await readActivity(page);
    expect(m.rows.map((r) => r.text.split(' ')[0])).toEqual(['ZELLE', 'MADE']);
    expect(numbersOf(m)).toEqual(numbersOf(activityOf(life('activity-busy').book, 'momReserve')));
    // The same page, moved to another life's list (showLive in live.ts says why).
    await showScenario(page, base(), 'normal', '/buckets/held-for-others');
    expect(await textAt(page, 'activity-empty')).toBe('Nothing has gone in or out of Other yet this pay period');
    // Nothing came in and nothing went out: no plus and no minus on zero.
    expect(await textAt(page, 'activity-figures')).toBe('THIS PAY PERIOD Carried in $0.00 Came in $0.00 Went out $0.00 Now $0.00');
    expect((await readActivity(page)).rows).toEqual([]);
    await context.close();
  });

  it('very large amounts are shown exactly', async () => {
    const { book } = life('big');
    const page = await openScenario(await browser().newContext(phone()), base(), 'big', '/buckets/needs');
    expect(numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(book, 'needs')));
    await page.context().close();
  });

  // ----- Getting there -----

  it('B97 a bucket on Buckets opens its own list, in the address, with Buckets still lit, and back goes back', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets');
    await page.getByTestId('bucket-needs').click();
    await page.getByTestId('activity-now').waitFor();
    expect(new URL(page.url()).pathname).toBe('/buckets/needs');
    expect(await page.title()).toBe('Needs · Budget');
    expect(await page.getByTestId('tab-buckets').getAttribute('aria-current')).toBe('page');
    expect(await page.getByTestId('back').innerText()).toBe('Buckets');
    await page.getByTestId('back').click();
    await page.getByTestId('buckets-total').waitFor();
    expect(new URL(page.url()).pathname).toBe('/buckets');
    await page.context().close();
  });

  it('B97 each of the five buckets on Buckets leads to its own list', async () => {
    const context = await browser().newContext(phone());
    const targets: readonly (readonly [string, Pot])[] = [
      ['bucket-needs', 'needs'],
      ['bucket-wants', 'wants'],
      ['row-savings', 'savings'],
      ['row-mom-reserve', 'momReserve'],
      ['row-held', 'heldForOthers'],
    ];
    // One page, Buckets opened afresh before each tap (showLive in live.ts says why).
    const page = await context.newPage();
    for (const [testId, pot] of targets) {
      await showScenario(page, base(), 'activity-busy', '/buckets');
      await page.getByTestId(testId).click();
      await page.getByTestId('activity-now').waitFor();
      expect(new URL(page.url()).pathname, pot).toBe(pathOfPot(pot));
      expect(await amountAt(page, 'activity-now'), pot).toBe(life('activity-busy').book.pots()[pot]);
    }
    await context.close();
  });

  it('B97 opening the address again after a refresh shows the same list', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/wants');
    const before = await readActivity(page);
    await page.reload();
    await page.locator('main[aria-busy="false"]').waitFor();
    expect(await readActivity(page)).toEqual(before);
    await page.context().close();
  });

  it('14 before setup day, a list says it is not there yet', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'not-set-up', '/buckets/needs');
    expect(await textAt(page, 'activity-not-set-up')).toContain('Nothing here yet');
    expect(await page.getByTestId('activity-now').count()).toBe(0);
    await page.context().close();
  });

  it('while loading, a list shows a placeholder and no numbers; when it cannot load, it says so and Try again loads it', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => (release = done));
    let failing = true;
    await page.route('**/api/activity/needs', async (route) => {
      await held;
      if (failing) await route.fulfill({ status: 500, body: '{"error":"activity-unavailable"}', contentType: 'application/json' });
      else await route.continue();
    });
    await page.goto(`${base()}/demo/normal`);
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.goto(`${base()}/buckets/needs`);
    await page.getByTestId('activity-loading').waitFor();
    expect(await page.getByTestId('activity').getAttribute('aria-busy')).toBe('true');
    expect(await page.locator('main [data-money]').count()).toBe(0);
    release();
    await page.getByTestId('activity-error').waitFor();
    expect(await textAt(page, 'activity-error')).toBe("Couldn't load Needs Check your connection, then try again. Try again");
    failing = false;
    await page.getByTestId('retry').click();
    await page.getByTestId('activity-now').waitFor();
    expect(await amountAt(page, 'activity-now')).toBe(life('normal').book.pots().needs);
    await context.close();
  });
});

// ----- Sorting again from the list (4.7, 13.6) -----

describe.each(ENGINES)('sorting something again from a list, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  // The Oct 1 grocery run: bought the day before payday, in Needs, nothing refunded.
  const groceryOct1 = (book: Book): string => rowOf(book, 'needs', (r) => r.what === 'purchase' && r.date === '2026-10-01' && r.description === 'GROCERY OUTLET #12').id;

  it('4.7 B100 a tap on a row, then Wants: the purchase moves, one request, and both lists are what the same answer gives a twin', async () => {
    const twin = life('activity-busy');
    const id = groceryOct1(twin.book);
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/needs');
    const watch = watchChoices(page);
    await page.getByTestId(`row-${id}`).click();
    await page.getByTestId('activity-sheet').getByTestId('choice-wants').click();
    await page.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('GROCERY OUTLET #12 sorted to Wants.');
    expect(watch.posts.length).toBe(1);
    expect(JSON.parse(watch.posts[0]?.postData() ?? '{}')).toMatchObject({ item: id, choice: { to: 'wants' }, resort: true });
    await page.getByTestId(`row-${id}`).waitFor({ state: 'detached' });

    twin.book.sort(id, { to: 'wants' }, twin.today);
    await expect.poll(async () => numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    await page.goto(`${base()}/buckets/wants`);
    await page.locator('main[aria-busy="false"]').waitFor();
    expect(numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'wants')));
    await page.context().close();
  });

  it('13.8 4.7 sorted again from a list the same way as an earlier one from the same place: the rule is offered there too, and made from the row', async () => {
    const twin = life('rule-offer');
    const id = twin.book.reviewItems().find((i) => 'description' in i && i.description === 'SUNRISE BAKERY #208')?.id ?? '';
    const page = await openScenario(await browser().newContext(phone()), base(), 'rule-offer', '/review');
    const watch = watchChoices(page);
    // In Review, to needs: not the way the earlier one went, so nothing is offered.
    await page.getByTestId(`item-${id}`).getByTestId('pick-needs').click();
    await page.getByTestId('notice').waitFor();
    expect(await page.getByTestId('notice-offer').count()).toBe(0);
    await untilQuiet(page);
    await page.goto(`${base()}/buckets/needs`);
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.getByTestId(`row-${id}`).click();
    const sheet = page.getByTestId('activity-sheet');
    // "Always do this" starts from the place's name here too.
    await sheet.getByTestId('always-toggle').click();
    expect(await sheet.getByTestId('always-text').inputValue()).toBe('SUNRISE BAKERY');
    await sheet.getByTestId('always-toggle').click();
    await sheet.getByTestId('choice-wants').click();
    await page.getByTestId('notice-offer').click();
    await page.getByTestId('offer-sheet').getByTestId('offer-yes').click();
    await page.getByTestId('offer-sheet').waitFor({ state: 'hidden' });
    expect(await textAt(page, 'notice')).toContain('From now on it goes there by itself.');
    expect(watch.posts.map((p) => JSON.parse(p.postData() ?? '{}'))).toMatchObject([
      { item: id, choice: { to: 'needs' } },
      { item: id, choice: { to: 'wants' }, resort: true },
      { item: id, choice: { to: 'wants' }, always: { contains: 'SUNRISE BAKERY' }, confirmed: true, resort: true },
    ]);
    twin.book.sort(id, { to: 'needs' }, twin.today);
    twin.book.sort(id, { to: 'wants' }, twin.today);
    twin.book.sortAlways(id, { to: 'wants' }, { id: 'rule-1', contains: 'SUNRISE BAKERY' }, twin.today);
    await page.goto(`${base()}/buckets/wants`);
    await page.locator('main[aria-busy="false"]').waitFor();
    expect(numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'wants')));
    await page.context().close();
  });

  it('4.7 B101 the choice it is already on is shown as "here now" and cannot be tapped', async () => {
    const { book } = life('activity-busy');
    const id = groceryOct1(book);
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/needs');
    const watch = watchChoices(page);
    await page.getByTestId(`row-${id}`).click();
    const here = page.getByTestId('activity-sheet').getByTestId('choice-needs');
    expect(await here.innerText()).toContain('It is here now.');
    expect(await here.evaluate((e) => e.tagName)).toBe('DIV');
    expect(await page.getByTestId('activity-sheet').getByTestId('sheet-amount').innerText()).toBe('$21.50');
    expect(await page.getByTestId('activity-sheet').locator('dt').first().innerText()).toBe('Now in Needs');
    await here.scrollIntoViewIfNeeded();
    await here.click({ force: true });
    expect(watch.posts.length).toBe(0);
    await page.context().close();
  });

  it('4.7 B101 a double tap sends one request, and sorts it once', async () => {
    const twin = life('activity-busy');
    const id = groceryOct1(twin.book);
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/needs');
    const watch = watchChoices(page);
    await page.getByTestId(`row-${id}`).click();
    await page.getByTestId('activity-sheet').getByTestId('choice-wants').dblclick();
    await page.getByTestId(`row-${id}`).waitFor({ state: 'detached' });
    expect(watch.posts.length).toBe(1);
    twin.book.sort(id, { to: 'wants' }, twin.today);
    await expect.poll(async () => numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    await page.context().close();
  });

  it('4.7 B194 the rest of a double tap on a choice in a row\'s sheet does not land on the list under it', async () => {
    const twin = life('activity-busy');
    const id = groceryOct1(twin.book);
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/needs');
    const watch = watchChoices(page);
    await page.getByTestId(`row-${id}`).click();
    expect(await tapThenTapWhereItWas(page, page.getByTestId('activity-sheet').getByTestId('choice-wants'), 'activity-sheet'), 'what of the screen the second tap reached').toBe('nothing');
    await untilQuiet(page);
    expect(watch.posts.length).toBe(1);
    expect(await page.locator('dialog[open]').evaluateAll((open) => open.map((d) => d.getAttribute('data-testid'))), 'a sheet opened under the second tap').toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/buckets/needs');
    twin.book.sort(id, { to: 'wants' }, twin.today);
    expect(numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    await page.context().close();
  });

  // The same moment as Review's (B92): the answer is back, and the list still
  // shows the numbers from before it, with the row still there. Opened again
  // then, its sheet's choices stay off until the numbers asked for after the
  // answer are shown.
  it('4.7 B92 a choice already sent cannot be sent again while the list still shows the numbers from before it', async () => {
    const twin = life('activity-busy');
    const id = groceryOct1(twin.book);
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/needs');
    const watch = watchChoices(page);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = false;
    await page.route('**/api/activity/needs', async (route) => {
      asked = true;
      await held;
      await route.continue();
    });
    await page.getByTestId(`row-${id}`).click();
    await page.getByTestId('activity-sheet').getByTestId('choice-wants').click();
    await expect.poll(() => asked).toBe(true);
    await page.getByTestId('activity-sheet').waitFor({ state: 'hidden' });
    await page.getByTestId(`row-${id}`).click();
    // The sheet's rows take no tap while it is busy (they are rows, not buttons).
    await page.getByTestId('activity-sheet').getByTestId('choice-wants').click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))));
    release();
    await page.getByTestId(`row-${id}`).waitFor({ state: 'detached' });
    await page.unrouteAll({ behavior: 'wait' });
    await untilQuiet(page);
    expect(watch.posts.length).toBe(1);
    twin.book.sort(id, { to: 'wants' }, twin.today);
    await expect.poll(async () => numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    await page.context().close();
  });

  it('4.7 B101 once a choice has gone through, the sheet never shows a button that could send it again', async () => {
    const twin = life('activity-busy');
    const id = groceryOct1(twin.book);
    const context = await browser().newContext(phone());
    await watchSheetsAfterAnAnswer(context, '[data-testid^="choice-"]');
    const page = await openScenario(context, base(), 'activity-busy', '/buckets/needs');
    await page.getByTestId(`row-${id}`).click();
    await page.getByTestId('activity-sheet').getByTestId('choice-wants').click();
    await page.getByTestId('notice').waitFor();
    const seen = await sheetGapsAfterAnAnswer(page);
    expect(seen.answered).toBe(true);
    expect(seen.gaps).toEqual([]);
    await page.context().close();
  });

  it('13.6 B102 "always do this" asks first; Cancel changes nothing and sends nothing; Yes sorts it and makes the rule, the same as the twin', async () => {
    const twin = life('activity-busy');
    const id = groceryOct1(twin.book);
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/needs');
    const watch = watchChoices(page);
    await page.getByTestId(`row-${id}`).click();
    const sheet = page.getByTestId('activity-sheet');
    await sheet.getByTestId('always-toggle').click();
    expect(await sheet.getByTestId('always-text').inputValue()).toBe('GROCERY OUTLET #12');
    await sheet.getByTestId('always-text').fill('GROCERY OUTLET');
    await sheet.getByTestId('choice-wants').click();
    expect(await textAt(page, 'confirm-title')).toBe('Make this a rule?');
    expect(await textAt(page, 'confirm-ask')).toContain('From now on, purchases whose description contains “GROCERY OUTLET” are sorted as: Wants.');
    await page.getByTestId('confirm-cancel').click();
    expect(watch.posts.length).toBe(0);
    await sheet.getByTestId('choice-wants').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    expect(watch.posts.length).toBe(1);
    const sent = JSON.parse(watch.posts[0]?.postData() ?? '{}') as { id: string; always: { contains: string }; confirmed: boolean; resort: boolean };
    expect(sent).toMatchObject({ item: id, always: { contains: 'GROCERY OUTLET' }, confirmed: true, resort: true });
    expect(await textAt(page, 'notice')).toContain('From now on it goes there by itself.');

    twin.book.sortAlways(id, { to: 'wants' }, { id: `always-${sent.id}`, contains: 'GROCERY OUTLET' }, twin.today);
    await expect.poll(async () => numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    await page.context().close();
  });

  it('5.6 A20 B110 a purchase marked as a payment to the old card: its sheet says so, offers what the purchase could be, and picking Wants makes it that purchase', async () => {
    const twin = life('activity-marked');
    const id = 'act-landlord';
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-marked', '/buckets/needs');
    const watch = watchChoices(page);
    // The row is there, as a payment to the old card, and the list is what the money math says.
    expect(await textAt(page, `row-${id}`)).toContain('Payment to the old card');
    await page.getByTestId(`row-${id}`).click();
    const sheet = page.getByTestId('activity-sheet');
    expect(await sheet.getByTestId('marked-note').innerText()).toBe('You marked this as a payment to the old card, so it comes out of Needs. Pick what it was, and it counts as the purchase the bank sent instead.');
    expect(await sheet.innerText()).toContain('Now marked as a payment to the old card, out of Needs');
    // What it could be before it was marked: Needs, Wants, a split, a transfer with another account. Never savings, and not the old card again.
    expect(await sheet.getByTestId('choice-needs').count()).toBe(1);
    expect(await sheet.getByTestId('choice-wants').count()).toBe(1);
    expect(await sheet.getByTestId('choice-savings').count()).toBe(0);
    expect(await sheet.getByTestId('choice-needs').innerText()).not.toContain('here now');
    expect(await sheet.getByTestId('choice-transfer-old-card').count()).toBe(0);
    expect(await sheet.getByTestId('choice-transfer-savings').count()).toBe(1);
    await sheet.getByTestId('choice-wants').click();
    await page.getByTestId('notice').waitFor();
    expect(watch.posts.length).toBe(1);
    expect(JSON.parse(watch.posts[0]?.postData() ?? '{}')).toMatchObject({ item: id, choice: { to: 'wants' }, resort: true });
    twin.book.sort(id, { to: 'wants' }, twin.today);
    await expect.poll(async () => numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    await page.goto(`${base()}/buckets/wants`);
    await page.locator('main[aria-busy="false"]').waitFor();
    expect(numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'wants')));
    // The row is the purchase now, and says what it was.
    await page.getByTestId(`row-${id}`).click();
    expect(await page.getByTestId('activity-sheet').getByTestId('marked-note').count()).toBe(0);
    await page.context().close();
  });

  it('5.6 A20 B110 picking Needs for a marked payment keeps it in Needs, as the purchase the bank sent (it used to be refused)', async () => {
    const twin = life('activity-marked');
    const id = 'act-landlord';
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-marked', '/buckets/needs');
    const watch = watchChoices(page);
    await page.getByTestId(`row-${id}`).click();
    await page.getByTestId('activity-sheet').getByTestId('choice-needs').click();
    await page.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('MADE UP LANDLORD sorted to Needs.');
    expect(watch.posts.length).toBe(1);
    twin.book.sort(id, { to: 'needs' }, twin.today);
    await expect.poll(async () => numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    // Now it is the purchase: Needs is "here now", and marking it with the old card is offered again.
    await page.getByTestId(`row-${id}`).click();
    const sheet = page.getByTestId('activity-sheet');
    expect(await sheet.getByTestId('choice-needs').innerText()).toContain('here now');
    expect(await sheet.getByTestId('choice-transfer-old-card').count()).toBe(1);
    await page.context().close();
  });

  it('13.6 A20 B110 "always do this" from a marked payment asks first, then sorts it and makes the rule', async () => {
    const twin = life('activity-marked');
    const id = 'act-landlord';
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-marked', '/buckets/needs');
    const watch = watchChoices(page);
    await page.getByTestId(`row-${id}`).click();
    const sheet = page.getByTestId('activity-sheet');
    await sheet.getByTestId('always-toggle').click();
    expect(await sheet.getByTestId('always-text').inputValue()).toBe('MADE UP LANDLORD');
    await sheet.getByTestId('choice-wants').click();
    expect(await textAt(page, 'confirm-title')).toBe('Make this a rule?');
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    expect(watch.posts.length).toBe(1);
    const sent = JSON.parse(watch.posts[0]?.postData() ?? '{}') as { id: string };
    twin.book.sortAlways(id, { to: 'wants' }, { id: `always-${sent.id}`, contains: 'MADE UP LANDLORD' }, twin.today);
    await expect.poll(async () => numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    await page.context().close();
  });

  it('B100 a paycheck, a leftover, and a hand move say why they cannot be sorted again, and offer nothing', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/needs');
    const watch = watchChoices(page);
    for (const [id, why] of [
      ['demo-pay', "A paycheck can't be sorted again"],
      ['leftover:demo-pay:needs', 'Your answer to a payday question is final'],
      ['move:1', 'A hand move is undone by moving the money back'],
    ] as const) {
      await page.getByTestId(`row-${id}`).click();
      const sheet = page.getByTestId('activity-sheet');
      expect(await sheet.getByTestId('cannot-resort').innerText(), id).toContain(why);
      expect(await sheet.getByTestId('sheet-picks').count(), id).toBe(0);
      expect(await sheet.getByTestId('always-toggle').count(), id).toBe(0);
      await page.keyboard.press('Escape');
    }
    expect(watch.posts.length).toBe(0);
    await page.context().close();
  });

  it('4.4 B100 a row that is only the part of a split purchase says so, and sorting it sorts the whole purchase', async () => {
    const twin = life('activity-busy');
    const part = rowOf(twin.book, 'needs', (r) => r.partOfSplit);
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/needs');
    await page.getByTestId(`row-${part.id}`).click();
    const sheet = page.getByTestId('activity-sheet');
    expect(await sheet.getByTestId('split-part').innerText()).toContain('only the part of a split purchase that is in Needs: −$60.00');
    expect(await sheet.getByTestId('sheet-amount').innerText()).toBe('$90.00');
    await sheet.getByTestId('choice-wants').click();
    await page.getByTestId(`row-${part.id}`).waitFor({ state: 'detached' });
    twin.book.sort(part.id, { to: 'wants' }, twin.today);
    await expect.poll(async () => numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    await page.context().close();
  });

});

// A book made for the test, so each kind of refusal and each state is exact.
describe.each(ENGINES)('sorting again: books made for the test, in %s', (_name, engine) => {
  let browser: Browser;
  const servers: Server[] = [];
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
    for (const server of servers) await close(server);
  });

  const RULES = [{ id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' }] as const;

  async function show(book: Book, path: string) {
    const bank: BankBalances = { checking: appSide(book.pots()) - book.inTransit().total, savings: 0, everydayCard: 0 };
    const live = await startLive({ book, bank, today: START_DATE });
    servers.push(live.server);
    const context = await browser.newContext(phone());
    return { page: await openLive(context, live.base, path), context };
  }

  it('4.10 an item the bank took back after the list was shown: the tap is refused, says why, and changes nothing', async () => {
    const book = openTestBook({ pots: { needs: 50_000, wants: 20_000 }, rules: RULES });
    book.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    const { page, context } = await show(book, '/buckets/needs');
    const watch = watchChoices(page);
    // After the list was loaded, the bank takes it back.
    book.receive(takenBack('t1', 'g1', '2026-10-03'));
    const before = JSON.stringify([book.pots(), book.changeLog(), book.activity('needs')]);
    await page.getByTestId('row-g1').click();
    await page.getByTestId('activity-sheet').getByTestId('choice-wants').click();
    const notice = page.getByTestId('activity-sheet').getByTestId('notice');
    await notice.waitFor();
    expect(await notice.innerText()).toContain('The bank took it back, so there is nothing left to sort. Nothing was changed.');
    expect(await notice.getAttribute('role')).toBe('alert');
    expect(watch.posts.length).toBe(1);
    expect(JSON.stringify([book.pots(), book.changeLog(), book.activity('needs')])).toBe(before);
    await context.close();
  });

  it('A18 4.5 a refund put into Wants lists the purchases it likely belongs to; matching asks first, and then counts as if the bank had matched it', async () => {
    const book = openTestBook({ pots: { needs: 50_000, wants: 20_000 }, rules: RULES });
    const twin = openTestBook({ pots: { needs: 50_000, wants: 20_000 }, rules: RULES });
    for (const b of [book, twin]) {
      b.receive(purchase('g1', '2026-10-01', 3_250, 'MADE UP GROCERY'));
      b.receive(refund('r1', START_DATE, 3_250));
      b.sort('r1', { to: 'wants' }, START_DATE);
    }
    const { page, context } = await show(book, '/buckets/wants');
    const watch = watchChoices(page);
    await page.getByTestId('row-r1').click();
    const sheet = page.getByTestId('activity-sheet');
    expect(await sheet.getByTestId('likely-g1').innerText()).toContain('MADE UP GROCERY');
    await sheet.getByTestId('match-g1').click();
    expect(await textAt(page, 'confirm-title')).toBe('Match this refund?');
    expect(watch.posts.length).toBe(0);
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    twin.sort('r1', { refundOf: 'g1' }, START_DATE);
    expect(book.pots()).toEqual(twin.pots());
    await expect.poll(async () => numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin, 'wants')));
    await context.close();
  });

  it('6.1 B52 a deposit put into a bucket can still be called your paycheck: it asks first, and shows the split it would get', async () => {
    const book = openTestBook({ pots: { needs: 50_000, wants: 20_000 }, rules: RULES });
    const twin = openTestBook({ pots: { needs: 50_000, wants: 20_000 }, rules: RULES });
    for (const b of [book, twin]) {
      b.receive({ kind: 'deposit', id: 'd1', account: 'checking', date: '2026-10-02', amount: 400_000, description: 'MADE UP NEW JOB' });
      b.sort('d1', { to: 'wants' }, START_DATE);
    }
    const { page, context } = await show(book, '/buckets/wants');
    await page.getByTestId('row-d1').click();
    await page.getByTestId('activity-sheet').getByTestId('choice-paycheck').click();
    expect(await textAt(page, 'confirm-title')).toBe('Start a new pay period?');
    expect(await page.getByTestId('preview-mom').innerText()).toBe('$1,500.00');
    expect(book.period().number).toBe(0);
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    twin.sort('d1', { to: 'paycheck' }, START_DATE);
    expect(book.period().number).toBe(1);
    expect(book.pots()).toEqual(twin.pots());
    await context.close();
  });
});

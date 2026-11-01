import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkBankRules } from '../../../server/src/bank/reading.js';
import { memoryLog } from '../../../server/src/log.js';
import { HER_START } from '../../../server/src/setup-start.js';
import { parseWishlistRequest } from '../../../server/src/wishlist-items.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { HER_BANK_RULES, setUpHer } from '../../../server/test/her-harness.js';
import { decision, lifeInAFile, noonInNewYork, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { axeViolations, tappable } from './design-helpers.js';
import { ENGINES, WEB_ROOT, centsAt, close, launch, listen, phone, untilAnswered, untilQuiet, waitOrReport } from './harness.js';
import { item, watchChoices } from './screens.js';

// Her rulebook, 7.7, 7.8, 9.9 and 52.4 (60j) on the screens of the real server,
// used in a browser like a person would. The made-up bank calls the cards
// "Made-up Everyday Card" and "Made-up Second Card". Every name and number is
// made up.

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;
const SECOND = ACCOUNT_IDS.second;
const words = (text: string): string => text.replace(/\s+/g, ' ').trim();

const SECOND_CARD_RULES = checkBankRules([
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);
const statement = (closing: string, due: string, balance: number) => ({ is_overdue: false, last_payment_amount: null, last_payment_date: null, last_statement_issue_date: closing, last_statement_balance: balance, minimum_payment_amount: 35, next_payment_due_date: due });

// Both cards' statements, long before their first reminder day; a purchase on
// the Amex card waiting, and a friend's cash deposited, with a thing on her list.
async function herLife(): Promise<Life> {
  const life = await lifeInAFile({
    herSetup: true,
    secondCard: 25_000,
    rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]),
    start: HER_START,
    history: (fake) => {
      fake.setStatement(E, statement('2026-09-20', '2026-10-30', 450));
      fake.setStatement(SECOND, statement('2026-09-28', '2026-10-28', 250));
      fake.addPosted({ id: 'pay-c', account: C, amount: 45_000, date: '2026-09-25', description: 'payment to CRD 3333' });
      fake.addPosted({ id: 'paid-e', account: E, amount: -45_000, date: '2026-09-25', description: 'PAYMENT - THANK YOU' });
    },
  });
  setUpHer(life);
  const added = parseWishlistRequest({ id: decision(), wishlist: { add: { name: 'Rain jacket', price: 12_000 } } });
  if (added === null || !life.keeper.wishlist(added).ok) throw new Error('the list did not take it');
  life.h.fake.addPosted({ id: 'gift-1', account: SECOND, amount: 8_000, date: '2026-10-03', description: 'MADE UP GIFT' });
  life.h.fake.addPosted({ id: 'split-1', account: E, amount: 10_000, date: '2026-10-03', description: 'MADE UP SHOP' });
  life.h.fake.addPosted({ id: 'cash-1', account: C, amount: -14_000, date: '2026-10-03', description: 'MADE UP ATM DEPOSIT' });
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

describe.each(ENGINES)('Other and her statements on the screens, in %s', (_name, engine) => {
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

  it('9.9 60i Buckets shows each card by its name, the one paid before setup day says Paid, and a row opens its statement', async () => {
    await served(await herLife(), async (page, base) => {
      await open(page, base, '/buckets');
      const everyday = words(await page.getByTestId('statement-everyday-card').innerText());
      expect(everyday).toContain('Made-up Everyday Card statement');
      expect(everyday).toContain('Paid. Due Fri, Oct 30.');
      expect(await centsAt(page, 'statement-everyday-card-amount')).toBe(45_000);
      const second = words(await page.getByTestId('statement-second-card').innerText());
      expect(second).toContain('Made-up Second Card statement');
      expect(second).toContain('Due in 25 days, Wed, Oct 28. Minimum $35.00.');
      expect(await centsAt(page, 'statement-second-card-amount')).toBe(25_000);
      expect(words(await page.getByTestId('card-statements').innerText()).toLowerCase()).not.toContain('old card');
      await page.getByTestId('statement-second-card').click();
      await page.waitForURL(`${base}/statement/second-card`);
    });
  });

  it('7.3 Buckets says Other, and what a negative means', async () => {
    const life = await herLife();
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      await item(page, 'gift-1').getByTestId('more').click();
      await page.getByTestId('choice-not-mine').click();
      await item(page, 'gift-1').waitFor({ state: 'detached' });
      expect(life.keeper.book()!.pots().heldForOthers).toBe(-8_000);
      await open(page, base, '/buckets');
      const row = words(await page.getByTestId('row-held').innerText());
      expect(row).toContain('Other');
      expect(row).toContain('More went out than came in. Move money in to clear it.');
      expect(row).not.toContain('Held for others');
    });
  });

  it('7.7 a purchase on a card: Other, on a sheet that says what it is, and a split with Wishlist in which Wants gets the rest', async () => {
    const life = await herLife();
    const before = life.keeper.book()!.pots();
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      await item(page, 'split-1').getByTestId('more').click();
      const sheet = page.getByTestId('review-sheet');
      await sheet.waitFor();
      expect(words(await sheet.getByTestId('choice-not-mine').innerText())).toContain('Other (not Needs or Wants)');
      expect(words(await sheet.getByTestId('split-rest').innerText())).toBe('Wants gets the rest.');
      await sheet.getByTestId('split-not-mine').fill('60.00');
      await sheet.getByTestId('split-wishlist').fill('25.00');
      await sheet.getByTestId('split-submit').click();
      // 50.3: a Wishlist part of a purchase asks which thing it was.
      await sheet.getByTestId('which-item-title').waitFor();
      await sheet.getByTestId('which-none').click();
      await item(page, 'split-1').waitFor({ state: 'detached' });
      const after = life.keeper.book()!.pots();
      expect(after.heldForOthers).toBe(before.heldForOthers - 6_000);
      expect(after.wishlist).toBe((before.wishlist ?? 0) - 2_500);
      expect(after.wants).toBe(before.wants - 1_500);
      expect(after.needs).toBe(before.needs);
    });
  });

  it('4.4 60j a split with no Wishlist amount does not ask which thing on her list it was', async () => {
    const life = await herLife();
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      await item(page, 'split-1').getByTestId('more').click();
      const sheet = page.getByTestId('review-sheet');
      await sheet.getByTestId('split-needs').fill('60.00');
      await sheet.getByTestId('split-submit').click();
      await item(page, 'split-1').waitFor({ state: 'detached' });
      expect(life.keeper.book()!.reviewItems().some((i) => i.id === 'split-1')).toBe(false);
    });
  });

  it('7.8 a friend\'s cash split with Wishlist: five parts on the sheet, Wants gets the rest, and no thing on her list is asked about', async () => {
    const life = await herLife();
    const before = life.keeper.book()!.pots();
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      const sent = watchChoices(page);
      await item(page, 'cash-1').getByTestId('more').click();
      const sheet = page.getByTestId('review-sheet');
      await sheet.waitFor();
      for (const part of ['not-mine', 'savings', 'needs', 'wishlist']) expect(await sheet.getByTestId(`split-${part}`).count(), part).toBe(1);
      expect(words(await sheet.getByTestId('split-rest').innerText())).toBe('Wants gets the rest.');
      await sheet.getByTestId('split-not-mine').fill('100.00');
      await sheet.getByTestId('split-wishlist').fill('25.00');
      await sheet.getByTestId('split-submit').click();
      await item(page, 'cash-1').waitFor({ state: 'detached' });
      expect(sent.posts).toHaveLength(1);
      const after = life.keeper.book()!.pots();
      expect(after.heldForOthers).toBe(before.heldForOthers + 10_000);
      expect(after.wishlist).toBe((before.wishlist ?? 0) + 2_500);
      expect(after.wants).toBe(before.wants + 1_500);
    });
  });

  it('52.4 7.7 a purchase marked Other is on its statement, under Other, not Still unsorted', async () => {
    const life = await herLife();
    life.h.fake.setStatement(SECOND, statement('2026-10-05', '2026-10-30', 80));
    await served(life, async (page, base) => {
      await open(page, base, '/review');
      await item(page, 'gift-1').getByTestId('more').click();
      await page.getByTestId('choice-not-mine').click();
      await item(page, 'gift-1').waitFor({ state: 'detached' });
      life.now = noonInNewYork('2026-10-06');
      await life.sync();
      await open(page, base, '/statement/second-card');
      const text = words((await page.locator('main').innerText()));
      expect(text).toContain('Other');
      expect(text).not.toContain('Still unsorted');
    });
  });

  it('9.9 design: the statements card has no contrast problem, and its rows can be tapped', async () => {
    await served(await herLife(), async (page, base) => {
      await open(page, base, '/buckets');
      expect(await axeViolations(page)).toEqual([]);
      expect((await tappable(page)).filter((t) => t.height < 44 || t.width < 44)).toEqual([]);
    });
  });
});

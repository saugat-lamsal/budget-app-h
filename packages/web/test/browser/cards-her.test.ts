import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkBankRules } from '../../../server/src/bank/reading.js';
import { memoryLog } from '../../../server/src/log.js';
import { HER_START } from '../../../server/src/setup-start.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { HER_BANK_RULES, setUpHer } from '../../../server/test/her-harness.js';
import { choose, lifeInAFile, noonInNewYork, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { axeViolations, tappable } from './design-helpers.js';
import { ENGINES, WEB_ROOT, centsAt, close, launch, listen, phone, untilAnswered, untilQuiet, waitOrReport } from './harness.js';

// Her rulebook, section 52 (PR 7+8) on the screens of the real server, used
// in a browser like a person would: each card on Home, with what it owes and
// that all of it is set aside, where its payment stands in words, the sheet
// that says why paying a card isn't spending, and each card's statement in
// lines that add up to its balance. The made-up bank calls the cards
// "Made-up Everyday Card" and "Made-up Second Card". Every name and number is
// made up.

const SECOND_CARD_RULES = checkBankRules([
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);
const E = ACCOUNT_IDS.everyday;
const words = (text: string): string => text.replace(/\s+/g, ' ').trim();

const statement = (closing: string | null, due: string, balance: number) => ({ is_overdue: false, last_payment_amount: null, last_payment_date: null, last_statement_issue_date: closing, last_statement_balance: balance, minimum_payment_amount: 35, next_payment_due_date: due });

// Her month: the everyday card's statement before (Sep 25, 450.00), groceries
// and a cafe sorted, its payment, and its next statement (Oct 25, 76.62); the
// second card's first statement, whose statement date the bank leaves out.
async function herMonth(): Promise<Life> {
  const life = await lifeInAFile({ herSetup: true, secondCard: 25_000, rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]), start: HER_START });
  const fake = life.h.fake;
  fake.setStatement(E, statement('2026-09-25', '2026-10-20', 450));
  fake.setStatement(ACCOUNT_IDS.second, statement(null, '2026-11-03', 250));
  await life.sync();
  setUpHer(life);
  const day = async (date: string, items: () => void): Promise<void> => {
    items();
    life.now = noonInNewYork(date);
    await life.sync();
  };
  await day('2026-10-02', () => fake.addPosted({ id: 'grocery-1', account: E, amount: 6_412, date: '2026-10-02', description: 'MADE UP GROCERY' }));
  await day('2026-10-09', () => {
    fake.addPosted({ id: 'pay-e', account: ACCOUNT_IDS.checking, amount: 45_000, date: '2026-10-09', description: 'payment to CRD 3333' });
    fake.addPosted({ id: 'paid-e', account: E, amount: -45_000, date: '2026-10-09', description: 'PAYMENT - THANK YOU' });
    fake.addPosted({ id: 'cafe-1', account: E, amount: 1_250, date: '2026-10-09', description: 'MADE UP CAFE' });
  });
  for (const [item, choice] of [
    ['grocery-1', { to: 'needs' }],
    ['cafe-1', { to: 'wants' }],
  ] as const) {
    const answer = choose(life.keeper, { item, choice });
    if (!answer.ok) throw new Error(`${item}: ${answer.why}`);
  }
  await day('2026-10-27', () => {
    fake.addPosted({ id: 'pharmacy-1', account: E, amount: 1_999, date: '2026-10-26', description: 'MADE UP PHARMACY' });
    fake.setStatement(E, statement('2026-10-25', '2026-11-20', 76.62));
  });
  return life;
}

async function open(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`);
  await waitOrReport(page, 'main[aria-busy="false"]');
  await untilAnswered(page);
  await untilQuiet(page);
}

describe.each(ENGINES)('her cards on Home and their statements, in %s', (_name, engine) => {
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

  it('52.1 52.2 Home shows each card by its name: its statement, what is paid, what it owes now and that all of it is set aside; reminders off in words', async () => {
    await served(await herMonth(), async (page, base) => {
      await open(page, base, '/home');
      const everyday = words(await page.getByTestId('card-everyday-card').innerText());
      expect(everyday).toContain('Made-up Everyday Card · Due Fri, Nov 20');
      expect(everyday).toContain('Statement $76.62, due Fri, Nov 20; $0.00 paid toward it. Owes $96.61 now, all of it set aside.');
      expect(await centsAt(page, 'card-everyday-card-owes')).toBe(9_661);
      const second = words(await page.getByTestId('card-second-card').innerText());
      expect(second).toContain('Made-up Second Card');
      expect(second).toContain('Card reminders are off: the bank did not send its statement date.');
      expect(second).toContain('Owes $250.00 now, all of it set aside.');
      // 52.2: the savings account holds more than the savings bucket, so some of it is there.
      expect(words(await page.getByTestId('cards-in-savings').innerText())).toBe('$346.61 of the money set aside for your cards is in your savings account, not checking.');
      // The sheet, in plain words.
      await page.getByTestId('cards-why').click();
      const sheet = page.getByTestId('cards-sheet');
      await sheet.waitFor();
      expect(words(await sheet.innerText())).toContain('That\'s what "set aside" means.');
      expect(await axeViolations(page)).toEqual([]);
    });
  });

  it('52.4 tapping a card opens its statement: carried in less the payment, purchases by bucket and by paycheck, adding up to its balance', async () => {
    await served(await herMonth(), async (page, base) => {
      await open(page, base, '/home');
      await page.getByTestId('card-everyday-card').click();
      await waitOrReport(page, '[data-testid="statement-hero"]');
      await untilQuiet(page);
      expect(new URL(page.url()).pathname).toBe('/statement/everyday-card');
      expect(words((await page.getByTestId('statement-hero').textContent()) ?? '')).toContain('Made-up Everyday Card statement');
      expect(await centsAt(page, 'statement-balance')).toBe(7_662);
      expect(words(await page.getByTestId('statement-carried').innerText())).toContain('$450.00 on the statement before, less $450.00 paid and credited since.');
      const carried = await centsAt(page, 'statement-carried-in');
      const charges = await centsAt(page, 'statement-charges');
      expect(carried + charges).toBe(await centsAt(page, 'statement-total'));
      expect(await page.getByTestId('statement-not-matched-row').count()).toBe(0);
      expect(await centsAt(page, 'statement-group-needs-total')).toBe(6_412);
      expect(await centsAt(page, 'statement-group-wants-total')).toBe(1_250);
      // Tapping a bucket lists its purchases.
      await page.getByTestId('statement-group-needs').click();
      const items = page.getByTestId('statement-items-sheet');
      await items.waitFor();
      expect(words(await items.innerText())).toContain('MADE UP GROCERY');
      expect(await axeViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await untilQuiet(page);
      // By paycheck: the books' first pay period, from setup day.
      await page.getByTestId('statement-by-paycheck').click();
      expect(words(await page.getByTestId('statement-groups').innerText())).toContain('From setup day, Thu, Oct 1');
      expect(await centsAt(page, 'statement-group-period-0-total')).toBe(7_662);
      // 44-point taps.
      for (const t of await tappable(page)) expect(Math.min(t.width, t.height), t.what).toBeGreaterThanOrEqual(44);
      expect(await axeViolations(page)).toEqual([]);
      // Back goes to Home.
      await page.getByTestId('back').click();
      await waitOrReport(page, '[data-testid="home"]');
      expect(new URL(page.url()).pathname).toBe('/home');
    });
  });

  it('52.4 what the lines do not account for is never hidden, above zero or below it', async () => {
    // The bank's statement says 6.62 less than the app's lines add up to.
    const life = await herMonth();
    life.h.fake.setStatement(E, statement('2026-10-25', '2026-11-20', 70));
    await life.sync();
    await served(life, async (page, base) => {
      await open(page, base, '/statement/everyday-card');
      expect(words(await page.getByTestId('statement-not-matched-row').innerText())).toContain('Not matched to a purchase');
      expect(await centsAt(page, 'statement-not-matched')).toBe(-662);
      expect((await centsAt(page, 'statement-carried-in')) + (await centsAt(page, 'statement-charges')) + (await centsAt(page, 'statement-not-matched'))).toBe(await centsAt(page, 'statement-total'));
      expect(await axeViolations(page)).toEqual([]);
    });
  });

  it('52.4 a card with no statement it can read says so', async () => {
    await served(await herMonth(), async (page, base) => {
      await open(page, base, '/statement/second-card');
      expect(words(await page.getByTestId('statement-none').innerText())).toContain('Card reminders are off: the bank did not send its statement date.');
      expect(await axeViolations(page)).toEqual([]);
    });
  });
});

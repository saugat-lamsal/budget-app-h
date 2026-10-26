// npm run screenshots [-- --out <folder>] [-- --only <name prefix>]
//
// iPhone-size pictures of the screens on the demo's made-up lives, in the
// app's one (dark) look, for pull requests. Taken in WebKit (iPhone Safari's
// engine) at the iPhone 15's size, with its notch and home bar areas, and
// saved to screenshots/ (kept out of git) unless --out says otherwise.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const root = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt === -1 ? path('screenshots') : args[outAt + 1];
// Only the pictures whose names start with this, such as "settings".
const onlyAt = args.indexOf('--only');
const only = onlyAt === -1 ? undefined : args[onlyAt + 1];
const port = 5199;

const built = spawnSync(process.execPath, [path('scripts/demo.mjs'), '--build-only'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);
const demo = spawn(process.execPath, [path('packages/server/dist/demo/demo.mjs'), '--port', String(port)], { stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let tries = 0; ; tries += 1) {
  try {
    if ((await fetch(`${base}/demo`)).ok) break;
  } catch {
    if (tries > 50) throw new Error('the demo did not start');
    await new Promise((done) => setTimeout(done, 100));
  }
}

// name, made-up life, address, and what to do before the picture.
// Setup day's answers for the pictures of the last look and after it, sent
// the way the screens send them (POST /api/choice, with decision numbers),
// then the screen is opened again to show them.
const SETUP_ANSWERS = [
  { onItsWay: { half: 'su-old-left', answer: true } },
  { onItsWay: { half: 'su-card-left', answer: true } },
  { onItsWay: { half: 'su-sav-landed', answer: true } },
  { lastPaycheck: '2026-10-02' },
  { assign: { pot: 'savings', amount: 800_000 } },
  { assign: { pot: 'momReserve', amount: 120_000 } },
  { assign: { pot: 'wants', amount: 40_000 } },
  { assign: { pot: 'needs', rest: true } },
];

async function setupAnswers(page, answers) {
  await page.evaluate(async (all) => {
    let n = 0;
    for (const setup of all) {
      n += 1;
      await fetch('/api/choice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `screenshot-setup-${n}`, setup }) });
    }
  }, answers);
  await page.reload();
  await page.locator('main[aria-busy="false"]').waitFor();
}

const SHOTS = [
  ['home', 'normal', '/home'],
  ['home-whole', 'normal', '/home', 'full'],
  ['savings-sheet', 'normal', '/home', (page) => page.getByTestId('attention-move-to-savings').click()],
  ['mismatch', 'mismatch', '/home'],
  ['mismatch-sheet', 'mismatch', '/home', (page) => page.getByTestId('see-check').click()],
  ['low', 'low', '/home', 'bottom'],
  ['overspent', 'overspent', '/home'],
  ['all-clear', 'all-clear', '/home'],
  ['trouble', 'trouble', '/home'],
  ['took-back', 'took-back', '/home'],
  ['took-back-sheet', 'took-back', '/home', (page) => page.locator('[data-testid^="attention-bank-took-back-"]').click()],
  ['bank-not-read', 'bank-not-read', '/home'],
  ['late', 'late', '/home'],
  ['not-set-up', 'not-set-up', '/home'],
  ['error', 'error', '/home'],
  ['loading', 'slow', '/home', 'loading'],
  // Buckets
  ['buckets', 'normal', '/buckets'],
  ['buckets-whole', 'normal', '/buckets', 'full'],
  ['buckets-busy', 'buckets-busy', '/buckets', 'full'],
  ['buckets-mismatch', 'mismatch', '/buckets'],
  ['buckets-low', 'low', '/buckets'],
  ['buckets-overspent', 'overspent', '/buckets'],
  ['buckets-not-read', 'bank-not-read', '/buckets'],
  ['buckets-empty', 'not-set-up', '/buckets'],
  ['buckets-error', 'error', '/buckets', 'error'],
  ['buckets-loading', 'slow', '/buckets', 'loading-buckets'],
  // Review
  ['review', 'normal', '/review'],
  ['review-busy', 'review-busy', '/review'],
  ['review-busy-whole', 'review-busy', '/review', 'full'],
  ['review-refund', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-refund').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    return 'no-sheet';
  }],
  ['review-refund-confirm', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-refund').locator('[data-testid^="match-"]').first().click();
  }],
  ['review-transfer-old-card', 'review-busy', '/review', async (page) => {
    await page.locator('article', { hasText: 'ZELLE TO MADE UP FRIEND' }).getByTestId('more').click();
    await page.getByTestId('sheet-transfer').scrollIntoViewIfNeeded();
  }],
  ['review-transfer-from-savings', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-water').getByTestId('more').click();
    await page.getByTestId('sheet-transfer').scrollIntoViewIfNeeded();
  }],
  ['review-pending-and-flag', 'review-busy', '/review', 'bottom'],
  ['review-empty', 'all-clear', '/review'],
  ['review-not-set-up', 'not-set-up', '/review'],
  ['review-error', 'error', '/review', 'error'],
  ['review-loading', 'slow', '/review', 'loading-review'],
  ['review-one-tap', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('pick-wants').click();
    await page.getByTestId('notice').waitFor();
    return 'no-sheet';
  }],
  ['review-sheet', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
  }],
  ['review-sheet-split', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
    await page.getByTestId('split-needs').fill('4.00');
    await page.getByTestId('review-sheet').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  }],
  ['review-sheet-always', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').fill('CORNER STORE');
  }],
  ['review-rule-confirm', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').fill('CORNER STORE');
    await page.getByTestId('choice-wants').click();
  }],
  ['review-refused', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
    await page.getByTestId('split-needs').fill('11.50');
    await page.getByTestId('split-submit').click();
    await page.getByTestId('notice').waitFor();
  }],
  ['review-paycheck-confirm', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-early').getByTestId('pick-paycheck').click();
  }],
  ['review-leftover-confirm', 'review-busy', '/review', async (page) => {
    await page.getByTestId('answer-move-to-savings').first().click();
  }],
  ['review-deposit-sheet', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-tax').getByTestId('more').click();
  }],
  ['review-person-split', 'review-busy', '/review', async (page) => {
    await page.locator('article', { hasText: 'ZELLE TO MADE UP FRIEND' }).getByTestId('more').click();
    await page.getByTestId('split-needs').fill('10.00');
    await page.getByTestId('split-wants').fill('5.00');
    await page.getByTestId('review-sheet').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  }],
  // Buckets: each bucket is a link, with Move money and Payday
  ['buckets-links', 'activity-busy', '/buckets', 'full'],
  ['home-payday-row', 'payday-paid', '/home', 'full'],
  // What went in and out of a bucket
  ['activity-needs', 'activity-busy', '/buckets/needs'],
  ['activity-needs-whole', 'activity-busy', '/buckets/needs', 'full'],
  ['activity-wants-pending', 'activity-busy', '/buckets/wants', 'full'],
  ['activity-mom-reserve', 'activity-busy', '/buckets/mom-reserve', 'full'],
  ['activity-empty', 'normal', '/buckets/held-for-others'],
  ['activity-big', 'big', '/buckets/needs'],
  ['activity-not-set-up', 'not-set-up', '/buckets/needs'],
  ['activity-error', 'error', '/buckets/needs', 'error'],
  ['activity-loading', 'slow', '/buckets/needs', 'loading-activity'],
  ['activity-row-sheet', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'GROCERY OUTLET #12' }).filter({ hasText: 'Thu, Oct 1' }).click();
  }],
  ['activity-row-split-part', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'HARDWARE SUPERSTORE' }).click();
  }],
  ['activity-needs-marked', 'activity-marked', '/buckets/needs', 'full'],
  ['activity-row-marked', 'activity-marked', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'MADE UP LANDLORD' }).click();
  }],
  ['activity-row-cannot', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'MADE UP EMPLOYER PAYROLL' }).click();
  }],
  ['activity-always-confirm', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'GROCERY OUTLET #12' }).filter({ hasText: 'Thu, Oct 1' }).click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').fill('GROCERY OUTLET');
    await page.getByTestId('choice-wants').click();
  }],
  ['activity-resorted', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'GROCERY OUTLET #12' }).filter({ hasText: 'Thu, Oct 1' }).click();
    await page.getByTestId('activity-sheet').getByTestId('choice-wants').click();
    await page.getByTestId('notice').waitFor();
    return 'no-sheet';
  }],
  // Moving money by hand
  ['move-form', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('25.00');
  }],
  ['move-reading', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('abc');
  }],
  ['move-confirm-savings', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-from').selectOption('savings');
    await page.getByTestId('move-amount').fill('100.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-confirm-title').waitFor();
  }],
  ['move-confirm-below-zero', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('700.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-confirm-title').waitFor();
  }],
  ['move-refused', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-to').selectOption('wants');
    await page.getByTestId('move-amount').fill('10.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-problem').waitFor();
  }],
  ['move-done', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('25.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    return 'no-sheet';
  }],
  // Payday
  ['payday', 'payday-paid', '/payday'],
  ['payday-whole', 'payday-paid', '/payday', 'full'],
  ['payday-leftover-why', 'payday-paid', '/payday', async (page) => {
    await page.getByTestId('leftover-why').scrollIntoViewIfNeeded();
    return 'no-sheet';
  }],
  ['payday-leftover-confirm', 'payday-paid', '/payday', async (page) => {
    await page.getByTestId('answer-move-to-savings').first().click();
  }],
  ['payday-answered', 'payday-paid', '/payday', async (page) => {
    await page.getByTestId('answer-roll-over').first().click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    await page.getByTestId('answer-move-to-savings').first().click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('leftover-wants').waitFor();
    return 'no-sheet';
  }],
  ['payday-bank-not-read', 'bank-not-read', '/payday', 'full'],
  ['payday-late', 'late', '/payday'],
  ['payday-not-set-up', 'not-set-up', '/payday'],
  ['payday-error', 'error', '/payday', 'error'],
  ['payday-loading', 'slow', '/payday', 'loading-payday'],
  // A21: a bill from savings marked as a payment to the old card, and its own choice
  ['review-unmark', 'review-marked-savings', '/review', async (page) => {
    await page.getByTestId('item-act-water').getByTestId('more').click();
    await page.getByTestId('choice-unmark').scrollIntoViewIfNeeded();
  }],
  ['review-unmarked', 'review-marked-savings', '/review', async (page) => {
    await page.getByTestId('item-act-water').getByTestId('more').click();
    await page.getByTestId('choice-unmark').click();
    await page.getByTestId('notice').waitFor();
    return 'no-sheet';
  }],
  // Settings
  ['settings-rule-move', 'normal', '/settings', async (page) => {
    await page.getByTestId('rule-restaurant').click();
    await page.getByTestId('sheet-move-up').waitFor();
  }],
  ['settings-rule-moved', 'normal', '/settings', async (page) => {
    await page.getByTestId('rule-restaurant').click();
    await page.getByTestId('sheet-move-up').click();
    await page.getByTestId('notice').waitFor();
    await page.getByTestId('rules-card').scrollIntoViewIfNeeded();
    return 'no-sheet';
  }],
  ['settings-bank-rules', 'normal', '/settings', async (page) => {
    await page.getByTestId('bank-rules-card').scrollIntoViewIfNeeded();
    return 'no-sheet';
  }],
  ['settings-bank-rule-preview', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-add-bank-rule').click();
    await page.getByTestId('field-bank-text').fill('ZELLE TO MADE UP');
    await page.getByTestId('field-bank-means').selectOption('payment-to-person');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-ask').waitFor();
  }],
  ['settings-bank-rule-logged', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-add-bank-rule').click();
    await page.getByTestId('field-bank-account').selectOption('everyday-card');
    await page.getByTestId('field-bank-text').fill('FOREIGN TRANSACTION FEE');
    await page.getByTestId('field-bank-means').selectOption('card-fee');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-yes').click();
    await page.waitForFunction(() => document.querySelector('dialog[open]') === null);
    await page.getByTestId('log').scrollIntoViewIfNeeded();
    return 'no-sheet';
  }],
  // Trends (section 40): Past, Now, Future and Habits, a habit's sheet, and the largest text size.
  ['trends-past', 'trends-future', '/trends', 'full'],
  ['trends-now', 'trends-future', '/trends', async (page) => (await page.getByTestId('trends-segment-now').click(), 'full')],
  ['trends-future', 'trends-future', '/trends', async (page) => (await page.getByTestId('trends-segment-future').click(), 'full')],
  ['trends-future-not-enough', 'trends', '/trends', async (page) => (await page.getByTestId('trends-segment-future').click(), 'full')],
  ['trends-habits', 'trends-future', '/trends', async (page) => (await page.getByTestId('trends-segment-habits').click(), 'full')],
  ['trends-habit-sheet', 'trends-future', '/trends', async (page) => {
    await page.getByTestId('trends-segment-habits').click();
    await page.getByTestId('repeat-0').click();
  }],
  ['trends-future-largest-text', 'trends-future', '/trends', async (page) => {
    await page.getByTestId('trends-segment-future').click();
    await page.addStyleTag({ content: 'html { font-size: 36px !important; }' });
    return 'full';
  }],
  ['settings', 'settings-busy', '/settings'],
  ['settings-whole', 'settings-busy', '/settings', 'full'],
  ['settings-normal-whole', 'normal', '/settings', 'full'],
  ['settings-first-sync-whole', 'settings-first-sync', '/settings', 'full'],
  ['settings-log', 'settings-busy', '/settings', 'bottom'],
  ['settings-mismatch', 'mismatch', '/settings'],
  ['settings-big', 'big', '/settings', 'full'],
  ['settings-not-set-up', 'not-set-up', '/settings'],
  ['settings-error', 'error', '/settings', 'error'],
  ['settings-loading', 'slow', '/settings', 'loading-settings'],
  ['settings-split-sheet', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-split').click();
  }],
  ['settings-split-refused', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-split').click();
    await page.getByTestId('field-needs').fill('40');
    await page.getByTestId('field-wants').fill('30');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('sheet-problem').waitFor();
  }],
  ['settings-split-done', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-split').click();
    await page.getByTestId('field-savings').fill('40');
    await page.getByTestId('field-needs').fill('40');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('notice').waitFor();
    await page.getByTestId('split-savings').getByText('Changes').waitFor();
    return 'no-sheet';
  }],
  ['settings-reserve-sheet', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-reserve').click();
  }],
  ['settings-paycheck-rule-preview', 'settings-first-sync', '/settings', async (page) => {
    await page.getByTestId('row-paycheck-rule').click();
    await page.getByTestId('field-paycheck-rule').fill('MADE UP EMPLOYER PAYROLL');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('preview').waitFor();
  }],
  ['settings-paycheck-rule-preview-bottom', 'settings-first-sync', '/settings', async (page) => {
    await page.getByTestId('row-paycheck-rule').click();
    await page.getByTestId('field-paycheck-rule').fill('MADE UP EMPLOYER PAYROLL');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('preview').waitFor();
    await page.getByTestId('settings-sheet').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  }],
  ['settings-mom-rule-preview', 'settings-first-sync', '/settings', async (page) => {
    await page.getByTestId('row-mom-rule').click();
    await page.getByTestId('field-mom-rule').fill('MADE UP MOM');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('preview').waitFor();
  }],
  ['settings-rule-add', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-add-rule').click();
    await page.getByTestId('field-rule-text').fill('CORNER STORE');
  }],
  ['settings-rule-added', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-add-rule').click();
    await page.getByTestId('field-rule-text').fill('CORNER STORE');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('notice').waitFor();
    return 'no-sheet';
  }],
  ['settings-rule-remove-confirm', 'normal', '/settings', async (page) => {
    await page.getByTestId('rule-streaming').click();
    await page.getByTestId('sheet-remove').click();
    await page.getByTestId('confirm-yes').waitFor();
  }],
  ['settings-promo-sheet', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-promo').click();
  }],
  ['settings-leftover-sheet', 'normal', '/settings', async (page) => {
    await page.getByTestId('row-leftover').click();
  }],
  // Setup day (section 14), on the made-up lives not set up yet.
  ['setup-home', 'setup-day', '/home'],
  ['setup-bank', 'setup-day', '/setup/bank'],
  ['setup-bank-whole', 'setup-day', '/setup/bank', 'full'],
  ['setup-transfers-whole', 'setup-day', '/setup/transfers', 'full'],
  ['setup-transfers-answered', 'setup-day', '/setup/transfers', async (page) => {
    for (const half of ['su-old-left', 'su-card-left', 'su-sav-landed']) {
      await page.getByTestId(`half-${half}`).getByTestId('on-its-way').click();
      await page.getByTestId(`half-${half}`).getByTestId('answer').filter({ hasText: 'on its way' }).waitFor();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    return 'no-sheet';
  }],
  ['setup-transfers-look-back', 'setup-day', '/setup/transfers', async (page) => {
    await page.getByTestId('look-back-row').click();
    await page.getByTestId('look-back-days').waitFor();
  }],
  ['setup-rules', 'setup-suggest', '/setup/rules'],
  ['setup-rules-whole', 'setup-suggest', '/setup/rules', 'full'],
  ['setup-rules-change', 'setup-suggest', '/setup/rules', async (page) => {
    await page.locator('[data-testid^="suggestion-s-"]').filter({ hasText: 'CRD 4444' }).getByTestId('suggestion-change').click();
    await page.getByTestId('field-bank-other').selectOption('old-card');
  }],
  ['setup-rules-preview', 'setup-suggest', '/setup/rules', async (page) => {
    await page.locator('[data-testid^="suggestion-s-"]').filter({ hasText: 'CRD 4444' }).getByTestId('suggestion-change').click();
    await page.getByTestId('field-bank-other').selectOption('old-card');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-ask').waitFor();
  }],
  ['setup-rules-answered', 'setup-suggest', '/setup/rules', async (page) => {
    const cards = page.locator('[data-testid^="suggestion-s-"]');
    for (const [i, button, word] of [[0, 'suggestion-add', 'added'], [1, 'suggestion-add', 'added'], [6, 'suggestion-skip', 'skipped']]) {
      await cards.nth(i).getByTestId(button).click();
      await cards.nth(i).getByTestId('suggestion-status').filter({ hasText: word }).waitFor();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    return 'no-sheet';
  }],
  ['setup-transfers-rules-first', 'setup-suggest', '/setup/transfers'],
  ['setup-paycheck-sheet', 'setup-day', '/setup/paycheck', async (page) => {
    await page.getByTestId('last-paycheck').click();
    await page.getByTestId('date').fill('2026-10-02');
  }],
  ['setup-paycheck-refused', 'setup-day', '/setup/paycheck', async (page) => {
    await page.getByTestId('last-paycheck').click();
    await page.getByTestId('date').fill('2026-10-08');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('sheet-problem').waitFor();
  }],
  ['setup-paycheck', 'setup-day', '/setup/paycheck', async (page) => {
    await setupAnswers(page, [{ lastPaycheck: '2026-10-02' }]);
    return 'no-sheet';
  }],
  ['setup-assign', 'setup-day', '/setup/assign'],
  ['setup-assign-sheet', 'setup-day', '/setup/assign', async (page) => {
    await page.getByTestId('assign-needs').click();
    await page.getByTestId('amount').fill('954.10');
  }],
  ['setup-assign-over', 'setup-day', '/setup/assign', async (page) => {
    await setupAnswers(page, [{ assign: { pot: 'savings', amount: 800_000 } }, { assign: { pot: 'needs', amount: 240_411 } }]);
    return 'no-sheet';
  }],
  ['setup-check-missing', 'setup-day', '/setup/check', 'full'],
  ['setup-check-ready', 'setup-day', '/setup/check', async (page) => {
    await setupAnswers(page, SETUP_ANSWERS);
    await page.addStyleTag({ content: '.tabbar { position: static !important; } .screen { padding-bottom: var(--space-5) !important; }' });
    return 'no-sheet';
  }],
  ['setup-start-confirm', 'setup-day', '/setup/check', async (page) => {
    await setupAnswers(page, SETUP_ANSWERS);
    await page.getByTestId('start').click();
  }],
  ['setup-home-after', 'setup-day', '/setup/check', async (page) => {
    await setupAnswers(page, SETUP_ANSWERS);
    await page.getByTestId('start').click();
    await page.getByTestId('confirm-yes').click();
    await page.waitForURL(/\/home$/);
    await page.locator('main[data-testid="home"][aria-busy="false"]').waitFor();
    return 'no-sheet';
  }],
  ['setup-owes-more-bank', 'setup-owes-more', '/setup/bank'],
  ['setup-owes-more-assign', 'setup-owes-more', '/setup/assign', async (page) => {
    await setupAnswers(page, [{ assign: { pot: 'savings', amount: 15_000 } }, { assign: { pot: 'needs', amount: -150_000 } }, { assign: { pot: 'wants', rest: true } }]);
    return 'no-sheet';
  }],
  ['setup-owes-more-transfers', 'setup-owes-more', '/setup/transfers'],
  ['setup-not-ready', 'not-set-up', '/setup/bank'],
  ['setup-error', 'error', '/setup/bank', 'error'],
  ['setup-loading', 'slow', '/setup/bank', 'loading-setup'],
];

// Her setup's made-up lives (packages/server/src/demo/her-lives.ts): every screen of each.
const HER_LIVES = ['her-everyday', 'her-payday', 'her-review-busy', 'her-card-due', 'her-one-bank-down'];
for (const life of HER_LIVES) {
  SHOTS.push(
    [`${life}-home`, life, '/home', 'full'],
    [`${life}-buckets`, life, '/buckets', 'full'],
    [`${life}-wishlist`, life, '/buckets/wishlist', 'full'],
    [`${life}-review`, life, '/review', 'full'],
    [`${life}-trends`, life, '/trends', 'full'],
    [`${life}-settings`, life, '/settings', 'full'],
    [`${life}-payday-screen`, life, '/payday', 'full'],
    [`${life}-statement-capital-one`, life, '/statement/everyday-card', 'full'],
    [`${life}-statement-amex`, life, '/statement/second-card', 'full'],
  );
}
SHOTS.push(
  ['her-everyday-cards-why', 'her-everyday', '/home', async (page) => {
    await page.getByTestId('cards-why').click();
  }],
  ['her-everyday-statement-by-paycheck', 'her-everyday', '/statement/second-card', async (page) => (await page.getByTestId('statement-by-paycheck').click(), 'full')],
  ['her-everyday-trends-now', 'her-everyday', '/trends', async (page) => (await page.getByTestId('trends-segment-now').click(), 'full')],
  ['her-everyday-trends-future', 'her-everyday', '/trends', async (page) => (await page.getByTestId('trends-segment-future').click(), 'full')],
  ['her-everyday-trends-habits', 'her-everyday', '/trends', async (page) => (await page.getByTestId('trends-segment-habits').click(), 'full')],
  ['her-review-busy-which-item', 'her-review-busy', '/review', async (page) => {
    await page.locator('article', { hasText: 'MADE UP LAMPS' }).getByTestId('more').click();
    await page.getByTestId('review-sheet').getByTestId('choice-wishlist').click();
    await page.getByTestId('which-item-title').waitFor();
  }],
  ['her-review-busy-split-three', 'her-review-busy', '/review', async (page) => {
    await page.locator('article', { hasText: 'BIG BOX STORE' }).getByTestId('more').click();
    await page.getByTestId('split-needs').fill('20.00');
    await page.getByTestId('split-wants').fill('15.00');
    await page.getByTestId('review-sheet').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  }],
);

mkdirSync(out, { recursive: true });
const browser = await webkit.launch();
try {
  // Dark only (the app has no light mode since the redesign).
  for (const scheme of ['dark']) {
    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
      // The made-up lives' times are Central; so is the phone in the pictures.
      timezoneId: 'America/Chicago',
      // Only to draw the iPhone's notch and home bar areas (safe areas).
      bypassCSP: true,
    });
    for (const [name, life, address, step] of SHOTS.filter(([name]) => only === undefined || name.startsWith(only))) {
      const page = await context.newPage();
      await page.goto(`${base}/demo/${life}`);
      if (address !== '/home') await page.goto(`${base}${address}`);
      await page.addStyleTag({ content: ':root { --safe-top: 59px !important; --safe-bottom: 34px !important; }' });
      if (step === 'loading') await page.getByTestId('home-loading').waitFor();
      else if (step === 'loading-buckets') await page.getByTestId('buckets-loading').waitFor();
      else if (step === 'loading-review') await page.getByTestId('review-loading').waitFor();
      else if (step === 'loading-activity') await page.getByTestId('activity-loading').waitFor();
      else if (step === 'loading-payday') await page.getByTestId('payday-loading').waitFor();
      else if (step === 'loading-settings') await page.getByTestId('settings-loading').waitFor();
      else if (step === 'loading-setup') await page.getByTestId('setup-loading').waitFor();
      else if (step === 'error') await page.locator('[data-testid$="-error"]').waitFor();
      else await page.locator('main[aria-busy="false"]').waitFor();
      // A step can also say 'full': no sheet, and the whole page in the picture.
      let full = step === 'full';
      if (typeof step === 'function') {
        const result = await step(page);
        if (result === 'full') full = true;
        else if (result !== 'no-sheet') await page.locator('dialog[open]').waitFor();
        await page.waitForTimeout(400);
      }
      if (full) await page.addStyleTag({ content: '.tabbar { position: static !important; } .screen { padding-bottom: var(--space-5) !important; }' });
      if (step === 'bottom') await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: full, animations: 'disabled' });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
  demo.kill();
}
console.log(`Saved ${SHOTS.filter(([name]) => only === undefined || name.startsWith(only)).length * 2} pictures to ${out}`);

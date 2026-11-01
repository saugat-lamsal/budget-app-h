import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { BUCKETS_EXAMPLES, EXAMPLE_LIVES, HOME_EXAMPLES, checksOf } from '../worked-examples.js';
import { ENGINES, centsAt, openScenario, phone, readCents, showScenario, textAt, useEngine } from './harness.js';

// Every example in packages/web/worked-examples.txt, against what the screen
// shows a person for the same made-up life.

// Opens "See the numbers", reads one, and closes it again.
async function inCheckSheet(page: Page, testId: string): Promise<number> {
  await page.getByTestId('see-check').click();
  await page.getByTestId('check-sheet').waitFor();
  const cents = await centsAt(page, testId);
  await page.keyboard.press('Escape');
  await page.getByTestId('check-sheet').waitFor({ state: 'hidden' });
  return cents;
}

describe.each(ENGINES)('worked examples on the screen in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it.each(HOME_EXAMPLES)('example %i: Home shows every number worked out by hand', async (n) => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[n] ?? '');
    for (const [label, expected] of checksOf(n)) {
      switch (label) {
        case 'safe to spend':
          expect(await centsAt(page, 'safe-to-spend'), label).toBe(expected);
          break;
        case 'needs':
        case 'wants':
          expect(await centsAt(page, `bucket-${label}-left`), label).toBe(expected);
          break;
        case 'held back':
          expect(await centsAt(page, 'held-back'), label).toBe(expected);
          break;
        case 'still to move':
          expect(await centsAt(page, 'move-amount'), label).toBe(expected);
          break;
        case 'waiting':
          expect(await page.getByTestId('review-badge').innerText(), label).toBe(String(expected));
          break;
        case 'days to payday':
          expect(await textAt(page, 'payday'), label).toMatch(new RegExp(`^${expected} days to payday`));
          break;
        case 'difference':
          if (expected === 0) expect(await page.getByTestId('mismatch').count(), label).toBe(0);
          else {
            expect(await centsAt(page, 'mismatch-amount'), label).toBe(Math.abs(expected));
            expect(await inCheckSheet(page, 'check-difference'), label).toBe(expected);
          }
          break;
        case 'bank side':
          expect(await inCheckSheet(page, 'check-bank'), label).toBe(expected);
          break;
        case 'app side':
          expect(await inCheckSheet(page, 'check-app'), label).toBe(expected);
          break;
        case 'needs started with':
          expect(await centsAt(page, 'bucket-needs-of'), label).toBe(expected);
          break;
        case 'wants started with':
          expect(await centsAt(page, 'bucket-wants-of'), label).toBe(expected);
          break;
        case 'taken back':
          expect(await readCents(await page.locator('[data-testid^="attention-bank-took-back-"] [data-money]').innerText()), label).toBe(expected);
          break;
        case 'last checked':
          expect(await centsAt(page, 'safe-to-spend-stale'), label).toBe(expected);
          break;
        default:
          throw new Error(`example ${n}: no way to read "${label}" off the screen`);
      }
    }
    await page.context().close();
  });

  it.each(BUCKETS_EXAMPLES)('example %i: Buckets shows every number worked out by hand', async (n) => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[n] ?? '', '/buckets');
    const testIds: Record<string, string> = {
      total: 'buckets-total',
      savings: 'savings',
      needs: 'bucket-needs-left',
      wants: 'bucket-wants-left',
      'mom reserve': 'mom-reserve',
      'mom sent': 'mom-sent',
      'held for others': 'held-for-others',
      'old card': 'old-card-debt',
      'waiting out': 'waiting-out',
    };
    for (const [label, expected] of checksOf(n)) {
      const testId = testIds[label];
      if (testId === undefined) throw new Error(`example ${n}: no way to read "${label}" off Buckets`);
      expect(await centsAt(page, testId), label).toBe(expected);
    }
    await page.context().close();
  });

  it('example 7 says Under target, and example 8 says In the target and money in Other', async () => {
    const context = await browser().newContext(phone());
    const page = await openScenario(context, base(), EXAMPLE_LIVES[7] ?? '', '/buckets');
    expect(await page.getByTestId('mom').locator('[data-status]').innerText()).toBe('Under target');
    expect(await textAt(page, 'row-held')).toContain('Nothing here now.');
    // The same page, moved to example 8's life (showLive in live.ts says why).
    await showScenario(page, base(), EXAMPLE_LIVES[8] ?? '', '/buckets');
    expect(await page.getByTestId('mom').locator('[data-status]').innerText()).toBe('In the target');
    expect(await textAt(page, 'row-held')).toContain('Not in Needs or Wants.');
    expect(await textAt(page, 'row-held')).not.toContain('Nothing here now.');
    await context.close();
  });

  it('example 9: the early deposit asks first, and the screen shows the split worked out by hand', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[9] ?? '', '/review');
    for (const [label, expected] of checksOf(9)) {
      if (label === 'waiting') expect(await page.getByTestId('review-count').innerText(), label).toBe(String(expected));
    }
    await page.getByTestId('item-busy-early').getByTestId('pick-paycheck').click();
    await page.getByTestId('confirm-yes').waitFor();
    for (const [label, expected] of checksOf(9)) {
      if (label.startsWith('preview ')) {
        const testId = { 'preview mom': 'preview-mom', 'preview savings': 'preview-savings', 'preview needs': 'preview-needs', 'preview wants': 'preview-wants' }[label];
        if (testId === undefined) throw new Error(`example 9: no way to read "${label}"`);
        expect(await centsAt(page, testId), label).toBe(expected);
      }
    }
    // Nothing was sent: it only asked.
    await page.getByTestId('confirm-cancel').click();
    await page.keyboard.press('Escape');
    expect(await page.getByTestId('item-busy-early').count()).toBe(1);
    await page.context().close();
  });

  it('example 10: the split, with the rest worked out for him, and the buckets as worked out by hand', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[10] ?? '', '/review');
    const store = page.locator('article', { hasText: 'CORNER STORE' });
    await store.getByTestId('more').click();
    await page.getByTestId('split-needs').fill('4.00');
    await page.getByTestId('split-submit').click();
    await store.waitFor({ state: 'detached' });
    // The answer: Needs $4.00, Wants $7.50.
    const said = await textAt(page, 'notice');
    const amounts = [...said.matchAll(/\$[\d,]+\.\d{2}/g)].map((m) => readCents(m[0]));
    await page.getByTestId('tab-buckets').click();
    await page.getByTestId('buckets-total').waitFor();
    const after: Record<string, number> = {
      'split needs': amounts[0] ?? NaN,
      'split wants': amounts[1] ?? NaN,
      'needs after': await centsAt(page, 'bucket-needs-left'),
      'wants after': await centsAt(page, 'bucket-wants-left'),
      'waiting out after': await centsAt(page, 'waiting-out'),
      'total after': await centsAt(page, 'buckets-total'),
    };
    for (const [label, expected] of checksOf(10)) {
      expect(label in after, `example 10: no way to read "${label}"`).toBe(true);
      expect(after[label], label).toBe(expected);
    }
    await page.context().close();
  });

  it('example 11: the refund lists the two purchases it likely belongs to', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[11] ?? '', '/review');
    const list = page.getByTestId('item-busy-refund').locator('li[data-testid^="likely-"]');
    const amounts = await list.evaluateAll((els) => els.map((e) => e.querySelector('[data-money]')?.textContent ?? ''));
    const got: Record<string, number> = { 'likely count': amounts.length, 'likely first': readCents(amounts[0] ?? ''), 'likely second': readCents(amounts[1] ?? '') };
    for (const [label, expected] of checksOf(11)) {
      expect(label in got, `example 11: no way to read "${label}"`).toBe(true);
      expect(got[label], label).toBe(expected);
    }
    await page.context().close();
  });
});

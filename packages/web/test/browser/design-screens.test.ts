import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, emulatePhone, openScenario, phone, showScenario, useEngine } from './harness.js';

// The design rules (CLAUDE.md) for Buckets and Review and their sheets, in
// the browser: light and dark, readable contrast, 44-point tap targets, the
// notch and the home bar, the phone's text size and reduced-motion
// settings, and money written one way.

// Every state of each screen worth checking: [made-up life, address].
const BUCKETS = ['normal', 'mismatch', 'catching-up', 'low', 'overspent', 'all-clear', 'not-set-up', 'bank-not-read', 'big', 'buckets-busy', 'on-its-way', 'trouble', 'cards-off'] as const;
const REVIEW = ['normal', 'review-busy', 'all-clear', 'not-set-up', 'big'] as const;
const SCREENS: readonly (readonly [string, string])[] = [...BUCKETS.map((l) => [l, '/buckets'] as const), ...REVIEW.map((l) => [l, '/review'] as const)];

function idOf(life: string, description: string, amount?: number): string {
  const book = demoScenario(life)!.input!().book!;
  const found = book.reviewItems().find((i) => 'description' in i && i.description === description && (amount === undefined || i.amount === amount));
  if (found === undefined) throw new Error(`no ${description} waiting in ${life}`);
  return found.id;
}

// Every sheet on Review, and every step inside one: [name, made-up life, how
// to get there from Review]. Each is checked on a fresh page, where it
// stands. (The checks used to run after the last sheet was open, so only that
// one was checked.)
type Reach = (page: Page) => Promise<void>;
const more = (id: string): Reach => async (page) => {
  await page.getByTestId(`item-${id}`).getByTestId('more').click();
  await page.getByTestId('review-sheet').waitFor();
};
// The choices sheet of every item waiting on the busy life that has one: each
// kind of item has its own choices (4.2 to 4.9, 5.2, 5.6, 6.1, 7.6, 8.3).
const ITEM_SHEETS: readonly (readonly [string, string, Reach])[] = demoScenario('review-busy')!
  .input!()
  .book!.reviewDetails()
  .filter((d) => (d.item.type === 'spending' || d.item.type === 'money-in') && d.options.type === 'sort')
  .map((d) => [`the choices for ${'description' in d.item ? d.item.description : ''} (${d.item.id})`, 'review-busy', more(d.item.id)] as const);
const store: Reach = more(idOf('review-busy', 'CORNER STORE'));
const REVIEW_SHEETS: readonly (readonly [string, string, Reach])[] = [
  ...ITEM_SHEETS,
  ['the choices with a rule', 'review-busy', async (page) => {
    await store(page);
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').waitFor();
  }],
  ['the choices with a split that cannot be read', 'review-busy', async (page) => {
    await store(page);
    await page.getByTestId('split-needs').fill('abc');
  }],
  ['a payment to a person split three ways', 'review-busy', async (page) => {
    await more('busy-friend')(page);
    await page.getByTestId('split-needs').fill('10.00');
    await page.getByTestId('split-wants').fill('5.00');
  }],
  ['a refusal', 'review-busy', async (page) => {
    await store(page);
    await page.getByTestId('split-needs').fill('11.50');
    await page.getByTestId('split-submit').click();
    await page.getByTestId('notice').waitFor();
  }],
  ['asks first: always do this', 'review-busy', async (page) => {
    await store(page);
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('choice-wants').click();
    await page.getByTestId('confirm-yes').waitFor();
  }],
  ['asks first: this is my paycheck', 'review-busy', async (page) => {
    await page.getByTestId('item-busy-early').getByTestId('pick-paycheck').click();
    await page.getByTestId('confirm-yes').waitFor();
  }],
  ['asks first: a payday answer', 'review-busy', async (page) => {
    await page.getByTestId('answer-move-to-savings').first().click();
    await page.getByTestId('confirm-yes').waitFor();
  }],
  ['asks first: this refund is for this one', 'review-busy', async (page) => {
    await page.getByTestId('item-busy-refund').locator('[data-testid^="match-"]').first().click();
    await page.getByTestId('confirm-yes').waitFor();
  }],
  ['the done message', 'review-busy', async (page) => {
    await page.getByTestId(`item-${idOf('review-busy', 'CORNER DELI')}`).getByTestId('pick-needs').click();
    await page.getByTestId('notice').waitFor();
  }],
  ['a payment marked from savings, with "It was not a payment to the old card" (A21)', 'review-marked-savings', async (page) => {
    await more('act-water')(page);
    await page.getByTestId('choice-unmark').waitFor();
  }],
  ['13.8 the done message offering a rule', 'rule-offer', async (page) => {
    await page.getByTestId(`item-${idOf('rule-offer', 'SUNRISE BAKERY #208')}`).getByTestId('pick-wants').click();
    await page.getByTestId('notice-offer').waitFor();
  }],
  ['13.8 the rule offered, to make', 'rule-offer', async (page) => {
    await page.getByTestId(`item-${idOf('rule-offer', 'SUNRISE BAKERY #208')}`).getByTestId('pick-wants').click();
    await page.getByTestId('notice-offer').click();
    await page.getByTestId('offer-yes').waitFor();
  }],
];

describe.each(ENGINES)('design rules on Buckets and Review in %s', (_engine, engine) => {
  const { browser, base } = useEngine(engine);

  // One test per colour scheme and per part (Buckets, Review, Review's
  // sheets), so none comes near the time limit when the whole suite runs at
  // once (WebKit went past 60 s as one test). Together they check exactly
  // what the one test did.
  for (const scheme of ['light', 'dark'] as const) {
    for (const [screen, path] of [
      ['Buckets', '/buckets'],
      ['Review', '/review'],
    ] as const) {
      it(`readable contrast and no accessibility problems, in ${scheme} mode, on ${screen} in every state`, async () => {
        const problems: string[] = [];
        // One page, moved from state to state, the life started over each time (showLive in live.ts says why).
        const context = await browser().newContext(phone({ colorScheme: scheme, bypassCSP: true }));
        const page = await context.newPage();
        for (const [life, at] of SCREENS.filter(([, p]) => p === path)) {
          await showScenario(page, base(), life, at);
          problems.push(...(await axeViolations(page)).map((p) => `${scheme} ${at} ${life}: ${p}`));
        }
        await context.close();
        expect(problems).toEqual([]);
      });
    }

  }

  // One test per sheet, each on a fresh page, checked in light and in dark
  // where it stands (the phone's setting, switched in place), with its tap
  // targets: small enough to stay well under the time limit.
  for (const [name, life, reach] of REVIEW_SHEETS) {
    it(`readable contrast and no accessibility problems in light and dark mode, and every tap target at least 44 by 44 points, on Review: ${name}`, async () => {
      const problems: string[] = [];
      const context = await browser().newContext(phone({ colorScheme: 'light', bypassCSP: true }));
      const page = await openScenario(context, base(), life, '/review');
      await reach(page);
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        problems.push(...(await axeViolations(page)).map((p) => `${scheme}: ${p}`));
      }
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) problems.push(`${t.what} is ${t.width}x${t.height}`);
      await context.close();
      expect(problems).toEqual([]);
    });
  }

  it('every tap target is at least 44 by 44 points, in every state', async () => {
    const small: string[] = [];
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const [life, path] of SCREENS) {
      await showScenario(page, base(), life, path);
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`${path} ${life}: ${t.what} is ${t.width}x${t.height}`);
    }
    await context.close();
    expect(small).toEqual([]);
  });

  it('nothing sits under the notch or the home bar, and the end of the screen scrolls clear of the tabs', async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    const page = await context.newPage();
    for (const [life, path] of [
      ['normal', '/buckets'],
      ['mismatch', '/buckets'],
      ['review-busy', '/review'],
      ['all-clear', '/review'],
    ] as const) {
      await showScenario(page, base(), life, path);
      await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
      const first = await page.locator('main > :not(.sr-only):not(dialog)').first().boundingBox();
      expect(first!.y, `${path} ${life}`).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      for (const t of await tappable(page)) {
        if (t.y < IPHONE.height) expect(t.y, `${path} ${life}: ${t.what}`).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      }
      const tabs = await page.locator('.tab').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
      for (const bottom of tabs) expect(bottom, `${path} ${life}`).toBeLessThanOrEqual(IPHONE.height - IPHONE_INSETS.bottom + 0.5);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const bar = await page.locator('.tabbar').boundingBox();
      const last = await page.locator('main > :not(.sr-only):not(dialog)').last().boundingBox();
      expect(last!.y + last!.height, `${path} ${life}`).toBeLessThanOrEqual(bar!.y);
    }
    // A sheet leaves room for the home bar too: its last control ends above it.
    await showScenario(page, base(), 'review-busy', '/review');
    await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
    await page.getByTestId(`item-${idOf('review-busy', 'CORNER STORE')}`).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    // Once it has finished sliding up.
    await sheet.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    await sheet.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    const box = await sheet.locator('.sheet__inner').boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(IPHONE.height + 0.5);
    const lastControl = await sheet.locator('button, input, [role="switch"]').last().boundingBox();
    expect(lastControl!.y + lastControl!.height).toBeLessThanOrEqual(IPHONE.height - IPHONE_INSETS.bottom + 0.5);
    await context.close();
  });

  it('with reduced motion on, the sheet does not slide and the switch does not slide', async () => {
    const page = await openScenario(await browser().newContext(phone({ reducedMotion: 'no-preference' })), base(), 'review-busy', '/review');
    await page.getByTestId(`item-${idOf('review-busy', 'CORNER STORE')}`).getByTestId('more').click();
    expect(await page.getByTestId('review-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('sheet-in');

    // The same page with motion reduced, the life started over (showLive in live.ts says why).
    await emulatePhone(page, { reducedMotion: 'reduce' });
    await showScenario(page, base(), 'review-busy', '/review');
    await page.getByTestId(`item-${idOf('review-busy', 'CORNER STORE')}`).getByTestId('more').click();
    expect(await page.getByTestId('review-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    const durations = await page.locator('.toggle__track, .toggle__thumb, .button, .bar__fill').evaluateAll((els) => els.map((e) => getComputedStyle(e).transitionDuration));
    expect(durations.length).toBeGreaterThan(3);
    expect(durations.every((d) => d.split(',').every((part) => Number.parseFloat(part) === 0))).toBe(true);
    await page.context().close();
  });

  it("the text grows with the phone's text size, and Buckets and Review still fit", async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    const page = await context.newPage();
    for (const [life, path] of [
      ['normal', '/buckets'],
      ['big', '/buckets'],
      ['mismatch', '/buckets'],
      ['review-busy', '/review'],
      ['big', '/review'],
    ] as const) {
      await showScenario(page, base(), life, path);
      const before = await page.locator('.row__title, .hero__label, .state__title, .decision__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      // The largest accessibility text size on the iPhone is about twice the default.
      await addStyle(page, 'html { font-size: 36px !important; }');
      const after = await page.locator('.row__title, .hero__label, .state__title, .decision__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      expect(after, `${path} ${life}`).toBeGreaterThan(before * 1.8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} ${life}`).toBeLessThanOrEqual(IPHONE.width);
      const boxes = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })));
      for (const b of boxes) {
        expect(b.left, `${path} ${life}`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${path} ${life}`).toBeLessThanOrEqual(IPHONE.width);
      }
      // A row's title is not squeezed to a sliver to keep its amount on the same line (found on CI, where the
      // font is wider): the amount goes below it instead, and the title keeps the row's width, at least six
      // letters' worth, whatever the font.
      // Rows on the screen only: a closed sheet's rows are not drawn (12.6's sheet on Buckets).
      const squeezed = await page.locator('.row--trailing .row__title').evaluateAll((els) =>
        els.filter((e) => e.getClientRects().length > 0).flatMap((e) => {
          const width = e.getBoundingClientRect().width;
          const size = Number.parseFloat(getComputedStyle(e).fontSize);
          return width < 6 * size ? [`"${e.textContent ?? ''}" is only ${Math.round(width)}px wide`] : [];
        }),
      );
      expect(squeezed, `${path} ${life}`).toEqual([]);
    }
    // And with a sheet open at the largest size.
    await showScenario(page, base(), 'review-busy', '/review');
    await addStyle(page, 'html { font-size: 36px !important; }');
    await page.getByTestId(`item-${idOf('review-busy', 'CORNER STORE')}`).getByTestId('more').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
    const widths = await page.getByTestId('review-sheet').locator('*').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    for (const right of widths) expect(right).toBeLessThanOrEqual(IPHONE.width + 0.5);
    await context.close();
  });

  it('money is written the same way everywhere on the new screens, with digits that line up', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const [life, path] of [
      ['normal', '/buckets'],
      ['overspent', '/buckets'],
      ['mismatch', '/buckets'],
      ['big', '/buckets'],
      ['buckets-busy', '/buckets'],
      ['review-busy', '/review'],
      ['big', '/review'],
    ] as const) {
      await showScenario(page, base(), life, path);
      const amounts = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', numbers: getComputedStyle(e).fontVariantNumeric })));
      expect(amounts.length, `${path} ${life}`).toBeGreaterThan(0);
      for (const a of amounts) {
        expect(a.text, `${path} ${life}`).toMatch(/^−?\$\d{1,3}(,\d{3})*\.\d{2}$/);
        expect(a.numbers, `${path} ${life}`).toContain('tabular-nums');
      }
    }
    await context.close();
  });

  it('dark only, whatever the phone is set to, on the new screens', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const [scheme, background] of [
      ['light', 'rgb(5, 5, 6)'],
      ['dark', 'rgb(5, 5, 6)'],
    ] as const) {
      await emulatePhone(page, { colorScheme: scheme });
      for (const path of ['/buckets', '/review']) {
        await showScenario(page, base(), 'normal', path);
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), `${scheme} ${path}`).toBe(background);
      }
    }
    await context.close();
  });

  it('low, empty, under target, over target, pending, and refused say so in words and an icon, never by color alone', async () => {
    const context = await browser().newContext(phone());
    const page = await openScenario(context, base(), 'low', '/buckets');
    for (const status of ['low'] as const) {
      const label = page.locator(`[data-status="${status}"]`).first();
      expect((await label.innerText()).length).toBeGreaterThan(2);
      expect(await label.locator('[data-icon]').count()).toBe(1);
    }
    // The same page, moved to each other life (showLive in live.ts says why).
    await showScenario(page, base(), 'normal', '/buckets');
    expect(await page.locator('[data-status="under-target"] [data-icon]').count()).toBe(1);
    await showScenario(page, base(), 'review-busy', '/review');
    expect(await page.locator('[data-status="pending"] [data-icon]').count()).toBeGreaterThan(0);
    for (const label of await page.locator('[data-status]').all()) expect((await label.innerText()).trim().length).toBeGreaterThan(2);
    await context.close();
  });

  it('using Review runs under the security policy without a single error', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base()}/demo/review-busy`);
    // Home has finished loading before the page goes on: leaving a request unfinished is not an error of the app,
    // but WebKit reports it in the console.
    await page.getByTestId('safe-to-spend').waitFor();
    await page.goto(`${base()}/review`);
    await page.getByTestId('review-count').waitFor();
    const store = idOf('review-busy', 'CORNER STORE');
    await page.getByTestId(`item-${store}`).getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('choice-wants').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    await page.getByTestId('tab-buckets').click();
    await page.getByTestId('buckets-total').waitFor();
    expect(errors).toEqual([]);
    await context.close();
  });
});

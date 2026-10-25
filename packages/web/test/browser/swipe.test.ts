import type { BankBalances, Book, IsoDate } from '@budget-app/money';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { amountAt } from './activity-screens.js';
import { ENGINES, openScenario, phone, textAt, untilQuiet, useEngine } from './harness.js';
import { item, listed, watchChoices } from './screens.js';

// Redesign PR 3, swipe to sort in Review and the payday moment, in a browser.
// A swipe is another way to press a button: it sends exactly what the button
// sends, and never answers what the button would ask about first.

function life(name: string): { readonly book: Book; readonly bank: BankBalances; readonly today: IsoDate } {
  const input = demoScenario(name)?.input?.();
  if (input === undefined || input.book === null || input.bank === null) throw new Error(`no made-up life called ${name}`);
  return { book: input.book, bank: input.bank, today: input.today };
}

function idOf(book: Book, description: string): string {
  const found = book.reviewItems().find((i) => 'description' in i && i.description === description);
  if (found === undefined) throw new Error(`nothing waiting called ${description}`);
  return found.id;
}

const MOVING = { reducedMotion: 'no-preference' } as const;
const CARD = 'xpath=ancestor::*[@data-testid="swipe-card"]';

// Drag a card from its title, sideways, in steps.
async function drag(page: Page, id: string, dx: number, { release = true, steps = 8 } = {}): Promise<void> {
  await item(page, id).locator('.decision__title').scrollIntoViewIfNeeded();
  const box = (await item(page, id).locator('.decision__title').boundingBox())!;
  const x = box.x + 10;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + 1, { steps });
  if (release) await page.mouse.up();
}

function bodies(posts: ReturnType<typeof watchChoices>['posts']): Record<string, unknown>[] {
  return posts.map((p) => JSON.parse(p.postData() ?? '{}') as Record<string, unknown>);
}

const withoutId = ({ id: _id, ...rest }: Record<string, unknown>): Record<string, unknown> => rest;

const atRest = (page: Page): Promise<unknown> => page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[data-testid="swipe-card"]')].every((e) => e.style.transform === ''));

describe.each(ENGINES)('Swipe to sort in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  async function open(name = 'review-busy', options = {}): Promise<Page> {
    const page = await openScenario(await browser().newContext(phone(options)), base(), name, '/review');
    page.setDefaultTimeout(15_000);
    return page;
  }

  it('PR 3 a swipe to the right sends exactly what the suggested button sends', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const swiped = await open();
    const swipedPosts = watchChoices(swiped);
    await drag(swiped, id, 200);
    await item(swiped, id).waitFor({ state: 'detached' });
    await untilQuiet(swiped);
    await swiped.context().close();

    const tapped = await open();
    const tappedPosts = watchChoices(tapped);
    await item(tapped, id).getByTestId('pick-needs').click();
    await item(tapped, id).waitFor({ state: 'detached' });
    await untilQuiet(tapped);
    await tapped.context().close();

    const a = bodies(swipedPosts.posts);
    const b = bodies(tappedPosts.posts);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(withoutId(a[0]!)).toEqual(withoutId(b[0]!));
    expect(a[0]!['choice']).toEqual({ to: 'needs' });
  });

  it('PR 3 a swipe has a decision number made on the phone like a button, and the notice says what was done', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open();
    const posts = watchChoices(page);
    await drag(page, id, 200);
    await item(page, id).waitFor({ state: 'detached' });
    expect(posts.ids()).toHaveLength(1);
    expect(posts.ids()[0]).toMatch(/\S+/);
    await page.getByTestId('notice').waitFor();
    await page.context().close();
  });

  it('PR 3 with motion on, a swipe flies out and answers once', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open('review-busy', MOVING);
    const posts = watchChoices(page);
    await drag(page, id, 200);
    await item(page, id).waitFor({ state: 'detached' });
    expect(posts.posts).toHaveLength(1);
    await page.context().close();
  });

  it('PR 3 a short drag goes back and answers nothing', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open();
    const posts = watchChoices(page);
    await drag(page, id, 40, { steps: 40 });
    await atRest(page);
    expect(posts.posts).toHaveLength(0);
    expect(await listed(page)).toContain(id);
    await page.context().close();
  });

  it('PR 3 hint words fade in while dragging, and are not there at rest', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open();
    const hint = item(page, id).locator('xpath=ancestor::*[@data-testid="swipe"]').locator('.swipe__hint--right');
    expect(await hint.isVisible()).toBe(false);
    await drag(page, id, 60, { release: false, steps: 30 });
    expect(await hint.isVisible()).toBe(true);
    expect((await hint.innerText()).toLowerCase()).toBe('needs');
    const partway = Number(await hint.evaluate((e) => getComputedStyle(e).opacity));
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(1);
    await page.mouse.move(0, 0, { steps: 4 });
    await page.mouse.up();
    await atRest(page);
    expect(await hint.isVisible()).toBe(false);
    expect(await page.locator('.swipe__hints').first().getAttribute('aria-hidden')).toBe('true');
    await page.context().close();
  });

  it('PR 3 a swipe to the left is "later": nothing is sent, the item goes to the end of its group, the count is the same', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open();
    const posts = watchChoices(page);
    const order = async (): Promise<string[]> => page.locator('[data-testid="group-spending"] article').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
    const before = await order();
    expect(before.at(-1)).not.toBe(`item-${id}`);
    await drag(page, id, -200);
    await page.waitForFunction((i) => [...document.querySelectorAll('[data-testid="group-spending"] article')].at(-1)?.getAttribute('data-testid') === `item-${i}`, id);
    const after = await order();
    expect(after.slice().sort()).toEqual(before.slice().sort());
    expect(after.at(-1)).toBe(`item-${id}`);
    expect(posts.posts).toHaveLength(0);
    expect(await page.getByTestId('review-count').innerText()).toBe(String(book.reviewItems().length));
    await page.context().close();
  });

  it('PR 3 the Later button does the same as a swipe to the left, and sends nothing', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open();
    const posts = watchChoices(page);
    await item(page, id).getByTestId('later').click();
    await page.waitForFunction((i) => [...document.querySelectorAll('[data-testid="group-spending"] article')].at(-1)?.getAttribute('data-testid') === `item-${i}`, id);
    expect(posts.posts).toHaveLength(0);
    await page.context().close();
  });

  it('PR 3 a swipe never answers what the button would ask about first: no suggestion, or a choice that asks, takes the button', async () => {
    const { book } = life('review-busy');
    const page = await open();
    const posts = watchChoices(page);
    // A purchase with no suggested bucket, and the deposits (their first choice is a paycheck, which asks).
    const ids = [idOf(book, 'ONLINE MARKETPLACE'), ...book.reviewItems().filter((i) => i.type === 'money-in').map((i) => i.id)];
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) {
      const card = item(page, id).locator(CARD);
      // Dragged to the right it does not move, and is not given a hint to accept.
      await drag(page, id, 220, { release: false });
      expect(await card.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41), id).toBe(0);
      await page.mouse.up();
    }
    expect(posts.posts).toHaveLength(0);
    expect(await page.getByTestId('review-sheet').evaluate((e) => (e as HTMLDialogElement).open)).toBe(false);
    await page.context().close();
  });

  it('PR 3 a drag the phone takes over (cancelled) answers nothing, however far it went', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open();
    const posts = watchChoices(page);
    await item(page, id).locator(CARD).evaluate((e) => {
      const box = e.getBoundingClientRect();
      const at = (type: string, dx: number): void => {
        e.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: box.x + 20 + dx, clientY: box.y + 10 }));
      };
      at('pointerdown', 0);
      at('pointermove', 60);
      at('pointermove', 220);
      at('pointercancel', 220);
    });
    await atRest(page);
    expect(posts.posts).toHaveLength(0);
    expect(await listed(page)).toContain(id);
    await page.context().close();
  });

  it('PR 3 pressing a button on a card is no drag', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open();
    await item(page, id).getByTestId('more').scrollIntoViewIfNeeded();
  const box = (await item(page, id).getByTestId('more').boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 205, box.y + box.height / 2, { steps: 6 });
    expect(await item(page, id).locator(CARD).evaluate((e) => (e as HTMLElement).style.transform)).toBe('');
    await page.mouse.up();
    await page.context().close();
  });

  it('PR 3 a swipe that is refused brings the card back and says why', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open('review-busy', MOVING);
    await page.route('**/api/choice', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'refused', why: 'Made up: refused.' }) }));
    await drag(page, id, 200);
    await page.getByTestId('notice').waitFor();
    await atRest(page);
    expect(await listed(page)).toContain(id);
    await page.context().close();
  });

  it('PR 3 B264 a refused swipe’s card is at rest the moment the refusal shows, while the way back is still drawn', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open('review-busy', MOVING);
    await page.route('**/api/choice', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'refused', why: 'Made up: refused.' }) }));
    await drag(page, id, 200);
    // At the first frame the refusal is on the screen, no card is left off its place by its own style:
    // nothing that finishes later (an animation's last write) can leave it there.
    const atFirstFrame = await page.evaluate(
      () =>
        new Promise<string[]>((done) => {
          const look = (): void => {
            if (document.querySelector('[data-testid="notice"]') === null) {
              requestAnimationFrame(look);
              return;
            }
            done([...document.querySelectorAll<HTMLElement>('[data-testid="swipe-card"]')].map((e) => e.style.transform));
          };
          look();
        }),
    );
    expect(atFirstFrame.filter((t) => t !== '')).toEqual([]);
    expect(await listed(page)).toContain(id);
    await page.context().close();
  });

  it('PR 3 B264 a refused swipe’s card is back at rest in the very commit that adds the refusal, before any passive effect', async () => {
    const { book } = life('review-busy');
    const id = idOf(book, 'LATE FEE');
    const page = await open('review-busy', MOVING);
    await page.route('**/api/choice', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'refused', why: 'Made up: refused.' }) }));
    // A mutation observer runs right after the commit that added the notice
    // (layout effects included) and before any passive effect or frame.
    await page.evaluate(() => {
      const w = window as unknown as { __cardsWhenNoticeCame?: string[] };
      new MutationObserver(() => {
        if (w.__cardsWhenNoticeCame !== undefined || document.querySelector('[data-testid="notice"]') === null) return;
        w.__cardsWhenNoticeCame = [...document.querySelectorAll<HTMLElement>('[data-testid="swipe-card"]')].map((e) => e.style.transform);
      }).observe(document.body, { childList: true, subtree: true });
    });
    await drag(page, id, 200);
    await page.getByTestId('notice').waitFor();
    const cards = await page.evaluate(() => (window as unknown as { __cardsWhenNoticeCame?: string[] }).__cardsWhenNoticeCame);
    expect(cards).toBeDefined();
    expect(cards!.filter((t) => t !== '')).toEqual([]);
    await page.context().close();
  });

  it('PR 3 with nothing left waiting, Review says "All sorted"', async () => {
    const page = await open('all-clear');
    expect(await textAt(page, 'review-empty')).toContain('All sorted');
    await page.context().close();
  });
});

describe.each(ENGINES)('The payday moment in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('PR 3 the bar divides the paycheck exactly as the money math did, and the words under it say the same', async () => {
    const { book } = life('payday-paid');
    const report = book.paydayReport().paycheck!;
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'payday-paid', '/payday');
    const parts = { mom: report.split.momReserve, savings: report.split.savings, needs: report.split.needs, wants: report.split.wants };
    const cells = await page.locator('[data-testid^="moment-"][data-cents]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-testid')!.slice('moment-'.length), Number(e.getAttribute('data-cents'))] as const));
    expect(Object.fromEntries(cells)).toEqual(Object.fromEntries(Object.entries(parts).filter(([, c]) => c > 0)));
    expect(cells.reduce((sum, [, c]) => sum + c, 0)).toBe(report.amount);
    for (const [key, cents] of Object.entries(parts)) expect(await amountAt(page, `moment-got-${key}`), key).toBe(cents);
    expect(await amountAt(page, 'paycheck-amount')).toBe(report.amount);
    await page.context().close();
  });

  it('PR 3 only saving is celebrated: sparks and the sweep are on the savings part and nowhere else', async () => {
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'payday-paid', '/payday');
    expect(await page.getByTestId('moment-savings').getByTestId('moment-sparks').count()).toBe(1);
    expect(await page.getByTestId('moment-sparks').count()).toBe(1);
    expect(await page.locator('[data-testid="payday-moment"] .moment__spark').count()).toBe(5);
    const sweeps = await page.locator('.moment__seg').evaluateAll((els) => els.map((e) => [e.className.replace('moment__seg moment__seg--', ''), getComputedStyle(e, '::after').animationName] as const));
    for (const [key, name] of sweeps) expect(name === 'sweep', key).toBe(key === 'savings');
    await page.context().close();
  });

  it('PR 3 the bar draws in with motion on, and is drawn and still with reduced motion', async () => {
    const moving = await openScenario(await browser().newContext(phone(MOVING)), base(), 'payday-paid', '/payday');
    expect(await moving.locator('.moment__seg').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('divide');
    await moving.context().close();
    const still = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    expect(await still.locator('.moment__seg').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    expect(await still.locator('.moment__spark').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    expect(await still.locator('.moment__seg--savings').evaluate((e) => getComputedStyle(e, '::after').animationName)).toBe('none');
    await still.context().close();
  });

  it('PR 3 the bar is hidden from a screen reader; the legend carries the same words and amounts', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    expect(await page.getByTestId('moment-bar').getAttribute('aria-hidden')).toBe('true');
    expect((await textAt(page, 'moment-legend')).replace(/\s+/g, ' ')).toMatch(/^Mom reserve \$[\d,.]+ Savings \$[\d,.]+ Needs \$[\d,.]+ Wants \$[\d,.]+$/);
    await page.context().close();
  });
});

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HER_SWITCHES } from '@budget-app/money';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoServer } from '../src/demo/demo-server.js';
import { HER_SCENARIOS, herLife, herScenario } from '../src/demo/her-lives.js';
import { DEMO_SCENARIOS, SETUP_SCENARIOS } from '../src/demo/scenarios.js';
import type { ActivityView } from '../src/views/activity.js';

// Her setup's made-up lives for the demo (npm run demo, /demo): both cards
// with statements, Wishlist and its list, a paycheck waiting for her yes,
// Review with Wishlist sorting, cards due and overdue, one bank that cannot be
// read. Every number goes through the real money math, and every name is made
// up. Upstream's lives and the guard that the demo never opens the database
// or loads bank code are in demo.test.ts.

const NAMES = ['her-everyday', 'her-payday', 'her-review-busy', 'her-card-due', 'her-one-bank-down'];

// Everything a screen is sent, as JSON, on one made-up life.
const SCREENS = ['home', 'buckets', 'buckets/wishlist', 'review', 'trends', 'settings', 'payday', 'statement/everyday-card', 'statement/second-card'];

describe('her made-up lives: the picker', () => {
  it('there are five, with their own names, and upstream\'s lives are not among them', () => {
    expect(HER_SCENARIOS.map((s) => s.name)).toEqual(NAMES);
    for (const s of [...DEMO_SCENARIOS, ...SETUP_SCENARIOS]) expect(s.name.startsWith('her-'), s.name).toBe(false);
    for (const name of NAMES) expect(herScenario(name)?.name).toBe(name);
  });
});

describe('her made-up lives: each one opens', () => {
  it('each builds through the money math in her setup, says its numbers are made up, and agrees with its made-up banks (12.3)', () => {
    for (const s of HER_SCENARIOS) {
      const life = herLife(s.name);
      expect(life.input.madeUpData, s.name).toBe(true);
      expect(life.input.book?.switches(), s.name).toEqual(HER_SWITCHES);
      // Only the life with a bank that cannot be read has no balances to check.
      if (s.name === 'her-one-bank-down') expect(life.input.bank, s.name).toBeNull();
      else expect(life.input.book?.selfCheck(life.input.bank!).ok, s.name).toBe(true);
    }
  });

  describe('through the demo server', () => {
    let server: Server;
    let base = '';
    beforeAll(async () => {
      server = createDemoServer({ webRoot: fileURLToPath(new URL('../../web/dist/', import.meta.url)), onError: () => undefined });
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    });
    const get = async <T>(name: string, screen: string): Promise<T> => {
      const res = await fetch(`${base}/api/${screen}`, { headers: { cookie: `demo=${name}` } });
      expect(res.status, `${name} ${screen}`).toBe(200);
      return (await res.json()) as T;
    };
    const post = (name: string, body: object): Promise<Response> =>
      fetch(`${base}/api/choice`, { method: 'POST', headers: { cookie: `demo=${name}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let n = 0;
    const id = (): string => `demo-her-decision-${(n += 1)}`;

    it('/demo lists them under their own heading, after upstream\'s, and picking one opens Home', async () => {
      const page = await (await fetch(`${base}/demo`)).text();
      expect(page).toContain('Her setup');
      for (const name of NAMES) expect(page).toContain(`/demo/${name}`);
      expect(page.indexOf('Her setup')).toBeGreaterThan(page.indexOf('/demo/normal'));
      for (const name of NAMES) {
        const res = await fetch(`${base}/demo/${name}`, { redirect: 'manual' });
        expect(res.status, name).toBe(303);
        expect(res.headers.get('location'), name).toBe('/home');
      }
    });

    it('every screen of every life is served, and none says anything about mom or the old card ("Off in this setup")', async () => {
      for (const name of NAMES) {
        await fetch(`${base}/demo/${name}`, { redirect: 'manual' });
        for (const screen of SCREENS) {
          const view = await get<{ state: string }>(name, screen.startsWith('buckets/') ? `activity/${screen.slice(8)}` : screen);
          expect(view.state, `${name} ${screen}`).toMatch(/^(tracking|ready)$/);
          const text = JSON.stringify(view);
          expect(text, `${name} ${screen}`).not.toMatch(/\bmom\b|momReserve|mom-reserve|old[- ]?card|oldCard|debt-payoff|promo/i);
        }
      }
    });

    it('52.1 52.2 "her-everyday": both cards with a statement and a due date, everything owed set aside, four things on the Wishlist with one Ready and one part way', async () => {
      const home = await get<{ cards: { cards: { card: string; owes: number; setAside: number; statement: { shown: boolean; dueDate?: string } }[] }; cardNames: Record<string, string> }>('her-everyday', 'home');
      expect(home.cards.cards.map((c) => c.card)).toEqual(['everyday-card', 'second-card']);
      for (const c of home.cards.cards) {
        expect(c.statement.shown, c.card).toBe(true);
        expect(c.statement.dueDate, c.card).toMatch(/^2026-/);
        expect(c.owes, c.card).toBeGreaterThan(0);
        expect(c.setAside, c.card).toBe(c.owes);
      }
      expect(home.cardNames).toEqual({ 'everyday-card': 'Capital One card', 'second-card': 'Amex card' });
      const list = await get<Extract<ActivityView, { state: 'tracking' }>>('her-everyday', 'activity/wishlist');
      const items = list.list?.items ?? [];
      expect(items).toHaveLength(4);
      expect(items.some((i) => i.ready && i.has === i.price)).toBe(true);
      expect(items.some((i) => !i.ready && i.has > 0 && i.has < i.price)).toBe(true);
    });

    it('40.1 40.4 40.5 "her-everyday": Trends has pay periods from before setup day and since, with a Wishlist part', async () => {
      const trends = await get<{ periods: { spent: Record<string, number>; items: { beforeSetup?: boolean }[] }[] }>('her-everyday', 'trends');
      expect(trends.periods.length).toBeGreaterThanOrEqual(4);
      expect(trends.periods.some((p) => p.items.some((i) => i.beforeSetup === true))).toBe(true);
      expect(trends.periods.some((p) => p.items.every((i) => i.beforeSetup !== true) && p.items.length > 0)).toBe(true);
      expect(trends.periods.some((p) => (p.spent['wishlist'] ?? 0) > 0)).toBe(true);
      expect(trends.periods.every((p) => p.spent['old-card'] === undefined)).toBe(true);
    });

    it('52.4 "her-everyday": each card has a statement whose lines add up to its balance', async () => {
      for (const card of ['everyday-card', 'second-card']) {
        const view = await get<{ state: string; statement: { statementBalance: number; carriedIn: { amount: number }; charges: number; notMatched: number } }>('her-everyday', `statement/${card}`);
        expect(view.state).toBe('ready');
        const s = view.statement;
        expect(s.carriedIn.amount + s.charges + s.notMatched, card).toBe(s.statementBalance);
      }
    });

    it('3.1 51.1 "her-payday": a paycheck waits for her yes, with the split it would get, and Home says so', async () => {
      const home = await get<{ attention: { kind: string; amount?: number }[]; safeToSpend: { shown: boolean } }>('her-payday', 'home');
      const waiting = home.attention.find((a) => a.kind === 'paycheck-waiting');
      expect(waiting?.amount).toBeGreaterThan(0);
      const review = await get<{ items: { item: { type: string; reason?: string; id: string }; paycheckPreview: { savings: number; needs: number; wants: number; wishlist?: number } | null }[] }>('her-payday', 'review');
      const card = review.items.find((d) => d.item.type === 'money-in' && d.item.reason === 'paycheck');
      expect(card?.paycheckPreview?.wishlist).toBeGreaterThan(0);
      const s = card!.paycheckPreview!;
      expect(s.savings + s.needs + s.wants + (s.wishlist ?? 0)).toBe(waiting!.amount);
    });

    it('4.2 4.4 50.3 "her-review-busy": a purchase sorted to Wishlist asks which thing on her list it was, and a split across needs, wants and Wishlist works', async () => {
      await fetch(`${base}/demo/her-review-busy`, { redirect: 'manual' });
      const review = await get<{ wishlistItems: { id: string }[]; items: { item: { id: string; description?: string } }[] }>('her-review-busy', 'review');
      expect(review.wishlistItems).toHaveLength(4);
      const lamp = review.items.find((d) => d.item.description?.includes('LAMP'));
      const big = review.items.find((d) => d.item.description?.includes('BIG BOX'));
      expect(lamp, 'a lamp is waiting').toBeDefined();
      expect(big, 'a big purchase is waiting').toBeDefined();
      // Without saying which, it is refused and nothing changes.
      const without = await post('her-review-busy', { id: id(), item: lamp!.item.id, choice: { to: 'wishlist' } });
      expect(without.status).toBe(422);
      expect(((await without.json()) as { why: string }).why).toContain('Which thing on your list was it');
      // With the item, it is bought and leaves the list.
      const withItem = await post('her-review-busy', { id: id(), item: lamp!.item.id, choice: { to: 'wishlist' }, wishlistItem: 'item-3' });
      expect(withItem.status).toBe(200);
      const list = await get<Extract<ActivityView, { state: 'tracking' }>>('her-review-busy', 'activity/wishlist');
      expect(list.list?.bought.map((b) => b.id)).toEqual(['item-3']);
      expect(list.list?.items.map((i) => i.id)).not.toContain('item-3');
      // A split across the three: the rest of it to Wishlist, and None of them.
      const split = await post('her-review-busy', { id: id(), item: big!.item.id, choice: { split: [{ bucket: 'needs', amount: 2_000 }, { bucket: 'wants', amount: 1_500 }, { bucket: 'wishlist', amount: 'rest' }] }, wishlistItem: 'none' });
      expect(split.status).toBe(200);
      // It stays made until the life is picked again.
      await fetch(`${base}/demo/her-review-busy`, { redirect: 'manual' });
      expect((await get<{ items: unknown[] }>('her-review-busy', 'review')).items.length).toBe(review.items.length);
    });

    it('9.4 9.6 50.4 "her-card-due": one card due in 2 days, one overdue, and Move from savings to checking for a Wishlist purchase', async () => {
      const home = await get<{ attention: { kind: string; card?: string; daysLeft?: number }[]; wishlistMove?: { amount: number; when: { kind: string; card?: string } | null } }>('her-card-due', 'home');
      const due = home.attention.find((a) => a.kind === 'card-due');
      expect(due?.daysLeft).toBe(2);
      const overdue = home.attention.find((a) => a.kind === 'card-overdue');
      expect(overdue).toBeDefined();
      expect(overdue?.card).not.toBe(due?.card);
      expect(home.wishlistMove?.amount).toBeGreaterThan(0);
      expect(home.wishlistMove?.when?.kind).toBe('before-due');
    });

    it('0.5 "her-one-bank-down": the Amex card cannot be read, so Home greys safe to spend with when it was checked and says which bank', async () => {
      const home = await get<{ safeToSpend: { shown: boolean; why?: string; lastChecked?: { amount: number; at: string } | null; notRead?: string[] }; attention: { kind: string; name?: string }[] }>('her-one-bank-down', 'home');
      expect(home.safeToSpend).toMatchObject({ shown: false, why: 'bank-not-read', notRead: ['American Express'] });
      expect(home.safeToSpend.lastChecked?.at).toMatch(/^2026-10-/);
      expect(home.attention.some((a) => a.kind === 'bank-login' && a.name === 'American Express')).toBe(true);
    });
  });
});

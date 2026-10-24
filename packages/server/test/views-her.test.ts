import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import { join } from 'node:path';
import { HER_SWITCHES } from '@budget-app/money';
import { afterEach, describe, expect, it } from 'vitest';
import { herLife, herWeeks } from './her-harness.js';
import { choose, decision, lifeInAFile, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { loginForTests } from './login-for-tests.js';

// Her rulebook, "Off in this setup": nothing about the mom reserve or the old
// card is shown anywhere. Her books are lived through the real server (a
// paycheck, purchases, a payment to a person, money in, a hand move, a card
// statement), and every screen's numbers are read as the phone reads them,
// from the server's own addresses. Every name and number is made up.

// Anything about the mom reserve or the old card, in a key or a word.
const OFF_WORDS = /mom|old.?card|reserve|promo|payoff|debt/i;

interface Running {
  readonly life: Life;
  readonly server: Server;
  readonly port: number;
  readonly cookie: string;
}
const running: Running[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    await new Promise<void>((done) => r.server.close(() => done()));
    r.life.done();
  }
});

async function serve(life: Life): Promise<Running> {
  const webRoot = join(life.dir, 'dist');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  let origin = '';
  const server = life.keeper.server(webRoot, () => origin);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  origin = `http://localhost:${port}`;
  const r = { life, server, port, cookie: loginForTests(life.h.db, life.now) };
  running.push(r);
  return r;
}

function read(r: Running, path: string): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: r.port, method: 'GET', path, headers: { Host: `localhost:${r.port}`, Cookie: r.cookie } }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += String(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on('error', reject);
    req.end();
  });
}

const SCREENS = ['/api/home', '/api/buckets', '/api/trends', '/api/review', '/api/payday', '/api/settings', '/api/setup', '/api/alerts', '/api/status', ...['needs', 'wants', 'savings', 'held-for-others'].map((slug) => `/api/activity/${slug}`)];

describe('Off in this setup: no screen shows the mom reserve or the old card', () => {
  it("3.2 off: money in sorted, and sorted again from its bucket's list: 'This is my paycheck' says what it would give, with no reserve", { timeout: 60_000 }, async () => {
    const life = await herWeeks();
    expect(choose(life.keeper, { item: 'friend-1', choice: { to: 'wants' } })).toMatchObject({ ok: true });
    const r = await serve(life);
    const { body } = await read(r, '/api/activity/wants');
    const rows = (JSON.parse(body) as { activity: { rows: { resort: { resortable: boolean; paycheckPreview?: Record<string, unknown> | null } }[] } }).activity.rows;
    const previews = rows.flatMap((row) => (row.resort.resortable && row.resort.paycheckPreview ? [row.resort.paycheckPreview] : []));
    expect(previews.length).toBeGreaterThan(0);
    // PR 9: and Wishlist's part, at 0% here.
    for (const preview of previews) expect(Object.keys(preview).sort()).toEqual(['detail', 'needs', 'savings', 'wants', 'wishlist']);
    expect(body).not.toMatch(OFF_WORDS);
  });

  it('Off in this setup: every screen of her books, as the phone reads it, says nothing about mom, a reserve, the old card, a promo date, a payoff or a debt', { timeout: 60_000 }, async () => {
    const life = await herWeeks();
    expect(life.keeper.book()?.switches()).toEqual(HER_SWITCHES);
    expect(life.keeper.book()?.paychecks().length).toBe(1);
    const r = await serve(life);
    for (const path of SCREENS) {
      const { status, body } = await read(r, path);
      expect(status, path).toBe(200);
      expect(body, path).not.toMatch(OFF_WORDS);
    }
    // Not empty: each tracking screen has its numbers.
    const buckets = JSON.parse((await read(r, '/api/buckets')).body) as { state: string; savings: number };
    expect(buckets.state).toBe('tracking');
    const payday = JSON.parse((await read(r, '/api/payday')).body) as { report: { paycheck: { amount: number; split: Record<string, unknown> } } };
    expect(payday.report.paycheck.amount).toBe(250_000);
    expect(Object.keys(payday.report.paycheck.split).sort()).toEqual(['detail', 'needs', 'savings', 'wants', 'wishlist']);
    const review = JSON.parse((await read(r, '/api/review')).body) as { state: string };
    expect(review.state).toBe('tracking');
  });

  it('Off in this setup: the mom reserve has no list of its own; asking for it says it is off', { timeout: 60_000 }, async () => {
    const life = await herWeeks();
    const r = await serve(life);
    const { status, body } = await read(r, '/api/activity/mom-reserve');
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ state: 'off', madeUpData: false });
    const needs = JSON.parse((await read(r, '/api/activity/needs')).body) as { balances: Record<string, number> };
    expect(Object.keys(needs.balances).sort()).toEqual(['heldForOthers', 'needs', 'savings', 'wants', 'wishlist']);
  });

  it('Off in this setup: before setup day, Setup day asks nothing about the old card or the mom reserve', { timeout: 60_000 }, async () => {
    const life = await herLife();
    const r = await serve(life);
    life.keeper.setup({ id: decision(), setup: { lastPaycheck: '2026-09-25' } });
    const { body } = await read(r, '/api/setup');
    const view = JSON.parse(body) as { state: string; ready: boolean; assignment: Record<string, number> };
    expect(view).toMatchObject({ state: 'not-set-up', ready: true });
    expect(Object.keys(view.assignment).sort()).toEqual(['heldForOthers', 'needs', 'savings', 'wants', 'wishlist']);
    expect(body).not.toMatch(OFF_WORDS);
  });

  it('Off in this setup: upstream\'s screens are as they were: the same words are there with both on', { timeout: 60_000 }, async () => {
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    const r = await serve(life);
    expect((await read(r, '/api/buckets')).body).toMatch(/momReserve/);
    expect((await read(r, '/api/settings')).body).toMatch(/oldCardPromoEndDate/);
    expect(JSON.parse((await read(r, '/api/activity/mom-reserve')).body)).toMatchObject({ state: 'tracking', pot: 'momReserve' });
  });
});

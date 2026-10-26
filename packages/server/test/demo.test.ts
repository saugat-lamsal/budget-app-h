import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoServer, demoAddress } from '../src/demo/demo-server.js';
import { DEMO_SCENARIOS, demoScenario } from '../src/demo/scenarios.js';
import type { BucketsView } from '../src/views/buckets.js';
import type { ChoiceResponse } from '../src/views/choice.js';
import { homeView, type HomeView } from '../src/views/home.js';
import type { ReviewView } from '../src/views/review.js';
import { settingsView, type SettingsView } from '../src/views/settings.js';

// The demo: the screens on made-up lives only. It must never reach the bank
// or the database, so it is safe to open over wifi.

function viewOf(name: string): Extract<HomeView, { state: 'tracking' }> {
  const input = demoScenario(name)?.input?.();
  if (input === undefined) throw new Error(`no made-up life ${name}`);
  const view = homeView(input);
  if (view.state !== 'tracking') throw new Error(`${name} is not tracking`);
  return view;
}

describe('the made-up lives', () => {
  it('every one builds through the money math and says its numbers are made up', () => {
    for (const s of DEMO_SCENARIOS) {
      if (s.input === null) continue;
      const input = s.input();
      expect(input.madeUpData, s.name).toBe(true);
      expect(homeView(input).madeUpData, s.name).toBe(true);
      // Every one but those that show a difference agrees with its made-up bank (12.3).
      if (input.book !== null && input.bank !== null) expect(input.book.selfCheck(input.bank).ok, s.name).toBe(!['mismatch', 'catching-up', 'why-counted-twice', 'why-no-match-kept'].includes(s.name));
      // 12.6: and those say why, in lines that add up to the difference.
      const view = homeView(input);
      if (view.state === 'tracking' && !view.safeToSpend.shown && view.safeToSpend.why === 'totals-do-not-match') {
        expect(view.safeToSpend.detail?.why.reduce((total, line) => total + line.amount, 0), s.name).toBe(view.safeToSpend.check.difference);
      }
    }
  });

  it('each one shows what its name says', () => {
    const normal = viewOf('normal');
    expect(normal.attention.map((a) => a.kind)).toEqual(['review', 'move-to-savings', 'card-due']);
    expect(viewOf('all-clear').attention).toEqual([]);
    expect(viewOf('low').buckets.wants.level).toBe('low');
    expect(viewOf('overspent').buckets.wants.level).toBe('empty');
    expect(viewOf('overspent').buckets.wants.left).toBeLessThan(0);
    expect(viewOf('mismatch').safeToSpend).toMatchObject({ shown: false, why: 'totals-do-not-match', check: { difference: -1_234 }, catchingUp: false });
    expect(viewOf('catching-up').safeToSpend).toMatchObject({ shown: false, why: 'totals-do-not-match', check: { difference: -4_210 }, catchingUp: true });
    expect(viewOf('payday').payday.days).toBe(0);
    expect(viewOf('late').payday.days).toBe(-2);
    expect(viewOf('trouble').attention.slice(0, 2).map((a) => a.kind)).toEqual(['bank-login', 'card-overdue']);
    const big = viewOf('big').safeToSpend;
    expect(big.shown && big.amount > 1_000_000_000).toBe(true);
    expect(viewOf('took-back').attention[0]).toEqual({ kind: 'bank-took-back', id: 'demo-6', date: '2026-10-06', description: 'MAIN ST RESTAURANT', amount: 3_890 });
    // 4.10: the copy's money went back, so safe to spend is what it is in the normal life.
    expect(viewOf('took-back').safeToSpend).toEqual(viewOf('normal').safeToSpend);
    // B82: this morning's check came before the 6.25 coffee.
    expect(viewOf('bank-not-read').safeToSpend).toEqual({ shown: false, why: 'bank-not-read', lastChecked: { amount: 62_244 + 625, at: '2026-10-07T07:15:00-04:00' } });
    expect(homeView(demoScenario('not-set-up')!.input!())).toEqual({ state: 'not-set-up', madeUpData: true });
    expect(demoScenario('error')!.input).toBeNull();
  });
});

describe('the made-up lives for why it does not match (12.6)', () => {
  it('12.6 "why-counted-twice": the bank posted a coffee Plaid still lists as pending, and checking went up with no transaction', () => {
    const view = viewOf('why-counted-twice');
    if (view.safeToSpend.shown || view.safeToSpend.why !== 'totals-do-not-match') throw new Error('it matches');
    expect(view.safeToSpend.catchingUp).toBe(true);
    expect(view.safeToSpend.check.difference).toBe(2_750 - 575);
    expect(view.safeToSpend.detail?.why).toEqual([
      { kind: 'balance-moved', account: 'checking', balance: 'available', went: 'up', by: 2_750, amount: 2_750 },
      { kind: 'posted-still-pending', account: 'everyday-card', description: 'BLUE DOOR COFFEE', charge: true, amount: -575 },
    ]);
  });

  it('12.6 "why-no-match-kept": one line, with the whole difference; "mismatch" and "catching-up": checking moved with no transaction', () => {
    const none = viewOf('why-no-match-kept');
    if (none.safeToSpend.shown || none.safeToSpend.why !== 'totals-do-not-match') throw new Error('it matches');
    expect(none.safeToSpend.detail?.why).toEqual([{ kind: 'no-match-kept', amount: -1_234 }]);
    const mismatch = viewOf('mismatch');
    if (mismatch.safeToSpend.shown || mismatch.safeToSpend.why !== 'totals-do-not-match') throw new Error('it matches');
    expect(mismatch.safeToSpend.detail?.why).toEqual([{ kind: 'balance-moved', account: 'checking', balance: 'available', went: 'down', by: 1_234, amount: -1_234 }]);
  });
});

describe('the made-up lives for Settings', () => {
  function settingsOf(name: string): Extract<SettingsView, { state: 'tracking' }> {
    const input = demoScenario(name)!.input!();
    const view = settingsView({ today: input.today, book: input.book, bank: input.bank, madeUpData: input.madeUpData });
    if (view.state !== 'tracking') throw new Error(`${name} is not tracking`);
    return view;
  }

  it('13.1 13.5 9.5 "settings-busy" has a new split waiting for the next paycheck, a made-up promo date, and every kind of log line, in date order', () => {
    const v = settingsOf('settings-busy');
    expect(v.split.waiting).toEqual(['split', 'momReservePerPaycheck']);
    expect(v.split.thisPayPeriod.split).toEqual({ savings: 50, needs: 30, wants: 20 });
    expect(v.split.fromNextPaycheck).toMatchObject({ split: { savings: 40, needs: 40, wants: 20 }, momReservePerPaycheck: 125_000 });
    expect(v.payoff).toMatchObject({ on: true, promoEndDate: '2027-06-30' });
    expect(new Set(v.log.map((r) => r.kind))).toEqual(new Set(['setting', 'rule-added', 'rule-changed', 'rule-removed', 'money-moved', 'bank-took-back']));
    expect(v.log.some((r) => r.kind === 'rule-added' && r.fromCorrection && r.aheadOf?.contains === 'RESTAURANT')).toBe(true);
    expect(v.log.length).toBeGreaterThanOrEqual(12);
    // Newest first, and never a later day below an earlier one.
    const dates = v.log.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(Object.values(v.rules).every((list) => list.length > 0)).toBe(true);
  });

  it('A9 "settings-first-sync" has no paycheck rule or mom rule, and the paycheck and mom waiting', () => {
    const input = demoScenario('settings-first-sync')!.input!();
    expect(input.book!.settings()).toMatchObject({ paycheckRule: null, momRule: null });
    expect(input.book!.reviewItems().map((i) => i.id)).toEqual(['demo-pay', 'demo-mom', 'demo-7', 'demo-8']);
    expect(input.book!.paychecks()).toEqual([]);
  });
});

describe('the made-up lives for Review and Buckets', () => {
  it('10.3 B32 "review-busy" has one of every kind of thing waiting in review, and every offered choice works', () => {
    const input = demoScenario('review-busy')!.input!();
    const book = input.book!;
    const kinds = book.reviewDetails().map((d) => (d.item.type === 'spending' || d.item.type === 'money-in' ? `${d.item.type}:${d.item.reason}` : d.item.type));
    expect([...new Set(kinds)].sort()).toEqual(
      [
        'leftover',
        'money-in:deposit',
        'money-in:early-paycheck',
        'money-in:refund',
        'old-card-purchase',
        'spending:card-fee',
        'spending:card-interest',
        'spending:from-savings',
        'spending:mom-difference',
        'spending:no-rule',
        'spending:old-card-from-savings',
        'spending:person-payment',
        'spending:split-changed',
      ].sort(),
    );
    // 20d: the refund lists the purchase it likely belongs to, by name and amount.
    const refund = book.reviewDetails().find((d) => d.item.id === 'busy-refund')!;
    expect(refund.likelyPurchases[0]).toMatchObject({ description: 'ONLINE MARKETPLACE', amount: 2_317, sameName: true, sameAmount: true });
    expect(refund.likelyPurchases).toHaveLength(2);
    // Money in the buckets does not move because things are waiting: the bank still agrees (12.3).
    expect(book.selfCheck(input.bank!).ok).toBe(true);
  });

  it('8.2 7.3 "buckets-busy" holds a roommate\'s money and has sent mom 2,500.00 this month, within the target', () => {
    const book = demoScenario('buckets-busy')!.input!().book!;
    expect(book.othersMoney()).toEqual({ heldForOthers: 12_000, meaning: 'holding-for-others' });
    expect(book.momSentInMonth('2026-10').sent).toBe(50_000 + 200_000);
    expect(book.reviewItems()).toHaveLength(2);
  });
});

describe('the demo server', () => {
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

  it('/demo lists every made-up life', async () => {
    const page = await (await fetch(`${base}/demo`)).text();
    for (const s of DEMO_SCENARIOS) expect(page).toContain(`/demo/${s.name}`);
    expect(page).toContain('Every number here is invented');
  });

  it('picking a life remembers it and opens Home', async () => {
    const res = await fetch(`${base}/demo/low`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/home');
    expect(res.headers.get('set-cookie')).toBe('demo=low; Path=/; HttpOnly; SameSite=Strict');
    const view = (await (await fetch(`${base}/api/home`, { headers: { cookie: 'demo=low' } })).json()) as HomeView;
    expect(view.state === 'tracking' && view.buckets.wants.level).toBe('low');
  });

  it('with no life picked it shows the normal one, and an unknown name is not found', async () => {
    expect(await (await fetch(`${base}/api/home`)).json()).toEqual(JSON.parse(JSON.stringify(viewOf('normal'))));
    expect((await fetch(`${base}/demo/nothing-like-this`, { redirect: 'manual' })).status).toBe(404);
    expect(await (await fetch(`${base}/api/home`, { headers: { cookie: 'demo=nothing-like-this' } })).json()).toEqual(JSON.parse(JSON.stringify(viewOf('normal'))));
  });

  it('10.6 a take-back marked seen leaves Home, and picking the life again brings it back', async () => {
    const cookie = 'demo=took-back';
    const kindsNow = async (): Promise<string[]> => {
      const view = (await (await fetch(`${base}/api/home`, { headers: { cookie } })).json()) as HomeView;
      return view.state === 'tracking' ? view.attention.map((a) => a.kind) : [];
    };
    await fetch(`${base}/demo/took-back`, { redirect: 'manual' });
    expect(await kindsNow()).toContain('bank-took-back');
    const mark = (id: string): Promise<Response> =>
      fetch(`${base}/api/seen`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'bank-took-back', id }) });
    expect((await mark('nothing-like-this')).status).toBe(404);
    expect(await kindsNow()).toContain('bank-took-back');
    expect((await mark('demo-6')).status).toBe(204);
    expect(await kindsNow()).not.toContain('bank-took-back');
    // Another life is not touched.
    expect((await fetch(`${base}/api/seen`, { method: 'POST', headers: { cookie: 'demo=normal', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'bank-took-back', id: 'demo-6' }) })).status).toBe(404);
    await fetch(`${base}/demo/took-back`, { redirect: 'manual' });
    expect(await kindsNow()).toContain('bank-took-back');
  });

  // Review and Buckets, and the choices sent from Review, end to end.
  async function json<T>(path: string, cookie: string): Promise<T> {
    return (await (await fetch(`${base}${path}`, { headers: { cookie } })).json()) as T;
  }
  function choose(cookie: string, body: object): Promise<Response> {
    return fetch(`${base}/api/choice`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  it('Buckets and Review are served for every made-up life', async () => {
    for (const s of DEMO_SCENARIOS) {
      if (s.input === null || s.delayMs !== undefined) continue;
      const cookie = `demo=${s.name}`;
      expect((await json<BucketsView>('/api/buckets', cookie)).state, s.name).toBe(s.name === 'not-set-up' ? 'not-set-up' : 'tracking');
      expect((await json<ReviewView>('/api/review', cookie)).state, s.name).toBe(s.name === 'not-set-up' ? 'not-set-up' : 'tracking');
    }
  });

  it('12.6 Buckets says why too, the same lines as Home', async () => {
    const buckets = await json<BucketsView>('/api/buckets', 'demo=why-counted-twice');
    if (buckets.state !== 'tracking' || buckets.check.state !== 'does-not-match') throw new Error('it matches');
    const home = viewOf('why-counted-twice');
    if (home.safeToSpend.shown || home.safeToSpend.why !== 'totals-do-not-match') throw new Error('it matches');
    expect(buckets.check.why).toEqual(home.safeToSpend.detail?.why);
  });

  it('4.7 a choice made in Review stays made until the life is picked again', async () => {
    const cookie = 'demo=normal';
    await fetch(`${base}/demo/normal`, { redirect: 'manual' });
    const waiting = async (): Promise<string[]> => {
      const view = await json<ReviewView>('/api/review', cookie);
      return view.state === 'tracking' ? view.items.map((d) => d.item.id) : [];
    };
    const first = await json<ReviewView>('/api/review', cookie);
    if (first.state !== 'tracking') throw new Error('not tracking');
    expect(first.items).toHaveLength(2);
    const target = first.items[0]!.item.id;
    const before = await json<HomeView>('/api/home', cookie);

    const res = await choose(cookie, { id: 'demo-decision-1', item: target, choice: { to: 'wants' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ChoiceResponse).ok).toBe(true);
    expect(await waiting()).toHaveLength(1);

    // Home follows: one fewer waiting, and what was held back is no longer held back.
    const after = await json<HomeView>('/api/home', cookie);
    expect(before.state === 'tracking' && after.state === 'tracking' && after.waitingInReview).toBe(1);

    // The same decision again changes nothing and gets the first answer back.
    const again = await choose(cookie, { id: 'demo-decision-1', item: target, choice: { to: 'wants' } });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { replayed: boolean }).replayed).toBe(true);
    expect(await waiting()).toHaveLength(1);

    // A different life is not touched.
    expect((await json<ReviewView>('/api/review', 'demo=review-busy')).state).toBe('tracking');
    expect((await json<ReviewView & { items: unknown[] }>('/api/review', 'demo=normal')).state).toBe('tracking');

    // Picking the life again starts it over.
    await fetch(`${base}/demo/normal`, { redirect: 'manual' });
    expect(await waiting()).toHaveLength(2);
  });

  it('a refused choice is a 422 with the reason, and nothing changes', async () => {
    const cookie = 'demo=review-busy';
    await fetch(`${base}/demo/review-busy`, { redirect: 'manual' });
    const before = await json<ReviewView>('/api/review', cookie);
    const res = await choose(cookie, { id: 'demo-decision-2', item: 'busy-tax', choice: { to: 'mom' } });
    expect(res.status).toBe(422);
    const answer = (await res.json()) as ChoiceResponse;
    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.why).toContain('Nothing was changed');
    expect(await json<ReviewView>('/api/review', cookie)).toEqual(before);
  });

  it('"this is my paycheck" asks first even if the phone forgets to', async () => {
    const cookie = 'demo=review-busy';
    await fetch(`${base}/demo/review-busy`, { redirect: 'manual' });
    const res = await choose(cookie, { id: 'demo-decision-3', item: 'busy-early', choice: { to: 'paycheck' } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('needs-confirmation');
    const ok = await choose(cookie, { id: 'demo-decision-3', item: 'busy-early', choice: { to: 'paycheck' }, confirmed: true });
    expect(ok.status).toBe(200);
  });

  it('section 2 Settings is served for every made-up life', async () => {
    for (const s of DEMO_SCENARIOS) {
      if (s.input === null || s.delayMs !== undefined) continue;
      expect((await json<SettingsView>('/api/settings', `demo=${s.name}`)).state, s.name).toBe(s.name === 'not-set-up' ? 'not-set-up' : 'tracking');
    }
  });

  it('13.1 A9 a settings change stays made until the life is picked again; the paycheck rule asks first', async () => {
    const cookie = 'demo=settings-first-sync';
    await fetch(`${base}/demo/settings-first-sync`, { redirect: 'manual' });
    const split = await choose(cookie, { id: 'demo-change-1', settings: { split: { savings: 40, needs: 40, wants: 20 } } });
    expect(split.status).toBe(200);
    const asked = await choose(cookie, { id: 'demo-change-2', settings: { paycheckRule: { contains: 'MADE UP EMPLOYER PAYROLL' } } });
    expect(asked.status).toBe(422);
    const question = (await asked.json()) as { code: string; preview: { key: string; items: { id: string; kind: string }[] } };
    expect(question.code).toBe('needs-confirmation');
    expect(question.preview.items).toMatchObject([{ id: 'demo-pay', kind: 'paycheck' }]);
    const yes = await choose(cookie, { id: 'demo-change-2', settings: { paycheckRule: { contains: 'MADE UP EMPLOYER PAYROLL' } }, confirmed: true, seen: question.preview.key });
    expect(yes.status).toBe(200);
    const after = await json<SettingsView>('/api/settings', cookie);
    // The paycheck that was waiting started the pay period with the new split (13.1, 6.1).
    expect(after.state === 'tracking' && after.split.thisPayPeriod.split).toEqual({ savings: 40, needs: 40, wants: 20 });
    expect(after.state === 'tracking' && after.log.map((r) => r.kind)).toEqual(['setting', 'setting']);
    await fetch(`${base}/demo/settings-first-sync`, { redirect: 'manual' });
    const again = await json<SettingsView>('/api/settings', cookie);
    expect(again.state === 'tracking' && again.log).toEqual([]);
  });

  it('13.2 a rule added from Settings sorts what it matches in Review', async () => {
    const cookie = 'demo=normal';
    await fetch(`${base}/demo/normal`, { redirect: 'manual' });
    const res = await choose(cookie, { id: 'demo-change-3', rule: { add: { for: 'purchase', contains: 'CORNER STORE', to: 'needs' } } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { done: { alsoSorted: number } }).done.alsoSorted).toBe(1);
    const review = await json<ReviewView>('/api/review', cookie);
    expect(review.state === 'tracking' && review.items.map((d) => ('description' in d.item ? d.item.description : d.item.id))).toEqual(['ONLINE MARKETPLACE']);
    await fetch(`${base}/demo/normal`, { redirect: 'manual' });
  });

  it('a settings change before setup day finds nothing to change', async () => {
    expect((await choose('demo=not-set-up', { id: 'demo-change-4', settings: { payScheduleDays: 7 } })).status).toBe(422);
    expect((await choose('demo=not-set-up', { id: 'demo-change-5', rule: { remove: 'grocery' }, confirmed: true })).status).toBe(422);
  });

  it('a choice before setup day finds nothing to choose from', async () => {
    const res = await choose('demo=not-set-up', { id: 'demo-decision-4', item: 'anything', choice: { to: 'wants' } });
    expect(res.status).toBe(422);
  });

  it('the life that cannot load answers with an error', async () => {
    expect((await fetch(`${base}/api/home`, { headers: { cookie: 'demo=error' } })).status).toBe(500);
  });
});

describe('the demo is made-up data only', () => {
  it('it listens on this computer only, unless asked for wifi', () => {
    expect(demoAddress([])).toEqual({ host: '127.0.0.1', port: 5180, wifi: false });
    expect(demoAddress(['--port', '6001'])).toEqual({ host: '127.0.0.1', port: 6001, wifi: false });
    expect(demoAddress(['--wifi'])).toEqual({ host: '0.0.0.0', port: 5180, wifi: true });
    expect(() => demoAddress(['--port', 'abc'])).toThrow();
    expect(() => demoAddress(['--port', '70000'])).toThrow();
  });

  // Every file the demo can load, by following its imports from main.ts.
  function demoImports(): { readonly files: string[]; readonly packages: Set<string> } {
    const serverSrc = fileURLToPath(new URL('../src/', import.meta.url));
    const files: string[] = [];
    const packages = new Set<string>();
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      files.push(relative(serverSrc, file).replaceAll('\\', '/'));
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'|(?:^|\n)\s*import\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)) {
        const spec = match[1] ?? match[2] ?? match[3] ?? '';
        if (spec.startsWith('.')) visit(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
        else packages.add(spec);
      }
    };
    visit(join(serverSrc, 'demo', 'main.ts'));
    return { files, packages };
  }

  it('it never loads the database, the bank connection, the bank key, or the settings file', () => {
    const { files, packages } = demoImports();
    // Setup day (section 14) reads a made-up bank history the way the bank
    // connection reads a real one: bank/ and sync/plan.ts read Plaid's
    // format, and nothing there opens the database or calls the bank.
    // Phase 5: the history's types name the alerts (alerts/plan.ts), which
    // only work alerts out; nothing there opens the database either.
    expect(files.sort()).toEqual([
      'alerts/alerts.ts',
      'alerts/plan.ts',
      // A43: the backups' health addresses (the web server names them); the demo has no backup.
      'backup/backup-watch.ts',
      'bank-rules-desk.ts',
      'bank-rules.ts',
      'bank/amounts.ts',
      'bank/balances.ts',
      'bank/plaid-item.ts',
      'bank/posting-times.ts',
      'bank/reading.ts',
      'bank/stored-account.ts',
      'bank/why.ts',
      'choices.ts',
      'demo/demo-server.ts',
      // Her setup's made-up lives and screens (docs/her-plan.txt): the money math and the views, worked out
      // in memory. No database, no bank, no clock of its own.
      'demo/her-lives.ts',
      'demo/her-screens.ts',
      'demo/made-up-bank.ts',
      'demo/main.ts',
      'demo/scenarios.ts',
      'demo/setup-lives.ts',
      // Section 40: a made-up bank history from before setup day, for the Trends tab.
      'demo/trends-history.ts',
      'errors.ts',
      // What the history checks after each event: the money math only.
      'history/history.ts',
      // The made-up "Checked at" in his home time zone (Step 3): no clock, no database.
      'history/today.ts',
      'http/server.ts',
      // A47: the address Plaid sends its webhooks to (the web server names it); the demo has no bank.
      'http/webhook-path.ts',
      // An item's key as a screen shows it (Step 3): no Node, no database.
      'item-key.ts',
      'plaid/types.ts',
      'setup-desk.ts',
      'setup-history.ts',
      'setup-view.ts',
      'sync/plan.ts',
      // Section 40: the Trends tab worked out from a book and a history handed to it; no database.
      'trends-future.ts',
      'trends-habits.ts',
      'trends.ts',
      'views/activity.ts',
      'views/alerts.ts',
      'views/bank-rules.ts',
      // The Bank connection screen's types (1.1 to 1.3): types only; the demo has no bank.
      'views/bank.ts',
      'views/buckets.ts',
      'views/choice.ts',
      // Her rulebook, 52.1: each card on Home, worked out from a book handed to it.
      'views/home-cards.ts',
      'views/home.ts',
      // What Settings shows about logging in (Step 2): a type only; the demo has no login.
      'views/login.ts',
      // Her rulebook, "Off in this setup": takes what is off out of a view before it is sent.
      'views/off.ts',
      'views/payday.ts',
      // What Settings shows about notifications (Phase 5): types only; the demo has none.
      'views/push.ts',
      'views/review.ts',
      // The change log's lines the server keeps (A28, logins): a type only.
      'views/server-log.ts',
      'views/settings.ts',
      'views/setup.ts',
      // 0.7 (A57): the status page's types (the web server names them); the demo has no status page.
      'views/status.ts',
      // Section 40: the Trends tab's types, and its parts' names.
      'views/trends.ts',
      // Her rulebook, 50.1 to 50.3: her list of things, changed in memory.
      'wishlist-items.ts',
    ]);
    for (const file of files) expect(file, file).not.toMatch(/^(db|crypto|serve)\/|^(connect|status|log)\.ts$|^plaid\/(client|sandbox-lock)\.ts$|^sync\/sync\.ts$|^history\/(history-db|keeper)\.ts$/);
    // node:crypto only names a preview of a settings change (choices.ts, previewKey).
    expect([...packages].sort()).toEqual(['@budget-app/money', 'node:crypto', 'node:fs/promises', 'node:http', 'node:os', 'node:path', 'node:url']);
  });

  it('it reads no keys or secrets from the environment', () => {
    for (const file of demoImports().files) {
      const text = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      const reads = [...text.matchAll(/process\.env\[?['.]?([A-Z_]+)/g)].map((m) => m[1]);
      expect(reads.filter((name) => name !== 'DEMO_WEB_ROOT'), file).toEqual([]);
    }
  });
});

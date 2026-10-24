import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { connectionsOf } from '../src/bank/connections.js';
import { TokenBox } from '../src/crypto/token-box.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { HER_SCHEMA_VERSION, hasHerSteps, migrateHer } from '../src/db/her-steps.js';
import { readAccounts, setBankRules } from '../src/db/store.js';
import { readOutbox } from '../src/alerts/outbox.js';
import { pointWebhooks } from '../src/bank-webhook.js';
import { connectTestBank } from '../src/connect.js';
import { WEBHOOK_PATH } from '../src/plaid/webhook.js';
import { ask, type Running } from './hosted-harness.js';
import { loginForTests } from './login-for-tests.js';
import { Keeper, type SyncBank } from '../src/history/keeper.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { WebhookKeys } from '../src/plaid/webhook.js';
import { GATHER_MS, WebhookDesk } from '../src/sync/webhook-desk.js';
import { FakeClock } from './fake-clock.js';
import { FakeKeySource, FakeWebhookSigner, webhookBody } from './fake-plaid-webhooks.js';
import { HER_START } from '../src/setup-start.js';
import { ACCOUNT_IDS, FakePlaid, SECOND_BANK, secondCardAccount, twoBanks, type FakeAccountInput } from './fake-plaid.js';
import { HER_BANK_RULES } from './her-harness.js';
import { TOKEN_KEY } from './harness.js';
import { decision, noonInNewYork } from './keeper-harness.js';

// Her rulebook, PR 6: two bank connections, Capital One then American
// Express (1.1, 1.3, 0.5, 0.7, section 2's sync, 12.3, 10.5, 10.7, 10.13).
// Against two made-up banks (fake-plaid.ts, twoBanks): the first has her
// checking, savings and everyday card, the second her second card. Plaid
// Link itself is the browser's, so here its answer is each made-up bank's.
// Every name and number is made up.

const FIRST_NAME = 'Made-up First Bank';
const SECOND_NAME = 'Made-up Second Bank';

const firstAccounts = (): FakeAccountInput[] => [
  { id: ACCOUNT_IDS.checking, name: 'Made-up Checking', mask: '1111', kind: 'checking', posted: 300_000 },
  { id: ACCOUNT_IDS.savings, name: 'Made-up Savings', mask: '2222', kind: 'savings', posted: 500_000 },
  { id: ACCOUNT_IDS.everyday, name: 'Made-up Everyday Card', mask: '3333', kind: 'credit card', posted: 45_000, limit: 500_000 },
];

const PICKS = { checking: ACCOUNT_IDS.checking, savings: ACCOUNT_IDS.savings, 'everyday-card': ACCOUNT_IDS.everyday, 'second-card': ACCOUNT_IDS.second } as const;

const RULES = [...HER_BANK_RULES];

interface Two {
  readonly db: Db;
  readonly first: FakePlaid;
  readonly second: FakePlaid;
  readonly bank: SyncBank;
  readonly lines: LogLine[];
  readonly box: TokenBox;
  readonly clock: { now: Date };
  keeper: Keeper;
  calls(fake: FakePlaid, endpoint: string): number;
}

const open: Db[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function her(): Two {
  const db = openDatabase(':memory:');
  open.push(db);
  const first = new FakePlaid(firstAccounts());
  const second = new FakePlaid([secondCardAccount(25_000)], SECOND_BANK);
  const lines: LogLine[] = [];
  const log = memoryLog(lines, [first.clientId, first.secret]);
  const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: first.clientId, PLAID_SECRET: first.secret }), { fetch: twoBanks(first, second), log });
  const box = new TokenBox(TOKEN_KEY);
  const clock = { now: noonInNewYork('2026-10-01') };
  const keeper = Keeper.open({ db, now: () => clock.now, log, start: HER_START });
  return { db, first, second, bank: { plaid, box, log, pageSize: 3 }, lines, box, clock, keeper, calls: (fake, endpoint) => fake.calls.filter((c) => c.endpoint === endpoint).length };
}

// Link's answer for one of the made-up banks, as the screen hands it on.
const answerOf = (fake: FakePlaid, name: string) => ({ publicToken: fake.publicToken, institution: { id: fake.institutionId, name } });

async function connect(t: Two, fake: FakePlaid, name: string): Promise<void> {
  const desk = t.keeper.bankDesk(t.bank);
  expect(await desk.link({ mode: 'connect', yes: true })).toMatchObject({ ok: true });
  expect(await desk.connected(answerOf(fake, name))).toMatchObject({ ok: true });
}

async function both(): Promise<Two> {
  const t = her();
  await connect(t, t.first, FIRST_NAME);
  await connect(t, t.second, SECOND_NAME);
  return t;
}

// Both connected, her four picked, the banks read, and setup day done: the
// last paycheck, savings, wants, the rest in needs.
async function tracking(): Promise<Two> {
  const t = await both();
  setBankRules(t.db, RULES, '2026-10-01');
  t.keeper.reload();
  expect(t.keeper.bankDesk(t.bank).roles({ roles: PICKS, yes: true })).toMatchObject({ ok: true });
  await t.keeper.sync(t.bank);
  for (const setup of [{ lastPaycheck: '2026-09-25' }, { assign: { pot: 'savings' as const, amount: 400_000 } }, { assign: { pot: 'wants' as const, amount: 20_000 } }, { assign: { pot: 'needs' as const, rest: true as const } }]) {
    const answer = t.keeper.setup({ id: decision(), setup });
    if (!answer.ok) throw new Error(`setup day refused ${JSON.stringify(setup)}: ${answer.why}`);
  }
  const view = t.keeper.setupView();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error(`setup day is not ready: ${JSON.stringify(view)}`);
  const started = t.keeper.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: view.key });
  if (!started.ok) throw new Error(`tracking did not start: ${started.why}`);
  return t;
}

async function day(t: Two, date: string, items: () => void = () => undefined): Promise<void> {
  items();
  t.clock.now = noonInNewYork(date);
  await t.keeper.sync(t.bank).catch(() => undefined);
}

// Every alert worked out, oldest first.
const alerts = (t: Two) => readOutbox(t.db, 1_000).rows.slice().reverse();
const kinds = (t: Two): string[] => alerts(t).map((a) => a.kind);
const alertsOf = (t: Two, kind: string) => alerts(t).filter((a) => a.kind === kind);

function homeOf(t: Two) {
  const home = t.keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  return home;
}

describe('1.1 connecting the banks: two connections, Capital One then American Express', () => {
  it('1.1 "Connect a bank" is offered while fewer than two are connected; each asks first; a third is refused', async () => {
    const t = her();
    const desk = t.keeper.bankDesk(t.bank);
    expect(desk.view()).toMatchObject({ state: 'none' });
    expect(await desk.link({ mode: 'connect', yes: false })).toMatchObject({ ok: false, code: 'needs-yes' });
    await connect(t, t.first, FIRST_NAME);
    expect(desk.view()).toMatchObject({ state: 'connected', canConnect: true, banks: [{ bank: 1, name: FIRST_NAME, needsLogin: false }] });
    // The second asks first too: it uses another of the 10.
    expect(await desk.link({ mode: 'connect', yes: false })).toMatchObject({ ok: false, code: 'needs-yes' });
    await connect(t, t.second, SECOND_NAME);
    expect(desk.view()).toMatchObject({ canConnect: false, banks: [{ bank: 1, name: FIRST_NAME }, { bank: 2, name: SECOND_NAME }] });
    const third = await desk.link({ mode: 'connect', yes: true });
    expect(third).toMatchObject({ ok: false, code: 'connected-already' });
    expect(third.ok ? '' : third.why).toBe('Both banks are connected. The app never makes a third connection.');
    // A Link answer that comes anyway is not exchanged.
    const exchanges = t.calls(t.first, '/item/public_token/exchange') + t.calls(t.second, '/item/public_token/exchange');
    expect(await desk.connected(answerOf(t.second, SECOND_NAME))).toMatchObject({ ok: false, code: 'connected-already' });
    expect(t.calls(t.first, '/item/public_token/exchange') + t.calls(t.second, '/item/public_token/exchange')).toBe(exchanges);
  });

  it('1.1 each connection is kept the moment it is made, sealed, on the server only, each with its own key and item', async () => {
    const t = await both();
    const connections = connectionsOf(t.db);
    expect(connections.map((c) => [c.bank, c.itemId, c.institutionId, c.name])).toEqual([
      [1, t.first.itemId, t.first.institutionId, FIRST_NAME],
      [2, t.second.itemId, t.second.institutionId, SECOND_NAME],
    ]);
    for (const [c, fake] of [[connections[0], t.first], [connections[1], t.second]] as const) {
      expect(c?.sealedKey).not.toContain(fake.accessToken);
      expect(t.box.open(c?.sealedKey ?? '', fake.itemId)).toBe(fake.accessToken);
    }
    // Never in the log, and never on a screen.
    expect(JSON.stringify(t.lines)).not.toContain(t.second.accessToken);
    expect(JSON.stringify(t.keeper.bankDesk(t.bank).view())).not.toContain(t.second.accessToken);
  });

  it('1.1 the same bank twice is refused before Link\'s answer is swapped for a key: nothing is kept', async () => {
    const t = her();
    await connect(t, t.first, FIRST_NAME);
    const desk = t.keeper.bankDesk(t.bank);
    const before = t.calls(t.first, '/item/public_token/exchange');
    const again = await desk.connected({ publicToken: 'public-sandbox-made-up-again', institution: { id: t.first.institutionId, name: FIRST_NAME } });
    expect(again).toMatchObject({ ok: false, code: 'same-bank' });
    expect(again.ok ? '' : again.why).toBe(`${FIRST_NAME} is connected already. The app never connects the same bank twice.`);
    expect(t.calls(t.first, '/item/public_token/exchange')).toBe(before);
    expect(connectionsOf(t.db)).toHaveLength(1);
  });

  it('1.1 a Link answer that does not say which bank it is, is not swapped for a key in her setup', async () => {
    const t = her();
    await connect(t, t.first, FIRST_NAME);
    const answer = await t.keeper.bankDesk(t.bank).connected({ publicToken: t.second.publicToken });
    expect(answer).toMatchObject({ ok: false, code: 'bank-said-no' });
    expect(t.calls(t.second, '/item/public_token/exchange')).toBe(0);
    expect(connectionsOf(t.db)).toHaveLength(1);
  });

  it('1.1 one connection at a time: a second Link answer while one is being kept is refused', async () => {
    const t = her();
    const desk = t.keeper.bankDesk(t.bank);
    const one = desk.connected(answerOf(t.first, FIRST_NAME));
    expect(await desk.connected(answerOf(t.second, SECOND_NAME))).toMatchObject({ ok: false, code: 'busy' });
    expect(await one).toMatchObject({ ok: true });
    expect(connectionsOf(t.db)).toHaveLength(1);
  });

  it('1.1 her own database steps hold the second connection; upstream\'s one-row table keeps the first', async () => {
    const t = await both();
    expect(hasHerSteps(t.db)).toBe(true);
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM connection').get() as { n: number }).n).toBe(1);
    expect((t.db.prepare('SELECT item_id FROM her_connections').all() as { item_id: string }[]).map((r) => r.item_id)).toEqual([t.second.itemId]);
  });
});

describe('1.2 her four accounts, picked across both connections', () => {
  it('1.2 with one bank connected her second card is missing: the four cannot be picked, and nothing is read', async () => {
    const t = her();
    await connect(t, t.first, FIRST_NAME);
    const desk = t.keeper.bankDesk(t.bank);
    expect(readAccounts(t.db).map((a) => a.plaidAccountId).sort()).toEqual([ACCOUNT_IDS.checking, ACCOUNT_IDS.everyday, ACCOUNT_IDS.savings]);
    expect(desk.roles({ roles: PICKS, yes: true })).toMatchObject({ ok: false, code: 'not-roles' });
    await expect(t.keeper.sync(t.bank)).rejects.toThrow('not all picked');
    expect(t.calls(t.first, '/transactions/sync')).toBe(0);
  });

  it('1.2 with both connected, each of the four is picked once, from either connection; then both banks are read', async () => {
    const t = await both();
    const desk = t.keeper.bankDesk(t.bank);
    expect(desk.roles({ roles: PICKS, yes: true })).toMatchObject({ ok: true });
    expect(Object.fromEntries(readAccounts(t.db).map((a) => [a.role, a.plaidAccountId]))).toEqual(PICKS);
    // The screen reads the bank next (1.2): both banks.
    expect(await desk.read()).toMatchObject({ ok: true, said: 'The bank was read.' });
    expect(t.calls(t.first, '/transactions/sync')).toBeGreaterThan(0);
    expect(t.calls(t.second, '/transactions/sync')).toBeGreaterThan(0);
  });
});

describe('1.3 logging in to a bank again: per connection, the same connection', () => {
  it('1.3 the second bank\'s link key to log in again is made with its own key; nothing new is connected', async () => {
    const t = await both();
    const desk = t.keeper.bankDesk(t.bank);
    const before = t.calls(t.second, '/link/token/create');
    expect(await desk.link({ mode: 'login-again', bank: 2 })).toMatchObject({ ok: true });
    expect(t.calls(t.second, '/link/token/create')).toBe(before + 1);
    expect(t.second.calls.at(-1)?.body).toMatchObject({ access_token: t.second.accessToken });
    expect(t.first.calls.filter((c) => c.endpoint === '/link/token/create').every((c) => c.body['access_token'] !== t.second.accessToken)).toBe(true);
    expect(connectionsOf(t.db)).toHaveLength(2);
    // The first bank's, with the first's key.
    expect(await desk.link({ mode: 'login-again', bank: 1 })).toMatchObject({ ok: true });
    expect(t.first.calls.at(-1)?.body).toMatchObject({ access_token: t.first.accessToken });
  });

  it('1.3 logging in again to a bank that is not connected is refused, and nothing is asked of Plaid', async () => {
    const t = her();
    await connect(t, t.first, FIRST_NAME);
    const calls = t.first.calls.length + t.second.calls.length;
    expect(await t.keeper.bankDesk(t.bank).link({ mode: 'login-again', bank: 2 })).toMatchObject({ ok: false, code: 'not-connected' });
    expect(t.first.calls.length + t.second.calls.length).toBe(calls);
  });

  it('1.3 after logging in again to the second bank, it is read again and its new login is cleared; the first is untouched', async () => {
    const t = await tracking();
    t.second.needsLogin = true;
    await day(t, '2026-10-02');
    expect(connectionsOf(t.db).map((c) => c.needsLogin)).toEqual([false, true]);
    t.second.needsLogin = false;
    expect(await t.keeper.bankDesk(t.bank).read({ loggedInAgain: true, bank: 2 })).toMatchObject({ ok: true });
    expect(connectionsOf(t.db).map((c) => c.needsLogin)).toEqual([false, false]);
  });
});

describe('section 2: each sync reads both banks', () => {
  it('section 2 one sync reads both banks, and counts what each sent', async () => {
    const t = await tracking();
    await day(t, '2026-10-02', () => {
      t.first.addPosted({ id: 'grocery-e', account: ACCOUNT_IDS.everyday, amount: 3_210, date: '2026-10-02', description: 'MADE UP GROCERY' });
      t.second.addPosted({ id: 'cafe-s', account: ACCOUNT_IDS.second, amount: 875, date: '2026-10-02', description: 'MADE UP CAFE' });
    });
    expect(t.keeper.book()?.purchases().map((p) => p.id).sort()).toEqual(['cafe-s', 'grocery-e']);
    expect(homeOf(t).safeToSpend.shown).toBe(true);
  });

  it('section 2 a sync where one bank fails keeps what the other read; the failed one is tried again at the next time', async () => {
    const t = await tracking();
    t.second.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? { status: 400, body: { error_type: 'INSTITUTION_ERROR', error_code: 'INSTITUTION_DOWN', error_message: 'made-up', display_message: null, request_id: 'r' } } : undefined);
    t.first.addPosted({ id: 'grocery-e', account: ACCOUNT_IDS.everyday, amount: 3_210, date: '2026-10-02', description: 'MADE UP GROCERY' });
    t.second.addPosted({ id: 'cafe-s', account: ACCOUNT_IDS.second, amount: 875, date: '2026-10-02', description: 'MADE UP CAFE' });
    t.clock.now = noonInNewYork('2026-10-02');
    await expect(t.keeper.sync(t.bank)).rejects.toThrow();
    expect(t.keeper.book()?.purchases().map((p) => p.id)).toEqual(['grocery-e']);
    t.second.beforeCall = undefined;
    await day(t, '2026-10-02');
    expect(t.keeper.book()?.purchases().map((p) => p.id).sort()).toEqual(['cafe-s', 'grocery-e']);
    expect(homeOf(t).safeToSpend.shown).toBe(true);
  });
});

describe('section 2 webhooks: each names its connection by item_id, and syncs that bank only', () => {
  it("section 2 Plaid's webhook for one bank syncs that bank: the other bank is not asked", async () => {
    const t = await tracking();
    const firstReads = t.calls(t.first, '/transactions/sync');
    t.second.addPosted({ id: 'cafe-s', account: ACCOUNT_IDS.second, amount: 875, date: '2026-10-02', description: 'MADE UP CAFE' });
    t.clock.now = noonInNewYork('2026-10-02');
    await t.keeper.syncItems(t.bank, [t.second.itemId]);
    expect(t.calls(t.first, '/transactions/sync')).toBe(firstReads);
    expect(t.keeper.book()?.purchases().map((p) => p.id)).toEqual(['cafe-s']);
    // An item that is neither connection's syncs nothing.
    const reads = t.calls(t.first, '/transactions/sync') + t.calls(t.second, '/transactions/sync');
    await t.keeper.syncItems(t.bank, ['item-made-up-other']);
    expect(t.calls(t.first, '/transactions/sync') + t.calls(t.second, '/transactions/sync')).toBe(reads);
  });

  it('section 2 the desk takes a webhook for either connection and syncs the banks it named; one for neither is refused', async () => {
    const time = { now: new Date('2026-10-15T16:00:00Z') };
    const clock = new FakeClock(time);
    const signer = await FakeWebhookSigner.make();
    const synced: (readonly string[])[] = [];
    const desk = new WebhookDesk({
      keys: new WebhookKeys({ source: new FakeKeySource().add(signer), now: () => time.now, log: memoryLog([]) }),
      itemId: () => 'item-made-up-a',
      itemIds: () => ['item-made-up-a', 'item-made-up-b'],
      sync: async () => {
        synced.push(['every bank']);
      },
      syncItems: async (ids) => {
        synced.push(ids);
      },
      onItsWay: () => null,
      clock,
      now: () => time.now,
      log: memoryLog([]),
    });
    const send = async (item: string): Promise<number> => {
      const signed = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', {}, item), time.now);
      return (await desk.receive({ headers: { 'plaid-verification': signed.header, 'content-type': 'application/json' }, body: signed.body })).status;
    };
    expect(await send('item-made-up-b')).toBe(200);
    await clock.advance(GATHER_MS, () => desk.idle());
    expect(synced).toEqual([['item-made-up-b']]);
    expect(await send('item-made-up-other')).toBe(403);
    // Both in one burst: one sync, of both.
    expect(await send('item-made-up-a')).toBe(200);
    expect(await send('item-made-up-b')).toBe(200);
    await clock.advance(GATHER_MS, () => desk.idle());
    expect(synced).toEqual([['item-made-up-b'], ['item-made-up-a', 'item-made-up-b']]);
    // Each burst names only its own.
    expect(await send('item-made-up-a')).toBe(200);
    await clock.advance(GATHER_MS, () => desk.idle());
    expect(synced.at(-1)).toEqual(['item-made-up-a']);
  });

  it('section 2 HB11 pointing the webhooks at the hosted server points both connections, the first first', async () => {
    const t = await both();
    const hosted = `https://budget-made-up.example${WEBHOOK_PATH}`;
    const answer = await pointWebhooks({ db: t.db, plaid: t.bank.plaid, box: t.box, address: hosted, log: memoryLog([]) });
    expect(answer).toEqual({ ok: true, address: hosted, itemId: t.first.itemId, itemIds: [t.first.itemId, t.second.itemId] });
    expect([t.first.webhook, t.second.webhook]).toEqual([hosted, hosted]);
  });
});

describe('section 2: either bank can be the one that fails', () => {
  it('section 2 the first bank failing keeps what the second read, and the second is still read', async () => {
    const t = await tracking();
    t.first.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? { status: 400, body: { error_type: 'INSTITUTION_ERROR', error_code: 'INSTITUTION_DOWN', error_message: 'made-up', display_message: null, request_id: 'r' } } : undefined);
    t.second.addPosted({ id: 'cafe-s', account: ACCOUNT_IDS.second, amount: 875, date: '2026-10-02', description: 'MADE UP CAFE' });
    t.clock.now = noonInNewYork('2026-10-02');
    await expect(t.keeper.sync(t.bank)).rejects.toThrow();
    expect(t.keeper.book()?.purchases().map((p) => p.id)).toEqual(['cafe-s']);
    expect(connectionsOf(t.db).map((c) => c.failingSince !== null)).toEqual([true, false]);
  });
});

describe('14.1 setup day waits for the history of both banks', () => {
  it("14.1 while Plaid is still sending the second bank's history, setup day is not ready; once it has, it is", async () => {
    const t = await both();
    t.second.historyComplete = false;
    setBankRules(t.db, RULES, '2026-10-01');
    t.keeper.reload();
    expect(t.keeper.bankDesk(t.bank).roles({ roles: PICKS, yes: true })).toMatchObject({ ok: true });
    await t.keeper.sync(t.bank);
    const waiting = t.keeper.setupView();
    expect(waiting.state === 'not-set-up' && waiting.ready).toBe(false);
    expect(t.keeper.setup({ id: decision(), setup: { lastPaycheck: '2026-09-25' } })).toMatchObject({ ok: false });
    t.second.historyComplete = true;
    t.second.addPosted({ id: 'cafe-old', account: ACCOUNT_IDS.second, amount: 875, date: '2026-09-28', description: 'MADE UP CAFE' });
    await t.keeper.sync(t.bank);
    expect(t.keeper.setup({ id: decision(), setup: { lastPaycheck: '2026-09-25' } })).toMatchObject({ ok: true });
  });
});

describe('12.3 the check uses each bank\'s latest good read, and waits while one cannot be read', () => {
  const failing = { status: 400, body: { error_type: 'INSTITUTION_ERROR', error_code: 'INSTITUTION_NOT_RESPONDING', error_message: 'made-up', display_message: null, request_id: 'r' } };

  it('12.3 one bank read and the other not: a difference is "still catching up", and stays so past 12 hours; nothing is told', async () => {
    const t = await tracking();
    t.second.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? failing : undefined);
    t.first.drift(ACCOUNT_IDS.checking, -1_000);
    await day(t, '2026-10-02');
    let safe = homeOf(t).safeToSpend;
    if (safe.shown || safe.why !== 'totals-do-not-match') throw new Error('the totals should not match');
    expect(safe.catchingUp).toBe(true);
    // A day on, the second bank still failing: still waiting, and no alert.
    t.clock.now = new Date(t.clock.now.getTime() + 26 * 3_600_000);
    await t.keeper.sync(t.bank).catch(() => undefined);
    t.keeper.checkAlerts();
    safe = homeOf(t).safeToSpend;
    expect(!safe.shown && safe.why === 'totals-do-not-match' && safe.catchingUp).toBe(true);
    expect(kinds(t)).not.toContain('totals-mismatch');
    expect(t.keeper.mismatchSince()).toBeNull();
  });

  it('12.3 once both banks are read again, a difference that is still there counts its 12 hours from then, and is told after them', async () => {
    const t = await tracking();
    t.second.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? failing : undefined);
    t.first.drift(ACCOUNT_IDS.checking, -1_000);
    await day(t, '2026-10-02');
    t.second.beforeCall = undefined;
    t.clock.now = new Date(t.clock.now.getTime() + 3_600_000);
    await t.keeper.sync(t.bank);
    const since = t.keeper.mismatchSince();
    expect(since).toBe(t.clock.now.toISOString());
    t.clock.now = new Date(t.clock.now.getTime() + 11 * 3_600_000);
    t.keeper.checkAlerts();
    expect(kinds(t)).not.toContain('totals-mismatch');
    t.clock.now = new Date(t.clock.now.getTime() + 3_600_000);
    t.keeper.checkAlerts();
    expect(kinds(t)).toContain('totals-mismatch');
  });

  it('12.3 a difference already told is not told again each evening while the check waits for a bank', async () => {
    const t = await tracking();
    t.first.drift(ACCOUNT_IDS.checking, -1_000);
    await day(t, '2026-10-02');
    t.clock.now = new Date(t.clock.now.getTime() + 13 * 3_600_000);
    t.keeper.checkAlerts();
    expect(kinds(t).filter((k) => k === 'totals-mismatch')).toHaveLength(1);
    t.second.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? failing : undefined);
    await t.keeper.sync(t.bank).catch(() => undefined);
    // The evenings while it waits: no "still do not match".
    for (const evening of ['2026-10-04T00:30:00Z', '2026-10-05T00:30:00Z']) {
      t.clock.now = new Date(evening);
      t.keeper.checkAlerts();
    }
    expect(kinds(t).filter((k) => k === 'totals-mismatch')).toHaveLength(1);
  });

  it('12.3 the bank side adds up both banks\' latest good reads: the second bank\'s card as it was last read', async () => {
    const t = await tracking();
    t.second.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? failing : undefined);
    // The card moved at its bank, which cannot be read: the check still has its last read.
    t.second.drift(ACCOUNT_IDS.second, 500);
    await day(t, '2026-10-02');
    expect(homeOf(t).safeToSpend.shown).toBe(true);
  });
});

describe('0.5 a bank that cannot be read: the last safe to spend both banks backed up, greyed, naming the bank', () => {
  it('0.5 the second bank wants a new login: Home greys the last checked safe to spend and says which bank', async () => {
    const t = await tracking();
    await day(t, '2026-10-02');
    expect(homeOf(t).safeToSpend.shown).toBe(true);
    t.second.needsLogin = true;
    await day(t, '2026-10-03');
    const home = homeOf(t);
    expect(home.safeToSpend).toMatchObject({ shown: false, why: 'bank-not-read', notRead: [SECOND_NAME] });
    expect(home.safeToSpend.shown === false && home.safeToSpend.why === 'bank-not-read' ? home.safeToSpend.lastChecked : null).not.toBeNull();
    expect(home.attention).toContainEqual({ kind: 'bank-login', bank: 2, name: SECOND_NAME });
    expect(home.attention.filter((a) => a.kind === 'bank-login')).toHaveLength(1);
  });

  it('0.5 both banks want a new login: both are named, the first first', async () => {
    const t = await tracking();
    await day(t, '2026-10-02');
    t.first.needsLogin = true;
    t.second.needsLogin = true;
    await day(t, '2026-10-03');
    const home = homeOf(t);
    expect(home.safeToSpend).toMatchObject({ shown: false, why: 'bank-not-read', notRead: [FIRST_NAME, SECOND_NAME] });
    expect(home.attention.filter((a) => a.kind === 'bank-login')).toEqual([
      { kind: 'bank-login', bank: 1, name: FIRST_NAME },
      { kind: 'bank-login', bank: 2, name: SECOND_NAME },
    ]);
  });
});

describe('10.5, 10.7, 10.13: for each connection, and each alert names the bank', () => {
  it('10.5 the second bank wants a new login: told once, naming it; the first bank\'s is its own', async () => {
    const t = await tracking();
    t.second.needsLogin = true;
    await day(t, '2026-10-02');
    t.keeper.checkAlerts();
    const logins = alertsOf(t, 'bank-login');
    expect(logins.map((a) => a.title)).toEqual([`Log in to ${SECOND_NAME} again`]);
    t.first.needsLogin = true;
    await day(t, '2026-10-03');
    t.keeper.checkAlerts();
    expect(alertsOf(t, 'bank-login').map((a) => a.title)).toEqual([`Log in to ${SECOND_NAME} again`, `Log in to ${FIRST_NAME} again`]);
  });

  it('10.7 the second bank not read for 24 hours is told, naming it, while the first is read', async () => {
    const t = await tracking();
    t.second.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? { status: 400, body: { error_type: 'INSTITUTION_ERROR', error_code: 'INSTITUTION_DOWN', error_message: 'made-up', display_message: null, request_id: 'r' } } : undefined);
    await day(t, '2026-10-02');
    t.clock.now = new Date(t.clock.now.getTime() + 25 * 3_600_000);
    await t.keeper.sync(t.bank).catch(() => undefined);
    t.keeper.checkAlerts();
    const notRead = alertsOf(t, 'bank-not-read');
    expect(notRead.map((a) => a.title)).toEqual([`${SECOND_NAME} has not been read for 24 hours`]);
  });

  it('10.13 each bank\'s permission end date is its own: told 7 days before, naming the bank', async () => {
    const t = await tracking();
    t.second.consentExpiration = '2026-10-20T16:00:00Z';
    await day(t, '2026-10-02');
    const desk = t.keeper.bankDesk(t.bank).view();
    expect(desk).toMatchObject({ banks: [{ bank: 1, permissionEnds: null }, { bank: 2, permissionEnds: '2026-10-20' }] });
    t.clock.now = new Date('2026-10-13T16:00:00Z');
    t.keeper.checkAlerts();
    t.clock.now = new Date('2026-10-14T01:00:00Z');
    t.keeper.checkAlerts();
    const ends = alertsOf(t, 'bank-permission');
    // Its title as kept; the days left are said when it is sent (10.13).
    expect(ends.map((a) => [a.title, a.facts])).toEqual([[`Log in to ${SECOND_NAME} again soon`, { kind: 'bank-permission', ends: '2026-10-20', bank: 2, name: SECOND_NAME }]]);
  });
});

describe('10.9 and the timer, for each bank', () => {
  it("10.9 evenings missed while the server was down: each bank's permission alert is a kind of its own, and both are told", async () => {
    const t = await tracking();
    t.first.consentExpiration = '2026-10-20T16:00:00Z';
    t.second.consentExpiration = '2026-10-21T16:00:00Z';
    await day(t, '2026-10-02');
    t.keeper.checkAlerts();
    // Down from the 2nd to the 15th: the evenings are looked at all at once.
    t.clock.now = new Date('2026-10-15T16:00:00Z');
    t.keeper.checkAlerts();
    expect(alertsOf(t, 'bank-permission').map((a) => a.facts)).toEqual([
      { kind: 'bank-permission', ends: '2026-10-20', name: FIRST_NAME },
      { kind: 'bank-permission', ends: '2026-10-21', bank: 2, name: SECOND_NAME },
    ]);
  });

  it("10.7 the alert timer wakes when the second bank's last good read becomes a day old, though the first is read", async () => {
    const t = await tracking();
    t.second.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? { status: 400, body: { error_type: 'INSTITUTION_ERROR', error_code: 'INSTITUTION_DOWN', error_message: 'made-up', display_message: null, request_id: 'r' } } : undefined);
    t.clock.now = new Date('2026-10-02T10:00:00Z');
    await t.keeper.sync(t.bank).catch(() => undefined);
    t.keeper.checkAlerts();
    // The second bank was last read when tracking began, Oct 1 at 16:00 UTC.
    expect(t.keeper.nextDueIn()).toBe(Date.parse('2026-10-02T16:00:00Z') - t.clock.now.getTime());
  });
});

describe('0.7 the status page shows each connection', () => {
  it('0.7 each bank\'s last read and last sync, by name', async () => {
    const t = await tracking();
    t.second.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? { status: 400, body: { error_type: 'INSTITUTION_ERROR', error_code: 'INSTITUTION_DOWN', error_message: 'made-up', display_message: null, request_id: 'r' } } : undefined);
    await day(t, '2026-10-02');
    // The status page is for books being served.
    const dir = mkdtempSync(join(tmpdir(), 'budget-two-banks-'));
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><title>app</title>');
    const server: Server = t.keeper.server(join(dir, 'dist'), () => 'http://localhost');
    let status;
    try {
      status = t.keeper.statusView();
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(status.banks?.map((b) => [b.bank, b.name, b.lastSync?.result])).toEqual([
      [1, FIRST_NAME, 'nothing-new'],
      [2, SECOND_NAME, 'failed'],
    ]);
    // In her home time zone, as the rest of the page.
    expect(status.banks?.[0]?.lastRead).toBe('2026-10-02T12:00:00-04:00');
    expect(status.banks?.[1]?.lastRead).toBe('2026-10-01T12:00:00-04:00');
  });
});

describe('her database steps: step 2, her second connection', () => {
  it('her steps: from empty, and from a database that has only her step 1, to the last step; never twice', () => {
    const db = openDatabase(':memory:');
    open.push(db);
    migrateHer(db);
    expect((db.prepare('SELECT version FROM her_schema').get() as { version: number }).version).toBe(HER_SCHEMA_VERSION);
    expect(HER_SCHEMA_VERSION).toBe(2);
    const old = openDatabase(':memory:');
    open.push(old);
    old.exec('CREATE TABLE her_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
    old.exec("CREATE TABLE her_account_roles (plaid_account_id TEXT PRIMARY KEY REFERENCES accounts (plaid_account_id), role TEXT NOT NULL UNIQUE CHECK (role IN ('second-card')))");
    old.exec('INSERT INTO her_schema (id, version) VALUES (1, 1)');
    migrateHer(old);
    migrateHer(old);
    expect((old.prepare('SELECT version FROM her_schema').get() as { version: number }).version).toBe(2);
    expect(old.prepare("SELECT 1 FROM sqlite_master WHERE name = 'her_connections'").get()).toBeDefined();
  });

  it('her steps: upstream\'s setup never gets them, and connects one bank only', async () => {
    const db = openDatabase(':memory:');
    open.push(db);
    const fake = new FakePlaid([...firstAccounts(), { id: ACCOUNT_IDS.old, name: 'Made-up Old Card', mask: '4444', kind: 'credit card', posted: 300_000, limit: 400_000 }]);
    const log = memoryLog([]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const keeper = Keeper.open({ db, now: () => noonInNewYork('2026-10-01'), log });
    const desk = keeper.bankDesk({ plaid, box: new TokenBox(TOKEN_KEY), log, pageSize: 3 });
    await desk.link({ mode: 'connect', yes: true });
    expect(await desk.connected({ publicToken: fake.publicToken, institution: { id: fake.institutionId, name: FIRST_NAME } })).toMatchObject({ ok: true });
    expect(hasHerSteps(db)).toBe(false);
    const view = desk.view();
    expect(view).not.toHaveProperty('banks');
    expect(view).not.toHaveProperty('canConnect');
    expect(await desk.link({ mode: 'connect', yes: true })).toMatchObject({ ok: false, code: 'connected-already' });
  });
});

describe('a restart keeps both connections and where each bank stands', () => {
  it('restart: the books open again with both connections, the second still failing', async () => {
    const t = await tracking();
    t.second.beforeCall = (endpoint) => (endpoint === '/transactions/sync' ? { status: 400, body: { error_type: 'INSTITUTION_ERROR', error_code: 'INSTITUTION_DOWN', error_message: 'made-up', display_message: null, request_id: 'r' } } : undefined);
    t.first.drift(ACCOUNT_IDS.checking, -1_000);
    await day(t, '2026-10-02');
    t.keeper = Keeper.open({ db: t.db, now: () => t.clock.now, log: memoryLog([]), start: HER_START });
    expect(connectionsOf(t.db).map((c) => [c.bank, c.failingSince !== null])).toEqual([
      [1, false],
      [2, true],
    ]);
    const safe = homeOf(t).safeToSpend;
    expect(!safe.shown && safe.why === 'totals-do-not-match' && safe.catchingUp).toBe(true);
  });
});

describe("1.1 and 1.3 over HTTP: her Bank screen's requests, parsed strictly", () => {
  it("1.1 Link's answer with the bank it names is taken; a bank that is not one, or anything more, is refused before it reaches the bank", async () => {
    const t = her();
    const dir = mkdtempSync(join(tmpdir(), 'budget-two-banks-http-'));
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>app</title></head><body></body></html>');
    let origin = 'http://localhost:0';
    const server: Server = t.keeper.server(join(dir, 'dist'), () => origin, undefined, { bank: t.bank });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    origin = `http://localhost:${port}`;
    const r = { port, origin } as Running;
    const cookie = loginForTests(t.db, t.clock.now);
    try {
      const bad: [string, unknown][] = [
        ['/api/bank/connected', { publicToken: t.first.publicToken, institution: { id: 'not-an-institution', name: FIRST_NAME } }],
        ['/api/bank/connected', { publicToken: t.first.publicToken, institution: { id: t.first.institutionId, name: '  ' } }],
        ['/api/bank/connected', { publicToken: t.first.publicToken, institution: { id: t.first.institutionId, name: 'x'.repeat(101) } }],
        ['/api/bank/connected', { publicToken: t.first.publicToken, institution: { id: t.first.institutionId, name: FIRST_NAME, more: 1 } }],
        ['/api/bank/connected', { publicToken: t.first.publicToken, institution: null }],
        ['/api/bank/link', { mode: 'login-again', bank: 3 }],
        ['/api/bank/read', { loggedInAgain: true, bank: 0 }],
      ];
      for (const [path, body] of bad) expect((await ask(r, 'POST', path, { cookie, body })).status, `${path} ${JSON.stringify(body)}`).toBe(400);
      expect(t.first.calls.filter((c) => c.endpoint === '/item/public_token/exchange')).toHaveLength(0);
      await ask(r, 'POST', '/api/bank/link', { cookie, body: { mode: 'connect', yes: true } });
      const connected = await ask(r, 'POST', '/api/bank/connected', { cookie, body: { publicToken: t.first.publicToken, institution: { id: t.first.institutionId, name: ` ${FIRST_NAME} ` } } });
      expect(connected.status).toBe(200);
      expect(connectionsOf(t.db).map((c) => c.name)).toEqual([FIRST_NAME]);
      expect((await ask(r, 'POST', '/api/bank/link', { cookie, body: { mode: 'login-again', bank: 1 } })).status).toBe(200);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('1.1 the test bank, without screens: her second bank is connected second', () => {
  it('1.1 the second made-up bank cannot be connected before the first, nor twice', async () => {
    const t = her();
    const input = { db: t.db, plaid: t.bank.plaid, box: t.box, log: memoryLog([]), today: '2026-10-01', institutionId: t.second.institutionId, bank: 2 as const, name: SECOND_NAME };
    await expect(connectTestBank(input)).rejects.toThrow('her first bank is connected first');
    await connectTestBank({ ...input, institutionId: t.first.institutionId, bank: 1, name: FIRST_NAME });
    await connectTestBank(input);
    await expect(connectTestBank(input)).rejects.toThrow('her second bank is connected already');
    expect(connectionsOf(t.db).map((c) => [c.bank, c.itemId, c.name])).toEqual([
      [1, t.first.itemId, FIRST_NAME],
      [2, t.second.itemId, SECOND_NAME],
    ]);
  });
});

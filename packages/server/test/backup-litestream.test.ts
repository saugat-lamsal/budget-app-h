import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupWatch } from '../src/backup/backup-watch.js';
import { restoreCheck } from '../src/backup/restore-check.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { restoreIfMissing } from '../src/serve/start.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeR2 } from './fake-r2.js';
import { servedAt, stop } from './hosted-harness.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { CAN_RESTORE, CONFIG, backupOf, copied, litestreamBin, replicate, until, type Replicating } from './litestream-harness.js';
import { SLOW } from './slow.js';

// Phase 6, the backups, with the real Litestream (the image's version) and
// the project's own litestream.yml, against the stand-in for R2 on this
// computer (fake-r2.ts: every request must carry the bucket's signature).
// The books are a real server's, with a history: setup day, syncs, answers.
// Every name, key and number is made up.

const cleanUp: (() => Promise<void> | void)[] = [];
// Stopping Litestream copies what it has first, which can take a while.
afterEach(async () => {
  for (const done of cleanUp.splice(0).reverse()) await done();
}, 60_000);

async function standIn(): Promise<FakeR2> {
  const r2 = await FakeR2.start();
  cleanUp.push(() => r2.close());
  return r2;
}

async function busyLife(): Promise<Life> {
  const life = await lifeInAFile();
  cleanUp.push(() => life.done());
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-03');
  life.h.fake.addPosted({ id: 'cafe-1', account: ACCOUNT_IDS.everyday, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
  await life.sync();
  return life;
}

function watch(running: Replicating): Replicating {
  cleanUp.push(() => running.stop());
  return running;
}

// Every table, every row: two databases that are the same books.
function everything(db: Db): Record<string, unknown[]> {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]));
}

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'budget-restore-'));
  cleanUp.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Each waits for Litestream in real time: a few seconds, longer on a busy machine.
describe('Phase 6 Litestream copies the books to the bucket', { timeout: 60_000 }, () => {
  it('Phase 6 as they change: the books, then each change within seconds, every request signed with the bucket\'s key', async () => {
    const r2 = await standIn();
    const life = await busyLife();
    watch(replicate(life.path, backupOf(r2)));
    await copied(r2, 0);
    expect(r2.keys().length).toBeGreaterThan(0);
    for (const key of r2.keys()) expect(key).toMatch(/^budget-h\/\d{4}\/[0-9a-f]{16}-[0-9a-f]{16}\.ltx$/);
    // A change: a new purchase read by a sync.
    const before = r2.requests.length;
    const keys = r2.keys().length;
    life.h.fake.addPosted({ id: 'cafe-2', account: ACCOUNT_IDS.everyday, amount: 2_100, date: '2026-10-03', description: 'MADE UP DINER' });
    await life.sync();
    await copied(r2, before);
    expect(r2.keys().length).toBeGreaterThan(keys);
    expect(r2.requests.filter((r) => r.status === 403)).toEqual([]);
  });

  it('Phase 6 with the wrong key the bucket takes nothing, and Litestream says so in its log', async () => {
    const r2 = await standIn();
    const life = await busyLife();
    const running = watch(replicate(life.path, backupOf(r2, { R2_SECRET_ACCESS_KEY: 'not-the-key' })));
    await until('a request to be refused', () => r2.requests.some((r) => r.status === 403));
    await until('Litestream to say so', () => /SignatureDoesNotMatch|403/.test(running.output()));
    expect(r2.keys()).toEqual([]);
  });

  it('Phase 6 while the bucket cannot be reached nothing is lost: what changed meanwhile is copied once it can be', async () => {
    const r2 = await standIn();
    const life = await busyLife();
    watch(replicate(life.path, backupOf(r2)));
    await copied(r2, 0);
    const keys = r2.keys();
    r2.failing = 503;
    life.h.fake.addPosted({ id: 'cafe-3', account: ACCOUNT_IDS.everyday, amount: 3_300, date: '2026-10-03', description: 'MADE UP BAKERY' });
    await life.sync();
    const tried = r2.requests.length;
    await until('Litestream to try', () => r2.requests.slice(tried).some((r) => r.status === 503));
    expect(r2.keys()).toEqual(keys);
    const back = r2.requests.length;
    r2.failing = null;
    await copied(r2, back);
    expect(r2.keys().length).toBeGreaterThan(keys.length);
  });
});

// QUESTIONS.md A43, option 5, with the real Litestream and the real server:
// the heartbeat comes to the server's beat address on this computer while
// every copy goes through, also while nothing in the books changes (a quiet
// night), and stops once a change cannot be copied. Litestream beats at most
// once a minute, so this takes four or five minutes of real time: it runs in
// the slow run only (npm run test:slow; CLAUDE.md, "Two test runs").
describe.runIf(SLOW)('A43 Litestream\'s heartbeat', { timeout: 420_000 }, () => {
  it('A43 reaches the server while every copy goes through, also while nothing changes, and stops once a change cannot be copied', async () => {
    const r2 = await standIn();
    const beats = new BackupWatch(Date.now);
    const r = await servedAt(undefined, true, beats);
    cleanUp.push(() => stop(r));
    watch(replicate(r.life.path, backupOf(r2), { PORT: String(r.port) }));
    await copied(r2, 0);
    await until('the first beat', () => beats.lastBeat !== null, 100_000);
    const first = beats.lastBeat ?? 0;
    // Nothing changes in the books, and it still beats.
    await until('a beat while nothing changes', () => (beats.lastBeat ?? 0) > first, 100_000);
    expect(beats.healthy()).toBe(true);
    // The bucket cannot be reached, and a change waits to be copied.
    r2.failing = 503;
    r.life.h.fake.addPosted({ id: 'cafe-9', account: ACCOUNT_IDS.everyday, amount: 990, date: '2026-10-03', description: 'MADE UP TEA' });
    await r.life.sync();
    const tried = r2.requests.length;
    await until('Litestream to try', () => r2.requests.slice(tried).some((req) => req.status === 503));
    const failedAt = Date.now();
    // Litestream beats while its last good copy is less than a minute old, and
    // looks every 15 s, so one more beat can come up to about 75 s after the
    // copies stop (seen at 59 s on a busy PC). None after that: two more
    // minutes would have had two beats.
    await new Promise((resolve) => setTimeout(resolve, 150_000));
    expect(beats.lastBeat ?? 0).toBeLessThan(failedAt + 90_000);
    // So that stopping Litestream can copy what it has.
    r2.failing = null;
  });
});

describe.runIf(CAN_RESTORE)('Phase 6 the restore check (Linux and macOS: Litestream cannot rebuild a database on Windows)', { timeout: 120_000 }, () => {
  async function backedUp(): Promise<{ readonly r2: FakeR2; readonly life: Life; readonly running: Replicating }> {
    const r2 = await standIn();
    const life = await busyLife();
    const running = watch(replicate(life.path, backupOf(r2)));
    await copied(r2, 0);
    return { r2, life, running };
  }

  it('Phase 6 rebuilds the books from the backup into a new file, the same to the last row, and checks them: whole, and every event replaying to its totals (0.6)', async () => {
    const { r2, life } = await backedUp();
    const out = join(folder(), 'restored.sqlite');
    const report = await restoreCheck({ backup: backupOf(r2), db: life.path, out, bin: litestreamBin(), config: CONFIG });
    expect(report.ok).toBe(true);
    const events = (life.h.db.prepare('SELECT COUNT(*) AS n FROM book_events').get() as { n: number }).n;
    expect(events).toBeGreaterThan(3);
    expect(report.lines).toEqual([
      `Rebuilt the books from the backup into ${out}.`,
      "The file is whole (SQLite's integrity check).",
      `History: ${events} events, the last on Oct 3, 2026.`,
      'Every event replays to the totals saved with it (0.6).',
      'The backup works.',
    ]);
    const restored = openDatabase(out);
    try {
      expect(everything(restored)).toEqual(everything(life.h.db));
    } finally {
      restored.close();
    }
    // The live books were not touched, and nothing was asked of the bucket but to read.
    expect(r2.requests.filter((r) => r.operation === 'PutObject' || r.operation.startsWith('Delete')).every((r) => r.status === 200)).toBe(true);
  });

  it('Phase 6 never into a file that is there already: nothing is changed', async () => {
    const { r2, life } = await backedUp();
    const out = join(folder(), 'there.sqlite');
    writeFileSync(out, 'made up');
    const report = await restoreCheck({ backup: backupOf(r2), db: life.path, out, bin: litestreamBin(), config: CONFIG });
    expect(report).toEqual({ ok: false, lines: [`${out} is there already. Nothing was changed: the check rebuilds into a new file only.`] });
  });

  it('Phase 6 an empty bucket, a bucket that cannot be reached, or a spoiled backup: not ok, saying why', async () => {
    const r2 = await standIn();
    const life = await busyLife();
    const empty = await restoreCheck({ backup: backupOf(r2), db: life.path, out: join(folder(), 'a.sqlite'), bin: litestreamBin(), config: CONFIG });
    expect(empty.ok).toBe(false);
    expect(empty.lines[0]).toBe('The books could not be rebuilt from the backup.');
    expect(empty.lines[1]).toMatch(/^Litestream said: /);
    const running = watch(replicate(life.path, backupOf(r2)));
    await copied(r2, 0);
    await running.stop();
    r2.failing = 503;
    const down = await restoreCheck({ backup: backupOf(r2), db: life.path, out: join(folder(), 'b.sqlite'), bin: litestreamBin(), config: CONFIG, limitMs: 20_000 });
    expect(down.ok).toBe(false);
    expect(down.lines[0]).toBe('The books could not be rebuilt from the backup.');
    r2.failing = null;
    for (const [key, object] of r2.objects) {
      const spoiled = Buffer.from(object.body);
      for (let i = Math.floor(spoiled.length / 2); i < spoiled.length; i += 7) spoiled[i] = (spoiled[i] ?? 0) ^ 0xff;
      r2.objects.set(key, { ...object, body: spoiled });
    }
    const spoiled = await restoreCheck({ backup: backupOf(r2), db: life.path, out: join(folder(), 'c.sqlite'), bin: litestreamBin(), config: CONFIG, limitMs: 20_000 });
    expect(spoiled.ok).toBe(false);
  });

  it('Phase 6 0.6 books whose history no longer replays to the totals saved with it: the check says so, as the server would on starting', async () => {
    const { r2, life } = await backedUp();
    const before = r2.requests.length;
    const seq = (life.h.db.prepare("SELECT MAX(seq) AS seq FROM book_events WHERE totals IS NOT NULL AND totals != 'null'").get() as { seq: number }).seq;
    const totals = JSON.parse((life.h.db.prepare('SELECT totals FROM book_events WHERE seq = ?').get(seq) as { totals: string }).totals) as { needs: number };
    life.h.db.prepare('UPDATE book_events SET totals = ? WHERE seq = ?').run(JSON.stringify({ ...totals, needs: totals.needs + 1 }), seq);
    await copied(r2, before);
    const report = await restoreCheck({ backup: backupOf(r2), db: life.path, out: join(folder(), 'd.sqlite'), bin: litestreamBin(), config: CONFIG });
    expect(report.ok).toBe(false);
    expect(report.lines.at(-1)).toBe(`1 event replays to other totals than the ones saved with it, from event ${seq} on (0.6). The server would not start on these books: see npm run replay-check.`);
  });

  it('Phase 6 on starting, books missing from the volume are rebuilt from the backup; with no backup they start empty; books there are left alone; a backup that cannot be read stops it', async () => {
    const { r2, life, running } = await backedUp();
    await running.stop();
    const dir = folder();
    // A new volume: the books rebuilt, the same as the backup's.
    const lost = join(dir, 'lost', 'budget.sqlite');
    expect(await restoreIfMissing(lost, backupOf(r2), litestreamBin(), CONFIG)).toEqual({ kind: 'restored' });
    const restored = openDatabase(lost);
    try {
      expect(everything(restored)).toEqual(everything(life.h.db));
    } finally {
      restored.close();
    }
    // Books there: nothing is asked of the bucket.
    const asked = r2.requests.length;
    expect(await restoreIfMissing(lost, backupOf(r2), litestreamBin(), CONFIG)).toEqual({ kind: 'there' });
    expect(r2.requests.length).toBe(asked);
    // The very first start: no backup yet, nothing made.
    const empty = await standIn();
    const first = join(dir, 'first', 'budget.sqlite');
    expect(await restoreIfMissing(first, backupOf(empty), litestreamBin(), CONFIG)).toEqual({ kind: 'none' });
    expect(existsSync(first)).toBe(false);
    // The bucket cannot be read: it does not start empty over the backup.
    r2.failing = 503;
    const down = await restoreIfMissing(join(dir, 'down', 'budget.sqlite'), backupOf(r2), litestreamBin(), CONFIG, 20_000);
    expect(down.kind).toBe('failed');
    expect(existsSync(join(dir, 'down', 'budget.sqlite'))).toBe(false);
  });
});

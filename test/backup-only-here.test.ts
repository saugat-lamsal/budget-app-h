import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backupLock, endpointProblem } from '../packages/server/src/backup/backup-lock.js';
import { backupFromEnv, litestreamEnv } from '../packages/server/src/backup/backup.js';

// Phase 6, the backups: no test can reach a real bucket. Every run of
// Litestream gets its environment from litestreamEnv, which checks the lock
// right before (packages/server/src/backup/backup-lock.ts); under the tests
// (vitest sets VITEST) the lock allows this computer only, whatever a test
// hands it. R2's address is written in the lock only, and in its tests. The
// words looked for are put together from parts, so this file does not trip
// over itself.
const repoRoot = new URL('..', import.meta.url);

function projectFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  return out
    .split('\0')
    .filter((path) => path !== '' && existsSync(new URL(path, repoRoot)))
    .filter((path) => !/\.(png|jpe?g|gif|ico|sqlite|db)$/i.test(path));
}

const join = (...parts: string[]): string => parts.join('');
const R2_HOST = new RegExp(join('r2', '\\\\?\\.cloud', 'flarestorage'), 'i');
const LOCK = 'packages/server/src/backup/backup-lock.ts';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const REAL = `https://${ACCOUNT}.${join('r2.cloud', 'flarestorage.com')}`;

describe('safety: no test reaches a real bucket', () => {
  it('safety: under the tests the lock allows this computer only, whatever environment a test hands it', () => {
    expect(process.env['VITEST']).toBeDefined();
    expect(backupLock()).toBe('this-computer');
    expect(backupLock({})).toBe('this-computer');
    expect(backupLock({ BACKUP_LOCK: 'r2', VITEST: undefined })).toBe('this-computer');
    expect(endpointProblem(REAL, backupLock())).toBe('Under the tests the books are copied to this computer only.');
    expect(endpointProblem('http://127.0.0.1:9000', backupLock())).toBeNull();
  });

  it('safety: Litestream is never given a real bucket\'s address: checked right before each run', () => {
    const real = backupFromEnv({ R2_ENDPOINT: REAL, R2_BUCKET: 'made-up-books', R2_ACCESS_KEY_ID: 'MADEUP', R2_SECRET_ACCESS_KEY: 'made-up-secret' }, 'r2');
    if (real === null) throw new Error('no backup');
    expect(() => litestreamEnv('/made-up/books.sqlite', real, {})).toThrow('Under the tests the books are copied to this computer only.');
    // Every place that runs Litestream builds its environment there.
    const runs = projectFiles().filter((path) => path.startsWith('packages/') && /\.(ts|tsx)$/.test(path) && /runLitestream\(|spawn\(bin, \['replicate'/.test(readFileSync(new URL(path, repoRoot), 'utf8')));
    for (const path of runs) {
      const text = readFileSync(new URL(path, repoRoot), 'utf8');
      for (const call of text.matchAll(/(runLitestream\([^;]*|spawn\(bin, \['replicate'[^;]*)/g)) {
        if (call[0].startsWith('runLitestream(bin: string')) continue;
        expect(call[0], path).toContain('litestreamEnv(');
      }
    }
    expect(runs.sort()).toEqual(['packages/server/src/backup/backup.ts', 'packages/server/src/backup/restore-check.ts', 'packages/server/src/serve/start.ts']);
  });

  it("safety: R2's address is named in the lock only, and in the tests of it", () => {
    const allowed = new Set([LOCK, 'packages/server/test/backup.test.ts']);
    const found = projectFiles().filter((path) => !allowed.has(path) && R2_HOST.test(readFileSync(new URL(path, repoRoot), 'utf8')));
    // Docs may say where the backups go; no code, test or configuration may.
    expect(found.filter((path) => /\.(ts|tsx|mjs|js|json|ya?ml|toml)$|Dockerfile$/.test(path))).toEqual([]);
  });

  it('safety: litestream.yml takes the bucket, its address and its key from the environment only', () => {
    const config = readFileSync(new URL('litestream.yml', repoRoot), 'utf8');
    const values = [...config.matchAll(/^\s*(?:- )?(endpoint|bucket|access-key-id|secret-access-key|path): (.+)$/gm)].map((m) => [m[1], m[2]?.trim()]);
    expect(values).toEqual([
      ['path', '${BUDGET_DB}'],
      ['endpoint', '${R2_ENDPOINT}'],
      ['bucket', '${R2_BUCKET}'],
      // Her plan, PR 2: her books in a folder of their own.
      ['path', 'budget-h'],
      ['access-key-id', '${R2_ACCESS_KEY_ID}'],
      ['secret-access-key', '${R2_SECRET_ACCESS_KEY}'],
    ]);
  });
});

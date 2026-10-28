import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CLAUDE.md safety rules: Plaid's test bank (sandbox) only until Phase 7.
// This fails if anything in the project points at Plaid's real bank
// connections. The words it looks for are put together from parts, so this
// file does not trip over itself.
const repoRoot = new URL('..', import.meta.url);

// Every file git would keep: committed, plus new files not ignored.
function projectFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  return out
    .split('\0')
    .filter((path) => path !== '' && existsSync(new URL(path, repoRoot)))
    .filter((path) => !/\.(png|jpe?g|gif|ico|sqlite|db)$/i.test(path));
}

const join = (...parts: string[]): string => parts.join('');
// The one file that may name Plaid's real address (the production switch).
const LOCK = 'packages/server/src/plaid/sandbox-lock.ts';
const realHosts = new RegExp(join('(production|development)', '\\.plaid\\.com'), 'i');
const realKeys = new RegExp(join('(access|public)-(production|development)', '-[0-9a-f]'), 'i');
// PLAID_ENV=... as in .env files, shell lines and docs, and PLAID_ENV: ... as
// in workflow files. Tests that check a wrong value is refused pass it in
// code, which neither form matches.
const realEnv = new RegExp(join('\\bPLAID_ENV', '=["\']?(?!sandbox\\b)[A-Za-z]'));
const realEnvYaml = new RegExp(join('^\\s*PLAID_ENV', ':\\s*["\']?(?!sandbox\\b)[A-Za-z]'), 'm');
// PLAID_ENV = "..." as in a .toml file (spaces around the =), to the end of the line.
const realEnvToml = new RegExp(join('^\\s*PLAID_ENV', '\\s*=\\s*["\']?(?!sandbox\\b)[A-Za-z].*$'), 'm');

describe('safety: nothing points at a real bank', () => {
  it('safety: the project has files to check', () => {
    expect(projectFiles().length).toBeGreaterThan(20);
  });

  // Before Phase 7 (his OK, Oct 12): the production switch names Plaid's real
  // address in one place, the lock, which refuses it unless PLAID_ENV says
  // production on the hosted server, and always under the tests. Nowhere
  // else may name it; only fly.toml sets PLAID_ENV to it (below, Phase 7).
  it('safety: no file names a Plaid address other than the test bank, but the lock itself', () => {
    const found = projectFiles().filter((path) => realHosts.test(readFileSync(new URL(path, repoRoot), 'utf8')));
    expect(found).toEqual([LOCK]);
    const text = readFileSync(new URL(LOCK, repoRoot), 'utf8');
    expect(text.match(new RegExp(realHosts.source, 'gi'))).toHaveLength(1);
  });

  it('safety: no file holds a key for a real bank connection', () => {
    const found = projectFiles().filter((path) => realKeys.test(readFileSync(new URL(path, repoRoot), 'utf8')));
    expect(found).toEqual([]);
  });

  // Phase 7 (his yes, Oct 12): fly.toml, the hosted server's settings, is the
  // one file that says production. Nothing else may set it, in any form.
  it('safety: no file sets PLAID_ENV to anything but sandbox, but fly.toml, which says production', () => {
    const found = projectFiles().filter((path) => {
      const text = readFileSync(new URL(path, repoRoot), 'utf8');
      return realEnv.test(text) || (/\.ya?ml$/i.test(path) && realEnvYaml.test(text)) || (/\.toml$/i.test(path) && realEnvToml.test(text));
    });
    expect(found).toEqual(['fly.toml']);
    const said = [...readFileSync(new URL('fly.toml', repoRoot), 'utf8').matchAll(new RegExp(realEnvToml.source, 'gm'))].map((m) => m[0].trim());
    expect(said).toEqual([join('PLAID_ENV', ' = "production"')]);
  });

  it('safety: every Plaid address in the server code is the test bank, the real one in the lock alone, or Plaid Link\'s own script and frame on the Bank page (1.1)', () => {
    const where = new Map<string, Set<string>>();
    for (const path of projectFiles().filter((p) => p.startsWith('packages/server/src/'))) {
      for (const m of readFileSync(new URL(path, repoRoot), 'utf8').matchAll(/https?:\/\/[a-z0-9.-]*plaid\.com/gi)) {
        where.set(m[0], (where.get(m[0]) ?? new Set()).add(path));
      }
    }
    expect(new Set(where.keys())).toEqual(new Set(['https://sandbox.plaid.com', join('https://', 'production', '.plaid.com'), 'https://cdn.plaid.com']));
    expect([...(where.get(join('https://', 'production', '.plaid.com')) ?? [])]).toEqual([LOCK]);
    expect([...(where.get('https://cdn.plaid.com') ?? [])]).toEqual(['packages/server/src/http/server.ts']);
  });

  it('safety: .env.example says sandbox', () => {
    expect(readFileSync(new URL('.env.example', repoRoot), 'utf8')).toMatch(/^PLAID_ENV=sandbox$/m);
  });

  // .env is never committed, so this only runs where it exists. Only the
  // PLAID_ENV line is read; no value of any secret is looked at or shown.
  it.runIf(existsSync(new URL('.env', repoRoot)))('safety: the local .env says sandbox', () => {
    const line = readFileSync(new URL('.env', repoRoot), 'utf8')
      .split(/\r?\n/)
      .find((l) => /^\s*PLAID_ENV\s*=/.test(l));
    expect(line?.split('=')[1]?.trim()).toBe('sandbox');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP } from '../scripts/deploy-check-lib.mjs';
import { LITESTREAM } from '../scripts/litestream.mjs';

// Phase 6: the hosting files, read as text. fly.toml: one small machine with
// one volume near New York, never more, always on, https only, the health
// check. The Dockerfile: pinned images, the same Litestream as the tests use,
// nothing secret. .dockerignore: no keys or books sent to the builder.

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fly = read('fly.toml');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');

// fly.toml without its comments.
const settings = fly
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter((line) => line !== '');

function value(key: string, section: string | null = null): string | undefined {
  let current: string | null = null;
  for (const line of settings) {
    const head = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (head !== null) {
      current = head[1] ?? null;
      continue;
    }
    const m = /^([\w.]+)\s*=\s*(.+)$/.exec(line);
    if (m !== null && m[1] === key && current === section) return m[2]?.replace(/^"(.*)"$/, '$1');
  }
  return undefined;
}

describe('Phase 6 fly.toml', () => {
  it('Phase 6 one small machine in Secaucus, near New York, with one volume for the books', () => {
    expect(value('primary_region')).toBe('ewr');
    expect(value('size', 'vm')).toBe('shared-cpu-1x');
    expect(value('memory', 'vm')).toBe('512mb');
    // Her plan, PR 2: her own volume, for the test bank's books until her
    // connection day (then budget_h_real, with this one kept as the way back).
    expect(value('source', 'mounts')).toBe('budget_h_data');
    expect(value('destination', 'mounts')).toBe('/data');
    expect(value('initial_size', 'mounts')).toBe('1gb');
    expect(value('BUDGET_DB', 'env')).toBe('/data/budget.sqlite');
    expect(settings.filter((l) => l === '[[vm]]' || l === '[mounts]' || l === '[http_service]')).toEqual(['[mounts]', '[http_service]', '[[vm]]']);
  });

  it('Phase 6 only ever one machine: always on, never stopped for being idle, nothing that adds one, and a deploy replaces it in place', () => {
    expect(value('auto_stop_machines', 'http_service')).toBe('off');
    expect(value('min_machines_running', 'http_service')).toBe('1');
    expect(value('strategy', 'deploy')).toBe('rolling');
    // No autoscaling, no second process group, no count.
    expect(settings.join('\n')).not.toMatch(/autoscal|\[processes\]|max_machines|bluegreen|canary/i);
  });

  it('Phase 6 the free fly.dev address, https only: APP_ORIGIN is the app\'s own name there', () => {
    const app = value('app');
    expect(app).toMatch(/^[a-z0-9-]+$/);
    expect(value('APP_ORIGIN', 'env')).toBe(`https://${app ?? ''}.fly.dev`);
    expect(value('force_https', 'http_service')).toBe('true');
    expect(value('internal_port', 'http_service')).toBe('8080');
    expect(value('PORT', 'env')).toBe('8080');
  });

  it('Phase 6 Fly checks the health address; it stops the machine with SIGTERM and gives it a minute', () => {
    expect(value('path', 'http_service.checks')).toBe('/health');
    expect(value('method', 'http_service.checks')).toBe('GET');
    expect(value('kill_signal')).toBe('SIGTERM');
    expect(value('kill_timeout')).toBe('60s');
  });

  it("her plan PR 2 Plaid's test bank until her connection day, and no key in the file", () => {
    expect(value('PLAID_ENV', 'env')).toBe('sandbox');
    const env = settings.slice(settings.indexOf('[env]') + 1, settings.findIndex((l, i) => i > settings.indexOf('[env]') && l.startsWith('[')));
    expect(env.map((l) => l.split('=')[0]?.trim()).sort()).toEqual(['APP_ORIGIN', 'BUDGET_DB', 'PLAID_ENV', 'PORT']);
  });
});

describe('her plan PR 2 her own app, never upstream\'s', () => {
  // Upstream's app, volumes and backup folders. Her hosting files must name
  // none of them: a deploy, a restore or a backup would reach his books.
  const UPSTREAM_APP = 'budget-app-x7q2';
  const UPSTREAM_VOLUMES = ['budget_data', 'budget_real'];
  const UPSTREAM_FOLDERS = ['budget', 'budget-real'];

  it("her plan PR 2 fly.toml names her own app and address, not upstream's", () => {
    expect(value('app')).not.toBe(UPSTREAM_APP);
    expect(value('APP_ORIGIN', 'env')).not.toContain(UPSTREAM_APP);
    expect(fly).not.toContain(UPSTREAM_APP);
    expect(UPSTREAM_VOLUMES).not.toContain(value('source', 'mounts'));
  });

  it("her plan PR 2 her books go to a folder of their own (budget-h), never upstream's", () => {
    const paths = [...read('litestream.yml').matchAll(/^\s*path:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    expect(paths).toEqual(['budget-h']);
    for (const folder of UPSTREAM_FOLDERS) expect(paths).not.toContain(folder);
  });

  it("her plan PR 2 the deploy check checks the app fly.toml names, so never upstream's", () => {
    expect(APP).toBe(value('app'));
    expect(APP).not.toBe(UPSTREAM_APP);
  });

  it('her plan PR 2 her hosting files are always hers in a merge from upstream', () => {
    const attributes = read('.gitattributes').split('\n').map((l) => l.trim());
    for (const path of ['fly.toml', 'litestream.yml', 'test/hosting-config.test.ts']) expect(attributes, path).toContain(`${path} merge=ours`);
  });
});

describe('Phase 6 the Dockerfile', () => {
  it('Phase 6 both stages are Node 22, pinned to the exact image', () => {
    const froms = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
    expect(froms).toHaveLength(2);
    for (const from of froms) expect(from).toMatch(/^node:22\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/);
    expect(new Set(froms).size).toBe(1);
  });

  it('Phase 6 the same Litestream as the tests use, checked against its SHA-256', () => {
    const file = LITESTREAM.files['linux-x64'];
    expect(dockerfile).toContain(`ADD --checksum=sha256:${file.sha256} https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM.version}/${file.name} /tmp/litestream.tar.gz`);
  });

  it('Phase 6 it runs the supervisor, with the screens and litestream.yml where the server looks', () => {
    expect(dockerfile).toMatch(/^CMD \["node", "\/app\/serve\/start\.mjs"\]$/m);
    expect(dockerfile).toContain('COPY litestream.yml /etc/litestream.yml');
    expect(dockerfile).toContain('ENV WEB_ROOT=/app/web');
    expect(dockerfile).toContain('ENV LITESTREAM_CONFIG=/etc/litestream.yml');
    expect(dockerfile).toContain('RUN node scripts/build.mjs && npm prune --omit=dev');
  });

  it('Phase 6 no key in the image: no secret ARG or ENV, and the builder is never sent .env, the books, or data', () => {
    for (const line of dockerfile.split('\n').filter((l) => /^(ARG|ENV)\b/.test(l))) expect(line).not.toMatch(/KEY|SECRET|TOKEN|PLAID|VAPID|R2_|PASSWORD/i);
    const ignored = dockerignore.split('\n').map((l) => l.trim());
    for (const path of ['.env', '.env.*', 'data/', '*.sqlite', '*.sqlite-wal', 'node_modules/', '.git/']) expect(ignored, path).toContain(path);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CI runs npm test (the default run) split in two jobs
// (.github/workflows/test.yml): the type check and every test without a
// browser, then the browser tests in WebKit. Together they must be exactly
// npm test: no test left out. By hand, the same workflow runs the slow run
// (npm run test:slow): the checks job with the slow tests in, and the browser
// tests in Chromium. These checks read the workflow, the test config, and the
// browser harness as text.

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const workflow = read('.github/workflows/test.yml');
const config = read('vitest.config.ts');
const harness = read('packages/web/test/browser/harness.ts');
const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

interface Step {
  readonly name: string | null;
  readonly if: string | null;
  readonly run: string | null;
  readonly env: Readonly<Record<string, string>>;
}

// The job's steps, each with its name, condition, command, and environment.
// A job's steps (the test job's unless told another), up to the next job.
function steps(job = 'test'): Step[] {
  const jobText = workflow.split(new RegExp(`\\n  ${job}:\\n`))[1] ?? '';
  const body = (jobText.split(/\n    steps:\n/)[1] ?? '').split(/\n  [a-z-]+:\n/)[0] ?? '';
  return body
    .split(/\n      - /)
    .map((chunk) => chunk.replace(/^\s*- /, ''))
    .filter((chunk) => chunk.trim() !== '' && !chunk.trim().startsWith('#'))
    .map((chunk) => {
      const field = (name: string): string | null => new RegExp(`(?:^|\\n)\\s*${name}: (.+)`).exec(chunk)?.[1]?.trim() ?? null;
      const env: Record<string, string> = {};
      const envBlock = /\n\s*env:\n((?:\s{10,}\S.*\n?)+)/.exec(chunk)?.[1] ?? '';
      for (const line of envBlock.split('\n')) {
        const m = /^\s*([A-Z_]+): (.+)$/.exec(line);
        if (m?.[1] !== undefined && m[2] !== undefined) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1');
      }
      return { name: field('name'), if: field('if'), run: field('run'), env };
    });
}

// The engines the browser tests can be run in, one at a time.
const engines = [...harness.matchAll(/\['(\w+)', \w+\],/g)].map((m) => m[1] ?? '');

describe('CI: the jobs together are exactly npm test', () => {
  it('npm test is the type check, then every vitest project', () => {
    expect(packageJson.scripts['test']).toBe('npm run typecheck && vitest run');
  });

  it('the browser tests can run in Chromium and WebKit; BROWSER_ENGINE picks one, and with none it is WebKit, or Chromium in the slow run', () => {
    expect(engines).toEqual(['chromium', 'webkit']);
    expect(harness).toContain("process.env['BROWSER_ENGINE'] ?? (process.env['TEST_SLOW'] === '1' ? 'chromium' : 'webkit')");
  });

  it('the parts are the checks and WebKit on a pull request; with the slow run ticked, the checks and Chromium', () => {
    const parts = /\n\s+part: \$\{\{ fromJSON\(inputs\.slow == true && '(.+)' \|\| '(.+)'\) \}\}/.exec(workflow);
    expect(JSON.parse(parts?.[2] ?? 'null')).toEqual(['checks', 'webkit']);
    expect(JSON.parse(parts?.[1] ?? 'null')).toEqual(['checks', 'chromium']);
    expect(workflow).toContain("TEST_SLOW: ${{ inputs.slow == true && '1' || '0' }}");
  });

  it('npm run test:slow is the same tests with TEST_SLOW=1, and the default run leaves out exactly the slow files', () => {
    expect(packageJson.scripts['test:slow']).toBe('node scripts/test-slow.mjs');
    expect(read('scripts/test-slow.mjs')).toContain("TEST_SLOW: '1'");
    expect(config).toContain("const slow = process.env['TEST_SLOW'] === '1';");
    expect(config).toContain('const left = (files: readonly string[]): string[] => (slow ? [] : [...files]);');
    for (const project of ['money', 'server', 'repo']) expect(config).toMatch(new RegExp(`name: '${project}'.*left\\(SLOW_FILES\\.\\w+\\)`));
    expect(config).toContain('exclude: [...configDefaults.exclude, ...left(SLOW_FILES.webBrowser)]');
  });

  it('the checks job runs the type check and every test, with only the browser tests left out', () => {
    const checks = steps().filter((s) => s.if === "matrix.part == 'checks'");
    // Phase 6: Litestream first (kept between runs, then the script that puts it on the runner).
    expect(checks.map((s) => s.run)).toEqual([null, 'node scripts/litestream.mjs', 'npm run typecheck', 'npx vitest run']);
    expect(checks[0]?.name).toBe('Keep Litestream between runs');
    expect(checks.filter((s) => s.run?.startsWith('npx vitest') === true).map((s) => s.env)).toEqual([{ SKIP_BROWSER_TESTS: '1' }]);
    // SKIP_BROWSER_TESTS leaves out the web-browser project and nothing else.
    const skipped = /const browserTests = process\.env\['SKIP_BROWSER_TESTS'\] === '1'\s*\? \[\]\s*: \[([\s\S]*?)\n {4}\];/.exec(config)?.[1] ?? '';
    expect([...skipped.matchAll(/name: '([\w-]+)'/g)].map((m) => m[1])).toEqual(['web-browser']);
  });

  it('each browser job runs every browser test in its own engine', () => {
    const browser = steps().filter((s) => s.if === "matrix.part != 'checks'" && s.run?.startsWith('npx vitest') === true);
    expect(browser.map((s) => s.run)).toEqual(['npx vitest run --project web-browser']);
    expect(browser[0]?.env).toEqual({ BROWSER_ENGINE: '${{ matrix.part }}' });
  });

  it('every step runs in every job, or in the checks job, or in the browser jobs: nothing else picks', () => {
    for (const step of steps()) {
      expect([null, "matrix.part == 'checks'", "matrix.part != 'checks'"], `${step.name ?? step.run ?? 'a step'}`).toContain(step.if?.split(' && ')[0] ?? null);
    }
  });

  it('Phase 6 the image job builds the image and runs its one test, which npm test skips (no IMAGE there)', () => {
    const image = steps('image');
    expect(image.map((s) => s.run)).toEqual([null, null, 'npm ci', 'docker build --tag budget-app:test .', 'npx vitest run --project server test/image.test.ts']);
    expect(image.at(-1)?.env).toEqual({ IMAGE: 'budget-app:test' });
    expect(workflow).toMatch(/\n  image:\n    name: image \(ubuntu-latest\)\n    runs-on: ubuntu-latest\n/);
    const test = read('packages/server/test/image.test.ts');
    expect(test).toContain("const IMAGE = process.env['IMAGE'];");
    expect(test).toContain('describe.runIf(IMAGE !== undefined)(');
  });
});

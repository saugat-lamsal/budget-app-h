import { configDefaults, defineConfig } from 'vitest/config';

// Two runs (CLAUDE.md, "Two test runs"):
// - npm test (and CI on every pull request): the default run. It leaves out
//   SLOW_FILES, uses smaller counts for the random tests (the helpers in each
//   package's test/slow.ts) and one short simulated life where a file needs
//   one, and runs the browser tests in WebKit only.
// - npm run test:slow (TEST_SLOW=1): everything, with today's counts, and the
//   browser tests in Chromium only. For PR 12, when shared money code
//   changes, or by hand.
// No network and no keys. The tests that call Plaid's test bank are kept
// apart in vitest.live.config.ts.
//
// The browser tests (web-browser) build the screens and use them in a real
// browser (the harness picks WebKit, iPhone Safari's engine, by default, or
// Chromium in the slow run; BROWSER_ENGINE=chromium or webkit picks one
// either way). SKIP_BROWSER_TESTS=1 leaves them out; the break-it check does
// that for breaks outside the screens, which can only make a break look
// less caught, never more.
const slow = process.env['TEST_SLOW'] === '1';

// Left out of the default run, whole (paths from each project's root). The
// files with a long run inside them stay and shrink instead (slow.ts).
export const SLOW_FILES = {
  money: ['test/second-card-twins-her.test.ts'],
  server: [
    'test/simulated-life-restarts.test.ts',
    'test/alerts-simulated-life.test.ts',
    'test/alerts-simulated-life-restarts.test.ts',
    'test/alerts-random.test.ts',
    'test/trends-random.test.ts',
  ],
  webBrowser: ['test/browser/random-*.test.ts'],
  repo: ['test/break-it.test.ts', 'test/break-it-lists.test.ts'],
} as const;

const left = (files: readonly string[]): string[] => (slow ? [] : [...files]);

const browserTests = process.env['SKIP_BROWSER_TESTS'] === '1'
  ? []
  : [
      {
        test: {
          name: 'web-browser',
          root: './packages/web',
          include: ['test/browser/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...left(SLOW_FILES.webBrowser)],
          globalSetup: ['test/browser/build-once.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ];

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'money', root: './packages/money', exclude: [...configDefaults.exclude, ...left(SLOW_FILES.money)] } },
      { test: { name: 'server', root: './packages/server', include: ['test/**/*.test.ts'], exclude: [...configDefaults.exclude, ...left(SLOW_FILES.server)] } },
      { test: { name: 'web', root: './packages/web', include: ['test/*.test.ts'] } },
      ...browserTests,
      { test: { name: 'repo', include: ['test/**/*.test.ts'], exclude: [...configDefaults.exclude, ...left(SLOW_FILES.repo)] } },
    ],
  },
});

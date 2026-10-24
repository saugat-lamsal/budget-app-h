// The default run (npm test, CI on every pull request) and the slow run
// (npm run test:slow, which sets TEST_SLOW=1) share the same tests; the slow
// run keeps the big counts. See CLAUDE.md, "Two test runs".
export const SLOW = process.env['TEST_SLOW'] === '1';

// fast-check's numRuns: the file's own count in the slow run, at most
// DEFAULT_RUNS in the default run.
export const DEFAULT_RUNS = 150;
export const runs = (slowCount: number): number => (SLOW ? slowCount : Math.min(slowCount, DEFAULT_RUNS));

// A count of lives, scenarios or years: the slow run's, or one short one.
export const lives = (slowCount: number, defaultCount: number): number => (SLOW ? slowCount : defaultCount);

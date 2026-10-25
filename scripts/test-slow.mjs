// npm run test:slow: the slow run (CLAUDE.md, "Two test runs"). The type
// check, then every test, the slow ones too, with the big counts of the
// random tests and the long simulated lives, and the browser tests in
// Chromium (BROWSER_ENGINE=webkit or chromium picks one). For PR 12, when
// shared money code changes, or by hand. Extra arguments go to vitest.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, TEST_SLOW: '1' };
const run = (command, args) => spawnSync(command, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });

const typecheck = run('npm', ['run', 'typecheck']);
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);
process.exit(run('npx', ['vitest', 'run', ...process.argv.slice(2)]).status ?? 1);

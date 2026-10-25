// The engine of the break-it check (scripts/break-it.mjs is the command).
//
// Every worker gets its own copy of the code: a git worktree in the temp
// folder, outside the project folder, holding the project exactly as it is
// when the run starts (the last commit plus whatever is changed or new in the
// project folder). A break is applied to that copy only, the tests run there,
// and the file is put back before the worker takes the next break. Nothing in
// the project folder is ever written, so other work can go on while it runs.
//
// What a copy shares with the project: node_modules (as directory links; a
// package of this repo is linked to the copy's own folder, never to the
// project's, or the tests would run the unbroken code), and the browsers
// Playwright installed. What it never shares: the built screens
// (packages/web/dist), caches, and the temp folder, where the browser tests'
// browser profiles go.
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';

export const BACKUP_SUFFIX = '.break-it-backup';

// Where the copies of a run live: outside the project folder.
export const defaultWorkDir = () => join(tmpdir(), 'budget-app-break-it');

// One worker for each core but two, so the PC stays usable.
export function defaultWorkers() {
  return Math.max(1, availableParallelism() - 2);
}

const VALUE_FLAGS = ['--only', '--match', '--file', '--workers'];

export function parseArgs(argv) {
  const options = { restore: false, only: undefined, match: undefined, file: undefined, workers: undefined, sections: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--restore') {
      options.restore = true;
    } else if (arg.startsWith('--')) {
      const [flag, inline] = arg.split(/=(.*)/s);
      if (!VALUE_FLAGS.includes(flag)) throw new Error(`Unknown option ${arg}.`);
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value.`);
      if (flag === '--workers') {
        if (!/^[1-9]\d*$/.test(value)) throw new Error(`--workers needs a whole number of 1 or more, not "${value}".`);
        options.workers = Number(value);
      } else if (flag === '--only') {
        options.only = value;
      } else {
        try {
          options[flag.slice(2)] = new RegExp(value);
        } catch {
          throw new Error(`${flag} needs a regular expression, not "${value}".`);
        }
      }
    } else {
      options.sections.push(arg);
    }
  }
  return options;
}

// The break lists: the money math, the bank connection, and the screens.
export const BREAK_LISTS = Object.freeze(['packages/money/break-it.json', 'packages/server/break-it.json', 'packages/web/break-it.json']);

export function loadBreaks(root, lists) {
  return lists.filter((list) => existsSync(join(root, list))).flatMap((list) => JSON.parse(readFileSync(join(root, list), 'utf8')));
}

// How many times each break's text is in its file: a break is applied only
// when it is there exactly once (see judge). Returns the breaks that are not,
// with the count (null when the file is gone). An empty text is never a break.
export function staleBreaks(root, breaks) {
  const stale = [];
  for (const b of breaks) {
    const path = join(root, b.file);
    const found = existsSync(path) ? (b.find === '' ? 0 : readFileSync(path, 'utf8').split(b.find).length - 1) : null;
    if (found !== 1) stale.push({ ...b, found });
  }
  return stale;
}

export function selectBreaks(breaks, { sections, match, file }) {
  return breaks
    .filter((b) => sections.length === 0 || sections.includes(String(b.section)))
    .filter((b) => match === undefined || match.test(b.why))
    .filter((b) => file === undefined || file.test(b.file));
}

// Older versions of break-it broke the files in the project folder, keeping the
// untouched copy next to each as <file>.break-it-backup. A run killed at the
// wrong moment left a file broken. This puts such files back. (The current
// version never writes to the project folder, so it leaves none.)
export function restoreLeftovers(root, breaks, log = console.log) {
  const restored = [];
  for (const file of new Set(breaks.map((b) => b.file))) {
    const backup = join(root, file + BACKUP_SUFFIX);
    if (!existsSync(backup)) continue;
    writeFileSync(join(root, file), readFileSync(backup, 'utf8'));
    rmSync(backup);
    restored.push(file);
    log(`Restored ${file}: an earlier run was stopped while it was broken.`);
  }
  return restored;
}

function git(root, args) {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.error ?? run.stderr}`);
  return run.stdout;
}

const gitPaths = (root, args) => git(root, args).split('\0').filter((path) => path !== '');
const atPath = (folder, gitPath) => join(folder, ...gitPath.split('/'));

// The project folder as it is at the moment the run starts: its commit, what
// differs from that commit (files changed or new, with their contents copied
// into `frozen`, and files that are gone), and the list of packages. Files git
// ignores (node_modules, builds, .env) are not part of it. Every copy is built
// from this and never from the project folder again, so no two copies can
// differ, however long the nothing-broken check takes and whatever happens to
// the project meanwhile (an edit, a new file, a deleted one, a commit).
function freezeProject(root, frozen) {
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  const changed = gitPaths(root, ['diff', '--name-only', '-z', '--no-renames', commit]);
  const untracked = gitPaths(root, ['ls-files', '-z', '--others', '--exclude-standard']);
  const copy = [];
  const remove = [];
  for (const path of new Set([...changed, ...untracked])) {
    mkdirSync(dirname(atPath(frozen, path)), { recursive: true });
    try {
      copyFileSync(atPath(root, path), atPath(frozen, path));
      copy.push(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      remove.push(path);
    }
  }
  return { commit, copy, remove, frozen, folders: packageFolders(root) };
}

function packageFolders(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const folders = [''];
  for (const pattern of manifest.workspaces ?? []) {
    if (!pattern.endsWith('/*')) continue;
    const parent = pattern.slice(0, -2);
    if (!existsSync(join(root, parent))) continue;
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) if (entry.isDirectory()) folders.push(`${parent}/${entry.name}`);
  }
  return folders;
}

// A copy of node_modules made of directory links to the project's, except
// that a link into the project itself (a package of this repo) is made to
// point into the copy. Caches (.vite) are left out, so no two copies share one.
function mirrorNodeModules(root, workspace, folder, links) {
  const from = join(root, folder, 'node_modules');
  if (!existsSync(from)) return;
  const insideProject = (real) => {
    const path = relative(realpathSync(root), real);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path)) ? path : undefined;
  };
  const link = (target, at) => {
    symlinkSync(target, at, 'junction');
    links.push(at);
  };
  const mirror = (source, destination, scope) => {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) {
      if (name.startsWith('.') && name !== '.bin') continue;
      const entry = join(source, name);
      const info = lstatSync(entry);
      if (info.isSymbolicLink()) {
        const real = realpathSync(entry);
        const inside = insideProject(real);
        link(inside === undefined ? real : join(workspace, inside), join(destination, name));
      } else if (info.isDirectory() && !scope && name.startsWith('@') && readdirSync(entry).some((n) => lstatSync(join(entry, n)).isSymbolicLink() && insideProject(realpathSync(join(entry, n))) !== undefined)) {
        mirror(entry, join(destination, name), true);
      } else if (info.isDirectory()) {
        link(entry, join(destination, name));
      } else {
        copyFileSync(entry, join(destination, name));
      }
    }
  };
  mirror(from, join(workspace, folder, 'node_modules'), false);
}

function createWorkspace(root, dir, snapshot) {
  git(root, ['worktree', 'add', '--detach', '--quiet', dir, snapshot.commit]);
  const workspace = { dir, links: [], tmp: join(dirname(dir), `tmp-${dir.split(/[\\/]/).pop()}`) };
  mkdirSync(workspace.tmp, { recursive: true });
  for (const path of snapshot.copy) {
    mkdirSync(dirname(atPath(dir, path)), { recursive: true });
    copyFileSync(atPath(snapshot.frozen, path), atPath(dir, path));
  }
  for (const path of snapshot.remove) rmSync(atPath(dir, path), { force: true });
  for (const folder of snapshot.folders) mirrorNodeModules(root, dir, folder, workspace.links);
  return workspace;
}

// The links go first, one by one, so that nothing removing the folder could
// ever reach the project's own node_modules through them.
function removeWorkspace(root, workspace) {
  for (const link of workspace.links) rmSync(link, { force: true });
  if (existsSync(workspace.dir)) {
    spawnSync('git', ['worktree', 'remove', '--force', workspace.dir], { cwd: root, encoding: 'utf8' });
  }
  rmSync(workspace.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  rmSync(workspace.tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

// The copies of a run that was killed before it could remove them (this
// project's, and only when that run's process is gone).
export function removeStaleRuns(root, workDir, log = console.log) {
  if (!existsSync(workDir)) return;
  for (const name of readdirSync(workDir)) {
    const runDir = join(workDir, name);
    let owner;
    try {
      owner = JSON.parse(readFileSync(join(runDir, 'owner.json'), 'utf8'));
    } catch {
      continue;
    }
    if (owner.root !== root || isAlive(owner.pid)) continue;
    for (const link of linksUnder(runDir)) rmSync(link, { force: true });
    rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    log(`Removed the copies left by a run that was stopped (${name}).`);
  }
  spawnSync('git', ['worktree', 'prune'], { cwd: root, encoding: 'utf8' });
}

// Every link under a folder, without following any.
function linksUnder(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) return [path];
    return info.isDirectory() ? linksUnder(path) : [];
  });
}

const running = new Set();

function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

// With timeLimitMs, a command still running then is stopped, with everything
// it started, and its run says so (timedOutAfterMs).
export function runCommand(command, args, { cwd, env, timeLimitMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    running.add(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeLimitMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeLimitMs);
    child.stdout.setEncoding('utf8').on('data', (text) => (stdout += text));
    child.stderr.setEncoding('utf8').on('data', (text) => (stderr += text));
    child.on('error', (error) => {
      clearTimeout(timer);
      running.delete(child);
      resolve({ status: null, stdout, stderr, error });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      running.delete(child);
      resolve({ status, stdout, stderr, ...(timedOut ? { timedOutAfterMs: timeLimitMs } : {}) });
    });
  });
}

// A break can make a test loop for ever or grow without end (one held a
// worker for eight hours and 16 GB, Oct 11, 2026): each run of the tests is
// stopped after this long, which counts as not caught, and each of its node
// processes may use at most this much memory.
export const TIME_LIMIT_MS = 30 * 60_000;
export const MEMORY_CAP_MB = 4096;

const timeWords = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

// Runs every test in a copy, with node itself (npx cannot be started this way
// on Windows). `threads` is how many test files may run at once inside this
// copy; with several workers it is each one's share of the cores. The browser
// tests run only for the screens' breaks. BREAK_IT_RUN tells the test suite
// it is being broken on purpose (see test/break-it.test.ts).
export function vitestRunner({ only, timeLimitMs = TIME_LIMIT_MS }) {
  return ({ workspace, withBrowsers, threads }) =>
    runCommand(process.execPath, [join(workspace.dir, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...(threads === undefined ? [] : [`--maxWorkers=${threads}`]), ...(only === undefined ? [] : [only])], {
      cwd: workspace.dir,
      timeLimitMs,
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${MEMORY_CAP_MB}`.trim(),
        SKIP_BROWSER_TESTS: withBrowsers ? '0' : '1',
        BREAK_IT_RUN: '1',
        // A break is judged against every test, the slow ones too.
        TEST_SLOW: '1',
        // Browsers keep their profiles in the temp folder: one folder for each copy.
        TEMP: workspace.tmp,
        TMP: workspace.tmp,
        TMPDIR: workspace.tmp,
      },
    });
}

export const needsBrowsers = (b) => b.section === 'home';

// Judges one break in one copy. The file is put back afterward, whatever happens.
async function judge(workspace, b, runTests, threads) {
  const path = atPath(workspace.dir, b.file);
  const original = readFileSync(path, 'utf8');
  const count = original.split(b.find).length - 1;
  if (count !== 1) return { ...b, outcome: `NOT APPLIED (text found ${count} times)` };
  writeFileSync(path, original.replace(b.find, () => b.replace));
  try {
    const run = await runTests({ workspace, withBrowsers: needsBrowsers(b), threads });
    // Without colours: GitHub Actions turns vitest's on, and they sit between "Tests" and the count.
    const failed = /Tests\s+(\d+) failed/.exec(`${run.stdout}${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, ''))?.[1];
    // A break that stops the tests from loading proves nothing, so it counts
    // as a bad break to fix, not as caught.
    // One that never ends in good time is a test to make fail sooner, not caught.
    const outcome =
      run.timedOutAfterMs !== undefined ? `HUNG (stopped after ${timeWords(run.timedOutAfterMs)})` : run.status === 0 ? 'SURVIVED (no test failed)' : failed ? `caught (${failed} tests failed)` : 'INVALID (tests did not run)';
    return { ...b, outcome };
  } finally {
    writeFileSync(path, original);
  }
}

// Runs the control (the tests with nothing broken) once, then judges every
// break on a number of workers. Returns { results } in the order of `breaks`,
// or { control } if the tests failed with nothing broken.
export async function runBreakIt({ root, breaks, workers, runTests, workDir = defaultWorkDir(), progress = () => {}, log = console.log }) {
  if (breaks.length === 0) return { results: [] };
  removeStaleRuns(root, workDir, log);
  const runDir = join(workDir, `r${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'owner.json'), JSON.stringify({ pid: process.pid, root }));
  const count = Math.min(workers, breaks.length);
  const threads = Math.max(1, Math.floor(availableParallelism() / count));
  const workspaces = [];
  const cleanUp = () => {
    for (const child of running) killTree(child);
    for (const workspace of workspaces.splice(0)) removeWorkspace(root, workspace);
    rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    spawnSync('git', ['worktree', 'prune'], { cwd: root, encoding: 'utf8' });
  };
  const onSignal = () => {
    cleanUp();
    process.exit(130);
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, onSignal);
  try {
    const snapshot = freezeProject(root, join(runDir, 'frozen'));
    workspaces.push(createWorkspace(root, join(runDir, 'w1'), snapshot));

    // The check with nothing broken, once, in the first copy and before the
    // other workers start. If a test fails anyway, every break would look caught.
    const control = await runTests({ workspace: workspaces[0], withBrowsers: breaks.some(needsBrowsers), threads: undefined });
    if (control.status !== 0) return { control };

    for (let n = 2; n <= count; n++) workspaces.push(createWorkspace(root, join(runDir, `w${n}`), snapshot));

    // Slow breaks (the screens' ones, judged by the browser tests) go first, so
    // that the last break to finish is a quick one.
    const order = breaks.map((_, i) => i).sort((a, b) => Number(needsBrowsers(breaks[b])) - Number(needsBrowsers(breaks[a])) || a - b);
    const results = new Array(breaks.length);
    let next = 0;
    let done = 0;
    await Promise.all(
      workspaces.map(async (workspace) => {
        while (next < order.length) {
          const i = order[next++];
          results[i] = await judge(workspace, breaks[i], runTests, threads);
          progress(++done, breaks.length, results[i]);
        }
      }),
    );
    return { results };
  } finally {
    for (const signal of signals) process.off(signal, onSignal);
    cleanUp();
  }
}

export function formatResults(results) {
  const lines = results.map((r) => `${String(r.section).padEnd(4)} ${r.outcome.padEnd(30)} ${r.why}`);
  const bad = results.filter((r) => !r.outcome.startsWith('caught'));
  lines.push('', `${results.length} breaks, ${results.length - bad.length} caught, ${bad.length} not caught or not applied.`);
  return { text: lines.join('\n'), ok: bad.length === 0 };
}

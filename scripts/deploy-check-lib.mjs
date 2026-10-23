// The deploy check (QUESTIONS.md A50a), before every deploy: the new image
// rebuilds his real books from the backup and replays every event (0.6), on a
// throwaway machine of the same Fly app, before it is ever deployed. So an
// update that would stop the app from starting (a history that no longer
// replays) is found while the old version still runs. His data never leaves
// his server and his backup: the check runs on Fly, and only its last line
// comes back. It is the roadmap's "real history as a permanent test".
//
// 1. fly deploy --build-only --push: the new image is built on Fly's builder
//    and pushed to Fly's registry under a label of its own. Nothing is
//    deployed: the machine that runs the app is not touched.
// 2. fly console --image <that image>: a new machine of the app, from the new
//    image, with no volume and no ports (it gets no traffic), runs the image's
//    own restore check (node /app/serve/restore-check.mjs) and is removed when
//    it ends. The check only reads the backup: it never starts the server,
//    Litestream's copying, or a sync.
//    If Fly's registry does not know the new label yet ("manifest unknown":
//    no machine is made; seen on the first real run, Oct 15, 2026), the same
//    command is tried again after 30 seconds, at most 3 times in all.
// 3. Whatever happened, any machine left from that image is removed.
// The answer is yes only when the check said "The backup works."

import { readFileSync } from 'node:fs';

// The app is the one fly.toml names (her plan, PR 2: never a name written
// here, so a copy of the project checks its own app, not upstream's).
export function appOf(flyToml) {
  const name = /^app\s*=\s*"([a-z0-9-]+)"\s*$/m.exec(flyToml)?.[1];
  if (name === undefined) throw new Error('fly.toml names no app (a line app = "...")');
  return name;
}

export const APP = appOf(readFileSync(new URL('../fly.toml', import.meta.url), 'utf8'));
export const CHECK_COMMAND = 'node /app/serve/restore-check.mjs';
export const WORKS = 'The backup works.';
export const CHECK_TRIES = 3;
export const RETRY_WAIT_MS = 30_000;

// Fly's registry did not know the new label yet: nothing ran.
function notInRegistryYet(out) {
  return /MANIFEST_UNKNOWN|failed to get manifest/.test(out);
}

// A label no machine of the app already runs: deploy-check-<UTC time>.
export function labelFor(now) {
  return `deploy-check-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'z').toLowerCase()}`;
}

// run(args) runs flyctl with these arguments and resolves to { code, out,
// stdout } (out: stdout and stderr together); say(line) prints one line.
export async function deployCheck({ run, say, app = APP, label, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const image = `registry.fly.io/${app}:${label}`;
  let lastLine = '';
  let ok = false;
  try {
    say(`Building the new image (${label}) on Fly's builder. Nothing is deployed.`);
    const built = await run(['deploy', '--app', app, '--build-only', '--push', '--remote-only', '--image-label', label]);
    if (built.code !== 0) {
      lastLine = 'The image did not build.';
      return { ok: false, lastLine, image };
    }
    say('Rebuilding the books from the backup on a throwaway machine (no volume, no traffic)...');
    const args = ['console', '--app', app, '--image', image, '--vm-size', 'shared-cpu-1x', '--vm-memory', '512', '-C', CHECK_COMMAND];
    let checked = await run(args);
    for (let tried = 1; tried < CHECK_TRIES && checked.code !== 0 && notInRegistryYet(checked.out); tried += 1) {
      say(`Fly's registry does not know the new image yet; trying again in ${RETRY_WAIT_MS / 1000} seconds.`);
      await wait(RETRY_WAIT_MS);
      checked = await run(args);
    }
    const lines = checked.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
    lastLine = lines.at(-1) ?? '(the check printed nothing)';
    ok = checked.code === 0 && lastLine === WORKS;
    return { ok, lastLine, image };
  } finally {
    await removeLeftovers({ run, say, app, image });
  }
}

// Any machine of the app still running the check's image is destroyed. The
// app's own machine runs another image and is never touched.
async function removeLeftovers({ run, say, app, image }) {
  const listed = await run(['machines', 'list', '--app', app, '--json']);
  if (listed.code !== 0) {
    say('Could not list the machines to check none was left; look with: fly machines list');
    return;
  }
  let machines = [];
  try {
    machines = JSON.parse(listed.stdout ?? listed.out);
  } catch {
    say('Could not read the list of machines; look with: fly machines list');
    return;
  }
  for (const m of machines) {
    const runs = String(m?.config?.image ?? '');
    if (runs !== image && !runs.startsWith(`${image}@`)) continue;
    say(`Removing the check's machine ${m.id}.`);
    await run(['machine', 'destroy', m.id, '--app', app, '--force']);
  }
}

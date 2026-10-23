// Phase 2, the simulated you (packages/money/test/sim). Lives many made-up
// lives at once, one slice of seeds per CPU core, or plays one life again.
// Every simulated day must pass the self-check and the other daily checks.
//
//   node scripts/simulate.mjs                          1,000 lives of 5 years
//   node scripts/simulate.mjs --lives 200 --years 10
//   node scripts/simulate.mjs --first 5001             start at another seed
//   node scripts/simulate.mjs --seed 1234 --years 5    play one life again
//   node scripts/simulate.mjs --profile her            lives shaped like hers
//                                                      (her rulebook, "Off in
//                                                      this setup"); with any
//                                                      of the above
//
// Prints each failure with its seed and day, and exits non-zero if any life
// failed. A failure becomes a test before it gets fixed (CLAUDE.md).
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const vitest = fileURLToPath(new URL('node_modules/vitest/vitest.mjs', root));

const options = { lives: 1_000, years: 5, first: 1, profile: 'upstream' };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const name = args[i];
  const value = Number(args[i + 1]);
  const whole = Number.isInteger(value) && value >= 0;
  if (name === '--profile' && (args[i + 1] === 'her' || args[i + 1] === 'upstream')) options.profile = args[i + 1];
  else if (name === '--lives' && whole && value > 0) options.lives = value;
  else if (name === '--years' && value > 0) options.years = value;
  else if (name === '--first' && whole) options.first = value;
  else if (name === '--seed' && whole) Object.assign(options, { first: value, lives: 1 });
  else {
    console.error(`Not understood: ${name} ${args[i + 1] ?? ''}. Use --lives, --years, --first, or --seed with a number, or --profile her.`);
    process.exit(2);
  }
}

// Seeds first, first + 1, ... split into one slice per core.
const workers = Math.min(availableParallelism(), options.lives);
const slices = [];
for (let w = 0, next = options.first; w < workers; w++) {
  const count = Math.floor(options.lives / workers) + (w < options.lives % workers ? 1 : 0);
  slices.push({ first: next, count });
  next += count;
}

// Her lives have their own test and their own seeds, years and count.
const her = options.profile === 'her';
const prefix = her ? 'SIM_HER_' : 'SIM_';
const testName = her ? 'in lives shaped like hers' : 'on every simulated day';

function live(slice) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vitest, 'run', 'packages/money/test/simulator.test.ts', '-t', testName, '--silent=false'], {
      cwd: root,
      env: { ...process.env, [`${prefix}FIRST_SEED`]: String(slice.first), [`${prefix}SEEDS`]: String(slice.count), [`${prefix}YEARS`]: String(options.years), SIM_REPORT: '1' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', () => resolve({ slice, output }));
  });
}

const started = Date.now();
const results = await Promise.all(slices.map(live));
const totals = {};
const failedSeeds = [];
let notRun = 0;
for (const { slice, output } of results) {
  const totalsLine = /SIM-TOTALS (\{.*\})/.exec(output);
  const failedLine = /SIM-FAILED (\[.*\])/.exec(output);
  if (!totalsLine || !failedLine) {
    notRun++;
    console.log(`Seeds ${slice.first} to ${slice.first + slice.count - 1}: the simulator did not run.\n${output}`);
    continue;
  }
  for (const [name, n] of Object.entries(JSON.parse(totalsLine[1]))) totals[name] = (totals[name] ?? 0) + n;
  failedSeeds.push(...JSON.parse(failedLine[1]));
  for (const [, report] of output.matchAll(/SIM-REPORT-BEGIN\r?\n([\s\S]*?)\r?\nSIM-REPORT-END/g)) console.log(`${report}\n`);
}

const seconds = Math.round((Date.now() - started) / 1000);
const last = options.first + options.lives - 1;
console.log(`${options.lives} lives${her ? ' shaped like hers' : ''} of ${options.years} years (seeds ${options.first} to ${last}): ${totals.days ?? 0} simulated days, in ${seconds}s on ${workers} cores.`);
console.log(Object.entries(totals).map(([name, n]) => `${name} ${n}`).join(', '));
if (failedSeeds.length > 0) console.log(`\n${failedSeeds.length} lives failed: seeds ${failedSeeds.sort((a, b) => a - b).join(', ')}.`);
else if (notRun === 0) console.log('\nEvery check passed on every simulated day.');
process.exit(failedSeeds.length === 0 && notRun === 0 ? 0 : 1);

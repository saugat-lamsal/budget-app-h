import { describe, expect, it } from 'vitest';
import type { Keeper } from '../src/history/keeper.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { decisions, lifeInAFile, noonInNewYork, screens, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { lives as count } from './slow.js';

// Random scenarios (the real server keeps everything): made-up bank activity
// and his answers in random order, given to two servers alike. One is
// stopped and started again from its database at random moments; the other
// never stops. After every step their books and every screen must be the
// same. A failure names its seed: SEED=n replays one; KEEPER_SCENARIOS=n
// runs more.

// sfc32: small, fast, and the same everywhere for a seed.
function random(seed: number): () => number {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4_294_967_296;
  };
}

const PLACES = ['CORNER STORE 12', 'MADE UP CAFE', 'HARBOR DINER', 'MADE UP BOOKSHOP', 'GROCERY OUTLET 12', 'COFFEE SHOP 5'];

// One random step, worked out from the books both servers have (they are the
// same), and done to both alike.
async function step(r: () => number, n: number, lives: readonly Life[], next: () => string, day: { value: number }): Promise<string> {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const amount = (): number => 1 + Math.floor(r() * 20_000);
  const both = async (what: string, act: (life: Life) => unknown): Promise<string> => {
    for (const life of lives) await act(life);
    return what;
  };
  const k = lives[0]!.keeper;
  const roll = r();
  if (roll < 0.35) {
    // The bank sends something new, on a new day now and then.
    if (r() < 0.4) day.value += 1;
    const date = `2026-10-${String(day.value).padStart(2, '0')}`;
    const id = `t${n}`;
    const kind = pick(['card', 'debit', 'pending', 'deposit', 'person', 'refund'] as const);
    const value = amount();
    const place = pick(PLACES);
    return both(`the bank: ${kind} ${id} ${value}`, async (life) => {
      life.now = noonInNewYork(date);
      const f = life.h.fake;
      if (kind === 'card') f.addPosted({ id, account: ACCOUNT_IDS.everyday, amount: value, date, description: place });
      if (kind === 'debit') f.addPosted({ id, account: ACCOUNT_IDS.checking, amount: value, date, description: place });
      if (kind === 'pending') f.addPending({ id, account: ACCOUNT_IDS.everyday, amount: value, date, description: place });
      if (kind === 'deposit') f.addPosted({ id, account: ACCOUNT_IDS.checking, amount: -value, date, description: 'MADE UP TAX REFUND' });
      if (kind === 'person') f.addPosted({ id, account: ACCOUNT_IDS.checking, amount: value, date, description: 'Zelle payment to ANNA MADEUP' });
      if (kind === 'refund') f.addPosted({ id, account: ACCOUNT_IDS.everyday, amount: -Math.min(value, 3_000), date, description: `${place} REFUND` });
      await life.sync();
    });
  }
  const waiting = k.book()?.reviewDetails() ?? [];
  if (roll < 0.75 && waiting.length > 0) {
    const detail = pick(waiting);
    const options = detail.options;
    let choice: Parameters<Keeper['choice']>[0]['choice'];
    if (options.type === 'leftover') choice = { leftover: pick(options.answers) };
    else if (options.type === 'acknowledge') choice = { acknowledge: true };
    else if (options.picks.length > 0 && (options.split === null || r() < 0.7)) choice = { to: pick(options.picks).to };
    else if (options.split !== null && detail.item.type === 'spending' && detail.item.amount > 1) {
      const [first, second] = options.split;
      choice = { split: [{ bucket: first!, amount: 1 + Math.floor(r() * (detail.item.amount - 1)) }, { bucket: second!, amount: 'rest' }] };
    } else return 'nothing to answer';
    const id = next();
    return both(`an answer for ${detail.item.id}: ${JSON.stringify(choice)}`, (life) => {
      const first = life.keeper.choice({ id, item: detail.item.id, choice });
      if (!first.ok && first.code === 'needs-confirmation') life.keeper.choice({ id, item: detail.item.id, choice, confirmed: true });
    });
  }
  if (roll < 0.87) {
    const pots = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'] as const;
    const from = pick(pots);
    const to = pick(pots.filter((p) => p !== from));
    const value = amount();
    const id = next();
    const yes = r() < 0.5 ? { confirmed: true } : {};
    return both(`a move of ${value} from ${from} to ${to}`, (life) => life.keeper.move({ id, move: { from, to, amount: value }, ...yes }));
  }
  if (roll < 0.94) {
    const id = next();
    const text = pick(PLACES).split(' ')[0] ?? 'MADE';
    const to = pick(['needs', 'wants'] as const);
    return both(`a rule: ${text} to ${to}`, (life) => life.keeper.ruleChange({ id, rule: { add: { for: 'purchase', contains: text, to } } }));
  }
  const id = next();
  const percent = Math.floor(r() * 101);
  return both(`the low alert at ${percent}%`, (life) => life.keeper.settingsChange({ id, settings: { lowBucketAlertPercent: percent } }));
}

async function scenario(seed: number): Promise<void> {
  const r = random(seed);
  const steady = await lifeInAFile();
  const stopping = await lifeInAFile();
  try {
    for (const life of [steady, stopping]) setUpThroughTheDesk(life);
    const next = decisions(`s${seed}`);
    const day = { value: 1 };
    for (let n = 0; n < 30; n += 1) {
      const what = await step(r, n, [steady, stopping], next, day);
      if (r() < 0.25) stopping.restart();
      expect(screens(stopping.keeper), `seed ${seed}, step ${n}: ${what}`).toEqual(screens(steady.keeper));
    }
    stopping.restart();
    expect(screens(stopping.keeper), `seed ${seed}, at the end`).toEqual(screens(steady.keeper));
  } finally {
    steady.done();
    stopping.done();
  }
}

const SEEDS = process.env['SEED'] !== undefined ? [Number(process.env['SEED'])] : Array.from({ length: Number(process.env['KEEPER_SCENARIOS'] ?? count(8, 4)) }, (_, i) => i + 1);

describe('random scenarios: answers and bank activity in any order, restarts at random moments, the same books every time', () => {
  it.each(SEEDS)('seed %i', async (seed) => scenario(seed), 120_000);
});

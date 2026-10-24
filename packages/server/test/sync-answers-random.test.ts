import { describe, expect, it } from 'vitest';
import type { ChoiceOf, ChoiceResponse } from '../src/views/choice.js';
import type { KeyedDetail } from '../src/views/review.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { decisions, lifeInAFile, noonInNewYork, screens, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { lives as count } from './slow.js';

// Random scenarios for Step 3: bank activity, syncs and his answers in random
// order, given to two servers alike, one of them stopped and started again
// from its database at random moments. Some answers come while a sync is
// reading the bank, some the moment its save is committed, and many come from
// a screen shown a while ago, with the keys it showed (seen). After every
// step:
// - both servers' books and screens are the same, and a fresh copy opened from
//   the database (which replays the history and checks its totals) is too;
// - an answer from an old screen is refused as changed exactly when the item
//   is not what that screen showed any more, and changes nothing then.
// A failure names its seed: SEED=n replays one; SYNC_ANSWER_SCENARIOS=n runs more.

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

const PLACES = ['CORNER STORE 12', 'MADE UP CAFE', 'HARBOR DINER', 'MADE UP BOOKSHOP', 'MADE UP FUEL'];
const E = ACCOUNT_IDS.everyday;
const C = ACCOUNT_IDS.checking;

interface World {
  readonly r: () => number;
  readonly lives: readonly [Life, Life];
  readonly next: () => string;
  day: number;
  n: number;
  // Pending charges the bank has not posted or dropped yet.
  readonly pending: string[];
  // What Review showed when it was last looked at (the steady server's; both are the same).
  screen: readonly KeyedDetail[];
  answers: number;
  refusedAsChanged: number;
}

function reviewOf(life: Life): readonly KeyedDetail[] {
  const view = life.keeper.review();
  return view.state === 'tracking' ? view.items : [];
}

function choiceFor(w: World, detail: KeyedDetail): ChoiceOf | null {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(w.r() * list.length)] as T;
  const options = detail.options;
  if (options.type === 'leftover') return { leftover: pick(options.answers) };
  if (options.type === 'acknowledge') return { acknowledge: true };
  if (options.picks.length > 0) return { to: pick(options.picks).to };
  return null;
}

// An answer from the screen he last looked at, sent the same way to both
// servers; checks it was refused as changed exactly when the item changed.
function answerFromScreen(w: World, where: string): string {
  if (w.screen.length === 0) return 'nothing on the screen to answer';
  // Pending charges are what a sync changes most (they post, with a tip, or
  // at a new amount), so they are picked more often.
  const pending = w.screen.filter((d) => d.pending);
  const from = pending.length > 0 && w.r() < 0.6 ? pending : w.screen;
  const detail = from[Math.floor(w.r() * from.length)]!;
  const choice = choiceFor(w, detail);
  if (choice === null) return 'nothing to pick';
  const id = w.next();
  const answers: ChoiceResponse[] = [];
  for (const life of w.lives) {
    const now = reviewOf(life).find((d) => d.item.id === detail.item.id);
    const before = JSON.stringify(screens(life.keeper));
    let answer = life.keeper.choice({ id, item: detail.item.id, choice, seen: detail.key });
    if (!answer.ok && answer.code === 'needs-confirmation') answer = life.keeper.choice({ id, item: detail.item.id, choice, seen: detail.key, confirmed: true });
    const what = `${where}: ${detail.item.id} ${JSON.stringify(choice)} -> ${JSON.stringify(answer)}`;
    if (now === undefined) expect(answer, what).toMatchObject({ ok: false, code: 'not-waiting' });
    else if (now.key !== detail.key) expect(answer, what).toMatchObject({ ok: false, code: 'changed' });
    else expect(answer.ok || answer.code !== 'changed', what).toBe(true);
    if (!answer.ok) expect(JSON.stringify(screens(life.keeper)), what).toBe(before);
    answers.push(answer);
  }
  expect(answers[1], where).toEqual(answers[0]);
  w.answers += 1;
  if (!answers[0]!.ok && answers[0]!.code === 'changed') w.refusedAsChanged += 1;
  // After an answer the screen asks for its numbers again (choose.tsx).
  w.screen = reviewOf(w.lives[0]);
  return `${where}: an answer for ${detail.item.id}`;
}

// Something new at the bank, the same at both banks.
function bankActivity(w: World): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(w.r() * list.length)] as T;
  if (w.r() < 0.3) w.day = Math.min(w.day + 1, 28);
  const date = `2026-10-${String(w.day).padStart(2, '0')}`;
  const id = `t${w.n}`;
  const amount = 1 + Math.floor(w.r() * 9_000);
  // Pending charges often, and what becomes of them often too.
  const kind = w.pending.length > 0 && w.r() < 0.45 ? pick(['post', 'tip', 'change', 'drop'] as const) : pick(['pending', 'pending', 'card', 'deposit', 'refund'] as const);
  const place = pick(PLACES);
  // Most often one he has on the screen: an answer about it may come next.
  const onScreen = w.pending.filter((id) => w.screen.some((d) => d.item.id === id));
  const pendingId = onScreen.length > 0 && w.r() < 0.7 ? pick(onScreen) : w.pending.length > 0 ? pick(w.pending) : '';
  const tip = 1 + Math.floor(w.r() * 500);
  for (const life of w.lives) {
    life.now = noonInNewYork(date);
    const f = life.h.fake;
    if (kind === 'card') f.addPosted({ id, account: E, amount, date, description: place });
    if (kind === 'pending') f.addPending({ id, account: E, amount, date, description: place });
    if (kind === 'deposit') f.addPosted({ id, account: C, amount: -amount, date, description: 'MADE UP TAX REFUND' });
    if (kind === 'refund') f.addPosted({ id, account: E, amount: -Math.min(amount, 2_000), date, description: place });
    if (kind === 'post') f.postPending(pendingId, { id, date });
    if (kind === 'tip') f.postPending(pendingId, { id, date, amount: Math.round(f.transactions.get(pendingId)!.amount * 100) + tip });
    if (kind === 'change') f.modify(pendingId, { amount });
    if (kind === 'drop') f.dropPending(pendingId);
  }
  if (kind === 'pending') w.pending.push(id);
  if (kind === 'post' || kind === 'tip' || kind === 'drop') w.pending.splice(w.pending.indexOf(pendingId), 1);
  return `the bank: ${kind} ${kind === 'pending' || kind === 'card' || kind === 'deposit' || kind === 'refund' ? id : pendingId}`;
}

// A sync on both servers: on its own, with an answer while it reads the bank,
// or with one the moment its save is committed.
async function sync(w: World, atCommit: { hook: (() => void) | null }[]): Promise<string> {
  const how = w.r();
  if (how < 0.5) {
    for (const life of w.lives) await life.sync();
    return 'a sync';
  }
  if (how < 0.75) {
    // The answer goes to both servers inside the first one's read, so both see it at the same point.
    let done = '';
    w.lives[0].h.fake.beforeCall = (endpoint) => {
      if (endpoint === '/accounts/get' && done === '') done = answerFromScreen(w, 'while a sync reads the bank');
      return undefined;
    };
    await w.lives[0].sync();
    w.lives[0].h.fake.beforeCall = undefined;
    await w.lives[1].sync();
    return `a sync, and ${done || 'no answer'}`;
  }
  // The moment the steady server's sync is committed, an answer to it; the
  // other server gets the same answer right after its own sync.
  let done = '';
  atCommit[0]!.hook = () => {
    atCommit[0]!.hook = null;
    queueMicrotask(() => {
      const detail = w.screen[0];
      if (detail === undefined) return;
      const choice = choiceFor(w, detail);
      if (choice === null) return;
      const id = w.next();
      for (const life of w.lives) {
        const answer = (): ChoiceResponse => {
          const first = life.keeper.choice({ id, item: detail.item.id, choice, seen: detail.key });
          return !first.ok && first.code === 'needs-confirmation' ? life.keeper.choice({ id, item: detail.item.id, choice, seen: detail.key, confirmed: true }) : first;
        };
        if (life === w.lives[0]) done = JSON.stringify(answer());
        else pendingOther = answer;
      }
    });
  };
  let pendingOther: (() => ChoiceResponse) | null = null;
  await w.lives[0].sync();
  // A sync with nothing new saves nothing, so there was no moment: no answer then.
  atCommit[0]!.hook = null;
  await w.lives[1].sync();
  const other = (pendingOther as (() => ChoiceResponse) | null)?.() ?? null;
  if (other !== null) expect(JSON.stringify(other)).toBe(done);
  return `a sync, and the moment it saved, an answer: ${done || 'none'}`;
}

async function scenario(seed: number): Promise<void> {
  const atCommit: { hook: (() => void) | null }[] = [{ hook: null }];
  const steady = await lifeInAFile({ beforeCommit: () => atCommit[0]?.hook?.() });
  const stopping = await lifeInAFile();
  try {
    for (const life of [steady, stopping]) setUpThroughTheDesk(life);
    const w: World = { r: random(seed), lives: [steady, stopping], next: decisions(`r${seed}`), day: 2, n: 0, pending: [], screen: [], answers: 0, refusedAsChanged: 0 };
    for (; w.n < 40; w.n += 1) {
      const roll = w.r();
      let what: string;
      if (roll < 0.35) what = bankActivity(w);
      else if (roll < 0.6) {
        what = await sync(w, atCommit);
        // Now and then he taps something on the screen he had open, right after a sync.
        if (w.r() < 0.5) what += `, then ${answerFromScreen(w, 'from the screen he had open')}`;
      }
      else if (roll < 0.75) {
        w.screen = reviewOf(steady);
        what = 'he looks at Review';
      } else what = answerFromScreen(w, 'from the screen');
      if (w.r() < 0.2) {
        stopping.restart();
        what += ', then a restart';
      }
      const now = screens(steady.keeper);
      expect(screens(stopping.keeper), `seed ${seed}, step ${w.n}: ${what}`).toEqual(now);
      const fresh = steady.reopen();
      try {
        expect(screens(fresh.keeper), `seed ${seed}, step ${w.n}: ${what} (opened again)`).toEqual(now);
      } finally {
        fresh.close();
      }
    }
    totals.answers += w.answers;
    totals.refusedAsChanged += w.refusedAsChanged;
  } finally {
    steady.done();
    stopping.done();
  }
}

const SEEDS = process.env['SEED'] !== undefined ? [Number(process.env['SEED'])] : Array.from({ length: Number(process.env['SYNC_ANSWER_SCENARIOS'] ?? count(8, 4)) }, (_, i) => i + 1);

// Over every seed: how many answers came from a screen, and how many of them
// were refused because the item had changed.
const totals = { answers: 0, refusedAsChanged: 0 };

describe('random scenarios (Step 3): syncs and answers in any order, restarts at random moments, the same books every time, and the replay check passes', () => {
  it.each(SEEDS)('seed %i', async (seed) => scenario(seed), 120_000);

  it.runIf(SEEDS.length >= 8)('and some of the answers from an old screen were about an item a sync had changed since, and were refused', () => {
    expect(totals.answers).toBeGreaterThan(SEEDS.length);
    expect(totals.refusedAsChanged).toBeGreaterThan(0);
    expect(totals.refusedAsChanged).toBeLessThan(totals.answers);
  });
});

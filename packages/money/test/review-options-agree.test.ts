import { describe, expect, it } from 'vitest';
import { ACCOUNTS, startTracking, type BankTransaction, type Book, type IsoDate, type PickTo, type ReviewDetail, type SetupInput } from '../src/index.js';
import { busyBook } from './busy-book.js';
import { liveALife, type RecordedBankDay } from './sim/life.js';
import { Random } from './sim/random.js';
import { lives as count } from './slow.js';

// The choices offered for each waiting item (review-options.ts) must be
// exactly the ones the book accepts: every offered choice works, every other
// one is refused, and a refused choice changes nothing (0.1). Checked on a
// book with every kind of item waiting, and on random simulated lives.
// SIM_REVIEW_LIVES and SIM_REVIEW_FIRST_SEED run more, or replay one.

const PICKS: readonly PickTo[] = ['paycheck', 'other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine', 'mom'];
const TODAY: IsoDate = '2026-10-20';

interface Attempt {
  readonly name: string;
  readonly offered: boolean;
  readonly run: (b: Book) => void;
}

// Every way the screens could answer this item, whether it is offered or not.
function attempts(d: ReviewDetail): Attempt[] {
  const id = d.item.id;
  const found: Attempt[] = [];
  const o = d.options;
  if (o.type === 'leftover') {
    for (const answer of ['roll-over', 'move-to-savings'] as const) found.push({ name: `answer ${answer}`, offered: o.answers.includes(answer), run: (b) => b.answerLeftover(id, answer, TODAY) });
    found.push({ name: 'sort as needs', offered: false, run: (b) => b.sort(id, { to: 'needs' }, TODAY) });
    found.push({ name: 'acknowledge', offered: false, run: (b) => b.acknowledge(id, TODAY) });
    return found;
  }
  if (o.type === 'acknowledge') {
    found.push({ name: 'acknowledge', offered: true, run: (b) => b.acknowledge(id, TODAY) });
    found.push({ name: 'sort as needs', offered: false, run: (b) => b.sort(id, { to: 'needs' }, TODAY) });
    found.push({ name: 'answer roll-over', offered: false, run: (b) => b.answerLeftover(id, 'roll-over', TODAY) });
    return found;
  }
  const net = d.item.type === 'spending' || d.item.type === 'money-in' ? d.item.amount : 0;
  for (const to of PICKS) found.push({ name: `pick ${to}`, offered: o.picks.some((p) => p.to === to), run: (b) => b.sort(id, { to }, TODAY) });
  found.push({
    name: 'split needs/wants',
    offered: o.split?.includes('needs') === true && o.split.includes('wants'),
    run: (b) => b.sort(id, { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: net - 1 }] }, TODAY),
  });
  found.push({
    name: 'split needs/not-mine',
    offered: o.split?.includes('not-mine') === true,
    run: (b) => b.sort(id, { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'not-mine', amount: net - 1 }] }, TODAY),
  });
  found.push({ name: 'split needs/savings', offered: false, run: (b) => b.sort(id, { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'savings' as never, amount: net - 1 }] }, TODAY) });
  for (const account of ACCOUNTS) found.push({ name: `transfer with ${account}`, offered: o.transfer.includes(account), run: (b) => b.sort(id, { transfer: account }, TODAY) });
  // A18: a refund matched to each purchase offered; and to something that is not one.
  for (const of of o.match) found.push({ name: `match to ${of}`, offered: true, run: (b) => b.sort(id, { refundOf: of }, TODAY) });
  // A21: "It was not a payment to the old card", only for one marked from savings.
  found.push({ name: 'unmark', offered: o.unmark, run: (b) => b.sort(id, { unmark: true }, TODAY) });
  found.push({ name: 'match to nothing', offered: false, run: (b) => b.sort(id, { refundOf: 'nothing-like-this' }, TODAY) });
  found.push({ name: 'match to itself', offered: false, run: (b) => b.sort(id, { refundOf: id }, TODAY) });
  const text = d.item.type === 'spending' || d.item.type === 'money-in' ? d.item.description : '';
  // A new rule also sorts every other waiting item it matches (13.2); one
  // that cannot take the choice stays waiting (QUESTIONS.md A19), so the
  // rule is accepted whenever this item itself can take it.
  if (text !== '') {
    for (const to of PICKS) {
      found.push({ name: `always ${to}`, offered: o.always.includes(to), run: (b) => void b.sortAlways(id, { to }, { id: 'rule-from-review', contains: text }, TODAY) });
    }
  }
  found.push({ name: 'answer roll-over', offered: false, run: (b) => b.answerLeftover(id, 'roll-over', TODAY) });
  found.push({ name: 'acknowledge', offered: false, run: (b) => b.acknowledge(id, TODAY) });
  return found;
}

function snapshot(b: Book) {
  return { pots: b.pots(), review: b.reviewItems(), log: b.changeLog(), purchases: b.purchases(), rules: b.rules(), debt: b.oldCardDebt(), transit: b.inTransit(), period: b.period(), paychecks: b.paychecks() };
}

// Tries every attempt on a fresh copy of the book, and reports where the
// book and the offered choices disagree.
function disagreements(make: () => Book, where: string, onePerKind: boolean): string[] {
  const problems: string[] = [];
  const all = make().reviewDetails();
  // For the random lives, the first item of each kind: every kind gets
  // checked, and the work stays small.
  const seen = new Set<string>();
  const sample = all.filter((d) => {
    if (!onePerKind) return true;
    const kind = d.item.type === 'spending' || d.item.type === 'money-in' ? `${d.item.type}:${d.item.reason}` : d.item.type;
    if (seen.has(kind)) return false;
    seen.add(kind);
    return true;
  });
  for (const d of sample) {
    for (const a of attempts(d)) {
      const b = make();
      const before = snapshot(b);
      let accepted = true;
      try {
        a.run(b);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'MoneyError') throw error;
        accepted = false;
      }
      const label = `${where}: ${d.item.id} (${d.item.type}) ${a.name}`;
      if (accepted !== a.offered) problems.push(`${label}: offered ${String(a.offered)}, but the book ${accepted ? 'accepted' : 'refused'} it`);
      if (!accepted && JSON.stringify(snapshot(b)) !== JSON.stringify(before)) problems.push(`${label}: refused, but it changed something`);
      if (accepted && JSON.stringify(b.recountPots()) !== JSON.stringify(b.pots())) problems.push(`${label}: accepted, but the buckets no longer recount`);
    }
  }
  return problems;
}

describe('choices offered match the book: a book with every kind of item waiting', () => {
  it('has every kind of item waiting', () => {
    const kinds = new Set(busyBook().reviewDetails().map((d) => (d.item.type === 'spending' ? `${d.item.type}:${d.item.reason}` : d.item.type === 'money-in' ? `${d.item.type}:${d.item.reason}` : d.item.type)));
    expect([...kinds].sort()).toEqual(
      [
        'leftover',
        'money-in:deposit',
        'money-in:early-paycheck',
        'money-in:refund',
        'old-card-purchase',
        'spending:card-fee',
        'spending:card-interest',
        'spending:from-savings',
        'spending:mom-difference',
        'spending:no-rule',
        'spending:old-card-from-savings',
        'spending:person-payment',
        'spending:setup-difference',
        'spending:split-changed',
      ].sort(),
    );
  });

  it('6.1 4.2 4.4 4.8 4.9 5.2 5.4 5.6 7.6 8.3 13.6 every offered choice is accepted, every other one is refused, and a refusal changes nothing', () => {
    expect(disagreements(busyBook, 'busy book', false)).toEqual([]);
  });
});

// ----- Random simulated lives -----

const LIVES = Number(process.env['SIM_REVIEW_LIVES'] ?? count(2, 1));
const FIRST_SEED = Number(process.env['SIM_REVIEW_FIRST_SEED'] ?? 1);

// The simulator's bank, day by day, played into a book up to a random day.
// Nobody answers anything in review, so things pile up there.
function randomDay(seed: number): { make: () => Book; where: string } {
  let setup: SetupInput | undefined;
  const days: RecordedBankDay[] = [];
  const result = liveALife({ seed, years: 0.25, record: { setupDay: (s) => (setup = s.input), day: (d) => days.push(d) } });
  if (!result.ok || setup === undefined) throw new Error(`life ${seed} did not finish`);
  const stopAt = new Random(seed * 104_729).int(Math.floor(days.length / 2), days.length - 1);
  const feed: BankTransaction[] = days.slice(0, stopAt + 1).flatMap((day) => [...day.feed]);
  const input = setup;
  return {
    where: `seed ${seed}, day ${stopAt}`,
    make: () => {
      const started = startTracking(input);
      if (!started.ok) throw new Error(`life ${seed} could not start tracking`);
      for (const txn of feed) started.book.receive(txn);
      return started.book;
    },
  };
}

describe('choices offered match the book: random simulated lives', () => {
  const seeds = Array.from({ length: LIVES }, (_, i) => FIRST_SEED + i);
  it.each(seeds)('6.1 4.4 5.6 7.6 13.6 offered choices and the book agree, life %i', (seed) => {
    const { make, where } = randomDay(seed);
    expect(disagreements(make, where, true)).toEqual([]);
  }, 120_000);
});

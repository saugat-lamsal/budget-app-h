import { describe, expect, it } from 'vitest';
import { ACCOUNTS, MOVABLE_POTS, startTracking, type BankTransaction, type Book, type IsoDate, type PickTo, type ResortDetail, type SetupInput } from '../src/index.js';
import { SORTED, sortedBook } from './sorted-book.js';
import { liveALife, type RecordedBankDay } from './sim/life.js';
import { Random } from './sim/random.js';
import { lives as count } from './slow.js';

// The choices offered for sorting an item again (resortDetail, rule 4.7) must
// be exactly the ones the book accepts: every offered choice works, every
// other one is refused, and a refused choice changes nothing (0.1). Checked on
// a book with every kind of sorted item, and on random simulated lives.
// SIM_RESORT_LIVES and SIM_RESORT_FIRST_SEED run more, or replay one.

const PICKS: readonly PickTo[] = ['paycheck', 'other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine', 'mom'];
const TODAY: IsoDate = '2026-10-20';

interface Attempt {
  readonly name: string;
  readonly offered: boolean;
  readonly run: (b: Book) => void;
}

type Sortable = Extract<ResortDetail, { resortable: true }>;

// Every way the screens could re-sort this item, whether it is offered or not.
function attempts(d: Sortable): Attempt[] {
  const id = d.id;
  const o = d.options;
  const found: Attempt[] = [];
  for (const to of PICKS) found.push({ name: `pick ${to}`, offered: o.picks.some((p) => p.to === to), run: (b) => b.sort(id, { to }, TODAY) });
  found.push({
    name: 'split needs/wants',
    offered: o.split?.includes('needs') === true && o.split.includes('wants'),
    run: (b) => b.sort(id, { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: d.amount - 1 }] }, TODAY),
  });
  found.push({
    name: 'split needs/not-mine',
    offered: o.split?.includes('not-mine') === true,
    run: (b) => b.sort(id, { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'not-mine', amount: d.amount - 1 }] }, TODAY),
  });
  found.push({ name: 'split needs/savings', offered: false, run: (b) => b.sort(id, { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'savings' as never, amount: d.amount - 1 }] }, TODAY) });
  for (const account of ACCOUNTS) found.push({ name: `transfer with ${account}`, offered: o.transfer.includes(account), run: (b) => b.sort(id, { transfer: account }, TODAY) });
  for (const of of o.match) found.push({ name: `match to ${of}`, offered: true, run: (b) => b.sort(id, { refundOf: of }, TODAY) });
  // A21: "It was not a payment to the old card", only for one marked from savings.
  found.push({ name: 'unmark', offered: o.unmark, run: (b) => b.sort(id, { unmark: true }, TODAY) });
  found.push({ name: 'match to nothing', offered: false, run: (b) => b.sort(id, { refundOf: 'nothing-like-this' }, TODAY) });
  found.push({ name: 'match to itself', offered: false, run: (b) => b.sort(id, { refundOf: id }, TODAY) });
  // A new rule also sorts every other waiting item it matches (13.2); one
  // that cannot take the choice stays waiting (A19), so the rule is accepted
  // whenever this item itself can take it.
  if (d.description !== '') {
    for (const to of PICKS) found.push({ name: `always ${to}`, offered: o.always.includes(to), run: (b) => void b.sortAlways(id, { to }, { id: 'rule-from-resort', contains: d.description }, TODAY) });
  }
  found.push({ name: 'answer roll-over', offered: false, run: (b) => b.answerLeftover(id, 'roll-over', TODAY) });
  found.push({ name: 'acknowledge', offered: false, run: (b) => b.acknowledge(id, TODAY) });
  return found;
}

// Everything a choice could have changed.
function snapshot(b: Book) {
  return {
    pots: b.pots(),
    review: b.reviewItems(),
    log: b.changeLog(),
    purchases: b.purchases(),
    rules: b.rules(),
    debt: b.oldCardDebt(),
    transit: b.inTransit(),
    period: b.period(),
    paychecks: b.paychecks(),
    activity: MOVABLE_POTS.map((pot) => b.activity(pot)),
  };
}

function disagreements(make: () => Book, ids: readonly string[], where: string): string[] {
  const problems: string[] = [];
  for (const id of ids) {
    const d = make().resortDetail(id);
    if (d === null) {
      problems.push(`${where}: ${id} is not in the book`);
      continue;
    }
    if (!d.resortable) {
      // Nothing is offered. The book itself may accept more (a purchase marked as a transfer can be brought back, 5.6); what matters is that a refusal changes nothing.
      const b = make();
      const before = JSON.stringify(snapshot(b));
      let accepted = true;
      try {
        b.sort(id, { to: 'needs' }, TODAY);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'MoneyError') throw error;
        accepted = false;
      }
      if (!accepted && JSON.stringify(snapshot(b)) !== before) problems.push(`${where}: ${id} refused sorting to needs, but it changed something`);
      continue;
    }
    for (const a of attempts(d)) {
      const b = make();
      const before = JSON.stringify(snapshot(b));
      let accepted = true;
      try {
        a.run(b);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'MoneyError') throw error;
        accepted = false;
      }
      const label = `${where}: ${id} (${d.type}) ${a.name}`;
      if (accepted !== a.offered) problems.push(`${label}: offered ${String(a.offered)}, but the book ${accepted ? 'accepted' : 'refused'} it`);
      if (!accepted && JSON.stringify(snapshot(b)) !== before) problems.push(`${label}: refused, but it changed something`);
      if (accepted && JSON.stringify(b.recountPots()) !== JSON.stringify(b.pots())) problems.push(`${label}: accepted, but the buckets no longer recount`);
    }
  }
  return problems;
}

describe('choices for sorting again match the book: a book with every kind of sorted item', () => {
  it('has every kind of item, sorted or not sortable', () => {
    const b = sortedBook();
    const resortable = Object.entries(SORTED).filter(([, id]) => b.resortDetail(id)?.resortable === true).map(([name]) => name);
    expect(resortable.sort()).toEqual(
      ['card', 'pending', 'checking', 'split', 'partRefunded', 'fee', 'interest', 'fromSavings', 'oldCardFromSavings', 'friendNeeds', 'friendNotMine', 'friendMomByHand', 'momDifference', 'markedTransferOldCard', 'otherIncome', 'paybackWants', 'notMine', 'lateArrival', 'inSavings', 'refundPayback'].sort(),
    );
    const notResortable = Object.entries(SORTED).filter(([, id]) => b.resortDetail(id)?.resortable === false).map(([name]) => name);
    expect(notResortable.sort()).toEqual(
      ['oldCardFromChecking', 'oldCardHalf', 'momRule', 'paycheck', 'matchedRefund', 'answeredLeftover', 'handMove', 'takenBack', 'dropped', 'markedTransferDeposit', 'halfArrived', 'waiting'].sort(),
    );
  });

  it('4.7 4.2 4.4 5.6 6.1 7.6 13.6 every offered choice is accepted, every other one is refused, and a refusal changes nothing', () => {
    expect(disagreements(sortedBook, Object.values(SORTED), 'sorted book')).toEqual([]);
  });

  it('4.7 asking about an item and then using its choices leaves every bucket recounting', () => {
    const b = sortedBook();
    for (const id of Object.values(SORTED)) b.resortDetail(id);
    expect(b.recountPots()).toEqual(b.pots());
  });
});

// ----- Random simulated lives -----

const LIVES = Number(process.env['SIM_RESORT_LIVES'] ?? count(2, 1));
const FIRST_SEED = Number(process.env['SIM_RESORT_FIRST_SEED'] ?? 1);

// The simulator's bank, day by day, played into a book up to a random day.
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
      // The simulated person sorts what waits, so there is plenty that is sorted.
      for (const item of started.book.reviewItems()) {
        try {
          if (item.type === 'spending') started.book.sort(item.id, { to: item.suggestion === 'savings' ? 'savings' : item.suggestion ?? 'wants' }, TODAY);
          else if (item.type === 'money-in') started.book.sort(item.id, { to: item.reason === 'early-paycheck' ? 'other-income' : item.reason === 'refund' ? 'wants' : 'other-income' }, TODAY);
        } catch {
          // Whatever cannot be sorted that way stays waiting.
        }
      }
      return started.book;
    },
  };
}

describe('choices for sorting again match the book: random simulated lives', () => {
  const seeds = Array.from({ length: LIVES }, (_, i) => FIRST_SEED + i);
  it.each(seeds)('4.7 6.1 7.6 13.6 offered choices and the book agree, life %i', (seed) => {
    const { make, where } = randomDay(seed);
    // The first item of each kind that is on a list.
    const seen = new Set<string>();
    const ids: string[] = [];
    const book = make();
    for (const pot of MOVABLE_POTS) {
      for (const row of book.activity(pot).rows) {
        const key = `${row.what}:${row.resort.resortable ? 'yes' : 'no'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ids.push(row.id);
      }
    }
    expect(disagreements(make, ids, where)).toEqual([]);
  }, 120_000);
});

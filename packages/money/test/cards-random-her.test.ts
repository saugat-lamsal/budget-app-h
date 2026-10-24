// Her rulebook, 52.2 and 52.4 (PR 7+8), in lives shaped like hers: the
// simulator's own bank (sim/bank.ts) keeps each card's balance with its own
// arithmetic, apart from the book. Every day, what each card owes as the
// books count it is what that bank says it owes; and on each card's closing
// day, its statement's lines add up to the balance the bank closed it with,
// with nothing left "Not matched".
import { describe, expect, it } from 'vitest';
import { cardOwes, cardStatementView, owedAtSetup, type BankTransaction, type CardStatement, type Cents, type EverydayCard, type IsoDate, type SetupInput } from '../src/index.js';
import { liveALife } from './sim/life.js';

const SEEDS = Number(process.env['SIM_HER_CARD_SEEDS'] ?? 4);
const YEARS = Number(process.env['SIM_HER_CARD_YEARS'] ?? 1);
const CARDS: readonly EverydayCard[] = ['everyday-card', 'second-card'];

interface Seen {
  owedDays: number;
  statements: number;
  lines: number;
  failures: string[];
}

function liveAndCheck(seed: number): Seen {
  const seen: Seen = { owedDays: 0, statements: 0, lines: 0, failures: [] };
  let setup: SetupInput | null = null;
  // The day the bank posted each transaction: the day it sent it.
  const postedOn = new Map<string, IsoDate>();
  const posted: { 'everyday-card': Cents; 'second-card': Cents } = { 'everyday-card': 0, 'second-card': 0 };
  const closing: CardStatement[] = [];
  const last: Partial<Record<EverydayCard, CardStatement>> = {};
  const note = (feed: readonly BankTransaction[], date: IsoDate): void => {
    for (const txn of feed) postedOn.set(txn.id, date);
  };
  const result = liveALife({
    seed,
    years: YEARS,
    profile: 'her',
    record: {
      setupDay: ({ input, feed }) => {
        setup = input;
        for (const txn of feed) postedOn.set(txn.id, txn.date);
      },
      day: (day) => {
        note(day.feed, day.date);
        posted['everyday-card'] = day.posted.everydayCard;
        posted['second-card'] = day.posted.secondCard ?? 0;
        // A statement as the bank would close it at the end of its closing
        // day: everything posted through that day, nothing pending.
        for (const s of day.statements) if (s.card === 'everyday-card' || s.card === 'second-card') closing.push({ ...s, statementBalance: posted[s.card] });
      },
      endOfDay: ({ date, book, balances }) => {
        if (setup === null) throw new Error('no setup day');
        for (const card of CARDS) {
          const bank = card === 'everyday-card' ? balances.everydayCard : (balances.secondCard ?? 0);
          const owes = cardOwes(book, card, owedAtSetup(setup, card));
          seen.owedDays++;
          if (owes !== bank) seen.failures.push(`seed ${seed}, ${date}: ${card} owes ${owes} by the books, ${bank} at the bank`);
        }
        for (const statement of closing.splice(0)) {
          const card = statement.card as EverydayCard;
          const view = cardStatementView({ statement, before: last[card] ?? null, book, postedOn: (id) => postedOn.get(id) ?? null });
          last[card] = statement;
          seen.statements++;
          seen.lines += view.byBucket.reduce((n, g) => n + g.items.length, 0);
          const byBucket = view.byBucket.reduce((s, g) => s + g.total, 0);
          const byPeriod = view.byPayPeriod.reduce((s, g) => s + g.total, 0);
          if (view.notMatched !== 0 || byBucket !== view.charges || byPeriod !== view.charges || view.carriedIn.amount + view.charges + view.notMatched !== statement.statementBalance) {
            seen.failures.push(`seed ${seed}, ${card} statement of ${statement.closingDate}: not matched ${view.notMatched}, by bucket ${byBucket}, by pay period ${byPeriod}, purchases ${view.charges}`);
          }
        }
      },
    },
  });
  if (!result.ok) seen.failures.push(`seed ${seed}: the life itself failed on ${result.date}: ${result.message}`);
  return seen;
}

describe('52.2 and 52.4 in lives shaped like hers', () => {
  it(`52.2 every day, what each card owes as the books count it is what the bank says it owes, and 52.4 every statement adds up with nothing not matched (${SEEDS} lives of ${YEARS} years)`, { timeout: 600_000 }, () => {
    const all = Array.from({ length: SEEDS }, (_, i) => liveAndCheck(i + 1));
    expect(all.flatMap((s) => s.failures)).toEqual([]);
    // The lives did what the test is about.
    expect(all.reduce((n, s) => n + s.owedDays, 0)).toBeGreaterThan(SEEDS * YEARS * 365);
    expect(all.reduce((n, s) => n + s.statements, 0)).toBeGreaterThan(SEEDS * YEARS * 20);
    expect(all.reduce((n, s) => n + s.lines, 0)).toBeGreaterThan(SEEDS * YEARS * 200);
  });
});

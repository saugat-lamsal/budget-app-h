import { formatDollars, type Cents } from '@budget-app/money';
import type { Db } from '../db/database.js';
import type { HerTotals, Totals } from './history.js';
import { acceptRetotal, checkRetotal } from './retotal.js';

// npm run replay-check (QUESTIONS.md A28): what it says and asks, apart from
// the terminal, so a test can answer for him.

export interface ReplayCheckInput {
  readonly db: Db;
  readonly now: () => Date;
  readonly print: (line: string) => void;
  // Asks him something and gives back what he typed.
  readonly ask: (question: string) => Promise<string>;
}

export type ReplayCheckResult = 'nothing to do' | 'cannot replay' | 'left as it was' | 'taken';

const NAMES: Readonly<Record<keyof HerTotals, string>> = {
  savings: 'Savings',
  needs: 'Needs',
  wants: 'Wants',
  momReserve: 'Mom reserve',
  heldForOthers: 'Held for others',
  wishlist: 'Wishlist',
  unsortedIn: 'Money in waiting in Review',
  unsortedOut: 'Spending waiting in Review',
  oldCardDebt: 'Old card owes',
  inTransit: 'In transit',
  waiting: 'Items waiting in Review',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function day(date: string): string {
  const [year, month, d] = date.split('-').map(Number);
  return `${MONTHS[(month ?? 1) - 1] ?? ''} ${d ?? ''}, ${year ?? ''}`;
}

function value(key: keyof HerTotals, n: number): string {
  return key === 'waiting' ? String(n) : formatDollars(n as Cents);
}

// What differs between two totals, one line each.
export function totalsChanges(before: Totals | null, after: Totals | null): string[] {
  if (before === null || after === null) return [`Totals: ${before === null ? 'none' : 'saved'} → ${after === null ? 'none' : 'new'}`];
  const was = before as HerTotals;
  const now = after as HerTotals;
  return (Object.keys(NAMES) as (keyof HerTotals)[]).filter((key) => was[key] !== now[key]).map((key) => `${NAMES[key]}: ${value(key, was[key] ?? 0)} → ${value(key, now[key] ?? 0)}`);
}

export async function runReplayCheck(input: ReplayCheckInput): Promise<ReplayCheckResult> {
  const { db, print } = input;
  const found = checkRetotal(db);
  if (found.state === 'same') {
    print('Every event replays to the totals saved with it. Nothing to do; npm run serve starts as usual.');
    return 'nothing to do';
  }
  if (found.state === 'cannot-replay') {
    print(`Event ${found.at.seq}, ${day(found.at.date)} (${found.at.what}) cannot be replayed now: ${found.why}.`);
    print('New totals cannot fix that, so there is nothing to take. Nothing was changed, and the server stays stopped.');
    return 'cannot replay';
  }
  print(`The history does not replay to the totals saved with it. ${found.events.length === 1 ? '1 event' : `${found.events.length} events`} would change:`);
  for (const e of found.events) {
    print('');
    print(`Event ${e.seq}, ${day(e.date)}: ${e.what}`);
    for (const line of totalsChanges(e.before, e.after)) print(`  ${line}`);
  }
  print('');
  print('This is right only if the money math was fixed on purpose. Nothing has been changed yet.');
  const reply = await input.ask(`Take these new totals from event ${found.events[0]?.seq ?? ''} on? Type yes to take them; anything else leaves everything as it is: `);
  if (reply.trim() !== 'yes') {
    print('Nothing was changed. The server stays stopped until the history replays to what was saved.');
    return 'left as it was';
  }
  const done = acceptRetotal(db, found.key, input.now());
  if (!done.ok) {
    print(done.why);
    return 'left as it was';
  }
  print(`The new totals are saved for ${done.events === 1 ? '1 event' : `${done.events} events`}, and the change log on Settings says so. npm run serve starts again.`);
  return 'taken';
}

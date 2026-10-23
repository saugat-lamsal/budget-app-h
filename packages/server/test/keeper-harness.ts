import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MOVABLE_POTS, type Book, type IsoDate } from '@budget-app/money';
import { openDatabase, type Db } from '../src/db/database.js';
import { Keeper, type KeeperInput } from '../src/history/keeper.js';
import { memoryLog } from '../src/log.js';
import type { ChoiceRequest, ChoiceResponse, SetupResponse } from '../src/views/choice.js';
import { BANK_RULES, connected, type Harness } from './harness.js';

// The real server's books in a database file, so a test can open them again
// as a restart would, and compare. Every name and number is made up.

// New decision numbers, as the phone makes them: each counter its own.
export function decisions(prefix = 'decision'): () => string {
  let made = 0;
  return () => `${prefix}-${String((made += 1)).padStart(4, '0')}`;
}
export const decision = decisions();

// Noon in New York on a day, as the clock would say it.
export const noonInNewYork = (day: IsoDate): Date => new Date(`${day}T16:00:00Z`);

export interface Life {
  readonly h: Harness;
  readonly path: string;
  readonly dir: string;
  // The running server's books.
  keeper: Keeper;
  // The clock the books read; tests move it.
  now: Date;
  // Syncs with the made-up bank on today, then the running books read it again.
  sync(): Promise<void>;
  // Opens the books again from the database file, as a restart would, on its own connection.
  reopen(input?: Partial<Omit<KeeperInput, 'db'>>): { readonly keeper: Keeper; readonly db: Db; close(): void };
  // A real restart: the running books stop, and the ones opened again take over.
  restart(input?: Partial<Omit<KeeperInput, 'db'>>): void;
  done(): void;
}

// The made-up bank, connected, with his accounts and bank rules set, before
// setup day; the books kept in a file.
export async function lifeInAFile(options: Parameters<typeof connected>[0] & { readonly beforeCommit?: () => void; readonly push?: KeeperInput['push']; readonly start?: KeeperInput['start'] } = {}): Promise<Life> {
  const dir = mkdtempSync(join(tmpdir(), 'budget-keeper-'));
  const path = join(dir, 'books.sqlite');
  const h = await connected({ rules: BANK_RULES, ...options, path });
  // What setup day starts from, on every restart too (her setup's, or upstream's).
  const start = options.start === undefined ? {} : { start: options.start };
  const life: Life = {
    h,
    path,
    dir,
    now: noonInNewYork(options.today ?? '2026-10-01'),
    keeper: undefined as unknown as Keeper,
    sync: async () => {
      await life.keeper.sync({ plaid: h.plaid, box: h.box, log: memoryLog([]), pageSize: 3 });
    },
    reopen: (input = {}) => {
      const db = openDatabase(path);
      try {
        const keeper = Keeper.open({ db, now: () => life.now, ...start, ...input });
        return { keeper, db, close: () => db.close() };
      } catch (error) {
        db.close();
        throw error;
      }
    },
    restart: (input = {}) => {
      h.db.close();
      const db = openDatabase(path);
      (h as { db: Db }).db = db;
      life.keeper = Keeper.open({ db, now: () => life.now, ...start, ...input });
    },
    done: () => {
      h.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  life.keeper = Keeper.open({ db: h.db, now: () => life.now, ...start, ...(options.beforeCommit === undefined ? {} : { beforeCommit: options.beforeCommit }), ...(options.push === undefined ? {} : { push: options.push }) });
  return life;
}

// Setup day through the books' own Setup day desk, as the screens send it:
// the last paycheck, savings, the mom reserve, wants, and the rest in needs,
// then his yes to what he saw.
export function setUpThroughTheDesk(life: Life, money: { savings?: number; momReserve?: number; wants?: number } = {}): SetupResponse {
  const k = life.keeper;
  const steps = [
    { lastPaycheck: '2026-09-25' },
    { assign: { pot: 'savings' as const, amount: money.savings ?? 400_000 } },
    { assign: { pot: 'momReserve' as const, amount: money.momReserve ?? 100_000 } },
    { assign: { pot: 'wants' as const, amount: money.wants ?? 20_000 } },
    { assign: { pot: 'needs' as const, rest: true as const } },
  ];
  for (const setup of steps) {
    const answer = k.setup({ id: decision(), setup });
    if (!answer.ok) throw new Error(`setup day refused ${JSON.stringify(setup)}: ${answer.why}`);
  }
  const view = k.setupView();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
  return k.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: view.key });
}

// A choice, asked first and then given his yes when it asks.
export function choose(keeper: Keeper, request: Omit<ChoiceRequest, 'id'>, id = decision()): ChoiceResponse {
  const first = keeper.choice({ id, ...request });
  if (!first.ok && first.code === 'needs-confirmation') return keeper.choice({ id, ...request, confirmed: true });
  return first;
}

// Everything the screens can read from a book, for comparing two.
export function everything(book: Book): unknown {
  const periods = book.period().number;
  return {
    pots: book.pots(),
    debt: book.oldCardDebt(),
    inTransit: book.inTransit(),
    settings: book.settings(),
    rules: book.rules(),
    review: book.reviewDetails(),
    purchases: book.purchases(),
    log: book.changeLog(),
    paychecks: book.paychecks(),
    period: book.period(),
    startedWith: book.startedPeriodWith(),
    lastPaycheck: book.lastPaycheckDate(),
    payday: book.paydayReport(),
    activity: MOVABLE_POTS.map((pot) => Array.from({ length: periods }, (_, i) => book.activity(pot, i + 1))),
    summaries: Array.from({ length: periods }, (_, i) => book.periodSummary(i + 1)),
  };
}

// Every screen's numbers, and the book behind them, as plain data.
export function screens(keeper: Keeper): unknown {
  const book = keeper.book();
  return JSON.parse(
    JSON.stringify({
      today: keeper.today(),
      home: keeper.home(),
      buckets: keeper.buckets(),
      review: keeper.review(),
      payday: keeper.payday(),
      settings: keeper.settings(),
      setup: keeper.setupView(),
      activity: MOVABLE_POTS.map((pot) => keeper.activity(pot)),
      book: book === null ? null : everything(book),
    }),
  ) as unknown;
}

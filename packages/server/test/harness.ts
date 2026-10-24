import { DEFAULT_SETTINGS, type Cents, type IsoDate, type Settings, type SortingRule, type StartingPots } from '@budget-app/money';
import { checkBankRules, type BankRule } from '../src/bank/reading.js';
import { connectTestBank } from '../src/connect.js';
import { TokenBox } from '../src/crypto/token-box.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { loadBook, readItems, setAccountRoles, setBankRules } from '../src/db/store.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { setUpTracking, setupPreview, type SetupOutcome } from '../src/setup-day.js';
import { bankStatus } from '../src/status.js';
import { syncBank, type SyncInput, type SyncResult } from '../src/sync/sync.js';
import { ACCOUNT_IDS, FakePlaid, SECOND_BANK, fourAccounts, secondCardAccount, twoBanks } from './fake-plaid.js';

// A bank connection to the made-up test bank, in a database that lives only
// in memory. Every name and number is made up.
export const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
export const SETUP_DAY = '2026-10-01';

// How the made-up bank describes his transfers, payments to people, and card charges.
export const BANK_RULES: readonly BankRule[] = checkBankRules([
  { id: 'chk-to-sav', account: 'checking', contains: 'transfer to SAV 2222', means: 'transfer', other: 'savings' },
  { id: 'sav-from-chk', account: 'savings', contains: 'transfer from CHK 1111', means: 'transfer', other: 'checking' },
  { id: 'sav-to-chk', account: 'savings', contains: 'transfer to CHK 1111', means: 'transfer', other: 'checking' },
  { id: 'chk-from-sav', account: 'checking', contains: 'transfer from SAV 2222', means: 'transfer', other: 'savings' },
  { id: 'chk-pays-everyday', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
  { id: 'chk-pays-old', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
  { id: 'sav-pays-old', account: 'savings', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
  { id: 'sav-pays-everyday', account: 'savings', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
  { id: 'everyday-paid', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'old-paid', account: 'old-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'zelle', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
  { id: 'zelle-from-savings', account: 'savings', contains: 'Zelle payment to', means: 'payment-to-person' },
  { id: 'everyday-interest', account: 'everyday-card', contains: 'INTEREST CHARGE', means: 'card-interest' },
  { id: 'old-interest', account: 'old-card', contains: 'INTEREST CHARGE', means: 'card-interest' },
  { id: 'everyday-fee', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' },
]);

export const SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  paycheckRule: { contains: 'MADEUP CORP PAYROLL' },
  momRule: { contains: 'Zelle payment to MOM MADEUP' },
  leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' },
};

export const SORTING_RULES: readonly SortingRule[] = [
  { id: 'groceries', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'coffee', for: 'purchase', contains: 'COFFEE', bucket: 'wants' },
  { id: 'gas', for: 'purchase', contains: 'GAS STATION', bucket: 'needs' },
];

export interface Harness {
  readonly fake: FakePlaid;
  // Her rulebook, 1.1 (PR 6): her second bank, with her second card; only with twoBanks.
  readonly second?: FakePlaid;
  readonly db: Db;
  readonly lines: LogLine[];
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  sync(today: IsoDate, extra?: Partial<SyncInput>): Promise<SyncResult>;
}

export const POSTED_AT_START = { checking: 300_000, savings: 500_000, everyday: 45_000, old: 300_000 };

// Connected, with the first sync done and his accounts and bank rules set.
export async function connected(
  // path: a database file, for tests that open it again (a restart); in memory otherwise.
  // herSetup: her setup's picks (1.2, "Off in this setup"): the old card is never picked, so its account is never read;
  // her second card is (secondCard: what it owes at the start, 0 when left out).
  // twoBanks (her setup, PR 6): her second card at a second made-up bank, its
  // own connection, and each sync reads both banks, the first first.
  options: { posted?: typeof POSTED_AT_START; history?: (fake: FakePlaid) => void; rules?: readonly BankRule[]; today?: IsoDate; path?: string; herSetup?: boolean; secondCard?: Cents; twoBanks?: boolean } = {},
): Promise<Harness> {
  const today = options.today ?? SETUP_DAY;
  const her = options.herSetup === true;
  const two = her && options.twoBanks === true;
  const fake = new FakePlaid([...fourAccounts(options.posted ?? POSTED_AT_START), ...(her && !two ? [secondCardAccount(options.secondCard ?? 0)] : [])]);
  const second = two ? new FakePlaid([secondCardAccount(options.secondCard ?? 0)], SECOND_BANK) : undefined;
  options.history?.(second === undefined ? fake : bothBanks(fake, second));
  const db = openDatabase(options.path ?? ':memory:');
  const lines: LogLine[] = [];
  const log = memoryLog(lines, [fake.clientId, fake.secret]);
  const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: second === undefined ? fake.fetch : twoBanks(fake, second), log });
  const box = new TokenBox(TOKEN_KEY);
  await connectTestBank({ db, plaid, box, log, today, institutionId: 'ins_109508', ...(two ? { name: 'Made-up First Bank' } : {}) });
  if (second !== undefined) await connectTestBank({ db, plaid, box, log, today, institutionId: second.institutionId, bank: 2, name: 'Made-up Second Bank' });
  const sync = async (day: IsoDate, extra: Partial<SyncInput> = {}): Promise<SyncResult> => {
    const first = await syncBank({ db, plaid, box, log, today: day, pageSize: 3, ...extra });
    if (second === undefined) return first;
    const other = await syncBank({ db, plaid, box, log, today: day, pageSize: 3, ...extra, bank: 2 });
    return { ...other, changed: first.changed || other.changed, sent: first.sent + other.sent, attention: [...first.attention, ...other.attention] };
  };
  await sync(today);
  setAccountRoles(db, {
    [ACCOUNT_IDS.checking]: 'checking',
    [ACCOUNT_IDS.savings]: 'savings',
    [ACCOUNT_IDS.everyday]: 'everyday-card',
    ...(her ? { [ACCOUNT_IDS.second]: 'second-card' as const } : { [ACCOUNT_IDS.old]: 'old-card' as const }),
  });
  setBankRules(db, options.rules ?? BANK_RULES, today);
  return { fake, ...(second === undefined ? {} : { second }), db, lines, plaid, box, sync };
}

// Her rulebook, 1.1 (PR 6): her two made-up banks as one, for whatever puts
// activity on them: each item goes to the bank its account is at (her second
// card is at the second), and a change to an item to the bank that has it.
export function bothBanks(first: FakePlaid, second: FakePlaid): FakePlaid {
  const at = (account: string): FakePlaid => (account === ACCOUNT_IDS.second ? second : first);
  const holding = (id: string): FakePlaid => (second.transactions.has(id) ? second : first);
  const both: Pick<FakePlaid, 'addPending' | 'addPosted' | 'postPending' | 'postInPlace' | 'dropPending' | 'modify' | 'removePosted' | 'drift' | 'setStatement' | 'posted'> = {
    addPending: (input) => at(input.account).addPending(input),
    addPosted: (input, o) => at(input.account).addPosted(input, o),
    postPending: (id, posted, o) => holding(id).postPending(id, posted, o),
    postInPlace: (id, changes) => holding(id).postInPlace(id, changes),
    dropPending: (id) => holding(id).dropPending(id),
    modify: (id, patch) => holding(id).modify(id, patch),
    removePosted: (id, o) => holding(id).removePosted(id, o),
    drift: (account, cents) => at(account).drift(account, cents),
    setStatement: (account, statement) => at(account).setStatement(account, statement),
    posted: (account) => at(account).posted(account),
  };
  return both as FakePlaid;
}

// Setup day with everything not in savings, the mom reserve, or wants put in needs.
export function setUp(h: Harness, options: { savings?: Cents; momReserve?: Cents; wants?: Cents; inTransit?: readonly string[]; settings?: Settings } = {}): SetupOutcome {
  const inTransit = options.inTransit ?? [];
  const money = setupPreview(h.db, inTransit).startingMoney;
  const savings = options.savings ?? 400_000;
  const momReserve = options.momReserve ?? 100_000;
  const wants = options.wants ?? 20_000;
  const assignment: StartingPots = { savings, momReserve, wants, heldForOthers: 0, needs: money - savings - momReserve - wants };
  return setUpTracking(h.db, {
    today: SETUP_DAY,
    assignment,
    lastPaycheckDate: '2026-09-25',
    settings: options.settings ?? SETTINGS,
    rules: SORTING_RULES,
    inTransit,
  });
}

// Connected and set up, ready for new activity.
export async function tracking(options: Parameters<typeof connected>[0] = {}): Promise<Harness> {
  const h = await connected(options);
  const outcome = setUp(h);
  if (!outcome.ok) throw new Error('setup did not add up');
  return h;
}

export function status(h: Harness): ReturnType<typeof bankStatus> {
  return bankStatus(h.db);
}

export function book(h: Harness): NonNullable<ReturnType<typeof loadBook>> {
  const b = loadBook(h.db);
  if (b === null) throw new Error('not set up');
  return b;
}

export function itemStatus(h: Harness, id: string): string | undefined {
  return readItems(h.db).get(id)?.status;
}

// Everything in the database, for checking that nothing changed.
export function dump(db: Db): Record<string, unknown[]> {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  return Object.fromEntries(tables.map((name) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}

// Every example in packages/server/worked-examples-h.txt (her setup) is also
// a test. The expected numbers come from its "Check:" lines, so the file
// checked by hand and the test can never drift apart.
import { readFileSync } from 'node:fs';
import { bankSide, parseDollars, type Cents } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_IDS, type FakePlaid } from './fake-plaid.js';
import { checkBankRules } from '../src/bank/reading.js';
import { HER_START } from '../src/setup-start.js';
import { bankView } from '../src/bank/balances.js';
import { readAccounts, readItems } from '../src/db/store.js';
import { bankStatus } from '../src/status.js';
import { HER_BANK_RULES, finderLife, herLife, setUpHer } from './her-harness.js';
import { choose, decision, lifeInAFile, noonInNewYork, type Life } from './keeper-harness.js';

const text = readFileSync(new URL('../worked-examples-h.txt', import.meta.url), 'utf8');

interface Example {
  readonly number: number;
  readonly title: string;
  readonly checks: Map<string, Cents>;
}

function readExamples(): Example[] {
  return text
    .split(/^EXAMPLE /m)
    .slice(1)
    .map((block) => {
      const header = /^(\d+)\.\s+([\s\S]*?)\n=+/m.exec(block);
      if (header === null) throw new Error(`an example with no number: ${block.slice(0, 80)}`);
      const checks = new Map<string, Cents>();
      for (const line of block.matchAll(/^Check: (.*)$/gm)) {
        for (const part of (line[1] ?? '').split('|')) {
          const m = /^\s*([a-z][a-z ]*?)\s+(-?[\d,]+\.\d{2})\s*$/.exec(part);
          if (m === null) throw new Error(`cannot read "${part}" in example ${header[1]}`);
          checks.set(m[1] ?? '', parseDollars(m[2] ?? ''));
        }
      }
      return { number: Number(header[1]), title: (header[2] ?? '').replace(/\s+/g, ' ').trim(), checks };
    });
}

// Each example, played on the real server's books as the text describes it.
const examples: Record<number, () => Promise<Record<string, Cents>>> = {
  1: async () => {
    const life = await herLife();
    try {
      setUpHer(life);
      const id = decision();
      const settings = { paycheckRule: { contains: 'MADEUP CORP PAYROLL' } };
      const asked = life.keeper.settingsChange({ id, settings });
      if (asked.ok || asked.preview === undefined) throw new Error('the paycheck rule was not asked about');
      if (!life.keeper.settingsChange({ id, settings, confirmed: true, seen: asked.preview.key }).ok) throw new Error('the paycheck rule was not set');
      life.h.fake.addPosted({ id: 'pay-1', account: ACCOUNT_IDS.checking, amount: -250_000, date: '2026-10-09', description: 'MADEUP CORP PAYROLL DIRECT DEP' });
      life.now = noonInNewYork('2026-10-09');
      await life.sync();
      const waiting = life.keeper.home();
      if (waiting.state !== 'tracking' || !waiting.safeToSpend.shown) throw new Error('safe to spend is not shown while it waits');
      const card = waiting.attention.find((a) => a.kind === 'paycheck-waiting');
      const posted = (account: string): Cents => life.h.fake.accounts.get(account)?.posted ?? 0;
      const bank = bankSide({ checking: posted(ACCOUNT_IDS.checking), savings: posted(ACCOUNT_IDS.savings), everydayCard: posted(ACCOUNT_IDS.everyday) });
      const book = life.keeper.book();
      const appSide = book?.appSide() ?? 0;
      life.now = noonInNewYork('2026-10-11');
      if (!choose(life.keeper, { item: 'pay-1', choice: { to: 'paycheck' } }).ok) throw new Error('her yes was refused');
      const after = life.keeper.home();
      const payday = life.keeper.payday();
      if (after.state !== 'tracking' || !after.safeToSpend.shown || payday.state !== 'tracking' || payday.toSavings.state !== 'known') throw new Error('not shown after her yes');
      const pots = life.keeper.book()?.pots();
      return {
        'waiting on home': card?.kind === 'paycheck-waiting' ? card.amount : -1,
        'safe to spend while waiting': waiting.safeToSpend.amount,
        'app side while waiting': appSide,
        'bank side while waiting': bank,
        'savings after yes': pots?.savings ?? -1,
        'needs after yes': pots?.needs ?? -1,
        'wants after yes': pots?.wants ?? -1,
        'safe to spend after yes': after.safeToSpend.amount,
        'still to move': payday.toSavings.transfer.stillToMove,
      };
    } finally {
      life.done();
    }
  },
  // PR 5: her second card.
  2: async () => {
    const life = await lifeInAFile({ herSetup: true, secondCard: 25_000, rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]), start: HER_START });
    try {
      life.h.fake.addPending({ id: 'cafe-1', account: ACCOUNT_IDS.second, amount: 1_250, date: '2026-10-01', description: 'MADE UP CAFE' });
      await life.sync();
      const view = life.keeper.setupView();
      if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
      const startingMoney = view.startingMoney;
      setUpHer(life);
      const needs = life.keeper.book()?.pots().needs ?? -1;
      life.h.fake.postPending('cafe-1', { id: 'cafe-1-posted', date: '2026-10-05' });
      life.h.fake.addPosted({ id: 'pay-out', account: ACCOUNT_IDS.checking, amount: 10_000, date: '2026-10-05', description: 'Online payment to CRD 5555' });
      life.now = noonInNewYork('2026-10-05');
      await life.sync();
      const left = checkOf(life);
      life.h.fake.addPosted({ id: 'pay-in', account: ACCOUNT_IDS.second, amount: -10_000, date: '2026-10-06', description: 'PAYMENT - THANK YOU' });
      life.now = noonInNewYork('2026-10-06');
      await life.sync();
      const landed = checkOf(life);
      return {
        'starting money': startingMoney,
        needs,
        'in transit after it leaves': left.inTransit,
        'difference after it leaves': left.difference,
        'bank side after it lands': landed.bankSide,
        'difference after it lands': landed.difference,
        'second card counted after it lands': life.h.fake.posted(ACCOUNT_IDS.second),
        'needs after it lands': life.keeper.book()?.pots().needs ?? -1,
      };
    } finally {
      life.done();
    }
  },
};

// PR 6: her two banks, the second not read for a day.
examples[3] = async () => {
  const life = await lifeInAFile({ herSetup: true, twoBanks: true, secondCard: 25_000, rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]), start: HER_START });
  const second = life.h.second;
  if (second === undefined) throw new Error('her second bank is not there');
  const down: FakePlaid['beforeCall'] = (endpoint) =>
    endpoint === '/transactions/sync' ? { status: 400, body: { error_type: 'INSTITUTION_ERROR', error_code: 'INSTITUTION_DOWN', error_message: 'made-up', display_message: null, request_id: 'r' } } : undefined;
  const status = (): { readonly bankSide: Cents; readonly difference: Cents; readonly shown: Cents | null; readonly catchingUp: boolean } => {
    const home = life.keeper.home();
    const check = bankStatusOf(life);
    if (home.state !== 'tracking') throw new Error('not tracking');
    const safe = home.safeToSpend;
    return { bankSide: check.bankSide, difference: check.difference, shown: safe.shown ? safe.amount : null, catchingUp: !safe.shown && safe.why === 'totals-do-not-match' && safe.catchingUp };
  };
  try {
    const view = life.keeper.setupView();
    if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
    const startingMoney = view.startingMoney;
    setUpHer(life);
    life.h.fake.addPosted({ id: 'grocery-1', account: ACCOUNT_IDS.everyday, amount: 4_000, date: '2026-10-02', description: 'MADE UP GROCERY' });
    second.addPosted({ id: 'cafe-1', account: ACCOUNT_IDS.second, amount: 2_500, date: '2026-10-02', description: 'MADE UP CAFE' });
    second.beforeCall = down;
    life.now = noonInNewYork('2026-10-02');
    await life.sync().catch(() => undefined);
    const notRead = status();
    second.beforeCall = undefined;
    life.now = noonInNewYork('2026-10-03');
    await life.sync();
    const bothRead = status();
    life.h.fake.drift(ACCOUNT_IDS.checking, -1_000);
    second.beforeCall = down;
    life.now = noonInNewYork('2026-10-04');
    await life.sync().catch(() => undefined);
    const waits = status();
    if (!waits.catchingUp) throw new Error('the check does not wait for the second bank');
    return {
      'starting money': startingMoney,
      'bank side with the second bank not read': notRead.bankSide,
      'difference with the second bank not read': notRead.difference,
      'safe to spend with the second bank not read': notRead.shown ?? -1,
      'bank side once both are read': bothRead.bankSide,
      'safe to spend once both are read': bothRead.shown ?? -1,
      'difference while it waits': waits.difference,
    };
  } finally {
    life.done();
  }
};

// PR 9: a Wishlist purchase, on Buckets and Home (50.4).
examples[4] = async () => {
  const life = await herLife();
  try {
    const k = life.keeper;
    for (const setup of [
      { lastPaycheck: '2026-09-25' },
      { assign: { pot: 'savings' as const, amount: parseDollars('4,000.00') } },
      { assign: { pot: 'wishlist' as const, amount: parseDollars('300.00') } },
      { assign: { pot: 'wants' as const, amount: parseDollars('200.00') } },
      { assign: { pot: 'needs' as const, rest: true as const } },
    ]) {
      const answer = k.setup({ id: decision(), setup });
      if (!answer.ok) throw new Error(answer.why);
    }
    const view = k.setupView();
    if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
    const started = k.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: view.key });
    if (!started.ok) throw new Error(started.why);
    life.h.fake.addPosted({ id: 'gadget-1', account: ACCOUNT_IDS.everyday, amount: parseDollars('50.00'), date: '2026-10-03', description: 'MADE UP GADGETS' });
    life.now = noonInNewYork('2026-10-03');
    await life.sync();
    const sorted = choose(k, { item: 'gadget-1', choice: { to: 'wishlist' } });
    if (!sorted.ok) throw new Error(sorted.why);
    const buckets = k.buckets();
    const home = k.home();
    const toMove = home.state === 'tracking' && 'wishlistMove' in home ? (home.wishlistMove?.amount ?? 0) : 0;
    life.h.fake.addPosted({ id: 'move-out', account: ACCOUNT_IDS.savings, amount: parseDollars('50.00'), date: '2026-10-06', description: 'Online transfer to CHK 1111' });
    life.h.fake.addPosted({ id: 'move-in', account: ACCOUNT_IDS.checking, amount: -parseDollars('50.00'), date: '2026-10-06', description: 'Online transfer from SAV 2222' });
    life.now = noonInNewYork('2026-10-06');
    await life.sync();
    const after = k.home();
    return {
      'wishlist on buckets': buckets.state === 'tracking' ? (buckets.wishlist ?? -1) : -1,
      'to move on home': toMove,
      'savings account after the move': life.h.fake.posted(ACCOUNT_IDS.savings),
      'to move after the move': after.state === 'tracking' && 'wishlistMove' in after ? (after.wishlistMove?.amount ?? -1) : 0,
      'wishlist after the move': k.book()?.pots().wishlist ?? -1,
    };
  } finally {
    life.done();
  }
};

// PR 10+11: Trends with Wishlist (40.2, 40.4, 40.5, 40.7).
examples[5] = async () => {
  const life = await herLife();
  try {
    const k = life.keeper;
    for (const setup of [
      { lastPaycheck: '2026-09-25' },
      { assign: { pot: 'savings' as const, amount: parseDollars('4,000.00') } },
      { assign: { pot: 'wishlist' as const, amount: parseDollars('300.00') } },
      { assign: { pot: 'wants' as const, amount: parseDollars('200.00') } },
      { assign: { pot: 'needs' as const, rest: true as const } },
    ]) {
      const answer = k.setup({ id: decision(), setup });
      if (!answer.ok) throw new Error(answer.why);
    }
    const view = k.setupView();
    if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
    const started = k.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: view.key });
    if (!started.ok) throw new Error(started.why);
    life.h.fake.addPosted({ id: 'lamp', account: ACCOUNT_IDS.everyday, amount: parseDollars('45.00'), date: '2026-10-03', description: 'MADE UP LAMPS' });
    life.h.fake.addPosted({ id: 'cafe', account: ACCOUNT_IDS.everyday, amount: parseDollars('12.50'), date: '2026-10-03', description: 'MADE UP COFFEE' });
    life.h.fake.addPosted({ id: 'big-box', account: ACCOUNT_IDS.everyday, amount: parseDollars('90.00'), date: '2026-10-04', description: 'MADE UP BIG BOX' });
    life.now = noonInNewYork('2026-10-04');
    await life.sync();
    for (const [item, choice] of [
      ['lamp', { to: 'wishlist' }],
      ['cafe', { to: 'wants' }],
      ['big-box', { split: [{ bucket: 'needs', amount: parseDollars('70.00') }, { bucket: 'wishlist', amount: 'rest' }] }],
    ] as const) {
      const sorted = choose(k, { item, choice });
      if (!sorted.ok) throw new Error(sorted.why);
    }
    const trends = k.trends();
    if (trends.state !== 'tracking') throw new Error('not tracking');
    const here = trends.periods[trends.periods.length - 1];
    if (here === undefined || here.spent['old-card'] !== 0) throw new Error('no pay period, or an old card payment');
    return {
      'needs part': here.spent.needs,
      'wants part': here.spent.wants,
      'wishlist part': here.spent.wishlist ?? -1,
      'spent in all': here.total,
      'wishlist at the start': trends.savings[0]?.wishlist ?? -1,
      'wishlist now': trends.savings[trends.savings.length - 1]?.wishlist ?? -1,
      'spent so far against your usual': trends.now.spentSoFar,
    };
  } finally {
    life.done();
  }
};

// PR 12b: Capital One holds a purchase Plaid does not list (12.1, HA8).
examples[6] = async () => {
  const life = await herLife();
  try {
    setUpHer(life);
    life.h.fake.holdAvailable(ACCOUNT_IDS.checking, parseDollars('42.10'));
    life.now = noonInNewYork('2026-10-02');
    await life.sync();
    const held = bankStatusOf(life);
    // Upstream's way: the same bank read by the available balance.
    const book = life.keeper.book();
    const available = bankView(readAccounts(life.h.db), readItems(life.h.db));
    if (book === null || !available.ok) throw new Error('no book, or the bank cannot be read');
    const byAvailable = book.selfCheck(available.view.withPending).difference;
    life.h.fake.holdAvailable(ACCOUNT_IDS.checking, 0);
    life.h.fake.addPosted({ id: 'groceries', account: ACCOUNT_IDS.checking, amount: parseDollars('42.10'), date: '2026-10-02', description: 'MADE UP GROCER' });
    life.now = noonInNewYork('2026-10-04');
    await life.sync();
    const posted = bankStatusOf(life);
    return {
      'bank side while held': held.bankSide,
      'difference while held': held.difference,
      'difference by the available balance while held': byAvailable,
      'bank side after it posts': posted.bankSide,
      'difference after it posts': posted.difference,
    };
  } finally {
    life.done();
  }
};

// PR 13: the rule finder on her setup day (53.2, 53.3, 53.6, 53.7).
examples[7] = async () => {
  const life = await finderLife();
  try {
    const view = life.keeper.setupView();
    if (view.state !== 'not-set-up' || !view.ready || view.found === undefined) throw new Error('no rule finder');
    const found = view.found;
    const total = (contains: string): Cents => {
      const line = found.find((l) => l.rule.contains === contains);
      if (line === undefined) throw new Error(`no suggestion "${contains}"`);
      return line.matches.items.reduce((sum, i) => sum + i.amount, 0);
    };
    return {
      'capital one side in all': total('TO CRD 0412'),
      'amex side in all': total('EPAY TO AMEX ACH'),
      'paychecks in all': total('MADEUP CORP PAYROLL PPD ID 4455'),
      'green leaf in all': total('GREEN LEAF MARKET'),
    };
  } finally {
    life.done();
  }
};

// From her rehearsal: statements she paid before setup day (9.3, 60i).
examples[8] = async () => {
  const statement = (balance: number) => ({ is_overdue: false, last_payment_amount: null, last_payment_date: null, last_statement_issue_date: '2026-09-20', last_statement_balance: balance, minimum_payment_amount: 35, next_payment_due_date: '2026-10-15' });
  const life = await lifeInAFile({
    herSetup: true,
    secondCard: 25_000,
    rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]),
    start: HER_START,
    history: (fake) => {
      fake.setStatement(ACCOUNT_IDS.everyday, statement(450));
      fake.setStatement(ACCOUNT_IDS.second, statement(250));
      fake.addPosted({ id: 'pay-cap', account: ACCOUNT_IDS.checking, amount: parseDollars('450.00'), date: '2026-09-25', description: 'payment to CRD 3333' });
      fake.addPosted({ id: 'paid-cap', account: ACCOUNT_IDS.everyday, amount: -parseDollars('450.00'), date: '2026-09-25', description: 'PAYMENT - THANK YOU' });
      fake.addPosted({ id: 'pay-amex', account: ACCOUNT_IDS.checking, amount: parseDollars('100.00'), date: '2026-09-25', description: 'payment to CRD 5555' });
      fake.addPosted({ id: 'paid-amex', account: ACCOUNT_IDS.second, amount: -parseDollars('100.00'), date: '2026-09-25', description: 'PAYMENT - THANK YOU' });
    },
  });
  try {
    setUpHer(life);
    life.now = noonInNewYork('2026-10-08');
    await life.sync();
    const home = life.keeper.home();
    if (home.state !== 'tracking' || home.cards === undefined) throw new Error('no cards on Home');
    const [cap, amex] = home.cards.cards.map((c) => c.statement);
    if (cap === undefined || amex === undefined || !cap.shown || !amex.shown) throw new Error('a statement is not shown');
    if (cap.state.kind !== 'paid' || amex.state.kind !== 'due' || amex.state.daysLeft !== 7) throw new Error(`not as the example says: ${cap.state.kind}, ${amex.state.kind}`);
    if (home.attention.some((a) => a.kind === 'card-due' && a.card === 'everyday-card')) throw new Error('a due line for the paid card');
    life.now = noonInNewYork('2026-10-16');
    await life.sync();
    const after = life.keeper.home();
    if (after.state !== 'tracking' || after.attention.some((a) => a.kind === 'card-overdue')) throw new Error('overdue after the due date');
    return {
      'capital one paid toward it': cap.paid,
      'capital one left to pay': cap.statementBalance - cap.paid,
      'amex paid toward it': amex.paid,
      'amex left to pay': amex.statementBalance - amex.paid,
    };
  } finally {
    life.done();
  }
};

// The self-check against each bank's latest good read, as saved (12.3).
function bankStatusOf(life: Life): { readonly bankSide: Cents; readonly difference: Cents } {
  const check = bankStatus(life.h.db).selfCheck;
  if (check === null) throw new Error('no self-check');
  return check;
}

const SECOND_CARD_RULES = checkBankRules([
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);

// The self-check as Home shows it (12.3): safe to spend is shown only when it matches.
function checkOf(life: Life): { readonly bankSide: Cents; readonly inTransit: Cents; readonly difference: Cents } {
  const book = life.keeper.book();
  const home = life.keeper.home();
  if (book === null || home.state !== 'tracking') throw new Error('not tracking');
  const posted = (account: string): Cents => life.h.fake.posted(account);
  const check = book.selfCheck({ checking: posted(ACCOUNT_IDS.checking), savings: posted(ACCOUNT_IDS.savings), everydayCard: posted(ACCOUNT_IDS.everyday), secondCard: posted(ACCOUNT_IDS.second) });
  if (home.safeToSpend.shown !== check.ok) throw new Error('Home and the self-check disagree');
  return check;
}

describe('worked examples, her setup: the screens (worked-examples-h.txt)', () => {
  const all = readExamples();

  it('every example in the file has a test, and every test has an example', () => {
    expect(all.map((e) => e.number)).toEqual(Object.keys(examples).map(Number));
  });

  for (const example of all) {
    it(`Example ${example.number}: ${example.title}`, async () => {
      const run = examples[example.number];
      expect(run, `no test for example ${example.number}`).toBeDefined();
      const actual = (await run?.()) ?? {};
      for (const [name, expected] of example.checks) expect(actual[name], `"${name}" in example ${example.number}`).toBe(expected);
    });
  }
});

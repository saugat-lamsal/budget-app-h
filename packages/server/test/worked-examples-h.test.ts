// Every example in packages/server/worked-examples-h.txt (her setup) is also
// a test. The expected numbers come from its "Check:" lines, so the file
// checked by hand and the test can never drift apart.
import { readFileSync } from 'node:fs';
import { bankSide, parseDollars, type Cents } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { checkBankRules } from '../src/bank/reading.js';
import { HER_START } from '../src/setup-start.js';
import { HER_BANK_RULES, herLife, setUpHer } from './her-harness.js';
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

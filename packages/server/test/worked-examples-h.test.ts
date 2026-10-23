// Every example in packages/server/worked-examples-h.txt (her setup) is also
// a test. The expected numbers come from its "Check:" lines, so the file
// checked by hand and the test can never drift apart.
import { readFileSync } from 'node:fs';
import { bankSide, parseDollars, type Cents } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { herLife, setUpHer } from './her-harness.js';
import { choose, decision, noonInNewYork } from './keeper-harness.js';

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
};

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

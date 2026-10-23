// Every example in worked-examples-h.txt (her setup) is also a test. The
// expected numbers come from the "Check:" line in the text file itself, as
// in worked-examples.test.ts, so the file checked by hand and the test can
// never drift apart.
import { describe, expect, it } from 'vitest';
import { HER_SETTINGS, HER_SWITCHES, changeSettings, openBook, parseDollars, type Book, type Cents } from '../src/index.js';
import text from '../worked-examples-h.txt?raw';
import { LAST_PAYCHECK, PAYROLL, START_DATE, ZERO_POTS, deposit, paycheck, purchase } from './helpers.js';

interface Example {
  number: number;
  title: string;
  checks: Map<string, Cents>;
}

function readExamples(): Example[] {
  const blocks = text.split(/^EXAMPLE /m).slice(1);
  return blocks.map((block) => {
    const header = /^(\d+)\.\s+(.*)$/m.exec(block);
    const checkLines = [...block.matchAll(/^Check: (.*)$/gm)].map((m) => m[1] ?? '');
    if (!header || checkLines.length === 0) throw new Error(`example is missing its number or Check line:\n${block.slice(0, 200)}`);
    const checks = new Map<string, Cents>();
    for (const part of checkLines.join(' | ').split('|')) {
      const m = /^\s*([a-z][a-z ]*?)\s+(-?[\d,]+\.\d{2})\s*$/.exec(part);
      if (!m) throw new Error(`cannot read "${part}" in example ${header[1]}`);
      checks.set(m[1] ?? '', parseDollars(m[2] ?? ''));
    }
    return { number: Number(header[1]), title: header[2] ?? '', checks };
  });
}

// Her setup: no mom reserve and no old card, her starting settings, and the
// paycheck rule set.
function herBook(pots: Partial<Record<keyof typeof ZERO_POTS, Cents>> = {}): Book {
  return openBook({
    date: START_DATE,
    lastPaycheckDate: LAST_PAYCHECK,
    oldCardDebt: 0,
    pots: { ...ZERO_POTS, ...pots },
    settings: changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL } }),
    switches: HER_SWITCHES,
  });
}

function buckets(book: Book): Record<string, Cents> {
  const p = book.pots();
  return {
    savings: p.savings,
    needs: p.needs,
    wants: p.wants,
    'mom reserve': p.momReserve,
    'held for others': p.heldForOthers,
    'unsorted money in': p.unsortedIn,
    'unsorted spending': p.unsortedOut,
    'app side': book.appSide(),
  };
}

// Each example, set up in code exactly as the text describes it.
const examples: Record<number, () => Record<string, Cents>> = {
  1: () => {
    const book = herBook();
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,345.67')));
    return buckets(book);
  },
  2: () => {
    const book = herBook();
    book.receive(paycheck('pay', '2026-10-09', parseDollars('0.01')));
    return buckets(book);
  },
  3: () => {
    const book = herBook({ savings: parseDollars('4,000.00'), needs: parseDollars('1,000.00'), wants: parseDollars('200.00') });
    book.receive(deposit('friend', '2026-10-02', parseDollars('60.00'), 'MADE UP FRIEND'));
    book.receive(purchase('shop', '2026-10-02', parseDollars('12.50')));
    return buckets(book);
  },
};

describe('worked examples, her setup (worked-examples-h.txt)', () => {
  const all = readExamples();

  it('every example in the file has a test, and every test has an example', () => {
    expect(all.map((e) => e.number)).toEqual(Object.keys(examples).map(Number));
  });

  for (const example of all) {
    it(`Off in this setup: Example ${example.number}: ${example.title}`, () => {
      const run = examples[example.number];
      expect(run, `no test for example ${example.number}`).toBeDefined();
      const actual = run?.() ?? {};
      for (const [name, expected] of example.checks) {
        expect(actual[name], `"${name}" in example ${example.number}`).toBe(expected);
      }
    });
  }
});

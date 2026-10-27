// Her rulebook, 53.1 and 13.5: words of the rule finder and of setup day's
// line in the change log, found in her rehearsal (HA10). A place she kept
// says in words which bucket it was kept as, and stops calling it a
// suggestion; setup day's line names what she kept. Every name is made up.
import { describe, expect, it } from 'vitest';
import { ruleMeaning, statusWords } from '../src/screens/rule-finder-text.js';
import { setupDayText } from '../src/screens/setup-day-log-text.js';

const place = (bucket: 'needs' | 'wants' | null) => ({ kind: 'place', contains: 'MADE UP MARKET', bucket }) as const;
const bankRule = { kind: 'bank-rule', account: 'checking', contains: 'ZELLE TO', means: 'payment-to-person', other: null } as const;

describe('53.1 what a kept place was kept as, in words', () => {
  it('53.1 kept as suggested, or with her words: the bucket it was kept as', () => {
    expect(statusWords('added', place('needs'))).toBe('Kept as needs');
    expect(statusWords('changed', place('wants'))).toBe('Kept as wants, with your words');
  });

  it('53.1 the rest say what they said', () => {
    expect(statusWords('open', place('needs'))).toBe('Not answered yet');
    expect(statusWords('skipped', place('needs'))).toBe('Skipped');
    expect(statusWords('covered', place('wants'))).toBe('You have this rule already');
    expect(statusWords('added', bankRule)).toBe('Kept');
    expect(statusWords('changed', bankRule)).toBe('Kept, with your words');
  });

  it('53.7 open, a place says what is suggested; kept, not: the bucket it was kept as is in its status', () => {
    expect(ruleMeaning(place('needs'), false)).toBe('A place you pay often. Suggested: Needs, from your bank’s category.');
    expect(ruleMeaning(place(null), false)).toBe('A place you pay often. Your bank gives it no category, so pick needs or wants.');
    expect(ruleMeaning(place('wants'), true)).toBe('A place you pay often.');
    expect(ruleMeaning(bankRule, true)).toBe(ruleMeaning(bankRule, false));
  });
});

describe('13.5 setup day\'s line in her change log (HA10)', () => {
  const line = { key: 's0-0', date: '2026-10-01', kind: 'setup-day' } as const;

  it('13.5 it names each rule she kept from the finder, and the paycheck rule', () => {
    expect(setupDayText({ ...line, rules: [{ id: 'r1', for: 'purchase', contains: 'MADE UP MARKET', to: 'needs' }], paycheckRule: { contains: 'MADEUP CORP PAYROLL' } })).toBe(
      'Tracking started. Kept from your history: “MADE UP MARKET” → Needs; the paycheck rule “MADEUP CORP PAYROLL”.',
    );
  });

  it('13.5 with nothing kept, only that tracking started', () => {
    expect(setupDayText({ ...line, rules: [], paycheckRule: null })).toBe('Tracking started.');
  });
});

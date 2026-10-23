import type { RecheckedItem } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { reasonText } from '../src/screens/review-text.js';
import { SETTING_NAMES, askPaycheckText, recheckedText, settingValueText, settingsDoneText } from '../src/screens/settings-text.js';

// Her rulebook, PR 4: the words for "Ask before splitting a paycheck" (section
// 2, 3.1, 13.2) on Review and Settings. Every name and number is made up.

const WAITING: RecheckedItem = { kind: 'paycheck-waiting', id: 'p1', date: '2026-10-09', amount: 250_000, description: 'MADEUP CORP PAYROLL', wouldGet: null };

describe('3.1 13.2 the words for a paycheck waiting for her yes', () => {
  it('3.1 Review calls it a paycheck waiting for her yes, not a deposit', () => {
    expect(reasonText({ type: 'money-in', id: 'p1', date: '2026-10-09', amount: 250_000, description: 'MADEUP CORP PAYROLL', reason: 'paycheck' })).toBe('Paycheck waiting for your yes');
    expect(reasonText({ type: 'money-in', id: 'p1', date: '2026-10-09', amount: 250_000, description: 'MADE UP GIFT', reason: 'deposit' })).toBe('Deposit');
  });

  it('Section 2: Settings names the setting and says what on and off do; not set is off, as upstream', () => {
    expect(SETTING_NAMES.askBeforeSplittingPaycheck).toBe('Ask before splitting a paycheck');
    expect(askPaycheckText(true)).toBe('On: every paycheck waits for your yes');
    expect(askPaycheckText(false)).toBe('Off: a paycheck is split by itself');
    expect(askPaycheckText(undefined)).toBe('Off: a paycheck is split by itself');
    expect(settingValueText('askBeforeSplittingPaycheck', true)).toBe('On: every paycheck waits for your yes');
  });

  it('13.2 setting the paycheck rule while asking: what it does to one waiting, and what was done', () => {
    expect(recheckedText(WAITING, 10)).toBe('Becomes a paycheck waiting for your yes in Review. Nothing is split until you say yes.');
    const done = (n: number) => settingsDoneText({ changed: ['paycheckRule'], fromNextPaycheck: false, rechecked: Array.from({ length: n }, (_, i) => ({ ...WAITING, id: `p${i}` })) }, '2026-10-23');
    expect(done(1)).toBe('Saved. A deposit that was waiting is now a paycheck waiting for your yes in Review.');
    expect(done(2)).toBe('Saved. 2 deposits that were waiting are now paychecks waiting for your yes in Review.');
  });
});

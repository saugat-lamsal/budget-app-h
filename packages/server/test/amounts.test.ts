import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { centsFromPlaid } from '../src/bank/amounts.js';
import { BankDataError } from '../src/errors.js';
import { runs } from './slow.js';

// Rule 0.1: all amounts are whole cents. Plaid sends dollars as JSON numbers
// (72.1 for $72.10). Multiplying by 100 in floating point gets some of them
// wrong (4.35 * 100 is 434.99999999999994), so the amount is read from its
// exact decimal text instead, and anything that is not whole cents is refused
// rather than rounded.
describe('0.1 Plaid amounts become whole cents exactly', () => {
  it('0.1 dollars and cents, as Plaid writes them', () => {
    expect(centsFromPlaid(72.1)).toBe(7210);
    expect(centsFromPlaid(100)).toBe(10000);
    expect(centsFromPlaid(-25.75)).toBe(-2575);
    expect(centsFromPlaid(1234567.89)).toBe(123456789);
  });

  it('0.1 the ones floating point gets wrong', () => {
    expect(4.35 * 100).not.toBe(435);
    expect(centsFromPlaid(4.35)).toBe(435);
    expect(centsFromPlaid(1.15)).toBe(115);
    expect(centsFromPlaid(8.2)).toBe(820);
    expect(centsFromPlaid(0.07)).toBe(7);
    const fromJson = JSON.parse('{"amount": 19.99, "refund": -0.29}') as { amount: number; refund: number };
    expect(centsFromPlaid(fromJson.amount)).toBe(1999);
    expect(centsFromPlaid(fromJson.refund)).toBe(-29);
  });

  it('0.1 zero, one cent, and negative zero', () => {
    expect(centsFromPlaid(0)).toBe(0);
    expect(centsFromPlaid(-0)).toBe(0);
    expect(Object.is(centsFromPlaid(-0), -0)).toBe(false);
    expect(centsFromPlaid(0.01)).toBe(1);
    expect(centsFromPlaid(-0.01)).toBe(-1);
  });

  it('0.1 very large amounts stay exact up to the limit, and past it are refused', () => {
    expect(centsFromPlaid(999_999_999_999.99)).toBe(99_999_999_999_999);
    expect(centsFromPlaid(-999_999_999_999.99)).toBe(-99_999_999_999_999);
    expect(() => centsFromPlaid(1_000_000_000_000)).toThrow(BankDataError);
    expect(() => centsFromPlaid(1e21)).toThrow(BankDataError);
  });

  it('0.1 fractions of a cent are refused, not rounded', () => {
    expect(() => centsFromPlaid(12.345)).toThrow(BankDataError);
    expect(() => centsFromPlaid(0.001)).toThrow(BankDataError);
    expect(() => centsFromPlaid(1e-7)).toThrow(BankDataError);
  });

  it('0.1 anything that is not a number is refused', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '12.34', null, undefined, true, {}]) {
      expect(() => centsFromPlaid(bad), String(bad)).toThrow(BankDataError);
    }
  });

  it('0.1 random amounts: any whole number of cents Plaid could write comes back exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: -99_999_999_999_999, max: 99_999_999_999_999 }), (cents) => {
        // How the amount looks in Plaid's JSON, read back the way JSON.parse does.
        const sign = cents < 0 ? '-' : '';
        const abs = Math.abs(cents);
        const dollars = Number(`${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`);
        expect(centsFromPlaid(dollars)).toBe(cents === 0 ? 0 : cents);
      }),
      { numRuns: runs(5000) },
    );
  });
});

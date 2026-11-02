import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, cardDue, cardStanding, type CardPayment, type CardStatement } from '../src/index.js';

// Rule 9.9 (QUESTIONS.md A61): each card's latest statement and where it
// stands, at any time. It says the same thing about what is paid as the
// reminders do (9.3, 9.4), and it never changes when they come.

const EVERYDAY: CardStatement = { card: 'everyday-card', closingDate: '2026-10-01', dueDate: '2026-10-26', statementBalance: 123_456, minimumPayment: 3_500 };
const OLD: CardStatement = { ...EVERYDAY, card: 'old-card', statementBalance: 300_000, minimumPayment: 9_000 };

describe('9.9 a statement and where it stands, at any time', () => {
  it('9.9 long before the first reminder day it is there, with the days to the due date', () => {
    expect(cardDue('2026-10-02', EVERYDAY, [], DEFAULT_SETTINGS)).toBeNull();
    expect(cardStanding('2026-10-02', EVERYDAY, [])).toEqual({ card: 'everyday-card', closingDate: '2026-10-01', dueDate: '2026-10-26', daysLeft: 24, statementBalance: 123_456, minimumPayment: 3_500, paid: 0, standing: 'to-pay' });
  });

  it('9.9 9.2 the old card shows its minimum and no statement balance', () => {
    expect(cardStanding('2026-10-02', OLD, [])).toEqual({ card: 'old-card', closingDate: '2026-10-01', dueDate: '2026-10-26', daysLeft: 24, statementBalance: null, minimumPayment: 9_000, paid: 0, standing: 'to-pay' });
  });

  it('9.9 9.3 the everyday card is paid at the full statement balance, not a cent less', () => {
    expect(cardStanding('2026-10-20', EVERYDAY, [{ date: '2026-10-10', amount: 123_455 }])).toMatchObject({ paid: 123_455, standing: 'to-pay' });
    expect(cardStanding('2026-10-20', EVERYDAY, [{ date: '2026-10-10', amount: 123_456 }])).toMatchObject({ paid: 123_456, standing: 'paid' });
  });

  it('9.9 9.3 the old card is paid at the minimum, not a cent less', () => {
    expect(cardStanding('2026-10-20', OLD, [{ date: '2026-10-10', amount: 8_999 }])).toMatchObject({ paid: 8_999, standing: 'to-pay' });
    expect(cardStanding('2026-10-20', OLD, [{ date: '2026-10-10', amount: 9_000 }])).toMatchObject({ paid: 9_000, standing: 'paid' });
  });

  it('9.9 the due date itself is still to pay, with no days left', () => {
    expect(cardStanding('2026-10-26', EVERYDAY, [])).toMatchObject({ daysLeft: 0, standing: 'to-pay' });
  });

  it('9.9 9.4 the day after the due date, less than the minimum is overdue, by a cent too', () => {
    expect(cardStanding('2026-10-27', EVERYDAY, [])).toMatchObject({ daysLeft: -1, standing: 'overdue' });
    expect(cardStanding('2026-10-27', OLD, [{ date: '2026-10-10', amount: 8_999 }])).toMatchObject({ standing: 'overdue' });
    expect(cardStanding('2026-10-27', OLD, [{ date: '2026-10-10', amount: 9_000 }])).toMatchObject({ standing: 'paid' });
  });

  it('9.9 9.3 on the everyday card, past the due date with the minimum paid and the rest not', () => {
    expect(cardStanding('2026-10-27', EVERYDAY, [{ date: '2026-10-10', amount: 3_500 }])).toMatchObject({ standing: 'minimum-paid' });
    expect(cardStanding('2026-10-27', EVERYDAY, [{ date: '2026-10-10', amount: 123_455 }])).toMatchObject({ standing: 'minimum-paid' });
    expect(cardStanding('2026-10-27', EVERYDAY, [{ date: '2026-10-10', amount: 123_456 }])).toMatchObject({ standing: 'paid' });
  });

  it('9.9 9.3 a payment counts toward the statement it reached the card after, and one still on its way counts', () => {
    expect(cardStanding('2026-10-20', OLD, [{ date: '2026-10-01', amount: 9_000 }])).toMatchObject({ paid: 0, standing: 'to-pay' });
    expect(cardStanding('2026-10-20', OLD, [{ date: '2026-09-30', amount: 9_000, landedOn: '2026-10-02' }])).toMatchObject({ paid: 9_000, standing: 'paid' });
    expect(cardStanding('2026-10-20', OLD, [{ date: '2026-10-19', amount: 9_000, landedOn: null }])).toMatchObject({ paid: 9_000, standing: 'paid' });
    expect(cardStanding('2026-10-18', OLD, [{ date: '2026-10-19', amount: 9_000 }])).toMatchObject({ paid: 0, standing: 'to-pay' });
  });

  it('9.9 nothing to pay is paid: a zero or credit statement, a zero minimum', () => {
    expect(cardStanding('2026-10-20', { ...EVERYDAY, statementBalance: 0 }, [])).toMatchObject({ standing: 'paid' });
    expect(cardStanding('2026-10-20', { ...EVERYDAY, statementBalance: -500 }, [])).toMatchObject({ statementBalance: -500, standing: 'paid' });
    expect(cardStanding('2026-10-27', { ...OLD, minimumPayment: 0 }, [])).toMatchObject({ standing: 'paid' });
  });

  it('9.9 a very large statement stays exact', () => {
    const big = Number.MAX_SAFE_INTEGER - 1_000;
    const statement = { ...EVERYDAY, statementBalance: big };
    expect(cardStanding('2026-10-20', statement, [{ date: '2026-10-10', amount: big - 1 }])).toMatchObject({ paid: big - 1, standing: 'to-pay' });
    expect(cardStanding('2026-10-20', statement, [{ date: '2026-10-10', amount: big }])).toMatchObject({ standing: 'paid' });
  });

  it('9.9 a statement that cannot be right is refused', () => {
    expect(() => cardStanding('2026-10-20', { ...EVERYDAY, dueDate: '2026-09-01' }, [])).toThrow();
    expect(() => cardStanding('not a date', EVERYDAY, [])).toThrow();
  });

  it('9.9 9.6 on any day it agrees with Home: Home shows due only when it is still to pay, overdue only when it is overdue', () => {
    const day = fc.integer({ min: 1, max: 31 }).map((d) => `2026-10-${String(d).padStart(2, '0')}`);
    const payment = fc.record({ date: day, amount: fc.integer({ min: 1, max: 150_000 }) });
    fc.assert(
      fc.property(day, fc.array(payment, { maxLength: 4 }), fc.constantFrom(EVERYDAY, OLD), (today, payments: CardPayment[], statement) => {
        const stands = cardStanding(today, statement, payments).standing;
        const due = cardDue(today, statement, payments, DEFAULT_SETTINGS);
        if (due?.kind === 'overdue') expect(stands).toBe('overdue');
        if (due?.kind === 'due') expect(stands).toBe('to-pay');
        if (stands === 'overdue') expect(due?.kind).toBe('overdue');
      }),
    );
  });
});

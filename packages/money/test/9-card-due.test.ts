import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, addDays, cardDue, cardNotices, changeSettings, type CardPayment, type CardStatement } from '../src/index.js';
import { runs } from './slow.js';

// Rule 9.6 (QUESTIONS.md A17): Home shows a card payment as due every day
// from the first reminder day until the payments the app sees add up to
// what 9.3 asks for. Past the due date, overdue (9.4) takes over. The
// phone reminders still come only on the reminder days (9.1 to 9.3).

const EVERYDAY: CardStatement = { card: 'everyday-card', closingDate: '2026-10-01', dueDate: '2026-10-26', statementBalance: 123_456, minimumPayment: 3_500 };
const OLD: CardStatement = { ...EVERYDAY, card: 'old-card', statementBalance: 300_000, minimumPayment: 9_000 };

describe('9.6 a card payment due, on Home', () => {
  it('9.6 every day from the first reminder day through the due date', () => {
    for (let daysLeft = 7; daysLeft >= 0; daysLeft -= 1) {
      const today = addDays('2026-10-26', -daysLeft);
      expect(cardDue(today, EVERYDAY, [], DEFAULT_SETTINGS), today).toEqual({
        kind: 'due',
        card: 'everyday-card',
        daysLeft,
        dueDate: '2026-10-26',
        statementBalance: 123_456,
        minimumPayment: 3_500,
      });
    }
  });

  it('9.6 not the day before the first reminder day', () => {
    expect(cardDue('2026-10-18', EVERYDAY, [], DEFAULT_SETTINGS)).toBeNull();
  });

  it('9.6 the old card shows its minimum only (9.2)', () => {
    expect(cardDue('2026-10-22', OLD, [], DEFAULT_SETTINGS)).toEqual({ kind: 'due', card: 'old-card', daysLeft: 4, dueDate: '2026-10-26', minimumPayment: 9_000 });
  });

  it('9.6 the first reminder day comes from the setting', () => {
    const settings = changeSettings(DEFAULT_SETTINGS, { cardReminderDaysBefore: [2, 10] });
    expect(cardDue('2026-10-16', EVERYDAY, [], settings)).toMatchObject({ kind: 'due', daysLeft: 10 });
    expect(cardDue('2026-10-15', EVERYDAY, [], settings)).toBeNull();
  });

  it('9.6 with no reminder days set, only overdue shows', () => {
    const settings = changeSettings(DEFAULT_SETTINGS, { cardReminderDaysBefore: [] });
    expect(cardDue('2026-10-26', EVERYDAY, [], settings)).toBeNull();
    expect(cardDue('2026-10-27', EVERYDAY, [], settings)).toMatchObject({ kind: 'overdue' });
  });

  it('9.6 the everyday card stops once the full statement balance is paid (9.3)', () => {
    const paid: CardPayment[] = [{ date: '2026-10-20', amount: 123_456 }];
    expect(cardDue('2026-10-22', EVERYDAY, paid, DEFAULT_SETTINGS)).toBeNull();
  });

  it('9.6 the everyday card one cent short still shows', () => {
    const paid: CardPayment[] = [{ date: '2026-10-20', amount: 123_455 }];
    expect(cardDue('2026-10-22', EVERYDAY, paid, DEFAULT_SETTINGS)).toMatchObject({ kind: 'due', daysLeft: 4 });
  });

  it('9.6 the old card stops once the minimum is paid, and shows one cent short of it', () => {
    expect(cardDue('2026-10-22', OLD, [{ date: '2026-10-20', amount: 9_000 }], DEFAULT_SETTINGS)).toBeNull();
    expect(cardDue('2026-10-22', OLD, [{ date: '2026-10-20', amount: 8_999 }], DEFAULT_SETTINGS)).toMatchObject({ kind: 'due' });
  });

  it('9.6 payments add up, and one still on its way counts from the day it left (B47)', () => {
    const paid: CardPayment[] = [
      { date: '2026-10-05', amount: 100_000 },
      { date: '2026-10-21', amount: 23_456, landedOn: null },
    ];
    expect(cardDue('2026-10-22', EVERYDAY, paid, DEFAULT_SETTINGS)).toBeNull();
    // Before it left, it is not seen yet.
    expect(cardDue('2026-10-20', EVERYDAY, paid, DEFAULT_SETTINGS)).toMatchObject({ kind: 'due' });
  });

  it('9.6 a payment that reached the card on or before the statement date belongs to the one before (B28)', () => {
    expect(cardDue('2026-10-22', EVERYDAY, [{ date: '2026-10-01', amount: 123_456 }], DEFAULT_SETTINGS)).toMatchObject({ kind: 'due' });
  });

  it('9.4 9.6 past the due date with less than the minimum paid, it is overdue every day', () => {
    for (const today of ['2026-10-27', '2026-11-30']) {
      expect(cardDue(today, OLD, [], DEFAULT_SETTINGS), today).toEqual({ kind: 'overdue', card: 'old-card', dueDate: '2026-10-26', minimumPayment: 9_000 });
    }
  });

  it('9.4 9.6 past the due date with the minimum paid, the everyday card shows nothing', () => {
    expect(cardDue('2026-10-27', EVERYDAY, [{ date: '2026-10-20', amount: 3_500 }], DEFAULT_SETTINGS)).toBeNull();
  });

  it('9.6 nothing owed or a $0 minimum: nothing to show (B29)', () => {
    expect(cardDue('2026-10-22', { ...EVERYDAY, statementBalance: 0 }, [], DEFAULT_SETTINGS)).toBeNull();
    expect(cardDue('2026-10-22', { ...EVERYDAY, statementBalance: -500 }, [], DEFAULT_SETTINGS)).toBeNull();
    expect(cardDue('2026-10-22', { ...OLD, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toBeNull();
    expect(cardDue('2026-10-27', { ...OLD, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toBeNull();
  });

  it('9.6 very large amounts stay exact', () => {
    const big = 900_719_925_474_099;
    const statement: CardStatement = { ...EVERYDAY, statementBalance: big };
    expect(cardDue('2026-10-22', statement, [{ date: '2026-10-20', amount: big - 1 }], DEFAULT_SETTINGS)).toMatchObject({ kind: 'due', statementBalance: big });
    expect(cardDue('2026-10-22', statement, [{ date: '2026-10-20', amount: big }], DEFAULT_SETTINGS)).toBeNull();
  });

  it('9.6 refuses a statement that makes no sense, like the reminders do', () => {
    expect(() => cardDue('2026-10-22', { ...EVERYDAY, dueDate: '2026-09-01' }, [], DEFAULT_SETTINGS)).toThrow();
    expect(() => cardDue('not a date', EVERYDAY, [], DEFAULT_SETTINGS)).toThrow();
  });
});

describe('9.6 Home and the phone reminders agree', () => {
  it('9.6 on every reminder day Home shows it due, and whenever it is overdue Home says so, for any payments', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(EVERYDAY, OLD),
        fc.integer({ min: -12, max: 40 }),
        fc.array(fc.record({ day: fc.integer({ min: -5, max: 30 }), amount: fc.integer({ min: 1, max: 200_000 }), onItsWay: fc.boolean() }), { maxLength: 4 }),
        (statement, offset, raw) => {
          const today = addDays(statement.closingDate, offset);
          const payments: CardPayment[] = raw.map((p) => ({ date: addDays(statement.closingDate, p.day), amount: p.amount, ...(p.onItsWay ? { landedOn: null } : {}) }));
          const notices = cardNotices(today, statement, payments, DEFAULT_SETTINGS);
          const due = cardDue(today, statement, payments, DEFAULT_SETTINGS);
          for (const n of notices) {
            if (n.kind === 'reminder') expect(due).toMatchObject({ kind: 'due', daysLeft: n.daysBefore });
            else expect(due).toMatchObject({ kind: 'overdue' });
          }
          if (due?.kind === 'overdue') expect(notices).toMatchObject([{ kind: 'overdue' }]);
        },
      ),
      { numRuns: runs(500) },
    );
  });
});

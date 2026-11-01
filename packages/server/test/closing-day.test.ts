import { describe, expect, it } from 'vitest';
import type { PlaidCreditCard } from '../src/plaid/types.js';
import { bankStatus } from '../src/status.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import type { Settings } from '@budget-app/money';
import { decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// 9.8 (QUESTIONS.md A52, found by A50c on his real accounts, Oct 15, 2026;
// A53, Oct 16): Bank of America sends each card's due date, statement
// balance and minimum, but no statement date. The statement date is then the
// last day before the due date on the closing day set for that card. Until
// it is set, that card has no reminders, no due line on Home, and no overdue
// alert, and Home and Settings say so; the same for a statement the app
// cannot read. Before A52, such a card was dropped without a word. Every
// name, number and date is made up.

type Card = Omit<PlaidCreditCard, 'account_id'>;

// Due Oct 26: the reminder days are Oct 19 and Oct 24 (7 and 2 before).
const OLD: Card = {
  is_overdue: false,
  last_payment_amount: 35,
  last_payment_date: '2026-09-06',
  last_statement_issue_date: null,
  last_statement_balance: 1_500,
  minimum_payment_amount: 40,
  next_payment_due_date: '2026-10-26',
};
const EVERYDAY: Card = { ...OLD, last_statement_issue_date: '2026-09-28', last_statement_balance: 450.25, minimum_payment_amount: 35, next_payment_due_date: '2026-10-23' };

async function onTheNineteenth(cards: { old?: Card; everyday?: Card }): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  if (cards.old !== undefined) life.h.fake.setStatement(ACCOUNT_IDS.old, cards.old);
  if (cards.everyday !== undefined) life.h.fake.setStatement(ACCOUNT_IDS.everyday, cards.everyday);
  life.now = noonInNewYork('2026-10-19');
  await life.sync();
  return life;
}

// A settings change from Settings, as the screen sends it.
function set(life: Life, settings: Partial<Settings>): boolean {
  return life.keeper.settingsChange({ id: decision(), settings }).ok;
}

function attention(life: Life) {
  const home = life.keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  return home.attention.filter((a) => a.kind === 'card-due' || a.kind === 'card-overdue' || a.kind === 'card-reminders-off');
}

function cardsOff(life: Life) {
  const settings = life.keeper.settings();
  if (settings.state !== 'tracking') throw new Error('not tracking');
  return settings.cardsOff;
}

describe('9.9 the statements on Buckets, from what the bank sent', () => {
  function cards(life: Life) {
    const buckets = life.keeper.buckets();
    if (buckets.state !== 'tracking') throw new Error('not tracking');
    return buckets.cards;
  }

  it('9.9 9.8 before the first reminder day too: the card with no closing day says its reminders are off; once set, its statement shows', async () => {
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.h.fake.setStatement(ACCOUNT_IDS.old, OLD);
      life.h.fake.setStatement(ACCOUNT_IDS.everyday, EVERYDAY);
      life.now = noonInNewYork('2026-10-10');
      await life.sync();
      expect(attention(life).filter((a) => a.kind === 'card-due')).toEqual([]);
      expect(cards(life)).toEqual({
        statements: [{ card: 'everyday-card', closingDate: '2026-09-28', dueDate: '2026-10-23', daysLeft: 13, statementBalance: 45_025, minimumPayment: 3_500, paid: 0, standing: 'to-pay' }],
        off: [{ card: 'old-card', why: 'no-statement-date' }],
      });
      expect(set(life, { oldCardClosingDay: 29 })).toBe(true);
      expect(cards(life).off).toEqual([]);
      expect(cards(life).statements[1]).toEqual({ card: 'old-card', closingDate: '2026-09-29', dueDate: '2026-10-26', daysLeft: 16, statementBalance: null, minimumPayment: 4_000, paid: 0, standing: 'to-pay' });
    } finally {
      life.done();
    }
  });
});

describe('9.8 a card the bank sends no statement date for', () => {
  it('9.8 no closing day set: no reminder, no due line, and Home and Settings say its reminders are off; the card the bank sent a date for is as before', async () => {
    const life = await onTheNineteenth({ old: OLD, everyday: EVERYDAY });
    try {
      expect(attention(life)).toEqual([
        { kind: 'card-reminders-off', card: 'old-card', why: 'no-statement-date' },
        { kind: 'card-due', card: 'everyday-card', dueDate: '2026-10-23', daysLeft: 4, statementBalance: 45_025, minimumPayment: 3_500 },
      ]);
      expect(cardsOff(life)).toEqual([{ card: 'old-card', why: 'no-statement-date' }]);
    } finally {
      life.done();
    }
  });

  it('9.8 with the closing day set, the statement date is the last such day before the due date, and the card is due from its first reminder day (9.6); kept after a restart', async () => {
    const life = await onTheNineteenth({ old: OLD, everyday: { ...EVERYDAY, last_statement_issue_date: null } });
    try {
      expect(set(life, { oldCardClosingDay: 1, everydayCardClosingDay: 28 })).toBe(true);
      expect(attention(life)).toEqual([
        { kind: 'card-due', card: 'everyday-card', dueDate: '2026-10-23', daysLeft: 4, statementBalance: 45_025, minimumPayment: 3_500 },
        { kind: 'card-due', card: 'old-card', dueDate: '2026-10-26', daysLeft: 7, minimumPayment: 4_000 },
      ]);
      expect(cardsOff(life)).toEqual([]);
      life.restart();
      expect(attention(life).map((a) => [a.kind, 'card' in a ? a.card : null])).toEqual([
        ['card-due', 'everyday-card'],
        ['card-due', 'old-card'],
      ]);
      // Cleared again: off again, and said again.
      expect(set(life, { oldCardClosingDay: null })).toBe(true);
      expect(cardsOff(life)).toEqual([{ card: 'old-card', why: 'no-statement-date' }]);
    } finally {
      life.done();
    }
  });

  it('9.8 a statement the app cannot read is said too, whether or not the closing day is set; a card with no statement from the bank is as before', async () => {
    const life = await onTheNineteenth({ old: { ...OLD, minimum_payment_amount: null } });
    try {
      expect(cardsOff(life)).toEqual([{ card: 'old-card', why: 'unreadable' }]);
      expect(set(life, { oldCardClosingDay: 1 })).toBe(true);
      expect(attention(life)).toEqual([{ kind: 'card-reminders-off', card: 'old-card', why: 'unreadable' }]);
      expect(cardsOff(life)).toEqual([{ card: 'old-card', why: 'unreadable' }]);
    } finally {
      life.done();
    }
  });

  it('9.8 9.4 past the due date with less than the minimum paid: overdue once the closing day is set, never while it is not', async () => {
    const life = await onTheNineteenth({ old: OLD });
    try {
      life.now = noonInNewYork('2026-10-28');
      await life.sync();
      expect(attention(life)).toEqual([{ kind: 'card-reminders-off', card: 'old-card', why: 'no-statement-date' }]);
      expect(set(life, { oldCardClosingDay: 1 })).toBe(true);
      expect(attention(life)).toEqual([{ kind: 'card-overdue', card: 'old-card', dueDate: '2026-10-26', minimumPayment: 4_000 }]);
    } finally {
      life.done();
    }
  });

  it('9.8 the status report reads each card with the closing day set for it', async () => {
    const life = await onTheNineteenth({ old: OLD, everyday: { ...EVERYDAY, last_statement_issue_date: null } });
    try {
      const read = () => bankStatus(life.h.db).statements.map((s) => [s.card, s.result.ok ? s.result.statement.closingDate : s.result.why]);
      expect(read()).toEqual([
        ['everyday-card', 'the bank did not give the statement date'],
        ['old-card', 'the bank did not give the statement date'],
      ]);
      expect(set(life, { oldCardClosingDay: 29, everydayCardClosingDay: 3 })).toBe(true);
      expect(read()).toEqual([
        ['everyday-card', '2026-10-03'],
        ['old-card', '2026-09-29'],
      ]);
    } finally {
      life.done();
    }
  });
});

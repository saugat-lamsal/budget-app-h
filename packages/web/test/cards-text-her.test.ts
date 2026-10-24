import { describe, expect, it } from 'vitest';
import { APP_PATHS, HER_SCREEN_PATHS, SCREEN_PATHS } from '../../server/src/http/server.js';
import { HER_SCREEN_ROUTES, SCREEN_ROUTES, backTarget, pathOfRoute, routeLabel, routeOf, routeTitle, statementPath, tabOfRoute } from '../src/app/routes.js';
import { NOT_MATCHED, WHY_NOT_SPENDING, bucketTitle, cardStateText, carriedInText, inSavingsText, noStatementText, periodTitle, setAsideText, statementDaysText } from '../src/screens/cards-text.js';

// Her rulebook, section 52 (PR 7+8): the words for her cards on Home and on
// each card's Statement screen, and the screen's address. Every number is
// made up.

const OFF_WORDS = /\bmom\b|old.?card|reserve|promo|payoff|\bdebt/i;

describe('52.1 a card\'s row on Home, in words', () => {
  it('52.1 due from the first reminder day, overdue after the due date, paid in full, in words and never by color alone', () => {
    expect(cardStateText({ kind: 'due', daysLeft: 7 }, '2026-10-30')).toBe('Due in 7 days');
    expect(cardStateText({ kind: 'due', daysLeft: 1 }, '2026-10-30')).toBe('Due in 1 day');
    expect(cardStateText({ kind: 'due', daysLeft: 0 }, '2026-10-30')).toBe('Due today');
    expect(cardStateText({ kind: 'overdue' }, '2026-10-30')).toBe('Overdue');
    expect(cardStateText({ kind: 'paid' }, '2026-10-30')).toBe('Paid in full');
    expect(cardStateText({ kind: 'minimum-paid' }, '2026-10-30')).toBe('Minimum paid');
    expect(cardStateText({ kind: 'not-due-yet' }, '2026-10-30')).toBe('Due Fri, Oct 30');
  });

  it('52.1 with its reminders off it says so instead (9.8), and with no statement yet, that', () => {
    expect(noStatementText('no-statement-date')).toBe('Card reminders are off: the bank did not send its statement date. Enter the day its statement closes in Settings.');
    expect(noStatementText('unreadable')).toBe('Card reminders are off: the bank sent a statement for it that cannot be read.');
    expect(noStatementText('none-yet')).toBe('No statement from the bank yet.');
  });
});

describe('52.2 set aside, in words', () => {
  it('52.2 all of what a card owes is set aside; a credit has nothing set aside', () => {
    expect(setAsideText(9_661)).toBe('Owes $96.61 now, all of it set aside.');
    expect(setAsideText(1)).toBe('Owes $0.01 now, all of it set aside.');
    expect(setAsideText(0)).toBe('Owes nothing now.');
    expect(setAsideText(-1)).toBe('A credit of $0.01: nothing to set aside.');
  });

  it('52.2 how much of it is in savings', () => {
    expect(inSavingsText(12_345)).toBe('$123.45 of the money set aside for your cards is in your savings account, not checking.');
  });

  it('52.2 why paying a card is not spending, in plain words with made-up numbers, as her rulebook says', () => {
    expect(WHY_NOT_SPENDING.title).toBe("Why paying your card isn't spending");
    const text = WHY_NOT_SPENDING.paragraphs.join(' ');
    expect(text).toContain('the app takes the $30 out of Needs that same day');
    expect(text).toContain('That\'s what "set aside" means.');
    expect(text).toContain('If every purchase is sorted, the money for each card is already there.');
  });
});

describe('52.4 the Statement screen, in words', () => {
  it('52.4 each group by its bucket, and by its paycheck', () => {
    expect(['needs', 'wants', 'unsorted', 'before-setup'].map((b) => bucketTitle(b as 'needs'))).toEqual(['Needs', 'Wants', 'Still unsorted', 'Before setup day']);
    expect(periodTitle('before-setup')).toBe('Before setup day');
    expect(periodTitle({ number: 0, startDate: '2026-10-01' })).toBe('From setup day, Thu, Oct 1');
    expect(periodTitle({ number: 3, startDate: '2026-11-13' })).toBe('Paycheck of Fri, Nov 13');
  });

  it('52.4 the carried-in line, and the first statement the app sees', () => {
    expect(carriedInText({ kind: 'from-statement-before', before: 45_000, paymentsAndCredits: -45_000, amount: 0, items: [] })).toEqual({ title: 'Carried in from the statement before', detail: '$450.00 on the statement before, less $450.00 paid and credited since.' });
    expect(carriedInText({ kind: 'from-statement-before', before: 1_000, paymentsAndCredits: 0, amount: 1_000, items: [] }).detail).toBe('$10.00 on the statement before, with nothing paid or credited since.');
    expect(carriedInText({ kind: 'from-statement-before', before: 1_000, paymentsAndCredits: 500, amount: 1_500, items: [] }).detail).toBe('$10.00 on the statement before, plus $5.00 taken back since.');
    expect(carriedInText({ kind: 'before-the-app', amount: 25_000 }).title).toBe('From before the app saw this card');
  });

  it('52.4 what the lines do not account for is called Not matched to a purchase', () => {
    expect(NOT_MATCHED.title).toBe('Not matched to a purchase');
    expect(statementDaysText('2026-09-26', '2026-10-25', '2026-11-20')).toBe('Sat, Sep 26 to Sun, Oct 25 · due Fri, Nov 20');
  });

  it('52.4 none of her words name what is off in her setup', () => {
    const all = [WHY_NOT_SPENDING.title, ...WHY_NOT_SPENDING.paragraphs, NOT_MATCHED.title, NOT_MATCHED.detail, noStatementText('none-yet'), setAsideText(5), inSavingsText(5), carriedInText({ kind: 'before-the-app', amount: 0 }).detail];
    for (const text of all) expect(text).not.toMatch(OFF_WORDS);
  });

  it('52.4 each card\'s statement has its own address, kept apart from upstream\'s screens, and leads back to Home', () => {
    expect(HER_SCREEN_ROUTES.map(pathOfRoute).sort()).toEqual([...HER_SCREEN_PATHS].sort());
    for (const path of HER_SCREEN_PATHS) {
      expect(SCREEN_PATHS).not.toContain(path);
      expect(APP_PATHS).not.toContain(path);
    }
    expect(SCREEN_ROUTES.map(pathOfRoute)).not.toContain(statementPath('everyday-card'));
    const route = routeOf('/statement/second-card');
    expect(route).toEqual({ screen: 'statement', card: 'second-card' });
    expect(routeOf('/statement/old-card')).toBeNull();
    if (route === null) throw new Error('no route');
    expect(tabOfRoute(route)).toBe('home');
    expect(routeTitle(route)).toBe('Statement · Budget');
    expect(routeLabel(route)).toBe('Statement');
    expect(backTarget(route, undefined)).toEqual({ screen: 'tab', tab: 'home' });
  });
});

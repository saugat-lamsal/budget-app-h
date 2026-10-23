import { afterEach, describe, expect, it } from 'vitest';
import { onItsWayDetail, onItsWayTitle } from '../src/screens/buckets-text.js';
import { cardsOffText } from '../src/screens/home-text.js';
import { ACCOUNT_NAMES as REVIEW_NAMES } from '../src/screens/review-text.js';
import { SETTING_NAMES } from '../src/screens/settings-text.js';
import { ACCOUNT_NAMES, accountPhrase, halfText } from '../src/screens/setup-text.js';
import { whyText } from '../src/screens/why-text.js';
import { cardNames, nameOf, rememberCardNames } from '../src/ui/card-names.js';

// Her rulebook, PR 5, and HB6: her second card on the screens, and each card
// named as its bank names it once the server has sent the names. Without
// them (upstream's setup), the words are as they were. Every name is made up.

const NAMES = { 'everyday-card': 'Made Up Rewards', 'second-card': 'Made Up Blue' } as const;

afterEach(() => rememberCardNames(null));

describe('HB6 each card by its bank\'s name, once the names come', () => {
  it('HB6 no names: the plain words, the second card\'s too', () => {
    expect(cardNames()).toBeNull();
    expect(ACCOUNT_NAMES['everyday-card']).toBe('Everyday card');
    expect(ACCOUNT_NAMES['second-card']).toBe('Second card');
    expect(accountPhrase('second-card')).toBe('the second card');
    expect(accountPhrase('everyday-card')).toBe('the everyday card');
    expect(cardsOffText({ card: 'second-card', why: 'no-statement-date' }).title).toBe('Card reminders are off for the second card');
    expect(cardsOffText({ card: 'everyday-card', why: 'no-statement-date' }).title).toBe('Card reminders are off for the everyday card');
    expect(SETTING_NAMES.secondCardClosingDay).toBe('Second card: statement closing day');
    expect(SETTING_NAMES.everydayCardClosingDay).toBe('Everyday card: statement closing day');
  });

  it('HB6 with names: every map and phrase names the cards; the other accounts keep their words', () => {
    rememberCardNames(NAMES);
    expect(nameOf('second-card')).toBe('Made Up Blue');
    expect(nameOf('checking')).toBeNull();
    for (const names of [ACCOUNT_NAMES, REVIEW_NAMES]) {
      expect(names['everyday-card']).toBe('Made Up Rewards');
      expect(names['second-card']).toBe('Made Up Blue');
      expect(names.checking).toBe('Checking');
      expect(names['old-card']).toBe('Old card');
    }
    expect(accountPhrase('second-card')).toBe('Made Up Blue');
    expect(accountPhrase('savings')).toBe('savings');
    // 9.8: the words name the card.
    expect(cardsOffText({ card: 'second-card', why: 'no-statement-date' }).title).toBe('Card reminders are off for Made Up Blue');
    expect(SETTING_NAMES.secondCardClosingDay).toBe('Made Up Blue: statement closing day');
    expect(SETTING_NAMES.everydayCardClosingDay).toBe('Made Up Rewards: statement closing day');
    expect(SETTING_NAMES.oldCardClosingDay).toBe('Old card: statement closing day');
  });

  it('HB6 a screen with no names leaves the names it had; one that says null clears them', () => {
    rememberCardNames(NAMES);
    rememberCardNames(undefined);
    expect(cardNames()).toEqual(NAMES);
    rememberCardNames(null);
    expect(ACCOUNT_NAMES['second-card']).toBe('Second card');
  });

  it('HB6 the maps stay what they are: frozen, and listed with every account', () => {
    rememberCardNames(NAMES);
    expect(Object.isFrozen(ACCOUNT_NAMES)).toBe(true);
    expect(Object.keys(ACCOUNT_NAMES)).toEqual(['checking', 'savings', 'everyday-card', 'old-card', 'second-card']);
    expect({ ...ACCOUNT_NAMES }).toMatchObject({ 'everyday-card': 'Made Up Rewards', 'second-card': 'Made Up Blue' });
  });
});

describe('12.5 12.6 the second card in the words of the check', () => {
  const half = { id: 's1', from: 'checking', to: 'second-card', date: '2026-10-05', amount: 5_000, seen: 'left', counted: true } as const;

  it('12.5 a payment on its way to the second card, plain and named', () => {
    expect(onItsWayTitle(half)).toBe('Payment to the second card');
    expect(onItsWayDetail(half)).toBe('Left Checking Mon, Oct 5. Not on the second card yet.');
    rememberCardNames(NAMES);
    expect(onItsWayTitle(half)).toBe('Payment to Made Up Blue');
    expect(onItsWayDetail(half)).toBe('Left Checking Mon, Oct 5. Not on Made Up Blue yet.');
    // Upstream's everyday card, with no names, as it was.
    rememberCardNames(null);
    expect(onItsWayTitle({ to: 'everyday-card' })).toBe('Payment to the everyday card');
  });

  it('14.2 B48 a half on its way to the second card on setup day', () => {
    const line = { id: 's1', kind: 'left', from: 'checking', to: 'second-card', date: '2026-09-30', amount: 5_000, onItsWay: null } as never;
    expect(halfText(line)).toBe('Left checking on Wed, Sep 30 for the second card. It does not show arriving yet.');
    rememberCardNames(NAMES);
    expect(halfText(line)).toBe('Left checking on Wed, Sep 30 for Made Up Blue. It does not show arriving yet.');
  });

  it('12.6 the second card\'s balance moving is said like the everyday card\'s, by its name', () => {
    const moved = { kind: 'balance-moved', account: 'second-card', balance: 'posted', went: 'up', by: 700, amount: -700 } as const;
    expect(whyText(moved).title).toBe("The second card's balance went up $7.00 with no transaction from the bank yet.");
    expect(whyText({ kind: 'posted-still-pending', account: 'second-card', description: 'MADE UP CAFE', charge: true, amount: -875 }).title).toBe('Second card: “MADE UP CAFE”');
    rememberCardNames(NAMES);
    expect(whyText(moved).title).toBe("Made Up Blue's balance went up $7.00 with no transaction from the bank yet.");
  });
});

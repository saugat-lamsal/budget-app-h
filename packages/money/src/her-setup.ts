import { DEFAULT_SETTINGS, validateSettings, type Settings } from './settings.js';
import { checkSwitches, settingsWhenOff, type Switches } from './switches.js';

// Her setup's starting values (docs/her-plan.txt), what her setup day starts
// from. Upstream's DEFAULT_SETTINGS stay upstream's: everything not named
// here is the same (her rulebook, section 60d: the pay schedule every 14 days
// and the home time zone America/New_York are upstream's starting values too).

// "Off in this setup": no mom reserve and no old card, fixed on setup day.
// Her second card is on (her rulebook, section 1), and so is her Wishlist
// bucket (section 2's split).
export const HER_SWITCHES: Switches = checkSwitches({ momReserve: 'off', oldCard: 'off', secondCard: 'on', wishlist: 'on' });

// Section 2 without the mom reserve, the mom monthly target, the mom rule, the
// old card promo end date and the old card's closing day, with "Ask before
// splitting a paycheck" on (3.1), and with a closing day for her second card,
// not set yet (9.8), and with a Wishlist share in the split, starting at 0%
// (she picks it on setup day; the rest is upstream's 50, 30 and 20).
export const HER_SETTINGS: Settings = validateSettings({ ...DEFAULT_SETTINGS, ...settingsWhenOff(HER_SWITCHES), split: { ...DEFAULT_SETTINGS.split, wishlist: 0 }, askBeforeSplittingPaycheck: true, secondCardClosingDay: null });

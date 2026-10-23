import { DEFAULT_SETTINGS, validateSettings, type Settings } from './settings.js';
import { checkSwitches, settingsWhenOff, type Switches } from './switches.js';

// Her setup's starting values (docs/her-plan.txt), what her setup day starts
// from. Upstream's DEFAULT_SETTINGS stay upstream's: everything not named
// here is the same (her rulebook, section 60d: the pay schedule every 14 days
// and the home time zone America/New_York are upstream's starting values too).

// "Off in this setup": no mom reserve and no old card, fixed on setup day.
export const HER_SWITCHES: Switches = checkSwitches({ momReserve: 'off', oldCard: 'off' });

// Section 2 without the mom reserve, the mom monthly target, the mom rule, the
// old card promo end date and the old card's closing day.
export const HER_SETTINGS: Settings = validateSettings({ ...DEFAULT_SETTINGS, ...settingsWhenOff(HER_SWITCHES) });

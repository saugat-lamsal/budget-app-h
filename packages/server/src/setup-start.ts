import { DEFAULT_SETTINGS, HER_SETTINGS, HER_SWITCHES, UPSTREAM_SWITCHES, type Settings, type Switches } from '@budget-app/money';
import { HISTORY_DAYS } from './plaid/client.js';

// What setup day starts from: upstream's settings with the mom reserve and
// the old card on, or her setup's (docs/her-plan.txt), with both off (her
// rulebook, "Off in this setup"). Once tracking starts, the book keeps its
// switches for good, and this is not looked at again.
export interface SetupStart {
  readonly settings: Settings;
  readonly switches: Switches;
  // Section 2: how many days of history each bank is asked for when it is
  // connected. Upstream's 90 (also when left out); her setup's 730, the
  // most Plaid allows (60g).
  readonly historyDays?: number;
  // Her rulebook, section 53: setup day's rule finder, in place of the
  // suggestions from the bank's labels (20a). Off when left out.
  readonly ruleFinder?: boolean;
}

// Section 2, her rulebook (60g): 730 days, though Capital One sends 90.
export const HER_HISTORY_DAYS = 730;

export const UPSTREAM_START: SetupStart = Object.freeze({ settings: DEFAULT_SETTINGS, switches: UPSTREAM_SWITCHES, historyDays: HISTORY_DAYS, ruleFinder: false });
export const HER_START: SetupStart = Object.freeze({ settings: HER_SETTINGS, switches: HER_SWITCHES, historyDays: HER_HISTORY_DAYS, ruleFinder: true });

// BUDGET_SETUP: "her" on her own app (her fly.toml); unset is upstream's, so
// every upstream test and command runs as it always has.
export function setupStartOf(value: string | undefined): SetupStart {
  if (value === undefined || value === '' || value === 'upstream') return UPSTREAM_START;
  if (value === 'her') return HER_START;
  throw new Error(`BUDGET_SETUP must be "her" or "upstream", not ${JSON.stringify(value)}`);
}

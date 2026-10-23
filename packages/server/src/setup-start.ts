import { DEFAULT_SETTINGS, HER_SETTINGS, HER_SWITCHES, UPSTREAM_SWITCHES, type Settings, type Switches } from '@budget-app/money';

// What setup day starts from: upstream's settings with the mom reserve and
// the old card on, or her setup's (docs/her-plan.txt), with both off (her
// rulebook, "Off in this setup"). Once tracking starts, the book keeps its
// switches for good, and this is not looked at again.
export interface SetupStart {
  readonly settings: Settings;
  readonly switches: Switches;
}

export const UPSTREAM_START: SetupStart = Object.freeze({ settings: DEFAULT_SETTINGS, switches: UPSTREAM_SWITCHES });
export const HER_START: SetupStart = Object.freeze({ settings: HER_SETTINGS, switches: HER_SWITCHES });

// BUDGET_SETUP: "her" on her own app (her fly.toml); unset is upstream's, so
// every upstream test and command runs as it always has.
export function setupStartOf(value: string | undefined): SetupStart {
  if (value === undefined || value === '' || value === 'upstream') return UPSTREAM_START;
  if (value === 'her') return HER_START;
  throw new Error(`BUDGET_SETUP must be "her" or "upstream", not ${JSON.stringify(value)}`);
}

import type { LogRow } from '@budget-app/server/views';
import { ruleText } from './settings-text.js';

// Her rulebook, 53.1 and 13.5 (HA10): setup day's line in the change log,
// with the rules she kept from the rule finder, in words.
export function setupDayText(line: Extract<LogRow, { kind: 'setup-day' }>): string {
  const kept = [...line.rules.map(ruleText), ...(line.paycheckRule === null ? [] : [`the paycheck rule “${line.paycheckRule.contains}”`])];
  return kept.length === 0 ? 'Tracking started.' : `Tracking started. Kept from your history: ${kept.join('; ')}.`;
}

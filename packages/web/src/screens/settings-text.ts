import type { LeftoverChoice, RecheckedItem, Settings } from '@budget-app/money';
import type { LogRow, RuleDone, RuleSpec, SettingsDone } from '@budget-app/server/views';
import { nameOf } from '../ui/card-names.js';
import { dayWithYear, shortDate } from '../ui/dates.js';
import { moneyText } from '../ui/money-format.js';
import { POT_NAMES } from '../ui/names.js';

// Words on the Settings screen: what each setting and each rule is called,
// and how a value is written. Every value comes from the money math on the
// server; these only name it.

export const RULE_KINDS: Readonly<Record<RuleSpec['for'], string>> = {
  purchase: 'Purchases',
  deposit: 'Money in',
  person: 'Payments to people',
};

// What a rule of each kind catches, in a sentence.
export const RULE_KIND_DETAIL: Readonly<Record<RuleSpec['for'], string>> = {
  purchase: 'A rule here sorts card and debit purchases.',
  deposit: 'A rule here sorts deposits that are not your paycheck.',
  person: 'A rule here sorts Zelle and other payments to someone.',
};

// What a rule does with what it catches.
export const RULE_CHOICE_NAMES: Readonly<Record<RuleSpec['to'], string>> = {
  ...POT_NAMES,
  'other-income': 'Other income (split)',
  'not-mine': 'Not mine',
  mom: 'For mom',
};

export const LEFTOVER_NAMES: Readonly<Record<LeftoverChoice, string>> = {
  ask: 'Ask each time',
  'roll-over': 'Always roll over',
  'move-to-savings': 'Always move to savings',
};

const SETTING_WORDS: Readonly<Record<keyof Settings, string>> = {
  split: 'Split',
  momReservePerPaycheck: 'Mom reserve per paycheck',
  momReserveCap: 'Mom reserve cap',
  momMonthlyTarget: 'Mom monthly target',
  lowBucketAlertPercent: 'Low-bucket alert',
  cardReminderDaysBefore: 'Card reminders',
  dailyReviewTime: 'Daily review time',
  leftoverAtPayday: 'Leftover at payday',
  oldCardPromoEndDate: 'Old card promo end date',
  paycheckRule: 'Paycheck rule',
  paySchedule: 'Pay schedule',
  payScheduleDays: 'Days between paychecks',
  momRule: 'Mom rule',
  earlyPaycheckDays: 'Early paycheck check',
  homeTimeZone: 'Home time zone',
  quietHours: 'Quiet hours',
  bankNotReadAlertHours: 'Bank not read',
  totalsMismatchAlertHours: 'Totals do not match',
  amountsOnLockScreen: 'Amounts on the lock screen',
  bankPermissionWarnDays: 'Bank permission ending',
  everydayCardClosingDay: 'Everyday card: statement closing day',
  oldCardClosingDay: 'Old card: statement closing day',
  askBeforeSplittingPaycheck: 'Ask before splitting a paycheck',
  secondCardClosingDay: 'Second card: statement closing day',
};

// In her setup, each card's closing day is called by the card's name as its
// bank gives it (HB6).
export const SETTING_NAMES: Readonly<Record<keyof Settings, string>> = Object.freeze(
  Object.defineProperties(
    { ...SETTING_WORDS },
    {
      everydayCardClosingDay: { enumerable: true, get: () => closingDayName('everyday-card') },
      secondCardClosingDay: { enumerable: true, get: () => closingDayName('second-card') },
    },
  ),
);

function closingDayName(card: 'everyday-card' | 'second-card'): string {
  const named = nameOf(card);
  return named === null ? SETTING_WORDS[card === 'everyday-card' ? 'everydayCardClosingDay' : 'secondCardClosingDay'] : `${named}: statement closing day`;
}

// Section 2: the home time zones offered on Settings, his first, and how each
// is called. Any other zone (set some other way) is written as its name.
const ZONE_NAMES: Readonly<Record<string, string>> = {
  'America/New_York': 'Eastern time (New York)',
  'America/Chicago': 'Central time (Chicago)',
  'America/Denver': 'Mountain time (Denver)',
  'America/Phoenix': 'Arizona (Phoenix)',
  'America/Los_Angeles': 'Pacific time (Los Angeles)',
  'America/Anchorage': 'Alaska (Anchorage)',
  'Pacific/Honolulu': 'Hawaii (Honolulu)',
};

export const ZONE_CHOICES: readonly string[] = Object.keys(ZONE_NAMES);

export function zoneText(zone: string): string {
  return ZONE_NAMES[zone] ?? zone;
}

export function splitText(split: Settings['split']): string {
  return `${split.savings} / ${split.needs} / ${split.wants}`;
}

// "8:00 PM" for "20:00".
export function timeText(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) return time;
  const hours = Number(match[1]);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${match[2]} ${hours < 12 ? 'AM' : 'PM'}`;
}

// "7 and 2 days before"; "None".
export function reminderText(days: readonly number[]): string {
  if (days.length === 0) return 'None';
  const list = days.length === 1 ? String(days[0]) : `${days.slice(0, -1).join(', ')} and ${String(days.at(-1))}`;
  return `${list} ${days.length === 1 && days[0] === 1 ? 'day' : 'days'} before`;
}

export function daysText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

// Section 2 (A48): the pay schedule in words.
export function payScheduleText(s: Pick<Settings, 'paySchedule' | 'payScheduleDays'>): string {
  return s.paySchedule === 'twice-a-month' ? 'Twice a month, the 15th and the last day' : `Every ${daysText(s.payScheduleDays)}`;
}

// Step 3: "60 minutes", "1,440 minutes".
export function minutesText(minutes: number): string {
  return `${minutes.toLocaleString('en-US')} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

// 10.8: "10:00 PM to 7:00 AM"; the same time twice is none.
export function quietHoursText(quiet: Settings['quietHours']): string {
  return quiet.from === quiet.to ? 'None' : `${timeText(quiet.from)} to ${timeText(quiet.to)}`;
}

// 10.7: "After 24 hours".
// 10.13: how long before the bank's permission runs out he is told.
// 9.8 (A53): the day of the month a card's statement closes: "The 12th of
// each month". A day some months do not have closes on their last day.
export function closingDayText(day: number | null): string {
  if (day === null) return 'Not entered';
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `The ${day}${suffix} of each month${day > 28 ? ', or its last day' : ''}`;
}

export function permissionWarnText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'} before`;
}

export function notReadText(hours: number): string {
  return `After ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

// 10.10: off, the lock screen shows words only.
export function lockAmountsText(on: boolean): string {
  return on ? 'On' : 'Off, words only';
}

// Her rulebook, section 2 and 3.1. Not set is off, as upstream.
export function askPaycheckText(on: boolean | undefined): string {
  return on === true ? 'On: every paycheck waits for your yes' : 'Off: a paycheck is split by itself';
}

export function textRuleText(rule: Settings['paycheckRule']): string {
  return rule === null ? 'Not set' : `“${rule.contains}”`;
}

export function leftoverText(leftover: Settings['leftoverAtPayday']): string {
  return `Needs: ${LEFTOVER_NAMES[leftover.needs].toLowerCase()}, Wants: ${LEFTOVER_NAMES[leftover.wants].toLowerCase()}`;
}

// A rule in a line: “GROCERY” → Needs.
export function ruleText(rule: RuleSpec): string {
  return `“${rule.contains}” → ${RULE_CHOICE_NAMES[rule.to]}`;
}

// Any setting's value, written out, for the change log.
export function settingValueText<K extends keyof Settings>(key: K, value: Settings[K]): string {
  const v = value as Settings[keyof Settings];
  switch (key) {
    case 'split':
      return splitText(v as Settings['split']);
    case 'momReservePerPaycheck':
    case 'momReserveCap':
      return moneyText(v as number);
    case 'momMonthlyTarget': {
      const t = v as Settings['momMonthlyTarget'];
      return `${moneyText(t.low)} to ${moneyText(t.high)}`;
    }
    case 'lowBucketAlertPercent':
      return `${String(v)}%`;
    case 'cardReminderDaysBefore':
      return reminderText(v as readonly number[]);
    case 'dailyReviewTime':
      return timeText(v as string);
    case 'leftoverAtPayday':
      return leftoverText(v as Settings['leftoverAtPayday']);
    case 'oldCardPromoEndDate':
      return v === null ? 'Not entered' : dayWithYear(v as string);
    case 'paycheckRule':
    case 'momRule':
      return textRuleText(v as Settings['paycheckRule']);
    case 'paySchedule':
      return v === 'twice-a-month' ? 'Twice a month, the 15th and the last day' : 'Every so many days';
    case 'payScheduleDays':
      return `Every ${daysText(v as number)}`;
    case 'earlyPaycheckDays':
      return daysText(v as number);
    case 'homeTimeZone':
      return zoneText(v as string);
    case 'quietHours':
      return quietHoursText(v as Settings['quietHours']);
    case 'bankNotReadAlertHours':
    case 'totalsMismatchAlertHours':
      return notReadText(v as number);
    case 'amountsOnLockScreen':
      return lockAmountsText(v as boolean);
    case 'bankPermissionWarnDays':
      return permissionWarnText(v as number);
    case 'everydayCardClosingDay':
    case 'oldCardClosingDay':
    case 'secondCardClosingDay':
      return closingDayText((v ?? null) as number | null);
    case 'askBeforeSplittingPaycheck':
      return askPaycheckText(v as boolean | undefined);
    default:
      return String(v);
  }
}

// What a new paycheck rule or mom rule does to one waiting item (A9).
export function recheckedText(item: RecheckedItem, earlyDays: number): string {
  switch (item.kind) {
    case 'paycheck':
      return 'Becomes your paycheck, and a new pay period starts that day.';
    case 'early-paycheck':
      return `Still waits in review, as a paycheck that came early: less than ${daysText(earlyDays)} after the last one.`;
    // Her rulebook, 13.2.
    case 'paycheck-waiting':
      return 'Becomes a paycheck waiting for your yes in Review. Nothing is split until you say yes.';
    case 'still-waiting':
      return 'Still waits in Review: part of it was refunded, so it cannot come out of the mom reserve. Sort it there.';
    case 'mom':
      return item.difference === 0
        ? `Comes out of the mom reserve.`
        : `${moneyText(item.fromReserve)} comes out of the mom reserve. The other ${moneyText(item.difference)} waits in review for you to pick a bucket.`;
  }
}

// What a settings change did, in a sentence (13.1, A9).
export function settingsDoneText(done: SettingsDone, nextPayday: string): string {
  const parts = [done.fromNextPaycheck ? `Saved. It starts at your next paycheck, ${shortDate(nextPayday)}.` : 'Saved.'];
  const count = (kind: RecheckedItem['kind']): number => done.rechecked.filter((i) => i.kind === kind).length;
  const paychecks = count('paycheck');
  const early = count('early-paycheck');
  const waiting = count('paycheck-waiting');
  const mom = count('mom');
  if (paychecks > 0) parts.push(paychecks === 1 ? 'A deposit that was waiting is now your paycheck.' : `${paychecks} deposits that were waiting are now paychecks.`);
  if (early > 0) parts.push(early === 1 ? 'One waits in review as an early paycheck.' : `${early} wait in review as early paychecks.`);
  if (waiting > 0) parts.push(waiting === 1 ? 'A deposit that was waiting is now a paycheck waiting for your yes in Review.' : `${waiting} deposits that were waiting are now paychecks waiting for your yes in Review.`);
  if (mom > 0) parts.push(mom === 1 ? 'A payment that was waiting came out of the mom reserve.' : `${mom} payments that were waiting came out of the mom reserve.`);
  const still = done.rechecked.filter((i) => i.kind === 'still-waiting');
  if (still.length > 0) parts.push(`${still.map((i) => i.description).join(', ')} still ${still.length === 1 ? 'waits' : 'wait'} in Review: part of it was refunded, so it cannot come out of the mom reserve.`);
  return parts.join(' ');
}

// What a rule change did, in a sentence (13.2, A19).
export function ruleDoneText(done: RuleDone): string {
  const what = { added: 'Rule added', changed: 'Rule changed', removed: 'Rule removed', 'moved-up': 'Rule moved up', 'moved-down': 'Rule moved down' }[done.action];
  const parts = [`${what}: ${ruleText(done.rule)}.`];
  if (done.alsoSorted > 0) parts.push(done.alsoSorted === 1 ? 'It sorted 1 item that was waiting.' : `It sorted ${done.alsoSorted} items that were waiting.`);
  if (done.stillWaiting.length > 0) parts.push(`It could not sort ${done.stillWaiting.map((w) => w.name).join(', ')}, so that still waits in Review.`);
  if (done.action === 'removed') parts.push('What it sorted stays where it is.');
  return parts.join(' ');
}

// ----- The change log's lines from the server (13.5) -----

type Retotaled = Extract<LogRow, { kind: 'history-retotaled' }>;

// A28: what each total is called.
export const TOTAL_NAMES: Readonly<Record<Retotaled['changes'][number]['name'], string>> = {
  savings: 'Savings',
  needs: 'Needs',
  wants: 'Wants',
  momReserve: 'Mom reserve',
  heldForOthers: 'Held for others',
  unsortedIn: 'Money in waiting',
  unsortedOut: 'Spending waiting',
  oldCardDebt: 'Old card owes',
  inTransit: 'In transit',
  waiting: 'Items in Review',
};

// A28: the history took new totals: from which event, how many, and what
// changed at the first one.
export function retotaledText(row: Retotaled): string {
  const changes = row.changes.map((c) => `${TOTAL_NAMES[c.name]} ${c.name === 'waiting' ? c.before : moneyText(c.before)} → ${c.name === 'waiting' ? c.after : moneyText(c.after)}`);
  return `From ${row.from.what}, ${shortDate(row.from.date)}: ${row.events === 1 ? '1 event' : `${row.events} events`}${changes.length === 0 ? '' : `. There: ${changes.join(', ')}`}`;
}

export const LOGIN_LINES: Readonly<Record<'logged-in' | 'logged-out' | 'passkey-added', string>> = {
  'logged-in': 'Logged in',
  'logged-out': 'Logged out',
  'passkey-added': 'Passkey added',
};

// Phase 5: the change log's lines for notifications on a device.
export const NOTIFICATION_LINES: Readonly<Record<'notifications-on' | 'notifications-off' | 'notifications-stopped', string>> = {
  'notifications-on': 'Notifications turned on',
  'notifications-off': 'Notifications turned off',
  'notifications-stopped': 'Notifications stopped',
};

// 1.2: the four accounts picked, as the change log shows them (13.5); the
// old card only when this setup has one ("Off in this setup"), and her second
// card only in hers.
export function bankAccountsText(accounts: Readonly<Partial<Record<'checking' | 'savings' | 'everyday-card' | 'old-card' | 'second-card', string>>>): string {
  const three = `Checking: ${accounts.checking ?? ''}; savings: ${accounts.savings ?? ''}; everyday card: ${accounts['everyday-card'] ?? ''}`;
  const second = accounts['second-card'] === undefined ? three : `${three}; second card: ${accounts['second-card']}`;
  return accounts['old-card'] === undefined ? second : `${second}; old card: ${accounts['old-card']}`;
}

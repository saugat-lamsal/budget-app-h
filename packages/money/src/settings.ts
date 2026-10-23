import { assertCentsAtLeastZero, type Cents } from './cents.js';
import { assertIsoDate, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';

// Rule 0.2: every number and rule in the rulebook is a setting. These are
// the starting values from rulebook section 2.

export type LeftoverChoice = 'ask' | 'roll-over' | 'move-to-savings';

// Section 2 (A48): every so many days from the last paycheck
// (payScheduleDays), or twice a month, on the 15th and the last day of the
// month (the Friday before when that day is a Saturday or Sunday).
export type PaySchedule = 'every-n-days' | 'twice-a-month';
export const PAY_SCHEDULES: readonly PaySchedule[] = ['every-n-days', 'twice-a-month'];

// Matches a bank description that contains this text, ignoring case.
export interface TextRule {
  readonly contains: string;
}

export interface Settings {
  // Percent of each paycheck (after the mom reserve) for each bucket.
  readonly split: { readonly savings: number; readonly needs: number; readonly wants: number };
  readonly momReservePerPaycheck: Cents;
  readonly momReserveCap: Cents;
  readonly momMonthlyTarget: { readonly low: Cents; readonly high: Cents };
  readonly lowBucketAlertPercent: number;
  readonly cardReminderDaysBefore: readonly number[];
  // "HH:MM", 24-hour clock.
  readonly dailyReviewTime: string;
  readonly leftoverAtPayday: { readonly needs: LeftoverChoice; readonly wants: LeftoverChoice };
  readonly oldCardPromoEndDate: IsoDate | null;
  // How a paycheck shows up on the statement. Set after the first sync.
  readonly paycheckRule: TextRule | null;
  readonly paySchedule: PaySchedule;
  // Days between paychecks, for the every-n-days pay schedule.
  readonly payScheduleDays: number;
  // Mom's name as it appears on transfers.
  readonly momRule: TextRule | null;
  // Rule 3.7: a paycheck-looking deposit less than this many days after the
  // last paycheck goes to review.
  readonly earlyPaycheckDays: number;
  // Section 2: his home time zone, by its name ("America/New_York"). The
  // app's today is the date there. The money math has no clock: it only
  // keeps this, for whoever reads the clock (the server).
  readonly homeTimeZone: string;
  // Rule 10.8: no alert is sent from `from` to `to` ("HH:MM", 24-hour clock,
  // in his home time zone); what comes due then waits until they end. The
  // same time twice is no quiet hours at all.
  readonly quietHours: { readonly from: string; readonly to: string };
  // Rule 10.7: an alert once the last good read of the bank is this many
  // hours old.
  readonly bankNotReadAlertHours: number;
  // Rule 10.4 (A47): totals that do not match the bank are told once the
  // difference has lasted this many hours. Until then the bank is still
  // catching up.
  readonly totalsMismatchAlertHours: number;
  // Rule 10.10: whether an alert shows its amounts on the phone's lock
  // screen. The money math only keeps these three, for the server that sends
  // the alerts.
  readonly amountsOnLockScreen: boolean;
  // Rule 10.13: told this many days before the bank stops letting the app
  // read the accounts. The money math only keeps it, for the server.
  readonly bankPermissionWarnDays: number;
  // Rule 9.8 (A52, A53): when the bank sends no statement date for a card, it
  // is the last day before the card's due date on this day of the month (the
  // month's last day in a month too short for it); null until he enters it
  // (that card's reminders are off until then). The money math only keeps
  // these, for the server that reads the bank's statements.
  readonly everydayCardClosingDay: number | null;
  readonly oldCardClosingDay: number | null;
  // Her rulebook, section 2 and 3.1: while on, every paycheck waits in review
  // for a yes before it is split. Upstream's settings do not have it, and
  // without it, it is off, as upstream: a deposit the paycheck rule matches
  // is split by itself. So upstream's DEFAULT_SETTINGS stay as they are, and
  // a history saved before it opens as upstream (B242).
  readonly askBeforeSplittingPaycheck?: boolean;
}

export const DEFAULT_SETTINGS: Settings = deepFreeze({
  split: { savings: 50, needs: 30, wants: 20 },
  momReservePerPaycheck: 150_000,
  momReserveCap: 300_000,
  momMonthlyTarget: { low: 200_000, high: 300_000 },
  lowBucketAlertPercent: 20,
  cardReminderDaysBefore: [7, 2],
  dailyReviewTime: '20:00',
  leftoverAtPayday: { needs: 'ask', wants: 'ask' },
  oldCardPromoEndDate: null,
  paycheckRule: null,
  paySchedule: 'every-n-days',
  payScheduleDays: 14,
  momRule: null,
  earlyPaycheckDays: 10,
  homeTimeZone: 'America/New_York',
  quietHours: { from: '22:00', to: '07:00' },
  bankNotReadAlertHours: 24,
  totalsMismatchAlertHours: 12,
  amountsOnLockScreen: false,
  bankPermissionWarnDays: 7,
  everydayCardClosingDay: null,
  oldCardClosingDay: null,
});

// Her settings, which upstream's DEFAULT_SETTINGS do not have (see each in Settings).
const HER_SETTING_KEYS: readonly (keyof Settings)[] = ['askBeforeSplittingPaycheck'];

const LEFTOVER_CHOICES: readonly LeftoverChoice[] = ['ask', 'roll-over', 'move-to-savings'];

// Rule 13.1: a change to these waits for the next paycheck; every other
// setting applies right away (QUESTIONS.md B38).
export const FROM_NEXT_PAYCHECK = Object.freeze(['split', 'momReservePerPaycheck', 'momReserveCap'] as const);

export function changeSettings(current: Settings, patch: Partial<Settings>): Settings {
  for (const key of Object.keys(patch)) check(Object.hasOwn(DEFAULT_SETTINGS, key) || (HER_SETTING_KEYS as readonly string[]).includes(key), `there is no setting called ${key}`);
  return validateSettings({ ...current, ...patch });
}

// Returns a frozen copy, or refuses with code "bad-setting".
export function validateSettings(settings: Settings): Settings {
  const s = settings;
  check(
    [s.split.savings, s.split.needs, s.split.wants].every((p) => Number.isInteger(p) && p >= 0 && p <= 100),
    'split percentages must be whole numbers from 0 to 100',
  );
  const sum = s.split.savings + s.split.needs + s.split.wants;
  check(sum === 100, `split must add up to 100, not ${sum}`);
  checkCents(s.momReservePerPaycheck, 'mom reserve per paycheck');
  checkCents(s.momReserveCap, 'mom reserve cap');
  checkCents(s.momMonthlyTarget.low, 'mom monthly target low end');
  checkCents(s.momMonthlyTarget.high, 'mom monthly target high end');
  check(s.momMonthlyTarget.low <= s.momMonthlyTarget.high, 'mom monthly target low end must not be above the high end');
  check(isWholeInRange(s.lowBucketAlertPercent, 0, 100), 'low-bucket alert must be a whole percent from 0 to 100');
  check(s.cardReminderDaysBefore.every((d) => isWholeInRange(d, 0, Infinity)), 'card reminder days must be whole days, zero or more');
  check(isClockTime(s.dailyReviewTime), 'daily review time must be HH:MM');
  check(LEFTOVER_CHOICES.includes(s.leftoverAtPayday.needs), 'leftover choice for needs is not one of the options');
  check(LEFTOVER_CHOICES.includes(s.leftoverAtPayday.wants), 'leftover choice for wants is not one of the options');
  if (s.oldCardPromoEndDate !== null) {
    try {
      assertIsoDate(s.oldCardPromoEndDate);
    } catch {
      check(false, 'old card promo end date must be a real date');
    }
  }
  checkTextRule(s.paycheckRule, 'paycheck rule');
  checkTextRule(s.momRule, 'mom rule');
  check(PAY_SCHEDULES.includes(s.paySchedule), 'pay schedule must be every so many days or twice a month');
  check(isWholeInRange(s.payScheduleDays, 1, Infinity), 'pay schedule must be a whole number of days, at least 1');
  check(isWholeInRange(s.earlyPaycheckDays, 0, Infinity), 'early paycheck days must be a whole number, zero or more');
  check(isTimeZone(s.homeTimeZone), 'home time zone must be the name of a time zone, such as America/New_York');
  check(typeof s.quietHours === 'object' && s.quietHours !== null && isClockTime(s.quietHours.from) && isClockTime(s.quietHours.to), 'quiet hours must be two times, HH:MM');
  check(isWholeInRange(s.bankNotReadAlertHours, 1, 168), 'the bank-not-read alert must be a whole number of hours from 1 to 168');
  check(isWholeInRange(s.totalsMismatchAlertHours, 1, 168), 'the totals-do-not-match alert must be a whole number of hours from 1 to 168');
  check(typeof s.amountsOnLockScreen === 'boolean', 'amounts on the lock screen must be on or off');
  check(isWholeInRange(s.bankPermissionWarnDays, 1, 60), 'the warning before the bank permission runs out must be a whole number of days from 1 to 60');
  check(s.everydayCardClosingDay === null || isWholeInRange(s.everydayCardClosingDay, 1, 31), "the everyday card's statement closing day must be a day of the month from 1 to 31");
  check(s.oldCardClosingDay === null || isWholeInRange(s.oldCardClosingDay, 1, 31), "the old card's statement closing day must be a day of the month from 1 to 31");
  check(!('askBeforeSplittingPaycheck' in s) || typeof s.askBeforeSplittingPaycheck === 'boolean', 'ask before splitting a paycheck must be on or off');
  return deepFreeze(copySettings(s));
}

function copySettings(s: Settings): Settings {
  return {
    ...s,
    split: { ...s.split },
    momMonthlyTarget: { ...s.momMonthlyTarget },
    cardReminderDaysBefore: [...s.cardReminderDaysBefore],
    leftoverAtPayday: { ...s.leftoverAtPayday },
    paycheckRule: s.paycheckRule === null ? null : { ...s.paycheckRule },
    momRule: s.momRule === null ? null : { ...s.momRule },
    quietHours: { ...s.quietHours },
  };
}

// "HH:MM" on a 24-hour clock.
function isClockTime(time: string): boolean {
  return typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new MoneyError('bad-setting', message);
}

function checkCents(value: Cents, what: string): void {
  try {
    assertCentsAtLeastZero(value, what);
  } catch {
    check(false, `${what} must be whole cents, zero or more`);
  }
}

function checkTextRule(rule: TextRule | null, what: string): void {
  if (rule !== null) check(rule.contains.trim() !== '', `${what} needs some text to match`);
}

// A time zone by its name, as the time zone database writes it. Looks at no clock.
function isTimeZone(zone: string): boolean {
  if (typeof zone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(zone) || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function isWholeInRange(value: number, low: number, high: number): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

// True when a bank description matches a text rule, ignoring case.
export function matchesTextRule(rule: TextRule | null, description: string): boolean {
  return rule !== null && description.toLowerCase().includes(rule.contains.trim().toLowerCase());
}

import type { EvenPace, Landing, OldCardPlan, PaydayEffect, PlaceGroup, RepeatCharge, SavingsYearOut, TrendsPart, TrendsPeriodShown as TrendsPeriod, Usual, Weekdays, WantsStreak } from '@budget-app/server/views';
import type { IsoDate } from '@budget-app/money';
import type { IconName } from '../ui/Icon.js';
import { dayWithYear, monthDay } from '../ui/dates.js';
import { moneyText, moneyWords } from '../ui/money-format.js';

// The Trends tab in words (rulebook section 40, QUESTIONS.md A58). Every
// amount and date comes from the server; these only say them, so what a
// bar's color shows is always also in words.

const PART_NAMES: Readonly<Record<TrendsPart, string>> = { needs: 'Needs', wants: 'Wants', 'old-card': 'Old card payment', unsorted: 'Unsorted', wishlist: 'Wishlist' };

export function partName(part: TrendsPart): string {
  return PART_NAMES[part];
}

// "Sep 25 – Oct 8"
export function periodRange(p: TrendsPeriod): string {
  return `${monthDay(p.startDate)} – ${monthDay(p.lastDay)}`;
}

// Under its bar: "Sep 25", which its spoken label starts with.
export function periodShort(p: TrendsPeriod): string {
  return monthDay(p.startDate);
}

const BEFORE = { all: "Before setup day: read by today's rules", part: "Partly before setup day: read by today's rules" } as const;

// 40.1, 40.3: what is not a plain full pay period from the books says so.
export function periodNote(p: TrendsPeriod): string | null {
  const notes = [p.current ? 'So far' : null, p.cutOff ? 'Part of a pay period' : null, p.beforeSetup === 'none' ? null : BEFORE[p.beforeSetup]].filter((n): n is string => n !== null);
  return notes.length === 0 ? null : notes.join('. ');
}

// 40.4: everything a bar shows, in words, for a screen reader.
export function barWords(p: TrendsPeriod): string {
  const head = [`${periodRange(p)}${p.current ? ', so far' : ''}`, p.cutOff ? 'Part of a pay period' : null, p.beforeSetup === 'none' ? null : BEFORE[p.beforeSetup]].filter((n): n is string => n !== null).join('. ');
  // "Off in this setup": only the parts it has (no old card part with the old card off).
  // Her rulebook, 40.4: and Wishlist's part, where the setup has it.
  const parts = (['needs', 'wants', 'old-card', 'unsorted', 'wishlist'] as const).flatMap((part) => {
    const cents = p.spent[part];
    return cents === undefined ? [] : [`${PART_NAMES[part].toLowerCase()} ${moneyWords(cents)}`];
  });
  return `${head}. Spent ${moneyWords(p.total)}: ${parts.join(', ')}.`;
}

// Her rulebook, 40.5: Wishlist over time beside savings, in words; nothing
// where the setup has no Wishlist.
export function wishlistOverTimeWords(first: { readonly wishlist?: number }, now: { readonly wishlist?: number }): string {
  return now.wishlist === undefined ? '' : `; Wishlist from ${moneyWords(first.wishlist ?? 0)} to ${moneyWords(now.wishlist)}`;
}

// 40.1: how far back it goes.
export function sinceText(historyFrom: IsoDate | null, setupDay: IsoDate): string {
  return `Since ${monthDay(historyFrom ?? setupDay)}`;
}

// 40.6
export function placeGroupName(g: PlaceGroup): string {
  return g.kind === 'place' ? g.name : g.kind === 'old-card' ? 'Old card payments' : 'Everything else';
}

// 40.7
// oldCard: false when the old card is off, and so nothing is left out ("Off in this setup").
export function usualLines(usual: Usual, day: number, oldCard = true): readonly string[] {
  if (usual.state === 'not-enough') return ['Not enough pay periods yet to know your usual.', `It takes 3 full pay periods; there ${usual.fullPeriods === 1 ? 'is 1' : `are ${usual.fullPeriods}`} so far.`];
  const which = usual.periods % 2 === 1 ? `The middle one of your last ${usual.periods} full pay periods.` : `The middle of your last ${usual.periods} full pay periods.`;
  return [`Usual by day ${day}: ${moneyText(usual.byToday)}`, `A whole pay period usually: ${moneyText(usual.whole)}`, oldCard ? `${which} Old card payments are left out.` : which];
}

// 40.8: always the amount in words, with an icon, never color alone.
export function paceWords(pace: EvenPace): { readonly title: string; readonly tone: 'warning' | 'ok' | 'info'; readonly icon: IconName } {
  if (pace.state === 'none') return { title: 'No even pace: Wants started this pay period at $0.00 or below', tone: 'info', icon: 'info' };
  if (pace.difference < 0) return { title: `${moneyText(-pace.difference)} less left than an even pace`, tone: 'warning', icon: 'alert' };
  if (pace.difference > 0) return { title: `${moneyText(pace.difference)} more left than an even pace`, tone: 'ok', icon: 'check' };
  return { title: 'On an even pace', tone: 'ok', icon: 'check' };
}

export function dayOfText(day: number, days: number): string {
  return day > days ? `Day ${day}: the payday has passed` : `Day ${day} of ${days}`;
}

// ----- Future (40.10 to 40.13): every amount about the future says "Estimate" -----

const days = (n: number): string => (n === 1 ? '1 day' : `${n} days`);

// 40.11
export function landingWords(name: string, landing: Landing): { readonly title: string; readonly detail: string; readonly tone: 'warning' | 'ok' | 'info'; readonly icon: IconName } {
  if (landing.state === 'too-early') return { title: `${name}: too early in the pay period to tell`, detail: 'An estimate comes on day 3.', tone: 'info', icon: 'info' };
  if (landing.state === 'payday-passed') return { title: `${name}: no estimate, payday has passed with no paycheck`, detail: 'It starts again with the next paycheck.', tone: 'info', icon: 'info' };
  const below = landing.lands < 0;
  return {
    title: `Estimate: ${name} lands at about ${moneyText(landing.lands)} by payday${below ? ', below zero' : ''}`,
    detail: `At this pay period’s pace: ${moneyText(landing.spentSoFar)} spent in ${days(landing.daysSoFar)}, ${days(landing.daysLeft)} left.`,
    tone: below ? 'warning' : 'ok',
    icon: below ? 'alert' : 'check',
  };
}

export function waitingWords(cents: number): string | null {
  return cents === 0 ? null : `Not counting ${moneyText(cents)} waiting in review.`;
}

// 40.12
export function savingsWords(s: SavingsYearOut): readonly [string, string] {
  if (s.state === 'not-enough') return ['Not enough pay periods yet to estimate', `It takes 3 pay periods since setup day; there ${s.periods === 1 ? 'is 1' : `are ${s.periods}`} so far.`];
  return [
    `Estimate: ${moneyText(s.low)} to ${moneyText(s.high)} by ${dayWithYear(s.to)}`,
    `${s.paydays} paydays, each adding what a pay period added to savings lately: ${moneyText(s.least)} to ${moneyText(s.most)} (the last ${s.periods} pay periods). The mom reserve is not part of it.`,
  ];
}

// 40.13
export function oldCardWords(plan: OldCardPlan): string {
  switch (plan.state) {
    case 'plan':
      return `Estimate, if each payday’s share is paid: paid off by ${dayWithYear(plan.paidOffBy)}, at ${moneyText(plan.perPayday)} a payday.`;
    case 'due-now':
      return `No payday is left before the promo ends on ${dayWithYear(plan.promoEndDate)}: all of it, ${moneyText(plan.owed)}, is due now.`;
    case 'no-promo-end-date':
      return 'The plan starts once the promo end date is entered.';
    case 'paid-off':
      return 'The old card is paid off.';
  }
}

// ----- Habits (40.14 to 40.17) -----

// 40.14
export function paydayEffectWords(effect: PaydayEffect): readonly string[] {
  if (effect.state === 'not-enough') return ['Not enough pay periods yet', `It takes 3 full pay periods; there ${effect.fullPeriods === 1 ? 'is 1' : `are ${effect.fullPeriods}`} so far.`];
  const over = `over your last ${effect.periods} full pay periods.`;
  const difference = effect.first.perDay - effect.rest.perDay;
  return [
    `Payday and the 2 days after: ${moneyText(effect.first.perDay)} a day`,
    `The rest of the pay period: ${moneyText(effect.rest.perDay)} a day`,
    difference === 0 ? `The same each day, ${over}` : `${moneyText(Math.abs(difference))} a day ${difference > 0 ? 'more' : 'less'} just after payday, ${over}`,
  ];
}

// 40.15: 0 Sunday to 6 Saturday.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? '';
}

export function mostWords(w: Weekdays): string {
  const most = w.days.find((d) => d.weekday === w.most);
  if (most === undefined) return 'Nothing spent in the last 90 days.';
  return `Most on ${weekdayName(most.weekday)}s: ${moneyText(most.average)} on an average ${weekdayName(most.weekday)}.`;
}

// 40.16
const EVERY: Readonly<Record<RepeatCharge['every'], string>> = { week: 'Every week', 'two-weeks': 'Every 2 weeks', month: 'Every month' };

export function repeatWords(r: RepeatCharge): { readonly often: string; readonly next: string; readonly year: string } {
  return { often: EVERY[r.every], next: `Next around ${monthDay(r.next)} (Estimate)`, year: `About ${moneyText(r.perYear)} a year (Estimate)` };
}

// 40.17
export function streakWords(s: WantsStreak): string {
  if (s.ended === 0) return 'No pay period has ended in the books yet.';
  if (s.lastOver) return 'Wants went over last pay period. A new run starts with this one.';
  return `Wants not overspent: ${s.current === 1 ? '1 pay period' : `${s.current} pay periods`} in a row. Best: ${s.best}.`;
}

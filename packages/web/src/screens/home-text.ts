import type { IsoDate } from '@budget-app/money';
import type { CardRemindersOff, OnItsWayIn } from '@budget-app/server/views';
import { nameOf } from '../ui/card-names.js';
import { checkedAtText, shortDate } from '../ui/dates.js';

// Words on Home.

// 11.2: the days to payday. A late paycheck says late (B35).
export function paydayText(days: number): string {
  if (days === 0) return 'Payday is today';
  if (days < 0) return `Paycheck is ${-days} ${-days === 1 ? 'day' : 'days'} late`;
  return `${days} ${days === 1 ? 'day' : 'days'} to payday`;
}

// 11.4 (A56): money still pending at the bank, which counts once it posts.
// A57: since when the app saw it pending (in his home time zone; the day the
// bank dated it when that is not known), and how long earlier ones usually
// took, when the server has the figure.
export function onItsWayInText(item: OnItsWayIn, today: IsoDate, timeZone: string): { readonly title: string; readonly detail: string } {
  const since = 'at' in item.since ? checkedAtText(item.since.at, today, timeZone) : shortDate(item.since.day);
  const usually = item.usually === null ? '' : ` Usually posts within ${item.usually.within} ${item.usually.unit === 'hours' ? (item.usually.within === 1 ? 'hour' : 'hours') : 'days'}.`;
  return { title: item.paycheck ? 'Paycheck on its way' : 'Money on its way in', detail: `To ${item.account}, counted when it posts. Pending since ${since}.${usually}` };
}

// 10.3
export function waitingText(waiting: number): string {
  return `${waiting} waiting in review`;
}

// 9.1, 9.2: when a card payment is due, on a reminder day.
export function dueText(daysLeft: number): string {
  if (daysLeft === 0) return 'due today';
  return `due in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`;
}

// 9.8 (A52): a card whose reminders are off, on Home and on Settings, in the
// rulebook's words.
export function cardsOffText(off: CardRemindersOff): { readonly title: string; readonly detail: string } {
  // Her second card too; in her setup each card by the name its bank gives it (HB6).
  const plain = off.card === 'everyday-card' ? 'the everyday card' : off.card === 'second-card' ? 'the second card' : 'the old card';
  const title = `Card reminders are off for ${nameOf(off.card) ?? plain}`;
  return off.why === 'no-statement-date'
    ? { title, detail: 'The bank did not send its statement date. Enter the day its statement closes in Settings.' }
    : { title, detail: 'The bank sent a statement for it that cannot be read.' };
}

// After setup day: the rules not set yet (section 2), and what waits for them.
export function stillToSetText(settings: readonly ('paycheckRule' | 'momRule')[]): { readonly title: string; readonly detail: string } {
  const paycheck = settings.includes('paycheckRule');
  const mom = settings.includes('momRule');
  if (paycheck && mom) return { title: 'Still to set: the paycheck rule and the mom rule', detail: 'Until then your paycheck and payments to mom wait in Review. Set them in Settings.' };
  if (paycheck) return { title: 'Still to set: the paycheck rule', detail: 'Until then your paycheck waits in Review. Set it in Settings.' };
  return { title: 'Still to set: the mom rule', detail: 'Until then payments to mom wait in Review. Set it in Settings.' };
}

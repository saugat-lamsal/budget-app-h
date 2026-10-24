import type { CarriedIn, IsoDate, StatementBucket, StatementPeriod, WishlistMove } from '@budget-app/money';
import type { HomeCard, HomeCardState } from '@budget-app/server/views';
import { nameOf } from '../ui/card-names.js';
import { shortDate } from '../ui/dates.js';
import { moneyText } from '../ui/money-format.js';

// Words for her cards (her rulebook, section 52): each card's row on Home, the
// sheet that says why paying a card isn't spending, and the Statement screen.
// Due and paid are said in words, never by color alone.

const PLAIN: Readonly<Record<HomeCard['card'], string>> = { 'everyday-card': 'Everyday card', 'second-card': 'Second card' };

// Each card as its bank names it (HB6), or its role before the names come.
export function cardName(card: HomeCard['card']): string {
  return nameOf(card) ?? PLAIN[card];
}

// 52.1, 9.6: where the card's payment stands, in words.
export function cardStateText(state: HomeCardState, dueDate: IsoDate): string {
  switch (state.kind) {
    case 'due':
      return state.daysLeft === 0 ? 'Due today' : `Due in ${state.daysLeft} ${state.daysLeft === 1 ? 'day' : 'days'}`;
    case 'overdue':
      return 'Overdue';
    case 'paid':
      return 'Paid in full';
    case 'minimum-paid':
      return 'Minimum paid';
    case 'not-due-yet':
      return `Due ${shortDate(dueDate)}`;
  }
}

// 52.1, 9.8: a card with no statement to show, and why.
export function noStatementText(why: Extract<HomeCard['statement'], { shown: false }>['why']): string {
  switch (why) {
    case 'no-statement-date':
      return 'Card reminders are off: the bank did not send its statement date. Enter the day its statement closes in Settings.';
    case 'unreadable':
      return 'Card reminders are off: the bank sent a statement for it that cannot be read.';
    case 'none-yet':
      return 'No statement from the bank yet.';
  }
}

// 52.2: what is set aside for it. A card that owes less than nothing has a
// credit, and nothing is set aside for it (HB12).
export function setAsideText(owes: number): string {
  if (owes < 0) return `A credit of ${moneyText(-owes)}: nothing to set aside.`;
  if (owes === 0) return 'Owes nothing now.';
  return `Owes ${moneyText(owes)} now, all of it set aside.`;
}

// Her rulebook, 50.4: the Wishlist money to move from savings to checking,
// and when: by the card's due date, as 9.6 says due and overdue.
export function wishlistMoveText(move: WishlistMove): { readonly title: string; readonly detail: string } {
  const title = `Move ${moneyText(move.amount)} from savings to checking`;
  const why = 'For what you bought from Wishlist, whose money is kept in savings.';
  const when = move.when;
  if (when === null || when.kind === 'now') return { title, detail: `${why} Now: it has already left checking.` };
  const name = `the ${cardName(when.card)}`;
  if (when.kind === 'before-next-due') return { title, detail: `${why} Before ${name}'s next due date.` };
  if (when.day === 'before') return { title, detail: `${why} Before ${name} is due, ${shortDate(when.dueDate)}.` };
  if (when.day === 'on') return { title, detail: `${why} Today: ${name} is due today, ${shortDate(when.dueDate)}.` };
  return { title, detail: `${why} Now: ${name} was due ${shortDate(when.dueDate)}.` };
}

// 52.2: how much of the set-aside money is in savings rather than checking.
export function inSavingsText(inSavings: number): string {
  return `${moneyText(inSavings)} of the money set aside for your cards is in your savings account, not checking.`;
}

// The card's sheet in the app (her rulebook, 52.2, in plain words, with
// made-up numbers).
export const WHY_NOT_SPENDING = {
  title: "Why paying your card isn't spending",
  paragraphs: [
    'When you buy $30 of groceries on a card, the app takes the $30 out of Needs that same day. Your checking account still has the $30, because you haven\'t paid the card yet.',
    'So the $30 isn\'t in any bucket any more, but it\'s still in your account, waiting for the card bill. That\'s what "set aside" means.',
    'When you pay the card $30 from checking, checking goes down $30 and the card goes down $30, and no bucket changes, because the $30 was already counted on the day you bought the groceries.',
    "You don't have to work out the bill or save for it separately. If every purchase is sorted, the money for each card is already there.",
  ],
} as const;

// ----- The Statement screen (52.4) -----

export function bucketTitle(bucket: StatementBucket): string {
  switch (bucket) {
    case 'needs':
      return 'Needs';
    case 'wants':
      return 'Wants';
    case 'wishlist':
      return 'Wishlist';
    case 'unsorted':
      return 'Still unsorted';
    case 'before-setup':
      return 'Before setup day';
  }
}

// A pay period by its paycheck; the first, from setup day.
export function periodTitle(period: StatementPeriod | 'before-setup'): string {
  if (period === 'before-setup') return 'Before setup day';
  return period.number === 0 ? `From setup day, ${shortDate(period.startDate)}` : `Paycheck of ${shortDate(period.startDate)}`;
}

export function carriedInText(carried: CarriedIn): { readonly title: string; readonly detail: string } {
  if (carried.kind === 'before-the-app') return { title: 'From before the app saw this card', detail: 'The first statement the app has seen: what is on it that the app has no record of.' };
  const paid = -carried.paymentsAndCredits;
  const less = paid === 0 ? 'with nothing paid or credited since' : paid > 0 ? `less ${moneyText(paid)} paid and credited since` : `plus ${moneyText(-paid)} taken back since`;
  return { title: 'Carried in from the statement before', detail: `${moneyText(carried.before)} on the statement before, ${less}.` };
}

export const NOT_MATCHED = { title: 'Not matched to a purchase', detail: "This much is on the bank's statement that the app's lines do not account for." } as const;

export function statementDaysText(from: IsoDate, closing: IsoDate, due: IsoDate): string {
  return `${shortDate(from)} to ${shortDate(closing)} · due ${shortDate(due)}`;
}

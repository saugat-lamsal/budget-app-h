import { MoneyError, parseDollars, type Cents, type IsoDate, type WishlistLogLine } from '@budget-app/money';
import type { ChoiceOf } from '@budget-app/server/views';
import { shortDate } from '../ui/dates.js';
import { moneyText } from '../ui/money-format.js';

// Words for her Wishlist list (her rulebook, 50.1 to 50.3). How far along an
// item is, in words and amount, never only a bar; "Ready" in words; what was
// bought; and each change to the list. Every number comes from the server.

// 50.2: what an item has of its price, and how far along it is.
export function itemProgressText(item: { readonly has: Cents; readonly price: Cents; readonly ready: boolean; readonly percent: number }): string {
  if (item.ready) return `Ready: ${moneyText(item.has)} of ${moneyText(item.price)}`;
  if (item.has === 0) return `Nothing yet of ${moneyText(item.price)}`;
  return `${moneyText(item.has)} of ${moneyText(item.price)}, ${item.percent}% of the way`;
}

// 50.2: "More than the list needs"; nothing at $0.00.
export function moreText(more: Cents): string | null {
  return more > 0 ? `More than the list needs: ${moneyText(more)}` : null;
}

// 50.1, 13.5: one change to the list, dated.
export function logLineText(line: WishlistLogLine): string {
  const day = shortDate(line.date);
  switch (line.action) {
    case 'added':
      return `${day}: added ${line.name}, ${moneyText(line.price)}`;
    case 'changed':
      return line.was === undefined ? `${day}: changed ${line.name}, ${moneyText(line.price)}` : `${day}: changed ${line.was.name}, ${moneyText(line.was.price)} to ${line.name}, ${moneyText(line.price)}`;
    case 'removed':
      return `${day}: removed ${line.name}`;
    case 'moved-up':
      return `${day}: moved ${line.name} up`;
    case 'moved-down':
      return `${day}: moved ${line.name} down`;
    case 'bought':
      return `${day}: marked ${line.name} bought, for ${moneyText(line.paid ?? 0)}`;
    case 'not-bought':
      return `${day}: put ${line.name} back on the list`;
  }
}

// 50.3, 60a: what was bought, on the day of the purchase, for what it cost.
export function boughtText(bought: { readonly day: IsoDate; readonly paid: Cents; readonly price: Cents }): string {
  const paid = `Bought ${shortDate(bought.day)} for ${moneyText(bought.paid)}.`;
  return bought.paid === bought.price ? paid : `${paid} Its price was ${moneyText(bought.price)}.`;
}

// 50.1: a price as she types it, in dollars; null if it is not more than $0.00.
export function priceOf(typed: string): Cents | null {
  try {
    const cents = parseDollars(typed.trim());
    return cents > 0 ? cents : null;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

// 50.3: whether a choice puts something in Wishlist, so review asks which item.
export function putsInWishlist(choice: ChoiceOf): boolean {
  if ('to' in choice) return choice.to === 'wishlist';
  if ('split' in choice) return choice.split.some((part) => part.bucket === 'wishlist');
  return false;
}

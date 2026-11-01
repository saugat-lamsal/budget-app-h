import type { CardStanding } from '@budget-app/money';
import type { OnItsWay } from '@budget-app/server/views';
import { nameOf } from '../ui/card-names.js';
import { shortDate } from '../ui/dates.js';
import { moneyText } from '../ui/money-format.js';
import { dueText } from './home-text.js';
import { ACCOUNT_NAMES } from './review-text.js';

// Words for money on its way between his accounts (12.5, B44), on Buckets:
// what it is, and where it stands. Money on its way to the old card is
// listed but not counted in the check with the bank (12.4).

export function onItsWayTitle(item: Pick<OnItsWay, 'to'>): string {
  switch (item.to) {
    case 'savings':
      return 'To savings';
    case 'checking':
      return 'To checking';
    case 'everyday-card':
      return `Payment to ${nameOf(item.to) ?? 'the everyday card'}`;
    case 'second-card':
      return `Payment to ${nameOf(item.to) ?? 'the second card'}`;
    case 'old-card':
      return 'Payment to the old card';
  }
}

export function onItsWayDetail(item: Pick<OnItsWay, 'from' | 'to' | 'date' | 'seen' | 'counted'>): string {
  const from = ACCOUNT_NAMES[item.from];
  const card = item.to === 'everyday-card' || item.to === 'old-card' || item.to === 'second-card';
  const to = nameOf(item.to) ?? (card ? `the ${ACCOUNT_NAMES[item.to].toLowerCase()}` : ACCOUNT_NAMES[item.to]);
  const where = item.seen === 'left' ? `Left ${from} ${shortDate(item.date)}. Not ${card ? 'on' : 'in'} ${to} yet.` : `Reached ${to} ${shortDate(item.date)}. Not shown leaving ${from} yet.`;
  return item.counted ? where : `${where} Not part of the check with your bank: the old card is kept apart.`;
}

// 9.9: a card's statement, on Buckets. The amount beside the row is the
// statement balance on the everyday card (9.1) and the minimum on the old card
// (9.2); the row's name says which.
export function cardStatementTitle(line: Pick<CardStanding, 'card'>): string {
  return line.card === 'everyday-card' ? 'Everyday card statement' : 'Old card minimum';
}

export function cardStatementDetail(line: CardStanding): string {
  const due = shortDate(line.dueDate);
  const closed = `Statement closed ${shortDate(line.closingDate)}.`;
  const minimum = `Minimum ${moneyText(line.minimumPayment)}.`;
  switch (line.standing) {
    case 'paid':
      return `${line.card === 'everyday-card' ? 'Paid' : 'Minimum paid'}. Due ${due}. ${closed}`;
    case 'overdue':
      return `Overdue: it was due ${due}. ${minimum} ${closed}`;
    case 'minimum-paid':
      return `The due date passed, ${due}, with ${moneyText(line.paid)} paid. The minimum was met; interest may apply to the rest. ${closed}`;
    case 'to-pay': {
      const when = dueText(line.daysLeft);
      const parts = [`${when.charAt(0).toUpperCase()}${when.slice(1)}, ${due}.`];
      if (line.card === 'everyday-card') parts.push(minimum);
      if (line.paid > 0) parts.push(`${moneyText(line.paid)} paid so far.`);
      parts.push(closed);
      return parts.join(' ');
    }
  }
}

import type { OnItsWay } from '@budget-app/server/views';
import { nameOf } from '../ui/card-names.js';
import { shortDate } from '../ui/dates.js';
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

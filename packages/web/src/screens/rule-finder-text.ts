import { formatDollars } from '@budget-app/money';
import type { FoundGroup, FoundLine, FoundMatches, FoundOverlap, FoundRule } from '@budget-app/server/views';
import { dayWithYear } from '../ui/dates.js';
import { accountPhrase } from './setup-text.js';

// Her rulebook, section 53: the words of the rule finder on setup day. Plain
// words for her, the numbers from the server.

export const FOUND_GROUPS: readonly FoundGroup[] = ['card-payments', 'transfers', 'people-fees', 'paycheck', 'places'];

export const GROUP_TITLES: Readonly<Record<FoundGroup, string>> = {
  'card-payments': 'Card payments',
  transfers: 'Transfers between checking and savings',
  'people-fees': 'Payments to people, fees and interest',
  paycheck: 'Your paycheck',
  places: 'Places you pay often',
};

export const GROUP_NOTES: Readonly<Record<FoundGroup, string>> = {
  'card-payments': 'Money that left checking or savings and reached a card for the same amount a few days later. Each side gets its own rule, in its bank’s words.',
  transfers: 'Money that left checking or savings and reached the other for the same amount a few days later.',
  'people-fees': 'Items your banks label as payments to people, or as fees and interest on a card.',
  paycheck: 'A deposit that comes about every 14 days. There is one paycheck rule.',
  places: 'Places you paid 3 or more times. Pick needs or wants for each; Wishlist stays a choice you make in Review.',
};

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const isCard = (account: string): boolean => account === 'everyday-card' || account === 'second-card' || account === 'old-card';

// What the rule would mean, in words.
export function ruleMeaning(rule: FoundRule): string {
  switch (rule.kind) {
    case 'paycheck':
      return 'Your paycheck: a deposit with these words starts a new pay period, once you say yes.';
    case 'place':
      return rule.bucket === null ? 'A place you pay often. Your bank gives it no category, so pick needs or wants.' : `A place you pay often. Suggested: ${capital(rule.bucket)}, from your bank’s category.`;
    case 'bank-rule': {
      const on = capital(accountPhrase(rule.account));
      switch (rule.means) {
        case 'transfer':
          if (rule.other === null) return `${on}: money between your accounts.`;
          if (isCard(rule.account)) return `${on}: a payment from ${accountPhrase(rule.other)}. Not a refund.`;
          if (isCard(rule.other)) return `${on}: paying ${accountPhrase(rule.other)}. Not spending.`;
          return `${on}: money moved to or from ${accountPhrase(rule.other)}. Not spending.`;
        case 'payment-to-person':
          return `${on}: a payment to a person.`;
        case 'card-fee':
          return `${on}: a card fee.`;
        case 'card-interest':
          return `${on}: interest on the card.`;
      }
    }
  }
}

const items = (n: number): string => (n === 1 ? '1 item' : `${n} items`);
const accountsText = (accounts: readonly string[]): string => accounts.map((a) => accountPhrase(a as never)).join(' and ');

// 53.8: what it would have matched, in a line.
export function matchedText(m: FoundMatches): string {
  if (m.count === 0 || m.from === null || m.to === null) return 'It would have matched nothing in your history.';
  const when = m.from === m.to ? `on ${dayWithYear(m.from)}` : `from ${dayWithYear(m.from)} to ${dayWithYear(m.to)}`;
  const also = m.alsoCount === 0 ? '' : ` ${capital(items(m.alsoCount))} of them ${m.alsoCount === 1 ? 'is' : 'are'} not what it was found from: see below.`;
  return `It would have matched ${items(m.count)} on ${accountsText(m.accounts)}, ${when}.${also}`;
}

export function itemText(i: { readonly date: string; readonly description: string; readonly amount: number; readonly direction: 'in' | 'out'; readonly pending: boolean }): string {
  return `${dayWithYear(i.date)} · ${i.description} · ${i.direction === 'in' ? '+' : ''}${formatDollars(i.amount)}${i.pending ? ' · pending' : ''}`;
}

// 53.9: why it cannot be kept as it is, or what it shares with another suggestion.
export function overlapText(o: FoundOverlap, found: readonly FoundLine[]): string {
  if ('suggestion' in o.with) {
    const other = found.find((l) => l.id === (o.with as { readonly suggestion: string }).suggestion);
    return `Reads ${o.count === 1 ? 'an item' : `${o.count} of the same items`} as “${other?.rule.contains ?? 'another suggestion'}”. Keep one of the two, or neither.`;
  }
  return `Your rule “${o.with.rule.contains}” reads ${o.count === 1 ? 'an item' : `${o.count} of the same items`}. Change its words or skip it.`;
}

export function statusWords(status: FoundLine['status']): string {
  switch (status) {
    case 'open':
      return 'Not answered yet';
    case 'added':
      return 'Kept';
    case 'changed':
      return 'Kept, with your words';
    case 'skipped':
      return 'Skipped';
    case 'covered':
      return 'You have this rule already';
  }
}

// The finder's sheet, as the rulebook has it (section 53, made-up example).
export const FINDER_SHEET: readonly string[] = [
  'The app looked through what your banks sent and found things that repeat.',
  'For example, $250.00 left checking on Mar 3 and $250.00 reached your Amex card on Mar 4, and the same happened five more times. So it suggests two rules: on checking, “EPAY TO AMEX” means paying your Amex card, and on the Amex card, “ONLINE PAYMENT RECEIVED” means money from checking.',
  'Each rule shows what it would have matched. Keep it, change its words first, or skip it.',
  'Your buckets don’t change: rules only decide how the app reads what the banks send.',
];

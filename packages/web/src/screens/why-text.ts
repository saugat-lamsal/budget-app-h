import { formatDollars } from '@budget-app/money';
import type { WhyAccount, WhyLine } from '@budget-app/server/views';
import { nameOf, withCardNames } from '../ui/card-names.js';

// Rule 12.6 (QUESTIONS.md A57): each line of why the totals do not match, in
// the rulebook's words. The server works out every line and its amount; this
// only says them.

// Her second card, and in her setup each card as its bank names it (HB6).
const NAMES: Readonly<Record<WhyAccount, string>> = withCardNames({ checking: 'Checking', savings: 'Savings', 'everyday-card': 'Everyday card', 'second-card': 'Second card' });
const PLAIN_WHOSE: Readonly<Record<WhyAccount, string>> = { checking: "Checking's", savings: "Savings'", 'everyday-card': "The everyday card's", 'second-card': "The second card's" };
const whose = (account: WhyAccount): string => {
  const named = nameOf(account);
  return named === null ? PLAIN_WHOSE[account] : `${named}'s`;
};

export function whyText(line: WhyLine): { readonly title: string; readonly detail?: string } {
  switch (line.kind) {
    case 'posted-still-pending':
      return {
        title: itemTitle(line.account, line.description),
        detail: line.charge ? 'Posted at the bank, Plaid still says pending: counted twice for now.' : 'Posted at the bank, Plaid still says pending: counted once Plaid says it posted.',
      };
    case 'not-in-available-yet':
      return { title: itemTitle(line.account, line.description), detail: 'Plaid lists it as pending; the available balance does not show it yet.' };
    case 'amount-changed':
      return { title: itemTitle(line.account, line.description), detail: `Plaid changed its amount from ${formatDollars(line.was)} to ${formatDollars(line.now)}; the available balance still has the old one.` };
    case 'posted-and-pending':
      return { title: itemTitle(line.account, line.description), detail: 'Posted, and Plaid still lists the pending one too.' };
    case 'balance-moved':
      return { title: `${whose(line.account)} ${line.balance === 'available' ? 'available balance' : 'balance'} went ${line.went} ${formatDollars(line.by)} with no transaction from the bank yet.` };
    case 'rest':
      return { title: "The rest, which the bank's balances and transactions do not account for." };
    case 'no-match-kept':
      return { title: 'No earlier read of the bank that matched is kept to compare with.' };
  }
}

function itemTitle(account: WhyAccount, description: string): string {
  return `${NAMES[account]}: ${description === '' ? 'a pending item' : `“${description}”`}`;
}

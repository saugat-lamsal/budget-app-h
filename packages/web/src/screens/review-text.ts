import type { AccountId, Cents, PickTo, ReviewDetail, RuleOffer, SortedNow, SpendingSort, TransferOutcome } from '@budget-app/money';
import type { BankRuleHint, ChoiceOf, Done } from '@budget-app/server/views';
import { withCardNames } from '../ui/card-names.js';
import { moneyText } from '../ui/money-format.js';
import { POT_NAMES } from '../ui/names.js';

// Words on the Review screen: what each waiting item is, what each choice
// is called, and what was done. The screen shows what the money math offers;
// these are only its names.

// Her second card, and in her setup each card as its bank names it (HB6).
export const ACCOUNT_NAMES: Readonly<Record<AccountId, string>> = withCardNames({
  checking: 'Checking',
  savings: 'Savings',
  'everyday-card': 'Everyday card',
  'old-card': 'Old card',
  'second-card': 'Second card',
});

export const BUCKET_NAMES: Readonly<Record<string, string>> = {
  ...POT_NAMES,
  'not-mine': 'Not mine',
};

type Item = ReviewDetail['item'];

// A32 (13.7): what an item is now, when it changed as the screen read its
// numbers again: its amount, and pending or posted when it can be either.
export function changedWords(amount: Cents, pending: boolean | null): string {
  return `Changed: now ${moneyText(amount)}${pending === null ? '' : pending ? ', pending' : ', posted'}`;
}

export function groupTitle(type: Item['type']): string {
  switch (type) {
    case 'leftover':
      return 'Payday questions';
    case 'money-in':
      return 'Money in';
    case 'spending':
      return 'Spending';
    case 'old-card-purchase':
      return 'Old card';
  }
}

// What the item is, and why it waits (4.2 to 4.9, 5.2, 5.4, 6.1, 3.7, 8.3, 14.2).
export function reasonText(item: Item): string {
  switch (item.type) {
    case 'leftover':
      return 'Left over at payday';
    case 'old-card-purchase':
      return 'New purchase on the old card';
    case 'money-in':
      return item.reason === 'refund'
        ? 'Refund the bank did not match to a purchase'
        : item.reason === 'early-paycheck'
          ? 'Looks like a paycheck, but it came early'
          : item.reason === 'paycheck'
            ? 'Paycheck waiting for your yes'
            : 'Deposit';
    case 'spending':
      switch (item.reason) {
        case 'no-rule':
          return 'No rule matched';
        case 'from-savings':
          return 'Money out of savings';
        case 'card-fee':
          return 'Card fee';
        case 'card-interest':
          return 'Card interest';
        case 'split-changed':
          return 'The split no longer adds up';
        case 'old-card-from-savings':
          return 'Payment to the old card from savings';
        case 'person-payment':
          return 'Payment to a person';
        case 'mom-difference':
          return 'Left over from a mom payment bigger than the reserve';
        case 'setup-difference':
          return 'Different from what was counted on setup day';
      }
  }
}

export function titleOf(item: Item): string {
  if (item.type === 'leftover') return `${BUCKET_NAMES[item.bucket] ?? item.bucket} leftover`;
  return item.description;
}

// A choice's name on a button or a row. For money in, a bucket is a payback
// into it (6.1); for spending it is the bucket the spending comes out of.
export function pickLabel(kind: 'money-in' | 'spending', to: PickTo, short = false): string {
  const bucket = BUCKET_NAMES[to] ?? to;
  if (to === 'paycheck') return 'This is my paycheck';
  if (to === 'other-income') return 'Other income';
  if (to === 'not-mine') return 'Not mine';
  if (to === 'mom') return 'For mom';
  if (kind === 'money-in') return short ? `Into ${bucket}` : `Payback into ${bucket}`;
  return bucket;
}

// Where a purchase went, for the likely purchases of a refund.
export function sortedWords(sorted: SpendingSort): string {
  if ('split' in sorted) return `Split: ${sorted.split.map((p) => `${BUCKET_NAMES[p.bucket] ?? p.bucket} ${moneyText(p.amount)}`).join(', ')}`;
  switch (sorted.to) {
    case 'unsorted':
      return 'Not sorted yet';
    case 'counted-at-setup':
      return 'Counted on setup day';
    default:
      return `In ${BUCKET_NAMES[sorted.to] ?? sorted.to}`;
  }
}

// A20, B110: what it means that he marked a purchase as a transfer, and what picking something else does.
export function markedWords(account: AccountId): string {
  return account === 'old-card'
    ? 'You marked this as a payment to the old card, so it comes out of Needs. Pick what it was, and it counts as the purchase the bank sent instead.'
    : `You marked this as a transfer to ${ACCOUNT_NAMES[account]}. Pick what it was, and it counts as the purchase the bank sent instead.`;
}

// B4, B109: why a payday question asks about less than the bucket held at
// payday. The numbers come from the money math; this only says them.
export function lessSincePaydayWords(atPayday: Cents, lessSincePayday: Cents): string {
  return `${moneyText(atPayday)} at payday, less ${moneyText(lessSincePayday)} spent before payday and sorted since.`;
}

// Where an item is sorted now, in words (rule 4.7, B100): "in Wants", "split: ...".
export function nowWords(now: SortedNow): string {
  if ('split' in now) return `split: ${now.split.map((p) => `${BUCKET_NAMES[p.bucket] ?? p.bucket} ${moneyText(p.amount)}`).join(', ')}`;
  switch (now.to) {
    case 'not-mine':
      return 'marked not mine';
    case 'mom':
      return 'marked for mom';
    case 'other-income':
      return 'counted as other income';
    case 'momReserve':
      return 'in the Mom reserve';
    case 'unsorted':
      return 'not sorted yet';
    case 'counted-at-setup':
      return 'counted on setup day';
    case 'old-card-payment':
      return 'marked as a payment to the old card, out of Needs';
    default:
      return `in ${BUCKET_NAMES[now.to] ?? now.to}`;
  }
}

// 5.6: what marking it a transfer with this account does, from the money
// math (5.1, 5.2, 5.3).
export function transferWords(outcome: TransferOutcome | undefined): { readonly row: string; readonly done: string } {
  switch (outcome) {
    case 'out-of-needs':
      return { row: 'A payment to the old card. It comes out of Needs.', done: 'marked as a payment to the old card. It came out of Needs.' };
    case 'savings-or-needs':
      return {
        row: 'A payment to the old card from savings. It comes back here for you to pick Savings or Needs.',
        done: 'marked as a payment to the old card. It is waiting again, for you to pick Savings or Needs.',
      };
    default:
      return { row: 'No bucket changes. It is money moving between your accounts.', done: '' };
  }
}

// 13.6, 13.8: what each kind of sorting rule covers, in words.
export const RULE_WHAT: Readonly<Record<RuleOffer['for'], 'purchases' | 'payments to people' | 'deposits'>> = { purchase: 'purchases', person: 'payments to people', deposit: 'deposits' };

// What a rule would do, said before he makes it.
export function ruleSentenceText(what: 'purchases' | 'payments to people' | 'deposits', text: string, label: string): string {
  return `From now on, ${what} whose description contains “${text}” are sorted as: ${label}. Anything waiting that matches is sorted now too, if it can be.`;
}

// 13.8: the rule offered the second time a place is sorted the same way by hand.
export function offerText(offer: RuleOffer): string {
  return `You sorted “${offer.contains}” the same way before. Make it a rule so the next one sorts itself?`;
}

// What was done, said back to him (after "Done" from the server). about
// names what the choice pointed at: the purchase a refund was matched to, or
// what a transfer did.
export function doneText(label: string, kind: 'money-in' | 'spending' | 'leftover' | 'old-card-purchase', done: Done, about?: string): string {
  const c: ChoiceOf = done.choice;
  let text: string;
  if ('refundOf' in c) {
    text = `${label} matched to ${about ?? 'the purchase'}, as if the bank had matched it.`;
  } else if ('to' in c) {
    if (c.to === 'paycheck') text = `${label} is your paycheck. A new pay period started.`;
    else if (c.to === 'other-income') text = `${label} counted as other income.`;
    else if (c.to === 'not-mine') text = kind === 'money-in' ? `${label} is held for others.` : `${label} marked not mine.`;
    else if (c.to === 'mom') text = `${label} marked for mom.`;
    else if (kind === 'money-in') text = `${label} put back into ${BUCKET_NAMES[c.to] ?? c.to}.`;
    else if (c.to === 'savings') text = `${label} taken out of Savings.`;
    else text = `${label} sorted to ${BUCKET_NAMES[c.to] ?? c.to}.`;
  } else if ('split' in c) {
    text = `${label} split: ${c.split.map((p) => `${BUCKET_NAMES[p.bucket] ?? p.bucket} ${p.amount === 'rest' ? 'the rest' : moneyText(p.amount)}`).join(', ')}.`;
  } else if ('transfer' in c) {
    text = about === undefined || about === '' ? `${label} marked as a transfer with ${ACCOUNT_NAMES[c.transfer]}.` : `${label} ${about}`;
  } else if ('unmark' in c) {
    text = `${label} is what the bank sent again, not a payment to the old card. It waits in Review for you to sort it.`;
  } else if ('leftover' in c) {
    text = c.leftover === 'roll-over' ? `${label} kept for this pay period.` : `${label} moved to Savings.`;
  } else {
    text = `Seen: ${label}.`;
  }
  if (done.alsoSorted > 0) text += ` ${done.alsoSorted} other waiting ${done.alsoSorted === 1 ? 'item' : 'items'} matched and ${done.alsoSorted === 1 ? 'was' : 'were'} sorted too.`;
  // A19: what the rule matched but could not sort stays waiting, by name.
  const still = done.stillWaiting;
  if (still.length > 0) text += ` ${still.length} that matched could not take it, so ${still.length === 1 ? 'it is' : 'they are'} still waiting: ${still.map((s) => s.name).join(', ')}.`;
  if (done.sticks === true) text += ' From now on it goes there by itself.';
  if (done.sticks === false) text += ' The text only matches how it looked after it posted, so a new one may still wait while it is pending.';
  return text;
}

// B226: a pending item the bank labels as a transfer or a payment to a
// person, which no bank rule reads as one: the rule for its wording.
export function labeledText(h: BankRuleHint): string {
  const rule = `A bank rule for “${h.contains}” on ${ACCOUNT_PHRASES[h.account]} reads the next ones right: add it on Settings, Bank rules.`;
  if (h.means === 'payment-to-person') return `Your bank labels this a payment to a person, but no bank rule reads it as one, so it counts as a purchase. ${rule}`;
  return `Your bank labels this a transfer between your accounts (a card payment is one), but no bank rule reads it as one, so it counts as spending while it is pending. ${rule} This one you can mark “Transfer between my accounts” once it posts.`;
}

const ACCOUNT_PHRASES: Readonly<Record<AccountId, string>> = withCardNames({ checking: 'checking', savings: 'savings', 'everyday-card': 'the everyday card', 'old-card': 'the old card', 'second-card': 'the second card' });

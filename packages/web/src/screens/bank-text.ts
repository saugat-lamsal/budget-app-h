import type { AccountId } from '@budget-app/money';
import type { BankAccountLine } from '@budget-app/server/views';

// The Bank connection screen's words (rules 1.1 to 1.3). The server decides
// everything; these only say it.

// Upstream's four. Her setup's four come from the server (BankConnectionView.roles).
export const ROLE_ORDER: readonly AccountId[] = ['checking', 'savings', 'everyday-card', 'old-card'];

export const ROLE_NAMES: Readonly<Record<AccountId, string>> = {
  checking: 'Checking',
  savings: 'Savings',
  'everyday-card': 'Everyday card',
  'old-card': 'Old card',
  'second-card': 'Second card',
};

export const ROLE_HINTS: Readonly<Record<AccountId, string>> = {
  checking: 'The account your debit card spends from',
  savings: 'Your savings account',
  'everyday-card': 'The credit card you use normally',
  'old-card': 'The house card you no longer use',
  'second-card': 'Your other credit card, also used day to day',
};

// How one of the bank's accounts is named: its name and last digits.
export function accountLabel(a: Pick<BankAccountLine, 'name' | 'mask'>): string {
  return a.mask === null ? a.name : `${a.name} ••${a.mask}`;
}

// "Off in this setup": a setup that picks three accounts, not four, has words
// that count what is asked. Her setup picks four again (PR 5: the second card).
export function counted(text: string, roles: readonly AccountId[]): string {
  return roles.length === ROLE_ORDER.length ? text : text.replaceAll('four', 'three');
}

export const BANK_WORDS = {
  noneTitle: 'Connect the bank',
  noneTest: "Plaid's test bank, with made-up accounts. Nothing here is real money.",
  noneReal: 'The app reads your Bank of America accounts through Plaid. It never moves money.',
  slots: 'Connecting uses 1 of the 10 connections Plaid allows, and one that is removed never comes back.',
  // The rehearsal: test-bank connections cost nothing.
  slotsTest: "Connecting to Plaid's test bank is free: it does not use any of your 10 real connections.",
  computer: 'Best done on a computer: the bank’s own login opens in a window of its own.',
  connect: 'Connect the bank',
  connecting: 'Connecting…',
  askTitle: 'Connect the bank?',
  askYes: 'Yes, connect',
  askNo: 'Not now',
  closed: 'Nothing was connected.',
  closedFailed: 'The bank’s login stopped before you were done. Nothing was connected. Try again.',
  unavailable: "Plaid's login couldn't be loaded. Check your connection, reload this page, and try again. Nothing was connected.",
  noSignal: "Couldn't reach the app. Check your connection and try again. Nothing was changed.",
  pickTitle: 'Which account is which',
  pickDetail: 'Pick each of your four accounts once. Nothing is read from the bank until all four are picked. Once tracking starts, this cannot change.',
  pickOne: 'Pick one',
  pickSheet: (role: AccountId): string => `Which is your ${ROLE_NAMES[role].toLowerCase()}?`,
  notOne: 'None of the four',
  missing: 'Not all four here? Log in to the bank again (below) and add the one missing.',
  noAccounts: "The bank's accounts haven't been read yet.",
  readNow: 'Read them now',
  save: 'Save',
  saving: 'Saving…',
  keepTitle: 'Keep these four?',
  keepYes: 'Yes, keep them',
  connectedTitle: 'Bank',
  connectedOn: (date: string): string => `Connected ${date}`,
  testBank: "Plaid's test bank",
  realBank: 'Bank of America, through Plaid',
  needsLogin: 'The bank wants you to log in again. Until you do, nothing new is read.',
  history: 'Plaid is still sending the history. Setup day waits for it.',
  lookAgain: 'Look again',
  loginAgain: 'Log in to the bank again',
  loginAgainDetail: 'The same connection: it never uses another of the 10.',
  loggingIn: 'Opening the bank’s login…',
  loggedIn: 'Logged in again. The bank was read.',
  changePicks: 'Change which account is which',
  fixed: 'Tracking has started, so these cannot change.',
} as const;

// Her setup's words (her rulebook, 1.1 and 1.3, PR 6): two banks, each named
// as Plaid named it when she connected it (HB8).
export const HER_BANK_WORDS = {
  noneTitle: 'Connect a bank',
  noneReal: 'The app reads your Capital One and American Express accounts through Plaid, each bank on its own connection: first Capital One, then American Express. It never moves money.',
  noneTest: "Plaid's test bank, with made-up accounts, as two banks. Nothing here is real money.",
  otherTitle: 'Connect your other bank',
  otherDetail: 'Your other bank connects on its own: first Capital One, then American Express.',
  connect: 'Connect a bank',
  askTitle: 'Connect a bank?',
  banksTitle: 'Banks',
  missing: 'Not all four here? Connect your other bank, or log in to the bank that has the missing one again (below).',
  needsLogin: (name: string): string => `${name} wants you to log in again. Until you do, nothing new is read from it.`,
  permission: (name: string): string => `${name}'s permission runs out`,
  loginAgain: (name: string): string => `Log in to ${name} again`,
  loginAgainDetail: 'The same connection: logging in again never uses another of the 10.',
  // A bank Plaid gave no name for.
  unnamed: (bank: 1 | 2): string => `Bank ${bank}`,
} as const;

import type { AccountId, IsoDate } from '@budget-app/money';

// Rules 1.1 to 1.3 (QUESTIONS.md A46): the Bank connection screen, on the
// real server only. Connecting the bank, which account is which, and logging
// in to the bank again. Types only; the phone shares them. The bank key never
// comes here: only what the bank calls each account, and what he picked.

// What Plaid calls one of the bank's accounts, and which of his four it is.
export interface BankAccountLine {
  readonly id: string;
  readonly name: string;
  // The last digits of its number, as the bank shows them.
  readonly mask: string | null;
  // depository checking, credit credit card, and so on.
  readonly kind: string;
  readonly role: AccountId | null;
}

export type BankConnectionView =
  // 1.1: nothing connected yet. `bank` says which: Plaid's test bank, or the real one.
  // Her setup (her rulebook, 1.1): banks is there, empty: she connects two.
  | { readonly state: 'none'; readonly bank: 'test' | 'real'; readonly banks?: readonly [] }
  | {
      readonly state: 'connected';
      readonly bank: 'test' | 'real';
      readonly connectedOn: IsoDate;
      // 10.5: the bank wants him to log in again (1.3).
      readonly needsLogin: boolean;
      // 1.2: every account the bank sent, and which of his four each is.
      readonly accounts: readonly BankAccountLine[];
      // Which to pick, in order, when not his four: her three ("Off in this setup").
      readonly roles?: readonly AccountId[];
      // All four are picked: the bank is read.
      readonly rolesSet: boolean;
      // Tracking has started: they cannot change (1.2).
      readonly rolesFixed: boolean;
      // 10.13: when the bank's permission to read his accounts runs out, when it says.
      readonly permissionEnds: IsoDate | null;
      // Plaid has sent all of the history it is going to (setup day waits for it).
      readonly historyComplete: boolean;
      // Her rulebook, 1.1 (PR 6): each of her banks, bank 1 first, and
      // whether "Connect a bank" is still offered. Upstream's view has neither.
      readonly banks?: readonly BankLine[];
      readonly canConnect?: boolean;
    };

// Her rulebook, 1.1 and 1.3 (PR 6): one of her bank connections, by its
// name as Plaid gave it when she connected it (HB8).
export interface BankLine {
  readonly bank: 1 | 2;
  readonly name: string | null;
  readonly connectedOn: IsoDate;
  // 10.5: this bank wants her to log in again.
  readonly needsLogin: boolean;
  // 10.13: when this bank's permission runs out, when it says.
  readonly permissionEnds: IsoDate | null;
  readonly historyComplete: boolean;
}

// What the screen sends. Connecting asks first: `yes` is his yes to using 1
// of the 10 connections (1.1).
// Her setup: which bank to log in to again (1.3); bank 1 when left out.
export type BankLinkRequest = { readonly mode: 'connect'; readonly yes: boolean } | { readonly mode: 'login-again'; readonly bank?: 1 | 2 };
export interface BankConnectedRequest {
  readonly publicToken: string;
  // Which bank Link says she logged in to (Link's institution): her setup
  // keeps its name and never connects the same bank twice (HB8).
  readonly institution?: { readonly id: string; readonly name: string } | null;
}
// 1.2: each of his four accounts, by the bank's account id. Asks first.
export interface BankRolesRequest {
  // His four, or her three ("Off in this setup": no old card).
  readonly roles: Readonly<Partial<Record<AccountId, string>>>;
  readonly yes: boolean;
}

export type BankRefusal = {
  readonly ok: false;
  // needs-yes: it asks first; the rest are refusals, and nothing changed.
  readonly code: 'needs-yes' | 'connected-already' | 'not-connected' | 'roles-fixed' | 'not-roles' | 'bank-said-no' | 'busy' | 'same-bank';
  readonly why: string;
};

export type BankLinkAnswer = { readonly ok: true; readonly linkToken: string } | BankRefusal;
export type BankAnswer = { readonly ok: true; readonly said: string } | BankRefusal;

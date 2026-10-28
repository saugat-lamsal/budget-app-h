import type { AccountId, IsoDate, SortingRule, TextRule } from '@budget-app/money';
import type { Totals } from '../history/history.js';

// A line of the change log (13.5) that the server keeps, not the book: the
// history taking new totals (QUESTIONS.md A28), logins, new passkeys, log
// outs and the login setting, how often it syncs with the bank (Step 3), and
// notifications turned on or off on a device, or stopped by its push service
// (Phase 5). afterBookLines and afterBankLines say how many
// of the book's lines and the bank rules' lines there were when it was
// written, so all three read as one list, in the order things happened.
export type ServerLogLine =
  | {
      readonly date: IsoDate;
      readonly action: 'history-retotaled';
      // The first event whose totals changed.
      readonly from: { readonly seq: number; readonly date: IsoDate; readonly what: string };
      // Every event whose totals changed, before and after.
      readonly events: readonly { readonly seq: number; readonly date: IsoDate; readonly what: string; readonly before: Totals | null; readonly after: Totals | null }[];
      readonly afterBookLines: number;
      readonly afterBankLines: number;
    }
  | { readonly date: IsoDate; readonly action: 'logged-in' | 'logged-out' | 'passkey-added'; readonly device: string; readonly afterBookLines: number; readonly afterBankLines: number }
  | { readonly date: IsoDate; readonly action: 'stay-logged-in-changed' | 'sync-every-changed'; readonly before: number; readonly after: number; readonly afterBookLines: number; readonly afterBankLines: number }
  | { readonly date: IsoDate; readonly action: 'notifications-on' | 'notifications-off'; readonly device: string; readonly afterBookLines: number; readonly afterBankLines: number }
  // 1.1 to 1.3: the bank connected (the test bank or the real one), which
  // account is which (by name and last digits), and a new login to the bank.
  // Her setup names the real bank as Plaid named it (HB8, bank-names-log.ts),
  // worked out when Settings opens, never saved.
  | { readonly date: IsoDate; readonly action: 'bank-connected'; readonly bank: 'test' | 'real'; readonly name?: string; readonly afterBookLines: number; readonly afterBankLines: number }
  | { readonly date: IsoDate; readonly action: 'bank-accounts'; readonly accounts: Readonly<Record<AccountId, string>>; readonly afterBookLines: number; readonly afterBankLines: number }
  | { readonly date: IsoDate; readonly action: 'bank-logged-in-again'; readonly afterBookLines: number; readonly afterBankLines: number }
  // The device's push service said its subscription is gone, and it was removed.
  | { readonly date: IsoDate; readonly action: 'notifications-stopped'; readonly device: string; readonly why: string; readonly afterBookLines: number; readonly afterBankLines: number }
  // Her rulebook, 53.1 and 13.5 (HA10): setup day, with the rules she kept
  // from the rule finder. Read from setup day's own line, in her setup only
  // (setup-day-log.ts); never written as a server line.
  | { readonly date: IsoDate; readonly action: 'setup-day'; readonly rules: readonly SortingRule[]; readonly paycheckRule: TextRule | null; readonly afterBookLines: number; readonly afterBankLines: number };

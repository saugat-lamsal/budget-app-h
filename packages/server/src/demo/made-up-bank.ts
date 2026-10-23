import { assertCents, type AccountId, type BankTransaction, type Cents, type IsoDate } from '@budget-app/money';
import type { BankLine } from '../bank-rules.js';
import { checkBankRules, type BankRule } from '../bank/reading.js';
import type { StoredAccount } from '../bank/stored-account.js';
import type { PlaidAccount, PlaidTransaction } from '../plaid/types.js';
import type { BankHistory } from '../setup-history.js';
import type { StoredItem } from '../sync/plan.js';

// A made-up bank history, kept the way the bank connection keeps what Plaid
// sent (Plaid's own format: dollars, and positive is money out of the
// account), for the demo's lives that are not set up yet and for tests. No
// database and no bank: setup day reads it exactly as it reads a real one
// (setup-day.ts). Every name, number, and date given to it is made up.

export interface MadeUpItem {
  readonly id: string;
  readonly account: AccountId;
  // Plaid's sign: positive is money out of the account, negative is money in.
  readonly amount: Cents;
  readonly date: IsoDate;
  readonly description: string;
  readonly pending?: boolean;
  // Plaid's detailed label (personal_finance_category), as its test bank
  // sends it for such an item (live/labels.live.ts). None when left out.
  readonly label?: string;
}

// Plaid's primary labels, of which each detailed label is one kind.
const PRIMARY_LABELS = ['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'BANK_FEES', 'INCOME', 'FOOD_AND_DRINK', 'GENERAL_MERCHANDISE', 'TRANSPORTATION', 'RENT_AND_UTILITIES', 'ENTERTAINMENT'];

export interface MadeUpBank {
  // What each account holds, posted; for a card, what it owes. Her second
  // card is there only in a made-up bank shaped like hers.
  readonly balances: Readonly<Record<Exclude<AccountId, 'second-card'>, Cents>> & { readonly 'second-card'?: Cents };
  readonly items: readonly MadeUpItem[];
  readonly rules: readonly BankRule[];
  // False while Plaid is still sending the history.
  readonly historyComplete?: boolean;
}

const ACCOUNT_IDS: Readonly<Record<AccountId, string>> = {
  checking: 'made-up-checking',
  savings: 'made-up-savings',
  'everyday-card': 'made-up-everyday-card',
  'old-card': 'made-up-old-card',
  'second-card': 'made-up-second-card',
};
const MASKS: Readonly<Record<AccountId, string>> = { checking: '1111', savings: '2222', 'everyday-card': '3333', 'old-card': '4444', 'second-card': '5555' };
const NAMES: Readonly<Record<AccountId, string>> = { checking: 'Made Up Checking', savings: 'Made Up Savings', 'everyday-card': 'Made Up Everyday Card', 'old-card': 'Made Up Old Card', 'second-card': 'Made Up Second Card' };

// Cents as the dollars Plaid sends: 6412 is 64.12. Read back exactly by
// centsFromPlaid (bank/amounts.ts).
function dollars(cents: Cents): number {
  assertCents(cents);
  return cents / 100;
}

export function madeUpHistory(bank: MadeUpBank): BankHistory {
  const roles = (Object.keys(ACCOUNT_IDS) as AccountId[]).filter((role) => bank.balances[role] !== undefined);
  const accounts: StoredAccount[] = roles.map((role) => {
    const card = role === 'everyday-card' || role === 'old-card' || role === 'second-card';
    const raw: PlaidAccount = {
      account_id: ACCOUNT_IDS[role],
      balances: { current: dollars(bank.balances[role] ?? 0), available: null, limit: null, iso_currency_code: 'USD', unofficial_currency_code: null },
      mask: MASKS[role],
      name: NAMES[role],
      official_name: null,
      type: card ? 'credit' : 'depository',
      subtype: card ? 'credit card' : role,
    };
    return { plaidAccountId: ACCOUNT_IDS[role], role, raw, rawText: JSON.stringify(raw) };
  });
  const items = new Map<string, StoredItem>();
  for (const item of bank.items) {
    if (items.has(item.id)) throw new Error(`two made-up bank items have the id ${item.id}`);
    const raw: PlaidTransaction = {
      transaction_id: item.id,
      account_id: ACCOUNT_IDS[item.account],
      amount: dollars(item.amount),
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
      date: item.date,
      authorized_date: item.date,
      name: item.description,
      merchant_name: null,
      original_description: item.description,
      pending: item.pending ?? false,
      pending_transaction_id: null,
      ...(item.label === undefined ? {} : { personal_finance_category: { primary: PRIMARY_LABELS.find((p) => item.label?.startsWith(`${p}_`)) ?? item.label, detailed: item.label } }),
    };
    items.set(item.id, {
      transactionId: item.id,
      accountId: ACCOUNT_IDS[item.account],
      raw,
      pending: item.pending ?? false,
      amountCents: item.amount,
      removed: false,
      // Everything Plaid sends before setup day is history (B64).
      status: 'history',
      kind: null,
      bookId: null,
      replacedBy: null,
      firstSync: 1,
      lastSync: 1,
    });
  }
  return { connection: { historyComplete: bank.historyComplete ?? true }, setUp: false, accounts, items, rules: checkBankRules(bank.rules) };
}

// What a made-up life's bank sent its book, as the bank rules read bank items
// (Plaid's sign: positive is money out): for showing what a rule would match
// on Settings. A pending charge that posted, was dropped, or was changed shows
// as the bank shows it now; one taken back is gone. Made-up lives have no labels.
export function madeUpLines(feed: readonly BankTransaction[]): BankLine[] {
  const lines = new Map<string, BankLine>();
  const put = (id: string, account: AccountId, amount: Cents, date: IsoDate, description: string, pending = false): void => {
    lines.set(id, { id, account, amount, date, description, pending, label: null });
  };
  for (const txn of feed) {
    switch (txn.kind) {
      case 'purchase':
      case 'savings-withdrawal':
        if (txn.pendingId !== undefined) lines.delete(txn.pendingId);
        put(txn.id, txn.account, txn.amount, txn.date, txn.description, txn.pending);
        break;
      case 'card-charge':
      case 'payment-to-person':
        put(txn.id, txn.account, txn.amount, txn.date, txn.description);
        break;
      case 'deposit':
      case 'refund':
        put(txn.id, txn.account, -txn.amount, txn.date, txn.description);
        break;
      case 'transfer':
        put(`${txn.id}-out`, txn.from, txn.amount, txn.date, txn.description);
        put(`${txn.id}-in`, txn.to, -txn.amount, txn.date, txn.description);
        break;
      case 'transfer-sent':
        put(txn.id, txn.from, txn.amount, txn.date, txn.description);
        break;
      case 'transfer-arrived':
        put(txn.id, txn.to, -txn.amount, txn.date, txn.description);
        break;
      case 'pending-changed': {
        const was = lines.get(txn.pendingId);
        if (was !== undefined) lines.set(txn.pendingId, { ...was, amount: txn.amount });
        break;
      }
      case 'pending-dropped':
        lines.delete(txn.pendingId);
        break;
      case 'taken-back':
        lines.delete(txn.takenId);
        break;
    }
  }
  return [...lines.values()];
}

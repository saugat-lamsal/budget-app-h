import { ALL_ACCOUNTS, matchesTextRule, type AccountId, type Cents } from '@budget-app/money';

// How the bank connection tells kinds of bank activity apart before the money
// math sees them (it takes bank activity already sorted into kinds).
//
// Plaid gives each item an account and a signed amount: positive when money
// left the account, negative when money came in, on every kind of account.
// The account and the sign say most of it. Rules in settings (rule 0.2) say
// the rest: which items are halves of transfers between his own accounts,
// which are payments to people, and which are card fees or interest. A rule
// matches like the rulebook's own (B9): the description contains its text,
// ignoring case, and the first matching rule wins. Each rule is for one
// account, because the same words can mean different things on different
// accounts ("PAYMENT - THANK YOU" on a card is money arriving there).
export type BankRule =
  // Half of a transfer between two of his accounts: money leaving `account`
  // for `other`, or arriving in `account` from `other`, by the sign.
  | { readonly id: string; readonly account: AccountId; readonly contains: string; readonly means: 'transfer'; readonly other: AccountId }
  // A payment to a person out of checking or savings, such as Zelle (7.4,
  // 8.1, QUESTIONS.md A16).
  | { readonly id: string; readonly account: 'checking' | 'savings'; readonly contains: string; readonly means: 'payment-to-person' }
  // A fee or interest on a card (4.8, 5.5).
  | { readonly id: string; readonly account: 'everyday-card' | 'old-card' | 'second-card'; readonly contains: string; readonly means: 'card-fee' | 'card-interest' };

export type Reading =
  | { readonly kind: 'purchase' }
  | { readonly kind: 'deposit' }
  | { readonly kind: 'refund' }
  | { readonly kind: 'card-charge'; readonly charge: 'fee' | 'interest' }
  | { readonly kind: 'payment-to-person' }
  | { readonly kind: 'transfer-sent'; readonly to: AccountId }
  | { readonly kind: 'transfer-arrived'; readonly from: 'checking' | 'savings' }
  // Zero: no money moved.
  | { readonly kind: 'nothing' };

// Her second card (her rulebook, section 1) is a card like the others.
const isCard = (account: AccountId): account is 'everyday-card' | 'old-card' | 'second-card' => account === 'everyday-card' || account === 'old-card' || account === 'second-card';
const isBankAccount = (account: AccountId): account is 'checking' | 'savings' => account === 'checking' || account === 'savings';

// amount uses Plaid's sign: positive is money out of the account.
export function readBankItem(account: AccountId, amount: Cents, description: string, rules: readonly BankRule[]): Reading {
  return readBankItemWithRule(account, amount, description, rules).reading;
}

// The same, with the bank rule that decided it: null when none did, and the
// account and the sign said it all.
export function readBankItemWithRule(account: AccountId, amount: Cents, description: string, rules: readonly BankRule[]): { readonly reading: Reading; readonly rule: BankRule | null } {
  if (amount === 0) return { reading: { kind: 'nothing' }, rule: null };
  const out = amount > 0;
  for (const rule of rules) {
    if (rule.account !== account || !matchesTextRule(rule, description)) continue;
    const reading = readByRule(rule, out);
    if (reading !== null) return { reading, rule };
  }
  if (isCard(account)) return { reading: out ? { kind: 'purchase' } : { kind: 'refund' }, rule: null };
  // Money leaving savings that no rule names is spending too; the money math
  // sends it to review whatever it is (4.9, A16).
  return { reading: out ? { kind: 'purchase' } : { kind: 'deposit' }, rule: null };
}

// What a matching rule says, or null when it does not fit the way the money
// went, in which case the next rule is tried.
function readByRule(rule: BankRule, out: boolean): Reading | null {
  switch (rule.means) {
    case 'transfer':
      // Money leaves checking or savings; it can land anywhere else.
      if (out) return isBankAccount(rule.account) ? { kind: 'transfer-sent', to: rule.other } : null;
      return isBankAccount(rule.other) ? { kind: 'transfer-arrived', from: rule.other } : null;
    case 'payment-to-person':
      return out ? { kind: 'payment-to-person' } : null;
    case 'card-fee':
      return out ? { kind: 'card-charge', charge: 'fee' } : null;
    case 'card-interest':
      return out ? { kind: 'card-charge', charge: 'interest' } : null;
  }
}

export function checkBankRules(rules: unknown): readonly BankRule[] {
  if (!Array.isArray(rules)) throw new Error('the bank rules must be a list of bank rules');
  const ids = new Set<string>();
  return Object.freeze(
    rules.map((rule: unknown) => {
      const bad = (why: string): never => {
        throw new Error(`not a good bank rule (${why}): ${JSON.stringify(rule)}`);
      };
      if (typeof rule !== 'object' || rule === null) return bad('not a rule');
      const r = rule as Record<string, unknown>;
      if (typeof r['id'] !== 'string' || r['id'] === '') bad('it needs an id');
      if (ids.has(r['id'] as string)) bad('two bank rules have the same id');
      ids.add(r['id'] as string);
      if (typeof r['contains'] !== 'string' || r['contains'].trim() === '') bad('it needs some text to match');
      const account = r['account'];
      if (typeof account !== 'string' || !(ALL_ACCOUNTS as readonly string[]).includes(account)) bad('it must be for one of your four accounts');
      const on = account as AccountId;
      const base = { id: r['id'] as string, contains: r['contains'] as string };
      switch (r['means']) {
        case 'transfer': {
          const other = r['other'];
          if (typeof other !== 'string' || !(ALL_ACCOUNTS as readonly string[]).includes(other) || other === on) bad('a transfer is with another of your accounts');
          // Money only leaves checking or savings, so a card's half always comes from one of them.
          if (isCard(on) && !isBankAccount(other as AccountId)) bad('money reaches a card from checking or savings');
          return Object.freeze({ ...base, account: on, means: 'transfer' as const, other: other as AccountId });
        }
        case 'payment-to-person':
          if (!isBankAccount(on)) bad('payments to people come out of checking or savings');
          return Object.freeze({ ...base, account: on as 'checking' | 'savings', means: 'payment-to-person' as const });
        case 'card-fee':
        case 'card-interest':
          if (!isCard(on)) bad('fees and interest are on a card');
          return Object.freeze({ ...base, account: on as 'everyday-card' | 'old-card' | 'second-card', means: r['means'] });
        default:
          return bad('it must mean a transfer, a payment to a person, a card fee, or card interest');
      }
    }),
  );
}

import { createHash } from 'node:crypto';
import { ALL_ACCOUNTS, addDays, daysBetween, type AccountId, type Cents, type IsoDate } from '@budget-app/money';
import { labelOf, readPlaidItem, type BankLabel } from './bank/plaid-item.js';
import { readBankItemWithRule, type BankRule } from './bank/reading.js';
import { rolesOf, type StoredAccount } from './bank/stored-account.js';
import type { StoredItem } from './sync/plan.js';
import type { BankMeaning, BankRuleChange, BankRuleSpec, MatchExample, RuleMatches } from './views/bank-rules.js';

export type { BankMeaning, BankRuleChange, BankRuleSpec, MatchExample, RuleMatches } from './views/bank-rules.js';
import type { BankRuleHint } from './views/review.js';

// Bank rules (rulebook section 2, 20a, 24c): suggesting them on Setup day
// from the labels the bank sends, what a rule would match, and changing the
// list. Like setup day, the logic works on the bank items handed to it
// (BankLine): it reads nothing and saves nothing. The database part is a thin
// wrapper (bank-rules-db.ts), and the demo keeps the rules in memory.
//
// Reading a bank item with the rules is bank/reading.ts: the description
// contains the rule's text, ignoring case, on the rule's account, and the
// first rule that fits the way the money went wins (B9, QUESTIONS.md A27).

// One bank item as the bank rules read it.
export interface BankLine {
  readonly id: string;
  readonly account: AccountId;
  // Plaid's sign: positive is money out of the account.
  readonly amount: Cents;
  readonly date: IsoDate;
  readonly description: string;
  readonly pending: boolean;
  readonly label: BankLabel | null;
}


// How far back "recent" goes, when Settings shows what a rule would have matched.
export const RECENT_DAYS = 90;
// How many of the items a rule matches are shown.
export const EXAMPLES = 3;
export const MAX_RULE_TEXT = 200;

const MEANINGS: readonly BankMeaning[] = ['transfer', 'payment-to-person', 'card-fee', 'card-interest'];
const isCard = (account: AccountId): boolean => account === 'everyday-card' || account === 'old-card' || account === 'second-card';

// Every bank item kept, as the bank rules read it: not one removed, not one
// that cannot be read, on one of his four accounts, with money that moved.
export function bankLinesOf(history: { readonly accounts: readonly StoredAccount[]; readonly items: ReadonlyMap<string, StoredItem> }): BankLine[] {
  const roles = rolesOf(history.accounts);
  const lines: BankLine[] = [];
  for (const item of history.items.values()) {
    const role = roles.get(item.accountId);
    const read = readPlaidItem(item.raw);
    if (item.removed || role === undefined || !read.ok || read.item.amount === 0) continue;
    lines.push({ id: item.transactionId, account: role, amount: read.item.amount, date: read.item.date, description: read.item.description, pending: read.item.pending, label: labelOf(item.raw) });
  }
  return lines;
}

// ----- What a rule matches -----


export interface MatchOptions {
  readonly today: IsoDate;
  // Only the last RECENT_DAYS days (Settings); otherwise the whole history (Setup day).
  readonly recentOnly?: boolean;
  // The id of the rule it changes: it is tried in that rule's place. A new
  // rule is tried after every other.
  readonly replacing?: string;
}

const PROBE = '\u0000rule-being-tried';

export function matchesOf(spec: BankRuleSpec, rules: readonly BankRule[], lines: readonly BankLine[], options: MatchOptions): RuleMatches {
  const contains = spec.contains.trim().toLowerCase();
  const since = options.recentOnly === true ? addDays(options.today, -RECENT_DAYS) : null;
  const matched = lines.filter(
    (l) => (since === null || daysBetween(since, l.date) >= 0) && l.account === spec.account && contains !== '' && l.description.toLowerCase().includes(contains) && fits(spec, l.amount > 0),
  );
  // As a rule in the list, it needs an other account for a transfer. One not
  // known yet (a suggestion still to pick it) fits either way; any of his
  // other accounts it could be stands in for it.
  const probe = { ...asRule(spec, PROBE), ...(spec.means === 'transfer' && spec.other === undefined ? { other: standIn(spec.account) } : {}) } as BankRule;
  const replaced = options.replacing === undefined ? [...rules, probe] : rules.map((r) => (r.id === options.replacing ? probe : r));
  let readFirstByEarlier = 0;
  let takenFromLater = 0;
  const shown: MatchExample[] = [];
  for (const l of matched) {
    const now = readBankItemWithRule(l.account, l.amount, l.description, replaced).rule;
    const first = now !== null && now.id !== PROBE ? now.id : null;
    if (first !== null) readFirstByEarlier += 1;
    else {
      const before = readBankItemWithRule(l.account, l.amount, l.description, rules).rule;
      if (before !== null && before.id !== options.replacing) takenFromLater += 1;
    }
    shown.push({ id: l.id, date: l.date, account: l.account, description: l.description, amount: Math.abs(l.amount), direction: l.amount > 0 ? 'out' : 'in', pending: l.pending, readFirstBy: first });
  }
  shown.sort((a, b) => daysBetween(a.date, b.date) || a.id.localeCompare(b.id));
  return { count: matched.length, examples: shown.slice(0, EXAMPLES), readFirstByEarlier, takenFromLater };
}

// A27: how many of the items (recent ones only, if asked) a different rule
// would read first with the rules in the order after than in the order now.
// For a move, only items that both rules trading places fit can change.
export function itemsReadDifferently(now: readonly BankRule[], after: readonly BankRule[], lines: readonly BankLine[], options: MatchOptions): number {
  const since = options.recentOnly === true ? addDays(options.today, -RECENT_DAYS) : null;
  return lines.filter(
    (l) => (since === null || daysBetween(since, l.date) >= 0) && readBankItemWithRule(l.account, l.amount, l.description, now).rule?.id !== readBankItemWithRule(l.account, l.amount, l.description, after).rule?.id,
  ).length;
}

// Whether a rule fits money going this way (bank/reading.ts says the same
// for a whole rule). A transfer whose other account is not known yet fits
// whatever the other account turns out to be.
export function fits(spec: BankRuleSpec, out: boolean): boolean {
  switch (spec.means) {
    case 'transfer':
      if (out) return !isCard(spec.account);
      return spec.other === undefined || !isCard(spec.other);
    case 'payment-to-person':
    case 'card-fee':
    case 'card-interest':
      return out;
  }
}

function standIn(account: AccountId): AccountId {
  return account === 'checking' ? 'savings' : 'checking';
}

function asRule(spec: BankRuleSpec, id: string): BankRule {
  const base = { id, account: spec.account, contains: spec.contains.trim() };
  return (spec.means === 'transfer' ? { ...base, means: 'transfer', other: spec.other } : { ...base, means: spec.means }) as BankRule;
}

// ----- Suggested from the bank's labels (20a) -----

export interface BankRuleSuggestion {
  readonly id: string;
  // Plaid's detailed label it came from, as the bank sent it.
  readonly label: string;
  readonly account: AccountId;
  readonly contains: string;
  readonly means: BankMeaning;
  // For a transfer: the account the history shows the other side on; null
  // when it does not, for him to pick. Null for anything else.
  readonly other: AccountId | null;
  // What it matches in the whole history.
  readonly matches: RuleMatches;
  // Every item it matches is already read this way by his bank rules.
  readonly covered: boolean;
  // B226: made for a pending item the bank labels as a card payment, a
  // transfer or a payment to a person that his bank rules read as a purchase
  // now (the newest such): its text is the item's wording. Null otherwise.
  readonly pending: { readonly description: string; readonly amount: Cents; readonly date: IsoDate } | null;
}

// What a label says an item is, from the labels Plaid's test bank really
// sends (live/labels.live.ts, test/fixtures/test-bank-labels.json). A label
// the app has not seen it send for that kind of item suggests nothing.
// 'pair-card' and 'pair-bank': the other account is the one the history
// shows the other side on, a card or checking or savings.
export type LabelMeaning = { readonly means: 'transfer'; readonly other: AccountId | 'pair-card' | 'pair-bank' } | { readonly means: 'payment-to-person' | 'card-fee' | 'card-interest' };

export function meaningOfLabel(l: BankLine): LabelMeaning | null {
  const label = l.label?.detailed;
  if (label === undefined) return null;
  const out = l.amount > 0;
  if (!isCard(l.account)) {
    if (out && label === 'TRANSFER_OUT_SAVINGS') return l.account === 'checking' ? { means: 'transfer', other: 'savings' } : null;
    if (out && label === 'TRANSFER_OUT_ACCOUNT_TRANSFER') return { means: 'transfer', other: 'pair-bank' };
    if (out && label === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') return { means: 'transfer', other: 'pair-card' };
    if (out && label === 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS') return { means: 'payment-to-person' };
    if (!out && label === 'TRANSFER_IN_ACCOUNT_TRANSFER') return { means: 'transfer', other: 'pair-bank' };
    return null;
  }
  if (!out && label === 'TRANSFER_IN_OTHER_TRANSFER_IN') return { means: 'transfer', other: 'pair-bank' };
  if (out && label === 'BANK_FEES_INTEREST_CHARGE') return { means: 'card-interest' };
  if (out && (label === 'BANK_FEES_LATE_FEES' || label === 'BANK_FEES_FOREIGN_TRANSACTION_FEES' || label === 'BANK_FEES_OTHER_BANK_FEES')) return { means: 'card-fee' };
  return null;
}

// The account the other side of a transfer shows on: the same amount the
// other way, on a card or on checking or savings, the nearest day first.
// Null when the history has none.
function pairOf(l: BankLine, kind: 'pair-card' | 'pair-bank', lines: readonly BankLine[]): AccountId | null {
  const candidates = lines.filter((o) => o.account !== l.account && o.amount === -l.amount && isCard(o.account) === (kind === 'pair-card'));
  candidates.sort((a, b) => Math.abs(daysBetween(l.date, a.date)) - Math.abs(daysBetween(l.date, b.date)) || ALL_ACCOUNTS.indexOf(a.account) - ALL_ACCOUNTS.indexOf(b.account));
  return candidates[0]?.account ?? null;
}

export function suggestBankRules(lines: readonly BankLine[], rules: readonly BankRule[]): BankRuleSuggestion[] {
  const read = lines.flatMap((l) => {
    const meaning = meaningOfLabel(l);
    if (meaning === null || l.label === null) return [];
    const other = meaning.means !== 'transfer' ? null : meaning.other === 'pair-card' || meaning.other === 'pair-bank' ? pairOf(l, meaning.other, lines) : meaning.other;
    // B226: pending, and read as a purchase by his bank rules now.
    const misread = l.pending && readBankItemWithRule(l.account, l.amount, l.description, rules).reading.kind === 'purchase';
    return [{ l, label: l.label.detailed, means: meaning.means, other, misread }];
  });
  // One still on its way has no other side yet: it takes the other account
  // of one with the same label and description whose other side shows.
  const sameKind = (a: (typeof read)[number], b: (typeof read)[number]): boolean => a.label === b.label && a.l.account === b.l.account && a.means === b.means && a.l.description.toLowerCase() === b.l.description.toLowerCase();
  const withOther = read.map((r) => (r.means !== 'transfer' || r.other !== null ? r : { ...r, other: read.find((o) => o.other !== null && sameKind(o, r))?.other ?? null }));
  const groups = new Map<string, { label: string; account: AccountId; means: BankMeaning; other: AccountId | null; descriptions: string[]; misread: BankLine[] }>();
  for (const { l, label, means, other, misread } of withOther) {
    // A transfer whose other account is not known is suggested for its own
    // description only: one wider text could cover transfers with different accounts.
    // B226: a pending item read as a purchase, for its wording, pointed out.
    const unknown = means === 'transfer' && other === null;
    const key = JSON.stringify([label, l.account, means, other, misread ? `wording ${wordingOf(l.description).toLowerCase()}` : unknown ? l.description.toLowerCase() : '']);
    const group = groups.get(key) ?? { label, account: l.account, means, other, descriptions: [], misread: [] };
    group.descriptions.push(l.description);
    if (misread) group.misread.push(l);
    groups.set(key, group);
  }
  const suggestions: BankRuleSuggestion[] = [];
  for (const group of groups.values()) {
    const newest = group.misread.toSorted((a, b) => daysBetween(a.date, b.date))[0];
    const texts = newest === undefined ? sharedTexts(group.descriptions) : [wordingOf(newest.description)];
    for (const contains of texts) {
      const spec: BankRuleSpec = { account: group.account, contains, means: group.means, ...(group.other === null ? {} : { other: group.other }) };
      const matches = matchesOf(spec, rules, lines, { today: '2000-01-01' });
      suggestions.push({
        id: `s-${createHash('sha256').update(JSON.stringify([group.label, group.account, group.means, group.other, contains.toLowerCase()])).digest('hex').slice(0, 16)}`,
        label: group.label,
        account: group.account,
        contains,
        means: group.means,
        other: group.other,
        matches,
        covered: coveredBy(spec, rules, lines),
        pending: newest === undefined ? null : { description: newest.description, amount: newest.amount, date: newest.date },
      });
    }
  }
  const otherOrder = (a: AccountId | null): number => (a === null ? ALL_ACCOUNTS.length : ALL_ACCOUNTS.indexOf(a));
  return suggestions.sort(
    (a, b) =>
      ALL_ACCOUNTS.indexOf(a.account) - ALL_ACCOUNTS.indexOf(b.account) ||
      MEANINGS.indexOf(a.means) - MEANINGS.indexOf(b.means) ||
      otherOrder(a.other) - otherOrder(b.other) ||
      compareText(a.contains, b.contains),
  );
}

function compareText(a: string, b: string): number {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

// B226, in Review: each pending item the bank labels as a card payment, a
// transfer or a payment to a person that his bank rules read as a purchase
// now, by its id, with the bank rule for its wording (the other account as
// the history shows it, or null for him to pick).
export function misreadHints(lines: readonly BankLine[], rules: readonly BankRule[]): Map<string, BankRuleHint> {
  const hints = new Map<string, BankRuleHint>();
  for (const l of lines) {
    const meaning = meaningOfLabel(l);
    if (meaning === null || !l.pending || readBankItemWithRule(l.account, l.amount, l.description, rules).reading.kind !== 'purchase') continue;
    const other = meaning.means !== 'transfer' ? null : meaning.other === 'pair-card' || meaning.other === 'pair-bank' ? pairOf(l, meaning.other, lines) : meaning.other;
    hints.set(l.id, { account: l.account, contains: wordingOf(l.description), means: meaning.means, other });
  }
  return hints;
}

// B226: a description's wording: the words before the first that holds a
// digit or # (an account's digits, a date, a confirmation number), with its
// own spacing; all of it when it starts with one.
export function wordingOf(description: string): string {
  const text = description.trim();
  const changing = /(^|\s)\S*[0-9#]/.exec(text);
  const words = changing === null ? text : text.slice(0, changing.index).trim();
  return words === '' ? text : words;
}

// The text the descriptions share, from the start, ending at a whole word,
// ignoring case. When they share nothing, one text for each first word.
function sharedTexts(descriptions: readonly string[]): string[] {
  const all = sharedText(descriptions);
  if (all !== '') return [all];
  const byWord = new Map<string, string[]>();
  for (const d of descriptions) {
    const word = (d.trim().split(/\s+/)[0] ?? '').toUpperCase();
    byWord.set(word, [...(byWord.get(word) ?? []), d]);
  }
  return [...byWord.values()].map(sharedText).filter((t) => t !== '');
}

function sharedText(descriptions: readonly string[]): string {
  const [first = '', ...rest] = descriptions;
  let prefix = first;
  for (const d of rest) {
    let i = 0;
    while (i < prefix.length && i < d.length && prefix[i]?.toLowerCase() === d[i]?.toLowerCase()) i += 1;
    prefix = prefix.slice(0, i);
  }
  const word = /[A-Za-z0-9]/;
  const cutInAWord = prefix !== '' && word.test(prefix.at(-1) ?? '') && descriptions.some((d) => d.length > prefix.length && word.test(d[prefix.length] ?? ''));
  return (cutInAWord ? prefix.replace(/[A-Za-z0-9]+$/, '') : prefix).trim();
}

// Every item the rule would match is read the way it would read it, by the
// bank rules as they are.
function coveredBy(spec: BankRuleSpec, rules: readonly BankRule[], lines: readonly BankLine[]): boolean {
  const contains = spec.contains.toLowerCase();
  const matched = lines.filter((l) => l.account === spec.account && l.description.toLowerCase().includes(contains) && fits(spec, l.amount > 0));
  if (matched.length === 0 || rules.length === 0) return false;
  return matched.every((l) => {
    const now = readBankItemWithRule(l.account, l.amount, l.description, rules).reading;
    if (spec.means === 'transfer' && spec.other === undefined) return now.kind === (l.amount > 0 ? 'transfer-sent' : 'transfer-arrived');
    const would = readBankItemWithRule(l.account, l.amount, l.description, [asRule(spec, PROBE)]).reading;
    return JSON.stringify(now) === JSON.stringify(would);
  });
}

// ----- Changing the list (section 2, 13.5) -----


export type BankRuleChanged =
  | { readonly ok: true; readonly action: 'added' | 'changed' | 'removed'; readonly rules: readonly BankRule[]; readonly rule: BankRule; readonly before: BankRule | null }
  // A27: position is its place in the whole list now, from 1.
  | {
      readonly ok: true;
      readonly action: 'moved';
      readonly direction: 'up' | 'down';
      readonly rules: readonly BankRule[];
      readonly rule: BankRule;
      readonly before: null;
      readonly past: BankRule;
      readonly position: number;
    }
  | { readonly ok: false; readonly why: string };

// An account as it reads in a sentence.
const ACCOUNT_WORDS: Readonly<Record<AccountId, string>> = { checking: 'checking', savings: 'savings', 'everyday-card': 'the everyday card', 'old-card': 'the old card', 'second-card': 'the second card' };

// Why a rule cannot be, in words; null when it can.
export function bankRuleProblem(spec: BankRuleSpec): string | null {
  const contains = spec.contains.trim();
  if (contains === '') return 'Enter the text the bank’s description contains';
  if (contains.length > MAX_RULE_TEXT) return `That text is too long: ${MAX_RULE_TEXT} characters at most`;
  if (!ALL_ACCOUNTS.includes(spec.account) || !MEANINGS.includes(spec.means)) return 'That is not a bank rule';
  switch (spec.means) {
    case 'transfer':
      if (spec.other === undefined || !ALL_ACCOUNTS.includes(spec.other)) return 'Pick the other account';
      if (spec.other === spec.account) return 'A transfer is between two different accounts';
      if (isCard(spec.account) && isCard(spec.other)) return 'Money reaches a card from checking or savings';
      return null;
    case 'payment-to-person':
      return isCard(spec.account) ? 'Payments to people come out of checking or savings' : null;
    case 'card-fee':
    case 'card-interest':
      return isCard(spec.account) ? null : 'Fees and interest are on a card';
  }
}

const sameRule = (a: BankRuleSpec, b: BankRuleSpec): boolean =>
  a.account === b.account && a.contains.trim().toLowerCase() === b.contains.trim().toLowerCase() && a.means === b.means && (a.means !== 'transfer' || a.other === b.other);

// Adds a rule at the end, changes one in its place, removes one, or moves one
// a place up or down among the rules on its account (A27). Changes
// nothing it is given; says why, in words, when it cannot. A new rule gets
// newId, or else the first "bank-rule-N" not taken. An id is never used again
// for another rule (the change log and Setup day's answers name rules by it),
// so whoever keeps the rules hands out ids from a count that only goes up.
export function changeBankRules(rules: readonly BankRule[], change: BankRuleChange, newId?: string): BankRuleChanged {
  // A27: one place up or down among the rules on its account, past the next
  // one there; rules on other accounts keep their places.
  if ('move' in change) {
    const { id, direction } = change.move;
    const at = rules.findIndex((r) => r.id === id);
    const rule = rules[at];
    if (rule === undefined) return { ok: false, why: 'That rule is not there any more' };
    const onItsAccount = rules.flatMap((r, i) => (r.account === rule.account ? [i] : []));
    const other = onItsAccount[onItsAccount.indexOf(at) + (direction === 'up' ? -1 : 1)];
    const past = other === undefined ? undefined : rules[other];
    if (other === undefined || past === undefined) return { ok: false, why: `It is already the ${direction === 'up' ? 'first' : 'last'} bank rule on ${ACCOUNT_WORDS[rule.account]}` };
    const next = [...rules];
    next[at] = past;
    next[other] = rule;
    return { ok: true, action: 'moved', direction, rules: next, rule, before: null, past, position: other + 1 };
  }
  if ('remove' in change) {
    const rule = rules.find((r) => r.id === change.remove);
    if (rule === undefined) return { ok: false, why: 'That rule is not there any more' };
    return { ok: true, action: 'removed', rules: rules.filter((r) => r.id !== rule.id), rule, before: null };
  }
  const spec = 'add' in change ? change.add : change.change;
  const problem = bankRuleProblem(spec);
  if (problem !== null) return { ok: false, why: problem };
  if ('change' in change) {
    const before = rules.find((r) => r.id === change.change.id);
    if (before === undefined) return { ok: false, why: 'That rule is not there any more' };
    if (sameRule(before, spec)) return { ok: false, why: 'That is already the rule' };
    if (rules.some((r) => r.id !== before.id && sameRule(r, spec))) return { ok: false, why: 'You already have that rule' };
    const rule = asRule(spec, before.id);
    return { ok: true, action: 'changed', rules: rules.map((r) => (r.id === before.id ? rule : r)), rule, before };
  }
  if (rules.some((r) => sameRule(r, spec))) return { ok: false, why: 'You already have that rule' };
  const taken = new Set(rules.map((r) => r.id));
  let next = 1;
  while (taken.has(`bank-rule-${next}`)) next += 1;
  const id = newId ?? `bank-rule-${next}`;
  if (taken.has(id)) throw new Error(`two bank rules would have the id ${id}`);
  const rule = asRule(spec, id);
  return { ok: true, action: 'added', rules: [...rules, rule], rule, before: null };
}

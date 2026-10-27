import { createHash } from 'node:crypto';
import { ALL_ACCOUNTS, addDays, commonPlaceWords, daysBetween, matchesTextRule, placeName, type AccountId, type Cents, type IsoDate, type SortingRule, type TextRule } from '@budget-app/money';
import { fits, meaningOfLabel, wordingOf, type BankLine, type BankMeaning } from './bank-rules.js';
import { labelOf, readPlaidItem } from './bank/plaid-item.js';
import { readBankItemWithRule, type BankRule } from './bank/reading.js';
import { rolesOf, type StoredAccount } from './bank/stored-account.js';
import type { StoredItem } from './sync/plan.js';
import type { FoundItem, FoundMatches, FoundRule, FoundGroup } from './views/rule-finder.js';

export type { FoundItem, FoundMatches, FoundRule, FoundGroup } from './views/rule-finder.js';

// Her rulebook, section 53 (his OK Oct 26, 2026, 60g): the rule finder on
// setup day. It reads both banks' whole history and suggests rules: card
// payments and transfers from their two sides (53.3, 53.4), payments to
// people, fees and interest from the banks' labels (53.5), the paycheck rule
// (53.6) and places she pays often (53.7), each worded by the words that stay
// the same (53.2), with what it would have matched (53.8). It only reads: it
// works on the bank items handed to it and changes nothing. Setup day's desk
// keeps her answers (setup-desk.ts), and 53.9's overlaps are worked out there
// with the rules as they are then (overlapsOf).

// 53.3, 53.4: the arrival 0 to 5 days after the money left, the same day counting.
export const PAIR_DAYS = 5;
// 53.6: each paycheck 12 to 16 days after the one before, at least 3 in a run.
export const PAYCHECK_GAP = Object.freeze({ least: 12, most: 16 });
export const PAYCHECK_RUN = 3;
// 53.7: 3 or more purchases at a place.
export const PLACE_PURCHASES = 3;
// 13.8: a word on most of the purchases on an account in this many days before is not a name.
const NAME_DAYS = 90;
// 53.8: how many items of each list a suggestion shows (with how many in all).
export const SHOWN = 50;
// 53.9: how many of the items two rules both read are shown.
export const SHARED_SHOWN = 5;

// One bank item as the finder reads it: a bank item as the bank rules read
// it, and for a pending item the app saw that posted since, the posted one
// (53.3: Plaid's history has only posted items, so a pending wording is known
// only from what was pending between connecting and setup day).
export interface FinderLine extends BankLine {
  readonly postedAs: string | null;
}

export interface FinderSuggestion {
  // The same suggestion has the same id each time it is worked out.
  readonly id: string;
  readonly group: FoundGroup;
  readonly rule: FoundRule;
  // Worded from pending items (53.3).
  readonly pending: boolean;
  // The items it was found from, oldest first.
  readonly found: readonly string[];
  readonly matches: FoundMatches;
  // 53.6: the paychecks of the run, newest first.
  readonly run?: readonly { readonly date: IsoDate; readonly amount: Cents }[];
}

export interface FinderInput {
  readonly lines: readonly FinderLine[];
  // The rules as they are, so places are purchases as they read them (53.7).
  readonly bankRules: readonly BankRule[];
  readonly sortingRules: readonly SortingRule[];
  readonly paycheckRule: TextRule | null;
  // What each rule reads, shared with whoever works out overlaps (53.9).
  readonly readers?: Readers;
}

const isCard = (account: AccountId): boolean => account === 'everyday-card' || account === 'second-card';
const isBankAccount = (account: AccountId): boolean => account === 'checking' || account === 'savings';
const GROUPS: readonly FoundGroup[] = ['card-payments', 'transfers', 'people-fees', 'paycheck', 'places'];
const MEANINGS: readonly BankMeaning[] = ['transfer', 'payment-to-person', 'card-fee', 'card-interest'];
const oldestFirst = (a: { date: IsoDate; id: string }, b: { date: IsoDate; id: string }): number => daysBetween(b.date, a.date) || a.id.localeCompare(b.id);
const newestFirst = (a: { date: IsoDate; id: string }, b: { date: IsoDate; id: string }): number => oldestFirst(b, a);

// Every bank item kept, as the finder reads it: those the bank rules read
// (bankLinesOf), and the pending ones Plaid removed when they posted, with
// the posted one. A pending one dropped without posting (a hold that fell
// off, 4.6) is not there.
export function finderLinesOf(history: { readonly accounts: readonly StoredAccount[]; readonly items: ReadonlyMap<string, StoredItem> }): FinderLine[] {
  const roles = rolesOf(history.accounts);
  const read = [...history.items.values()].flatMap((item) => {
    const role = roles.get(item.accountId);
    const r = readPlaidItem(item.raw);
    return role === undefined || !r.ok || r.item.amount === 0 ? [] : [{ item, role, read: r.item }];
  });
  const postedFor = new Map(read.filter(({ item, read: r }) => !item.removed && !r.pending && r.pendingTransactionId !== null).map(({ read: r }) => [r.pendingTransactionId as string, r.id]));
  return read.flatMap(({ item, role, read: r }) => {
    const postedAs = item.removed && r.pending ? (postedFor.get(r.id) ?? null) : null;
    if (item.removed && postedAs === null) return [];
    return [{ id: r.id, account: role, amount: r.amount, date: r.date, description: r.description, pending: r.pending, label: labelOf(item.raw), postedAs }];
  });
}

// ----- 53.2 The words that stay the same -----

// The text for items on one account: the longest piece every description
// contains, ignoring capitals, from whole word to whole word, with a letter
// in it (the first in the newest description of two as long); with none,
// split by first word, each part worded the same way; one item alone, its
// wording as B241 reads it. Each text with the items it is from, oldest first.
export function wordsThatStay(items: readonly { readonly id: string; readonly date: IsoDate; readonly description: string }[]): { contains: string; ids: string[] }[] {
  if (items.length === 0) return [];
  const sorted = items.toSorted(newestFirst);
  const ids = items.toSorted(oldestFirst).map((i) => i.id);
  if (sorted.length === 1) return [{ contains: wordingOf(sorted[0]!.description), ids }];
  const piece = longestShared(sorted.map((i) => i.description));
  if (piece !== null) return [{ contains: piece, ids }];
  const byWord = new Map<string, (typeof items)[number][]>();
  for (const item of items) {
    const word = (item.description.trim().split(/\s+/)[0] ?? '').toUpperCase();
    byWord.set(word, [...(byWord.get(word) ?? []), item]);
  }
  // All share the first word, and it has no letter: each on its own.
  if (byWord.size === 1) return merge(items.map((i) => ({ contains: wordingOf(i.description), ids: [i.id] })), items);
  return merge([...byWord.values()].flatMap(wordsThatStay), items);
}

// Texts the same but for capitals are one, with all their items.
function merge(texts: readonly { contains: string; ids: string[] }[], items: readonly { readonly id: string; readonly date: IsoDate }[]): { contains: string; ids: string[] }[] {
  const byText = new Map<string, { contains: string; ids: string[] }>();
  for (const t of texts) {
    const key = t.contains.toLowerCase();
    const was = byText.get(key);
    byText.set(key, was === undefined ? { ...t } : { contains: was.contains, ids: [...was.ids, ...t.ids] });
  }
  const order = new Map(items.toSorted(oldestFirst).map((i, n) => [i.id, n]));
  return [...byText.values()].map((t) => ({ contains: t.contains, ids: t.ids.toSorted((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) }));
}

function longestShared(descriptions: readonly string[]): string | null {
  const newest = descriptions[0] ?? '';
  const words = [...newest.matchAll(/\S+/g)];
  let best: string | null = null;
  for (let i = 0; i < words.length; i += 1) {
    for (let j = i; j < words.length; j += 1) {
      const start = words[i]!.index;
      const last = words[j]!;
      const piece = newest.slice(start, last.index + last[0].length);
      if (!/[a-z]/i.test(piece) || (best !== null && piece.length <= best.length)) continue;
      if (descriptions.every((d) => hasWholeWords(d, piece))) best = piece;
    }
  }
  return best;
}

// The description holds the piece, ignoring capitals, from a word's start to a word's end.
function hasWholeWords(description: string, piece: string): boolean {
  const text = description.toLowerCase();
  const find = piece.toLowerCase();
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + 1)) {
    const before = at === 0 || /\s/.test(text[at - 1]!);
    const after = at + find.length === text.length || /\s/.test(text[at + find.length]!);
    if (before && after) return true;
  }
  return false;
}

// ----- What a rule reads (53.8, 53.9) -----

// A rule as 53.8 and 53.9 read it: one the finder suggests, or one of hers
// (a sorting rule for money in reads deposits).
export type ReadingRule = FoundRule | { readonly kind: 'deposit'; readonly contains: string };

// The rule reads the item: its account, its text, and the way the money went.
export function reads(rule: ReadingRule, line: BankLine): boolean {
  return matchesTextRule(rule, line.description) && readsTheWay(rule, line);
}

// Its account and the way the money went, the text aside.
function readsTheWay(rule: ReadingRule, line: BankLine): boolean {
  const out = line.amount > 0;
  switch (rule.kind) {
    case 'bank-rule':
      return line.account === rule.account && fits({ account: rule.account, contains: rule.contains, means: rule.means, ...(rule.other === null ? {} : { other: rule.other }) }, out);
    case 'paycheck':
    case 'deposit':
      return !out && isBankAccount(line.account);
    case 'place':
      // 4.9: money leaving savings always waits in review, whatever a rule says.
      return out && (line.account === 'checking' || isCard(line.account));
  }
}

function itemOf(line: BankLine): FoundItem {
  return { id: line.id, date: line.date, account: line.account, description: line.description, amount: Math.abs(line.amount), direction: line.amount > 0 ? 'out' : 'in', pending: line.pending };
}

// 53.8: what the rule would have matched in the whole history, the items it
// was found from apart from the rest.
export function matchesOf(rule: FoundRule, lines: readonly BankLine[], found: ReadonlySet<string>, readers: Readers = readersOf(lines)): FoundMatches {
  const matched = readers(rule).lines.toSorted(newestFirst);
  const fromIt = matched.filter((l) => found.has(l.id));
  const also = matched.filter((l) => !found.has(l.id));
  const accounts = ALL_ACCOUNTS.filter((a) => matched.some((l) => l.account === a));
  return {
    count: matched.length,
    accounts,
    from: matched.at(-1)?.date ?? null,
    to: matched[0]?.date ?? null,
    items: fromIt.slice(0, SHOWN).map(itemOf),
    foundCount: fromIt.length,
    also: also.slice(0, SHOWN).map(itemOf),
    alsoCount: also.length,
  };
}

// 53.9: each other rule that reads an item this one reads, with how many and the first of them.
export interface Overlap<K> {
  readonly key: K;
  readonly count: number;
  readonly items: readonly FoundItem[];
}

// readers: what each rule reads, worked out once for many overlaps (readersOf).
export function overlapsOf<K>(rule: ReadingRule, others: readonly { readonly key: K; readonly rule: ReadingRule }[], lines: readonly BankLine[], readers: Readers = readersOf(lines)): Overlap<K>[] {
  const mine = readers(rule);
  return others.flatMap(({ key, rule: other }) => {
    const theirs = readers(other);
    const [few, many] = mine.lines.length <= theirs.lines.length ? [mine, theirs] : [theirs, mine];
    const both = few.lines.filter((l) => many.ids.has(l.id)).toSorted(newestFirst);
    return both.length === 0 ? [] : [{ key, count: both.length, items: both.slice(0, SHARED_SHOWN).map(itemOf) }];
  });
}

// The items each rule reads, each rule's worked out once.
export type Readers = (rule: ReadingRule) => { readonly lines: readonly BankLine[]; readonly ids: ReadonlySet<string> };

export function readersOf(lines: readonly BankLine[]): Readers {
  const known = new Map<string, { readonly lines: readonly BankLine[]; readonly ids: ReadonlySet<string> }>();
  // Each description without capitals, once: the text matches as matchesTextRule's does.
  const lower = lines.map((l) => l.description.toLowerCase());
  return (rule) => {
    const key = JSON.stringify(rule.kind === 'place' ? { kind: rule.kind, contains: rule.contains } : rule);
    let read = known.get(key);
    if (read === undefined) {
      const text = rule.contains.trim().toLowerCase();
      const matched = lines.filter((l, i) => lower[i]!.includes(text) && readsTheWay(rule, l));
      read = { lines: matched, ids: new Set(matched.map((l) => l.id)) };
      known.set(key, read);
    }
    return read;
  };
}

// ----- Finding them -----

interface Found {
  readonly group: FoundGroup;
  readonly rule: FoundRule;
  readonly pending: boolean;
  readonly ids: readonly string[];
  readonly run?: readonly { readonly date: IsoDate; readonly amount: Cents }[];
}

export function findRules(input: FinderInput): FinderSuggestion[] {
  const lines = input.lines;
  const readers = input.readers ?? readersOf(lines);
  // Seen pending, posted since: worded with their posted item's side, never paired themselves.
  const seenPending = new Map<string, FinderLine[]>();
  for (const l of lines) if (l.postedAs !== null) seenPending.set(l.postedAs, [...(seenPending.get(l.postedAs) ?? []), l]);
  const current = lines.filter((l) => l.postedAs === null);
  const paired = new Set<string>();

  // 53.3, 53.4: the two sides of each pair, oldest leaving first, with the earliest arrival.
  const pairUp = (leaving: readonly FinderLine[], arriving: readonly FinderLine[]): [FinderLine, FinderLine][] => {
    const pairs: [FinderLine, FinderLine][] = [];
    const taken = new Set<string>();
    for (const out of leaving.toSorted(oldestFirst)) {
      const arrival = arriving
        .filter((a) => !taken.has(a.id) && a.amount === -out.amount && daysBetween(out.date, a.date) >= 0 && daysBetween(out.date, a.date) <= PAIR_DAYS)
        .toSorted(oldestFirst)[0];
      if (arrival === undefined) continue;
      taken.add(arrival.id);
      pairs.push([out, arrival]);
    }
    return pairs;
  };
  const sides = (group: FoundGroup, pairs: readonly [FinderLine, FinderLine][], from: AccountId, to: AccountId): Found[] => {
    const side = (items: readonly FinderLine[], account: AccountId, other: AccountId): Found[] => {
      const all = items.flatMap((l) => [l, ...(seenPending.get(l.id) ?? [])]);
      return [false, true].flatMap((pending) =>
        wordsThatStay(all.filter((l) => l.pending === pending)).map(({ contains, ids }) => ({ group, rule: { kind: 'bank-rule' as const, account, contains, means: 'transfer' as const, other }, pending, ids })),
      );
    };
    return [...side(pairs.map(([out]) => out), from, to), ...side(pairs.map(([, arrival]) => arrival), to, from)];
  };
  const unpaired = (l: FinderLine): boolean => !paired.has(l.id);

  const found: Found[] = [];
  // 53.3: card payments, each card from checking, then from savings.
  for (const card of ['everyday-card', 'second-card'] as const) {
    for (const from of ['checking', 'savings'] as const) {
      const pairs = pairUp(
        current.filter((l) => l.account === from && l.amount > 0 && unpaired(l)),
        current.filter((l) => l.account === card && l.amount < 0 && unpaired(l)),
      );
      for (const [out, arrival] of pairs) paired.add(out.id).add(arrival.id);
      found.push(...sides('card-payments', pairs, from, card));
    }
  }
  // 53.4: between checking and savings, both ways, from what is not paired yet.
  for (const [from, to] of [['checking', 'savings'], ['savings', 'checking']] as const) {
    const pairs = pairUp(
      current.filter((l) => l.account === from && l.amount > 0 && unpaired(l)),
      current.filter((l) => l.account === to && l.amount < 0 && unpaired(l)),
    );
    for (const [out, arrival] of pairs) paired.add(out.id).add(arrival.id);
    found.push(...sides('transfers', pairs, from, to));
  }

  // 53.5: payments to people, fees and interest, by their labels, per account and kind.
  const labeled = new Map<string, FinderLine[]>();
  for (const l of current.filter(unpaired)) {
    const meaning = meaningOfLabel(l);
    if (meaning === null || meaning.means === 'transfer') continue;
    const key = `${l.account} ${meaning.means}`;
    labeled.set(key, [...(labeled.get(key) ?? []), l, ...(seenPending.get(l.id) ?? [])]);
  }
  const labeledKeys = [...labeled.keys()].toSorted((a, b) => {
    const [aa = '', am = ''] = a.split(' ');
    const [ba = '', bm = ''] = b.split(' ');
    return ALL_ACCOUNTS.indexOf(aa as AccountId) - ALL_ACCOUNTS.indexOf(ba as AccountId) || MEANINGS.indexOf(am as BankMeaning) - MEANINGS.indexOf(bm as BankMeaning);
  });
  for (const key of labeledKeys) {
    const [account, means] = key.split(' ') as [AccountId, BankMeaning];
    const items = labeled.get(key) ?? [];
    for (const pending of [false, true]) {
      for (const { contains, ids } of wordsThatStay(items.filter((l) => l.pending === pending))) found.push({ group: 'people-fees', rule: { kind: 'bank-rule', account, contains, means, other: null }, pending, ids });
    }
  }
  const foundSoFar = new Set(found.flatMap((f) => f.ids));

  // 53.6: the paycheck rule, from deposits that repeat about every 14 days.
  const runs: Found[] = [];
  const deposits = new Map<string, FinderLine[]>();
  for (const l of current.filter((l) => isBankAccount(l.account) && l.amount < 0 && !l.pending && unpaired(l))) {
    const key = `${l.account} ${wordingOf(l.description).toLowerCase()}`;
    deposits.set(key, [...(deposits.get(key) ?? []), l]);
  }
  for (const group of deposits.values()) {
    const run = newestRun(group.toSorted(oldestFirst));
    if (run === null) continue;
    for (const { contains, ids } of wordsThatStay(run)) runs.push({ group: 'paycheck', rule: { kind: 'paycheck', contains }, pending: false, ids, run: run.toSorted(newestFirst).map((l) => ({ date: l.date, amount: -l.amount })) });
  }
  // The run that ended latest first; of two ending the same day, the longer.
  const endOf = (f: Found): IsoDate => f.run?.[0]?.date ?? '1970-01-01';
  runs.sort((a, b) => daysBetween(endOf(a), endOf(b)) || (b.run?.length ?? 0) - (a.run?.length ?? 0));
  found.push(...runs);

  // 53.7: places, from purchases nothing above was found from.
  const purchases = current.filter((l) => {
    if (l.amount <= 0 || !(l.account === 'checking' || isCard(l.account)) || foundSoFar.has(l.id) || paired.has(l.id)) return false;
    return readBankItemWithRule(l.account, l.amount, l.description, input.bankRules).reading.kind === 'purchase';
  });
  const names = placeNames(purchases);
  const places = new Map<string, FinderLine[]>();
  for (const l of purchases) {
    const name = names.get(l.id) ?? null;
    if (name === null) continue;
    const key = name.toLowerCase();
    const at = places.get(key);
    if (at === undefined) places.set(key, [l]);
    else at.push(l);
  }
  const placeFinds = [...places.values()]
    .filter((items) => items.length >= PLACE_PURCHASES)
    .map((items) => {
      const sorted = items.toSorted(newestFirst);
      return { items: sorted, name: names.get(sorted[0]!.id) ?? '', bucket: bucketOf(sorted) };
    })
    // Most purchases first; of two as many, the one bought at last first.
    .toSorted((a, b) => b.items.length - a.items.length || daysBetween(a.items[0]!.date, b.items[0]!.date) || a.name.localeCompare(b.name));
  for (const p of placeFinds) found.push({ group: 'places', rule: { kind: 'place', contains: p.name, bucket: p.bucket }, pending: false, ids: p.items.toSorted(oldestFirst).map((l) => l.id) });

  // One suggestion for each rule, with every item it was found from.
  const byRule = new Map<string, Found>();
  for (const f of found) {
    const key = ruleKey(f.rule, f.group);
    const was = byRule.get(key);
    byRule.set(key, was === undefined ? f : { ...was, ids: [...was.ids, ...f.ids] });
  }
  const order = new Map(lines.toSorted(oldestFirst).map((l, n) => [l.id, n]));
  return [...byRule.values()]
    .toSorted((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group))
    .map((f) => {
      const ids = [...new Set(f.ids)].toSorted((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      return {
        id: `f-${createHash('sha256').update(ruleKey(f.rule, f.group)).digest('hex').slice(0, 16)}`,
        group: f.group,
        rule: f.rule,
        pending: f.pending,
        found: ids,
        matches: matchesOf(f.rule, lines, new Set(ids), readers),
        ...(f.run === undefined ? {} : { run: f.run }),
      };
    });
}

// What makes two suggestions the same rule: its kind, account, text without capitals, meaning and other account.
export function ruleKey(rule: FoundRule, group: FoundGroup): string {
  switch (rule.kind) {
    case 'bank-rule':
      return JSON.stringify([group, rule.kind, rule.account, rule.contains.toLowerCase(), rule.means, rule.other]);
    case 'paycheck':
    case 'place':
      return JSON.stringify([group, rule.kind, rule.contains.toLowerCase()]);
  }
}

// 13.8: each purchase's place name, with the words on most of the purchases
// on its account on its day and in the 90 days before left out (commonPlaceWords).
// The days are walked oldest first on each account, so each day's words are
// counted once.
function placeNames(purchases: readonly FinderLine[]): Map<string, string | null> {
  const names = new Map<string, string | null>();
  for (const account of ALL_ACCOUNTS) {
    const list = purchases.filter((p) => p.account === account).toSorted(oldestFirst);
    // Each description's words as 13.8 counts them: commonPlaceWords of it alone.
    const words = list.map((p) => commonPlaceWords([p.description]));
    const count = new Map<string, number>();
    const tally = (k: number, by: 1 | -1): void => {
      for (const w of words[k]!) count.set(w, (count.get(w) ?? 0) + by);
    };
    let from = 0;
    let to = 0;
    for (let i = 0; i < list.length; ) {
      const date = list[i]!.date;
      for (; to < list.length && daysBetween(list[to]!.date, date) >= 0; to += 1) tally(to, 1);
      const since = addDays(date, -NAME_DAYS);
      for (; daysBetween(since, list[from]!.date) < 0; from += 1) tally(from, -1);
      const size = to - from;
      const common = new Set([...count].filter(([, n]) => n * 2 > size).map(([w]) => w));
      for (; i < list.length && list[i]!.date === date; i += 1) names.set(list[i]!.id, placeName(list[i]!.description, common));
    }
  }
  return names;
}

// 53.6: the run that ends latest (the longer of two ending the same day): 3 or
// more, each 12 to 16 days after the one before it in the run.
function newestRun(deposits: readonly FinderLine[]): FinderLine[] | null {
  const longest: number[] = [];
  const before: (number | null)[] = [];
  for (let k = 0; k < deposits.length; k += 1) {
    longest[k] = 1;
    before[k] = null;
    for (let p = 0; p < k; p += 1) {
      const gap = daysBetween(deposits[p]!.date, deposits[k]!.date);
      if (gap < PAYCHECK_GAP.least || gap > PAYCHECK_GAP.most) continue;
      // The longer run; of two as long, the later one before it.
      if (longest[p]! + 1 >= longest[k]!) {
        longest[k] = longest[p]! + 1;
        before[k] = p;
      }
    }
  }
  let end: number | null = null;
  for (let k = 0; k < deposits.length; k += 1) {
    if (longest[k]! < PAYCHECK_RUN) continue;
    if (end === null || daysBetween(deposits[end]!.date, deposits[k]!.date) > 0 || (deposits[end]!.date === deposits[k]!.date && longest[k]! > longest[end]!)) end = k;
  }
  if (end === null) return null;
  const run: FinderLine[] = [];
  for (let k: number | null = end; k !== null; k = before[k] ?? null) run.push(deposits[k]!);
  return run;
}

// 53.7: needs for groceries, rent and utilities, medical care, insurance,
// transport and gas, loan payments, childcare and education, and taxes and
// government fees, by Plaid's categories (her-questions.txt HB35); wants for
// anything else; nothing with no category.
const NEEDS_PRIMARY: ReadonlySet<string> = new Set(['RENT_AND_UTILITIES', 'MEDICAL', 'TRANSPORTATION', 'LOAN_PAYMENTS']);
const NEEDS_DETAILED: ReadonlySet<string> = new Set([
  'FOOD_AND_DRINK_GROCERIES',
  'GENERAL_SERVICES_INSURANCE',
  'GENERAL_SERVICES_CHILDCARE',
  'GENERAL_SERVICES_EDUCATION',
  'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT',
  'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES',
]);

function bucketOfCategory(label: NonNullable<BankLine['label']>): 'needs' | 'wants' {
  return NEEDS_PRIMARY.has(label.primary) || NEEDS_DETAILED.has(label.detailed) ? 'needs' : 'wants';
}

// The bucket for the category of most of the purchases, the newest's when two
// are as many. With no category, none.
function bucketOf(newestFirstItems: readonly FinderLine[]): 'needs' | 'wants' | null {
  const labels = newestFirstItems.flatMap((l) => (l.label === null ? [] : [l.label]));
  if (labels.length === 0) return null;
  const count = new Map<string, number>();
  for (const label of labels) count.set(label.detailed, (count.get(label.detailed) ?? 0) + 1);
  const most = Math.max(...count.values());
  return bucketOfCategory(labels.find((label) => count.get(label.detailed) === most)!);
}

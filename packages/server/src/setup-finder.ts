import { createHash } from 'node:crypto';
import type { Settings, SortingRule, TextRule } from '@budget-app/money';
import { findRules, finderLinesOf, matchesOf, overlapsOf, readersOf, type FinderLine, type FinderSuggestion, type Readers, type ReadingRule } from './rule-finder.js';
import type { BankHistory } from './setup-history.js';
import type { FoundAnswer, FoundLine, FoundOverlap, FoundPreview, FoundRule } from './views/rule-finder.js';

// Her rulebook, section 53, on setup day: her answers to the rule finder, what
// each suggestion shows (with 53.9's overlaps, against the rules as they are
// now), and the rules tracking starts with. The bank rules she keeps go to
// the bank rules at once (setup-desk.ts); the sorting rules and the paycheck
// rule wait here until tracking starts, which starts with them (planSetup).

export type { FoundAnswer } from './views/rule-finder.js';

// The sorting rules for places and the paycheck rule she kept, in the order she kept them.
export function keptRules(found: ReadonlyMap<string, FoundAnswer> | undefined): { readonly sorting: readonly SortingRule[]; readonly paycheck: TextRule | null } {
  const sorting: SortingRule[] = [];
  let paycheck: TextRule | null = null;
  for (const [id, a] of found ?? []) {
    if (a.answer === 'skipped' || a.rule === null) continue;
    if (a.rule.kind === 'place' && a.rule.bucket !== null) sorting.push({ id: a.ruleId ?? sortingRuleId(id), for: 'purchase', contains: a.rule.contains, bucket: a.rule.bucket });
    if (a.rule.kind === 'paycheck') paycheck = { contains: a.rule.contains };
  }
  return { sorting, paycheck };
}

export const sortingRuleId = (suggestion: string): string => `found-${suggestion}`;

// A rule she has: one of her bank rules, a sorting rule for purchases (hers,
// or one she kept from the finder), or the paycheck rule.
interface Had {
  readonly rule: FoundRule;
  readonly ruleId: string | null;
}

function rulesSheHas(bank: BankHistory, settings: Settings, rules: readonly SortingRule[], found: ReadonlyMap<string, FoundAnswer> | undefined): Had[] {
  const kept = keptRules(found);
  const paycheck = settings.paycheckRule ?? kept.paycheck;
  return [
    ...bank.rules.map((r) => ({ rule: { kind: 'bank-rule' as const, account: r.account, contains: r.contains, means: r.means, other: r.means === 'transfer' ? r.other : null }, ruleId: r.id })),
    ...[...rules, ...kept.sorting].flatMap((r) => (r.for === 'purchase' ? [{ rule: { kind: 'place' as const, contains: r.contains, bucket: r.bucket === 'needs' || r.bucket === 'wants' ? r.bucket : null }, ruleId: r.id }] : [])),
    ...(paycheck === null ? [] : [{ rule: { kind: 'paycheck' as const, contains: paycheck.contains }, ruleId: null }]),
  ];
}

// The same rule, whatever its capitals (a place's bucket is not part of it).
export function sameRule(a: FoundRule, b: FoundRule): boolean {
  if (a.kind !== b.kind || a.contains.trim().toLowerCase() !== b.contains.trim().toLowerCase()) return false;
  return a.kind !== 'bank-rule' || (b.kind === 'bank-rule' && a.account === b.account && a.means === b.means && a.other === b.other);
}

export interface Finder {
  readonly lines: readonly FinderLine[];
  readonly suggestions: readonly FinderSuggestion[];
  readonly shown: readonly FoundLine[];
  readonly had: readonly Had[];
  readonly readers: Readers;
}

export function finderOf(input: { readonly bank: BankHistory; readonly answers: ReadonlyMap<string, FoundAnswer> | undefined; readonly settings: Settings; readonly rules: readonly SortingRule[] }): Finder {
  const { bank, answers, settings, rules } = input;
  const lines = finderLinesOf(bank);
  const kept = keptRules(answers);
  const readers = readersOf(lines);
  const suggestions = findRules({ lines, bankRules: bank.rules, sortingRules: [...rules, ...kept.sorting], paycheckRule: settings.paycheckRule ?? kept.paycheck, readers });
  const had = rulesSheHas(bank, settings, rules, answers);
  const statusOf = (s: FinderSuggestion): FoundLine['status'] => {
    const answer = answers?.get(s.id);
    if (answer?.answer === 'skipped') return 'skipped';
    if (answer !== undefined) {
      // A bank rule she removed since is open again.
      if (s.rule.kind !== 'bank-rule' || bank.rules.some((r) => r.id === answer.ruleId)) return answer.answer;
    }
    return had.some((h) => sameRule(h.rule, s.rule)) ? 'covered' : 'open';
  };
  const statuses = new Map(suggestions.map((s) => [s.id, statusOf(s)]));
  const open = suggestions.filter((s) => statuses.get(s.id) === 'open');
  const shown = suggestions.map((s): FoundLine => {
    const status = statuses.get(s.id) ?? 'open';
    const answer = answers?.get(s.id);
    const kept = (status === 'added' || status === 'changed') && answer?.rule != null ? answer.rule : null;
    return {
      id: s.id,
      group: s.group,
      rule: kept ?? s.rule,
      pending: s.pending,
      matches: s.matches,
      run: s.run ?? null,
      status,
      ruleId: status === 'added' || status === 'changed' ? (answer?.ruleId ?? null) : null,
      overlaps: status === 'open' ? overlapsAgainst(s.rule, s.id, open, had, lines, readers) : [],
    };
  });
  return { lines, suggestions, shown, had, readers };
}

// 53.9: the open suggestions (but this one) and the rules she has that read
// some of the same items, the suggestions first.
function overlapsAgainst(rule: FoundRule, id: string, open: readonly FinderSuggestion[], had: readonly Had[], lines: readonly FinderLine[], readers: Readers): FoundOverlap[] {
  const others: { key: FoundOverlap['with']; rule: ReadingRule }[] = [
    ...open.filter((o) => o.id !== id).map((o) => ({ key: { suggestion: o.id }, rule: o.rule })),
    ...had.filter((h) => !sameRule(h.rule, rule)).map((h) => ({ key: { rule: h.rule, ruleId: h.ruleId }, rule: h.rule })),
  ];
  return overlapsOf(rule, others, lines, readers).map((o) => ({ with: o.key, count: o.count, items: o.items }));
}

// A changed suggestion before it is kept (53.8, 53.9).
export function previewOf(finder: Finder, suggestion: FinderSuggestion, rule: FoundRule): FoundPreview {
  const open = finder.suggestions.filter((s) => finder.shown.find((l) => l.id === s.id)?.status === 'open');
  const preview = { id: suggestion.id, rule, matches: matchesOf(rule, finder.lines, new Set(suggestion.found), finder.readers), overlaps: overlapsAgainst(rule, suggestion.id, open, finder.had, finder.lines, finder.readers) };
  return { ...preview, key: createHash('sha256').update(JSON.stringify(preview)).digest('hex').slice(0, 32) };
}

// The overlap with a rule she has, if any: with one, a suggestion can only be changed or skipped.
export function overlapWithRule(overlaps: readonly FoundOverlap[]): (FoundOverlap & { readonly with: { readonly rule: FoundRule } }) | null {
  return (overlaps.find((o) => 'rule' in o.with) as (FoundOverlap & { readonly with: { readonly rule: FoundRule } }) | undefined) ?? null;
}

// ----- Her answers (53.1) -----

export type FoundStep = { readonly id: string; readonly answer: 'add'; readonly bucket?: 'needs' | 'wants' } | { readonly id: string; readonly answer: 'skip' } | { readonly id: string; readonly answer: 'change'; readonly contains: string; readonly bucket?: 'needs' | 'wants' };

export type FoundDecision =
  | { readonly ok: false; readonly code: 'refused' | 'needs-confirmation'; readonly why: string; readonly foundPreview?: FoundPreview }
  | { readonly ok: true; readonly done: { readonly answer: FoundAnswer['answer']; readonly ruleId: string | null }; readonly found: ReadonlyMap<string, FoundAnswer> };

const no = (why: string): FoundDecision => ({ ok: false, code: 'refused', why });

// Keeps it as it is, keeps it with her words (asking first, with what they
// would match and overlap), or skips it. A bank rule goes to her bank rules
// at once (keepBankRule); a place and the paycheck rule wait for tracking.
export function decideFound(input: {
  readonly finder: Finder;
  readonly found: ReadonlyMap<string, FoundAnswer>;
  readonly step: FoundStep;
  readonly confirmed?: boolean;
  readonly seen?: string;
  readonly maxText: number;
  readonly keepBankRule: (rule: Extract<FoundRule, { kind: 'bank-rule' }>) => { readonly ok: true; readonly ruleId: string } | { readonly ok: false; readonly why: string };
}): FoundDecision {
  const { finder, step } = input;
  const suggestion = finder.suggestions.find((s) => s.id === step.id);
  const shown = finder.shown.find((l) => l.id === step.id);
  if (suggestion === undefined || shown === undefined) return no('That is not one the rule finder suggests');
  if (shown.status === 'covered') return no('You have that rule already');
  if (shown.status === 'added' || shown.status === 'changed') return no(step.answer === 'skip' ? 'It is kept already' : 'That is already your answer');
  const record = (answer: FoundAnswer): FoundDecision => {
    const found = new Map(input.found);
    found.set(step.id, answer);
    return { ok: true, done: { answer: answer.answer, ruleId: answer.ruleId }, found };
  };
  if (step.answer === 'skip') return shown.status === 'skipped' ? no('That is already your answer') : record({ answer: 'skipped', ruleId: null, rule: null });

  let rule: FoundRule = suggestion.rule;
  if (step.answer === 'change') {
    const contains = step.contains.trim();
    if (contains === '') return no('Enter the words the bank’s description contains');
    if (contains.length > input.maxText) return no(`Those words are too long: ${input.maxText} characters at most`);
    rule = { ...rule, contains };
  }
  if (rule.kind === 'place') {
    const bucket = step.bucket ?? rule.bucket;
    if (bucket === null) return no('Pick needs or wants first');
    rule = { ...rule, bucket };
  }
  if (finder.had.some((h) => sameRule(h.rule, rule))) return no('You have that rule already');
  if (rule.kind === 'paycheck') {
    const paycheck = finder.had.find((h) => h.rule.kind === 'paycheck');
    if (paycheck !== undefined) return no(`There is one paycheck rule, and it is "${paycheck.rule.contains}" already`);
  }
  // 53.9: never with a rule she has that reads some of the same items.
  const overlaps = step.answer === 'change' ? previewOf(finder, suggestion, rule).overlaps : shown.overlaps;
  const clash = overlapWithRule(overlaps);
  if (clash !== null) return no(`It reads ${clash.count === 1 ? 'an item' : `${clash.count} items`} your rule “${clash.with.rule.contains}” reads too. Change its words or skip it`);
  if (step.answer === 'change') {
    const preview = previewOf(finder, suggestion, rule);
    if (input.confirmed !== true || input.seen !== preview.key) {
      const changedSince = input.confirmed === true && input.seen !== undefined;
      return { ok: false, code: 'needs-confirmation', why: changedSince ? 'What it would match has changed since you looked. Check it again' : 'Check what it would match before you keep it', foundPreview: preview };
    }
  }
  const answer = step.answer === 'change' ? 'changed' : 'added';
  if (rule.kind === 'bank-rule') {
    const kept = input.keepBankRule(rule);
    return kept.ok ? record({ answer, ruleId: kept.ruleId, rule }) : no(kept.why);
  }
  return record({ answer, ruleId: rule.kind === 'place' ? sortingRuleId(step.id) : null, rule });
}

// Skips every suggestion of a group still waiting for an answer.
export function skipGroup(finder: Finder, found: ReadonlyMap<string, FoundAnswer>, group: FoundLine['group']): FoundDecision {
  const open = finder.shown.filter((l) => l.group === group && l.status === 'open');
  if (open.length === 0) return no('Nothing in that group waits for an answer');
  const next = new Map(found);
  for (const l of open) next.set(l.id, { answer: 'skipped', ruleId: null, rule: null });
  return { ok: true, done: { answer: 'skipped', ruleId: null }, found: next };
}

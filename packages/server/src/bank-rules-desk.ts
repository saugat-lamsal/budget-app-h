import { createHash } from 'node:crypto';
import type { IsoDate } from '@budget-app/money';
import { RECENT_DAYS, changeBankRules, itemsReadDifferently, matchesOf, type BankLine, type BankRuleChange, type BankRuleSpec } from './bank-rules.js';
import type { BankRule } from './bank/reading.js';
import { canonical, refuse } from './choices.js';
import type { BankRuleDone, BankRuleLogLine, BankRulePreview, BankRuleRequest, BankRuleResponse } from './views/bank-rules.js';

// How changes to the bank rules reach them (rulebook section 2, 24c), on
// Setup day and on Settings. The same promises as the choice desk:
// - Each change carries a decision number made once on the phone; a repeat
//   of it gets the first answer back and changes nothing.
// - A refused change changes nothing and says why, in words.
// - Every change asks first, with what the rule would have matched lately,
//   so a rule that is too wide shows before it is saved. His yes names the
//   preview he saw; if that is not what it would do any more, it asks again.
// - Every change is in the change log (13.5), with the date.
// A changed rule reads what the bank sends from then on; what was already
// read stays as it was (24c). Before tracking starts, Setup day reads the
// whole history again with the rules as they are now.
//
// The rules, the log, and the decision numbers are kept here, in memory (the
// demo and the tests); the real server keeps them in its database (Phase 6;
// bank-rules-db.ts is the thin wrapper for the rules and the log).

export interface BankRulesDeskInput {
  readonly rules: readonly BankRule[];
  // The change log so far, for a desk made again from what was kept (the
  // real server); none for a new one. Its rules count for the ids handed out.
  readonly log?: readonly BankRuleLogLine[];
  // The bank items kept, to show what a rule would match.
  readonly lines: () => readonly BankLine[];
  readonly today: () => IsoDate;
  // How many lines the book's change log has now; 0 before setup day.
  readonly bookLines: () => number;
  // "Off in this setup": no bank rule can be about the old card. Upstream's when not given.
  readonly oldCardOff?: () => boolean;
  // Upstream's setup has no second card (her rulebook, section 1): no rule is about it.
  readonly secondCardOff?: () => boolean;
}

export class BankRulesDesk {
  readonly #input: BankRulesDeskInput;
  #rules: readonly BankRule[];
  readonly #log: BankRuleLogLine[];
  // Ids handed out so far: never one twice, not even one only in the log.
  #issued: number;
  readonly #done = new Map<string, { readonly fingerprint: string; readonly done: BankRuleDone }>();

  constructor(input: BankRulesDeskInput) {
    this.#input = input;
    this.#rules = input.rules;
    this.#log = [...(input.log ?? [])];
    const ever = [...input.rules, ...this.#log.map((l) => l.rule)];
    this.#issued = Math.max(0, ...ever.map((r) => Number(/^bank-rule-(\d+)$/.exec(r.id)?.[1] ?? 0)));
  }

  rules(): readonly BankRule[] {
    return this.#rules;
  }

  log(): readonly BankRuleLogLine[] {
    return this.#log;
  }

  lines(): readonly BankLine[] {
    return this.#input.lines();
  }

  // What a change would do, or why it cannot be.
  preview(change: BankRuleChange): BankRulePreview | { readonly why: string } {
    const off = this.#offWhy(change);
    if (off !== null) return { why: off };
    const tried = changeBankRules(this.#rules, change, this.#nextId());
    if (!tried.ok) return { why: tried.why };
    const shown: BankRuleSpec = tried.rule;
    const options = { today: this.#input.today(), recentOnly: true };
    // A removal shows what the rule matched while it was there; a move, what
    // it would match in its new place, and what changes hands (A27).
    const matches =
      'remove' in change
        ? matchesOf(shown, this.#rules.filter((r) => r.id !== tried.rule.id), this.lines(), options)
        : 'move' in change
          ? matchesOf(shown, tried.rules, this.lines(), { ...options, replacing: tried.rule.id })
          : matchesOf(shown, this.#rules, this.lines(), 'change' in change ? { ...options, replacing: change.change.id } : options);
    const preview: Omit<BankRulePreview, 'key'> = {
      action: 'add' in change ? 'add' : 'change' in change ? 'change' : 'remove' in change ? 'remove' : 'move',
      rule: specOf(tried.rule),
      before: tried.before,
      ...(tried.action === 'moved' ? { move: { direction: tried.direction, past: tried.past, switching: itemsReadDifferently(this.#rules, tried.rules, this.lines(), options) } } : {}),
      matches,
      recentDays: RECENT_DAYS,
    };
    return { ...preview, key: createHash('sha256').update(canonical(preview)).digest('hex').slice(0, 32) };
  }

  decide(request: BankRuleRequest): BankRuleResponse {
    const fingerprint = canonical(request);
    const earlier = this.#done.get(request.id);
    if (earlier !== undefined) {
      if (earlier.fingerprint === fingerprint) return { ok: true, replayed: true, done: earlier.done };
      return refuse('id-reused', 'That decision number was already used for a different change.');
    }
    const preview = this.preview(request.bankRule);
    if ('why' in preview) return refuse('refused', preview.why);
    if (request.confirmed !== true || request.seen !== preview.key) {
      const changedSince = request.confirmed === true && request.seen !== undefined;
      return { ...refuse('needs-confirmation', changedSince ? 'What it would match has changed since you looked. Check it again' : askingWhy(request.bankRule)), preview };
    }
    const done = this.apply(request.bankRule);
    if (!done.ok) return refuse('refused', done.why);
    this.#done.set(request.id, { fingerprint, done: done.done });
    return { ok: true, replayed: false, done: done.done };
  }

  // Makes a change, without asking: for a suggestion he takes as it is, on
  // Setup day (its matches were on the card). Logged like any change.
  apply(change: BankRuleChange): { readonly ok: true; readonly done: BankRuleDone } | { readonly ok: false; readonly why: string } {
    const off = this.#offWhy(change);
    if (off !== null) return { ok: false, why: off };
    const tried = changeBankRules(this.#rules, change, this.#nextId());
    if (!tried.ok) return tried;
    if (tried.action === 'added') this.#issued += 1;
    this.#rules = tried.rules;
    const date = this.#input.today();
    const afterBookLines = this.#input.bookLines();
    if (tried.action === 'moved') {
      const action = tried.direction === 'up' ? 'moved-up' : 'moved-down';
      this.#log.push(Object.freeze({ date, action, rule: tried.rule, before: null, past: tried.past, position: tried.position, afterBookLines }));
      return { ok: true, done: { action, rule: tried.rule } };
    }
    this.#log.push(Object.freeze({ date, action: tried.action, rule: tried.rule, before: tried.before, afterBookLines }));
    return { ok: true, done: { action: tried.action, rule: tried.rule } };
  }

  #offWhy(change: BankRuleChange): string | null {
    const rule = 'add' in change ? change.add : 'change' in change ? change.change : null;
    if (rule === null) return null;
    const about = (card: 'old-card' | 'second-card'): boolean => rule.account === card || (rule.means === 'transfer' && rule.other === card);
    if (this.#input.secondCardOff?.() === true && about('second-card')) return 'This setup has no second card.';
    if (this.#input.oldCardOff?.() !== true) return null;
    return about('old-card') ? 'This setup has no old card.' : null;
  }

  #nextId(): string {
    return `bank-rule-${this.#issued + 1}`;
  }
}

function specOf(rule: BankRule): BankRuleSpec {
  return rule.means === 'transfer' ? { account: rule.account, contains: rule.contains, means: rule.means, other: rule.other } : { account: rule.account, contains: rule.contains, means: rule.means };
}

function askingWhy(change: BankRuleChange): string {
  if ('move' in change) return 'Moving a bank rule changes which rule reads what the bank sends from now on. It needs your OK first';
  if ('remove' in change) return 'Removing a bank rule changes how the app reads what the bank sends from now on. It needs your OK first';
  return 'Check what it would have matched lately before you save it. It reads what the bank sends from now on';
}


import { createHash } from 'node:crypto';
import {
  MoneyError,
  addCents,
  checkAssignment,
  inTransitEffect,
  nextPayday,
  startingDebt,
  startingMoney,
  withPendingCharges,
  type AccountId,
  type Cents,
  type IsoDate,
  type SelfCheck,
  type Settings,
  type SortingRule,
  type StartingPots,
} from '@budget-app/money';
import { bankLinesOf, suggestBankRules } from './bank-rules.js';
import { finderOf, keptRules, type FoundAnswer } from './setup-finder.js';
import { bankRuleOf, halvesInTransitIn, notReadyWhy, planSetup, setupPreviewOf, type BankHistory } from './setup-history.js';
import type { SuggestionLine } from './views/bank-rules.js';
import type { AccountLine, HalfLine, SetupMissing, SetupReadyView, SetupView } from './views/setup.js';

// What the Setup day screens show (rulebook section 14), worked out from the
// bank history and his answers so far (views/setup.ts has what is sent).

// His answers so far.
export interface SetupAnswers {
  // 20a: his answer to each suggested bank rule, by its id, and the rule it added.
  readonly suggestions: ReadonlyMap<string, { readonly answer: 'added' | 'changed' | 'skipped'; readonly ruleId: string | null }>;
  // A25: how many days back it asks; null until he changes it.
  readonly halvesWithinDays: number | null;
  readonly onItsWay: ReadonlyMap<string, boolean>;
  readonly lastPaycheckDate: IsoDate | null;
  readonly assignment: StartingPots;
  // Her rulebook, 53.1: her answer to each rule finder suggestion, by its id
  // (setup-finder.ts). None in upstream's setup, or saved before it existed.
  readonly found?: ReadonlyMap<string, FoundAnswer>;
}

export const NO_ANSWERS: SetupAnswers = {
  suggestions: new Map(),
  halvesWithinDays: null,
  onItsWay: new Map(),
  lastPaycheckDate: null,
  assignment: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 },
};

export interface SetupViewInput {
  readonly today: IsoDate;
  readonly madeUpData: boolean;
  // Null when there is no bank history at all.
  readonly bank: BankHistory | null;
  readonly answers: SetupAnswers;
  // What tracking starts with.
  readonly settings: Settings;
  readonly rules: readonly SortingRule[];
  // How many days back setup day asks about halves on their way, to start
  // with (A25: a setting, section 2; his answer replaces it).
  readonly halvesWithinDays: number;
  // Her rulebook, section 53: the rule finder, in place of 20a's suggestions.
  readonly ruleFinder?: boolean;
}

// What tracking starts with: the settings and sorting rules, with the
// sorting rules and the paycheck rule she kept from the rule finder (53.1).
export function startingRules(input: { readonly settings: Settings; readonly rules: readonly SortingRule[]; readonly answers: SetupAnswers }): { readonly settings: Settings; readonly rules: readonly SortingRule[] } {
  const kept = keptRules(input.answers.found);
  if (kept.sorting.length === 0 && kept.paycheck === null) return { settings: input.settings, rules: input.rules };
  return { settings: { ...input.settings, paycheckRule: input.settings.paycheckRule ?? kept.paycheck }, rules: [...input.rules, ...kept.sorting] };
}

// Section 2, A25: setup day looks back this many days, until he changes it.
export const SETUP_LOOK_BACK_DAYS = 10;

export function setupView(input: SetupViewInput): SetupView {
  const { bank, madeUpData, today, answers, settings } = input;
  if (bank !== null && bank.setUp) return { state: 'tracking', madeUpData };
  const why = bank === null ? 'there is no bank connection yet' : notReadyWhy(bank);
  if (bank === null || why !== null) return { state: 'not-set-up', madeUpData, ready: false, why: why ?? 'there is no bank connection yet' };

  const base = setupPreviewOf(bank, []);
  const charges = base.pendingCharges;
  const pendingOn = (account: AccountId): Cents => addCents(...charges.filter((c) => c.account === account).map((c) => c.amount));
  const withPending = withPendingCharges(base.posted, charges);
  const line = (posted: Cents, account: AccountId, counted: Cents): AccountLine => ({ posted, pending: pendingOn(account), withPending: counted });

  // 20a: the suggestions, with his answers. One whose rule he has removed
  // since is open again.
  // Her rulebook, section 53: the rule finder takes their place.
  const finder = input.ruleFinder === true ? finderOf({ bank, answers: answers.found, settings, rules: input.rules }) : null;
  const suggestions: SuggestionLine[] = (finder !== null ? [] : suggestBankRules(bankLinesOf(bank), bank.rules)).map((s) => {
    const answer = answers.suggestions.get(s.id);
    const added = answer !== undefined && answer.answer !== 'skipped' && bank.rules.some((r) => r.id === answer.ruleId);
    const status = answer?.answer === 'skipped' ? 'skipped' : added ? answer.answer : s.covered ? 'covered' : 'open';
    return { id: s.id, label: s.label, account: s.account, contains: s.contains, means: s.means, other: s.other, matches: s.matches, status, ruleId: added ? answer.ruleId : null, pending: s.pending };
  });
  const unansweredSuggestions = suggestions.filter((s) => s.status === 'open').length;

  const within = answers.halvesWithinDays ?? input.halvesWithinDays;
  const halves: HalfLine[] = halvesInTransitIn(bank, today, within).map((half) => ({
    id: half.id,
    kind: half.kind === 'transfer-sent' ? 'left' : 'arrived',
    from: half.from,
    to: half.to,
    date: half.date,
    description: half.description,
    amount: half.amount,
    effect: inTransitEffect(half),
    rule: bankRuleOf(bank, half.id),
    onItsWay: answers.onItsWay.get(half.id) ?? null,
  }));
  const onItsWay = halves.filter((h) => h.onItsWay === true);
  const money = setupPreviewOf(
    bank,
    onItsWay.map((h) => h.id),
  ).startingMoney;
  const { assigned, leftToAssign } = checkAssignment(money, answers.assignment);
  const lastPaycheck = answers.lastPaycheckDate === null ? null : { date: answers.lastPaycheckDate, ...nextPayday(answers.lastPaycheckDate, settings, today) };

  const missing: SetupMissing[] = [];
  if (unansweredSuggestions > 0) missing.push('suggestions');
  if (halves.some((h) => h.onItsWay === null)) missing.push('halves');
  if (lastPaycheck === null) missing.push('last-paycheck');
  if (leftToAssign !== 0) missing.push('assignment');

  let selfCheck: SelfCheck | null = null;
  if (missing.length === 0 && answers.lastPaycheckDate !== null) {
    try {
      const plan = planSetup(bank, {
        today,
        assignment: answers.assignment,
        lastPaycheckDate: answers.lastPaycheckDate,
        ...startingRules({ settings, rules: input.rules, answers }),
        inTransit: onItsWay.map((h) => h.id),
      });
      if (plan.ok) selfCheck = plan.book.selfCheck(plan.bank);
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
    }
  }

  const view: Omit<SetupReadyView, 'key'> = {
    state: 'not-set-up',
    madeUpData,
    ready: true,
    today,
    checking: line(base.posted.checking, 'checking', withPending.checking),
    savings: line(base.posted.savings, 'savings', withPending.savings),
    everydayCard: line(base.posted.everydayCard, 'everyday-card', withPending.everydayCard),
    // Her second card (her rulebook, 14.2: both cards' balances come off).
    ...(base.posted.secondCard === undefined ? {} : { secondCard: line(base.posted.secondCard, 'second-card', withPending.secondCard ?? 0) }),
    pendingCharges: charges.map((c) => ({ id: c.id, account: c.account, date: c.date, description: c.description, amount: c.amount })),
    oldCard: { posted: base.oldCardBalance, pending: pendingOn('old-card'), debt: startingDebt(base.oldCardBalance, charges) },
    bankSide: startingMoney(base.posted, charges),
    suggestions,
    unansweredSuggestions,
    ...(finder === null ? {} : { found: finder.shown }),
    halves,
    halvesWithinDays: within,
    unanswered: halves.filter((h) => h.onItsWay === null).length,
    inTransit: addCents(...onItsWay.map((h) => h.effect)),
    startingMoney: money,
    lastPaycheck,
    paySchedule: settings.paySchedule,
    payScheduleDays: settings.payScheduleDays,
    assignment: answers.assignment,
    assigned,
    leftToAssign,
    missing,
    selfCheck,
    bankRules: bank.rules,
  };
  return { ...view, key: keyOf(view) };
}

function keyOf(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 32);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

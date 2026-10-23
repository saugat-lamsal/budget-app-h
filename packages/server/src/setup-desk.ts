import {
  MoneyError,
  addCents,
  assertIsoDate,
  checkAssignment,
  daysBetween,
  formatDollars,
  type BankBalances,
  type Book,
  type Cents,
  type IsoDate,
  type SetupInput,
  type Settings,
  type SortingRule,
  type StartingPots,
} from '@budget-app/money';
import { BankRulesDesk } from './bank-rules-desk.js';
import { bankLinesOf, type BankRuleSpec } from './bank-rules.js';
import { canonical, refuse } from './choices.js';
import { planSetup, type BankHistory } from './setup-history.js';
import type { StoredItem } from './sync/plan.js';
import type { BankRuleRequest, BankRuleResponse, SuggestionLine } from './views/bank-rules.js';
import type { SetupDone, SetupRequest, SetupResponse } from './views/choice.js';
import { NO_ANSWERS, setupView, type SetupAnswers } from './setup-view.js';
import type { SetupReadyView, SetupView } from './views/setup.js';

// How taps on the Setup day screens reach the books (rulebook section 14).
// The same promises as the choice desk (choices.ts):
// - Each answer carries a decision number made once on the phone; a repeat
//   of it gets the first answer back and changes nothing.
// - A refused answer changes nothing and says why, in words.
// - Starting to track is final, so it asks first: it is not done without his
//   yes, and the yes must name the last look he saw (its key).
// His answers are kept here until tracking starts. Setup day happens once:
// after that every new answer is refused.
//
// The bank rules (section 2, 20a, 24c) are kept by a bank rules desk: the
// one given, or one of its own made from the bank history's rules. Before
// tracking starts, every step reads the whole history again with the rules
// as they are now; a change drops his answers about transfers it no longer
// asks about. After it starts, the rules can still change (Settings), and
// read what the bank sends from then on.

export interface SetupDeskInput {
  // The bank history; null when the bank is not connected.
  readonly bank: BankHistory | null;
  readonly today: () => IsoDate;
  // What tracking starts with.
  readonly settings: Settings;
  readonly rules?: readonly SortingRule[];
  // How many days back setup day asks about halves on their way (QUESTIONS.md A25).
  readonly halvesWithinDays: number;
  readonly madeUpData: boolean;
  // Who keeps the bank rules; without it, the desk keeps its own.
  readonly bankRules?: BankRulesDesk;
  // His answers so far, for a desk made again from what was kept (the real
  // server); none for a new one.
  readonly answers?: SetupAnswers;
}

export interface Started {
  readonly book: Book;
  // The bank side the book was checked against (12.1), pending charges included.
  readonly bank: BankBalances;
  // What the book was started with, the bank items as setting up left them,
  // and the starting money, for whoever keeps the book's history.
  readonly input: SetupInput;
  readonly items: readonly StoredItem[];
  readonly startingMoney: Cents;
}

export class SetupDesk {
  readonly #input: SetupDeskInput;
  #answers: SetupAnswers;
  #started: Started | null = null;
  // What each decision number did, for the repeats, while it runs. The real
  // server keeps them with the book's history too (history/keeper.ts).
  readonly #done = new Map<string, { readonly fingerprint: string; readonly done: SetupDone }>();

  readonly #bankRules: BankRulesDesk;

  constructor(input: SetupDeskInput) {
    this.#input = input;
    this.#answers = input.answers ?? NO_ANSWERS;
    const bank = input.bank;
    this.#bankRules =
      input.bankRules ??
      new BankRulesDesk({ rules: bank?.rules ?? [], lines: () => (bank === null ? [] : bankLinesOf(bank)), today: input.today, bookLines: () => this.#started?.book.changeLog().length ?? 0 });
  }

  bankRules(): BankRulesDesk {
    return this.#bankRules;
  }

  // The bank history, read with the bank rules as they are now.
  #bank(): BankHistory | null {
    const bank = this.#input.bank;
    return bank === null ? null : { ...bank, rules: this.#bankRules.rules() };
  }

  // A change to the bank rules (section 2, 24c), on Setup day or after it.
  bankRule(request: BankRuleRequest): BankRuleResponse {
    const answer = this.#bankRules.decide(request);
    if (answer.ok && !answer.replayed) this.#dropAnswersNotAsked();
    return answer;
  }

  // His answers about transfers it no longer asks about are dropped: they are history now (A25, 24c).
  #dropAnswersNotAsked(): void {
    const view = this.view();
    if (view.state !== 'not-set-up' || !view.ready) return;
    const asked = new Set(view.halves.map((h) => h.id));
    this.#answers = { ...this.#answers, onItsWay: new Map([...this.#answers.onItsWay].filter(([half]) => asked.has(half))) };
  }

  // What the Setup day screens show now.
  view(): SetupView {
    const bank = this.#bank();
    return setupView({
      today: this.#input.today(),
      madeUpData: this.#input.madeUpData,
      bank: bank === null ? null : { ...bank, setUp: bank.setUp || this.#started !== null },
      answers: this.#answers,
      settings: this.#input.settings,
      rules: this.#input.rules ?? [],
      halvesWithinDays: this.#input.halvesWithinDays,
    });
  }

  // The book, once tracking has started.
  // His answers so far, for whoever keeps them.
  answers(): SetupAnswers {
    return this.#answers;
  }

  started(): Started | null {
    return this.#started;
  }

  decide(request: SetupRequest): SetupResponse {
    const fingerprint = canonical(request);
    const earlier = this.#done.get(request.id);
    if (earlier !== undefined) {
      if (earlier.fingerprint === fingerprint) return { ok: true, replayed: true, done: earlier.done };
      return refuse('id-reused', 'That decision number was already used for a different answer.');
    }
    const view = this.view();
    if (view.state === 'tracking') return refuse('refused', 'Setup day is done already');
    if (!view.ready) return refuse('refused', capitalize(view.why));

    const answered = this.#answer(request, view);
    if ('why' in answered) return answered;
    this.#done.set(request.id, { fingerprint, done: answered });
    return { ok: true, replayed: false, done: answered };
  }

  #answer(request: SetupRequest, view: SetupReadyView): SetupDone | Extract<SetupResponse, { ok: false }> {
    const step = request.setup;
    const today = this.#input.today();

    // B48: on its way, or not.
    if ('onItsWay' in step) {
      const { half, answer } = step.onItsWay;
      const shown = view.halves.find((h) => h.id === half);
      if (shown === undefined) return refuse('refused', 'That is not one setup day asks about');
      if (shown.onItsWay === answer) return refuse('refused', 'That is already your answer');
      const onItsWay = new Map(this.#answers.onItsWay);
      onItsWay.set(half, answer);
      this.#answers = { ...this.#answers, onItsWay };
      return { step: 'on-its-way', half, answer, startingMoney: this.#ready().startingMoney };
    }

    // A25: how far back it asks. An answer about a transfer it no longer
    // asks about is dropped: that transfer is history now.
    if ('lookBack' in step) {
      const days = step.lookBack;
      if (days === view.halvesWithinDays) return refuse('refused', 'That is already the setting');
      this.#answers = { ...this.#answers, halvesWithinDays: days };
      this.#dropAnswersNotAsked();
      return { step: 'look-back', days, asked: this.#ready().halves.length };
    }

    // 20a: a suggested bank rule, added as it is, skipped, or added as he
    // changed it (which asks first, with what it would match).
    if ('suggestion' in step) {
      const shown = view.suggestions.find((s) => s.id === step.suggestion.id);
      if (shown === undefined) return refuse('refused', 'That is not one setup day suggests');
      return this.#suggestion(shown, step.suggestion, request);
    }

    // B42: the day of his last paycheck, on or before today.
    if ('lastPaycheck' in step) {
      const date = step.lastPaycheck;
      try {
        assertIsoDate(date, 'last paycheck');
      } catch (error) {
        if (error instanceof MoneyError) return refuse('refused', 'Pick a real date');
        throw error;
      }
      if (daysBetween(date, today) < 0) return refuse('refused', "Your last paycheck can't be after today: that paycheck has not come yet");
      if (this.#answers.lastPaycheckDate === date) return refuse('refused', 'That is already the date');
      this.#answers = { ...this.#answers, lastPaycheckDate: date };
      const shown = this.#ready().lastPaycheck;
      if (shown === null) throw new Error('the last paycheck went missing');
      return { step: 'last-paycheck', date, nextPayday: shown.nextPayday };
    }

    // 14.2: an amount in one bucket, or the rest of the starting money.
    if ('assign' in step) {
      const { pot } = step.assign;
      // "Off in this setup": nothing can be given to the mom reserve, not even a cent.
      if (pot === 'momReserve' && this.#input.bank?.switches?.momReserve === 'off') return refuse('refused', 'This setup has no mom reserve.');
      let amount: number;
      try {
        if ('rest' in step.assign) {
          if (view.leftToAssign === 0) return refuse('refused', 'Nothing is left to assign');
          amount = addCents(this.#answers.assignment[pot], view.leftToAssign);
        } else amount = step.assign.amount;
        if (amount === this.#answers.assignment[pot]) return refuse('refused', 'That is already the amount');
        const assignment: StartingPots = { ...this.#answers.assignment, [pot]: amount };
        checkAssignment(view.startingMoney, assignment);
        this.#answers = { ...this.#answers, assignment };
      } catch (error) {
        if (error instanceof MoneyError) return refuse('refused', 'That would make a total too large to keep exact');
        throw error;
      }
      return { step: 'assign', pot, amount, leftToAssign: this.#ready().leftToAssign };
    }

    // 14.3: start tracking, only when it adds up to the cent and the
    // self-check passes, and only with his yes to what he saw.
    if (view.missing.includes('suggestions')) return refuse('refused', 'Answer each suggested bank rule first');
    if (view.missing.includes('halves')) return refuse('refused', 'Say whether each transfer is still on its way first');
    const date = this.#answers.lastPaycheckDate;
    if (date === null) return refuse('refused', 'Enter the date of your last paycheck first');
    if (view.leftToAssign > 0) return refuse('refused', `${formatDollars(view.leftToAssign)} is still to assign`);
    if (view.leftToAssign < 0) return refuse('refused', `${formatDollars(-view.leftToAssign)} more is assigned than there is`);
    if (view.selfCheck === null || !view.selfCheck.ok) return refuse('refused', 'The self-check does not pass, so tracking cannot start');
    if (request.confirmed !== true || request.seen !== view.key) {
      return refuse(
        'needs-confirmation',
        request.confirmed === true && request.seen !== undefined
          ? 'What tracking would start with has changed since you looked. Check it again'
          : 'Starting to track is final: setup day is done once. It needs your OK first',
      );
    }
    const bank = this.#bank();
    if (bank === null) return refuse('refused', 'There is no bank connection yet');
    let plan: ReturnType<typeof planSetup>;
    try {
      plan = planSetup(bank, {
        today,
        assignment: this.#answers.assignment,
        lastPaycheckDate: date,
        settings: this.#input.settings,
        rules: this.#input.rules ?? [],
        inTransit: view.halves.filter((h) => h.onItsWay === true).map((h) => h.id),
      });
    } catch (error) {
      if (error instanceof MoneyError) return refuse('refused', capitalize(error.message));
      throw error;
    }
    if (!plan.ok) return refuse('refused', 'It does not add up to the starting money');
    this.#started = { book: plan.book, bank: plan.bank, input: plan.input, items: plan.items, startingMoney: plan.startingMoney };
    const settings = plan.book.settings();
    // With the mom reserve off there is no mom rule to set ("Off in this setup").
    const stillToSet = (['paycheckRule', 'momRule'] as const).filter((key) => settings[key] === null && !(key === 'momRule' && plan.book.switches().momReserve === 'off'));
    return { step: 'started', startingMoney: plan.startingMoney, stillToSet };
  }

  #suggestion(
    shown: SuggestionLine,
    answer: { readonly answer: 'add' | 'skip' } | { readonly answer: 'change'; readonly rule: BankRuleSpec },
    request: SetupRequest,
  ): SetupDone | Extract<SetupResponse, { ok: false }> {
    if (shown.status === 'covered') return refuse('refused', 'Your bank rules already read these this way');
    if (shown.status === 'added' || shown.status === 'changed') {
      return refuse('refused', answer.answer === 'skip' ? 'It is added already. To undo it, remove its rule from your bank rules' : 'That is already your answer');
    }
    const record = (kind: 'added' | 'changed' | 'skipped', ruleId: string | null): SetupDone => {
      const suggestions = new Map(this.#answers.suggestions);
      suggestions.set(shown.id, { answer: kind, ruleId });
      this.#answers = { ...this.#answers, suggestions };
      this.#dropAnswersNotAsked();
      return { step: 'suggestion', id: shown.id, answer: kind, ruleId };
    };
    if (answer.answer === 'skip') {
      if (shown.status === 'skipped') return refuse('refused', 'That is already your answer');
      return record('skipped', null);
    }
    if (answer.answer === 'add') {
      if (shown.means === 'transfer' && shown.other === null) return refuse('refused', 'Pick the account it is with first: change it');
      const spec: BankRuleSpec = { account: shown.account, contains: shown.contains, means: shown.means, ...(shown.other === null ? {} : { other: shown.other }) };
      const done = this.#bankRules.apply({ add: spec });
      return done.ok ? record('added', done.done.rule.id) : refuse('refused', done.why);
    }
    if (!('rule' in answer)) throw new Error('a suggestion answer is add, skip, or change');
    const preview = this.#bankRules.preview({ add: answer.rule });
    if ('why' in preview) return refuse('refused', preview.why);
    if (request.confirmed !== true || request.seen !== preview.key) {
      const changedSince = request.confirmed === true && request.seen !== undefined;
      return { ...refuse('needs-confirmation', changedSince ? 'What it would match has changed since you looked. Check it again' : 'Check what it would match before you add it'), preview };
    }
    const done = this.#bankRules.apply({ add: answer.rule });
    return done.ok ? record('changed', done.done.rule.id) : refuse('refused', done.why);
  }

  #ready(): SetupReadyView {
    const view = this.view();
    if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day stopped being ready');
    return view;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

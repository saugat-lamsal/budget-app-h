import { createHash } from 'node:crypto';
import { canonical, itemKey } from './item-key.js';
import {
  ACCOUNTS,
  FROM_NEXT_PAYCHECK,
  MOVABLE_POTS,
  MoneyError,
  PAY_SCHEDULES,
  RULE_CHOICES,
  addCents,
  formatDollars,
  subtractCents,
  type AccountId,
  type Book,
  type Cents,
  type ConfirmReason,
  type IsoDate,
  type LeftoverAnswer,
  type LeftoverChoice,
  type PaySchedule,
  type PickTo,
  type AnyPot,
  type ResortDetail,
  type ReviewDetail,
  type ReviewOptions,
  type Settings,
  type SettingsPreview,
  type SortChoice,
  type SortedNow,
  type SortingRule,
  type SplitPart,
  type TextRule,
} from '@budget-app/money';
import type {
  ChoiceOf,
  ChoicePart,
  ChoiceRequest,
  ChoiceResponse,
  Done,
  MoveRequest,
  MoveResponse,
  Moved,
  RefusalCode,
  RuleDone,
  RuleRequest,
  RuleResponse,
  RuleSpec,
  RuleView,
  SettingsDone,
  SettingsRequest,
  SettingsResponse,
  SetupRequest,
  SetupStep,
} from './views/choice.js';
import { ruleViewOf } from './views/settings.js';
import type { BankRuleRequest, BankRuleSpec } from './views/bank-rules.js';

// How a tap reaches the books (Phase 4). The screen sends the choice it was
// offered; the money math decides. Three promises:
// - The same choice sent twice changes nothing the second time. Each choice
//   carries a decision number made once on the phone; a repeat of it gets
//   the first answer back. A different decision number for an item that is
//   no longer waiting finds it already dealt with.
// - A refused choice changes nothing (the book undoes anything half done)
//   and says why, in words.
// - Anything final asks first: it is not done without his OK in the request.
//
// Five kinds of tap come through here: a choice for an item waiting in
// review; the same for an item sorted already, from the list of what went in
// and out of a bucket (4.7, QUESTIONS.md B100 to B102); moving money between
// buckets by hand (13.3, 13.4, B103); a change to the settings (section 2,
// 13.1); and adding, changing, or removing a sorting rule (13.2).

// Her rulebook: Wishlist too (4.2, 4.4, 6.1, 13.3); the money math refuses it where the setup has none.
const PICKS: readonly PickTo[] = ['paycheck', 'other-income', 'savings', 'needs', 'wants', 'wishlist', 'momReserve', 'not-mine', 'mom'];
const SPLIT_BUCKETS: readonly ChoicePart['bucket'][] = ['needs', 'wants', 'wishlist', 'not-mine'];
const BUCKET_WORDS: Readonly<Record<string, string>> = { needs: 'Needs', wants: 'Wants', wishlist: 'Wishlist', 'not-mine': 'Not mine', savings: 'Savings', momReserve: 'Mom reserve', heldForOthers: 'Held for others' };
const POTS: readonly AnyPot[] = [...MOVABLE_POTS, 'wishlist'];

const ID_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;
// An item's key as a screen saw it (item-key.ts).
const KEY_FORMAT = /^[0-9a-f]{16}$/;
const MAX_ITEM_LENGTH = 200;
const MAX_TEXT_LENGTH = 200;

// ----- Reading what the phone sent -----

// The request, if it is exactly the right shape, otherwise null. Nothing is
// guessed or repaired.
export function parseChoiceRequest(value: unknown): ChoiceRequest | null {
  if (!isRecord(value) || !onlyKeys(value, ['id', 'item', 'choice', 'always', 'confirmed', 'resort', 'seen'])) return null;
  const { id, item, choice, always, confirmed, resort, seen } = value;
  if (typeof id !== 'string' || !ID_FORMAT.test(id)) return null;
  if (typeof item !== 'string' || item === '' || item.length > MAX_ITEM_LENGTH) return null;
  const parsed = parseChoice(choice);
  if (parsed === null) return null;
  let rule: { readonly contains: string } | undefined;
  if (always !== undefined) {
    if (!isRecord(always) || !onlyKeys(always, ['contains']) || typeof always['contains'] !== 'string') return null;
    const contains = always['contains'].trim();
    if (contains === '' || contains.length > MAX_TEXT_LENGTH) return null;
    rule = { contains };
  }
  if (confirmed !== undefined && typeof confirmed !== 'boolean') return null;
  if (resort !== undefined && resort !== true) return null;
  if (seen !== undefined && (typeof seen !== 'string' || !KEY_FORMAT.test(seen))) return null;
  return {
    id,
    item,
    choice: parsed,
    ...(rule === undefined ? {} : { always: rule }),
    ...(confirmed === undefined ? {} : { confirmed }),
    ...(resort === undefined ? {} : { resort: true as const }),
    ...(seen === undefined ? {} : { seen }),
  };
}

// A hand move, if it is exactly an id, two buckets, and a whole number of
// cents more than zero (and, if he said so, his yes); otherwise null.
export function parseMoveRequest(value: unknown): MoveRequest | null {
  if (!isRecord(value) || !onlyKeys(value, ['id', 'move', 'confirmed'])) return null;
  const { id, move, confirmed } = value;
  if (typeof id !== 'string' || !ID_FORMAT.test(id)) return null;
  if (!isRecord(move) || !onlyKeys(move, ['from', 'to', 'amount'])) return null;
  const { from, to, amount } = move;
  if (!isPot(from) || !isPot(to)) return null;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return null;
  if (confirmed !== undefined && typeof confirmed !== 'boolean') return null;
  return { id, move: { from, to, amount }, ...(confirmed === undefined ? {} : { confirmed }) };
}

// Whatever the phone sent: a move, a settings change, or a rule change if it
// says so, otherwise a choice.
export function parseRequest(value: unknown): ChoiceRequest | MoveRequest | SettingsRequest | RuleRequest | SetupRequest | BankRuleRequest | null {
  if (!isRecord(value)) return null;
  if ('bankRule' in value) return parseBankRuleRequest(value);
  if ('move' in value) return parseMoveRequest(value);
  if ('settings' in value) return parseSettingsRequest(value);
  if ('rule' in value) return parseRuleRequest(value);
  if ('setup' in value) return parseSetupRequest(value);
  return parseChoiceRequest(value);
}

// One answer on the Setup day screens (section 14), exactly as the money math
// keeps it; otherwise null. Whether the date is a real one, and whether the
// amounts add up, is the money math's to say.
export function parseSetupRequest(value: unknown): SetupRequest | null {
  if (!isRecord(value) || !onlyKeys(value, ['id', 'setup', 'confirmed', 'seen'])) return null;
  const { id, setup, confirmed, seen } = value;
  if (typeof id !== 'string' || !ID_FORMAT.test(id)) return null;
  if (!isRecord(setup) || Object.keys(setup).length !== 1) return null;
  if (confirmed !== undefined && typeof confirmed !== 'boolean') return null;
  if (seen !== undefined && (typeof seen !== 'string' || !PREVIEW_KEY.test(seen))) return null;
  const yes = { ...(confirmed === undefined ? {} : { confirmed }), ...(seen === undefined ? {} : { seen }) };
  let step: SetupStep;
  if ('onItsWay' in setup) {
    const half = setup['onItsWay'];
    if (!isRecord(half) || Object.keys(half).length !== 2 || !onlyKeys(half, ['half', 'answer'])) return null;
    const { half: which, answer } = half;
    if (typeof which !== 'string' || which === '' || which.length > MAX_ITEM_LENGTH || typeof answer !== 'boolean') return null;
    step = { onItsWay: { half: which, answer } };
  } else if ('lastPaycheck' in setup) {
    const date = setup['lastPaycheck'];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    step = { lastPaycheck: date };
  } else if ('assign' in setup) {
    const assign = setup['assign'];
    if (!isRecord(assign) || Object.keys(assign).length !== 2 || !isPot(assign['pot'])) return null;
    const pot = assign['pot'];
    if (onlyKeys(assign, ['pot', 'amount']) && isWhole(assign['amount'])) step = { assign: { pot, amount: assign['amount'] } };
    else if (onlyKeys(assign, ['pot', 'rest']) && assign['rest'] === true) step = { assign: { pot, rest: true } };
    else return null;
  } else if ('suggestion' in setup) {
    const s = setup['suggestion'];
    if (!isRecord(s) || typeof s['id'] !== 'string' || s['id'] === '' || s['id'].length > MAX_ITEM_LENGTH) return null;
    if ((s['answer'] === 'add' || s['answer'] === 'skip') && Object.keys(s).length === 2 && onlyKeys(s, ['id', 'answer'])) step = { suggestion: { id: s['id'], answer: s['answer'] } };
    else if (s['answer'] === 'change' && Object.keys(s).length === 3 && onlyKeys(s, ['id', 'answer', 'rule'])) {
      const rule = parseBankRuleSpec(s['rule'], false);
      if (rule === null) return null;
      step = { suggestion: { id: s['id'], answer: 'change', rule } };
    } else return null;
  } else if ('lookBack' in setup) {
    const days = setup['lookBack'];
    if (!isWhole(days) || days < 0) return null;
    step = { lookBack: days };
  } else if ('start' in setup) {
    if (setup['start'] !== true) return null;
    step = { start: true };
  } else return null;
  return { id, setup: step, ...yes };
}

// A change to the bank rules (section 2, 24c), exactly as the bank rules
// keep it; otherwise null. Whether the rule can be (a transfer between two
// accounts, a fee on a card) is for the bank rules to say, in words.
export function parseBankRuleRequest(value: unknown): BankRuleRequest | null {
  if (!isRecord(value) || !onlyKeys(value, ['id', 'bankRule', 'confirmed', 'seen'])) return null;
  const { id, bankRule, confirmed, seen } = value;
  if (typeof id !== 'string' || !ID_FORMAT.test(id)) return null;
  if (!isRecord(bankRule) || Object.keys(bankRule).length !== 1) return null;
  if (confirmed !== undefined && typeof confirmed !== 'boolean') return null;
  if (seen !== undefined && (typeof seen !== 'string' || !PREVIEW_KEY.test(seen))) return null;
  const yes = { ...(confirmed === undefined ? {} : { confirmed }), ...(seen === undefined ? {} : { seen }) };
  if ('remove' in bankRule) {
    const which = bankRule['remove'];
    return typeof which === 'string' && which !== '' && which.length <= MAX_ITEM_LENGTH ? { id, bankRule: { remove: which }, ...yes } : null;
  }
  // A27: one place up or down among the rules on its account.
  if ('move' in bankRule) {
    const move = bankRule['move'];
    if (!isRecord(move) || Object.keys(move).length !== 2 || !onlyKeys(move, ['id', 'direction'])) return null;
    const { id: which, direction } = move;
    if (typeof which !== 'string' || which === '' || which.length > MAX_ITEM_LENGTH || (direction !== 'up' && direction !== 'down')) return null;
    return { id, bankRule: { move: { id: which, direction } }, ...yes };
  }
  if ('add' in bankRule) {
    const spec = parseBankRuleSpec(bankRule['add'], false);
    return spec === null ? null : { id, bankRule: { add: spec }, ...yes };
  }
  if ('change' in bankRule) {
    const spec = parseBankRuleSpec(bankRule['change'], true);
    return spec === null || !('id' in spec) ? null : { id, bankRule: { change: spec }, ...yes };
  }
  return null;
}

const BANK_MEANINGS: readonly string[] = ['transfer', 'payment-to-person', 'card-fee', 'card-interest'];

// A bank rule as the phone sends it: an account, the text, what it means,
// and for a transfer the other account; with its id when it is changed.
export function parseBankRuleSpec(value: unknown, withId: boolean): BankRuleSpec | (BankRuleSpec & { readonly id: string }) | null {
  const keys = [...(withId ? ['id'] : []), 'account', 'contains', 'means', 'other'];
  if (!isRecord(value) || !onlyKeys(value, keys)) return null;
  const { id, account, contains, means, other } = value;
  if (withId && (typeof id !== 'string' || id === '' || id.length > MAX_ITEM_LENGTH)) return null;
  if (!isAccount(account) || typeof contains !== 'string' || contains.length > MAX_TEXT_LENGTH * 2 || typeof means !== 'string' || !BANK_MEANINGS.includes(means)) return null;
  if (other !== undefined && !isAccount(other)) return null;
  const spec = { account, contains, means: means as BankRuleSpec['means'], ...(other === undefined ? {} : { other }) };
  return withId ? { id: id as string, ...spec } : spec;
}

function isAccount(value: unknown): value is AccountId {
  return (ACCOUNTS as readonly unknown[]).includes(value);
}

// ----- Settings and sorting rules (section 2) -----

const LEFTOVER_CHOICES: readonly LeftoverChoice[] = ['ask', 'roll-over', 'move-to-savings'];
// More reminder days than this is not a setting, it is a mistake.
const MAX_REMINDER_DAYS = 30;
const PREVIEW_KEY = /^[0-9a-f]{1,64}$/;

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const whole = (value: unknown): number | undefined => (isWhole(value) ? value : undefined);

function textRule(value: unknown): TextRule | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !onlyKeys(value, ['contains']) || typeof value['contains'] !== 'string') return undefined;
  const contains = value['contains'].trim();
  return contains === '' || contains.length > MAX_TEXT_LENGTH ? undefined : { contains };
}

// How each setting is read: exactly the shape the money math keeps, or
// undefined. Whether the value makes sense (a split adding up to 100, a real
// date) is the money math's to say, in words.
const SETTING_READERS: { readonly [K in keyof Settings]: (value: unknown) => Settings[K] | undefined } = {
  // Her rulebook, section 2: with Wishlist's share too, where the setup has it.
  split: (v) => {
    if (!isRecord(v) || ![3, 4].includes(Object.keys(v).length) || !onlyKeys(v, ['savings', 'needs', 'wants', 'wishlist'])) return undefined;
    const { savings, needs, wants, wishlist } = v;
    if (!(isWhole(savings) && isWhole(needs) && isWhole(wants))) return undefined;
    if (wishlist === undefined) return { savings, needs, wants };
    return isWhole(wishlist) ? { savings, needs, wants, wishlist } : undefined;
  },
  momReservePerPaycheck: whole,
  momReserveCap: whole,
  momMonthlyTarget: (v) => {
    if (!isRecord(v) || Object.keys(v).length !== 2 || !onlyKeys(v, ['low', 'high'])) return undefined;
    const { low, high } = v;
    return isWhole(low) && isWhole(high) ? { low, high } : undefined;
  },
  lowBucketAlertPercent: whole,
  cardReminderDaysBefore: (v) => (Array.isArray(v) && v.length <= MAX_REMINDER_DAYS && v.every(isWhole) ? [...(v as number[])] : undefined),
  dailyReviewTime: (v) => (typeof v === 'string' && v.length <= 5 ? v : undefined),
  leftoverAtPayday: (v) => {
    if (!isRecord(v) || Object.keys(v).length !== 2 || !onlyKeys(v, ['needs', 'wants'])) return undefined;
    const { needs, wants } = v;
    const ok = (c: unknown): c is LeftoverChoice => (LEFTOVER_CHOICES as readonly unknown[]).includes(c);
    return ok(needs) && ok(wants) ? { needs, wants } : undefined;
  },
  oldCardPromoEndDate: (v) => (v === null || (typeof v === 'string' && v.length <= 10) ? v : undefined),
  paycheckRule: textRule,
  paySchedule: (v) => ((PAY_SCHEDULES as readonly unknown[]).includes(v) ? (v as PaySchedule) : undefined),
  payScheduleDays: whole,
  momRule: textRule,
  earlyPaycheckDays: whole,
  // Section 2: a time zone by its name; whether there is such a zone is the money math's to say.
  homeTimeZone: (v) => (typeof v === 'string' && v.length <= 64 ? v : undefined),
  // 10.8: two times on the clock; whether they are times is the money math's to say.
  quietHours: (v) => {
    if (!isRecord(v) || Object.keys(v).length !== 2 || !onlyKeys(v, ['from', 'to'])) return undefined;
    const { from, to } = v;
    return typeof from === 'string' && from.length <= 5 && typeof to === 'string' && to.length <= 5 ? { from, to } : undefined;
  },
  bankNotReadAlertHours: whole,
  totalsMismatchAlertHours: whole,
  amountsOnLockScreen: (v) => (typeof v === 'boolean' ? v : undefined),
  bankPermissionWarnDays: whole,
  // 9.8: whole days, or none (not set); the range is the money math's to say.
  everydayCardClosingDay: (v) => (v === null ? null : whole(v)),
  oldCardClosingDay: (v) => (v === null ? null : whole(v)),
  // Her rulebook, 9.8: her second card's, the same way.
  secondCardClosingDay: (v) => (v === null ? null : whole(v)),
  // Her rulebook, section 2: on or off.
  askBeforeSplittingPaycheck: (v) => (typeof v === 'boolean' ? v : undefined),
};

// A change to one or more settings, exactly as the money math keeps them; otherwise null.
export function parseSettingsRequest(value: unknown): SettingsRequest | null {
  if (!isRecord(value) || !onlyKeys(value, ['id', 'settings', 'confirmed', 'seen'])) return null;
  const { id, settings, confirmed, seen } = value;
  if (typeof id !== 'string' || !ID_FORMAT.test(id)) return null;
  if (!isRecord(settings) || Object.keys(settings).length === 0) return null;
  const patch: Record<string, unknown> = {};
  for (const [key, sent] of Object.entries(settings)) {
    if (!Object.hasOwn(SETTING_READERS, key)) return null;
    const read = SETTING_READERS[key as keyof Settings]?.(sent);
    if (read === undefined) return null;
    patch[key] = read;
  }
  if (confirmed !== undefined && typeof confirmed !== 'boolean') return null;
  if (seen !== undefined && (typeof seen !== 'string' || !PREVIEW_KEY.test(seen))) return null;
  return { id, settings: patch as Partial<Settings>, ...(confirmed === undefined ? {} : { confirmed }), ...(seen === undefined ? {} : { seen }) };
}

// A sorting rule as the phone sends it: a kind, some text, and one of the
// choices the money math gives that kind (RULE_CHOICES); otherwise null.
function parseRuleSpec(value: unknown, withId: boolean): (RuleSpec & { readonly id?: string }) | null {
  if (!isRecord(value) || !onlyKeys(value, withId ? ['id', 'for', 'contains', 'to'] : ['for', 'contains', 'to'])) return null;
  const { for: kind, contains, to } = value;
  if (kind !== 'purchase' && kind !== 'deposit' && kind !== 'person') return null;
  if (typeof contains !== 'string') return null;
  const text = contains.trim();
  if (text === '' || text.length > MAX_TEXT_LENGTH) return null;
  if (!(RULE_CHOICES[kind] as readonly unknown[]).includes(to)) return null;
  const spec = { for: kind, contains: text, to } as RuleSpec;
  if (!withId) return spec;
  const id = value['id'];
  if (typeof id !== 'string' || id === '' || id.length > MAX_ITEM_LENGTH) return null;
  return { id, ...spec };
}

// Adding, changing, or removing one sorting rule; otherwise null.
export function parseRuleRequest(value: unknown): RuleRequest | null {
  if (!isRecord(value) || !onlyKeys(value, ['id', 'rule', 'confirmed'])) return null;
  const { id, rule, confirmed } = value;
  if (typeof id !== 'string' || !ID_FORMAT.test(id)) return null;
  if (!isRecord(rule) || Object.keys(rule).length !== 1) return null;
  if (confirmed !== undefined && typeof confirmed !== 'boolean') return null;
  const yes = confirmed === undefined ? {} : { confirmed };
  if ('add' in rule) {
    const spec = parseRuleSpec(rule['add'], false);
    return spec === null ? null : { id, rule: { add: spec }, ...yes };
  }
  if ('change' in rule) {
    const spec = parseRuleSpec(rule['change'], true);
    return spec === null || spec.id === undefined ? null : { id, rule: { change: spec as RuleView }, ...yes };
  }
  if ('remove' in rule) {
    const which = rule['remove'];
    return typeof which === 'string' && which !== '' && which.length <= MAX_ITEM_LENGTH ? { id, rule: { remove: which }, ...yes } : null;
  }
  if ('move' in rule) {
    const move = rule['move'];
    if (!isRecord(move) || Object.keys(move).length !== 2 || !onlyKeys(move, ['id', 'direction'])) return null;
    const { id: which, direction } = move;
    if (typeof which !== 'string' || which === '' || which.length > MAX_ITEM_LENGTH || (direction !== 'up' && direction !== 'down')) return null;
    return { id, rule: { move: { id: which, direction } }, ...yes };
  }
  return null;
}

// The money math's sorting rule for what the phone sent.
function sortingRuleOf(id: string, spec: RuleSpec): SortingRule {
  switch (spec.for) {
    case 'purchase':
      return { id, for: 'purchase', contains: spec.contains, bucket: spec.to };
    case 'deposit':
      return { id, for: 'deposit', contains: spec.contains, choice: { to: spec.to } };
    case 'person':
      return { id, for: 'person', contains: spec.contains, choice: { to: spec.to } };
  }
}

function isPot(value: unknown): value is AnyPot {
  return (POTS as readonly unknown[]).includes(value);
}

function parseChoice(value: unknown): ChoiceOf | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  if ('to' in value) return (PICKS as readonly unknown[]).includes(value['to']) ? { to: value['to'] as PickTo } : null;
  if ('transfer' in value) return (ACCOUNTS as readonly unknown[]).includes(value['transfer']) ? { transfer: value['transfer'] as AccountId } : null;
  if ('leftover' in value) return value['leftover'] === 'roll-over' || value['leftover'] === 'move-to-savings' ? { leftover: value['leftover'] } : null;
  if ('acknowledge' in value) return value['acknowledge'] === true ? { acknowledge: true } : null;
  if ('unmark' in value) return value['unmark'] === true ? { unmark: true } : null;
  if ('split' in value) return parseSplit(value['split']);
  if ('refundOf' in value) {
    const of = value['refundOf'];
    return typeof of === 'string' && of !== '' && of.length <= MAX_ITEM_LENGTH ? { refundOf: of } : null;
  }
  return null;
}

function parseSplit(value: unknown): ChoiceOf | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > SPLIT_BUCKETS.length) return null;
  const parts: ChoicePart[] = [];
  for (const part of value as unknown[]) {
    if (!isRecord(part) || !onlyKeys(part, ['bucket', 'amount'])) return null;
    const { bucket, amount } = part;
    if (!(SPLIT_BUCKETS as readonly unknown[]).includes(bucket)) return null;
    if (amount !== 'rest' && !(typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0)) return null;
    parts.push({ bucket: bucket as ChoicePart['bucket'], amount: amount as Cents | 'rest' });
  }
  if (new Set(parts.map((p) => p.bucket)).size !== parts.length) return null;
  if (parts.filter((p) => p.amount === 'rest').length > 1) return null;
  return { split: parts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Every key present has a value, and none is outside the list.
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key) && value[key] !== undefined);
}

// ----- The desk -----

// What a choice is about: an item waiting in review, or one sorted already.
interface Subject {
  readonly options: ReviewOptions;
  // What is left to sort or split (4.4).
  readonly net: Cents;
  // A store refund the app could not match (4.5, A18).
  readonly storeRefund: boolean;
  // Where it is sorted now; null for an item waiting in review.
  readonly now: SortedNow | null;
}

export class ChoiceDesk {
  readonly #book: Book;
  readonly #today: () => IsoDate;
  // What each decision number did, for the repeats. Kept in memory here (the
  // demo); the real server keeps it with the book's history.
  readonly #done = new Map<string, { readonly fingerprint: string; readonly done: Done }>();
  readonly #moved = new Map<string, { readonly fingerprint: string; readonly moved: Moved }>();
  readonly #changed = new Map<string, { readonly fingerprint: string } & ({ readonly settings: SettingsDone } | { readonly rule: RuleDone })>();

  constructor(book: Book, today: () => IsoDate) {
    this.#book = book;
    this.#today = today;
  }

  decide(request: ChoiceRequest): ChoiceResponse {
    const fingerprint = canonical(request);
    const earlier = this.#done.get(request.id);
    if (earlier !== undefined) {
      if (earlier.fingerprint === fingerprint) return { ok: true, replayed: true, done: earlier.done };
      return refuse('id-reused', 'That decision number was already used for a different choice.');
    }
    if (this.#moved.has(request.id) || this.#changed.has(request.id)) return refuse('id-reused', 'That decision number was already used for a different choice.');

    const details = this.#book.reviewDetails();
    const detail = details.find((d) => d.item.id === request.item);
    let subject: Subject;
    if (detail !== undefined) {
      // Step 3: an answer about an item that changed since the screen showed
      // it (a sync brought something new about it) is refused, with how it is now.
      if (request.seen !== undefined && request.seen !== itemKey(detail)) return refuse('changed', changedWhy(detail));
      subject = { options: detail.options, net: detail.item.type === 'spending' ? detail.item.amount : 0, storeRefund: detail.item.type === 'money-in' && detail.item.reason === 'refund', now: null };
    } else {
      // Only a tap on the list of what went in and out of a bucket may change
      // something that is not waiting.
      const sorted = request.resort === true ? this.#book.resortDetail(request.item) : null;
      if (sorted === null) return refuse('not-waiting', 'That one was already dealt with.');
      if (!sorted.resortable) return refuse('refused', sorted.why);
      if (request.seen !== undefined && request.seen !== itemKey(sorted)) return refuse('changed', changedWhy(sorted));
      subject = { options: sorted.options, net: sorted.type === 'spending' ? sorted.amount : 0, storeRefund: sorted.refund, now: sorted.now };
    }

    // Only what the rulebook gives for this kind of item.
    const notOffered = this.#notOffered(request, subject);
    if (notOffered !== null) return refuse('refused', notOffered);

    // Anything final asks first.
    if (isFinal(request, subject.options) && request.confirmed !== true) {
      return refuse('needs-confirmation', "This can't be undone here, so it needs your OK first.");
    }

    // "The rest" of a split is worked out by the money math, not the screen.
    let choice = request.choice;
    if ('split' in choice) {
      const resolved = resolveSplit(choice.split, subject.net);
      if (typeof resolved === 'string') return refuse('refused', resolved);
      choice = { split: resolved };
    }

    // B101: sorting it where it already is changes nothing. (A rule for it
    // is still a rule: "always do this" on an item that is already right.)
    if (subject.now !== null && request.always === undefined) {
      const there = alreadyThere(choice, subject.now);
      if (there !== null) return refuse('refused', `It is already ${there}.`);
    }

    const before = new Set(this.#book.reviewItems().map((i) => i.id));
    let applied: Applied;
    try {
      applied = this.#apply(request, choice);
    } catch (error) {
      if (error instanceof MoneyError) return refuse('refused', explainRefusal(error, details));
      throw error;
    }
    const after = new Set(this.#book.reviewItems().map((i) => i.id));
    // 13.2: the other waiting items the new rule sorted.
    const alsoSorted = request.always === undefined ? 0 : [...before].filter((id) => id !== request.item && !after.has(id)).length;
    // A19: the ones it matched but left waiting, by name.
    const stillWaiting = applied.stillWaiting.map((id) => {
      const d = details.find((x) => x.item.id === id);
      return { item: id, name: d === undefined ? 'An item' : nameOf(d) };
    });
    // 13.8: one way, by hand, without a rule: the rule to offer, if any.
    const offer = request.always === undefined && 'to' in choice ? this.#book.ruleOffer(request.item) : null;
    const done: Done = { item: request.item, choice, alsoSorted, stillWaiting, sticks: applied.sticks, ...(offer === null ? {} : { offer }) };
    this.#done.set(request.id, { fingerprint, done });
    return { ok: true, replayed: false, done };
  }

  // Moves money between two buckets by hand (13.3). The money math says when
  // it needs his yes first (13.4); a move that asks is not done and not
  // remembered, so the same decision can be sent again with his yes.
  move(request: MoveRequest): MoveResponse {
    const fingerprint = canonical(request);
    const earlier = this.#moved.get(request.id);
    if (earlier !== undefined) {
      if (earlier.fingerprint === fingerprint) return { ok: true, replayed: true, moved: earlier.moved };
      return refuse('id-reused', 'That decision number was already used for a different move.');
    }
    if (this.#done.has(request.id) || this.#changed.has(request.id)) return refuse('id-reused', 'That decision number was already used for a different choice.');

    const { from, to, amount } = request.move;
    if (from === to) return refuse('refused', 'Pick two different buckets to move money between');
    let result: ReturnType<Book['moveMoney']>;
    try {
      result = this.#book.moveMoney({ from, to, amount, ...(request.confirmed === true ? { confirmed: true } : {}) }, this.#today());
    } catch (error) {
      if (error instanceof MoneyError) return refuse('refused', error.code === 'not-cents' ? 'That would make a total too large to keep exact' : capitalize(error.message));
      throw error;
    }
    if (!result.moved) {
      return { ...refuse('needs-confirmation', askingWhy(request.move, result.reasons)), reasons: result.reasons };
    }
    const moved: Moved = { from, to, amount };
    this.#moved.set(request.id, { fingerprint, moved });
    return { ok: true, replayed: false, moved };
  }

  // A change to the settings (section 2). Only the settings that change are
  // changed and logged; the money math checks each and says why it refuses.
  // 13.1: the split and the mom reserve wait for the next paycheck, and the
  // answer says so. A9: the paycheck rule and the mom rule sort what is
  // waiting for good, so they ask first, with what they would do (the money
  // math's preview). His yes must name the preview he saw: if what it would
  // do has changed since, it asks again.
  settings(request: SettingsRequest): SettingsResponse {
    const fingerprint = canonical(request);
    const earlier = this.#changed.get(request.id);
    if (earlier !== undefined) {
      if (earlier.fingerprint === fingerprint && 'settings' in earlier) return { ok: true, replayed: true, done: earlier.settings };
      return refuse('id-reused', 'That decision number was already used for a different change.');
    }
    if (this.#done.has(request.id) || this.#moved.has(request.id)) return refuse('id-reused', 'That decision number was already used for a different choice.');

    const current = this.#book.settings();
    const patch = Object.fromEntries(Object.entries(request.settings).filter(([key, value]) => canonical(value) !== canonical(current[key as keyof Settings]))) as Partial<Settings>;
    const keys = Object.keys(patch) as (keyof Settings)[];
    if (keys.length === 0) return refuse('refused', 'That is already the setting');
    const today = this.#today();
    const explain = (error: unknown): SettingsResponse => {
      if (error instanceof MoneyError) return refuse('refused', explainRefusal(error, []));
      throw error;
    };

    if ('paycheckRule' in patch || 'momRule' in patch) {
      let preview: SettingsPreview;
      try {
        preview = this.#book.previewSettingsChange(patch, today);
      } catch (error) {
        return explain(error);
      }
      const key = previewKey(preview);
      if (request.confirmed !== true || request.seen !== key) {
        const why = request.confirmed === true && request.seen !== undefined ? 'What it would do has changed since you looked. Check it again' : askingAboutRules(patch);
        return { ...refuse('needs-confirmation', why), preview: { ...preview, key } };
      }
    }

    let rechecked: SettingsDone['rechecked'];
    try {
      ({ rechecked } = this.#book.changeSettings(patch, today));
    } catch (error) {
      return explain(error);
    }
    const done: SettingsDone = { changed: keys, fromNextPaycheck: keys.some((key) => (FROM_NEXT_PAYCHECK as readonly string[]).includes(key)), rechecked };
    this.#changed.set(request.id, { fingerprint, settings: done });
    return { ok: true, replayed: false, done };
  }

  // Adding, changing, or removing a sorting rule (13.2). A new rule goes to
  // the end of the list; a changed one keeps its place. Either sorts what is
  // waiting that it is now the first match for, and leaves waiting what it
  // cannot sort, by name (A19). Removing a rule asks first; what it sorted
  // stays where it is.
  rule(request: RuleRequest): RuleResponse {
    const fingerprint = canonical(request);
    const earlier = this.#changed.get(request.id);
    if (earlier !== undefined) {
      if (earlier.fingerprint === fingerprint && 'rule' in earlier) return { ok: true, replayed: true, done: earlier.rule };
      return refuse('id-reused', 'That decision number was already used for a different change.');
    }
    if (this.#done.has(request.id) || this.#moved.has(request.id)) return refuse('id-reused', 'That decision number was already used for a different choice.');

    const book = this.#book;
    const today = this.#today();
    const edit = request.rule;
    const details = book.reviewDetails();
    const before = new Set(book.reviewItems().map((i) => i.id));
    const existing = (id: string): SortingRule | undefined => book.rules().find((r) => r.id === id);
    let action: RuleDone['action'];
    let ruleId: string;
    let stillWaiting: readonly string[] = [];
    let removed: SortingRule | undefined;
    try {
      if ('add' in edit) {
        // The rule's name comes from the decision number, so it is made once.
        ruleId = `rule-${request.id}`;
        ({ stillWaiting } = book.addRule(sortingRuleOf(ruleId, edit.add), today));
        action = 'added';
      } else if ('change' in edit) {
        ruleId = edit.change.id;
        const was = existing(ruleId);
        if (was === undefined) return refuse('not-waiting', 'That rule is not there any more');
        const next = sortingRuleOf(ruleId, edit.change);
        if (canonical(next) === canonical(was)) return refuse('refused', 'The rule already says that');
        ({ stillWaiting } = book.changeRule(next, today));
        action = 'changed';
      } else if ('move' in edit) {
        // A22: one place among the rules of its kind; the money math says where that is.
        ruleId = edit.move.id;
        const rule = existing(ruleId);
        if (rule === undefined) return refuse('not-waiting', 'That rule is not there any more');
        const ofItsKind = book.rules().filter((r) => r.for === rule.for);
        const place = ofItsKind.indexOf(rule);
        if (edit.move.direction === 'up' && place === 0) return refuse('refused', 'It is already the first rule of its kind');
        if (edit.move.direction === 'down' && place === ofItsKind.length - 1) return refuse('refused', 'It is already the last rule of its kind');
        ({ stillWaiting } = book.moveRule(ruleId, edit.move.direction, today));
        action = edit.move.direction === 'up' ? 'moved-up' : 'moved-down';
      } else {
        ruleId = edit.remove;
        removed = existing(ruleId);
        if (removed === undefined) return refuse('not-waiting', 'That rule is not there any more');
        if (request.confirmed !== true) return refuse('needs-confirmation', `Removing the rule "${removed.contains}" needs your OK first. What it already sorted stays where it is`);
        book.removeRule(ruleId, today);
        action = 'removed';
      }
    } catch (error) {
      if (error instanceof MoneyError) return refuse('refused', explainRefusal(error, details));
      throw error;
    }
    const now = removed ?? existing(ruleId);
    if (now === undefined) throw new Error(`the rule ${ruleId} went missing`);
    const after = new Set(book.reviewItems().map((i) => i.id));
    const done: RuleDone = {
      action,
      rule: ruleViewOf(now),
      alsoSorted: [...before].filter((id) => !after.has(id)).length,
      stillWaiting: stillWaiting.map((id) => {
        const d = details.find((x) => x.item.id === id);
        return { item: id, name: d === undefined ? 'An item' : nameOf(d) };
      }),
    };
    this.#changed.set(request.id, { fingerprint, rule: done });
    return { ok: true, replayed: false, done };
  }

  // The choice is one the money math offers for this item (review-options.ts).
  // The book still has the last word; this gives the plain reason up front.
  #notOffered(request: ChoiceRequest, subject: Subject): string | null {
    const c = request.choice;
    const options = subject.options;
    const no = "That isn't one of the choices for this item.";
    if ('leftover' in c) return options.type === 'leftover' && options.answers.includes(c.leftover) && request.always === undefined ? null : no;
    if ('acknowledge' in c) return options.type === 'acknowledge' && request.always === undefined ? null : no;
    if (options.type !== 'sort') return no;
    // A21: only for a payment marked from savings, and never by a rule.
    if ('unmark' in c) return options.unmark && request.always === undefined ? null : no;
    // A18, A29: only one of the likely purchases the money math offers (for
    // a refund, or money in to checking), and never by a rule.
    if ('refundOf' in c) {
      if (request.always !== undefined) return "A rule can't do that for this item.";
      // Money in with no purchase to match has no such choice; a store
      // refund is told why.
      if (!subject.storeRefund && options.match.length === 0) return no;
      return options.match.includes(c.refundOf) ? null : "That purchase isn't one this refund can belong to.";
    }
    const unavailable = options.unavailable.find((u) => ('to' in c && c.to === 'paycheck' && u.what === 'paycheck') || ('transfer' in c && u.what === 'transfer'));
    if (unavailable !== undefined) return unavailable.why;
    if ('to' in c) {
      if (!options.picks.some((p) => p.to === c.to)) return no;
      return request.always === undefined || options.always.includes(c.to) ? null : "A rule can't do that for this item.";
    }
    if (request.always !== undefined) return "A rule can't do that for this item.";
    if ('transfer' in c) return options.transfer.includes(c.transfer) ? null : no;
    if (options.split === null) return "This one can't be split.";
    return c.split.every((p) => options.split?.includes(p.bucket) === true) ? null : "This one can't be split that way.";
  }

  // Hands the choice to the money math. Returns whether "always do this"
  // will catch the next one (null when it was not asked for), and what the
  // rule left waiting.
  #apply(request: ChoiceRequest, choice: ChoiceOf): Applied {
    const book = this.#book;
    const today = this.#today();
    const item = request.item;
    const once: Applied = { sticks: null, stillWaiting: [] };
    if ('leftover' in choice) {
      book.answerLeftover(item, choice.leftover as LeftoverAnswer, today);
      return once;
    }
    if ('acknowledge' in choice) {
      book.acknowledge(item, today);
      return once;
    }
    const sort: SortChoice =
      'to' in choice
        ? { to: choice.to }
        : 'unmark' in choice
          ? { unmark: true }
          : 'transfer' in choice
          ? { transfer: choice.transfer }
          : 'refundOf' in choice
            ? { refundOf: choice.refundOf }
            : { split: choice.split.map((p): SplitPart => ({ bucket: p.bucket, amount: p.amount as Cents })) };
    if (request.always === undefined) {
      book.sort(item, sort, today);
      return once;
    }
    // The rule's number comes from the decision number, so it is made once.
    return book.sortAlways(item, sort, { id: `always-${request.id}`, contains: request.always.contains }, today);
  }
}

interface Applied {
  readonly sticks: boolean | null;
  readonly stillWaiting: readonly string[];
}

type Refusal = Extract<ChoiceResponse, { ok: false }>;

export function refuse(code: RefusalCode, why: string): Refusal {
  return { ok: false, code, why: `${why.replace(/\s*\.?\s*$/, '')}. Nothing was changed.` };
}

// A9: why a change to the paycheck rule or the mom rule asks first.
function askingAboutRules(patch: Partial<Settings>): string {
  const named = (['paycheckRule', 'momRule'] as const).filter((key) => key in patch);
  const names = named.map((key) => (key === 'paycheckRule' ? 'the paycheck rule' : 'the mom rule')).join(' and ');
  const cleared = named.filter((key) => patch[key] === null);
  if (cleared.length === 0) return `Setting ${names} sorts what is waiting for good, so it needs your OK first`;
  if (cleared.length === named.length) {
    if (named.length === 2) return 'Clearing the paycheck rule and the mom rule needs your OK first: what they find will wait in review until you set them again';
    return named[0] === 'paycheckRule'
      ? 'Clearing the paycheck rule needs your OK first: paychecks will wait in review until you set it again'
      : 'Clearing the mom rule needs your OK first: payments to her will wait in review until you set it again';
  }
  return `Changing ${names} needs your OK first`;
}

// Why an answer about an item that changed is refused: how it is now.
function changedWhy(now: ReviewDetail | Extract<ResortDetail, { resortable: true }>): string {
  const again = 'Look at it again, then choose';
  if ('item' in now) return `${capitalize(nameOf(now))} changed since you looked: it is now ${formatDollars(now.item.amount)}${now.pending ? ', still pending' : ''}. ${again}`;
  return `${now.description} changed since you looked: it is now ${formatDollars(now.amount)}${now.pending ? ', still pending' : ''}. ${again}`;
}

// A name for exactly this preview: the same preview always gets the same key,
// and a different one, a different key.
function previewKey(preview: SettingsPreview): string {
  return createHash('sha256').update(canonical(preview)).digest('hex').slice(0, 32);
}

// 13.4: why a move asks first, in his words: what it takes out of, and
// whether it would leave that bucket below zero, which is usually a typo.
function askingWhy(move: Moved, reasons: readonly ConfirmReason[]): string {
  const from = BUCKET_WORDS[move.from] ?? move.from;
  const because = reasons.map((reason) => {
    switch (reason) {
      case 'out-of-savings':
        return 'takes money out of Savings';
      case 'out-of-mom-reserve':
        return 'takes money out of the Mom reserve';
      case 'out-of-wishlist':
        return 'takes money out of Wishlist';
      case 'below-zero':
        return `would leave ${from} below zero, which is usually a typo`;
    }
  });
  return `Moving ${formatDollars(move.amount)} out of ${from} needs your OK first: it ${because.join(' and ')}`;
}

// 3.4, 6.1, 13.6: what cannot be taken back here asks first. A leftover
// answer cannot be asked again; "this is my paycheck" starts a pay period
// (B52); a rule keeps applying to everything that comes after; a refund
// matched to a purchase is matched for good, like one the bank matched (A18).
function isFinal(request: ChoiceRequest, options: ReviewOptions): boolean {
  const c = request.choice;
  if (request.always !== undefined || 'leftover' in c || 'refundOf' in c) return true;
  return options.type === 'sort' && 'to' in c && options.picks.some((p) => p.to === c.to && p.final);
}

// Where the choice would leave the item, if that is where it already is (B101).
function alreadyThere(choice: ChoiceOf, now: SortedNow): string | null {
  if ('to' in choice && 'to' in now && choice.to === now.to) {
    switch (now.to) {
      case 'not-mine':
        return 'marked not mine';
      case 'mom':
        return 'marked for mom';
      case 'other-income':
        return 'counted as other income';
      case 'momReserve':
        return 'in the Mom reserve';
      default:
        return `in ${BUCKET_WORDS[now.to] ?? now.to}`;
    }
  }
  if ('split' in choice && 'split' in now) {
    const same = (parts: readonly { readonly bucket: string; readonly amount: unknown }[]): string => parts.map((p) => `${p.bucket}:${String(p.amount)}`).sort().join(',');
    return same(choice.split) === same(now.split) ? 'split that way' : null;
  }
  return null;
}

// The parts of a split with "the rest" worked out, or the reason it cannot be.
function resolveSplit(parts: readonly ChoicePart[], net: Cents): readonly ChoicePart[] | string {
  const rest = parts.find((p) => p.amount === 'rest');
  const known = addCents(0, ...parts.map((p) => (p.amount === 'rest' ? 0 : p.amount)));
  if (rest === undefined) {
    return known === net ? parts : `The parts add up to ${formatDollars(known)}, but this is ${formatDollars(net)}`;
  }
  const left = subtractCents(net, known);
  const word = BUCKET_WORDS[rest.bucket] ?? rest.bucket;
  if (left <= 0) {
    return left === 0
      ? `Nothing is left for ${word}: the other parts already add up to ${formatDollars(net)}`
      : `Nothing is left for ${word}: the other parts add up to ${formatDollars(known)}, more than the ${formatDollars(net)} to split`;
  }
  return parts.map((p) => (p.amount === 'rest' ? { bucket: p.bucket, amount: left } : p));
}

// A refusal from the money math in plain words: the ids of the items waiting
// are replaced with what they are, and a total too large to stay exact says so.
export function explainRefusal(error: MoneyError, details: readonly ReviewDetail[]): string {
  if (error.code === 'not-cents') return 'That would make a total too large to keep exact';
  let text = error.message;
  // The longest ids first, so one id inside another is not cut in two.
  for (const d of [...details].sort((a, b) => b.item.id.length - a.item.id.length)) {
    if (d.item.id.length < 4) continue;
    text = text.replace(new RegExp(`(?<![\\w:-])${escape(d.item.id)}(?![\\w:-])`, 'g'), () => `"${nameOf(d)}"`);
  }
  return capitalize(text);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function nameOf(d: ReviewDetail): string {
  const item = d.item;
  return item.type === 'leftover' ? `${BUCKET_WORDS[item.bucket] ?? item.bucket} leftover` : item.description;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The same request always gives the same text, whatever order its keys were
// written in, so a repeat is recognized (item-key.ts).
export { canonical };

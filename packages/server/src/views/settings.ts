import {
  FROM_NEXT_PAYCHECK,
  RULE_CHOICES,
  payoffCountdown,
  type AccountId,
  type BankBalances,
  type Book,
  type Cents,
  type ChangeLogEntry,
  type IsoDate,
  type PayoffCountdown,
  type AnyPot,
  type Settings,
  type SortingRule,
  type SplitSettings,
  type TextRule,
} from '@budget-app/money';
import type { BankRule } from '../bank/reading.js';
import type { HerTotals } from '../history/history.js';
import type { BankRuleLogLine } from './bank-rules.js';
import type { RuleView } from './choice.js';
import type { CardRemindersOff, CheckedAt } from './home.js';
import type { LoginView } from './login.js';
import type { PushView } from './push.js';
import type { ServerLogLine } from './server-log.js';

// What the Settings screen shows, worked out on the server from the book:
// every setting in rulebook section 2, what is in force this pay period next
// to what comes from the next paycheck (13.1), the sorting rules in the order
// they are tried, and the change log, newest first (13.5). The screen only
// formats it.

export interface SettingsInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  // Today's balances as the bank reports them, pending charges included
  // (12.1). Null when the bank could not be read.
  readonly bank: BankBalances | null;
  readonly madeUpData: boolean;
  // Section 2, 24c: the bank rules, and the change log's lines for them
  // (13.5). None when left out.
  readonly bankRules?: { readonly rules: readonly BankRule[]; readonly log: readonly BankRuleLogLine[]; readonly recentDays: number };
  // The change log's lines the server keeps (13.5): the history taking new
  // totals (A28), and logins. None when left out (the demo).
  readonly serverLog?: readonly ServerLogLine[];
  // Step 2: the login card, on the real server only (the demo has no login).
  readonly login?: LoginView;
  // Step 3: syncing with the bank, on the real server only (the demo has no bank).
  readonly sync?: SyncView;
  // Phase 5: the list of alerts sent, on the real server only (the demo sends none).
  readonly alerts?: AlertsCount;
  // Phase 5: the Notifications card, for the device asking, on the real server only.
  readonly push?: PushView;
  // 9.8 (A52): the cards whose reminders are off. None when left out (the demo).
  readonly cardsOff?: readonly CardRemindersOff[];
}

// Phase 5: how many alerts the app worked out, how many were sent, and how
// many are not sent yet. The rest will never be sent (10.9, A40).
export interface AlertsCount {
  readonly total: number;
  readonly sent: number;
  readonly notSent: number;
}

// Step 3: how often the real server syncs with the bank (section 2), in
// minutes, and when it last read the bank ("Checked at").
export interface SyncView {
  readonly everyMinutes: number;
  readonly checkedAt: CheckedAt | null;
  // Today in his home time zone, for "Checked at" (the time only, on the same day).
  readonly today: IsoDate;
}

// A sorting rule, with its place among the rules of its kind: the first that
// matches wins (4.2, B9).
export type RuleRow = RuleView & { readonly position: number };

// One setting changed: its name, what it was, and what it became.
export type SettingChange = { readonly [K in keyof Settings]-?: { readonly key: K; readonly before: Settings[K]; readonly after: Settings[K] } }[keyof Settings];

// One line of the change log (13.5). key names the line, for the screen.
export type LogRow =
  // 13.1: fromNextPaycheck when the change waits for the next paycheck.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'setting'; readonly change: SettingChange; readonly fromNextPaycheck: boolean }
  // 13.6: a rule made from a correction ("always do this") goes just ahead of
  // the rule it corrects, which is shown as it was then.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'rule-added'; readonly rule: RuleView; readonly fromCorrection: boolean; readonly aheadOf: RuleView | null }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'rule-changed'; readonly before: RuleView; readonly after: RuleView }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'rule-removed'; readonly rule: RuleView }
  // A22: moved one place up or down past another rule of its kind; position is its place now.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'rule-moved'; readonly rule: RuleView; readonly past: RuleView; readonly direction: 'up' | 'down'; readonly position: number }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'money-moved'; readonly from: AnyPot; readonly to: AnyPot; readonly amount: Cents }
  // 4.10: the bank took back something the app had counted.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'bank-took-back'; readonly description: string; readonly amount: Cents }
  // Section 2, 24c: a bank rule added, changed (before and after), or removed.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'bank-rule-added' | 'bank-rule-removed'; readonly rule: BankRule }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'bank-rule-changed'; readonly before: BankRule; readonly after: BankRule }
  // A27: moved one place up or down among the rules on its account, past
  // another; position is its place in the whole list now.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'bank-rule-moved'; readonly direction: 'up' | 'down'; readonly rule: BankRule; readonly past: BankRule; readonly position: number }
  // A28: the history took new totals from an event on (a fix to the money
  // math), with how many events changed and what changed at the first one.
  | {
      readonly key: string;
      readonly date: IsoDate;
      readonly kind: 'history-retotaled';
      readonly from: { readonly date: IsoDate; readonly what: string };
      readonly events: number;
      readonly changes: readonly { readonly name: keyof HerTotals; readonly before: number; readonly after: number }[];
    }
  // Logins, new passkeys and log outs, by the device, and the login setting.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'logged-in' | 'logged-out' | 'passkey-added'; readonly device: string }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'stay-logged-in-changed'; readonly before: number; readonly after: number }
  // Step 3: how often it syncs with the bank, in minutes.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'sync-every-changed'; readonly before: number; readonly after: number }
  // Phase 5: notifications turned on or off on a device, or stopped by its push service.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'notifications-on' | 'notifications-off'; readonly device: string }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'notifications-stopped'; readonly device: string; readonly why: string }
  // 1.1 to 1.3: the bank connected, which account is which, a new login to the bank.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'bank-connected'; readonly bank: 'test' | 'real' }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'bank-accounts'; readonly accounts: Readonly<Record<AccountId, string>> }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'bank-logged-in-again' }
  // Her rulebook, 53.1 and 13.5 (HA10): setup day, with the place rules and
  // the paycheck rule she kept from the rule finder; her setup only.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'setup-day'; readonly rules: readonly RuleView[]; readonly paycheckRule: TextRule | null };

export type SettingsView =
  // Before setup day there are no settings yet, but he can still log out.
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean; readonly login?: LoginView; readonly sync?: SyncView; readonly alerts?: AlertsCount; readonly push?: PushView }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      // Step 2: the login card, on the real server only.
      readonly login?: LoginView;
      // Step 3: syncing with the bank, on the real server only.
      readonly sync?: SyncView;
      // Phase 5: the list of alerts sent, and the Notifications card, on the real server only.
      readonly alerts?: AlertsCount;
      readonly push?: PushView;
      readonly today: IsoDate;
      // 0.5: Settings says so too when the totals do not match the bank.
      readonly check: { readonly state: 'matches' } | { readonly state: 'does-not-match'; readonly difference: Cents } | { readonly state: 'bank-not-read' };
      // 13.1: the split and the mom reserve in force this pay period, and what
      // the next paycheck will use. waiting names the ones that differ.
      readonly split: {
        readonly thisPayPeriod: SplitSettings;
        readonly fromNextPaycheck: SplitSettings;
        readonly waiting: readonly (keyof SplitSettings)[];
        readonly payPeriodStarted: IsoDate;
        // 11.2: from the pay schedule; days are negative when the paycheck is late (B35).
        readonly nextPayday: { readonly date: IsoDate; readonly days: number };
      };
      // Every setting as it is now. Everything but the split and the mom
      // reserve is in force right away (B38).
      readonly settings: Settings;
      // 9.5: on once the promo end date is entered.
      readonly payoff: PayoffCountdown;
      // 9.8 (A52): the cards whose reminders are off, and why, as on Home.
      readonly cardsOff: readonly CardRemindersOff[];
      // Each kind of rule in the order they are tried.
      readonly rules: { readonly purchase: readonly RuleRow[]; readonly deposit: readonly RuleRow[]; readonly person: readonly RuleRow[] };
      // What each kind of rule can pick, from the money math.
      readonly ruleChoices: typeof RULE_CHOICES;
      // Section 2, 24c: the bank rules, in the order they are tried (the
      // first that fits wins, A27), with how far back a change's preview looks.
      readonly bankRules: readonly BankRule[];
      readonly bankRulesRecentDays: number;
      // Newest first; the same day, the one made last first.
      readonly log: readonly LogRow[];
    };

export function ruleViewOf(rule: SortingRule): RuleView {
  switch (rule.for) {
    case 'purchase':
      return { id: rule.id, for: rule.for, contains: rule.contains, to: rule.bucket };
    case 'deposit':
      return { id: rule.id, for: rule.for, contains: rule.contains, to: rule.choice.to };
    case 'person':
      return { id: rule.id, for: rule.for, contains: rule.contains, to: rule.choice.to };
  }
}

export function settingsView(input: SettingsInput): SettingsView {
  const { today, book, bank, madeUpData } = input;
  const login = { ...(input.login === undefined ? {} : { login: input.login }), ...(input.sync === undefined ? {} : { sync: input.sync }), ...(input.alerts === undefined ? {} : { alerts: input.alerts }), ...(input.push === undefined ? {} : { push: input.push }) };
  if (book === null) return { state: 'not-set-up', madeUpData, ...login };

  let check: Extract<SettingsView, { state: 'tracking' }>['check'];
  if (bank === null) check = { state: 'bank-not-read' };
  else {
    const self = book.selfCheck(bank);
    check = self.ok ? { state: 'matches' } : { state: 'does-not-match', difference: self.difference };
  }

  const settings = book.settings();
  const thisPayPeriod = book.splitInForce();
  const fromNextPaycheck: SplitSettings = { split: settings.split, momReservePerPaycheck: settings.momReservePerPaycheck, momReserveCap: settings.momReserveCap };
  const waiting = FROM_NEXT_PAYCHECK.filter((key) => JSON.stringify(thisPayPeriod[key]) !== JSON.stringify(fromNextPaycheck[key]));
  const safe = book.safeToSpend(today);

  const rows = (kind: SortingRule['for']): RuleRow[] =>
    book
      .rules()
      .filter((r) => r.for === kind)
      .map((r, i) => ({ ...ruleViewOf(r), position: i + 1 }));

  return {
    state: 'tracking',
    madeUpData,
    today,
    check,
    split: { thisPayPeriod, fromNextPaycheck, waiting, payPeriodStarted: book.period().startDate, nextPayday: { date: safe.nextPayday, days: safe.daysToPayday } },
    settings,
    payoff: payoffCountdown(book, today),
    cardsOff: [...(input.cardsOff ?? [])],
    rules: { purchase: rows('purchase'), deposit: rows('deposit'), person: rows('person') },
    ruleChoices: RULE_CHOICES,
    bankRules: input.bankRules?.rules ?? [],
    bankRulesRecentDays: input.bankRules?.recentDays ?? 0,
    log: logRows(book, input.bankRules?.log ?? [], input.serverLog ?? []),
    ...login,
  };
}

// The change log as lines, newest first. A settings change is one line for
// each setting it changed. The bank rules' lines (kept by the bank
// connection, not the book) and the server's own lines (A28, logins) go where
// they happened among the book's (13.5).
function logRows(book: Book, bankLog: readonly BankRuleLogLine[], serverLog: readonly ServerLogLine[]): LogRow[] {
  const log = book.changeLog();
  const rows: LogRow[] = [];
  // The lines kept outside the book, in the order they were written: each
  // server line goes after the bank rule lines there were when it was written.
  const outside: { readonly afterBookLines: number; readonly row: LogRow }[] = [];
  const serverRows = (upTo: number): void => {
    for (const [j, line] of serverLog.entries()) if (line.afterBankLines === upTo) outside.push({ afterBookLines: line.afterBookLines, row: serverRow(line, `s${j}-0`) });
  };
  for (const [m, line] of bankLog.entries()) {
    serverRows(m);
    outside.push({ afterBookLines: line.afterBookLines, row: bankRow(line, `b${m}-0`) });
  }
  for (const [j, line] of serverLog.entries()) if (line.afterBankLines >= bankLog.length) outside.push({ afterBookLines: line.afterBookLines, row: serverRow(line, `s${j}-0`) });
  const bankRows = (i: number): LogRow[] => outside.filter((o) => o.afterBookLines === i || (i === log.length && o.afterBookLines > log.length)).map((o) => o.row);
  rows.push(...bankRows(0));
  log.forEach((entry, i) => {
    const key = (j: number): string => `${i}-${j}`;
    const { date } = entry;
    switch (entry.kind) {
      case 'settings-changed':
        (Object.keys(entry.changes) as (keyof Settings)[]).forEach((name, j) => {
          const change = { key: name, before: entry.before[name], after: entry.changes[name] } as SettingChange;
          rows.push({ key: key(j), date, kind: 'setting', change, fromNextPaycheck: (FROM_NEXT_PAYCHECK as readonly string[]).includes(name) });
        });
        break;
      case 'rule-added':
        rows.push({ key: key(0), date, kind: 'rule-added', rule: ruleViewOf(entry.rule), fromCorrection: false, aheadOf: null });
        break;
      case 'rule-added-from-correction': {
        const ahead = entry.aheadOf === null ? undefined : ruleAsItWas(log, i, entry.aheadOf, book.rules());
        rows.push({ key: key(0), date, kind: 'rule-added', rule: ruleViewOf(entry.rule), fromCorrection: true, aheadOf: ahead === undefined ? null : ruleViewOf(ahead) });
        break;
      }
      case 'rule-changed':
        rows.push({ key: key(0), date, kind: 'rule-changed', before: ruleViewOf(entry.before), after: ruleViewOf(entry.after) });
        break;
      case 'rule-removed':
        rows.push({ key: key(0), date, kind: 'rule-removed', rule: ruleViewOf(entry.rule) });
        break;
      case 'rule-moved':
        rows.push({ key: key(0), date, kind: 'rule-moved', rule: ruleViewOf(entry.rule), past: ruleViewOf(entry.past), direction: entry.direction, position: entry.position });
        break;
      case 'money-moved':
        rows.push({ key: key(0), date, kind: 'money-moved', from: entry.from, to: entry.to, amount: entry.amount });
        break;
      case 'bank-took-back':
        rows.push({ key: key(0), date, kind: 'bank-took-back', description: entry.description, amount: entry.amount });
        break;
    }
    rows.push(...bankRows(i + 1));
  });
  // Newest first. The log is in the order things happened, so this also puts
  // the one made last first on the same day; the lines of one change keep their order.
  const byEntry = new Map<string, LogRow[]>();
  for (const row of rows) {
    const entry = row.key.split('-')[0] ?? '';
    byEntry.set(entry, [...(byEntry.get(entry) ?? []), row]);
  }
  return [...byEntry.values()].reverse().flat();
}

function bankRow(line: BankRuleLogLine, key: string): LogRow {
  if (line.action === 'moved-up' || line.action === 'moved-down') {
    return { key, date: line.date, kind: 'bank-rule-moved', direction: line.action === 'moved-up' ? 'up' : 'down', rule: line.rule, past: line.past, position: line.position };
  }
  if (line.action === 'changed' && line.before !== null) return { key, date: line.date, kind: 'bank-rule-changed', before: line.before, after: line.rule };
  return { key, date: line.date, kind: line.action === 'removed' ? 'bank-rule-removed' : 'bank-rule-added', rule: line.rule };
}

function serverRow(line: ServerLogLine, key: string): LogRow {
  switch (line.action) {
    case 'history-retotaled': {
      const first = line.events[0];
      const before = first?.before ?? null;
      const after = first?.after ?? null;
      const was = before as HerTotals | null;
      const now = after as HerTotals | null;
      const changes = was === null || now === null ? [] : (Object.keys(now) as (keyof HerTotals)[]).filter((name) => was[name] !== now[name]).map((name) => ({ name, before: was[name] ?? 0, after: now[name] ?? 0 }));
      return { key, date: line.date, kind: 'history-retotaled', from: { date: line.from.date, what: line.from.what }, events: line.events.length, changes };
    }
    case 'stay-logged-in-changed':
    case 'sync-every-changed':
      return { key, date: line.date, kind: line.action, before: line.before, after: line.after };
    case 'notifications-stopped':
      return { key, date: line.date, kind: line.action, device: line.device, why: line.why };
    case 'bank-connected':
      return { key, date: line.date, kind: line.action, bank: line.bank };
    case 'bank-accounts':
      return { key, date: line.date, kind: line.action, accounts: line.accounts };
    case 'bank-logged-in-again':
      return { key, date: line.date, kind: line.action };
    case 'setup-day':
      return { key, date: line.date, kind: line.action, rules: line.rules.map(ruleViewOf), paycheckRule: line.paycheckRule };
    default:
      return { key, date: line.date, kind: line.action, device: line.device };
  }
}

// A rule as it was when the log line at index `at` was written: the last
// version of it the log shows by then; else, for a rule he had from the
// start, the first version the log shows after it; else the rule as it is now.
function ruleAsItWas(log: readonly ChangeLogEntry[], at: number, id: string, rules: readonly SortingRule[]): SortingRule | undefined {
  const versionIn = (entry: ChangeLogEntry, side: 'then' | 'first'): SortingRule | undefined => {
    switch (entry.kind) {
      case 'rule-added':
      case 'rule-added-from-correction':
      case 'rule-removed':
        return entry.rule.id === id ? entry.rule : undefined;
      case 'rule-changed':
        if (entry.after.id !== id) return undefined;
        return side === 'then' ? entry.after : entry.before;
      case 'rule-moved':
        return entry.rule.id === id ? entry.rule : entry.past.id === id ? entry.past : undefined;
      default:
        return undefined;
    }
  };
  for (let i = at - 1; i >= 0; i -= 1) {
    const found = versionIn(log[i] as ChangeLogEntry, 'then');
    if (found !== undefined) return found;
  }
  for (let i = at + 1; i < log.length; i += 1) {
    const found = versionIn(log[i] as ChangeLogEntry, 'first');
    if (found !== undefined) return found;
  }
  return rules.find((r) => r.id === id);
}

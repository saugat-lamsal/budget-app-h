import type { AccountId, Cents, IsoDate, PaySchedule, SelfCheck, StartingPots } from '@budget-app/money';
import type { BankRule } from '../bank/reading.js';
import type { SuggestionLine } from './bank-rules.js';

export type { BankRule } from '../bank/reading.js';

// What the Setup day screens show (rulebook section 14), worked out on the
// server from the bank history and his answers so far. The screens only
// format it: every number here comes from the money math, in whole cents.

export type SetupView =
  // Setup day is done: Home has the numbers.
  | { readonly state: 'tracking'; readonly madeUpData: boolean }
  // Not set up, and setup day cannot be done yet. why says what it waits for.
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean; readonly ready: false; readonly why: string }
  | SetupReadyView;

// One account on setup day (14.1, 12.1).
export interface AccountLine {
  // What the bank shows, posted: what it holds, or for a card what it owes.
  readonly posted: Cents;
  // Its charges still pending, added up.
  readonly pending: Cents;
  // With them: what counts (12.1, A10).
  readonly withPending: Cents;
}

export interface PendingChargeLine {
  readonly id: string;
  readonly account: AccountId;
  readonly date: IsoDate;
  readonly description: string;
  readonly amount: Cents;
}

// A transfer with only one half showing (B48, B64).
export interface HalfLine {
  readonly id: string;
  // left: money that left checking or savings and has not arrived yet.
  // arrived: money that arrived before it shows leaving.
  readonly kind: 'left' | 'arrived';
  readonly from: 'checking' | 'savings';
  readonly to: AccountId;
  readonly date: IsoDate;
  readonly description: string;
  readonly amount: Cents;
  // What saying it is on its way does to the starting money: plus what
  // left, minus what arrived first, nothing for the old card (12.4).
  readonly effect: Cents;
  // The bank rule that read it as a transfer (section 2).
  readonly rule: BankRule | null;
  // His answer: on its way, not, or not answered yet (null).
  readonly onItsWay: boolean | null;
}

// What still stops tracking from starting, in the order of the steps.
export type SetupMissing = 'suggestions' | 'halves' | 'last-paycheck' | 'assignment';

export interface SetupReadyView {
  readonly state: 'not-set-up';
  readonly madeUpData: boolean;
  readonly ready: true;
  readonly today: IsoDate;
  // Step 1, 14.1: what the bank shows today.
  readonly checking: AccountLine;
  readonly savings: AccountLine;
  readonly everydayCard: AccountLine;
  // Her second card; not there in upstream's setup.
  readonly secondCard?: AccountLine;
  readonly pendingCharges: readonly PendingChargeLine[];
  // 12.4: the old card, apart. Its pending charges are debt too (A10).
  readonly oldCard: { readonly posted: Cents; readonly pending: Cents; readonly debt: Cents };
  // 12.1: checking + savings - everyday card (and her second card), pending charges included.
  readonly bankSide: Cents;
  // Step 2, 20a: bank rules suggested from the bank's labels, with his
  // answers, and how many still wait for one.
  readonly suggestions: readonly SuggestionLine[];
  readonly unansweredSuggestions: number;
  // Step 3, B48: halves of transfers from the last halvesWithinDays days.
  readonly halves: readonly HalfLine[];
  readonly halvesWithinDays: number;
  readonly unanswered: number;
  // 12.5: what the halves he says are on their way add, in all.
  readonly inTransit: Cents;
  // 14.2: the bank side plus what is on its way.
  readonly startingMoney: Cents;
  // Step 4, B42: his last paycheck, and the payday it gives (11.2).
  readonly lastPaycheck: { readonly date: IsoDate; readonly nextPayday: IsoDate; readonly daysToPayday: number } | null;
  readonly paySchedule: PaySchedule;
  readonly payScheduleDays: number;
  // Step 5, 14.2: what he has given each bucket, and what is left.
  readonly assignment: StartingPots;
  readonly assigned: Cents;
  readonly leftToAssign: Cents;
  // Step 6, 14.3.
  readonly missing: readonly SetupMissing[];
  // The self-check tracking would start with; null until nothing is missing.
  readonly selfCheck: SelfCheck | null;
  // Section 2: the bank rules that read the history, as they are now (24c).
  readonly bankRules: readonly BankRule[];
  // Names exactly this last look. His yes to starting carries it.
  readonly key: string;
}

import { assertCents, bucketLevel, cardDue, matchesTextRule, type BankBalances, type Book, type BucketLevel, type CardStatement, type Cents, type IsoDate, type SelfCheck, type TextRule } from '@budget-app/money';
import { usuallyPostsWithin, type PostingExample } from '../bank/posting-times.js';
import { onItsWayToSavings } from './payday.js';

// What the Home screen shows, worked out on the server from the book. The
// screen only formats it: every number here comes from the money math, in
// whole cents, and is sent to the phone as JSON.

export interface HomeInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  // Today's balances as the bank reports them, pending charges included
  // (12.1). Null when the bank could not be read.
  readonly bank: BankBalances | null;
  // 10.5: the bank connection needs him to log in again.
  readonly needsLogin: boolean;
  // The latest statement of each card, for the card reminders (section 9).
  readonly statements: readonly CardStatement[];
  // 9.8 (A52): the cards whose statement the bank sent but the app cannot
  // read, so their reminders are off. None when left out (the demo).
  readonly cardsOff?: readonly CardRemindersOff[];
  // True only for the demo's made-up numbers, so the screen can say so.
  readonly madeUpData: boolean;
  // 10.6: the take-backs he has marked as seen, by the id in the change log.
  // Until then each stays in Needs attention (QUESTIONS.md B84).
  readonly seenTakeBacks: ReadonlySet<string>;
  // 0.5: the last safe to spend that the self-check backed up, and when, as
  // an ISO time with its offset. Shown greyed while the bank cannot be read
  // (QUESTIONS.md B82). Null if there has not been one.
  readonly lastChecked: LastChecked | null;
  // Step 3: when the bank was last read, as a time with its offset in his
  // home time zone, and that zone, for "Checked at". Null before the first read.
  readonly checkedAt?: CheckedAt | null;
  // 10.4 (A47): the difference with the bank is younger than the setting's
  // hours, so the bank is still catching up. False when not known.
  readonly catchingUp?: boolean;
  // docs/later.txt 18, "why it doesn't match": each account as the bank
  // shows it, and when the difference began. Null when not known (the demo).
  readonly bankDetail?: BankDetail | null;
  // 11.4 (A56): money still pending into checking or savings, as the bank
  // last showed it. None when the bank cannot be read, or left out.
  readonly pendingIn?: readonly PendingMoneyIn[];
  // 11.4 (A57): earlier deposits the app saw go from pending to posted, for
  // "usually posts within". None when left out.
  readonly postingExamples?: readonly PostingExample[];
}

// 11.4: a deposit still pending at the bank, which the books count only
// once it posts (12.1). The amount is above zero.
export interface PendingMoneyIn {
  readonly account: 'checking' | 'savings';
  readonly amount: Cents;
  readonly date: IsoDate;
  readonly description: string;
  // 11.4 (A57): when the app first saw it pending, as a time with its offset
  // in his home time zone; null or left out when that is not known.
  readonly firstSeen?: string | null;
}

// 11.4: what Home shows of it: paycheck when the paycheck rule matches it;
// since when it has been pending; and, with at least 3 earlier ones of its
// kind on its account, how long they usually took to post (null otherwise).
export interface OnItsWayIn {
  readonly account: 'checking' | 'savings';
  readonly amount: Cents;
  readonly date: IsoDate;
  readonly paycheck: boolean;
  // When the app first saw it pending (a time with its offset in his home
  // time zone), or, when that is not known, the day the bank dated it.
  readonly since: { readonly at: string } | { readonly day: IsoDate };
  readonly usually: UsuallyPosts | null;
}

// 11.4 (A57): "Usually posts within 9 hours": never a promise.
export interface UsuallyPosts {
  readonly within: number;
  readonly unit: 'hours' | 'days';
}

// Each account as the bank gave it: posted, available (null when the bank
// gave none), and what the daily check counts for it (12.1). And when the
// difference began, as a time with its offset in his home time zone, and why.
export interface BankDetail {
  readonly accounts: readonly BankAccountFigures[];
  readonly since: string | null;
  // 12.6 (A57): why, in lines that add up to the difference.
  readonly why: readonly WhyLine[];
}

// 12.6 (A57): why the totals do not match, in lines that add up to the
// difference exactly. amount is each line's part of the difference (12.3:
// the bank side plus money in transit, minus the app side), in cents: above
// zero, the bank shows more than the buckets. Descriptions are the bank's own
// words. The lines only explain: nothing is changed by them.
export type WhyLine =
  // On an account the check reads from its posted balance (the everyday
  // card; checking or savings when the bank gives no available balance): the
  // bank posted a pending item Plaid still lists. A charge is counted twice
  // for now; anything else (money in, a transfer) only once Plaid says it posted.
  | { readonly kind: 'posted-still-pending'; readonly account: WhyAccount; readonly description: string; readonly charge: boolean; readonly amount: Cents }
  // Checking or savings: a pending item Plaid lists that the available balance does not show yet.
  | { readonly kind: 'not-in-available-yet'; readonly account: 'checking' | 'savings'; readonly description: string; readonly amount: Cents }
  // Checking or savings: a pending item whose amount Plaid changed while the
  // available balance still has the old one. was and now are its amounts, above zero.
  | { readonly kind: 'amount-changed'; readonly account: 'checking' | 'savings'; readonly description: string; readonly was: Cents; readonly now: Cents; readonly amount: Cents }
  // Checking or savings: it posted while Plaid still lists the pending one too.
  | { readonly kind: 'posted-and-pending'; readonly account: 'checking' | 'savings'; readonly description: string; readonly amount: Cents }
  // What is left of an account's move: its balance (the available one, or
  // the posted one) went up or down by this much with no transaction from the
  // bank yet. A card's balance going up is the bank side going down.
  | { readonly kind: 'balance-moved'; readonly account: WhyAccount; readonly balance: 'available' | 'posted'; readonly went: 'up' | 'down'; readonly by: Cents; readonly amount: Cents }
  // What the bank's balances and transactions do not account for.
  | { readonly kind: 'rest'; readonly amount: Cents }
  // No earlier read of the bank that matched is kept to compare with.
  | { readonly kind: 'no-match-kept'; readonly amount: Cents };

export type WhyAccount = 'checking' | 'savings' | 'everyday-card';

export interface BankAccountFigures {
  readonly account: 'checking' | 'savings' | 'everyday-card';
  readonly posted: Cents;
  readonly available: Cents | null;
  readonly counted: Cents;
}

// 9.8 (A52, A53): a card whose reminders are off, and why: the bank sent no
// statement date and the statement closing day is not set for it
// (section 2), or the statement cannot be read for another reason.
export interface CardRemindersOff {
  readonly card: 'everyday-card' | 'old-card';
  readonly why: 'no-statement-date' | 'unreadable';
}

export interface CheckedAt {
  readonly at: string;
  readonly timeZone: string;
}

export interface LastChecked {
  readonly amount: Cents;
  readonly at: string;
}

export type HomeView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      readonly safeToSpend: SafeToSpendView;
      // 11.2: negative days when the paycheck is late (B35). periodStart is the
      // day the current pay period began (the ring on Home, redesign PR 2).
      readonly payday: { readonly next: IsoDate; readonly days: number; readonly periodStart: IsoDate };
      // Most urgent first.
      readonly attention: readonly Attention[];
      readonly buckets: { readonly needs: BucketBar; readonly wants: BucketBar };
      // Everything waiting in review (B32), for the Review tab's badge.
      readonly waitingInReview: number;
      // Step 3: "Checked at", when the bank was last read; null before the first read.
      readonly checkedAt: CheckedAt | null;
      // His home time zone (section 2): the times on Home are shown in it.
      readonly timeZone: string;
      // 11.4: money still pending in, oldest first, checking before savings
      // on the same day. Counted nowhere until it posts.
      readonly onItsWayIn: readonly OnItsWayIn[];
    };

export type SafeToSpendView =
  // 11.1: wants left, minus unsorted spending.
  | { readonly shown: true; readonly amount: Cents }
  // 0.5: the totals do not match the bank, so the number is held back and
  // the self-check is shown instead (12.3, B37).
  // 10.4 (A47): catchingUp while the difference is younger than the
  // setting's hours: the screen says the bank is still catching up.
  | { readonly shown: false; readonly why: 'totals-do-not-match'; readonly check: SelfCheck; readonly catchingUp: boolean; readonly detail: BankDetail | null }
  // The bank could not be read, so today's number cannot be checked. The
  // last one that was checked is shown greyed, with when (B82).
  | { readonly shown: false; readonly why: 'bank-not-read'; readonly lastChecked: LastChecked | null };

export interface BucketBar {
  readonly left: Cents;
  // 10.1: what the bucket started this pay period with.
  readonly startedWith: Cents;
  readonly level: BucketLevel;
}

export type Attention =
  // 10.5
  | { readonly kind: 'bank-login' }
  // 9.4: the due date passed with less than the minimum paid.
  | { readonly kind: 'card-overdue'; readonly card: 'everyday-card' | 'old-card'; readonly dueDate: IsoDate; readonly minimumPayment: Cents }
  // 9.8 (A52): no reminders, no due line and no overdue alert for this card
  // until its statement can be read.
  | ({ readonly kind: 'card-reminders-off' } & CardRemindersOff)
  // 10.6: the bank took back a transaction the app had counted (4.10). It
  // stays until he marks it seen (B84). id is the change log's.
  | { readonly kind: 'bank-took-back'; readonly id: string; readonly date: IsoDate; readonly description: string; readonly amount: Cents }
  // 10.3: something waits in review. heldBack is the unsorted spending kept
  // out of safe to spend (4.3).
  | { readonly kind: 'review'; readonly waiting: number; readonly heldBack: Cents }
  // Section 2, after setup day: the rules he has not set yet, for Settings.
  // Until the paycheck rule is set no paycheck splits by itself, and until
  // the mom rule is set no payment to mom comes out of the reserve.
  | { readonly kind: 'still-to-set'; readonly settings: readonly ('paycheckRule' | 'momRule')[] }
  // 3.8: money still to move into the savings account.
  | {
      readonly kind: 'move-to-savings';
      readonly stillToMove: Cents;
      readonly shouldBeInSavings: Cents;
      readonly savingsAccountBalance: Cents;
      // B46: already on its way to the account, which counts as moved.
      readonly onItsWay: Cents;
    }
  // 9.1, 9.6: the everyday card is due, from the first reminder day until paid.
  | {
      readonly kind: 'card-due';
      readonly card: 'everyday-card';
      readonly dueDate: IsoDate;
      readonly daysLeft: number;
      readonly statementBalance: Cents;
      readonly minimumPayment: Cents;
    }
  // 9.2, 9.6: the old card is due, from the first reminder day until paid.
  | { readonly kind: 'card-due'; readonly card: 'old-card'; readonly dueDate: IsoDate; readonly daysLeft: number; readonly minimumPayment: Cents };

export function homeView(input: HomeInput): HomeView {
  const { today, book, bank, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };

  const settings = book.settings();
  const pots = book.pots();
  const started = book.startedPeriodWith();
  const bar = (left: Cents, startedWith: Cents): BucketBar => ({ left, startedWith, level: bucketLevel(left, startedWith, settings.lowBucketAlertPercent) });

  const plain = book.safeToSpend(today);
  let safeToSpend: SafeToSpendView;
  if (bank === null) safeToSpend = { shown: false, why: 'bank-not-read', lastChecked: checkedLastChecked(input.lastChecked) };
  else {
    // 0.5: only a number the self-check backs up is shown.
    const checked = book.checkedSafeToSpend(today, bank);
    safeToSpend = checked.ok ? { shown: true, amount: checked.safeToSpend.amount } : { shown: false, why: 'totals-do-not-match', check: book.selfCheck(bank), catchingUp: input.catchingUp ?? false, detail: input.bankDetail ?? null };
  }

  const cards = input.statements.flatMap((statement) => cardDue(today, statement, book.cardPayments(statement.card), settings) ?? []);
  const attention: Attention[] = [];
  if (input.needsLogin) attention.push({ kind: 'bank-login' });
  for (const c of cards) {
    if (c.kind === 'overdue') attention.push({ kind: 'card-overdue', card: c.card, dueDate: c.dueDate, minimumPayment: c.minimumPayment });
  }
  for (const off of input.cardsOff ?? []) attention.push({ kind: 'card-reminders-off', card: off.card, why: off.why });
  // 10.6: each take-back in the change log, oldest first, until seen (B84).
  for (const entry of book.changeLog()) {
    if (entry.kind === 'bank-took-back' && !input.seenTakeBacks.has(entry.id)) {
      attention.push({ kind: 'bank-took-back', id: entry.id, date: entry.date, description: entry.description, amount: entry.amount });
    }
  }
  const waitingInReview = book.reviewItems().length;
  if (waitingInReview > 0) attention.push({ kind: 'review', waiting: waitingInReview, heldBack: pots.unsortedOut });
  // With the mom reserve off there is no mom rule to set ("Off in this setup").
  const stillToSet = (['paycheckRule', 'momRule'] as const).filter((key) => settings[key] === null && !(key === 'momRule' && book.switches().momReserve === 'off'));
  if (stillToSet.length > 0) attention.push({ kind: 'still-to-set', settings: stillToSet });
  if (bank !== null) {
    const move = book.savingsTransfer(bank.savings);
    if (move.stillToMove > 0) {
      attention.push({
        kind: 'move-to-savings',
        stillToMove: move.stillToMove,
        shouldBeInSavings: move.shouldBeInSavings,
        savingsAccountBalance: move.savingsAccountBalance,
        onItsWay: onItsWayToSavings(book),
      });
    }
  }
  // 9.6: a card is due from the first reminder day until it is paid (A17).
  for (const c of cards) {
    if (c.kind !== 'due') continue;
    attention.push(
      c.card === 'everyday-card'
        ? { kind: 'card-due', card: c.card, dueDate: c.dueDate, daysLeft: c.daysLeft, statementBalance: c.statementBalance, minimumPayment: c.minimumPayment }
        : { kind: 'card-due', card: c.card, dueDate: c.dueDate, daysLeft: c.daysLeft, minimumPayment: c.minimumPayment },
    );
  }

  return {
    state: 'tracking',
    madeUpData,
    today,
    safeToSpend,
    payday: { next: plain.nextPayday, days: plain.daysToPayday, periodStart: book.period().startDate },
    attention,
    buckets: { needs: bar(pots.needs, started.needs), wants: bar(pots.wants, started.wants) },
    waitingInReview,
    checkedAt: checkedCheckedAt(input.checkedAt ?? null),
    timeZone: settings.homeTimeZone,
    onItsWayIn: onItsWayIn(input.pendingIn ?? [], settings.paycheckRule, input.postingExamples ?? []),
  };
}

// 11.4: "Paycheck on its way" when the paycheck rule matches it (3.1). A57:
// pending since when the app first saw it, and how long earlier ones of the
// same kind (a paycheck, or other money in, by the paycheck rule now) on the
// same account usually took to post.
function onItsWayIn(pending: readonly PendingMoneyIn[], paycheckRule: TextRule | null, examples: readonly PostingExample[]): OnItsWayIn[] {
  const order = (p: PendingMoneyIn): string => `${p.date} ${p.account === 'checking' ? 0 : 1}`;
  return [...pending]
    .sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0))
    .map((p) => {
      assertCents(p.amount, 'money on its way in');
      const paycheck = matchesTextRule(paycheckRule, p.description);
      const firstSeen = p.firstSeen ?? null;
      if (firstSeen !== null && (!ISO_TIME.test(firstSeen) || Number.isNaN(Date.parse(firstSeen)))) throw new Error(`not a time with its offset: ${firstSeen}`);
      const alike = examples.filter((e) => e.account === p.account && matchesTextRule(paycheckRule, e.description) === paycheck);
      return { account: p.account, amount: p.amount, date: p.date, paycheck, since: firstSeen === null ? { day: p.date } : { at: firstSeen }, usually: usuallyPostsWithin(alike) };
    });
}

// An ISO time with its offset, such as 2026-10-07T07:15:00-05:00.
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function checkedCheckedAt(checked: CheckedAt | null): CheckedAt | null {
  if (checked === null) return null;
  if (!ISO_TIME.test(checked.at) || Number.isNaN(Date.parse(checked.at))) throw new Error(`not a time with its offset: ${checked.at}`);
  return { at: checked.at, timeZone: checked.timeZone };
}

function checkedLastChecked(last: LastChecked | null): LastChecked | null {
  if (last === null) return null;
  assertCents(last.amount, 'last checked safe to spend');
  if (!ISO_TIME.test(last.at) || Number.isNaN(Date.parse(last.at))) throw new Error(`not a time with its offset: ${last.at}`);
  return { amount: last.amount, at: last.at };
}

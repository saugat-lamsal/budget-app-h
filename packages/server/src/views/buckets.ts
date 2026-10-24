import { bucketLevel, monthOf, type BankBalances, type Book, type Cents, type InTransitItem, type IsoDate, type OthersMoney } from '@budget-app/money';
import type { BucketBar, WhyLine } from './home.js';

// What the Buckets screen shows, worked out on the server from the book. The
// screen only formats it: every number here comes from the money math, in
// whole cents, and is sent to the phone as JSON.

export interface BucketsInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  // Today's balances as the bank reports them, pending charges included
  // (12.1). Null when the bank could not be read.
  readonly bank: BankBalances | null;
  readonly madeUpData: boolean;
  // 10.4 (A47): the difference with the bank is younger than the setting's hours.
  readonly catchingUp?: boolean;
  // 12.6 (A57): why the totals do not match; null when not known (the bank cannot be read).
  readonly why?: readonly WhyLine[] | null;
}

export type BucketsView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      // 12.2: everything in the buckets, which the bank side must equal.
      readonly total: Cents;
      // 0.5: Buckets says so too when the totals do not match the bank.
      readonly check: BankCheck;
      readonly needs: BucketBar;
      readonly wants: BucketBar;
      readonly savings: Cents;
      // Her rulebook, section 2: the Wishlist bucket, only where the setup has it.
      readonly wishlist?: Cents;
      readonly momReserve: MomReserveView;
      // 7.3
      readonly heldForOthers: OthersMoney;
      // 4.3, 12.2: deposits, refunds and spending waiting in review.
      readonly waiting: { readonly count: number; readonly moneyIn: Cents; readonly spending: Cents };
      // 12.4: tracked on its own, not part of the total. Negative is a credit (B14).
      readonly oldCard: Cents;
      // 12.5, B44: every transfer with one side showing. What the self-check
      // counts, and each one; one to the old card is listed but not counted (12.4).
      readonly onItsWay: { readonly counted: Cents; readonly items: readonly OnItsWay[] };
    };

// 0.5, 12.3: whether the totals match the bank, for Buckets and Trends (40.9).
export type BankCheck =
  | { readonly state: 'matches' }
  | { readonly state: 'does-not-match'; readonly difference: Cents; readonly catchingUp: boolean; readonly why: readonly WhyLine[] | null }
  | { readonly state: 'bank-not-read' };

export function bankCheckOf(book: Book, bank: BankBalances | null, catchingUp: boolean, why: readonly WhyLine[] | null): BankCheck {
  if (bank === null) return { state: 'bank-not-read' };
  const self = book.selfCheck(bank);
  return self.ok ? { state: 'matches' } : { state: 'does-not-match', difference: self.difference, catchingUp, why };
}

export interface OnItsWay extends InTransitItem {
  // Counted in the self-check: false only for money on its way to the old card.
  readonly counted: boolean;
}

export interface MomReserveView {
  // What the reserve holds.
  readonly amount: Cents;
  // 8.2: this calendar month ("YYYY-MM"), what was sent, and the target.
  readonly month: string;
  readonly sent: Cents;
  readonly target: { readonly low: Cents; readonly high: Cents };
  // Against the target: under the low end, within it (the ends included), or over the high end.
  readonly position: 'under' | 'within' | 'over';
}

export function bucketsView(input: BucketsInput): BucketsView {
  const { today, book, bank, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };

  const settings = book.settings();
  const pots = book.pots();
  const started = book.startedPeriodWith();
  const bar = (left: Cents, startedWith: Cents): BucketBar => ({ left, startedWith, level: bucketLevel(left, startedWith, settings.lowBucketAlertPercent) });

  const check = bankCheckOf(book, bank, input.catchingUp ?? false, input.why ?? null);

  const month = book.momSentInMonth(monthOf(today));
  const position = month.sent < month.target.low ? 'under' : month.sent > month.target.high ? 'over' : 'within';

  return {
    state: 'tracking',
    madeUpData,
    today,
    total: book.appSide(),
    check,
    needs: bar(pots.needs, started.needs),
    wants: bar(pots.wants, started.wants),
    savings: pots.savings,
    ...(pots.wishlist === undefined ? {} : { wishlist: pots.wishlist }),
    momReserve: { amount: pots.momReserve, month: month.month, sent: month.sent, target: month.target, position },
    heldForOthers: book.othersMoney(),
    waiting: { count: book.reviewItems().length, moneyIn: pots.unsortedIn, spending: pots.unsortedOut },
    oldCard: book.oldCardDebt(),
    onItsWay: onItsWayOf(book),
  };
}

export function onItsWayOf(book: Book): { readonly counted: Cents; readonly items: readonly OnItsWay[] } {
  const transit = book.inTransit();
  return { counted: transit.total, items: transit.items.map((item) => ({ ...item, counted: item.to !== 'old-card' })) };
}

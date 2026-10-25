import type { Cents, IsoDate } from '@budget-app/money';
import { ACCOUNT_IDS, type FakePlaid } from '../../../../server/test/fake-plaid.js';

// PR 12, the end check: one full pay period of hers, at her two made-up
// banks, for the agent that uses her screens like a person
// (agent-pay-period-h/, npm run pay-period-agent-her). Setup day on Thu
// Oct 1, 2026; her last paycheck before it on Sep 18; a paycheck on Oct 2,
// waiting for her yes until Oct 3, and the next one on Oct 16, the last day.
// agent-pay-period-h/script.txt says the same days in words, for the agent.
// Every name and number is made up.
//
// What it has in it, day by day:
// Oct 1  setup day: a grocer charge pending on the Capital One card (in the
//        code, the everyday card), a payment on its way from checking to the
//        Amex card (the second card, at the second bank), each card's last
//        statement. Her split with Wishlist, three Wishlist items, the
//        paycheck rule, two sorting rules.
// Oct 2  the paycheck, waiting for her yes (3.1, 51.1); the payment lands.
// Oct 3  her yes, a day late (B53); the payday questions (3.4); a cafe charge
//        posts with a tip (4.6); she moves money to savings at the bank (3.8).
// Oct 4  a split purchase (4.4); the debit card.
// Oct 5  a Wishlist purchase on the Amex card, for less than the item's price
//        (50.3, 60a); 50.4's move; a payment to a person split with "not
//        mine" (7.6).
// Oct 6  a pending debit card charge, sorted while pending.
// Oct 7  the Amex bank wants a new login (0.5, 10.5); a charge waits there.
// Oct 8  the Amex bank read again; its new statement (52.4, 52.5); she moves
//        the Wishlist money from savings to checking (50.4).
// Oct 9  the Capital One card paid in full, on its way (9.3, 12.5); a new
//        split for the next paycheck (13.1); a Wishlist item added and moved.
// Oct 10 the payment lands; part of the split purchase refunded (4.5).
// Oct 11 the friend pays back the part that was not hers (7.1 to 7.3).
// Oct 12 a Wishlist purchase at the item's price; a hand move (13.3).
// Oct 13 the Amex card's first reminder day (9.6, 52.1); part of it paid.
// Oct 14 that payment lands; other income (6.1).
// Oct 15 the rest of the Amex statement paid; the lamp's Wishlist money moved.
// Oct 16 the next paycheck, with the new split; her yes the same day.

const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;
const CAP1 = ACCOUNT_IDS.everyday;
const AMEX = ACCOUNT_IDS.second;

// What the banks show as posted once the history below is in: checking,
// savings, and what each card owes.
export const POSTED_ON_SETUP_DAY = { checking: 184_025, savings: 430_000, capitalOne: 31_240, amex: 18_675 } as const;

export const SETUP_DAY: IsoDate = '2026-10-01';
export const LAST_DAY: IsoDate = '2026-10-16';

interface Posting {
  readonly id: string;
  readonly account: string;
  // Plaid's sign: positive is money out of the account (a purchase on a card).
  readonly amount: Cents;
  readonly date: IsoDate;
  readonly description: string;
}

// The 90 days the banks send at connection that are posted (section 2).
const HISTORY: readonly Posting[] = [
  { id: 'hist-grocer', account: CAP1, amount: 5_520, date: '2026-09-12', description: 'MADE UP GROCER' },
  { id: 'hist-books', account: AMEX, amount: 1_800, date: '2026-09-15', description: 'MADE UP BOOKSHOP' },
  { id: 'pay-0918', account: C, amount: -260_000, date: '2026-09-18', description: 'MADEUP CORP PAYROLL' },
  { id: 'hist-cafe', account: CAP1, amount: 475, date: '2026-09-20', description: 'MADE UP CAFE' },
  { id: 'hist-pharmacy', account: AMEX, amount: 6_875, date: '2026-09-22', description: 'MADE UP PHARMACY' },
  // Sep 30: the Amex card's statement paid from checking; it lands Oct 2.
  { id: 'amex-pay-0930', account: C, amount: 10_000, date: '2026-09-30', description: 'payment to CRD 5555' },
];

// Each account's posted balance before the history, so that it is
// POSTED_ON_SETUP_DAY after it (a card owes more for each purchase).
export function postedBeforeHistory(): { checking: Cents; savings: Cents; capitalOne: Cents; amex: Cents } {
  const moved = (account: string, card: boolean): Cents => HISTORY.filter((p) => p.account === account).reduce((sum, p) => sum + (card ? p.amount : -p.amount), 0);
  return {
    checking: POSTED_ON_SETUP_DAY.checking - moved(C, false),
    savings: POSTED_ON_SETUP_DAY.savings - moved(S, false),
    capitalOne: POSTED_ON_SETUP_DAY.capitalOne - moved(CAP1, true),
    amex: POSTED_ON_SETUP_DAY.amex - moved(AMEX, true),
  };
}

// Plaid's statement fields for a card (Liabilities), in dollars.
const statement = (issued: IsoDate, balance: number, minimum: number, due: IsoDate, lastPaid: { amount: number; date: IsoDate }) => ({
  is_overdue: false,
  last_payment_amount: lastPaid.amount,
  last_payment_date: lastPaid.date,
  last_statement_issue_date: issued,
  last_statement_balance: balance,
  minimum_payment_amount: minimum,
  next_payment_due_date: due,
});

// The history, at both banks as one (harness.ts bothBanks).
export function history(bank: FakePlaid): void {
  for (const p of HISTORY) bank.addPosted(p);
  bank.addPending({ id: 'grocer-p', account: CAP1, amount: 4_218, date: '2026-09-30', description: 'MADE UP GROCER' });
  // The Capital One card's statement closed Sep 28 at what it owes; the Amex
  // card's closed Sep 6 at $100.00, paid by the payment on its way.
  bank.setStatement(CAP1, statement('2026-09-28', 312.4, 25, '2026-10-23', { amount: 280, date: '2026-09-20' }));
  bank.setStatement(AMEX, statement('2026-09-06', 100, 25, '2026-10-01', { amount: 95.1, date: '2026-08-28' }));
}

export interface HerDay {
  readonly date: IsoDate;
  // What the banks do that day, before 7:00 AM's read.
  readonly bank: (bank: FakePlaid) => void;
  // The second bank (the Amex card's) wants a new login that day (10.5), and
  // the next day lets the app read it again (there is no Plaid window here).
  readonly amexWantsLogin?: true;
}

const posted = (bank: FakePlaid, p: Posting): void => {
  bank.addPosted(p);
};

export const DAYS: readonly HerDay[] = [
  {
    date: '2026-10-02',
    bank: (b) => {
      b.postPending('grocer-p', { id: 'grocer', date: '2026-10-02' });
      posted(b, { id: 'amex-paid-1002', account: AMEX, amount: -10_000, date: '2026-10-02', description: 'PAYMENT - THANK YOU' });
      posted(b, { id: 'pay-1002', account: C, amount: -260_000, date: '2026-10-02', description: 'MADEUP CORP PAYROLL' });
      b.addPending({ id: 'cafe-p', account: CAP1, amount: 560, date: '2026-10-02', description: 'MADE UP CAFE' });
    },
  },
  {
    date: '2026-10-03',
    bank: (b) => {
      b.postPending('cafe-p', { id: 'cafe', date: '2026-10-03', amount: 660 });
      posted(b, { id: 'books-1003', account: AMEX, amount: 2_345, date: '2026-10-03', description: 'MADE UP BOOKSHOP' });
      posted(b, { id: 'to-sav-1003', account: C, amount: 120_000, date: '2026-10-03', description: 'transfer to SAV 2222' });
    },
  },
  {
    date: '2026-10-04',
    bank: (b) => {
      posted(b, { id: 'hardware-1004', account: CAP1, amount: 6_490, date: '2026-10-04', description: 'MADE UP HARDWARE' });
      posted(b, { id: 'pharmacy-1004', account: C, amount: 1_835, date: '2026-10-04', description: 'MADE UP PHARMACY' });
    },
  },
  {
    date: '2026-10-05',
    bank: (b) => {
      posted(b, { id: 'from-chk-1005', account: S, amount: -120_000, date: '2026-10-05', description: 'transfer from CHK 1111' });
      posted(b, { id: 'audio-1005', account: AMEX, amount: 11_499, date: '2026-10-05', description: 'MADE UP AUDIO' });
      posted(b, { id: 'zelle-1005', account: C, amount: 3_000, date: '2026-10-05', description: 'Zelle payment to MADE UP FRIEND' });
    },
  },
  {
    date: '2026-10-06',
    bank: (b) => {
      b.addPending({ id: 'gas-p', account: C, amount: 3_800, date: '2026-10-06', description: 'MADE UP GAS' });
    },
  },
  {
    date: '2026-10-07',
    bank: (b) => {
      b.postPending('gas-p', { id: 'gas', date: '2026-10-07' });
      posted(b, { id: 'cinema-1007', account: AMEX, amount: 1_600, date: '2026-10-07', description: 'MADE UP CINEMA' });
    },
    amexWantsLogin: true,
  },
  {
    date: '2026-10-08',
    bank: (b) => {
      b.setStatement(AMEX, statement('2026-10-06', 225.19, 35, '2026-10-20', { amount: 100, date: '2026-10-02' }));
      posted(b, { id: 'to-chk-1008', account: S, amount: 11_499, date: '2026-10-08', description: 'transfer to CHK 1111' });
      posted(b, { id: 'from-sav-1008', account: C, amount: -11_499, date: '2026-10-08', description: 'transfer from SAV 2222' });
    },
  },
  {
    date: '2026-10-09',
    bank: (b) => {
      posted(b, { id: 'cap1-pay-1009', account: C, amount: 31_240, date: '2026-10-09', description: 'payment to CRD 3333' });
    },
  },
  {
    date: '2026-10-10',
    bank: (b) => {
      posted(b, { id: 'cap1-paid-1010', account: CAP1, amount: -31_240, date: '2026-10-10', description: 'PAYMENT - THANK YOU' });
      posted(b, { id: 'hardware-back-1010', account: CAP1, amount: -2_490, date: '2026-10-10', description: 'MADE UP HARDWARE' });
    },
  },
  {
    date: '2026-10-11',
    bank: (b) => {
      posted(b, { id: 'friend-back-1011', account: C, amount: -1_000, date: '2026-10-11', description: 'MADE UP FRIEND PAID BACK' });
    },
  },
  {
    date: '2026-10-12',
    bank: (b) => {
      posted(b, { id: 'lamp-1012', account: AMEX, amount: 4_500, date: '2026-10-12', description: 'MADE UP LAMP SHOP' });
    },
  },
  {
    date: '2026-10-13',
    bank: (b) => {
      posted(b, { id: 'amex-pay-1013', account: C, amount: 10_000, date: '2026-10-13', description: 'payment to CRD 5555' });
    },
  },
  {
    date: '2026-10-14',
    bank: (b) => {
      posted(b, { id: 'amex-paid-1014', account: AMEX, amount: -10_000, date: '2026-10-14', description: 'PAYMENT - THANK YOU' });
      posted(b, { id: 'market-1014', account: C, amount: -4_000, date: '2026-10-14', description: 'MADE UP MARKETPLACE SALE' });
    },
  },
  {
    date: '2026-10-15',
    bank: (b) => {
      posted(b, { id: 'amex-pay-1015', account: C, amount: 12_519, date: '2026-10-15', description: 'payment to CRD 5555' });
      posted(b, { id: 'to-chk-1015', account: S, amount: 4_500, date: '2026-10-15', description: 'transfer to CHK 1111' });
      posted(b, { id: 'from-sav-1015', account: C, amount: -4_500, date: '2026-10-15', description: 'transfer from SAV 2222' });
    },
  },
  {
    date: '2026-10-16',
    bank: (b) => {
      posted(b, { id: 'amex-paid-1016', account: AMEX, amount: -12_519, date: '2026-10-16', description: 'PAYMENT - THANK YOU' });
      posted(b, { id: 'pay-1016', account: C, amount: -260_000, date: '2026-10-16', description: 'MADEUP CORP PAYROLL' });
    },
  },
];

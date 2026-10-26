import {
  HER_SETTINGS,
  HER_SWITCHES,
  EMPTY_WISHLIST,
  addCents,
  addDays,
  changeSettings,
  changeWishlist,
  openBook,
  owedAtSetup,
  subtractCents,
  type BankBalances,
  type BankTransaction,
  type Book,
  type BeforeSetupLine,
  type CardStatement,
  type Cents,
  type EverydayCard,
  type IsoDate,
  type Purchase,
  type SortingRule,
  type WishlistList,
} from '@budget-app/money';
import { checkBankRules, type BankRule } from '../bank/reading.js';
import { timeIn } from '../history/today.js';
import type { BeforeSetup, HistoryLine } from '../trends.js';
import type { HomeInput } from '../views/home.js';
import type { DemoScenario } from './scenarios.js';
import { rememberFeed } from './scenarios.js';

// Her setup's made-up lives for the demo (npm run demo, /demo, "Her setup"):
// two cards with statements, a Wishlist bucket and its list, a paycheck
// waiting for her yes, Review with Wishlist sorting, cards due and overdue,
// and one bank that cannot be read. Every name, amount and date is invented
// (the repo is public: nothing of the owner's money is here). Each is played
// through the real money math, on her switches (no mom reserve, no old card),
// and the demo never reads the database or talks to a bank.

const EMPLOYER = 'MADE UP EMPLOYER PAYROLL';
const SETUP_DAY: IsoDate = '2026-09-19';
const LAST_PAYCHECK: IsoDate = '2026-09-18';
const TIME_ZONE = 'America/New_York';

// Each card as its (made-up) bank names it (HB6).
export const HER_CARD_NAMES = Object.freeze({ 'everyday-card': 'Capital One card', 'second-card': 'Amex card' });

const RULES: readonly SortingRule[] = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'gas', for: 'purchase', contains: 'GAS STATION', bucket: 'needs' },
  { id: 'pharmacy', for: 'purchase', contains: 'PHARMACY', bucket: 'needs' },
  { id: 'coffee', for: 'purchase', contains: 'COFFEE', bucket: 'wants' },
  { id: 'restaurant', for: 'purchase', contains: 'RESTAURANT', bucket: 'wants' },
  { id: 'streaming', for: 'purchase', contains: 'STREAMING', bucket: 'wants' },
  { id: 'cinema', for: 'purchase', contains: 'CINEMA', bucket: 'wants' },
  { id: 'bookshop', for: 'purchase', contains: 'BOOKSHOP', bucket: 'wants' },
];

// How her made-up banks describe a card payment, a person and a card fee.
export const HER_BANK_RULES: readonly BankRule[] = checkBankRules([
  { id: 'bank-rule-1', account: 'checking', contains: 'PAYMENT TO CAPITAL ONE CARD', means: 'transfer', other: 'everyday-card' },
  { id: 'bank-rule-2', account: 'checking', contains: 'PAYMENT TO AMEX CARD', means: 'transfer', other: 'second-card' },
  { id: 'bank-rule-3', account: 'checking', contains: 'ZELLE TO', means: 'payment-to-person' },
  { id: 'bank-rule-4', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' },
  { id: 'bank-rule-5', account: 'second-card', contains: 'LATE FEE', means: 'card-fee' },
]);

// Her list of things, in her order (50.1). Prices in cents.
const LIST: readonly { readonly name: string; readonly price: Cents }[] = [
  { name: 'Made-up headphones', price: 24_000 },
  { name: 'Made-up jacket', price: 30_000 },
  { name: 'Made-up lamp', price: 4_500 },
  { name: 'Made-up backpack', price: 6_000 },
];

// What a card's statements look like in a life: the closing day it closes on
// and when it is due, and the statement before it (if the app saw one). The
// balances are worked out from the purchases and payments, not typed.
interface StatementPlan {
  readonly closing: IsoDate;
  readonly due: IsoDate;
  // The statement before, from before setup day; its balance is made up.
  readonly before?: { readonly closing: IsoDate; readonly due: IsoDate; readonly balance: Cents };
}

interface Plan {
  readonly today: IsoDate;
  readonly cards: Readonly<Record<EverydayCard, StatementPlan>>;
  // The earlier statement of the Capital One card paid in full, and part of the new one.
  readonly paysCapitalOne: boolean;
  // The Wishlist purchase: the plant shop, none of the things on her list, moved from
  // savings to checking at once (everyday); or the lamp on her list, not moved yet (50.4).
  readonly wishlistBuy: 'plant-moved' | 'lamp-not-moved';
  // 51.1: the paycheck of Oct 16 waits for her yes.
  readonly paycheckWaits?: true;
  // Review: purchases and money in waiting, of every kind she can see.
  readonly reviewBusy?: true;
  // 0.5: the Amex card's bank cannot be read.
  readonly amexDown?: true;
}

const EVERYDAY: Plan = {
  today: '2026-10-23',
  cards: {
    'everyday-card': { closing: '2026-10-14', due: '2026-11-08', before: { closing: '2026-09-14', due: '2026-10-09', balance: 38_600 } },
    'second-card': { closing: '2026-10-12', due: '2026-10-29', before: { closing: '2026-09-12', due: '2026-10-07', balance: 21_900 } },
  },
  paysCapitalOne: true,
  wishlistBuy: 'plant-moved',
};

const PLANS: Readonly<Record<string, Plan>> = {
  'her-everyday': EVERYDAY,
  'her-payday': { ...EVERYDAY, today: '2026-10-16', paycheckWaits: true },
  'her-review-busy': { ...EVERYDAY, reviewBusy: true },
  // The Capital One card closed Sep 28 and was due Oct 23: two days over, nothing paid.
  // The Amex card closed Oct 12 and is due Oct 29: in 2 days.
  'her-card-due': {
    today: '2026-10-27',
    cards: { 'everyday-card': { closing: '2026-09-28', due: '2026-10-23' }, 'second-card': EVERYDAY.cards['second-card'] },
    paysCapitalOne: false,
    wishlistBuy: 'lamp-not-moved',
  },
  'her-one-bank-down': { ...EVERYDAY, amexDown: true },
};

// What the card statements screen needs besides the book.
export interface HerLive {
  readonly input: HomeInput;
  // What each card owed on setup day, as setup day counted it (52.2).
  readonly atSetup: Readonly<Record<EverydayCard, Cents>>;
  // Every statement the bank sent each card, oldest first (52.5).
  readonly kept: Readonly<Record<EverydayCard, readonly CardStatement[]>>;
  // The card's purchases from before setup day that fall in a statement (52.4).
  readonly beforeSetup: Readonly<Record<EverydayCard, readonly BeforeSetupLine[]>>;
  // Her list of things, changed in review and on Wishlist's list (50.1, 50.3).
  wishlist: WishlistList;
  // Section 40: the made-up bank history from before setup day.
  readonly trends: BeforeSetup;
}

// Purchases from before setup day, already in what each card owed then.
const PRE_SETUP: Readonly<Record<EverydayCard, readonly BeforeSetupLine[]>> = {
  'everyday-card': [
    { id: 'pre-1', date: '2026-09-16', postedOn: '2026-09-16', description: 'BLUE DOOR COFFEE', amount: 575, payment: false },
    { id: 'pre-2', date: '2026-09-18', postedOn: '2026-09-18', description: 'GREEN LEAF GROCERY #12', amount: 5_240, payment: false },
  ],
  'second-card': [{ id: 'pre-3', date: '2026-09-15', postedOn: '2026-09-15', description: 'HARBOR RESTAURANT', amount: 3_850, payment: false }],
};

const KEPT_BEFORE: Readonly<Record<EverydayCard, Cents>> = { 'everyday-card': 38_600, 'second-card': 21_900 };

const CARDS: readonly EverydayCard[] = ['everyday-card', 'second-card'];

function build(plan: Plan): { life: HerLive; fed: BankTransaction[]; book: Book } {
  const { today } = plan;
  const sum = (lines: readonly BeforeSetupLine[]): Cents => lines.reduce((total, l) => total + l.amount, 0);
  // What each card owed on setup day: its Sep statement and what was bought since it closed.
  const atSetup: Record<EverydayCard, Cents> = {
    'everyday-card': KEPT_BEFORE['everyday-card'] + sum(PRE_SETUP['everyday-card']),
    'second-card': KEPT_BEFORE['second-card'] + sum(PRE_SETUP['second-card']),
  };
  // owedAtSetup (52.2) agrees: the bank's balances that day, no charge pending.
  const bankOnSetupDay: BankBalances = { checking: 0, savings: 0, everydayCard: atSetup['everyday-card'], secondCard: atSetup['second-card'] };
  for (const card of CARDS) if (owedAtSetup({ bankBalances: bankOnSetupDay, pendingCharges: [] }, card) !== atSetup[card]) throw new Error('setup day does not agree');

  const settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: EMPLOYER }, split: { savings: 40, needs: 30, wants: 20, wishlist: 10 } });
  const book = openBook({
    date: SETUP_DAY,
    pots: { savings: 300_000, needs: 180_000, wants: 45_000, wishlist: 0, momReserve: 0, heldForOthers: 0 },
    oldCardDebt: 0,
    lastPaycheckDate: LAST_PAYCHECK,
    settings,
    rules: RULES,
    switches: HER_SWITCHES,
  });
  const fed: BankTransaction[] = [];
  rememberFeed(book, fed);

  // What each card owes, day by day, so a statement's balance is the real one.
  const ledger: { readonly card: EverydayCard; readonly date: IsoDate; readonly delta: Cents }[] = [];
  const events: { readonly date: IsoDate; readonly order: number; readonly run: () => void }[] = [];
  let n = 0;
  const on = (date: IsoDate, run: () => void): void => {
    if (date <= today) events.push({ date, order: (n += 1), run });
  };
  const feed = (txn: BankTransaction): void => {
    fed.push(txn);
    book.receive(txn);
  };
  const buy = (date: IsoDate, card: EverydayCard | 'checking', amount: Cents, description: string, then?: (id: string) => void, pending = false): void => {
    const id = `her-${(n += 1)}`;
    on(date, () => {
      const txn: Purchase = { kind: 'purchase', id, account: card, date, amount, description, pending };
      feed(txn);
      if (card !== 'checking') ledger.push({ card, date, delta: amount });
      then?.(id);
    });
  };
  const pay = (date: IsoDate, card: EverydayCard, amount: Cents, name: string): void => {
    const id = `her-${(n += 1)}`;
    on(date, () => {
      feed({ kind: 'transfer', id, from: 'checking', to: card, date, amount, description: `PAYMENT TO ${name} CARD` });
      ledger.push({ card, date, delta: -amount });
    });
  };
  const paycheck = (date: IsoDate, id: string, waits: boolean): void => {
    on(date, () => {
      feed({ kind: 'deposit', id, account: 'checking', date, amount: 250_000, description: `${EMPLOYER} DIR DEP` });
      // 3.1: with "ask before splitting" on, it waits for her yes; yes splits it (6.1).
      if (!waits) {
        book.sort(id, { to: 'paycheck' }, date);
        for (const item of book.reviewItems()) if (item.type === 'leftover') book.answerLeftover(item.id, 'roll-over', date);
      }
    });
  };

  // Debit card and the Capital One card ("everyday-card"), the Amex card ("second-card").
  buy('2026-09-22', 'checking', 6_412, 'GREEN LEAF GROCERY #12');
  buy('2026-09-24', 'everyday-card', 575, 'BLUE DOOR COFFEE');
  buy('2026-09-25', 'second-card', 2_400, 'SUNSET CINEMA');
  buy('2026-09-27', 'everyday-card', 4_120, 'CORNER GAS STATION');
  buy('2026-09-30', 'second-card', 9_118, 'GREEN LEAF GROCERY #12');
  buy('2026-10-01', 'everyday-card', 1_599, 'RIVER STREAMING');
  paycheck('2026-10-02', 'her-pay-1', false);
  pay('2026-10-03', 'second-card', 21_900, 'AMEX');
  buy('2026-10-03', 'everyday-card', 2_835, 'NORTH PHARMACY');
  if (plan.paysCapitalOne) pay('2026-10-05', 'everyday-card', 38_600, 'CAPITAL ONE');
  buy('2026-10-08', 'everyday-card', 4_650, 'HARBOR RESTAURANT');
  // 4.2, 50.3: a Wishlist purchase is sorted by hand. The plant shop is none of the things on her
  // list; the lamp is one of them (item 3), and its money is moved from savings to checking at once, or not yet (50.4).
  if (plan.wishlistBuy === 'plant-moved') {
    buy('2026-10-09', 'second-card', 3_250, 'MADE UP PLANT SHOP', (id) => book.sort(id, { to: 'wishlist' }, '2026-10-09'));
    on('2026-10-10', () => feed({ kind: 'transfer', id: 'her-move-1', from: 'savings', to: 'checking', date: '2026-10-10', amount: 3_250, description: 'ONLINE TRANSFER TO CHK 1111' }));
  } else {
    buy('2026-10-09', 'second-card', 4_500, 'MADE UP LAMPS', (id) => book.sort(id, { to: 'wishlist' }, '2026-10-09'));
  }
  buy('2026-10-11', 'everyday-card', 8_730, 'GREEN LEAF GROCERY #12');
  buy('2026-10-12', 'second-card', 5_270, 'HARBOR RESTAURANT');
  buy('2026-10-13', 'everyday-card', 625, 'BLUE DOOR COFFEE');
  paycheck('2026-10-16', 'her-pay-2', plan.paycheckWaits === true);
  buy('2026-10-17', 'everyday-card', 3_980, 'CORNER GAS STATION');
  buy('2026-10-18', 'second-card', 4_410, 'CORNER GAS STATION');
  if (plan.paysCapitalOne) pay('2026-10-20', 'everyday-card', 20_000, 'CAPITAL ONE');
  buy('2026-10-21', 'everyday-card', 2_899, 'CITY BOOKSHOP');
  buy('2026-10-22', 'second-card', 1_800, 'SUNSET CINEMA');
  // Waiting in review, so the Review tab has something to sort (4.3).
  buy('2026-10-22', 'everyday-card', 1_150, 'CORNER STORE');
  if (plan.reviewBusy === true) {
    // 4.2, 50.3: a lamp that is one of her things, and a big purchase to split across three buckets (4.4).
    buy('2026-10-20', 'second-card', 4_500, 'MADE UP LAMPS');
    buy('2026-10-21', 'everyday-card', 12_000, 'BIG BOX STORE');
    // A fee on a card (4.8), a refund of part of a grocery run (4.5), a friend paying her back (6.1) and a payment to a friend (7.4).
    on('2026-10-19', () => {
      feed({ kind: 'card-charge', id: 'her-fee', account: 'second-card', date: '2026-10-19', amount: 3_500, description: 'LATE FEE', charge: 'fee' });
      ledger.push({ card: 'second-card', date: '2026-10-19', delta: 3_500 });
    });
    on('2026-10-22', () => {
      feed({ kind: 'refund', id: 'her-refund', account: 'everyday-card', date: '2026-10-22', amount: 2_317, description: 'GREEN LEAF GROCERY #12 REFUND' });
      ledger.push({ card: 'everyday-card', date: '2026-10-22', delta: -2_317 });
      feed({ kind: 'deposit', id: 'her-friend-in', account: 'checking', date: '2026-10-22', amount: 5_000, description: 'ZELLE FROM MADE UP FRIEND' });
      feed({ kind: 'payment-to-person', id: 'her-friend-out', account: 'checking', date: '2026-10-22', amount: 4_000, description: 'ZELLE TO MADE UP FRIEND' });
    });
  }
  // Today's coffee, still pending on each card (the bank counts it in what the card owes).
  buy(today, 'everyday-card', 475, 'BLUE DOOR COFFEE', undefined, true);
  buy(today, 'second-card', 425, 'BLUE DOOR COFFEE', undefined, true);

  // The day's events in order of their day, then the order they were made.
  const order = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
  // The last good read of the bank was this morning, before the last coffee.
  for (const event of order) event.run();
  const checkedThisMorning = addCents(book.safeToSpend(today).amount, 475 + 425);

  // Each card's statements, their balances worked out from the ledger.
  const owedOn = (card: EverydayCard, day: IsoDate): Cents => addCents(atSetup[card], ...ledger.filter((l) => l.card === card && l.date <= day).map((l) => l.delta));
  const statementOf = (card: EverydayCard, spec: { readonly closing: IsoDate; readonly due: IsoDate }, balance: Cents): CardStatement => ({ card, closingDate: spec.closing, dueDate: spec.due, statementBalance: balance, minimumPayment: 3_500 });
  const kept = Object.fromEntries(
    CARDS.map((card) => {
      const spec = plan.cards[card];
      const list = [...(spec.before === undefined ? [] : [statementOf(card, spec.before, spec.before.balance)]), statementOf(card, spec, owedOn(card, spec.closing))];
      return [card, list];
    }),
  ) as Record<EverydayCard, CardStatement[]>;

  // The bank's balances, made up to agree with the book (12.1): each card owes what the app counts;
  // savings holds what it should (3.8), with the Wishlist money not moved yet (50.4); checking is the rest.
  const owes = Object.fromEntries(CARDS.map((card) => [card, owedOn(card, today)])) as Record<EverydayCard, Cents>;
  const flows = book.wishlistFlows();
  const notMoved = Math.max(0, flows.purchases.reduce((t, p) => t + p.amount, 0) - flows.paidBack - flows.movedToChecking);
  const savings = addCents(book.savingsTransfer(0).shouldBeInSavings, notMoved);
  const pots = book.pots();
  const appSide = subtractCents(addCents(pots.savings, pots.needs, pots.wants, pots.wishlist ?? 0, pots.heldForOthers, pots.unsortedIn), pots.unsortedOut);
  const checking = addCents(subtractCents(subtractCents(appSide, book.inTransit().total), savings), owes['everyday-card'], owes['second-card']);
  const bank: BankBalances = { checking, savings, everydayCard: owes['everyday-card'], secondCard: owes['second-card'] };

  const when = timeIn(TIME_ZONE, new Date(`${today}T13:41:00Z`));
  const down = plan.amexDown === true;
  const input: HomeInput = {
    today,
    book,
    bank: down ? null : bank,
    needsLogin: false,
    ...(down ? { banksToLogIn: [{ bank: 2 as const, name: 'American Express' }] } : {}),
    statements: CARDS.map((card) => kept[card].at(-1) as CardStatement),
    madeUpData: true,
    seenTakeBacks: new Set(),
    lastChecked: down ? { amount: checkedThisMorning, at: `${today}T07:15:00-04:00` } : null,
    catchingUp: false,
    bankDetail: null,
    checkedAt: { at: down ? `${today}T07:15:00-04:00` : when, timeZone: TIME_ZONE },
  };
  const life: HerLive = { input, atSetup, kept, beforeSetup: PRE_SETUP, wishlist: listed(plan, book), trends: herTrendsHistory() };
  return { life, fed, book };
}

// 50.1 and 50.3: her four things, in her order, and the lamp bought if the lamp purchase is sorted to it.
function listed(plan: Plan, book: Book): WishlistList {
  let list = EMPTY_WISHLIST;
  for (const item of LIST) list = changeWishlist(list, { add: item }, SETUP_DAY);
  if (plan.wishlistBuy === 'lamp-not-moved') {
    const lamp = book.wishlistFlows().purchases[0];
    if (lamp !== undefined) list = changeWishlist(list, { bought: { item: 'item-3', purchase: lamp.id, day: lamp.date, paid: lamp.amount } }, lamp.date);
  }
  return list;
}

// A made-up bank history from before her setup day (Sep 19, the last paycheck Sep 18), for
// Trends (40.1, 40.3): the 90 days asked for at connection. Pay periods go back every 14 days.
function herTrendsHistory(): BeforeSetup {
  const lines: HistoryLine[] = [];
  let n = 0;
  // Plaid's sign: positive is money out.
  const add = (date: IsoDate, account: HistoryLine['account'], amount: Cents, description: string): void => {
    lines.push({ id: `her-trend-${(n += 1)}`, account, date, amount, description });
  };
  const starts = ['2026-06-26', '2026-07-10', '2026-07-24', '2026-08-07', '2026-08-21', '2026-09-04'];
  starts.forEach((start, i) => {
    const day = (k: number): IsoDate => addDays(start, k);
    add(day(0), 'checking', -250_000, `${EMPLOYER} DIR DEP`);
    add(day(1), 'checking', 9_412 + i * 611, 'GREEN LEAF GROCERY #12');
    add(day(8), 'checking', 7_205 - i * 233, 'GREEN LEAF GROCERY #12');
    add(day(2), 'everyday-card', 575, 'BLUE DOOR COFFEE');
    add(day(6), 'second-card', 625, 'BLUE DOOR COFFEE');
    add(day(11), 'everyday-card', 575, 'BLUE DOOR COFFEE');
    add(day(4), 'second-card', 4_380 + i * 950, 'HARBOR RESTAURANT');
    add(day(5), 'everyday-card', 3_950 + (i % 3) * 400, 'CORNER GAS STATION');
    add(day(9), 'second-card', 1_599, 'RIVER STREAMING');
    if (i % 2 === 0) add(day(7), 'everyday-card', 2_899, 'CITY BOOKSHOP');
    add(day(3), 'checking', 30_000, 'PAYMENT TO CAPITAL ONE CARD');
    add(day(10), 'checking', 25_000, 'PAYMENT TO AMEX CARD');
  });
  add(LAST_PAYCHECK, 'checking', -250_000, `${EMPLOYER} DIR DEP`);
  add(LAST_PAYCHECK, 'everyday-card', 575, 'BLUE DOOR COFFEE');
  return { setupDay: SETUP_DAY, lastPaycheckDate: LAST_PAYCHECK, historyFrom: '2026-06-21', lines, bankRules: HER_BANK_RULES };
}

// A fresh play of one of her lives (picking it again starts it over).
export function herLife(name: string): HerLive {
  const plan = PLANS[name];
  if (plan === undefined) throw new Error(`no made-up life ${name}`);
  return build(plan).life;
}

const titled = (name: string, title: string): DemoScenario => ({
  name,
  title,
  input: () => herLife(name).input,
  her: () => herLife(name),
  bankRules: HER_BANK_RULES,
  trends: herTrendsHistory,
});

export const HER_SCENARIOS: readonly DemoScenario[] = [
  titled('her-everyday', 'Her everyday: both cards with statements and due dates, set aside, a few weeks of purchases, a Wishlist of four things, Trends from before setup day'),
  titled('her-payday', 'Her payday: a paycheck waiting for her yes, with the split it would get'),
  titled('her-review-busy', 'Her Review: purchases waiting, one to sort to Wishlist (which thing on her list?), one to split across needs, wants and Wishlist'),
  titled('her-card-due', 'Her cards: one due in 2 days, one overdue, and money to move from savings to checking for a Wishlist purchase'),
  titled('her-one-bank-down', 'Her bank down: the Amex card cannot be read, so safe to spend is greyed, as of this morning'),
];

export function herScenario(name: string): DemoScenario | undefined {
  return HER_SCENARIOS.find((s) => s.name === name);
}

// Her rulebook, PR 5: the second card (section 1, 1.2, 4.1, 4.8, 5.1, 9.1,
// 9.3, 9.8, 12.1, 12.5, 14.2). Each everyday-card test has its second-card
// twin in second-card-twins-her.test.ts; these are about the two cards
// together, and about the switch that turns the second card on.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HER_SETTINGS,
  HER_SWITCHES,
  UPSTREAM_SWITCHES,
  addDays,
  bankSide,
  cardDue,
  cardNotices,
  changeSettings,
  checkSwitches,
  openBook,
  rolesFor,
  startTracking,
  startingMoney,
  withPendingCharges,
  type BankBalances,
  type BankTransaction,
  type Book,
  type CardStatement,
  type Cents,
  type IsoDate,
  type OpenBookInput,
  type ReviewOptions,
  type Settings,
  type SortingRule,
  type Switches,
} from '../src/index.js';
import { LAST_PAYCHECK, PAYROLL, START_DATE, arrived, cardCharge, codeOf, posted, purchase, refund, sent, transfer } from './helpers.js';

type Card = 'everyday-card' | 'second-card';
const CARDS: readonly Card[] = ['everyday-card', 'second-card'];
const MAX = Number.MAX_SAFE_INTEGER;

const RULES: readonly SortingRule[] = [
  { id: 'r1', for: 'purchase', contains: 'MADE UP GROCER', bucket: 'needs' },
  { id: 'r2', for: 'purchase', contains: 'MADE UP CINEMA', bucket: 'wants' },
];
const HER: Settings = changeSettings(HER_SETTINGS, { paycheckRule: { contains: PAYROLL } });
const POTS = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 };
// Checking + savings - both cards = the pots above (180,000).
const BANK: BankBalances = { checking: 110_000, savings: 100_000, everydayCard: 20_000, secondCard: 10_000 };

function herBook(input: Partial<OpenBookInput> = {}): Book {
  return openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: HER, rules: RULES, switches: HER_SWITCHES, ...input });
}

// A book with upstream's switches: the second card is off.
function upstreamBook(input: Partial<OpenBookInput> = {}): Book {
  return openBook({ date: START_DATE, lastPaycheckDate: LAST_PAYCHECK, oldCardDebt: 0, pots: POTS, settings: DEFAULT_SETTINGS, ...input });
}

function state(book: Book): string {
  return JSON.stringify({ pots: book.pots(), review: book.reviewDetails(), log: book.changeLog(), settings: book.settings(), purchases: book.purchases(), transit: book.inTransit() });
}

function refusedOff(book: Book, run: () => unknown): void {
  const before = state(book);
  expect(codeOf(run)).toBe('off-in-this-setup');
  expect(state(book)).toBe(before);
}

const card = (balances: BankBalances, which: Card): Cents => (which === 'everyday-card' ? balances.everydayCard : (balances.secondCard ?? 0));
const withCard = (balances: BankBalances, which: Card, owed: Cents): BankBalances => (which === 'everyday-card' ? { ...balances, everydayCard: owed } : { ...balances, secondCard: owed });

describe('1 her accounts: two banks, and both cards used day to day', () => {
  it('1.2 her four accounts are checking, savings, the everyday card and the second card, each once', () => {
    expect(rolesFor(HER_SWITCHES)).toEqual(['checking', 'savings', 'everyday-card', 'second-card']);
  });

  it('1.2 upstream still picks its own four, with no second card', () => {
    expect(rolesFor(UPSTREAM_SWITCHES)).toEqual(['checking', 'savings', 'everyday-card', 'old-card']);
  });

  it('1 the second card is a switch, on in her setup and off in upstream\'s', () => {
    expect(HER_SWITCHES).toEqual({ momReserve: 'off', oldCard: 'off', secondCard: 'on', wishlist: 'on' });
    expect(UPSTREAM_SWITCHES).toEqual({ momReserve: 'on', oldCard: 'on', secondCard: 'off', wishlist: 'off' });
  });

  it('1 a book saved before the second card existed opens with one card (B242)', () => {
    expect(checkSwitches({ momReserve: 'off', oldCard: 'off' } as Switches)).toEqual({ momReserve: 'off', oldCard: 'off', secondCard: 'off', wishlist: 'off' });
    expect(upstreamBook().switches().secondCard).toBe('off');
  });

  it('1 the second card is on or off, nothing else', () => {
    expect(codeOf(() => checkSwitches({ ...HER_SWITCHES, secondCard: 'yes' } as unknown as Switches))).toBe('bad-switch');
  });
});

describe('1 with the second card off, nothing on it is read', () => {
  it('1 a purchase, refund, fee or payment on the second card is refused, and nothing changes', () => {
    const b = upstreamBook();
    refusedOff(b, () => b.receive(purchase('p1', '2026-10-02', 500, 'MADE UP GROCER', { account: 'second-card' })));
    refusedOff(b, () => b.receive(refund('r1', '2026-10-02', 500, undefined, 'second-card')));
    refusedOff(b, () => b.receive(cardCharge('f1', '2026-10-02', 500, 'fee', 'second-card')));
    refusedOff(b, () => b.receive(transfer('t1', '2026-10-02', 500, 'checking', 'second-card')));
    refusedOff(b, () => b.receive(sent('s1', '2026-10-02', 500, 'checking', 'second-card')));
  });

  it('1 a second card balance, even one cent, is refused by the self-check', () => {
    const b = upstreamBook();
    expect(codeOf(() => b.selfCheck({ checking: 80_000, savings: 100_000, everydayCard: 0, secondCard: 1 }))).toBe('off-in-this-setup');
    expect(b.selfCheck({ checking: 80_000, savings: 100_000, everydayCard: 0, secondCard: 0 }).ok).toBe(true);
  });

  it('1 nothing pending on it, nothing on its way to it, and no closing day for it on setup day', () => {
    expect(codeOf(() => upstreamBook({ countedAtSetup: [purchase('p1', START_DATE, 500, 'MADE UP GROCER', { account: 'second-card', pending: true })] }))).toBe('off-in-this-setup');
    expect(codeOf(() => upstreamBook({ inTransitAtSetup: [sent('s1', START_DATE, 500, 'checking', 'second-card')] }))).toBe('off-in-this-setup');
    expect(codeOf(() => upstreamBook({ settings: changeSettings(DEFAULT_SETTINGS, { secondCardClosingDay: 5 }) }))).toBe('off-in-this-setup');
  });

  it('1 its closing day cannot be set later either', () => {
    const b = upstreamBook();
    refusedOff(b, () => b.changeSettings({ secondCardClosingDay: 5 }, '2026-10-02'));
  });

  it('1 review never offers it as a transfer while it is off', () => {
    const b = upstreamBook();
    b.receive(purchase('p1', '2026-10-02', 500, 'MADE UP SHOP', { account: 'checking' }));
    const options = b.reviewDetails()[0]?.options as Extract<ReviewOptions, { type: 'sort' }>;
    expect(options.transfer).toEqual(['savings', 'everyday-card', 'old-card']);
  });

  it('5.6 while it is off, marking something a payment to it is refused, in review and on a re-sort, and nothing changes', () => {
    const b = upstreamBook();
    b.receive(purchase('p1', '2026-10-02', 500, 'MADE UP SHOP', { account: 'checking' }));
    refusedOff(b, () => b.sort('p1', { transfer: 'second-card' }, '2026-10-02'));
    b.sort('p1', { to: 'needs' }, '2026-10-02');
    refusedOff(b, () => b.sort('p1', { transfer: 'second-card' }, '2026-10-03'));
  });
});

describe('2 settings: a statement closing day for each card', () => {
  it('2 her setup starts with no closing day for either card', () => {
    expect(HER_SETTINGS.everydayCardClosingDay).toBeNull();
    expect(HER_SETTINGS.secondCardClosingDay).toBeNull();
  });

  it('2 upstream\'s settings do not have the second card\'s closing day', () => {
    expect('secondCardClosingDay' in DEFAULT_SETTINGS).toBe(false);
  });

  it('9.8 the second card\'s closing day is a day of the month from 1 to 31, or not set', () => {
    for (const day of [1, 15, 31, null]) expect(changeSettings(HER, { secondCardClosingDay: day }).secondCardClosingDay).toBe(day);
    for (const day of [0, 32, -1, 1.5, Number.NaN]) expect(codeOf(() => changeSettings(HER, { secondCardClosingDay: day })), String(day)).toBe('bad-setting');
  });

  it('9.8 each card keeps its own closing day', () => {
    const b = herBook();
    b.changeSettings({ everydayCardClosingDay: 3, secondCardClosingDay: 27 }, '2026-10-02');
    expect(b.settings()).toMatchObject({ everydayCardClosingDay: 3, secondCardClosingDay: 27 });
  });
});

describe('4.1 a purchase on the debit card or on either card comes out of a bucket on the day of the purchase', () => {
  it('4.1 one purchase on each card, each out of the bucket its rule picks', () => {
    const b = herBook();
    b.receive(purchase('p1', '2026-10-02', 4_000, 'MADE UP GROCER', { account: 'everyday-card' }));
    b.receive(purchase('p2', '2026-10-02', 1_500, 'MADE UP CINEMA', { account: 'second-card' }));
    expect(b.pots()).toMatchObject({ needs: 46_000, wants: 28_500, unsortedOut: 0 });
    expect(b.selfCheck({ ...BANK, everydayCard: 24_000, secondCard: 11_500 }).ok).toBe(true);
  });

  it('4.1 one cent on the second card is one cent out of its bucket', () => {
    const b = herBook();
    b.receive(purchase('p1', '2026-10-02', 1, 'MADE UP GROCER', { account: 'second-card' }));
    expect(b.pots().needs).toBe(49_999);
  });

  it('4.6 a pending charge on the second card counts once, and its posting replaces it at the new amount', () => {
    const b = herBook();
    b.receive(purchase('p1', '2026-10-02', 2_000, 'MADE UP GROCER', { account: 'second-card', pending: true }));
    expect(b.pots().needs).toBe(48_000);
    b.receive(posted('p1b', 'p1', '2026-10-03', 2_300, 'MADE UP GROCER', 'second-card'));
    expect(b.pots().needs).toBe(47_700);
    expect(b.selfCheck({ ...BANK, secondCard: 12_300 }).ok).toBe(true);
  });

  it('4.5 a refund on the second card goes back to the bucket its purchase came from', () => {
    const b = herBook();
    b.receive(purchase('p1', '2026-10-02', 3_000, 'MADE UP CINEMA', { account: 'second-card' }));
    b.receive(refund('r1', '2026-10-04', 3_000, 'p1', 'second-card'));
    expect(b.pots().wants).toBe(30_000);
  });

  it('4.5 a refund on one card never matches a purchase on the other', () => {
    const b = herBook();
    b.receive(purchase('p1', '2026-10-02', 3_000, 'MADE UP CINEMA', { account: 'everyday-card' }));
    b.receive(refund('r1', '2026-10-04', 3_000, undefined, 'second-card'));
    const detail = b.reviewDetails().find((d) => d.item.id === 'r1');
    expect(detail?.likelyPurchases ?? []).toEqual([]);
  });
});

describe('4.8 fees and interest on either card go to review, suggested bucket needs', () => {
  for (const which of CARDS) {
    it(`4.8 a fee and interest on the ${which} wait in review with needs suggested`, () => {
      const b = herBook();
      b.receive(cardCharge('f1', '2026-10-03', 2_900, 'fee', which));
      b.receive(cardCharge('i1', '2026-10-03', 1, 'interest', which));
      expect(b.reviewItems()).toMatchObject([
        { id: 'f1', reason: 'card-fee', suggestion: 'needs' },
        { id: 'i1', reason: 'card-interest', suggestion: 'needs' },
      ]);
      expect(b.pots()).toMatchObject({ needs: 50_000, unsortedOut: 2_901 });
    });
  }
});

describe('5.1 checking or savings to either card: not spending', () => {
  for (const which of CARDS) {
    for (const from of ['checking', 'savings'] as const) {
      it(`5.1 ${from} to the ${which}: no bucket changes, and the check still passes`, () => {
        const b = herBook();
        const before = b.pots();
        expect(b.receive(transfer('t1', '2026-10-05', 10_000, from, which)).outcome).toBe('sorted');
        expect(b.pots()).toEqual(before);
        const paid = withCard({ ...BANK, [from]: BANK[from] - 10_000 }, which, card(BANK, which) - 10_000);
        expect(b.selfCheck(paid).ok).toBe(true);
      });
    }
  }

  it('5.6 a checking purchase can be marked a payment to either card; the second card is offered after the everyday card', () => {
    const b = herBook();
    b.receive(purchase('p1', '2026-10-02', 500, 'MADE UP ONLINE PAYMENT', { account: 'checking' }));
    const options = b.reviewDetails()[0]?.options as Extract<ReviewOptions, { type: 'sort' }>;
    expect(options.transfer).toEqual(['savings', 'everyday-card', 'second-card']);
    expect(options.transferOutcome).toEqual({ savings: 'no-bucket-change', 'everyday-card': 'no-bucket-change', 'second-card': 'no-bucket-change' });
    b.sort('p1', { transfer: 'second-card' }, '2026-10-02');
    expect(b.pots()).toMatchObject({ needs: 50_000, wants: 30_000, unsortedOut: 0 });
    expect(b.inTransit().items).toMatchObject([{ id: 'p1', to: 'second-card', seen: 'left', amount: 500 }]);
  });
});

describe('9.1 and 9.3 each card: reminders show the statement balance, and go on until it is paid in full', () => {
  const statementOf = (which: Card): CardStatement => ({ card: which, closingDate: '2026-10-01', dueDate: '2026-10-26', statementBalance: 123_456, minimumPayment: 3_500 });

  for (const which of CARDS) {
    it(`9.1 the ${which}: the statement balance, the minimum and the due date, 7 and 2 days before`, () => {
      expect(cardNotices('2026-10-19', statementOf(which), [], HER)).toEqual([{ kind: 'reminder', card: which, daysBefore: 7, dueDate: '2026-10-26', statementBalance: 123_456, minimumPayment: 3_500 }]);
      expect(cardNotices('2026-10-24', statementOf(which), [], HER)).toMatchObject([{ daysBefore: 2 }]);
    });

    it(`9.3 the ${which}: paying the minimum does not stop the reminders; one cent short of the balance does not either`, () => {
      expect(cardNotices('2026-10-24', statementOf(which), [{ date: '2026-10-10', amount: 3_500 }], HER)).toHaveLength(1);
      expect(cardNotices('2026-10-24', statementOf(which), [{ date: '2026-10-10', amount: 123_455 }], HER)).toHaveLength(1);
      expect(cardNotices('2026-10-24', statementOf(which), [{ date: '2026-10-10', amount: 123_456 }], HER)).toEqual([]);
    });

    it(`9.3 the ${which}: a payment landing on the statement date counts toward the one before (B28)`, () => {
      expect(cardNotices('2026-10-24', statementOf(which), [{ date: '2026-09-30', amount: 123_456, landedOn: '2026-10-01' }], HER)).toHaveLength(1);
      expect(cardNotices('2026-10-24', statementOf(which), [{ date: '2026-10-01', amount: 123_456, landedOn: '2026-10-02' }], HER)).toEqual([]);
    });

    it(`9.6 the ${which}: due on Home from the first reminder day until paid in full, then overdue below the minimum`, () => {
      expect(cardDue('2026-10-20', statementOf(which), [], HER)).toMatchObject({ kind: 'due', card: which, daysLeft: 6, statementBalance: 123_456 });
      expect(cardDue('2026-10-27', statementOf(which), [{ date: '2026-10-10', amount: 3_499 }], HER)).toEqual({ kind: 'overdue', card: which, dueDate: '2026-10-26', minimumPayment: 3_500 });
    });
  }

  it('9.3 a payment to one card never counts toward the other card\'s statement', () => {
    const b = herBook();
    b.receive(transfer('t1', '2026-10-05', 123_456, 'checking', 'everyday-card'));
    expect(b.cardPayments('everyday-card')).toEqual([{ date: '2026-10-05', amount: 123_456, landedOn: '2026-10-05' }]);
    expect(b.cardPayments('second-card')).toEqual([]);
    expect(cardNotices('2026-10-24', statementOf('second-card'), b.cardPayments('second-card'), HER)).toHaveLength(1);
    expect(cardNotices('2026-10-24', statementOf('everyday-card'), b.cardPayments('everyday-card'), HER)).toEqual([]);
  });

  it('9.3 a payment to the second card still on its way counts from the day it left (B47)', () => {
    const b = herBook();
    b.receive(sent('s1', '2026-10-20', 123_456, 'savings', 'second-card'));
    expect(b.cardPayments('second-card')).toEqual([{ date: '2026-10-20', amount: 123_456, landedOn: null }]);
    expect(cardNotices('2026-10-24', statementOf('second-card'), b.cardPayments('second-card'), HER)).toEqual([]);
  });
});

describe('12.1 bank side: checking + savings - the everyday card - the second card', () => {
  it('12.1 both cards come off', () => {
    expect(bankSide(BANK)).toBe(180_000);
    expect(bankSide({ ...BANK, secondCard: 0 })).toBe(190_000);
  });

  it('12.1 one cent on the second card is one cent off the bank side', () => {
    expect(bankSide({ ...BANK, secondCard: 10_001 })).toBe(179_999);
  });

  it('12.1 a second card the bank shows in credit (below zero owed) adds to the bank side', () => {
    expect(bankSide({ ...BANK, secondCard: -2_500 })).toBe(192_500);
  });

  it('12.1 with no second card balance at all, upstream\'s three accounts', () => {
    expect(bankSide({ checking: 110_000, savings: 100_000, everydayCard: 20_000 })).toBe(190_000);
  });

  it('12.1 very large balances on both cards are exact', () => {
    expect(bankSide({ checking: MAX, savings: 0, everydayCard: MAX - 1, secondCard: 1 })).toBe(0);
    expect(codeOf(() => bankSide({ checking: 0, savings: 0, everydayCard: 0, secondCard: MAX + 1 }))).toBe('not-cents');
    expect(codeOf(() => bankSide({ checking: 0, savings: 0, everydayCard: 0, secondCard: 0.5 }))).toBe('not-cents');
  });

  it('12.1 a pending charge on each card raises what that card owes', () => {
    expect(withPendingCharges(BANK, [
      { account: 'second-card', amount: 700 },
      { account: 'everyday-card', amount: 300 },
      { account: 'second-card', amount: 1 },
    ])).toEqual({ ...BANK, everydayCard: 20_300, secondCard: 10_701 });
  });

  it('12.1 a pending charge on the second card with no second card balance given starts from zero owed', () => {
    expect(withPendingCharges({ checking: 1, savings: 2, everydayCard: 3 }, [{ account: 'second-card', amount: 5 }])).toEqual({ checking: 1, savings: 2, everydayCard: 3, secondCard: 5 });
    expect(withPendingCharges({ checking: 1, savings: 2, everydayCard: 3 }, [])).toEqual({ checking: 1, savings: 2, everydayCard: 3 });
  });

  it('12.3 the second card one cent off is a difference of one cent, either way', () => {
    const b = herBook();
    expect(b.selfCheck(BANK)).toMatchObject({ ok: true, difference: 0 });
    expect(b.selfCheck({ ...BANK, secondCard: 10_001 })).toMatchObject({ ok: false, difference: -1 });
    expect(b.selfCheck({ ...BANK, secondCard: 9_999 })).toMatchObject({ ok: false, difference: 1 });
  });
});

describe('12.5 money in transit to either card', () => {
  for (const which of CARDS) {
    it(`12.5 a payment to the ${which} that left checking and has not landed: in transit, and the check passes; landed a day late, it still does`, () => {
      const b = herBook();
      b.receive(sent('s1', '2026-10-05', 5_000, 'checking', which));
      const left = { ...BANK, checking: BANK.checking - 5_000 };
      expect(b.selfCheck(left)).toMatchObject({ ok: true, inTransit: 5_000 });
      b.receive(arrived('a1', '2026-10-06', 5_000, 'checking', which));
      expect(b.selfCheck(withCard(left, which, card(BANK, which) - 5_000))).toMatchObject({ ok: true, inTransit: 0 });
      expect(b.cardPayments(which)).toEqual([{ date: '2026-10-05', amount: 5_000, landedOn: '2026-10-06' }]);
    });
  }

  it('12.5 two payments of the same amount, one to each card: each arrival pairs with the payment to its own card', () => {
    const b = herBook();
    b.receive(sent('s1', '2026-10-05', 5_000, 'checking', 'everyday-card'));
    b.receive(sent('s2', '2026-10-05', 5_000, 'checking', 'second-card'));
    b.receive(arrived('a2', '2026-10-06', 5_000, 'checking', 'second-card'));
    expect(b.inTransit().items).toMatchObject([{ id: 's1', to: 'everyday-card', seen: 'left' }]);
    expect(b.cardPayments('second-card')).toEqual([{ date: '2026-10-05', amount: 5_000, landedOn: '2026-10-06' }]);
    expect(b.cardPayments('everyday-card')).toEqual([{ date: '2026-10-05', amount: 5_000, landedOn: null }]);
  });

  it('12.5 seen landing on the second card before it shows leaving: in transit the other way until it does', () => {
    const b = herBook();
    b.receive(arrived('a1', '2026-10-06', 5_000, 'savings', 'second-card'));
    expect(b.selfCheck({ ...BANK, secondCard: 5_000 })).toMatchObject({ ok: true, inTransit: -5_000 });
    b.receive(sent('s1', '2026-10-07', 5_000, 'savings', 'second-card'));
    expect(b.selfCheck({ ...BANK, savings: 95_000, secondCard: 5_000 })).toMatchObject({ ok: true, inTransit: 0 });
  });
});

describe('14.2 the starting money: checking + savings - both cards\' balances', () => {
  const input = {
    date: START_DATE,
    bankBalances: BANK,
    pendingCharges: [],
    oldCardBalance: 0,
    assignment: POTS,
    lastPaycheckDate: LAST_PAYCHECK,
    settings: HER,
    switches: HER_SWITCHES,
  };

  it('14.2 both cards come off the starting money', () => {
    expect(startingMoney(BANK, [])).toBe(180_000);
    const result = startTracking(input);
    expect(result).toMatchObject({ ok: true, startingMoney: 180_000 });
    if (result.ok) expect(result.book.switches()).toEqual(HER_SWITCHES);
  });

  it('14.2 a charge pending on the second card on setup day is part of the starting money, and counts once', () => {
    const charge = purchase('p1', START_DATE, 2_500, 'MADE UP GROCER', { account: 'second-card', pending: true });
    expect(startingMoney(BANK, [charge])).toBe(177_500);
    const result = startTracking({ ...input, pendingCharges: [charge], assignment: { ...POTS, needs: 47_500 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // It posts at the same amount: nothing more is counted (A10).
    result.book.receive(posted('p1b', 'p1', '2026-10-02', 2_500, 'MADE UP GROCER', 'second-card'));
    expect(result.book.pots()).toMatchObject({ needs: 47_500, unsortedOut: 0 });
    expect(result.book.selfCheck({ ...BANK, secondCard: 12_500 }).ok).toBe(true);
  });

  it('14.2 a payment to the second card on its way on setup day is part of the starting money', () => {
    const half = sent('s1', '2026-09-30', 4_000, 'checking', 'second-card');
    expect(startingMoney({ ...BANK, checking: 106_000 }, [], [half])).toBe(180_000);
    const result = startTracking({ ...input, bankBalances: { ...BANK, checking: 106_000 }, transfersInTransit: [half] });
    expect(result).toMatchObject({ ok: true });
  });

  it('14.2 one cent left to assign on the second card is refused, saying so', () => {
    expect(startTracking({ ...input, bankBalances: { ...BANK, secondCard: 9_999 } })).toEqual({ ok: false, startingMoney: 180_001, assigned: 180_000, difference: 1 });
  });

  it('14.2 with the second card off, a second card balance on setup day is refused', () => {
    const upstream = { ...input, settings: DEFAULT_SETTINGS, switches: UPSTREAM_SWITCHES, bankBalances: { ...BANK, checking: 100_000 } };
    expect(codeOf(() => startTracking(upstream))).toBe('off-in-this-setup');
  });
});

// A small bank of its own for the random lives, worked out apart from the book.
class HerBank {
  checking = 110_000;
  savings = 100_000;
  owed: Record<Card, Cents> = { 'everyday-card': 20_000, 'second-card': 10_000 };
  inTransit = 0;

  balances(): BankBalances {
    return { checking: this.checking, savings: this.savings, everydayCard: this.owed['everyday-card'], secondCard: this.owed['second-card'] };
  }
}

type Step =
  | { readonly kind: 'buy'; readonly card: Card; readonly amount: Cents; readonly needs: boolean; readonly pending: boolean; readonly tip: Cents }
  | { readonly kind: 'refund'; readonly back: number }
  | { readonly kind: 'fee'; readonly card: Card; readonly amount: Cents }
  | { readonly kind: 'pay'; readonly card: Card; readonly from: 'checking' | 'savings'; readonly part: number; readonly late: 0 | 1 | 2; readonly linked: boolean }
  | { readonly kind: 'next-day' };

const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant('buy' as const), card: fc.constantFrom(...CARDS), amount: fc.integer({ min: 1, max: 50_000 }), needs: fc.boolean(), pending: fc.boolean(), tip: fc.integer({ min: 0, max: 900 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('refund' as const), back: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('fee' as const), card: fc.constantFrom(...CARDS), amount: fc.integer({ min: 1, max: 5_000 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('pay' as const), card: fc.constantFrom(...CARDS), from: fc.constantFrom('checking' as const, 'savings' as const), part: fc.integer({ min: 1, max: 4 }), late: fc.constantFrom(0 as const, 1 as const, 2 as const), linked: fc.boolean() }) },
  { weight: 3, arbitrary: fc.constant({ kind: 'next-day' as const }) },
);

// One life: purchases on both cards (some pending, posting the next day with
// a tip), refunds, fees, and card payments from checking or savings, paid in
// full or in parts, landing the same day or one or two days late. moveTo
// moves every bit of the second card's activity onto the card it names.
function live(steps: readonly Step[], moveTo: (c: Card) => Card, check: (book: Book, bank: HerBank, day: IsoDate) => void): { readonly book: Book; readonly paidTo: Record<Card, Cents> } {
  const book = herBook();
  const paidTo: Record<Card, Cents> = { 'everyday-card': 0, 'second-card': 0 };
  const bank = new HerBank();
  if (moveTo('second-card') === 'everyday-card') {
    bank.owed['everyday-card'] += bank.owed['second-card'];
    bank.owed['second-card'] = 0;
  }
  let day = addDays(START_DATE, 1);
  let n = 0;
  const id = (prefix: string): string => `${prefix}${++n}`;
  const bought: { id: string; card: Card; amount: Cents; back: boolean }[] = [];
  const posting: { id: string; card: Card; held: Cents; amount: Cents; description: string }[] = [];
  const landing: { day: IsoDate; half: BankTransaction }[] = [];
  const give = (txn: BankTransaction): void => void book.receive(txn);
  const endOfDay = (): void => {
    check(book, bank, day);
    day = addDays(day, 1);
    for (const p of posting.splice(0)) {
      const amount = p.amount;
      bank.owed[p.card] += amount - p.held;
      give(posted(id('p'), p.id, day, amount, p.description, p.card));
      bought.push({ id: p.id, card: p.card, amount, back: false });
    }
    for (const due of landing.filter((l) => l.day === day)) {
      landing.splice(landing.indexOf(due), 1);
      const half = due.half as Extract<BankTransaction, { kind: 'transfer-arrived' }>;
      bank.owed[half.to as Card] -= half.amount;
      bank.inTransit -= half.amount;
      give(half);
    }
  };
  for (const s of steps) {
    switch (s.kind) {
      case 'buy': {
        const on = moveTo(s.card);
        const description = s.needs ? 'MADE UP GROCER' : 'MADE UP CINEMA';
        const txnId = id('b');
        if (s.pending) {
          // 12.1: the bank side counts it while pending. It posts the next day, with the tip.
          bank.owed[on] += s.amount;
          give(purchase(txnId, day, s.amount, description, { account: on, pending: true }));
          posting.push({ id: txnId, card: on, held: s.amount, amount: s.amount + s.tip, description });
        } else {
          bank.owed[on] += s.amount;
          give(purchase(txnId, day, s.amount, description, { account: on }));
          bought.push({ id: txnId, card: on, amount: s.amount, back: false });
        }
        break;
      }
      case 'refund': {
        const open = bought.filter((b) => !b.back);
        const which = open[s.back % Math.max(1, open.length)];
        if (which === undefined) break;
        which.back = true;
        bank.owed[which.card] -= which.amount;
        give(refund(id('r'), day, which.amount, which.id, which.card));
        break;
      }
      case 'fee': {
        const on = moveTo(s.card);
        bank.owed[on] += s.amount;
        give(cardCharge(id('f'), day, s.amount, 'fee', on));
        break;
      }
      case 'pay': {
        const to = moveTo(s.card);
        const amount = Math.floor(bank.owed[to] / s.part);
        if (amount <= 0) break;
        bank[s.from] -= amount;
        paidTo[to] += amount;
        if (s.late === 0) {
          bank.owed[to] -= amount;
          give(transfer(id('t'), day, amount, s.from, to));
        } else {
          const left = sent(id('s'), day, amount, s.from, to);
          bank.inTransit += amount;
          give(left);
          landing.push({ day: addDays(day, s.late), half: arrived(id('a'), addDays(day, s.late), amount, s.from, to, s.linked ? left.id : undefined) });
        }
        break;
      }
      case 'next-day':
        endOfDay();
        break;
    }
  }
  // Everything still on its way lands, a day at a time.
  for (let i = 0; i < 3; i++) endOfDay();
  return { book, paidTo };
}

describe('12.5 random lives with both cards, payments landing late on each card', () => {
  it('12.5 the self-check holds every day, and every bucket matches a recount', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 120 }), (steps) => {
        live(steps, (c) => c, (book, bank, day) => {
          const check = book.selfCheck(bank.balances());
          expect(check.difference, day).toBe(0);
          expect(check.inTransit, day).toBe(bank.inTransit);
          expect(book.pots(), day).toEqual(book.recountPots());
        });
      }),
      { numRuns: 300 },
    );
  });

  it('9.3 the payments the app sees for each card add up to what was sent to that card, each landed', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 80 }), (steps) => {
        const { book, paidTo } = live(steps, (c) => c, () => undefined);
        for (const which of CARDS) {
          const paid = book.cardPayments(which);
          expect(paid.every((p) => p.landedOn !== null)).toBe(true);
          expect(paid.reduce((sum, p) => sum + p.amount, 0)).toBe(paidTo[which]);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('1 both cards work the same way: the second card\'s activity moved onto the everyday card gives the same buckets every day', () => {
  it('1 the same buckets, the same review and the same safe to spend, every day', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 120 }), (steps) => {
        const days: string[] = [];
        live(steps, (c) => c, (book, _bank, day) => days.push(JSON.stringify({ day, pots: book.pots(), waiting: book.reviewItems().length, safe: book.safeToSpend(day) })));
        const moved: string[] = [];
        live(steps, () => 'everyday-card', (book, bank, day) => {
          expect(book.selfCheck(bank.balances()).ok, day).toBe(true);
          moved.push(JSON.stringify({ day, pots: book.pots(), waiting: book.reviewItems().length, safe: book.safeToSpend(day) }));
        });
        expect(moved).toEqual(days);
      }),
      { numRuns: 300 },
    );
  });
});

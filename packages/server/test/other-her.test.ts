// Her rulebook, 7.7, 7.8, 9.9 and 52.4 on the real server's books (60j,
// docs/her-questions.txt HA12): each of her cards on Buckets, Other and split
// money in through the choice desk, with Wishlist as a part, and what a restart
// keeps. Every name and number is made up.
import { afterEach, describe, expect, it } from 'vitest';
import { parseChoiceRequest } from '../src/choices.js';
import { checkBankRules } from '../src/bank/reading.js';
import { HER_START } from '../src/setup-start.js';
import type { BucketsView } from '../src/views/buckets.js';
import { parseWishlistRequest } from '../src/wishlist-items.js';
import { ACCOUNT_IDS, type FakePlaid } from './fake-plaid.js';
import { HER_BANK_RULES, setUpHer } from './her-harness.js';
import { choose, decision, everything, lifeInAFile, noonInNewYork, type Life } from './keeper-harness.js';

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;
const SECOND = ACCOUNT_IDS.second;

const SECOND_CARD_RULES = checkBankRules([
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);

const statement = (closing: string | null, due: string, balance: number, minimum = 35) => ({ is_overdue: false, last_payment_amount: null, last_payment_date: null, last_statement_issue_date: closing, last_statement_balance: balance, minimum_payment_amount: minimum, next_payment_due_date: due });

let lives: Life[] = [];
afterEach(() => {
  for (const life of lives) life.done();
  lives = [];
});

async function her(history: (fake: FakePlaid) => void = () => undefined): Promise<Life> {
  const life = await lifeInAFile({ herSetup: true, secondCard: 25_000, rules: checkBankRules([...HER_BANK_RULES, ...SECOND_CARD_RULES]), start: HER_START, history });
  lives.push(life);
  setUpHer(life);
  return life;
}

async function day(life: Life, date: string, items: () => void = () => undefined): Promise<void> {
  items();
  life.now = noonInNewYork(date);
  await life.sync();
}

function addToList(life: Life) {
  const parsed = parseWishlistRequest({ id: decision(), wishlist: { add: { name: 'Rain jacket', price: 12_000 } } });
  if (parsed === null) throw new Error('not a list change');
  return life.keeper.wishlist(parsed);
}

function cardsOf(life: Life): Extract<BucketsView, { state: 'tracking' }>['cards'] {
  const view = life.keeper.buckets();
  if (view.state !== 'tracking') throw new Error('not tracking');
  return view.cards;
}

describe('9.9 each of her cards on Buckets', () => {
  it('9.9 9.1 both cards at any time, the Capital One card first, each with its statement balance; long before the first reminder day', async () => {
    const life = await her((fake) => {
      fake.setStatement(E, statement('2026-09-25', '2026-10-30', 450));
      fake.setStatement(SECOND, statement('2026-09-28', '2026-10-25', 120.5, 25));
    });
    await day(life, '2026-10-02');
    expect(cardsOf(life)).toEqual({
      statements: [
        { card: 'everyday-card', closingDate: '2026-09-25', dueDate: '2026-10-30', daysLeft: 28, statementBalance: 45_000, minimumPayment: 3_500, paid: 0, standing: 'to-pay' },
        { card: 'second-card', closingDate: '2026-09-28', dueDate: '2026-10-25', daysLeft: 23, statementBalance: 12_050, minimumPayment: 2_500, paid: 0, standing: 'to-pay' },
      ],
      off: [],
    });
  });

  it('9.9 9.3 9.4 each card stands on its own: paid in full, the minimum and past the due date, and overdue', async () => {
    const life = await her((fake) => {
      fake.setStatement(E, statement('2026-09-25', '2026-10-05', 450));
      fake.setStatement(SECOND, statement('2026-09-28', '2026-10-05', 120.5, 25));
    });
    await day(life, '2026-10-02', () => {
      life.h.fake.addPosted({ id: 'pay-e', account: C, amount: 45_000, date: '2026-10-02', description: 'payment to CRD 3333' });
      life.h.fake.addPosted({ id: 'paid-e', account: E, amount: -45_000, date: '2026-10-02', description: 'PAYMENT - THANK YOU' });
    });
    expect(cardsOf(life).statements.map((s) => [s.card, s.standing, s.paid])).toEqual([
      ['everyday-card', 'paid', 45_000],
      ['second-card', 'to-pay', 0],
    ]);
    await day(life, '2026-10-06');
    expect(cardsOf(life).statements.map((s) => s.standing)).toEqual(['paid', 'overdue']);
    await day(life, '2026-10-07', () => {
      life.h.fake.addPosted({ id: 'pay-s', account: C, amount: 2_500, date: '2026-10-07', description: 'payment to CRD 5555' });
      life.h.fake.addPosted({ id: 'paid-s', account: SECOND, amount: -2_500, date: '2026-10-07', description: 'PAYMENT - THANK YOU' });
    });
    expect(cardsOf(life).statements.map((s) => s.standing)).toEqual(['paid', 'minimum-paid']);
  });

  it('9.9 9.3 60i a statement she paid before setup day says paid, as Home does; it does not say overdue', async () => {
    const life = await her((fake) => {
      fake.setStatement(E, statement('2026-09-20', '2026-10-05', 450));
      fake.addPosted({ id: 'pay-c', account: C, amount: 45_000, date: '2026-09-25', description: 'payment to CRD 3333' });
      fake.addPosted({ id: 'paid-e', account: E, amount: -45_000, date: '2026-09-25', description: 'PAYMENT - THANK YOU' });
    });
    await day(life, '2026-10-08');
    expect(cardsOf(life).statements.find((s) => s.card === 'everyday-card')).toMatchObject({ paid: 45_000, standing: 'paid' });
    const home = life.keeper.home();
    expect(home.state === 'tracking' && home.cards?.cards.find((c) => c.card === 'everyday-card')?.statement).toMatchObject({ paid: 45_000, state: { kind: 'paid' } });
  });

  it('9.9 9.8 a card whose statement date is not set says its reminders are off, and the other still shows', async () => {
    const life = await her((fake) => {
      fake.setStatement(E, statement('2026-09-25', '2026-10-30', 450));
      fake.setStatement(SECOND, statement(null, '2026-10-25', 120.5, 25));
    });
    await day(life, '2026-10-02');
    expect(cardsOf(life).statements.map((s) => s.card)).toEqual(['everyday-card']);
    expect(cardsOf(life).off).toEqual([{ card: 'second-card', why: 'no-statement-date' }]);
  });

  it('9.9 Off in this setup: no old card, whatever the made-up bank holds for it', async () => {
    const life = await her((fake) => {
      fake.setStatement(ACCOUNT_IDS.old, statement('2026-09-25', '2026-10-30', 300));
    });
    await day(life, '2026-10-02');
    expect(cardsOf(life).statements).toEqual([]);
    expect(JSON.stringify(cardsOf(life))).not.toContain('old-card');
  });
});

describe('7.7 7.8 through the choice desk', () => {
  it('7.8 what the phone sends for all five parts is read', () => {
    const allFive = { split: [{ bucket: 'not-mine', amount: 1 }, { bucket: 'savings', amount: 2 }, { bucket: 'needs', amount: 3 }, { bucket: 'wishlist', amount: 4 }, { bucket: 'wants', amount: 'rest' }] };
    const good = { id: 'abcd1234', item: 'p1', choice: allFive };
    expect(parseChoiceRequest(good)).toEqual(good);
  });

  it('7.8 a deposit split with Wishlist and the rest in Wants: no thing on her list is asked about, and a restart keeps it', async () => {
    const life = await her();
    const list = addToList(life);
    expect(list).toMatchObject({ ok: true });
    await day(life, '2026-10-02', () => life.h.fake.addPosted({ id: 'cash-1', account: C, amount: -14_000, date: '2026-10-02', description: 'MADE UP ATM DEPOSIT' }));
    const before = life.keeper.book()!.pots();
    const answer = choose(life.keeper, { item: 'cash-1', choice: { split: [{ bucket: 'not-mine', amount: 12_500 }, { bucket: 'wishlist', amount: 1_000 }, { bucket: 'wants', amount: 'rest' }] } });
    expect(answer).toMatchObject({ ok: true });
    const after = life.keeper.book()!.pots();
    expect(after.heldForOthers).toBe(before.heldForOthers + 12_500);
    expect(after.wishlist).toBe((before.wishlist ?? 0) + 1_000);
    expect(after.wants).toBe(before.wants + 500);
    const kept = everything(life.keeper.book()!);
    life.restart();
    expect(everything(life.keeper.book()!)).toEqual(kept);
  });

  it('7.8 picking a thing on her list for money in is refused: it is not a purchase, and nothing changes', async () => {
    const life = await her();
    addToList(life);
    await day(life, '2026-10-02', () => life.h.fake.addPosted({ id: 'cash-1', account: C, amount: -14_000, date: '2026-10-02', description: 'MADE UP ATM DEPOSIT' }));
    const before = life.keeper.book()!.pots();
    const answer = choose(life.keeper, { item: 'cash-1', wishlistItem: 'item-1', choice: { split: [{ bucket: 'wishlist', amount: 1_000 }, { bucket: 'wants', amount: 'rest' }] } });
    expect(answer).toMatchObject({ ok: false });
    expect(life.keeper.book()!.pots()).toEqual(before);
  });

  it.each([
    ['the Capital One card', E],
    ['the Amex card', SECOND],
  ])('7.7 52.4 a purchase on %s marked Other is on its statement, under Other, and the lines add up', async (_name, account) => {
    const card = account === E ? 'everyday-card' : 'second-card';
    const life = await her((fake) => fake.setStatement(account, statement('2026-09-05', '2026-09-30', 0, 0)));
    await day(life, '2026-10-03', () => life.h.fake.addPosted({ id: 'gift-1', account, amount: 2_000, date: '2026-10-03', description: 'MADE UP GIFT' }));
    expect(choose(life.keeper, { item: 'gift-1', choice: { to: 'not-mine' } })).toMatchObject({ ok: true });
    expect(life.keeper.book()!.pots().heldForOthers).toBe(-2_000);
    life.h.fake.setStatement(account, statement('2026-10-05', '2026-10-30', 20));
    await day(life, '2026-10-06');
    const shown = life.keeper.statement(card);
    if (shown.state !== 'ready') throw new Error(`no statement: ${shown.state}`);
    expect(shown.statement.byBucket.map((g) => [g.bucket, g.total])).toEqual([['other', 2_000]]);
    expect(shown.statement.notMatched).toBe(0);
  });
});

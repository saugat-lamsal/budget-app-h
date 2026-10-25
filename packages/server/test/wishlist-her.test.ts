// Her rulebook, PR 9, on the server: the Wishlist bucket through the desks and
// the screens' views. Setup day assigns to it (14.2), the split names it
// (section 2, 13.1), review sorts and splits to it (4.2, 4.4), hand moves go
// in and out of it and ask first out of it (13.3, 13.4), Buckets and its list
// show it, the card's statement lists it (52.4), Home says what to move from
// savings to checking and the card reminders say it too (50.4), and the
// history keeps and replays it. Upstream's setup has none of it. Every name,
// number and date is made up.
import { describe, expect, it } from 'vitest';
import { alertWords } from '../src/alerts/alerts.js';
import { HER_POT_SLUGS, POT_SLUGS } from '../src/views/activity.js';
import { totalsOf } from '../src/history/history.js';
import { shownPayday } from '../src/views/off.js';
import { HER_SWITCHES, UPSTREAM_SWITCHES } from '@budget-app/money';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { herLife } from './her-harness.js';
import { choose, decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

const E = ACCOUNT_IDS.everyday;
const C = ACCOUNT_IDS.checking;

// Setup day with Wishlist: savings 4,000.00, Wishlist 300.00, wants 200.00 and
// the rest in needs; then a split that gives Wishlist 10% from the next paycheck.
async function herWithWishlist(): Promise<Life> {
  const life = await herLife();
  const k = life.keeper;
  for (const setup of [
    { lastPaycheck: '2026-09-25' },
    { assign: { pot: 'savings' as const, amount: 400_000 } },
    { assign: { pot: 'wishlist' as const, amount: 30_000 } },
    { assign: { pot: 'wants' as const, amount: 20_000 } },
    { assign: { pot: 'needs' as const, rest: true as const } },
  ]) {
    const answer = k.setup({ id: decision(), setup });
    if (!answer.ok) throw new Error(`setup day refused ${JSON.stringify(setup)}: ${answer.why}`);
  }
  const view = k.setupView();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
  const started = k.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: view.key });
  if (!started.ok) throw new Error(`tracking did not start: ${started.why}`);
  return life;
}

async function day(life: Life, date: string, items: () => void): Promise<void> {
  items();
  life.now = noonInNewYork(date);
  await life.sync();
}

describe('PR 9 the Wishlist bucket on the server', () => {
  it('14.2 setup day assigns starting money to Wishlist, and the books start with it', async () => {
    const life = await herWithWishlist();
    const buckets = life.keeper.buckets();
    expect(buckets.state === 'tracking' && buckets.wishlist).toBe(30_000);
    expect(buckets.state === 'tracking' && buckets.savings).toBe(400_000);
    life.done();
  });

  it("14.2 upstream's setup day has no Wishlist: assigning to it is refused, and Buckets says nothing of it", async () => {
    const life = await lifeInAFile();
    const refused = life.keeper.setup({ id: decision(), setup: { assign: { pot: 'wishlist', amount: 1 } } });
    expect(refused).toMatchObject({ ok: false, why: 'This setup has no Wishlist. Nothing was changed.' });
    setUpThroughTheDesk(life);
    const buckets = life.keeper.buckets();
    expect(buckets.state === 'tracking' && Object.hasOwn(buckets, 'wishlist')).toBe(false);
    expect(totalsOf(life.keeper.book()) !== null && Object.hasOwn(totalsOf(life.keeper.book()) ?? {}, 'wishlist')).toBe(false);
    life.done();
  });

  it('Section 2: the split names Wishlist; a split without it is refused in words, and nothing changes (13.1)', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    const three = k.settingsChange({ id: decision(), settings: { split: { savings: 50, needs: 30, wants: 20 } } });
    expect(three).toMatchObject({ ok: false });
    expect(!three.ok && three.why).toMatch(/Wishlist/);
    const wrong = k.settingsChange({ id: decision(), settings: { split: { savings: 50, needs: 30, wants: 20, wishlist: 1 } } });
    expect(!wrong.ok && wrong.why).toMatch(/100/);
    const split = { savings: 40, needs: 30, wants: 20, wishlist: 10 };
    const asked = k.settingsChange({ id: decision(), settings: { split } });
    const set = asked.ok ? asked : k.settingsChange({ id: decision(), settings: { split }, confirmed: true, ...(asked.preview === undefined ? {} : { seen: asked.preview.key }) });
    expect(set.ok).toBe(true);
    const view = k.settings();
    expect(view.state === 'tracking' && view.split.fromNextPaycheck.split).toEqual(split);
    expect(view.state === 'tracking' && view.split.thisPayPeriod.split).toEqual({ savings: 50, needs: 30, wants: 20, wishlist: 0 });
    life.done();
  });

  it('4.2 review offers Wishlist and sorts a purchase to it; its list shows the purchase (B97), and the address is /buckets/wishlist', async () => {
    const life = await herWithWishlist();
    await day(life, '2026-10-03', () => life.h.fake.addPosted({ id: 'gadget-1', account: E, amount: 5_000, date: '2026-10-03', description: 'MADE UP GADGETS' }));
    const k = life.keeper;
    const review = k.review();
    const item = review.state === 'tracking' ? review.items.find((i) => i.item.id === 'gadget-1') : undefined;
    expect(item?.options.type === 'sort' && item.options.picks.map((p) => p.to)).toEqual(['needs', 'wants', 'wishlist']);
    expect(choose(k, { item: 'gadget-1', choice: { to: 'wishlist' } }).ok).toBe(true);
    const buckets = k.buckets();
    expect(buckets.state === 'tracking' && buckets.wishlist).toBe(25_000);
    expect(HER_POT_SLUGS['wishlist']).toBe('wishlist');
    expect(Object.hasOwn(POT_SLUGS, 'wishlist')).toBe(false);
    const list = k.activity('wishlist');
    expect(list.state === 'tracking' && list.activity.rows.map((r) => [r.id, r.amount])).toEqual([['gadget-1', -5_000]]);
    expect(list.state === 'tracking' && list.balances['wishlist']).toBe(25_000);
    life.done();
  });

  it('4.4 a purchase split across needs, wants and Wishlist through the desk, with the rest worked out', async () => {
    const life = await herWithWishlist();
    await day(life, '2026-10-03', () => life.h.fake.addPosted({ id: 'store-1', account: E, amount: 9_000, date: '2026-10-03', description: 'MADE UP BIG BOX' }));
    const k = life.keeper;
    const answer = choose(k, { item: 'store-1', choice: { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 2_000 }, { bucket: 'wishlist', amount: 'rest' }] } });
    expect(answer.ok).toBe(true);
    expect(k.book()?.pots().wishlist).toBe(24_000);
    life.done();
  });

  // PR 12, found by the agent on her screens (HB30): the split sheet always
  // sends Wishlist as the rest, so a purchase split across needs and wants
  // only came to a rest of $0.00 and was refused, though 4.4 allows it.
  it('4.4 a purchase split across needs and wants only, with nothing left for the rest: two typed parts that add up to it are the split (HB30)', async () => {
    const life = await herWithWishlist();
    await day(life, '2026-10-03', () => life.h.fake.addPosted({ id: 'store-1', account: E, amount: 6_490, date: '2026-10-03', description: 'MADE UP HARDWARE' }));
    const k = life.keeper;
    const before = k.book()?.pots();
    // As the sheet sends it, with "None of them" for the list's question.
    const answer = choose(k, { item: 'store-1', choice: { split: [{ bucket: 'needs', amount: 4_000 }, { bucket: 'wants', amount: 2_490 }, { bucket: 'wishlist', amount: 'rest' }] }, wishlistItem: 'none' });
    expect(answer.ok && answer.done.choice).toEqual({ split: [{ bucket: 'needs', amount: 4_000 }, { bucket: 'wants', amount: 2_490 }] });
    const after = k.book()?.pots();
    expect([after?.needs, after?.wants, after?.wishlist]).toEqual([(before?.needs ?? 0) - 4_000, (before?.wants ?? 0) - 2_490, before?.wishlist]);
    life.done();
  });

  it('4.4 one typed part that is the whole purchase is still refused with nothing left for the rest (B95), and one cent short leaves a cent for the rest (HB30)', async () => {
    const life = await herWithWishlist();
    await day(life, '2026-10-03', () => life.h.fake.addPosted({ id: 'store-1', account: E, amount: 6_490, date: '2026-10-03', description: 'MADE UP HARDWARE' }));
    const k = life.keeper;
    const before = k.book()?.pots();
    const one = choose(k, { item: 'store-1', choice: { split: [{ bucket: 'needs', amount: 6_490 }, { bucket: 'wishlist', amount: 'rest' }] }, wishlistItem: 'none' });
    expect(one).toMatchObject({ ok: false, code: 'refused', why: 'Nothing is left for Wishlist: the other parts already add up to $64.90. Nothing was changed.' });
    const over = choose(k, { item: 'store-1', choice: { split: [{ bucket: 'needs', amount: 4_000 }, { bucket: 'wants', amount: 2_491 }, { bucket: 'wishlist', amount: 'rest' }] }, wishlistItem: 'none' });
    expect(over).toMatchObject({ ok: false, code: 'refused' });
    expect(k.book()?.pots()).toEqual(before);
    const cent = choose(k, { item: 'store-1', choice: { split: [{ bucket: 'needs', amount: 4_000 }, { bucket: 'wants', amount: 2_489 }, { bucket: 'wishlist', amount: 'rest' }] }, wishlistItem: 'none' });
    expect(cent.ok && cent.done.choice).toEqual({ split: [{ bucket: 'needs', amount: 4_000 }, { bucket: 'wants', amount: 2_489 }, { bucket: 'wishlist', amount: 1 }] });
    life.done();
  });

  it("3.8 Payday says what should be in the savings account is savings plus Wishlist; upstream's Payday is as it was", async () => {
    const life = await herWithWishlist();
    const view = life.keeper.payday();
    expect(shownPayday(view, HER_SWITCHES)).toMatchObject({ state: 'tracking', withWishlist: true });
    expect(shownPayday(view, { ...HER_SWITCHES, wishlist: 'off' })).not.toHaveProperty('withWishlist');
    expect(shownPayday(view, UPSTREAM_SWITCHES)).toBe(view);
    life.done();
  });

  it('13.4 a hand move out of Wishlist asks first, saying it takes money out of Wishlist; into it asks nothing', async () => {
    const life = await herWithWishlist();
    const k = life.keeper;
    const asked = k.move({ id: decision(), move: { from: 'wishlist', to: 'wants', amount: 1_000 } });
    expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation' });
    expect(!asked.ok && asked.why).toContain('takes money out of Wishlist');
    expect(k.book()?.pots().wishlist).toBe(30_000);
    expect(k.move({ id: decision(), move: { from: 'wishlist', to: 'wants', amount: 1_000 }, confirmed: true }).ok).toBe(true);
    expect(k.move({ id: decision(), move: { from: 'needs', to: 'wishlist', amount: 2_000 } }).ok).toBe(true);
    expect(k.book()?.pots().wishlist).toBe(31_000);
    life.done();
  });

  it('50.4 Home says to move a Wishlist purchase from savings to checking, before the card is due; it goes away once moved', async () => {
    const life = await herWithWishlist();
    await day(life, '2026-10-03', () => life.h.fake.addPosted({ id: 'gadget-1', account: E, amount: 5_000, date: '2026-10-03', description: 'MADE UP GADGETS' }));
    const k = life.keeper;
    const before = k.home();
    expect(before.state === 'tracking' && 'wishlistMove' in before).toBe(false);
    choose(k, { item: 'gadget-1', choice: { to: 'wishlist' } });
    const home = k.home();
    expect(home.state === 'tracking' && 'wishlistMove' in home && home.wishlistMove).toMatchObject({ amount: 5_000, when: { kind: 'before-next-due', card: 'everyday-card' }, cards: ['everyday-card'] });
    // The card's statement closes after it: before that card's due date.
    await day(life, '2026-10-05', () =>
      life.h.fake.setStatement(E, { is_overdue: false, last_payment_amount: 0, last_payment_date: '2026-09-10', last_statement_issue_date: '2026-10-05', last_statement_balance: 50, minimum_payment_amount: 25, next_payment_due_date: '2026-10-30' }),
    );
    const due = k.home();
    expect(due.state === 'tracking' && 'wishlistMove' in due && due.wishlistMove?.when).toEqual({ kind: 'before-due', card: 'everyday-card', dueDate: '2026-10-30', day: 'before' });
    // She moves it: a transfer from savings to checking, which is not spending (5.3).
    await day(life, '2026-10-06', () => {
      life.h.fake.addPosted({ id: 'move-out', account: ACCOUNT_IDS.savings, amount: 5_000, date: '2026-10-06', description: 'Online transfer to CHK 1111' });
      life.h.fake.addPosted({ id: 'move-in', account: C, amount: -5_000, date: '2026-10-06', description: 'Online transfer from SAV 2222' });
    });
    const moved = k.home();
    expect(moved.state === 'tracking' && 'wishlistMove' in moved).toBe(false);
    expect(k.book()?.pots().wishlist).toBe(25_000);
    life.done();
  });

  it('50.4 a card reminder says it too while it is not moved, with the amount only where the lock screen setting allows it (10.10)', () => {
    const facts = { kind: 'card-reminder' as const, card: 'everyday-card' as const, dueDate: '2026-10-30', daysBefore: 7, minimumPayment: 2_500, statementBalance: 5_000, name: 'Made-up Everyday Card', wishlistMove: 5_000 };
    expect(alertWords(facts, { amounts: true }).body).toBe('Statement balance $50.00, minimum $25.00. Due Fri, Oct 30. Move $50.00 from savings to checking for Wishlist first.');
    expect(alertWords(facts, { amounts: false }).body).toBe('Due Fri, Oct 30. Move the Wishlist money from savings to checking first.');
    const { wishlistMove: _move, ...plain } = facts;
    expect(alertWords(plain, { amounts: true }).body).toBe('Statement balance $50.00, minimum $25.00. Due Fri, Oct 30.');
  });

  it('0.6 the history keeps Wishlist in its totals, and a restart replays to them', async () => {
    const life = await herWithWishlist();
    await day(life, '2026-10-03', () => life.h.fake.addPosted({ id: 'gadget-1', account: E, amount: 5_000, date: '2026-10-03', description: 'MADE UP GADGETS' }));
    choose(life.keeper, { item: 'gadget-1', choice: { to: 'wishlist' } });
    expect(totalsOf(life.keeper.book())).toMatchObject({ wishlist: 25_000 });
    const pots = life.keeper.book()?.pots();
    life.restart();
    expect(life.keeper.book()?.pots()).toEqual(pots);
    life.done();
  });

  it('52.4 the statement screen lists a Wishlist purchase under Wishlist', async () => {
    const life = await herWithWishlist();
    await day(life, '2026-10-03', () => life.h.fake.addPosted({ id: 'gadget-1', account: E, amount: 5_000, date: '2026-10-03', description: 'MADE UP GADGETS' }));
    choose(life.keeper, { item: 'gadget-1', choice: { to: 'wishlist' } });
    await day(life, '2026-10-05', () =>
      life.h.fake.setStatement(E, { is_overdue: false, last_payment_amount: 0, last_payment_date: '2026-09-10', last_statement_issue_date: '2026-10-05', last_statement_balance: 500, minimum_payment_amount: 25, next_payment_due_date: '2026-10-30' }),
    );
    const view = life.keeper.statement('everyday-card');
    expect(view.state === 'ready' && view.statement.byBucket.find((g) => g.bucket === 'wishlist')?.total).toBe(5_000);
    life.done();
  });
});

import { HER_SETTINGS, OLDER_PAYCHECK_FIRST, splitPaycheck, type Book } from '@budget-app/money';
import { afterEach, describe, expect, it } from 'vitest';
import { alertScreen, alertWords, type AlertFacts } from '../src/alerts/alerts.js';
import { readOutbox } from '../src/alerts/outbox.js';
import { NO_ALERTS, stillTrueNow } from '../src/alerts/plan.js';
import { sendKindOf } from '../src/alerts/sending.js';
import { parseSettingsRequest } from '../src/choices.js';
import { memoryLog } from '../src/log.js';
import { AlertTimer } from '../src/serve/alert-timer.js';
import type { ReviewView } from '../src/views/index.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';
import { herLife, setUpHer } from './her-harness.js';
import { choose, decision, everything, noonInNewYork, type Life } from './keeper-harness.js';

// Her rulebook, PR 4: "Ask before splitting a paycheck" (section 2, 3.1,
// 51.1 to 51.3, 10.15, 13.2) on the real server's books, her setup: the
// alert, Home's card, Review's paycheck through the choice desk, a split
// change while it waits (13.7), two waiting (51.2), the same yes sent twice
// (B92), and a restart with one waiting. The money math's own tests:
// packages/money/test/paycheck-ask-her.test.ts. Every name and number is
// made up. The times are in New York (EDT in October: noon is 16:00 UTC).

const C = ACCOUNT_IDS.checking;
const PAYROLL = 'MADEUP CORP PAYROLL';
const PAY = 250_000;

// Her setup day (savings $4,000.00, wants $200.00, the rest in needs), then
// the paycheck rule set, as she does on Settings.
async function herBooks(): Promise<Life> {
  const life = await herLife();
  setUpHer(life);
  const id = decision();
  const settings = { paycheckRule: { contains: PAYROLL } };
  const asked = life.keeper.settingsChange({ id, settings });
  if (asked.ok || asked.code !== 'needs-confirmation' || asked.preview === undefined) throw new Error(`the paycheck rule: ${JSON.stringify(asked)}`);
  const set = life.keeper.settingsChange({ id, settings, confirmed: true, seen: asked.preview.key });
  if (!set.ok) throw new Error(set.why);
  return life;
}

async function paycheckPosts(life: Life, id: string, date: string, amount = PAY, at = noonInNewYork(date)): Promise<void> {
  life.h.fake.addPosted({ id, account: C, amount: -amount, date, description: `${PAYROLL} DIRECT DEP` });
  life.now = at;
  await life.sync();
}

function bookOf(life: Life): Book {
  const book = life.keeper.book();
  if (book === null) throw new Error('no books');
  return book;
}

function reviewItem(life: Life, id: string): Extract<ReviewView, { state: 'tracking' }>['items'][number] {
  const view = life.keeper.review();
  if (view.state !== 'tracking') throw new Error('not tracking');
  const item = view.items.find((i) => i.item.id === id);
  if (item === undefined) throw new Error(`${id} is not waiting`);
  return item;
}

const waitingRows = (life: Life) => readOutbox(life.h.db, 50).rows.filter((r) => r.kind === 'paycheck-waiting');

describe('10.15 a paycheck waiting for her yes, told once when it posts', () => {
  const lives: { life: Life; timer: AlertTimer }[] = [];
  afterEach(async () => {
    for (const { life, timer } of lives.splice(0)) {
      await timer.stop();
      life.done();
    }
  });

  async function withTimer(life: Life): Promise<{ timer: AlertTimer; clock: FakeClock; phone: FakePhone }> {
    const clock = new FakeClock(life);
    const phone = new FakePhone(() => life.now);
    const timer = new AlertTimer({ alerter: life.keeper, sender: phone, clock, log: memoryLog([]) });
    lives.push({ life, timer });
    life.keeper.whenChanged(() => timer.poke());
    timer.start();
    await timer.idle();
    return { timer, clock, phone };
  }

  it('10.15 told once, when it posts; a tap opens Review; with the lock screen setting off (10.10), words only', async () => {
    const life = await herBooks();
    const { timer, phone } = await withTimer(life);
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    await timer.idle();
    expect(waitingRows(life)).toMatchObject([{ key: 'paycheck-waiting pay-1', dueAt: '2026-10-09T16:00:00.000Z', facts: { kind: 'paycheck-waiting', id: 'pay-1', date: '2026-10-09', amount: PAY, early: false } }]);
    expect(phone.shown.filter((s) => s.id === 'paycheck-waiting pay-1')).toEqual([
      { id: 'paycheck-waiting pay-1', title: 'Paycheck waiting for your yes', body: 'A paycheck came in Fri, Oct 9. Nothing is split until you say yes in Review.', dueAt: '2026-10-09T16:00:00.000Z', due: null, screen: '/review', at: '2026-10-09T16:00:00.000Z' },
    ]);
    // The next sync and look tell nothing more about it.
    life.now = new Date('2026-10-09T18:00:00Z');
    await life.sync();
    await timer.idle();
    expect(waitingRows(life)).toHaveLength(1);
    expect(phone.shown.filter((s) => s.id === 'paycheck-waiting pay-1')).toHaveLength(1);
  });

  it('10.15 10.8 quiet hours apply: one that posts at 11:30 PM goes at 7:00 AM, saying when it was due', async () => {
    const life = await herBooks();
    const { timer, clock, phone } = await withTimer(life);
    await paycheckPosts(life, 'pay-1', '2026-10-09', PAY, new Date('2026-10-10T03:30:00Z'));
    await timer.idle();
    expect(waitingRows(life)).toMatchObject([{ key: 'paycheck-waiting pay-1', dueAt: '2026-10-10T03:30:00.000Z', sentAt: null }]);
    expect(phone.shown.filter((s) => s.id === 'paycheck-waiting pay-1')).toEqual([]);
    await clock.advance(Date.parse('2026-10-10T11:00:00Z') - life.now.getTime(), () => timer.idle());
    expect(phone.shown.filter((s) => s.id === 'paycheck-waiting pay-1')).toMatchObject([{ due: 'Was due Fri, Oct 9, 11:30 PM.', screen: '/review', at: '2026-10-10T11:00:00.000Z' }]);
  });

  it('10.15 10.10 with amounts on the lock screen, it says the amount', async () => {
    const life = await herBooks();
    const id = decision();
    expect(life.keeper.settingsChange({ id, settings: { amountsOnLockScreen: true } })).toMatchObject({ ok: true });
    const { timer, phone } = await withTimer(life);
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    await timer.idle();
    expect(phone.shown.find((s) => s.id === 'paycheck-waiting pay-1')?.body).toBe('$2,500.00 came in Fri, Oct 9. Nothing is split until you say yes in Review.');
  });

  it('10.15 10.14 the payday alert comes at her yes, not before', async () => {
    const life = await herBooks();
    const { timer } = await withTimer(life);
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    await timer.idle();
    const paydays = () => readOutbox(life.h.db, 50).rows.filter((r) => r.kind === 'payday');
    expect(paydays()).toEqual([]);
    life.now = new Date('2026-10-11T14:00:00Z');
    expect(choose(life.keeper, { item: 'pay-1', choice: { to: 'paycheck' }, confirmed: true })).toMatchObject({ ok: true });
    await timer.idle();
    expect(paydays()).toMatchObject([{ key: 'payday pay period 1', dueAt: '2026-10-11T14:00:00.000Z', facts: { kind: 'payday', period: 1, date: '2026-10-09' } }]);
  });

  it('10.15 10.9 once she has answered it, it is no longer true: one the phone could not be given yet is not sent', async () => {
    const life = await herBooks();
    lives.push({ life, timer: new AlertTimer({ alerter: life.keeper, sender: new FakePhone(() => life.now), clock: new FakeClock(life), log: memoryLog([]) }) });
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    const facts: AlertFacts = { kind: 'paycheck-waiting', id: 'pay-1', date: '2026-10-09', amount: PAY, early: false };
    const world = { book: bookOf(life), now: life.now, zone: 'America/New_York', bank: null, needsLogin: false, statements: [], lastRead: null };
    expect(stillTrueNow(world, NO_ALERTS, facts)).toBe(true);
    expect(choose(life.keeper, { item: 'pay-1', choice: { to: 'other-income' } })).toMatchObject({ ok: true });
    expect(stillTrueNow({ ...world, book: bookOf(life) }, NO_ALERTS, facts)).toBe(false);
  });

  it('10.15 an early one (51.3) says so; a tap opens Review; each waiting paycheck is its own', () => {
    const facts: AlertFacts = { kind: 'paycheck-waiting', id: 'pay-2', date: '2026-10-14', amount: PAY, early: true };
    expect(alertWords(facts)).toEqual({ title: 'Paycheck waiting for your yes', body: '$2,500.00 came in Wed, Oct 14. Nothing is split until you say yes in Review. It came less than 10 days after your last one.' });
    expect(alertWords(facts, { amounts: false }).body).not.toContain('$');
    expect(alertScreen(facts)).toBe('/review');
    // Each waiting paycheck is its own: a newer one never replaces it.
    expect(sendKindOf('paycheck-waiting pay-2', facts)).toBe('paycheck-waiting pay-2');
  });
});

describe('51.1 3.1 her paycheck waiting, on Home and in Review, through the choice desk', () => {
  const lives: Life[] = [];
  afterEach(() => {
    for (const life of lives.splice(0)) life.done();
  });
  async function books(): Promise<Life> {
    const life = await herBooks();
    lives.push(life);
    return life;
  }

  it('51.1 Home says "Paycheck waiting for your yes" with its amount, before what waits in Review; safe to spend leaves it out', async () => {
    const life = await books();
    const before = life.keeper.home();
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    const home = life.keeper.home();
    if (home.state !== 'tracking' || before.state !== 'tracking') throw new Error('not tracking');
    expect(home.attention.map((a) => a.kind)).toEqual(['paycheck-waiting', 'review']);
    expect(home.attention[0]).toEqual({ kind: 'paycheck-waiting', id: 'pay-1', date: '2026-10-09', amount: PAY, early: false });
    expect(home.safeToSpend).toEqual(before.safeToSpend);
    // The self-check counts it (12.2): the totals still match the bank.
    expect(home.safeToSpend.shown).toBe(true);
  });

  it('3.1 Review shows the amount and what each bucket would get; yes asks first, then splits it from the day it arrived', async () => {
    const life = await books();
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    const item = reviewItem(life, 'pay-1');
    expect(item.item).toMatchObject({ type: 'money-in', reason: 'paycheck', amount: PAY });
    expect(item.paycheckPreview).toEqual(splitPaycheck(PAY, 0, HER_SETTINGS));
    life.now = new Date('2026-10-12T14:00:00Z');
    const id = decision();
    // Straight to the desk: the harness's choose gives the yes itself when asked.
    expect(life.keeper.choice({ id, item: 'pay-1', choice: { to: 'paycheck' }, seen: item.key })).toMatchObject({ ok: false, code: 'needs-confirmation' });
    expect(bookOf(life).paychecks()).toEqual([]);
    expect(life.keeper.choice({ id, item: 'pay-1', choice: { to: 'paycheck' }, seen: item.key, confirmed: true })).toMatchObject({ ok: true });
    expect(bookOf(life).period()).toEqual({ number: 1, startDate: '2026-10-09' });
  });

  it('3.1 "Not a paycheck": other income, payback or not mine, through the desk', async () => {
    const life = await books();
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    const item = reviewItem(life, 'pay-1');
    expect(item.options.type === 'sort' && item.options.picks.map((p) => p.to)).toEqual(['paycheck', 'other-income', 'savings', 'needs', 'wants', 'not-mine']);
    expect(choose(life.keeper, { item: 'pay-1', choice: { to: 'not-mine' }, seen: item.key })).toMatchObject({ ok: true });
    expect(bookOf(life).pots().heldForOthers).toBe(PAY);
    expect(bookOf(life).period().number).toBe(0);
  });

  it('51.1 13.7 a split change while it waits: Review shows the new parts; a yes about the old parts is refused, and nothing changes', async () => {
    const life = await books();
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    const shown = reviewItem(life, 'pay-1');
    expect(life.keeper.settingsChange({ id: decision(), settings: { split: { savings: 60, needs: 25, wants: 15 } } })).toMatchObject({ ok: true });
    const now = reviewItem(life, 'pay-1');
    expect(now.paycheckPreview).toMatchObject({ savings: 150_000, needs: 62_500, wants: 37_500 });
    expect(now.key).not.toBe(shown.key);
    const before = everything(bookOf(life));
    const refused = choose(life.keeper, { item: 'pay-1', choice: { to: 'paycheck' }, seen: shown.key, confirmed: true });
    expect(refused).toMatchObject({ ok: false, code: 'changed' });
    expect(everything(bookOf(life))).toEqual(before);
    expect(choose(life.keeper, { item: 'pay-1', choice: { to: 'paycheck' }, seen: now.key, confirmed: true })).toMatchObject({ ok: true });
    expect(bookOf(life).paychecks()[0]?.split).toMatchObject({ savings: 150_000, needs: 62_500, wants: 37_500 });
  });

  it('51.2 through the desk: a yes to the newer one is refused while the older one waits, and says so; nothing changes', async () => {
    const life = await books();
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    await paycheckPosts(life, 'pay-2', '2026-10-23', 240_000);
    const newer = reviewItem(life, 'pay-2');
    expect(newer.options.type === 'sort' && newer.options.unavailable).toEqual([{ what: 'paycheck', why: OLDER_PAYCHECK_FIRST }]);
    const before = everything(bookOf(life));
    const refused = choose(life.keeper, { item: 'pay-2', choice: { to: 'paycheck' }, seen: newer.key, confirmed: true });
    expect(refused).toEqual({ ok: false, code: 'refused', why: 'An older paycheck is still waiting. Answer it first. Nothing was changed.' });
    expect(everything(bookOf(life))).toEqual(before);
    expect(choose(life.keeper, { item: 'pay-1', choice: { to: 'paycheck' }, confirmed: true })).toMatchObject({ ok: true });
    expect(choose(life.keeper, { item: 'pay-2', choice: { to: 'paycheck' }, confirmed: true })).toMatchObject({ ok: true });
    expect(bookOf(life).paychecks().map((p) => p.date)).toEqual(['2026-10-09', '2026-10-23']);
  });

  it('B92 the same yes sent twice (a double tap, a retry) is done once', async () => {
    const life = await books();
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    const id = decision();
    const yes = { item: 'pay-1', choice: { to: 'paycheck' as const }, confirmed: true };
    expect(choose(life.keeper, yes, id)).toMatchObject({ ok: true, replayed: false });
    const after = everything(bookOf(life));
    expect(choose(life.keeper, yes, id)).toMatchObject({ ok: true, replayed: true });
    expect(everything(bookOf(life))).toEqual(after);
    // Another number for it: already dealt with.
    expect(choose(life.keeper, yes)).toMatchObject({ ok: false, code: 'not-waiting' });
    expect(bookOf(life).paychecks()).toHaveLength(1);
  });

  it('3.1 0.6 a restart with a paycheck waiting: it still waits, its alert is not told again, and her yes after it splits it from the day it arrived', async () => {
    const life = await books();
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    life.keeper.checkAlerts();
    expect(waitingRows(life)).toHaveLength(1);
    const before = everything(bookOf(life));
    life.now = new Date('2026-10-10T14:00:00Z');
    life.restart();
    expect(everything(bookOf(life))).toEqual(before);
    expect(bookOf(life).paychecksWaiting().map((p) => p.id)).toEqual(['pay-1']);
    life.keeper.checkAlerts();
    expect(waitingRows(life)).toHaveLength(1);
    expect(choose(life.keeper, { item: 'pay-1', choice: { to: 'paycheck' }, confirmed: true })).toMatchObject({ ok: true });
    life.restart();
    expect(bookOf(life).period()).toEqual({ number: 1, startDate: '2026-10-09' });
    expect(bookOf(life).paychecksWaiting()).toEqual([]);
  });
});

describe('Section 2 and 13.2: the setting and the paycheck rule, on the real server', () => {
  const lives: Life[] = [];
  afterEach(() => {
    for (const life of lives.splice(0)) life.done();
  });

  it('Section 2: her setup day starts with it on; Settings shows it; the desk takes on or off only, and logs the change (13.5)', async () => {
    const life = await herBooks();
    lives.push(life);
    const view = life.keeper.settings();
    expect(view.state === 'tracking' && view.settings.askBeforeSplittingPaycheck).toBe(true);
    expect(parseSettingsRequest({ id: decision(), settings: { askBeforeSplittingPaycheck: 'yes' } })).toBeNull();
    expect(parseSettingsRequest({ id: decision(), settings: { askBeforeSplittingPaycheck: 1 } })).toBeNull();
    for (const on of [true, false]) expect(parseSettingsRequest({ id: 'decision-ask', settings: { askBeforeSplittingPaycheck: on } })).toEqual({ id: 'decision-ask', settings: { askBeforeSplittingPaycheck: on } });
    expect(life.keeper.settingsChange({ id: decision(), settings: { askBeforeSplittingPaycheck: false } })).toMatchObject({ ok: true, done: { changed: ['askBeforeSplittingPaycheck'], fromNextPaycheck: false } });
    const after = life.keeper.settings();
    if (after.state !== 'tracking') throw new Error('not tracking');
    expect(after.settings.askBeforeSplittingPaycheck).toBe(false);
    expect(after.log.find((l) => l.kind === 'setting')).toMatchObject({ kind: 'setting', change: { key: 'askBeforeSplittingPaycheck', before: true, after: false } });
    // Off: the next paycheck is split by itself.
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    expect(bookOf(life).period()).toEqual({ number: 1, startDate: '2026-10-09' });
  });

  it('13.2 setting the paycheck rule while asking: the preview says the waiting deposit becomes a paycheck waiting for her yes, and nothing is split', async () => {
    const life = await herLife();
    lives.push(life);
    setUpHer(life);
    await paycheckPosts(life, 'pay-1', '2026-10-09');
    expect(reviewItem(life, 'pay-1').item).toMatchObject({ reason: 'deposit' });
    const id = decision();
    const settings = { paycheckRule: { contains: PAYROLL } };
    const asked = life.keeper.settingsChange({ id, settings });
    if (asked.ok || asked.preview === undefined) throw new Error('expected to be asked first');
    expect(asked.preview.items).toMatchObject([{ kind: 'paycheck-waiting', id: 'pay-1', amount: PAY, wouldGet: splitPaycheck(PAY, 0, HER_SETTINGS) }]);
    const pots = bookOf(life).pots();
    expect(life.keeper.settingsChange({ id, settings, confirmed: true, seen: asked.preview.key })).toMatchObject({ ok: true });
    expect(bookOf(life).pots()).toEqual(pots);
    expect(reviewItem(life, 'pay-1').item).toMatchObject({ reason: 'paycheck' });
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnyPot, Cents, IsoDate } from '@budget-app/money';
import { expect, it } from 'vitest';
import { checkBankRules } from '../src/bank/reading.js';
import { Keeper } from '../src/history/keeper.js';
import { memoryLog } from '../src/log.js';
import { HER_START } from '../src/setup-start.js';
import type { ChoiceOf, ChoiceRequest } from '../src/views/choice.js';
import { DAYS, SETUP_DAY, history, postedBeforeHistory } from '../../web/test/browser/pay-period-her/days-her.js';
import { bothBanks, connected } from './harness.js';
import { HER_BANK_RULES } from './her-harness.js';
import { choose, decision } from './keeper-harness.js';

// PR 12, the end check: her pay period (days-her.ts, the one the agent lives
// on her screens, agent-pay-period-h/script.txt) through the real server's
// books and desks, with the script's answers. Every day the self-check
// matches the banks (12.3), but on Oct 7, while her second bank wants a new
// login (0.5, 10.5); and every bucket at the end of each day is the one
// worked out by hand below. So the agent's days stay a pay period whose
// numbers are known. Every name and number is made up.

const RULES = checkBankRules([
  ...HER_BANK_RULES,
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);

interface Pots {
  readonly savings: Cents;
  readonly needs: Cents;
  readonly wants: Cents;
  readonly wishlist: Cents;
  readonly heldForOthers: Cents;
}

// By hand. Setup day: starting money 1,840.25 + 4,300.00 - 312.40 - 42.18
// pending - 186.75 + 100.00 on its way = 5,698.92 (14.2); savings 3,000.00,
// Wishlist 150.00, wants 250.00, needs the rest, 2,298.92.
const SET_UP: Pots = { savings: 300_000, needs: 229_892, wants: 25_000, wishlist: 15_000, heldForOthers: 0 };
const BY_HAND: Readonly<Record<IsoDate, Pots>> = {
  // The cafe's 5.60 pending, to wants by the rule; the paycheck waits (51.1).
  '2026-10-02': { ...SET_UP, wants: 24_440 },
  // The cafe posts at 6.60 (4.6): wants 243.40. Her yes: 2,600.00 at 40/30/20/10
  // is savings 1,040.00, needs 780.00, wants 520.00, Wishlist 260.00 (3.3);
  // needs rolls over, wants' 243.40 moves to savings (3.4); the bookshop 23.45.
  // Savings 3,000.00 + 1,040.00 + 243.40; needs 2,298.92 + 780.00;
  // wants 520.00 - 23.45; Wishlist 150.00 + 260.00.
  '2026-10-03': { savings: 428_340, needs: 307_892, wants: 49_655, wishlist: 41_000, heldForOthers: 0 },
  // Hardware 40.00 needs and 24.90 wants (4.4); the pharmacy 18.35 needs.
  '2026-10-04': { savings: 428_340, needs: 302_057, wants: 47_165, wishlist: 41_000, heldForOthers: 0 },
  // The audio 114.99 from Wishlist (50.3); the friend 20.00 wants, 10.00 not mine (7.6).
  '2026-10-05': { savings: 428_340, needs: 302_057, wants: 45_165, wishlist: 29_501, heldForOthers: -1_000 },
  // The gas 38.00 needs, sorted while pending.
  '2026-10-06': { savings: 428_340, needs: 298_257, wants: 45_165, wishlist: 29_501, heldForOthers: -1_000 },
  '2026-10-07': { savings: 428_340, needs: 298_257, wants: 45_165, wishlist: 29_501, heldForOthers: -1_000 },
  // The cinema 16.00 wants, read once the second bank can be again.
  '2026-10-08': { savings: 428_340, needs: 298_257, wants: 43_565, wishlist: 29_501, heldForOthers: -1_000 },
  '2026-10-09': { savings: 428_340, needs: 298_257, wants: 43_565, wishlist: 29_501, heldForOthers: -1_000 },
  // 24.90 of the hardware back (4.5): the purchase back in review, all 40.00 of
  // it to needs, so wants gets its 24.90 back.
  '2026-10-10': { savings: 428_340, needs: 298_257, wants: 46_055, wishlist: 29_501, heldForOthers: -1_000 },
  // The friend's 10.00, not mine (7.1): held for others back to 0.00 (7.3).
  '2026-10-11': { savings: 428_340, needs: 298_257, wants: 46_055, wishlist: 29_501, heldForOthers: 0 },
  // The lamp 45.00 from Wishlist; 25.00 moved from wants to needs (13.3).
  '2026-10-12': { savings: 428_340, needs: 300_757, wants: 43_555, wishlist: 25_001, heldForOthers: 0 },
  '2026-10-13': { savings: 428_340, needs: 300_757, wants: 43_555, wishlist: 25_001, heldForOthers: 0 },
  // 40.00 other income at this pay period's 40/30/20/10 (6.1, 13.1): 16.00, 12.00, 8.00, 4.00.
  '2026-10-14': { savings: 429_940, needs: 301_957, wants: 44_355, wishlist: 25_401, heldForOthers: 0 },
  '2026-10-15': { savings: 429_940, needs: 301_957, wants: 44_355, wishlist: 25_401, heldForOthers: 0 },
  // Her yes the same day, at the new 35/30/20/15 (13.1): savings 910.00, needs
  // 780.00, wants 520.00, Wishlist 390.00; needs' 3,019.57 moves to savings,
  // wants rolls over. Savings 4,299.40 + 910.00 + 3,019.57; wants 443.55 + 520.00;
  // Wishlist 254.01 + 390.00.
  '2026-10-16': { savings: 822_897, needs: 78_000, wants: 96_355, wishlist: 64_401, heldForOthers: 0 },
};

it('PR 12 her pay period through the desks: every day the self-check matches but while a bank wants a login, and every bucket is as worked by hand', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'budget-pay-period-her-'));
  const start = postedBeforeHistory();
  const h = await connected({ posted: { checking: start.checking, savings: start.savings, everyday: start.capitalOne, old: 0 }, secondCard: start.amex, history, rules: RULES, today: SETUP_DAY, path: join(dir, 'books.sqlite'), herSetup: true, twoBanks: true });
  try {
    const second = h.second;
    if (second === undefined) throw new Error('her second bank is not connected');
    const banks = bothBanks(h.fake, second);
    let now = new Date(`${SETUP_DAY}T13:00:00Z`);
    const k = Keeper.open({ db: h.db, now: () => now, log: memoryLog([]), start: HER_START });
    const ok = (what: string, r: { readonly ok: boolean }): void => {
      if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`);
    };

    // Setup day, as the script says.
    const view = k.setupView();
    for (const half of view.state === 'not-set-up' && view.ready ? view.halves : []) ok('on its way', k.setup({ id: decision(), setup: { onItsWay: { half: half.id, answer: true } } }));
    for (const setup of [{ lastPaycheck: '2026-09-18' }, { assign: { pot: 'savings' as const, amount: 300_000 } }, { assign: { pot: 'wishlist' as const, amount: 15_000 } }, { assign: { pot: 'wants' as const, amount: 25_000 } }, { assign: { pot: 'needs' as const, rest: true as const } }]) ok(JSON.stringify(setup), k.setup({ id: decision(), setup }));
    const ready = k.setupView();
    if (ready.state !== 'not-set-up' || !ready.ready) throw new Error('setup day is not ready');
    ok('start', k.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: ready.key }));
    const settings = (patch: Parameters<Keeper['settingsChange']>[0]['settings']): void => {
      const id = decision();
      const first = k.settingsChange({ id, settings: patch });
      if (first.ok) return;
      ok('settings', k.settingsChange({ id, settings: patch, confirmed: true, ...(first.preview === undefined ? {} : { seen: first.preview.key }) }));
    };
    const wish = (wishlist: Parameters<Keeper['wishlist']>[0]['wishlist']): void => ok('wishlist', k.wishlist({ id: decision(), wishlist, confirmed: true }));
    settings({ split: { savings: 40, needs: 30, wants: 20, wishlist: 10 } });
    settings({ paycheckRule: { contains: 'MADEUP CORP PAYROLL' } });
    ok('rule', k.ruleChange({ id: decision(), rule: { add: { for: 'purchase', contains: 'GROCER', to: 'needs' } } }));
    ok('rule', k.ruleChange({ id: decision(), rule: { add: { for: 'purchase', contains: 'CAFE', to: 'wants' } } }));
    wish({ add: { name: 'Made-up headphones', price: 12_000 } });
    wish({ add: { name: 'Made-up jacket', price: 9_000 } });
    wish({ add: { name: 'Made-up lamp', price: 4_500 } });
    expect(potsOf(k)).toEqual(SET_UP);

    const reviewItems = () => {
      const review = k.review();
      return review.state === 'tracking' ? review.items : [];
    };
    const listed = () => {
      const activity = k.activity('wishlist');
      return activity.state === 'tracking' ? (activity.wishlistItems ?? []) : [];
    };
    const waiting = (text: string): string => {
      const found = reviewItems().find((i) => JSON.stringify(i.item).includes(text));
      if (found === undefined) throw new Error(`nothing waiting like ${text}`);
      return found.item.id;
    };
    const pick = (text: string, choice: ChoiceOf, extra: Partial<ChoiceRequest> = {}): void => ok(text, choose(k, { item: waiting(text), choice, ...extra }));
    const item = (name: string): string => {
      const found = listed().find((i) => i.name === name);
      if (found === undefined) throw new Error(`no ${name} on the list`);
      return found.id;
    };
    const leftovers = (needs: 'roll-over' | 'move-to-savings', wants: 'roll-over' | 'move-to-savings'): void => {
      pick('"bucket":"needs"', { leftover: needs });
      pick('"bucket":"wants"', { leftover: wants });
    };
    const answers: Readonly<Record<IsoDate, () => void>> = {
      '2026-10-03': () => {
        pick('MADEUP CORP PAYROLL', { to: 'paycheck' });
        leftovers('roll-over', 'move-to-savings');
        pick('MADE UP BOOKSHOP', { to: 'wants' });
      },
      '2026-10-04': () => {
        pick('MADE UP HARDWARE', { split: [{ bucket: 'needs', amount: 4_000 }, { bucket: 'wants', amount: 'rest' }] });
        pick('MADE UP PHARMACY', { to: 'needs' });
      },
      '2026-10-05': () => {
        pick('MADE UP AUDIO', { to: 'wishlist' }, { wishlistItem: item('Made-up headphones') });
        pick('MADE UP FRIEND', { split: [{ bucket: 'wants', amount: 2_000 }, { bucket: 'not-mine', amount: 'rest' }] });
      },
      '2026-10-06': () => pick('MADE UP GAS', { to: 'needs' }),
      '2026-10-08': () => pick('MADE UP CINEMA', { to: 'wants' }),
      '2026-10-09': () => {
        settings({ split: { savings: 35, needs: 30, wants: 20, wishlist: 15 } });
        wish({ add: { name: 'Made-up rug', price: 6_000 } });
        wish({ move: { item: item('Made-up rug'), direction: 'up' } });
      },
      '2026-10-10': () => {
        pick('MADE UP HARDWARE', { refundOf: 'hardware-1004' });
        pick('MADE UP HARDWARE', { split: [{ bucket: 'needs', amount: 'rest' }] });
      },
      '2026-10-11': () => pick('MADE UP FRIEND PAID BACK', { to: 'not-mine' }),
      '2026-10-12': () => {
        pick('MADE UP LAMP SHOP', { to: 'wishlist' }, { wishlistItem: item('Made-up lamp') });
        const id = decision();
        const move = { from: 'wants' as const, to: 'needs' as const, amount: 2_500 };
        const first = k.move({ id, move });
        ok('move', first.ok ? first : k.move({ id, move, confirmed: true }));
      },
      '2026-10-14': () => pick('MADE UP MARKETPLACE SALE', { to: 'other-income' }),
      '2026-10-16': () => {
        pick('MADEUP CORP PAYROLL', { to: 'paycheck' });
        leftovers('move-to-savings', 'roll-over');
      },
    };

    const bank = { plaid: h.plaid, box: h.box, log: memoryLog([]), pageSize: 3 };
    const checks: string[] = [];
    for (const day of DAYS) {
      now = new Date(`${day.date}T11:00:00Z`);
      second.needsLogin = day.amexWantsLogin === true;
      day.bank(banks);
      await k.sync(bank);
      answers[day.date]?.();
      const buckets = k.buckets();
      checks.push(`${day.date} ${buckets.state === 'tracking' ? buckets.check.state : 'not tracking'}`);
      // Only Oct 2's paycheck waits overnight, for her yes the next day (51.1).
      expect({ day: day.date, pots: potsOf(k), waiting: reviewItems().length }).toEqual({ day: day.date, pots: BY_HAND[day.date], waiting: day.date === '2026-10-02' ? 1 : 0 });
    }
    expect(checks).toEqual(DAYS.map((d) => `${d.date} ${d.amexWantsLogin === true ? 'bank-not-read' : 'matches'}`));
    // The headphones and the lamp bought (50.3) and gone from the list; the rug,
    // added last on Oct 9 and moved up one, above the lamp, is after the jacket.
    expect(listed().map((i) => i.name)).toEqual(['Made-up jacket', 'Made-up rug']);
  } finally {
    h.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

function potsOf(k: Keeper): Pots {
  const pots = k.book()?.pots();
  if (pots === undefined) throw new Error('not tracking');
  const of = (pot: AnyPot): Cents => (pots as unknown as Record<string, Cents>)[pot] ?? 0;
  return { savings: of('savings'), needs: of('needs'), wants: of('wants'), wishlist: of('wishlist'), heldForOthers: of('heldForOthers') };
}

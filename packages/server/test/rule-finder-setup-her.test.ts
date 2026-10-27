import { describe, expect, it } from 'vitest';
import { addDays, type IsoDate } from '@budget-app/money';
import { readHistory } from '../src/history/history-db.js';
import { memoryLog } from '../src/log.js';
import { HER_START } from '../src/setup-start.js';
import type { FoundLine } from '../src/views/rule-finder.js';
import type { SetupReadyView } from '../src/views/setup.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { finderLife } from './her-harness.js';
import { decision, lifeInAFile, noonInNewYork, type Life } from './keeper-harness.js';

// Her rulebook, section 53 (his OK Oct 26, 2026, 60g): the rule finder on
// her setup day, through the real server's books and the made-up bank:
// what setup day offers, her answers, and the rules tracking starts with.
// Section 2: her setup asks Plaid for 730 days. 40.1: Trends still reads the
// 90 days before the bank was connected. Every name and number is made up.

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;
const TODAY: IsoDate = '2026-10-01';
const ago = (days: number): IsoDate => addDays(TODAY, -days);

async function within(make: () => Promise<Life>, run: (life: Life) => Promise<void> | void): Promise<void> {
  const life = await make();
  try {
    await run(life);
  } finally {
    life.done();
  }
}

function ready(life: Life): SetupReadyView {
  const view = life.keeper.setupView();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error(`setup day is not ready: ${JSON.stringify(view)}`);
  return view;
}

function found(life: Life): readonly FoundLine[] {
  const view = ready(life);
  if (view.found === undefined) throw new Error('no rule finder');
  return view.found;
}

const one = (lines: readonly FoundLine[], test: (l: FoundLine) => boolean): FoundLine => {
  const line = lines.find(test);
  if (line === undefined) throw new Error('no such suggestion');
  return line;
};
const capitalOneSide = (l: FoundLine): boolean => l.rule.kind === 'bank-rule' && l.rule.account === 'checking' && l.rule.other === 'everyday-card';
const place = (l: FoundLine): boolean => l.rule.kind === 'place';
const paycheck = (l: FoundLine): boolean => l.rule.kind === 'paycheck';

function setUpAndStart(life: Life): ReturnType<Life['keeper']['setup']> {
  const k = life.keeper;
  for (const setup of [{ lastPaycheck: ago(0) }, { assign: { pot: 'savings' as const, amount: 400_000 } }, { assign: { pot: 'needs' as const, rest: true as const } }]) {
    const answer = k.setup({ id: decision(), setup });
    if (!answer.ok) throw new Error(`setup day refused ${JSON.stringify(setup)}: ${answer.why}`);
  }
  return k.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: ready(life).key });
}

describe('53.1 the rule finder on her setup day', () => {
  it("53.1 her setup day offers the finder's suggestions in its order, in place of the labels' suggestions", () =>
    within(finderLife, (life) => {
      const view = ready(life);
      expect(view.suggestions).toEqual([]);
      const groups = found(life).map((l) => l.group);
      expect(groups).toEqual([...groups].sort((a, b) => ['card-payments', 'transfers', 'people-fees', 'paycheck', 'places'].indexOf(a) - ['card-payments', 'transfers', 'people-fees', 'paycheck', 'places'].indexOf(b)));
      expect(new Set(groups)).toEqual(new Set(['card-payments', 'people-fees', 'paycheck', 'places']));
      expect(found(life).every((l) => l.status === 'open')).toBe(true);
    }));

  it("53.1 upstream's setup day has no rule finder", () =>
    within(
      () => lifeInAFile({ today: TODAY }),
      (life) => {
        expect(ready(life).found).toBeUndefined();
      },
    ));

  it('53.1 a bank rule she keeps is added at the end of her bank rules, as in Settings, and logged', () =>
    within(finderLife, (life) => {
      const side = one(found(life), capitalOneSide);
      const kept = life.keeper.setup({ id: decision(), setup: { found: { id: side.id, answer: 'add' } } });
      expect(kept).toMatchObject({ ok: true, done: { step: 'found', id: side.id, answer: 'added' } });
      const rules = ready(life).bankRules;
      expect(rules.at(-1)).toMatchObject({ account: 'checking', contains: 'TO CRD 0412', means: 'transfer', other: 'everyday-card' });
      expect(one(found(life), capitalOneSide)).toMatchObject({ status: 'added', ruleId: rules.at(-1)?.id });
      // Logged as any change to the bank rules (13.5), in the history.
      const answer = readHistory(life.h.db).at(-1)?.event;
      expect(answer?.kind === 'answer' ? answer.answer.bankRules : null).toMatchObject([{ action: 'added', rule: { contains: 'TO CRD 0412' } }]);
    }));

  it('53.1 skipping changes nothing, and a whole group can be skipped', () =>
    within(finderLife, (life) => {
      const before = ready(life).bankRules;
      const side = one(found(life), capitalOneSide);
      expect(life.keeper.setup({ id: decision(), setup: { found: { id: side.id, answer: 'skip' } } })).toMatchObject({ ok: true, done: { answer: 'skipped' } });
      expect(ready(life).bankRules).toEqual(before);
      const group = life.keeper.setup({ id: decision(), setup: { foundGroup: { group: 'card-payments', answer: 'skip' } } });
      expect(group).toMatchObject({ ok: true, done: { step: 'found-group', group: 'card-payments' } });
      expect(found(life).filter((l) => l.group === 'card-payments').every((l) => l.status === 'skipped')).toBe(true);
      expect(ready(life).bankRules).toEqual(before);
    }));

  it('53.1 a place with its bucket and the paycheck rule start tracking at the end of their lists, logged with setup day', () =>
    within(finderLife, (life) => {
      const leaf = one(found(life), place);
      expect(leaf.rule).toEqual({ kind: 'place', contains: 'GREEN LEAF MARKET', bucket: 'needs' });
      expect(life.keeper.setup({ id: decision(), setup: { found: { id: leaf.id, answer: 'add', bucket: 'needs' } } })).toMatchObject({ ok: true, done: { answer: 'added' } });
      const wage = one(found(life), paycheck);
      expect(life.keeper.setup({ id: decision(), setup: { found: { id: wage.id, answer: 'add' } } })).toMatchObject({ ok: true, done: { answer: 'added' } });
      expect(setUpAndStart(life)).toMatchObject({ ok: true, done: { step: 'started', stillToSet: [] } });
      const book = life.keeper.book();
      expect(book?.rules().at(-1)).toMatchObject({ for: 'purchase', contains: 'GREEN LEAF MARKET', bucket: 'needs' });
      expect(book?.settings().paycheckRule).toEqual({ contains: 'MADEUP CORP PAYROLL PPD ID 4455' });
      const log = life.h.db.prepare("SELECT detail FROM change_log WHERE what = 'setup day'").get() as { detail: string } | undefined;
      expect(JSON.parse(log?.detail ?? '{}')).toMatchObject({ found: { rules: [{ for: 'purchase', contains: 'GREEN LEAF MARKET', bucket: 'needs' }], paycheckRule: { contains: 'MADEUP CORP PAYROLL PPD ID 4455' } } });
    }));

  it('53.1 she can finish setup day without answering the finder, and after it starts nothing more is offered', () =>
    within(finderLife, (life) => {
      expect(ready(life).missing).not.toContain('suggestions');
      expect(setUpAndStart(life)).toMatchObject({ ok: true });
      expect(life.keeper.setupView().state).toBe('tracking');
      expect(life.keeper.setup({ id: decision(), setup: { foundGroup: { group: 'places', answer: 'skip' } } })).toMatchObject({ ok: false, why: expect.stringContaining('Setup day is done already') });
    }));

  it('53.1 her answers are kept with setup day and come back after a restart', () =>
    within(finderLife, (life) => {
      const leaf = one(found(life), place);
      life.keeper.setup({ id: decision(), setup: { found: { id: leaf.id, answer: 'add', bucket: 'wants' } } });
      const wage = one(found(life), paycheck);
      life.keeper.setup({ id: decision(), setup: { found: { id: wage.id, answer: 'skip' } } });
      life.restart();
      expect(one(found(life), place).status).toBe('added');
      expect(one(found(life), paycheck).status).toBe('skipped');
    }));

  it('53.7 a place with no category has no bucket suggested, and is kept only with one picked', () =>
    within(
      () =>
        lifeInAFile({
          herSetup: true,
          rules: [],
          start: HER_START,
          today: TODAY,
          history: (fake) => {
            for (const [i, name] of ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO'].entries()) fake.addPosted({ id: `once-${i}`, account: E, amount: 1_100, date: ago(60), description: `${name} BAKERY` });
            for (const d of [9, 6, 3]) fake.addPosted({ id: `shop-${d}`, account: E, amount: 900, date: ago(d), description: 'NOLABEL SHOP' });
          },
        }),
      (life) => {
        const shop = one(found(life), place);
        expect(shop.rule).toEqual({ kind: 'place', contains: 'NOLABEL SHOP', bucket: null });
        expect(life.keeper.setup({ id: decision(), setup: { found: { id: shop.id, answer: 'add' } } })).toMatchObject({ ok: false, why: expect.stringContaining('Pick needs or wants first') });
        expect(life.keeper.setup({ id: decision(), setup: { found: { id: shop.id, answer: 'add', bucket: 'wants' } } })).toMatchObject({ ok: true });
      },
    ));

  it('53.8 53.9 a changed suggestion asks first, with what its new words would match and what they overlap', () =>
    within(finderLife, (life) => {
      const side = one(found(life), capitalOneSide);
      const id = decision();
      const asked = life.keeper.setup({ id, setup: { found: { id: side.id, answer: 'change', contains: 'ONLINE PMT' } } });
      if (asked.ok || asked.code !== 'needs-confirmation' || asked.foundPreview === undefined) throw new Error(JSON.stringify(asked));
      expect(asked.foundPreview).toMatchObject({ rule: { kind: 'bank-rule', contains: 'ONLINE PMT' }, matches: { count: 3, foundCount: 3 }, overlaps: [] });
      const kept = life.keeper.setup({ id, setup: { found: { id: side.id, answer: 'change', contains: 'ONLINE PMT' } }, confirmed: true, seen: asked.foundPreview.key });
      expect(kept).toMatchObject({ ok: true, done: { answer: 'changed' } });
      expect(ready(life).bankRules.at(-1)).toMatchObject({ contains: 'ONLINE PMT', other: 'everyday-card' });
    }));
});

describe('53.9 never one item two ways, on her setup day', () => {
  it('53.9 a suggestion that overlaps a rule she has can only be changed or skipped', () =>
    within(finderLife, (life) => {
      const add = life.keeper.bankRule({ id: decision(), bankRule: { add: { account: 'checking', contains: 'ONLINE', means: 'payment-to-person' } }, confirmed: true });
      if (!add.ok) {
        const again = life.keeper.bankRule({ id: decision(), bankRule: { add: { account: 'checking', contains: 'ONLINE', means: 'payment-to-person' } }, confirmed: true, ...(add.preview === undefined ? {} : { seen: add.preview.key }) });
        if (!again.ok) throw new Error(again.why);
      }
      const side = one(found(life), capitalOneSide);
      expect(side.overlaps).toMatchObject([{ with: { rule: { kind: 'bank-rule', contains: 'ONLINE', means: 'payment-to-person' } }, count: 3 }]);
      expect(life.keeper.setup({ id: decision(), setup: { found: { id: side.id, answer: 'add' } } })).toMatchObject({ ok: false, why: expect.stringContaining('Change its words or skip it') });
      expect(life.keeper.setup({ id: decision(), setup: { found: { id: side.id, answer: 'skip' } } })).toMatchObject({ ok: true });
    }));

  it('53.9 two suggestions that overlap are shown together; keeping one leaves the other overlapping a rule she has', () =>
    within(finderLife, (life) => {
      const side = one(found(life), capitalOneSide);
      // A place made of the same words reads the same payments as purchases.
      const id = decision();
      const leaf = one(found(life), place);
      const asked = life.keeper.setup({ id, setup: { found: { id: leaf.id, answer: 'change', contains: 'TO CRD 0412', bucket: 'needs' } } });
      if (asked.ok || asked.foundPreview === undefined) throw new Error(JSON.stringify(asked));
      expect(asked.foundPreview.overlaps).toMatchObject([{ with: { suggestion: side.id }, count: 3 }]);
      expect(life.keeper.setup({ id, setup: { found: { id: leaf.id, answer: 'change', contains: 'TO CRD 0412', bucket: 'needs' } }, confirmed: true, seen: asked.foundPreview.key })).toMatchObject({ ok: true });
      expect(one(found(life), capitalOneSide).overlaps).toMatchObject([{ with: { rule: { kind: 'place', contains: 'TO CRD 0412' } }, count: 3 }]);
      expect(life.keeper.setup({ id: decision(), setup: { found: { id: side.id, answer: 'add' } } })).toMatchObject({ ok: false });
    }));

  it('53.6 one paycheck rule: a second is refused', () =>
    within(
      () =>
        lifeInAFile({
          herSetup: true,
          rules: [],
          start: HER_START,
          today: TODAY,
          history: (fake) => {
            for (let p = 0; p < 3; p += 1) fake.addPosted({ id: `a-${p}`, account: C, amount: -(100_000 + p), date: ago(40 - 14 * p), description: `MADEUP CORP PAYROLL ${p}` });
            for (let p = 0; p < 3; p += 1) fake.addPosted({ id: `b-${p}`, account: ACCOUNT_IDS.savings, amount: -(20_000 + p), date: ago(41 - 14 * p), description: `SIDE GIG INC DEP ${p}` });
          },
        }),
      (life) => {
        const [first, second] = found(life).filter(paycheck);
        expect(life.keeper.setup({ id: decision(), setup: { found: { id: first!.id, answer: 'add' } } })).toMatchObject({ ok: true });
        expect(life.keeper.setup({ id: decision(), setup: { found: { id: second!.id, answer: 'add' } } })).toMatchObject({ ok: false, why: expect.stringContaining('one paycheck rule') });
      },
    ));
});

describe('section 2 history at connection, and 40.1 what Trends reads, in her setup', () => {
  // Upstream's 90 days is upstream's own test (bank-desk.test.ts, 1.1).
  it('section 2 her setup asks Plaid for 730 days when her second bank is connected', () =>
    within(
      () => lifeInAFile({ herSetup: true, start: HER_START, today: TODAY }),
      async (life) => {
        const before = life.h.fake.calls.length;
        const answer = await life.keeper.bankDesk({ plaid: life.h.plaid, box: life.h.box, log: memoryLog([]) }).link({ mode: 'connect', yes: true });
        expect(answer).toMatchObject({ ok: true });
        const body = life.h.fake.calls.slice(before).find((c) => c.endpoint === '/link/token/create')?.body;
        expect(body).toMatchObject({ products: ['transactions', 'liabilities'], transactions: { days_requested: 730 } });
      },
    ));

  it('40.1 her setup: Trends reads the 90 days before the bank was connected, though the bank sent more', () =>
    within(
      () =>
        lifeInAFile({
          herSetup: true,
          start: HER_START,
          today: TODAY,
          history: (fake) => {
            fake.addPosted({ id: 'old-shop', account: E, amount: 7_000, date: ago(400), description: 'LONG AGO SHOP' });
            fake.addPosted({ id: 'new-shop', account: E, amount: 2_000, date: ago(30), description: 'RECENT SHOP' });
          },
        }),
      (life) => {
        setUpAndStart(life);
        life.now = noonInNewYork(addDays(TODAY, 1));
        const trends = life.keeper.trends();
        if (trends.state !== 'tracking') throw new Error('not tracking');
        expect(trends.historyFrom).toBe(ago(90));
        expect(trends.periods.flatMap((p) => p.items.map((i) => i.description))).toContain('RECENT SHOP');
      },
    ));
});

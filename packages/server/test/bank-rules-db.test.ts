import { ACCOUNTS, addDays, type AccountId, type Cents, type IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { BankRulesDesk } from '../src/bank-rules-desk.js';
import { bankLinesIn, bankRuleLogIn, changeBankRuleIn } from '../src/bank-rules-db.js';
import { bankLinesOf, type BankRuleChange, type BankRuleSpec } from '../src/bank-rules.js';
import { bookEvents, readAccounts, readBankRules, readItems } from '../src/db/store.js';
import { ACCOUNT_IDS, type FakePlaid } from './fake-plaid.js';
import { SETUP_DAY, book, connected, setUp, status } from './harness.js';
import { lives as count } from './slow.js';

// Bank rules kept in the database (section 2, 24c, 13.5): a thin wrapper
// around the same logic the demo uses. And, through the whole bank
// connection, random bank histories with random bank rules changing between
// syncs: a changed rule reads what the bank sends from then on; what was
// already read never changes, and no cent is made or lost. A failure names
// its seed: SEED=n replays one; BANK_RULE_SCENARIOS=n runs more.

const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;
const E = ACCOUNT_IDS.everyday;
const O = ACCOUNT_IDS.old;

describe('section 2 24c the bank rules in the database', () => {
  it('24c 13.5 the database and the logic agree: the same changes give the same rules and the same log', async () => {
    const h = await connected({ history: (f) => f.addPosted({ id: 'z1', account: C, amount: 4_000, date: '2026-09-28', description: 'Zelle payment to FRIEND MADEUP' }) });
    const desk = new BankRulesDesk({ rules: readBankRules(h.db), lines: () => bankLinesIn(h.db), today: () => SETUP_DAY, bookLines: () => 0 });
    const changes: BankRuleChange[] = [
      { add: { account: 'checking', contains: 'MADE UP GYM', means: 'payment-to-person' } },
      { change: { id: 'zelle', account: 'checking', contains: 'Zelle', means: 'payment-to-person' } },
      { remove: 'everyday-fee' },
      { add: { account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' } },
      // A27: moves among the rules on its account, both ways.
      { add: { account: 'checking', contains: 'Zelle payment to MOM', means: 'transfer', other: 'savings' } },
      { move: { id: 'bank-rule-3', direction: 'up' } },
      { move: { id: 'bank-rule-3', direction: 'up' } },
      { move: { id: 'chk-to-sav', direction: 'down' } },
      // Refused alike: nothing saved, nothing logged.
      { add: { account: 'savings', contains: 'LATE FEE', means: 'card-fee' } },
      { remove: 'not-there' },
      { move: { id: 'not-there', direction: 'up' } },
      { move: { id: 'chk-to-sav', direction: 'up' } },
    ];
    for (const change of changes) {
      const inMemory = desk.apply(change);
      const inDb = changeBankRuleIn(h.db, change, SETUP_DAY);
      expect(inDb.ok).toBe(inMemory.ok);
      if (inDb.ok && inMemory.ok) expect(inDb.rule).toEqual(inMemory.done.rule);
    }
    expect(readBankRules(h.db)).toEqual(desk.rules());
    // The log the database had before (setting the rules on connecting) is not one of these lines.
    expect(bankRuleLogIn(h.db)).toEqual(desk.log());
    expect(bankLinesIn(h.db)).toEqual(bankLinesOf({ accounts: readAccounts(h.db), items: readItems(h.db) }));
    expect(bankLinesIn(h.db).map((l) => l.description)).toContain('Zelle payment to FRIEND MADEUP');
  });

  it('section 2 an id is never handed out twice in the database either, even after the rule is removed', async () => {
    const h = await connected({ rules: [] });
    const added = changeBankRuleIn(h.db, { add: { account: 'checking', contains: 'X', means: 'payment-to-person' } }, SETUP_DAY);
    expect(added.ok && added.rule.id).toBe('bank-rule-1');
    changeBankRuleIn(h.db, { remove: 'bank-rule-1' }, SETUP_DAY);
    const again = changeBankRuleIn(h.db, { add: { account: 'checking', contains: 'X', means: 'payment-to-person' } }, SETUP_DAY);
    expect(again.ok && again.rule.id).toBe('bank-rule-2');
  });
});

// ----- Random histories with random rules -----

// sfc32: small, fast, and the same everywhere for a seed.
function random(seed: number): () => number {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i += 1) next();
  return next;
}

// Texts a random rule may look for: the made-up bank's own words, some of
// them wide enough to catch things they should not.
const TEXTS = ['transfer to SAV 2222', 'transfer from CHK 1111', 'payment to CRD 3333', 'payment to CRD 4444', 'PAYMENT - THANK YOU', 'Zelle payment to', 'MOM', 'LATE FEE', 'INTEREST CHARGE', 'COFFEE', 'Online', 'e'];
const MEANINGS = ['transfer', 'payment-to-person', 'card-fee', 'card-interest'] as const;

// One day of made-up bank activity.
function activity(f: FakePlaid, r: () => number, date: IsoDate, n: { value: number }): void {
  const id = (what: string): string => `${what}${(n.value += 1)}`;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const cents = (): Cents => (r() < 0.1 ? 1 : 1 + Math.floor(r() * 30_000));
  for (let e = 0; e < 2 + Math.floor(r() * 5); e += 1) {
    const roll = r();
    if (roll < 0.3) f.addPosted({ id: id('buy'), account: pick([C, E, E]), amount: cents(), date, description: pick(['COFFEE SHOP', 'GROCERY OUTLET', 'MADE UP STORE']) });
    else if (roll < 0.4) f.addPending({ id: id('hold'), account: pick([C, E]), amount: cents(), date, description: 'GAS STATION 9' });
    else if (roll < 0.5) f.addPosted({ id: id('zel'), account: pick([C, S]), amount: cents(), date, description: pick(['Zelle payment to MOM MADEUP', 'Zelle payment to FRIEND MADEUP']) });
    else if (roll < 0.58) f.addPosted({ id: id('fee'), account: pick([E, O]), amount: cents(), date, description: pick(['LATE FEE', 'INTEREST CHARGE ON PURCHASES']) });
    else if (roll < 0.66) f.addPosted({ id: id('dep'), account: pick([C, S]), amount: -cents(), date, description: 'MOBILE DEPOSIT' });
    else if (roll < 0.7) f.addPosted({ id: id('ret'), account: E, amount: -cents(), date, description: 'STORE RETURN' });
    else {
      const [from, leaves, to, lands] = pick([
        [C, 'Online Banking transfer to SAV 2222', S, 'Online Banking transfer from CHK 1111'],
        [C, 'Online payment to CRD 3333', E, 'PAYMENT - THANK YOU'],
        [C, 'Online payment to CRD 4444', O, 'PAYMENT - THANK YOU'],
      ] as const);
      // Distinct amounts, so two transfers in flight cannot be mixed up.
      const amount = 10_000 + n.value * 7;
      f.addPosted({ id: id('out'), account: from, amount, date, description: leaves });
      if (r() < 0.8) f.addPosted({ id: id('in'), account: to, amount: -amount, date, description: lands });
    }
  }
}

function randomChange(r: () => number, rules: readonly { readonly id: string }[]): BankRuleChange {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const spec = (): BankRuleSpec => {
    const means = pick(MEANINGS);
    return { account: pick(ACCOUNTS) as AccountId, contains: pick(TEXTS), means, ...(means === 'transfer' ? { other: pick(ACCOUNTS) as AccountId } : {}) };
  };
  const roll = r();
  if (roll < 0.5 || rules.length === 0) return { add: spec() };
  if (roll < 0.8) return { change: { id: pick(rules).id, ...spec() } };
  return { remove: pick(rules).id };
}

const SCENARIOS = Number(process.env['BANK_RULE_SCENARIOS'] ?? count(8, 4));
const ONLY = process.env['SEED'] === undefined ? null : Number(process.env['SEED']);
const SEEDS = ONLY === null ? Array.from({ length: SCENARIOS }, (_, i) => i + 1) : [ONLY];

describe('24c random histories with random bank rules', () => {
  it.each(SEEDS)('24c seed %i: a rule never changes what was already read, and no cent is made or lost', async (seed) => {
    const r = random(seed);
    const n = { value: 0 };
    const h = await connected({ history: (f) => activity(f, r, '2026-09-28', n) });
    // Setup day with rules changed first: the setup steps follow the rules as they are now.
    for (let i = 0; i < 3; i += 1) changeBankRuleIn(h.db, randomChange(r, readBankRules(h.db)), SETUP_DAY);
    const outcome = setUp(h);
    expect(outcome.ok, `seed ${seed}: setup day`).toBe(true);
    let changes = 0;
    for (let day = 1; day <= 12; day += 1) {
      const date = addDays(SETUP_DAY, day);
      const before = readItems(h.db);
      const eventsBefore = bookEvents(h.db);
      // Now and then the rules change before what the bank sends next.
      // A change that cannot be (a fee on savings, say) is refused; another is tried.
      if (r() < 0.6) {
        for (let tries = 0; tries < 10; tries += 1) {
          if (changeBankRuleIn(h.db, randomChange(r, readBankRules(h.db)), date).ok) {
            changes += 1;
            break;
          }
        }
      }
      activity(h.fake, r, date, n);
      // Now and then a pending charge posts, or is dropped.
      for (const tx of [...h.fake.transactions.values()].filter((t) => t.pending && t.date < date)) {
        if (r() < 0.5) h.fake.postPending(tx.transaction_id, { id: `${tx.transaction_id}p`, date });
        else if (r() < 0.2) h.fake.dropPending(tx.transaction_id);
      }
      await h.sync(date);
      const after = readItems(h.db);
      const where = `seed ${seed}, ${date}`;
      // What was already read stays as it was, unless the bank sent it again changed.
      for (const [id, was] of before) {
        const now = after.get(id);
        if (now === undefined || JSON.stringify(now.raw) !== JSON.stringify(was.raw)) continue;
        expect([now.kind, now.status, now.bookId], `${where}: ${id}`).toEqual([was.kind, was.status, was.bookId]);
      }
      // The book's history only grows: nothing it was given is given again otherwise.
      expect(bookEvents(h.db).slice(0, eventsBefore.length), where).toEqual(eventsBefore);
      // No cent made or lost: everything is understood, and the self-check passes.
      const s = status(h);
      expect(s.attention, where).toEqual([]);
      expect(s.selfCheck, where).toMatchObject({ ok: true, difference: 0 });
      expect(book(h).recountPots(), where).toEqual(book(h).pots());
    }
    expect(changes, `seed ${seed}: some rules changed`).toBeGreaterThan(0);
    expect(bankRuleLogIn(h.db).length).toBeGreaterThanOrEqual(changes);
  });
});

import { DEFAULT_SETTINGS, addDays, type AccountId, type Pot, type StartingPots } from '@budget-app/money';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkBankRules } from '../src/bank/reading.js';
import { madeUpHistory, type MadeUpBank, type MadeUpItem } from '../src/demo/made-up-bank.js';
import { SetupDesk } from '../src/setup-desk.js';
import type { SetupStep } from '../src/views/choice.js';
import { runs } from './slow.js';

// Random banks with random assignments (rulebook 14.2, 14.3; QUESTIONS.md
// B43, B48): tracking starts only when the assignment adds up to the
// starting money exactly, and then the self-check passes and the buckets are
// what was assigned. The starting money is worked out here by hand, from the
// balances, the pending charges and the transfers on their way, not with the
// money math. Every number is made up. SEED=n replays one run.

const TODAY = '2026-10-07';
const RULES = checkBankRules([
  { id: 'chk-to-sav', account: 'checking', contains: 'transfer to SAV', means: 'transfer', other: 'savings' },
  { id: 'sav-from-chk', account: 'savings', contains: 'transfer from CHK', means: 'transfer', other: 'checking' },
  { id: 'chk-to-card', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
  { id: 'card-from-chk', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'chk-to-old', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
  { id: 'old-from-chk', account: 'old-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);

// The kinds of half: where it shows, what it says, and what it does to the
// starting money if it is on its way (B48): plus what left, minus what
// arrived first, nothing for the old card.
const HALVES = [
  { account: 'checking', description: 'Online Banking transfer to SAV', sign: 1, oldCard: false },
  { account: 'savings', description: 'Online Banking transfer from CHK', sign: -1, oldCard: false },
  { account: 'checking', description: 'Online payment to CRD 3333', sign: 1, oldCard: false },
  { account: 'everyday-card', description: 'PAYMENT - THANK YOU', sign: -1, oldCard: false },
  { account: 'checking', description: 'Online payment to CRD 4444', sign: 1, oldCard: true },
  { account: 'old-card', description: 'PAYMENT - THANK YOU', sign: -1, oldCard: true },
] as const;
const POTS: readonly Pot[] = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'];

const balance = fc.integer({ min: -50_000_000, max: 5_000_000_000 });
const charge = fc.record({ account: fc.constantFrom<AccountId>('checking', 'savings', 'everyday-card', 'old-card'), amount: fc.integer({ min: 1, max: 50_000_000 }), daysAgo: fc.integer({ min: 0, max: 5 }) });
const half = fc.record({ kind: fc.integer({ min: 0, max: HALVES.length - 1 }), amount: fc.integer({ min: 1, max: 100_000_000 }), daysAgo: fc.integer({ min: 0, max: 10 }), onItsWay: fc.boolean() });
const pot = fc.integer({ min: -100_000_000, max: 2_000_000_000 });

describe('14.2 14.3 random banks, random assignments', () => {
  it('14.3 refused unless exact; after setup the self-check passes and the buckets are what was assigned', () => {
    const seed = process.env['SEED'] === undefined ? undefined : Number(process.env['SEED']);
    fc.assert(
      fc.property(
        fc.record({ checking: balance, savings: balance, 'everyday-card': balance, 'old-card': balance }),
        fc.array(charge, { maxLength: 5 }),
        fc.array(half, { maxLength: 4 }),
        fc.record({ savings: pot, needs: pot, wants: pot, momReserve: pot, heldForOthers: pot }),
        fc.constantFrom(...POTS),
        fc.integer({ min: -2, max: 2 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 30 }),
        (balances, charges, halves, picked, restIn, nudge, exact, paidDaysAgo) => {
          const items: MadeUpItem[] = [
            ...charges.map((c, i) => ({ id: `c${i}`, account: c.account, amount: c.amount, date: addDays(TODAY, -c.daysAgo), description: 'MADE UP STORE', pending: true })),
            ...halves.map((h, i) => {
              const k = HALVES[h.kind];
              if (k === undefined) throw new Error('no such half');
              return { id: `h${i}`, account: k.account, amount: k.sign * h.amount, date: addDays(TODAY, -h.daysAgo), description: k.description };
            }),
          ];
          const bank: MadeUpBank = { balances, rules: RULES, items };
          const desk = new SetupDesk({ bank: madeUpHistory(bank), today: () => TODAY, settings: DEFAULT_SETTINGS, halvesWithinDays: 10, madeUpData: false });

          // By hand: checking + savings - everyday card, pending charges included (12.1, A10) ...
          const pendingOn = (account: AccountId): number => charges.filter((c) => c.account === account).reduce((sum, c) => sum + c.amount, 0);
          let expected = balances.checking - pendingOn('checking') + balances.savings - pendingOn('savings') - (balances['everyday-card'] + pendingOn('everyday-card'));

          let n = 0;
          const send = (setup: SetupStep, more: object = {}) => desk.decide({ id: `random-decision-${(n += 1)}`, setup, ...more });
          // ... plus what each half he says is on its way does (B48). Halves
          // that pair with each other are not asked about.
          const asked = new Set(desk.view().state === 'not-set-up' ? ((desk.view() as { halves?: { id: string }[] }).halves ?? []).map((h) => h.id) : []);
          halves.forEach((h, i) => {
            if (!asked.has(`h${i}`)) return;
            expect(send({ onItsWay: { half: `h${i}`, answer: h.onItsWay } }).ok).toBe(true);
            const k = HALVES[h.kind];
            if (h.onItsWay && k !== undefined && !k.oldCard) expected += k.sign * h.amount;
          });
          expect(send({ lastPaycheck: addDays(TODAY, -paidDaysAgo) }).ok).toBe(true);

          const view = desk.view();
          if (view.state !== 'not-set-up' || !view.ready) throw new Error('not ready');
          expect(view.startingMoney).toBe(expected);

          // The assignment: random, or exact give or take a cent or two.
          const assignment: { -readonly [K in keyof StartingPots]: StartingPots[K] } = { ...picked };
          if (exact) assignment[restIn] = expected - POTS.filter((p) => p !== restIn).reduce((sum, p) => sum + picked[p], 0) + nudge;
          for (const p of POTS) {
            const answer = send({ assign: { pot: p, amount: assignment[p] } });
            if (!answer.ok) expect(answer.why).toMatch(/already the amount/);
          }
          const left = expected - POTS.reduce((sum, p) => sum + assignment[p], 0);
          const key = (desk.view() as { key: string }).key;
          const start = send({ start: true }, { confirmed: true, seen: key });
          if (left !== 0) {
            expect(start).toEqual({
              ok: false,
              code: 'refused',
              why: left > 0 ? `${dollars(left)} is still to assign. Nothing was changed.` : `${dollars(-left)} more is assigned than there is. Nothing was changed.`,
            });
            expect(desk.started()).toBeNull();
            return;
          }
          expect(start.ok).toBe(true);
          const started = desk.started();
          if (started === null) throw new Error('not started');
          expect(started.book.pots()).toEqual({ ...assignment, unsortedIn: 0, unsortedOut: 0 });
          expect(started.book.selfCheck(started.bank)).toMatchObject({ ok: true, difference: 0 });
          // The old card owes its balance plus its charges pending (12.4).
          expect(started.book.oldCardDebt()).toBe(balances['old-card'] + pendingOn('old-card'));
          expect(send({ start: true }, { confirmed: true, seen: key }).ok).toBe(false);
        },
      ),
      { numRuns: runs(300), ...(seed === undefined ? {} : { seed }) },
    );
  });
});

// Dollars and cents the way the refusal says them, worked out here by hand.
function dollars(cents: number): string {
  const whole = Math.floor(cents / 100).toLocaleString('en-US');
  return `$${whole}.${String(cents % 100).padStart(2, '0')}`;
}

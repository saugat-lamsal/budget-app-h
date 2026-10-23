import { checkBankRules } from '../src/bank/reading.js';
import { HER_START } from '../src/setup-start.js';
import { BANK_RULES } from './harness.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { choose, decision, lifeInAFile, noonInNewYork, type Life } from './keeper-harness.js';

// Her setup on the real server's books (her rulebook, "Off in this setup"):
// the made-up bank's four accounts, of which her setup picks three, so the
// old card's account is never read. Every name and number is made up.

// The made-up bank's rules, less the ones about the old card, which her setup has none of.
export const HER_BANK_RULES = checkBankRules(BANK_RULES.filter((r) => r.account !== 'old-card' && !(r.means === 'transfer' && r.other === 'old-card')));

// The made-up bank connected, her three accounts picked, before setup day.
export function herLife(): Promise<Life> {
  return lifeInAFile({ herSetup: true, rules: HER_BANK_RULES, start: HER_START });
}

// Setup day through the desk, as the screens send it, with no mom reserve:
// the last paycheck, savings, wants, and the rest in needs, then her yes.
export function setUpHer(life: Life): void {
  const k = life.keeper;
  for (const setup of [{ lastPaycheck: '2026-09-25' }, { assign: { pot: 'savings' as const, amount: 400_000 } }, { assign: { pot: 'wants' as const, amount: 20_000 } }, { assign: { pot: 'needs' as const, rest: true as const } }]) {
    const answer = k.setup({ id: decision(), setup });
    if (!answer.ok) throw new Error(`setup day refused ${JSON.stringify(setup)}: ${answer.why}`);
  }
  const view = k.setupView();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day is not ready');
  const started = k.setup({ id: decision(), setup: { start: true }, confirmed: true, seen: view.key });
  if (!started.ok) throw new Error(`tracking did not start: ${started.why}`);
}

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;

// Her books after a few weeks: her paycheck (no paycheck rule yet, so she
// says it is her paycheck in review), groceries and a cafe on the card, a
// payment to a person, money in, a hand move, and the card's statement.
export async function herWeeks(): Promise<Life> {
  const life = await herLife();
  setUpHer(life);
  const day = async (date: string, items: () => void): Promise<void> => {
    items();
    life.now = noonInNewYork(date);
    await life.sync();
  };
  await day('2026-10-02', () => {
    life.h.fake.addPosted({ id: 'grocery-1', account: E, amount: 6_412, date: '2026-10-02', description: 'MADE UP GROCERY' });
    life.h.fake.addPosted({ id: 'aunt-1', account: C, amount: 6_000, date: '2026-10-02', description: 'Zelle payment to AUNT MADEUP' });
  });
  await day('2026-10-09', () => {
    life.h.fake.addPosted({ id: 'pay-1', account: C, amount: -250_000, date: '2026-10-09', description: 'MADEUP CORP PAYROLL' });
    life.h.fake.addPosted({ id: 'cafe-1', account: E, amount: 1_250, date: '2026-10-09', description: 'MADE UP CAFE' });
    life.h.fake.addPosted({ id: 'friend-1', account: C, amount: -2_000, date: '2026-10-09', description: 'MADE UP FRIEND PAID BACK' });
    life.h.fake.setStatement(E, { is_overdue: false, last_payment_amount: 120.5, last_payment_date: '2026-09-10', last_statement_issue_date: '2026-10-05', last_statement_balance: 64.12, minimum_payment_amount: 35, next_payment_due_date: '2026-10-30' });
  });
  const k = life.keeper;
  for (const [item, choice] of [
    ['grocery-1', { to: 'needs' }],
    ['aunt-1', { to: 'wants' }],
    ['pay-1', { to: 'paycheck' }],
    ['cafe-1', { to: 'wants' }],
  ] as const) {
    const answer = choose(k, { item, choice });
    if (!answer.ok) throw new Error(`${item}: ${answer.why}`);
  }
  // The friend's money waits in review; a hand move, and the paycheck rule set.
  const moved = k.move({ id: decision(), move: { from: 'savings', to: 'needs', amount: 5_000 }, confirmed: true });
  if (!moved.ok) throw new Error(moved.why);
  const id = decision();
  const settings = { paycheckRule: { contains: 'MADEUP CORP PAYROLL' } };
  const asked = k.settingsChange({ id, settings });
  if (asked.ok || asked.code !== 'needs-confirmation' || asked.preview === undefined) throw new Error(`the paycheck rule: ${JSON.stringify(asked)}`);
  const set = k.settingsChange({ id, settings, confirmed: true, seen: asked.preview.key });
  if (!set.ok) throw new Error(set.why);
  return life;
}

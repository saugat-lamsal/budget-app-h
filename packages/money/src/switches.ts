import { ACCOUNTS, type AccountId } from './accounts.js';
import type { Cents } from './cents.js';
import { MoneyError } from './errors.js';
import type { ReviewOptions } from './review-options.js';
import type { SortingRule } from './rules.js';
import type { Settings } from './settings.js';
import type { BankTransaction } from './transactions.js';

// Her rulebook, "Off in this setup": the mom reserve and the old card stay in
// the code, and a setup can switch them off. Being off is fixed on setup day:
// it is not a setting, and nothing changes it afterwards. Off is not zero:
// nothing about them is offered, and anything about them is refused.

export type Switch = 'on' | 'off';

export interface Switches {
  readonly momReserve: Switch;
  readonly oldCard: Switch;
}

// Upstream's setup. A book saved before the switches existed opens with these
// (B242: a new setting means "as upstream" for history saved before it).
export const UPSTREAM_SWITCHES: Switches = Object.freeze({ momReserve: 'on', oldCard: 'on' });

// The settings that are about the mom reserve and the old card, and what each
// holds while its switch is off: nothing.
const MOM_SETTINGS = Object.freeze({ momReservePerPaycheck: 0, momReserveCap: 0, momMonthlyTarget: Object.freeze({ low: 0, high: 0 }), momRule: null });
const OLD_CARD_SETTINGS = Object.freeze({ oldCardPromoEndDate: null, oldCardClosingDay: null });

export function settingsWhenOff(switches: Switches): Partial<Settings> {
  return { ...(switches.momReserve === 'off' ? MOM_SETTINGS : {}), ...(switches.oldCard === 'off' ? OLD_CARD_SETTINGS : {}) };
}

// 1.2: the accounts picked, each once, in the order the screen asks about
// them. With the old card off it is never asked about, and an account that is
// none of these is never read.
export function rolesFor(switches: Switches): readonly AccountId[] {
  return switches.oldCard === 'off' ? ACCOUNTS.filter((account) => account !== 'old-card') : ACCOUNTS;
}

// Returns a frozen copy; none given is upstream's.
export function checkSwitches(switches: Switches | undefined): Switches {
  if (switches === undefined) return UPSTREAM_SWITCHES;
  const isSwitch = (value: unknown): value is Switch => value === 'on' || value === 'off';
  if (typeof switches !== 'object' || switches === null || !isSwitch(switches.momReserve) || !isSwitch(switches.oldCard)) {
    throw new MoneyError('bad-switch', `the mom reserve and the old card are each on or off: ${JSON.stringify(switches)}`);
  }
  return Object.freeze({ momReserve: switches.momReserve, oldCard: switches.oldCard });
}

function refuse(why: string): never {
  throw new MoneyError('off-in-this-setup', why);
}

const NO_MOM = 'This setup has no mom reserve.';
const NO_OLD_CARD = 'This setup has no old card.';

// What a book starts with, while a switch is off: nothing in the mom reserve,
// no old card debt, and the settings about them empty.
export function checkOpening(
  switches: Switches,
  opening: { readonly momReserve: Cents; readonly oldCardDebt: Cents; readonly settings: Settings; readonly oldCardActivity: boolean },
): void {
  if (switches.momReserve === 'off' && opening.momReserve !== 0) refuse(`${NO_MOM} Nothing can be assigned to it.`);
  if (switches.oldCard === 'off' && (opening.oldCardDebt !== 0 || opening.oldCardActivity)) refuse(`${NO_OLD_CARD} It owes nothing and has nothing on its way.`);
  for (const [key, value] of Object.entries(settingsWhenOff(switches))) {
    if (JSON.stringify(opening.settings[key as keyof Settings]) !== JSON.stringify(value)) refuse(`${settingWhy(key)} The setting ${key} must be empty.`);
  }
}

function settingWhy(key: string): string {
  return key in MOM_SETTINGS ? NO_MOM : NO_OLD_CARD;
}

// A change to a setting about something that is off is refused, whatever the value.
export function refuseOffSettings(switches: Switches, patch: Partial<Settings>): void {
  const off = settingsWhenOff(switches);
  for (const key of Object.keys(patch)) if (key in off) refuse(`${settingWhy(key)} There is no ${key} to change.`);
}

// Bank activity on the old card, or a transfer to it.
export function refuseOffTransaction(switches: Switches, txn: BankTransaction): void {
  if (switches.oldCard === 'on') return;
  if (('account' in txn && txn.account === 'old-card') || ('to' in txn && txn.to === 'old-card')) refuse(`${NO_OLD_CARD} Nothing on it is read.`);
}

// For mom (7.6), payback into the mom reserve (6.1), or a transfer with the old card (5.6).
export function refuseOffChoice(switches: Switches, choice: unknown): void {
  if (typeof choice !== 'object' || choice === null) return;
  if (switches.momReserve === 'off' && 'to' in choice && (choice.to === 'mom' || choice.to === 'momReserve')) refuse(`${NO_MOM} Nothing can be for mom.`);
  if (switches.oldCard === 'off' && 'transfer' in choice && choice.transfer === 'old-card') refuse(`${NO_OLD_CARD} Nothing can be a payment to it.`);
}

export function refuseOffRule(switches: Switches, rule: SortingRule): void {
  if (rule.for !== 'purchase') refuseOffChoice(switches, rule.choice);
}

export function refuseOffMove(switches: Switches, move: { readonly from: string; readonly to: string }): void {
  if (switches.momReserve === 'off' && (move.from === 'momReserve' || move.to === 'momReserve')) refuse(`${NO_MOM} No money can go in or out of it.`);
}

// The choices review gives, less the ones about what is off.
export function offOptionsRemoved<T extends ReviewOptions>(switches: Switches, options: T): T {
  if (options.type !== 'sort') return options;
  const momOff = switches.momReserve === 'off';
  const keep = (to: string): boolean => !(momOff && (to === 'mom' || to === 'momReserve'));
  const keepAccount = (account: AccountId): boolean => !(switches.oldCard === 'off' && account === 'old-card');
  return {
    ...options,
    picks: options.picks.filter((p) => keep(p.to)),
    always: options.always.filter(keep),
    transfer: options.transfer.filter(keepAccount),
    transferOutcome: Object.fromEntries(Object.entries(options.transferOutcome).filter(([account]) => keepAccount(account as AccountId))),
  };
}

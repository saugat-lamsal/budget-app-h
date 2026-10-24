import { ACCOUNTS, ALL_ACCOUNTS, type AccountId } from './accounts.js';
import type { Cents } from './cents.js';
import type { BankBalances } from './self-check.js';
import { MoneyError } from './errors.js';
import type { ReviewOptions } from './review-options.js';
import type { SortingRule } from './rules.js';
import type { Settings } from './settings.js';
import type { BankTransaction } from './transactions.js';

// Her rulebook, "Off in this setup": the mom reserve and the old card stay in
// the code, and a setup can switch them off. Being off is fixed on setup day:
// it is not a setting, and nothing changes it afterwards. Off is not zero:
// nothing about them is offered, and anything about them is refused.
//
// Her second card (her rulebook, section 1) is the other way round: upstream's
// setup has none, and her setup switches it on. While it is off, as for the
// others, nothing on it is read or offered. So is her Wishlist bucket (her
// rulebook, section 2's split): while it is off there is no Wishlist share,
// nothing is sorted or moved to it, and no screen shows it.

export type Switch = 'on' | 'off';

export interface Switches {
  readonly momReserve: Switch;
  readonly oldCard: Switch;
  readonly secondCard: Switch;
  readonly wishlist: Switch;
}

// Upstream's setup. A book saved before the switches existed opens with these
// (B242: a new setting means "as upstream" for history saved before it), and
// one saved before the second card's switch opens with one card, and one
// saved before Wishlist's with no Wishlist.
export const UPSTREAM_SWITCHES: Switches = Object.freeze({ momReserve: 'on', oldCard: 'on', secondCard: 'off', wishlist: 'off' });

// The settings that are about the mom reserve and the old card, and what each
// holds while its switch is off: nothing.
const MOM_SETTINGS = Object.freeze({ momReservePerPaycheck: 0, momReserveCap: 0, momMonthlyTarget: Object.freeze({ low: 0, high: 0 }), momRule: null });
const OLD_CARD_SETTINGS = Object.freeze({ oldCardPromoEndDate: null, oldCardClosingDay: null });

export function settingsWhenOff(switches: Switches): Partial<Settings> {
  return { ...(switches.momReserve === 'off' ? MOM_SETTINGS : {}), ...(switches.oldCard === 'off' ? OLD_CARD_SETTINGS : {}) };
}

// 1.2: the accounts picked, each once, in the order the screen asks about
// them. With the old card off it is never asked about, nor the second card
// with it off, and an account that is none of these is never read.
export function rolesFor(switches: Switches): readonly AccountId[] {
  if (switches.secondCard === 'off') return switches.oldCard === 'off' ? ACCOUNTS.filter((account) => account !== 'old-card') : ACCOUNTS;
  return ALL_ACCOUNTS.filter((account) => account !== 'old-card' || switches.oldCard === 'on');
}

// Returns a frozen copy; none given is upstream's. Switches saved before the
// second card's or Wishlist's existed have it off (B242).
export function checkSwitches(switches: Switches | undefined): Switches {
  if (switches === undefined) return UPSTREAM_SWITCHES;
  const isSwitch = (value: unknown): value is Switch => value === 'on' || value === 'off';
  if (typeof switches !== 'object' || switches === null) throw new MoneyError('bad-switch', `the switches are each on or off: ${JSON.stringify(switches)}`);
  const secondCard: unknown = switches.secondCard === undefined ? 'off' : switches.secondCard;
  const wishlist: unknown = switches.wishlist === undefined ? 'off' : switches.wishlist;
  if (!isSwitch(switches.momReserve) || !isSwitch(switches.oldCard) || !isSwitch(secondCard) || !isSwitch(wishlist)) {
    throw new MoneyError('bad-switch', `the mom reserve, the old card, the second card and Wishlist are each on or off: ${JSON.stringify(switches)}`);
  }
  return Object.freeze({ momReserve: switches.momReserve, oldCard: switches.oldCard, secondCard, wishlist });
}

function refuse(why: string): never {
  throw new MoneyError('off-in-this-setup', why);
}

const NO_MOM = 'This setup has no mom reserve.';
const NO_OLD_CARD = 'This setup has no old card.';
const NO_SECOND_CARD = 'This setup has no second card.';
const NO_WISHLIST = 'This setup has no Wishlist.';

// Anything on the second card: its own activity, or a transfer to it.
const onSecondCard = (t: object): boolean => ('account' in t && t.account === 'second-card') || ('to' in t && t.to === 'second-card');

// What a book starts with, while a switch is off: nothing in the mom reserve,
// no old card debt, nothing on the second card, and the settings about them
// empty.
export function checkOpening(
  switches: Switches,
  opening: { readonly momReserve: Cents; readonly oldCardDebt: Cents; readonly settings: Settings; readonly oldCardActivity: boolean; readonly setupActivity?: readonly object[]; readonly wishlist?: Cents },
): void {
  checkWishlistSplit(switches, opening.settings.split);
  if (switches.wishlist === 'off' && (opening.wishlist ?? 0) !== 0) refuse(`${NO_WISHLIST} Nothing can be assigned to it.`);
  if (switches.secondCard === 'off' && (opening.setupActivity ?? []).some(onSecondCard)) refuse(`${NO_SECOND_CARD} It has nothing pending and nothing on its way.`);
  if (switches.secondCard === 'off' && (opening.settings.secondCardClosingDay ?? null) !== null) refuse(`${NO_SECOND_CARD} The setting secondCardClosingDay must be empty.`);
  if (switches.momReserve === 'off' && opening.momReserve !== 0) refuse(`${NO_MOM} Nothing can be assigned to it.`);
  if (switches.oldCard === 'off' && (opening.oldCardDebt !== 0 || opening.oldCardActivity)) refuse(`${NO_OLD_CARD} It owes nothing and has nothing on its way.`);
  for (const [key, value] of Object.entries(settingsWhenOff(switches))) {
    if (JSON.stringify(opening.settings[key as keyof Settings]) !== JSON.stringify(value)) refuse(`${settingWhy(key)} The setting ${key} must be empty.`);
  }
}

function settingWhy(key: string): string {
  return key in MOM_SETTINGS ? NO_MOM : NO_OLD_CARD;
}

// Her rulebook, section 2: with Wishlist on, the split always names it (whole
// percents that add up to 100 with it, validateSettings); with it off, the
// split is upstream's three, with no Wishlist share at all, not even 0%.
export function checkWishlistSplit(switches: Switches, split: Settings['split']): void {
  if (switches.wishlist === 'off' && split.wishlist !== undefined) refuse(`${NO_WISHLIST} The split has no Wishlist share.`);
  if (switches.wishlist === 'on' && split.wishlist === undefined) throw new MoneyError('bad-setting', 'the split names Wishlist in this setup: savings, needs, wants and Wishlist');
}

// A change to a setting about something that is off is refused, whatever the value.
export function refuseOffSettings(switches: Switches, patch: Partial<Settings>): void {
  if (patch.split !== undefined) checkWishlistSplit(switches, patch.split);
  if (switches.secondCard === 'off' && 'secondCardClosingDay' in patch) refuse(`${NO_SECOND_CARD} There is no secondCardClosingDay to change.`);
  const off = settingsWhenOff(switches);
  for (const key of Object.keys(patch)) if (key in off) refuse(`${settingWhy(key)} There is no ${key} to change.`);
}

// Bank activity on the old card, or a transfer to it.
export function refuseOffTransaction(switches: Switches, txn: BankTransaction): void {
  if (switches.secondCard === 'off' && onSecondCard(txn)) refuse(`${NO_SECOND_CARD} Nothing on it is read.`);
  if (switches.oldCard === 'on') return;
  if (('account' in txn && txn.account === 'old-card') || ('to' in txn && txn.to === 'old-card')) refuse(`${NO_OLD_CARD} Nothing on it is read.`);
}

// For mom (7.6), payback into the mom reserve (6.1), or a transfer with the old card (5.6).
export function refuseOffChoice(switches: Switches, choice: unknown): void {
  if (typeof choice !== 'object' || choice === null) return;
  if (switches.momReserve === 'off' && 'to' in choice && (choice.to === 'mom' || choice.to === 'momReserve')) refuse(`${NO_MOM} Nothing can be for mom.`);
  if (switches.oldCard === 'off' && 'transfer' in choice && choice.transfer === 'old-card') refuse(`${NO_OLD_CARD} Nothing can be a payment to it.`);
  if (switches.secondCard === 'off' && 'transfer' in choice && choice.transfer === 'second-card') refuse(`${NO_SECOND_CARD} Nothing can be a payment to it.`);
  if (switches.wishlist === 'off' && (('to' in choice && choice.to === 'wishlist') || ('split' in choice && Array.isArray(choice.split) && choice.split.some(isWishlistPart)))) {
    refuse(`${NO_WISHLIST} Nothing can be sorted to it.`);
  }
}

const isWishlistPart = (part: unknown): boolean => typeof part === 'object' && part !== null && 'bucket' in part && part.bucket === 'wishlist';

// 12.1: with the second card off, the bank has nothing on it, not even a cent.
export function refuseOffBalances(switches: Switches, bank: BankBalances): void {
  if (switches.secondCard === 'off' && bank.secondCard !== undefined && bank.secondCard !== 0) refuse(`${NO_SECOND_CARD} It owes nothing.`);
}

export function refuseOffRule(switches: Switches, rule: SortingRule): void {
  if (rule.for !== 'purchase') refuseOffChoice(switches, rule.choice);
}

export function refuseOffMove(switches: Switches, move: { readonly from: string; readonly to: string }): void {
  if (switches.momReserve === 'off' && (move.from === 'momReserve' || move.to === 'momReserve')) refuse(`${NO_MOM} No money can go in or out of it.`);
  if (switches.wishlist === 'off' && (move.from === 'wishlist' || move.to === 'wishlist')) refuse(`${NO_WISHLIST} No money can go in or out of it.`);
}

// What is read about Wishlist (its bucket's list, 50.4), when it is off.
export function refuseOffWishlist(switches: Switches): void {
  if (switches.wishlist === 'off') refuse(NO_WISHLIST);
}

// The choices review gives in this setup: less the ones about what is off,
// and, with the second card on, the second card as a transfer wherever the
// everyday card is one, just after it, with the same outcome (5.6, 5.1).
export function optionsInThisSetup<T extends ReviewOptions>(switches: Switches, options: T): T {
  const shown = offOptionsRemoved(switches, options);
  if (shown.type !== 'sort' || switches.secondCard === 'off' || !shown.transfer.includes('everyday-card')) return shown;
  const outcome = shown.transferOutcome['everyday-card'];
  return {
    ...shown,
    transfer: shown.transfer.flatMap((account) => (account === 'everyday-card' ? ['everyday-card', 'second-card'] : [account])),
    transferOutcome: outcome === undefined ? shown.transferOutcome : { ...shown.transferOutcome, 'second-card': outcome },
  };
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

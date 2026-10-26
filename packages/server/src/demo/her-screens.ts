import { HER_SWITCHES, cardStatementView, wishlistMove, type Book, type DueStatement, type EverydayCard, type StatementView } from '@budget-app/money';
import type { ChoiceDesk } from '../choices.js';
import { parseWishlistRequest, tryWishlist, boughtWith, itemsForReview, wishlistListView } from '../wishlist-items.js';
import type { ActivityView } from '../views/activity.js';
import type { BucketsView } from '../views/buckets.js';
import type { ChoiceRequest, ChoiceResponse, WishlistResponse } from '../views/choice.js';
import type { HomeView } from '../views/home.js';
import { homeCards } from '../views/home-cards.js';
import { shownActivity, shownBuckets, shownPayday, shownReview, shownSettings, shownTrends } from '../views/off.js';
import type { PaydayView } from '../views/payday.js';
import type { ReviewView } from '../views/review.js';
import type { SettingsView } from '../views/settings.js';
import type { TrendsView } from '../views/trends.js';
import { HER_CARD_NAMES, type HerLive } from './her-lives.js';

// Her setup's screens in the demo: the same views the real server sends,
// worked out from a made-up life's book, with what is off in her setup taken
// out of each ("Off in this setup", views/off.ts), each card named as its
// bank names it (HB6), the cards on Home (52.1), the Wishlist money to move
// (50.4) and her list (50.1 to 50.3). What the real server's keeper does from
// the database, this does from the life in memory. Nothing here reads a
// database or talks to a bank.

const SWITCHES = HER_SWITCHES;

// A screen with each card's name beside its numbers; an answer that something
// is off names nothing.
function named<T extends object>(view: T): T {
  return (view as { state?: unknown }).state === 'off' ? view : { ...view, cardNames: HER_CARD_NAMES };
}

export function herHome(her: HerLive, view: HomeView): HomeView {
  if (view.state !== 'tracking') return view;
  const { input } = her;
  const book = input.book as Book;
  const cards = homeCards({ atSetup: her.atSetup }, input.today, book, input.bank, input.statements, input.cardsOff ?? []);
  // 50.4: left out at $0.00 and while the bank cannot be read.
  const move = wishlistMove(book, { savingsAccountBalance: input.bank?.savings ?? null, statements: dueStatements(her), today: input.today });
  return named({ ...view, cards, ...(move === null || move.amount === 0 ? {} : { wishlistMove: move }) }) as HomeView;
}

function dueStatements(her: HerLive): Partial<Record<EverydayCard, DueStatement[]>> {
  return Object.fromEntries((Object.entries(her.kept) as [EverydayCard, HerLive['kept'][EverydayCard]][]).map(([card, list]) => [card, list.map(({ closingDate, dueDate }) => ({ closingDate, dueDate }))]));
}

export const herBuckets = (view: BucketsView): BucketsView => named(shownBuckets(view, SWITCHES) as BucketsView);
export const herTrends = (view: TrendsView): TrendsView => shownTrends(view, SWITCHES) as TrendsView;
export const herPayday = (view: PaydayView): PaydayView => shownPayday(view, SWITCHES) as PaydayView;
export const herSettings = (view: SettingsView): SettingsView => named(shownSettings(view, SWITCHES) as SettingsView);

// 50.3: her list, for "which thing on your list was it".
export function herReview(her: HerLive, view: ReviewView): ReviewView {
  const shown = named(shownReview(view, SWITCHES) as ReviewView);
  return shown.state === 'tracking' ? { ...shown, wishlistItems: itemsForReview(her.wishlist) } : shown;
}

// 50.2, 50.3: a bucket's list carries her list; Wishlist's own shows how the bucket fills it.
export function herActivity(her: HerLive, view: ActivityView, pot: Parameters<typeof shownActivity>[1]): ActivityView {
  const shown = named(shownActivity(view, pot, SWITCHES) as ActivityView);
  const book = her.input.book as Book;
  if (shown.state !== 'tracking') return shown;
  return { ...shown, wishlistItems: itemsForReview(her.wishlist), ...(pot === 'wishlist' ? { list: wishlistListView(book, her.wishlist) } : {}) };
}

export type HerStatementScreen = { readonly state: 'ready'; readonly today: string; readonly madeUpData: true; readonly statement: StatementView; readonly cardNames: typeof HER_CARD_NAMES };

// 52.4: a card's last statement, in lines that add up to its balance.
export function herStatement(her: HerLive, card: EverydayCard): HerStatementScreen {
  const kept = her.kept[card];
  const statement = kept.at(-1);
  if (statement === undefined) throw new Error(`no statement of ${card}`);
  const view = cardStatementView({ statement, before: kept.at(-2) ?? null, book: her.input.book, beforeSetup: her.beforeSetup[card] });
  return { state: 'ready', today: her.input.today, madeUpData: true, statement: view, cardNames: HER_CARD_NAMES };
}

// 50.3: sorting a purchase to Wishlist also says which thing on her list it was
// (or none of them), in the same answer. The real server undoes the sort when
// that is refused; here it is asked before, so nothing is half done.
export function herChoice(her: HerLive, desk: ChoiceDesk, request: ChoiceRequest): ChoiceResponse {
  const book = her.input.book as Book;
  const choice = request.choice;
  const toWishlist = ('to' in choice && choice.to === 'wishlist') || ('split' in choice && choice.split.some((part) => part.bucket === 'wishlist'));
  const pick = request.wishlistItem;
  const refuse = (code: 'refused' | 'changed', why: string): ChoiceResponse => ({ ok: false, code, why });
  if (toWishlist && pick === undefined && her.wishlist.items.length > 0) return refuse('refused', 'Which thing on your list was it? Pick one, or None of them.');
  if (pick !== undefined && pick !== 'none') {
    if (!toWishlist) return refuse('refused', 'Only a purchase sorted to Wishlist can be one of the things on your list. Nothing was changed.');
    if (!her.wishlist.items.some((item) => item.id === pick)) return refuse('changed', 'That is not on your list any more. Nothing was changed.');
  }
  const response = desk.decide(request);
  if (!response.ok || response.replayed || pick === undefined || pick === 'none') return response;
  // Worked out after the sort, from the book: what the purchase cost is what was paid.
  const asked = boughtWith(book, her.wishlist, request.item, pick);
  if (asked.ok && asked.change !== null) {
    const tried = tryWishlist(her.wishlist, asked.change, her.input.today);
    if (tried.ok) her.wishlist = tried.list;
  }
  return response;
}

// 50.1: a change to her list. Removing asks first. No decision numbers are kept
// here beyond the last, since the demo has no phone retrying.
export function herWishlist(her: HerLive, done: Set<string>, sent: unknown): WishlistResponse | null {
  const request = parseWishlistRequest(sent);
  if (request === null) return null;
  if (done.has(request.id)) return { ok: true, replayed: true };
  const edit = request.wishlist;
  if ('remove' in edit && request.confirmed !== true) {
    const item = her.wishlist.items.find((i) => i.id === edit.remove.item);
    if (item !== undefined) return { ok: false, code: 'needs-confirmation', why: `Remove ${item.name} from your list? Nothing is changed until you say yes.` };
  }
  const tried = tryWishlist(her.wishlist, edit, her.input.today);
  if (!tried.ok) return tried;
  her.wishlist = tried.list;
  done.add(request.id);
  return { ok: true, replayed: false };
}

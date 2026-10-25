import { BankDesk, rolesComplete } from '../bank-desk.js';
import { PLAID_URLS } from '../plaid/sandbox-lock.js';
import type { IncomingMessage, Server } from 'node:http';
import type { Agent } from 'node:https';
import { owedAtSetup, rolesFor, type AccountId, type BankBalances, type Book, type CardStatement, type EverydayCard, type IsoDate, type AnyPot, type Switches, type WishlistMove } from '@budget-app/money';
import { UPSTREAM_START, type SetupStart } from '../setup-start.js';
import { cardsNamed } from '../http/card-names.js';
import { offTakenOut } from '../http/off-options.js';
import { cardNamesOf, type CardNames } from '../bank/card-names.js';
import { alertScreen } from '../alerts/alerts.js';
import { applyAlerts, nextAlertsEvent, nextDueIn, stillTrueNow, type AlertLedger, type AlertWorld } from '../alerts/plan.js';
import { addToOutbox, markFailed, markNotSent, markSent, markTrying, outboxCounts, outboxUnsent, readOutbox, type OutboxRow } from '../alerts/outbox.js';
import { dueWords, planSends, quietUntil, replacedBy, wordsToSend, type SendPlan } from '../alerts/sending.js';
import { Auth } from '../auth/auth.js';
import { answerAuth, loginViewOf } from '../auth/http.js';
import { BankRulesDesk } from '../bank-rules-desk.js';
import { bankLinesIn, bankRuleLogIn, saveBankRuleLine } from '../bank-rules-db.js';
import { RECENT_DAYS, bankLinesOf, misreadHints } from '../bank-rules.js';
import { bankAtRead, bankView, postedSince, type BankView } from '../bank/balances.js';
import type { StoredAccount } from '../bank/stored-account.js';
import { postingExamples, type PostingExample } from '../bank/posting-times.js';
import { whyItDoesNotMatch } from '../bank/why.js';
import { CARD_ORDER, cardStatement, closingDayOf } from '../bank/statements.js';
import { keptStatements } from '../bank/kept-statements.js';
import { canonical, refuse, ChoiceDesk } from '../choices.js';
import type { TokenBox } from '../crypto/token-box.js';
import { statement, type Db } from '../db/database.js';
import { logChange, readAccounts, readBankRules, readItems, readStatements, saveBankRules, saveItem } from '../db/store.js';
import { bankNameOf, connectionOfItem, connectionsOf, noteBankFailing, setupConnectionOf, type BankNumber } from '../bank/connections.js';
import { createAppServer, type Seen, type WebhookHandler } from '../http/server.js';
import { WEBHOOK_PATH } from '../plaid/webhook.js';
import { memoryLog, type Log } from '../log.js';
import type { PlaidClient } from '../plaid/client.js';
import { PushDesk } from '../push/push-desk.js';
import type { PushKeys } from '../push/push-keys.js';
import { saveServerLine, serverLinesIn } from '../server-log.js';
import { SetupDesk } from '../setup-desk.js';
import { NO_ANSWERS, SETUP_LOOK_BACK_DAYS, type SetupAnswers } from '../setup-view.js';
import { FEWEST_MINUTES, MOST_MINUTES, markSetupRead, readGapSince, readLastMatchingRead, readLastRead, readSyncTimes, saveGapSince, saveSyncEveryMinutes, syncEveryMinutes } from '../sync/bank-reads.js';
import type { Plan, PlanInput, StoredItem } from '../sync/plan.js';
import { syncBank, type SyncResult } from '../sync/sync.js';
import type { AlertSender, OutgoingAlert } from '../serve/alert-timer.js';
import { ALERTS_SHOWN, type AlertsView } from '../views/alerts.js';
import { activityView, type ActivityView } from '../views/activity.js';
import type { BankRuleRequest, BankRuleResponse } from '../views/bank-rules.js';
import { bucketsView, type BucketsView } from '../views/buckets.js';
import { trendsView } from '../trends.js';
import { beforeSetupOf } from '../trends-db.js';
import type { TrendsView } from '../views/trends.js';
import type { ChoiceRequest, ChoiceResponse, MoveRequest, MoveResponse, RuleRequest, RuleResponse, SettingsRequest, SettingsResponse, SetupRequest, SetupResponse } from '../views/choice.js';
import { withCards, homeCards, type HomeWithCards } from '../views/home-cards.js';
import { wishlistMoveOf, withWishlistMove, type HomeWithWishlist } from '../views/home-wishlist.js';
import { homeView, type BankDetail, type CardRemindersOff, type CheckedAt, type HomeView, type PendingMoneyIn, type WhyLine } from '../views/home.js';
import { paydayView, type PaydayView } from '../views/payday.js';
import { reviewView, type ReviewView } from '../views/review.js';
import { settingsView, type SettingsView } from '../views/settings.js';
import type { SetupView } from '../views/setup.js';
import type { StatusView } from '../views/status.js';
import { statementScreenView, type StatementScreenView } from '../views/statement.js';
import { recorderOf, totalsOf, type Answer, type Recorder, type SavedSetupAnswers } from './history.js';
import { appendEvent, lastSeqOf, readDecision, readHistory, readLastChecked, readSetupInput, replayHistory, saveDecision, saveLastChecked, sealHistory, type DeskName } from './history-db.js';
import { timeIn, todayIn } from './today.js';
import { NO_WISHLIST, boughtWith, itemsForReview, tryWishlist, wishlistListView, type WishlistRequest, type WishlistResponse } from '../wishlist-items.js';
import type { WishlistChange, WishlistList } from '@budget-app/money';

// 0.7: how many events the books' history holds.
function countEvents(db: Db): number {
  return (statement(db, 'SELECT COUNT(*) AS n FROM book_events').get() as { n: number }).n;
}

// The bank's balances and the card statements as the database has them.
interface BankNow {
  readonly version: string;
  readonly bank: BankBalances | null;
  // 11.4: none while the bank cannot be read. A57: firstSeen as an instant (ISO, UTC).
  readonly pendingIn: readonly PendingMoneyIn[];
  // 11.4 (A57): earlier deposits seen going from pending to posted.
  readonly postingExamples: readonly PostingExample[];
  readonly statements: CardStatement[];
  readonly cardsOff: CardRemindersOff[];
}

// The real server's books (Step 1): everything he answers is kept in the
// database, so a restart finds the books exactly as they were.
//
// - Every answer is an event in the book's history, in the order it
//   happened, next to what the bank sent (history.ts). Its decision number
//   and its first answer are saved in the same step: all of it, or none of it.
// - The state is rebuilt from the database: the book (replayed), the
//   take-backs seen, his Setup day answers, the bank rules, and the desks
//   that take his taps. The same desks as the demo; only where things are
//   kept differs.
// - When it opens, it replays the history and checks the totals saved with
//   each event. If they differ, it does not open, and says at which event.
// - Today is the date in his home time zone (a setting), never the server's
//   own clock zone. The clock is asked for nothing else but the time Home
//   last checked safe to spend.

export interface KeeperInput {
  readonly db: Db;
  readonly now: () => Date;
  // The app's own address, as the browser shows it (http://localhost:5190):
  // passkeys are made for it, and every request must be addressed to it
  // (Step 2). Known once the server listens; tests that never serve leave it out.
  readonly origin?: () => string;
  readonly log?: Log;
  // For tests: runs inside each save (an answer's, and a sync's), after
  // everything is written and before it is committed. A throw there stops the
  // save halfway.
  readonly beforeCommit?: () => void;
  // Phase 5, the phone: the app's push keys (none: no phone gets the alerts),
  // and for the tests only, the made-up push service's certificate.
  readonly push?: { readonly keys: PushKeys | null; readonly agent?: Agent };
  // What setup day starts from: her setup's on her app (BUDGET_SETUP=her),
  // upstream's when not given. Once tracking starts, the book's switches rule.
  readonly start?: SetupStart;
}

interface State {
  // The book as the desks use it: every change through it is written down.
  readonly recorder: Recorder | null;
  readonly seen: Set<string>;
  readonly bankRules: BankRulesDesk;
  readonly choices: ChoiceDesk | null;
  // Before tracking starts.
  readonly setup: SetupDesk | null;
  // Phase 5: the alerts given so far, from the history.
  readonly alerts: AlertLedger;
  // Her rulebook, 50.1 to 50.3: her Wishlist list, from the history.
  readonly wishlist: WishlistList;
}

// What a sync needs to reach the bank.
export interface SyncBank {
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  readonly log: Log;
  readonly pageSize?: number;
  // For tests only: how what the bank sent becomes what the book is given
  // (planSync). The simulated life's alert tests give the book the
  // simulator's own transactions, so its answers fit them.
  readonly plan?: (input: PlanInput) => Plan;
}

const NOT_LOGGED_IN = { ok: false, why: 'You are not logged in any more. Log in again.' } as const;

const NOUNS: Readonly<Record<DeskName, string>> = { choice: 'choice', move: 'move', settings: 'change', rule: 'change', setup: 'answer', 'bank-rule': 'change' };

export class Keeper {
  readonly #db: Db;
  readonly #now: () => Date;
  readonly #beforeCommit: (() => void) | undefined;
  readonly #start: SetupStart;
  // Step 2: his passkeys and logins.
  readonly #auth: Auth;
  // Phase 5: the Notifications card, and the real sender.
  readonly #push: PushDesk;
  #origin: () => string;
  #state!: State;
  // Step 3: the sync on its way, if any, and when the last one started (an
  // instant, in milliseconds); when the server starts, the last read.
  #syncing: Promise<SyncResult> | null = null;
  // 1.1 to 1.3: made the first time the screen needs it.
  #bankDesk: BankDesk | null = null;
  #lastTry: number | null;
  // The last event of the history the books in memory have.
  #lastSeq = 0;
  // Phase 5: told after each sync and each answer (serveBooks pokes the alert timer).
  #onChange: (() => void) | null = null;
  // The bank's balances and statements last read from the database (#bankNow).
  #bankRead: BankNow | null = null;
  // 0.7 (A57): when the server began serving the books (noted then, not when
  // they open: opening never asks the clock, 0.6), how many events the
  // history had when they opened (every one replayed to its totals), and how
  // the last sync since went.
  #startedAt: Date | null = null;
  #eventsWhenOpened = 0;
  #lastSync: { readonly at: Date; readonly result: 'new' | 'nothing-new' | 'needs-login' | 'failed' } | null = null;
  // Her rulebook, 0.7 (PR 6): how each bank's last sync went.
  readonly #lastSyncs = new Map<BankNumber, { readonly at: Date; readonly result: 'new' | 'nothing-new' | 'needs-login' | 'failed' }>();

  private constructor(input: KeeperInput) {
    this.#db = input.db;
    this.#start = input.start ?? UPSTREAM_START;
    this.#now = input.now;
    this.#beforeCommit = input.beforeCommit;
    this.#origin = input.origin ?? (() => 'http://localhost:5190');
    this.#auth = new Auth({ db: input.db, now: input.now, origin: () => this.#origin(), today: () => this.today(), bookLines: () => this.book()?.changeLog().length ?? 0, loggedIn: (token, device, push) => this.#push.loggedIn(token, device, push) });
    this.#push = new PushDesk({
      db: input.db,
      keys: input.push?.keys ?? null,
      now: input.now,
      zone: () => this.timeZone(),
      bookLines: () => this.book()?.changeLog().length ?? 0,
      log: input.log ?? memoryLog([]),
      ...(input.push?.agent === undefined ? {} : { agent: input.push.agent }),
    });
    const lastRead = readLastRead(input.db);
    this.#lastTry = lastRead === null ? null : Date.parse(lastRead);
  }

  // Opens the books kept in the database, after checking that the history
  // replays to the totals saved with it (HistoryDoesNotReplay if not).
  static open(input: KeeperInput): Keeper {
    const keeper = new Keeper(input);
    keeper.reload();
    keeper.#eventsWhenOpened = countEvents(input.db);
    keeper.#noteGap();
    return keeper;
  }

  // 10.4 (A47): when the totals stopped matching the bank: the last read,
  // when a read first shows a difference; cleared by a read that matches.
  // Noted after every sync and when the books open. While the bank cannot be
  // read, or before setup day, it is left as it is.
  #noteGap(): void {
    const book = this.book();
    const bank = this.#bank();
    if (book === null || bank === null) return;
    const matches = book.selfCheck(bank).ok;
    const since = readGapSince(this.#db);
    if (matches && since !== null) saveGapSince(this.#db, null);
    // Her rulebook, 12.3 (HB9): a difference starts counting only once both banks' last syncs worked.
    if (!matches && since === null && !this.#waiting()) saveGapSince(this.#db, this.lastRead() ?? this.#now().toISOString());
  }

  // Her rulebook, 12.3 (HB9): one of her banks' last sync failed, so the
  // check waits, as while the bank is still catching up (10.4). Never in
  // upstream's setup, which keeps no such thing.
  #waiting(): boolean {
    return connectionsOf(this.#db).some((c) => c.failingSince !== null);
  }

  // 0.5: the bank cannot be read while there is no connection, or one wants a new login (10.5).
  #cannotRead(): boolean {
    const connections = connectionsOf(this.#db);
    return connections.length === 0 || connections.some((c) => c.needsLogin);
  }

  // Her setup: how many bank connections it has (her rulebook, 1.1); one in upstream's.
  #banksInSetup(): 1 | 2 {
    return this.#switches().secondCard === 'on' ? 2 : 1;
  }

  // "Why it doesn't match" (docs/later.txt 18): each account as the bank
  // last gave it, when the difference began, and why (12.6). Null when the
  // bank cannot be read.
  #bankDetail(): BankDetail | null {
    if (this.#cannotRead()) return null;
    const accounts = readAccounts(this.#db);
    const items = readItems(this.#db);
    const view = bankView(accounts, items);
    if (!view.ok) return null;
    const v = view.view;
    const since = readGapSince(this.#db);
    return {
      accounts: [
        { account: 'checking', posted: v.posted.checking, available: v.available.checking, counted: v.withPending.checking },
        { account: 'savings', posted: v.posted.savings, available: v.available.savings, counted: v.withPending.savings },
        { account: 'everyday-card', posted: v.posted.everydayCard, available: null, counted: v.withPending.everydayCard },
        // Her second card, when one is picked (12.1).
        ...(v.posted.secondCard === undefined ? [] : [{ account: 'second-card' as const, posted: v.posted.secondCard, available: null, counted: v.withPending.secondCard ?? 0 }]),
      ],
      since: since === null ? null : timeIn(this.timeZone(), new Date(since)),
      why: this.#why(v, accounts, items),
    };
  }

  // 12.6 (A57): why the totals do not match, from the last read that matched
  // and the bank now; none while they match, or before setup day.
  #why(view: BankView, accounts: readonly StoredAccount[], items: ReadonlyMap<string, StoredItem>): WhyLine[] {
    const book = this.book();
    if (book === null) return [];
    const difference = book.selfCheck(view.withPending).difference;
    if (difference === 0) return [];
    const then = readLastMatchingRead(this.#db)?.bank ?? null;
    return whyItDoesNotMatch({
      difference,
      then,
      now: bankAtRead(view, 0),
      pendingNow: view.pending,
      postedSince: then === null ? [] : postedSince(accounts, items, then.syncs),
    });
  }

  // 12.6: the lines for Buckets' sheet; null when the bank cannot be read.
  #whyNow(): WhyLine[] | null {
    return this.#bankDetail()?.why.slice() ?? null;
  }

  // 10.4 (A47): when the totals stopped matching the bank; null while they match.
  // Her setup: while the check waits for a bank (12.3, HB9) the alerts do
  // not see the bank (#alertWorld), so nothing is told until both are read.
  mismatchSince(): string | null {
    return readGapSince(this.#db);
  }

  // 10.4 (A47): a difference younger than the setting's hours: the bank is
  // still catching up, and the screens say so instead of the alarm. Her
  // setup: also while the check waits for one of her banks (12.3, HB9).
  #catchingUp(): boolean {
    if (this.#waiting()) return true;
    const since = readGapSince(this.#db);
    const book = this.book();
    if (since === null || book === null) return false;
    return this.#now().getTime() < Date.parse(since) + book.settings().totalsMismatchAlertHours * 3_600_000;
  }

  // Reads everything from the database again: after a sync, or a save that
  // did not go through.
  reload(): void {
    const history = readHistory(this.#db);
    const replayed = replayHistory(history, true);
    sealHistory(this.#db, replayed.unsealed);
    const recorder = replayed.book === null ? null : recorderOf(replayed.book);
    const book = recorder?.book ?? null;
    const today = (): IsoDate => this.today();
    const bankRules = new BankRulesDesk({
      rules: readBankRules(this.#db),
      log: bankRuleLogIn(this.#db),
      lines: () => bankLinesIn(this.#db),
      today,
      bookLines: () => book?.changeLog().length ?? 0,
      oldCardOff: () => this.#switches().oldCard === 'off',
      secondCardOff: () => this.#switches().secondCard === 'off',
    });
    let setup: SetupDesk | null = null;
    if (book === null) {
      const connection = setupConnectionOf(this.#db);
      // Upstream's history stays exactly as it was: its setup day names no switches.
      const switches = this.#start === UPSTREAM_START ? {} : { switches: this.#start.switches };
      setup = new SetupDesk({
        bank: { connection, setUp: false, accounts: readAccounts(this.#db), items: readItems(this.#db), rules: readBankRules(this.#db), ...switches },
        today,
        settings: this.#start.settings,
        halvesWithinDays: SETUP_LOOK_BACK_DAYS,
        madeUpData: false,
        bankRules,
        answers: replayed.setupAnswers === null ? NO_ANSWERS : setupAnswersOf(replayed.setupAnswers),
      });
    }
    this.#state = { recorder, seen: replayed.seen, bankRules, choices: book === null ? null : new ChoiceDesk(book, today), setup, alerts: replayed.alerts, wishlist: replayed.wishlist };
    this.#lastSeq = history.at(-1)?.seq ?? 0;
  }

  book(): Book | null {
    return this.#state.recorder?.book ?? null;
  }

  // His home time zone (section 2): the book's setting once tracking has
  // started, and before that the one it will start with.
  timeZone(): string {
    return (this.book()?.settings() ?? this.#start.settings).homeTimeZone;
  }

  // "Off in this setup": the book's, once tracking has started; before that,
  // what setup day will start with.
  #switches(): Switches {
    return this.book()?.switches() ?? this.#start.switches;
  }

  // 1.2: the accounts picked, each once, before the bank is read.
  #roles(): readonly AccountId[] {
    return rolesFor(this.#switches());
  }

  today(): IsoDate {
    return todayIn(this.timeZone(), this.#now());
  }

  // ----- What the screens show -----

  // Today's balances as the bank reports them, pending charges included
  // (12.1); null when the bank cannot be read: it wants him to log in again
  // (10.5), or its balances cannot be worked out.
  #bank(): BankBalances | null {
    return this.#bankNow().bank;
  }

  // Her setup (HB6): each card's name as its bank gives it; null without a second card.
  cardNames(): CardNames | null {
    return cardNamesOf(readAccounts(this.#db));
  }

  #statements(): CardStatement[] {
    return this.#bankNow().statements;
  }

  // 9.8 (A52): the cards whose statement cannot be read, so their reminders are off.
  #cardsOff(): CardRemindersOff[] {
    return this.#bankNow().cardsOff;
  }

  // The bank's balances and statements as the database has them, read again
  // only once something was written to it since (by this server or another):
  // the alert timer looks every minute.
  #bankNow(): BankNow {
    const { changes } = statement(this.#db, 'SELECT total_changes() AS changes').get() as { changes: number };
    const { data_version: written } = statement(this.#db, 'PRAGMA data_version').get() as { data_version: number };
    const version = `${changes} ${written}`;
    if (this.#bankRead?.version !== version) this.#bankRead = { version, ...this.#readBank(), ...this.#readStatements() };
    return this.#bankRead;
  }

  #readBank(): { readonly bank: BankBalances | null; readonly pendingIn: readonly PendingMoneyIn[]; readonly postingExamples: readonly PostingExample[] } {
    if (this.#cannotRead()) return { bank: null, pendingIn: [], postingExamples: [] };
    const accounts = readAccounts(this.#db);
    const items = readItems(this.#db);
    const view = bankView(accounts, items);
    if (!view.ok) return { bank: null, pendingIn: [], postingExamples: [] };
    // 11.4 (A57): when each was first seen pending, from the read that saved its sync.
    const times = readSyncTimes(this.#db);
    const pendingIn = view.view.pendingIn.map(({ firstSync, ...p }) => ({ ...p, firstSeen: times.get(firstSync) ?? null }));
    return { bank: view.view.withPending, pendingIn, postingExamples: postingExamples(accounts, items, times) };
  }

  // Each card's statement as the bank sent it, read with the days from
  // statement to due date set for that card (9.8). One the bank sent that
  // cannot be read is never dropped without a word: its reminders are off,
  // and Home and Settings say why.
  #readStatements(): { readonly statements: CardStatement[]; readonly cardsOff: CardRemindersOff[] } {
    const stored = readStatements(this.#db);
    const settings = this.book()?.settings() ?? null;
    const statements: CardStatement[] = [];
    const cardsOff: CardRemindersOff[] = [];
    for (const a of readAccounts(this.#db)) {
      const raw = stored.get(a.plaidAccountId)?.raw;
      if ((a.role !== 'everyday-card' && a.role !== 'old-card' && a.role !== 'second-card') || raw === undefined) continue;
      const closingDay = settings === null ? null : closingDayOf(a.role, settings);
      const read = cardStatement(a.role, raw, closingDay);
      if (read.ok) statements.push(read.statement);
      // Off for want of the closing day only when a closing day would read it.
      else cardsOff.push({ card: a.role, why: closingDay === null && cardStatement(a.role, raw, 1).ok ? 'no-statement-date' : 'unreadable' });
    }
    // The everyday card first, then her second card, as everywhere on the screens.
    cardsOff.sort((x, y) => CARD_ORDER.indexOf(x.card) - CARD_ORDER.indexOf(y.card));
    statements.sort((x, y) => CARD_ORDER.indexOf(x.card) - CARD_ORDER.indexOf(y.card));
    return { statements, cardsOff };
  }

  home(): HomeWithWishlist {
    const view = homeView({
      today: this.today(),
      book: this.book(),
      bank: this.#bank(),
      needsLogin: connectionsOf(this.#db).some((c) => c.needsLogin),
      // Her setup (0.5, 10.5): each bank that wants her to log in again, by name.
      ...(this.#banksInSetup() === 2 ? { banksToLogIn: connectionsOf(this.#db).flatMap((c) => (c.needsLogin ? [{ bank: c.bank, name: bankNameOf(c) }] : [])) } : {}),
      statements: this.#statements(),
      cardsOff: this.#cardsOff(),
      madeUpData: false,
      seenTakeBacks: this.#state.seen,
      lastChecked: readLastChecked(this.#db),
      checkedAt: this.#checkedAt(),
      catchingUp: this.#catchingUp(),
      bankDetail: this.#bankDetail(),
      // 11.4 (A57): first seen as a time in his home time zone.
      pendingIn: this.#bankNow().pendingIn.map((p) => ({ ...p, firstSeen: p.firstSeen === null || p.firstSeen === undefined ? null : timeIn(this.timeZone(), new Date(p.firstSeen)) })),
      postingExamples: this.#bankNow().postingExamples,
    });
    // 0.5, B82: the last safe to spend the bank backed up, and when.
    if (view.state === 'tracking' && view.safeToSpend.shown) saveLastChecked(this.#db, { amount: view.safeToSpend.amount, at: timeIn(this.timeZone(), this.#now()) });
    // Her rulebook, 52.1 and 52.2: each card, with what is set aside for it.
    // Her rulebook, 50.4: and the Wishlist money to move from savings to checking.
    return withWishlistMove(this.#withCards(view), this.#wishlistMove());
  }

  // Her rulebook, 50.4: from the book, the savings account as 3.8 reads it,
  // each card's statements (the latest and the kept ones, 52.5) and the days
  // the bank posted its items. Null without Wishlist or before setup day.
  #wishlistMove(): WishlistMove | null {
    const book = this.book();
    if (book === null || book.switches().wishlist !== 'on') return null;
    const settings = book.settings();
    const kept = readAccounts(this.#db).flatMap((a) => (a.role === 'everyday-card' || a.role === 'second-card' ? [{ card: a.role, raw: keptStatements(this.#db, a.plaidAccountId), closingDay: closingDayOf(a.role, settings) }] : []));
    // HB22: nothing is said while the check waits for a bank (12.3).
    const bank = this.#waiting() ? null : this.#bank();
    return wishlistMoveOf({ today: this.today(), book, bank, latest: this.#statements(), kept, items: readItems(this.#db) });
  }

  // Her rulebook, 52.1 and 52.2: Home with each card, from what each owed on
  // setup day as setup day counted it. Only in her setup, once tracking has
  // started; upstream's Home is upstream's.
  #withCards(view: HomeView): HomeWithCards {
    const book = this.book();
    const setup = book === null || this.#switches().secondCard !== 'on' ? null : readSetupInput(this.#db);
    if (book === null || setup === null) return view;
    const atSetup = { 'everyday-card': owedAtSetup(setup, 'everyday-card'), 'second-card': owedAtSetup(setup, 'second-card') };
    return withCards(view, homeCards({ atSetup }, this.today(), book, this.#bank(), this.#statements(), this.#cardsOff()));
  }

  // Her rulebook, 52.4 and 52.5: a card's last statement, from the
  // statements kept (her step 3), the book and the bank history. Only in her
  // setup; it only reads.
  statement(card: EverydayCard): StatementScreenView {
    if (this.#switches().secondCard !== 'on') return { state: 'off' };
    const account = readAccounts(this.#db).find((a) => a.role === card);
    const settings = this.book()?.settings() ?? null;
    return statementScreenView({
      today: this.today(),
      card,
      kept: account === undefined ? [] : keptStatements(this.#db, account.plaidAccountId),
      closingDay: settings === null ? null : closingDayOf(card, settings),
      book: this.book(),
      items: readItems(this.#db),
      accountId: account?.plaidAccountId ?? '',
      bankRules: readBankRules(this.#db),
      madeUpData: false,
    });
  }

  // Step 3: "Checked at": the last read of the bank, in his home time zone.
  #checkedAt(): CheckedAt | null {
    const read = this.lastRead();
    const zone = this.timeZone();
    return read === null ? null : { at: timeIn(zone, new Date(read)), timeZone: zone };
  }

  buckets(): BucketsView {
    return bucketsView({ today: this.today(), book: this.book(), bank: this.#bank(), madeUpData: false, catchingUp: this.#catchingUp(), why: this.#whyNow() });
  }

  // Section 40: the Trends tab, from the books and the bank history kept from
  // before setup day. It only reads: nothing is saved.
  trends(): TrendsView {
    return trendsView({ today: this.today(), book: this.book(), bank: this.#bank(), madeUpData: false, catchingUp: this.#catchingUp(), why: this.#whyNow(), before: beforeSetupOf(this.#db) });
  }

  review(): ReviewView {
    // B226: pending items the bank labels otherwise than his bank rules read them.
    const labeled = misreadHints(bankLinesOf({ accounts: readAccounts(this.#db), items: readItems(this.#db) }), readBankRules(this.#db));
    const view = reviewView({ today: this.today(), book: this.book(), madeUpData: false, labeled });
    // Her rulebook, 50.3: her list, for "which thing on your list was it".
    return view.state === 'tracking' && this.#switches().wishlist === 'on' ? { ...view, wishlistItems: itemsForReview(this.#state.wishlist) } : view;
  }

  activity(pot: AnyPot): ActivityView {
    const view = activityView({ today: this.today(), book: this.book(), pot, madeUpData: false });
    const book = this.book();
    if (view.state !== 'tracking' || book === null || this.#switches().wishlist !== 'on') return view;
    // Her rulebook, 50.3: her list, for a purchase sorted again to Wishlist;
    // 50.2: Wishlist's own list shows how the bucket fills the items too.
    return { ...view, wishlistItems: itemsForReview(this.#state.wishlist), ...(pot === 'wishlist' ? { list: wishlistListView(book, this.#state.wishlist) } : {}) };
  }

  payday(): PaydayView {
    return paydayView({ today: this.today(), book: this.book(), bank: this.#bank(), madeUpData: false });
  }

  // With the request, the login card for the device asking (Step 2).
  settings(request?: IncomingMessage): SettingsView {
    const rules = this.#state.bankRules;
    const session = request === undefined ? null : this.#auth.session(request.headers.cookie);
    return settingsView({
      today: this.today(),
      book: this.book(),
      bank: this.#bank(),
      madeUpData: false,
      bankRules: { rules: rules.rules(), log: rules.log(), recentDays: RECENT_DAYS },
      serverLog: serverLinesIn(this.#db),
      ...(session === null ? {} : { login: loginViewOf(this.#auth, session) }),
      sync: { everyMinutes: this.syncEveryMinutes(), checkedAt: this.#checkedAt(), today: this.today() },
      alerts: outboxCounts(this.#db),
      ...(session === null ? {} : { push: this.#push.view(session) }),
      cardsOff: this.#cardsOff(),
    });
  }

  // ----- The phone (Phase 5) -----

  // The real sender, or null when the server has no push keys.
  pushSender(): AlertSender | null {
    return this.#push.sender();
  }

  // The Notifications card's answers, for the device asking.
  pushDesk(): PushDesk {
    return this.#push;
  }

  // ----- Login (Step 2) -----

  // A new one-time code for making a passkey: good once, for 15 minutes.
  loginCode(): string {
    return this.#auth.newCode();
  }

  hasPasskeys(): boolean {
    return this.#auth.hasPasskeys();
  }

  setupView(): SetupView {
    return this.#state.setup?.view() ?? { state: 'tracking', madeUpData: false };
  }

  // ----- His answers -----

  choice(request: ChoiceRequest): ChoiceResponse {
    return this.#bookAnswer('choice', request, (desk) => desk.decide(request), 'That one was already dealt with', 'not-waiting', () => this.#boughtWith(request));
  }

  // Her rulebook, 50.3: a purchase sorted to Wishlist, and which thing on her
  // list it was, in the same answer. Worked out after the sort, from the book.
  #boughtWith(request: ChoiceRequest): { readonly ok: true; readonly wishlist?: readonly WishlistChange[]; readonly list?: WishlistList } | { readonly ok: false; readonly code: 'refused' | 'changed'; readonly why: string } {
    const book = this.book();
    if (this.#switches().wishlist !== 'on' || book === null) return request.wishlistItem === undefined ? { ok: true } : { ok: false, code: 'refused', why: `${NO_WISHLIST}. Nothing was changed.` };
    const asked = boughtWith(book, this.#state.wishlist, request.item, request.wishlistItem);
    if (!asked.ok) return { ok: false, code: asked.code === 'changed' ? 'changed' : 'refused', why: asked.why };
    if (asked.change === null) return { ok: true };
    const tried = tryWishlist(this.#state.wishlist, asked.change, this.today());
    if (!tried.ok) return { ok: false, code: tried.code === 'changed' ? 'changed' : 'refused', why: tried.why };
    return { ok: true, wishlist: [asked.change], list: tried.list };
  }

  // Her rulebook, 50.1 and 50.3: a change to her Wishlist list. Kept in the
  // history as an answer, with its decision number (through the choice desk's
  // numbers: they arrive the same way). It moves no money.
  wishlist(request: WishlistRequest): WishlistResponse {
    const earlier = this.#earlier('choice', request);
    if (earlier !== null) return earlier as WishlistResponse;
    if (this.#switches().wishlist !== 'on') return refuse('refused', NO_WISHLIST);
    if (this.book() === null) return refuse('refused', 'Your list starts on setup day');
    const edit = request.wishlist;
    if ('remove' in edit && request.confirmed !== true) {
      const item = this.#state.wishlist.items.find((i) => i.id === edit.remove.item);
      if (item !== undefined) return { ok: false, code: 'needs-confirmation', why: `Remove ${item.name} from your list? Nothing is changed until you say yes.` };
    }
    const tried = tryWishlist(this.#state.wishlist, edit, this.today());
    if (!tried.ok) return tried;
    const response: WishlistResponse = { ok: true, replayed: false };
    this.#save({ answer: { wishlist: [edit] }, decision: { id: request.id, desk: 'choice', fingerprint: canonical(request), answer: response } });
    this.#state = { ...this.#state, wishlist: tried.list };
    return response;
  }

  move(request: MoveRequest): MoveResponse {
    return this.#bookAnswer('move', request, (desk) => desk.move(request), 'There is nothing to move yet', 'refused');
  }

  settingsChange(request: SettingsRequest): SettingsResponse {
    return this.#bookAnswer('settings', request, (desk) => desk.settings(request), 'There is nothing to change before setup day', 'refused');
  }

  ruleChange(request: RuleRequest): RuleResponse {
    return this.#bookAnswer('rule', request, (desk) => desk.rule(request), 'There is nothing to change before setup day', 'refused');
  }

  setup(request: SetupRequest): SetupResponse {
    const earlier = this.#earlier('setup', request);
    if (earlier !== null) return earlier as SetupResponse;
    const { setup, bankRules } = this.#state;
    if (setup === null) return refuse('refused', 'Setup day is done already');
    const logged = bankRules.log().length;
    const response = this.#guarded(() => setup.decide(request));
    if (!response.ok || response.replayed) return response;
    const started = setup.started();
    const decision = { id: request.id, desk: 'setup' as const, fingerprint: canonical(request), answer: response };
    if (started === null) {
      this.#save({ answer: { setup: savedSetupAnswers(setup.answers()), ...this.#bankRuleLines(logged) }, decision, bankRulesChanged: bankRules.log().length > logged });
      return response;
    }
    // 14.3: tracking starts. Setup day is the first event of the book.
    const today = this.today();
    this.#write(() => {
      const seq = appendEvent(this.#db, { event: { kind: 'setup', input: started.input }, date: today, sync: null, totals: totalsOf(started.book) });
      for (const item of started.items) saveItem(this.#db, item);
      logChange(this.#db, today, 'setup day', { startingMoney: started.startingMoney, assignment: started.input.assignment, inTransit: (started.input.transfersInTransit ?? []).map((h) => h.id) });
      saveDecision(this.#db, { ...decision, seq });
      // 12.6: the books start out matching the bank as the last read left it.
      markSetupRead(this.#db);
    });
    this.reload();
    this.#changed();
    return response;
  }

  bankRule(request: BankRuleRequest): BankRuleResponse {
    const earlier = this.#earlier('bank-rule', request);
    if (earlier !== null) return earlier as BankRuleResponse;
    const { setup, bankRules } = this.#state;
    if (setup === null && this.book() === null) return refuse('refused', 'There is no bank connection yet');
    const logged = bankRules.log().length;
    // On Setup day, its desk takes it, so the steps follow the rules (24c).
    const response = this.#guarded(() => (setup !== null ? setup.bankRule(request) : bankRules.decide(request)));
    if (!response.ok || response.replayed) return response;
    this.#save({
      answer: { ...this.#bankRuleLines(logged), ...(setup === null ? {} : { setup: savedSetupAnswers(setup.answers()) }) },
      decision: { id: request.id, desk: 'bank-rule', fingerprint: canonical(request), answer: response },
      bankRulesChanged: true,
    });
    return response;
  }

  // 10.6: a take-back he has seen (B84). False when there is no such take-back.
  seen(what: Seen): boolean {
    const book = this.book();
    const known = book?.changeLog().some((entry) => entry.kind === 'bank-took-back' && entry.id === what.id) ?? false;
    if (!known || this.#state.seen.has(what.id)) return known;
    this.#save({ answer: { seen: what.id } });
    this.#state.seen.add(what.id);
    return true;
  }

  // ----- The bank connection (1.1 to 1.3) -----

  // The Bank connection screen's desk: one per server, so a connection on its
  // way is never made twice.
  bankDesk(bank: SyncBank): BankDesk {
    this.#bankDesk ??= new BankDesk({
      db: this.#db,
      plaid: bank.plaid,
      box: bank.box,
      log: bank.log,
      today: () => this.today(),
      zone: () => this.timeZone(),
      tracking: () => this.book() !== null,
      roles: () => this.#roles(),
      bookLines: () => this.book()?.changeLog().length ?? 0,
      sync: () => this.sync(bank),
      webhook: () => this.webhookAddress(),
      banks: () => this.#banksInSetup(),
      changed: () => {
        this.reload();
        this.#changed();
      },
    });
    return this.#bankDesk;
  }

  // ----- Syncing with the bank (Step 3) -----

  // One sync with the bank. Never two at once: asked again while one is on
  // its way (by the timer, or by --sync), it is that one, and gets its result.
  // What it brings is saved in one transaction (sync.ts) together with the
  // moment the bank was read, and the books in memory are read again right
  // after, in the same step: an answer that comes in meanwhile is saved
  // before the sync's save (which then works from it), or after it, against
  // the book with the sync in it, never in between. A sync that fails saves
  // nothing.
  // Her setup (her rulebook, section 2, PR 6): each sync reads both banks,
  // one after the other; `only` reads just those (a webhook about one, HB11).
  // A bank that fails keeps what the other read, is tried again at the next
  // time, and the sync then fails with its error.
  sync(bank: SyncBank, only?: readonly BankNumber[]): Promise<SyncResult> {
    if (this.#syncing !== null) return this.#syncing;
    // 1.2: nothing is read from the bank until all four accounts are picked.
    if (connectionsOf(this.#db).length > 0 && !rolesComplete(readAccounts(this.#db), this.#roles())) return Promise.reject(new Error('the accounts are not all picked yet (1.2): nothing is read from the bank until they are'));
    this.#lastTry = this.#now().getTime();
    const connected = connectionsOf(this.#db).map((c) => c.bank);
    // Upstream's setup reads its one connection, or says there is none.
    const banks = connected.length === 0 ? [1 as const] : connected.filter((b) => only === undefined || only.includes(b));
    const running = this.#syncBanks(bank, banks)
      .then(
        (result) => {
          // 0.7: how it went.
          this.#lastSync = { at: this.#now(), result: result.needsLogin ? 'needs-login' : result.changed ? 'new' : 'nothing-new' };
          // 10.5: the bank wants a new login; the sync saved only that.
          if (result.needsLogin) this.#changed();
          return result;
        },
        (error: unknown) => {
          this.#lastSync = { at: this.#now(), result: 'failed' };
          throw error;
        },
      )
      .finally(() => {
      this.#syncing = null;
    });
    this.#syncing = running;
    return running;
  }

  async #syncBanks(bank: SyncBank, banks: readonly BankNumber[]): Promise<SyncResult> {
    let together: SyncResult = { changed: false, needsLogin: false, added: 0, modified: 0, removed: 0, sent: 0, attention: [], historyComplete: true };
    let failed: { readonly error: unknown } | null = null;
    // Her setup (12.3, HB9): with both banks, the difference is looked at
    // once both are synced, so one bank failing after the other was read
    // starts no count.
    const both = banks.length > 1;
    for (const one of banks) {
      try {
        const result = await this.#syncOne(bank, one, both);
        together = {
          changed: together.changed || result.changed,
          needsLogin: together.needsLogin || result.needsLogin,
          added: together.added + result.added,
          modified: together.modified + result.modified,
          removed: together.removed + result.removed,
          sent: together.sent + result.sent,
          attention: [...together.attention, ...result.attention],
          historyComplete: together.historyComplete && result.historyComplete,
        };
      } catch (error) {
        failed ??= { error };
      }
    }
    if (both) {
      this.#noteGap();
      this.#changed();
    }
    if (failed !== null) throw failed.error;
    return together;
  }

  // One bank's sync. What it brings is saved in one transaction (sync.ts).
  async #syncOne(bank: SyncBank, one: BankNumber, laterGap = false): Promise<SyncResult> {
    try {
      const result = await syncBank({
        db: this.#db,
        plaid: bank.plaid,
        box: bank.box,
        log: bank.log,
        today: this.today(),
        ...(bank.pageSize === undefined ? {} : { pageSize: bank.pageSize }),
        readAt: () => this.#now().toISOString(),
        ...(this.#beforeCommit === undefined ? {} : { beforeCommit: this.#beforeCommit }),
        // Read again when it saved anything, or when the history has more than
        // the books in memory (another copy of the server saved a sync).
        ...(bank.plan === undefined ? {} : { plan: bank.plan }),
        ...(one === 1 ? {} : { bank: one }),
        afterSave: (result) => {
          if (result.changed || lastSeqOf(this.#db) !== this.#lastSeq) this.reload();
          if (!laterGap) this.#noteGap();
          this.#changed();
        },
      });
      this.#lastSyncs.set(one, { at: this.#now(), result: result.needsLogin ? 'needs-login' : result.changed ? 'new' : 'nothing-new' });
      return result;
    } catch (error) {
      this.#lastSyncs.set(one, { at: this.#now(), result: 'failed' });
      // Her setup (12.3, HB9): since when this bank's syncs fail; the check waits.
      if (this.#banksInSetup() === 2 && connectionsOf(this.#db).length > 0) {
        noteBankFailing(this.#db, one, this.#now().toISOString());
        this.#changed();
      }
      throw error;
    }
  }

  // Her rulebook, section 2 (HB11): Plaid's webhook for one bank syncs that
  // bank. An item that is neither connection's syncs nothing.
  syncItems(bank: SyncBank, itemIds: readonly string[]): Promise<SyncResult | null> {
    const banks = [...new Set(itemIds.flatMap((id) => connectionOfItem(this.#db, id)?.bank ?? []))].sort();
    return banks.length === 0 ? Promise.resolve(null) : this.sync(bank, banks);
  }

  // Her setup has two bank connections (her rulebook, 1.1).
  twoBanks(): boolean {
    return this.#banksInSetup() === 2;
  }

  // Her setup: every connection's item_id, bank 1 first.
  itemIds(): readonly string[] {
    return connectionsOf(this.#db).map((c) => c.itemId);
  }

  // Section 2 (A47): the sync on its way, if any, so a webhook that waits on
  // it can start its own after it.
  syncOnItsWay(): Promise<SyncResult> | null {
    return this.#syncing;
  }

  // His connection's item_id (a webhook must be about it); null before there is one.
  itemId(): string | null {
    return connectionsOf(this.#db)[0]?.itemId ?? null;
  }

  // Section 2 (A47): where Plaid sends its webhooks: the hosted server's own
  // https address. Null on this computer, which Plaid cannot reach.
  webhookAddress(): string | null {
    const origin = this.#origin();
    return origin.startsWith('https://') ? `${origin}${WEBHOOK_PATH}` : null;
  }

  // How long until the next sync is due, in milliseconds of real time: one
  // interval (section 2) after the last one started, or after the last read
  // when the server has just started. 0 or less: due now. Null while there is
  // no bank connection to read, or its accounts are not all picked (1.2).
  syncDueIn(): number | null {
    if (connectionsOf(this.#db).length === 0 || !rolesComplete(readAccounts(this.#db), this.#roles())) return null;
    if (this.#lastTry === null) return 0;
    return this.#lastTry + this.syncEveryMinutes() * 60_000 - this.#now().getTime();
  }

  // When the bank was last read, as an instant; null before the first read.
  lastRead(): string | null {
    return readLastRead(this.#db);
  }

  syncEveryMinutes(): number {
    return syncEveryMinutes(this.#db);
  }

  // Section 2: how often to sync, a whole number of minutes from 15 to 1,440.
  // It applies right away (13.1) and is logged (13.5).
  changeSyncEvery(minutes: unknown): { readonly ok: true } | { readonly ok: false; readonly why: string } {
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < FEWEST_MINUTES || minutes > MOST_MINUTES) {
      return { ok: false, why: `Syncing with the bank takes a whole number of minutes, ${FEWEST_MINUTES} to ${MOST_MINUTES.toLocaleString('en-US')}. Nothing was changed.` };
    }
    const before = this.syncEveryMinutes();
    if (minutes === before) return { ok: false, why: 'That is already the setting. Nothing was changed.' };
    this.#db.transaction(() => {
      saveSyncEveryMinutes(this.#db, minutes);
      saveServerLine(this.#db, { date: this.today(), action: 'sync-every-changed', before, after: minutes, afterBookLines: this.book()?.changeLog().length ?? 0 });
    })();
    return { ok: true };
  }

  // ----- Alerts (Phase 5) -----

  // Called after each sync and each answer: the alert timer looks then.
  whenChanged(run: () => void): void {
    this.#onChange = run;
  }

  #changed(): void {
    this.#onChange?.();
  }

  #alertWorld(): AlertWorld | null {
    const book = this.book();
    if (book === null) return null;
    const connections = connectionsOf(this.#db);
    const connection = connections[0];
    // Her setup (HB10): each bank's own; while the check waits for one (12.3,
    // HB9), the bank's numbers are not known to the alerts.
    const banks = this.#banksInSetup() === 2 ? connections.map((c) => ({ bank: c.bank, name: bankNameOf(c), needsLogin: c.needsLogin, lastRead: c.lastRead, permissionEnds: c.permissionEnds })) : null;
    return { book, now: this.#now(), zone: this.timeZone(), bank: this.#waiting() ? null : this.#bank(), needsLogin: connection?.needsLogin ?? false, statements: this.#statements(), lastRead: this.lastRead(), permissionEnds: connection?.permissionEnds ?? null, mismatchSince: this.mismatchSince(), cardNames: this.cardNames(), banks, wishlistMove: this.#wishlistMove() };
  }

  // Works out every alert due now (alerts/plan.ts) and keeps it: each
  // "alerts" event in the book's history with its alerts in the outbox, in one
  // step. Before setup day there is nothing to tell.
  checkAlerts(): void {
    for (let made = 0; made < 100_000; made += 1) {
      const world = this.#alertWorld();
      if (world === null) return;
      const event = nextAlertsEvent(world, this.#state.alerts);
      if (event === null) return;
      this.#write(() => {
        const seq = appendEvent(this.#db, { event: { kind: 'alerts', alerts: event }, date: todayIn(world.zone, world.now), sync: null, totals: totalsOf(world.book) });
        for (const alert of event.given) addToOutbox(this.#db, alert, seq, event.at);
      });
      this.#state = { ...this.#state, alerts: applyAlerts(this.#state.alerts, event) };
    }
    throw new Error('the alerts would not stop');
  }

  // Milliseconds until the next alert comes due by the clock alone (the next
  // evening, or the bank not read for a day, 10.7); null before setup day.
  nextDueIn(): number | null {
    const book = this.book();
    return book === null ? null : nextDueIn({ book, zone: this.timeZone(), now: this.#now(), lastRead: this.lastRead(), mismatchSince: this.mismatchSince(), banks: this.#alertWorld()?.banks ?? null }, this.#state.alerts);
  }

  // 10.8: when quiet hours end, if it is in them now (section 2, his home time zone).
  #quietUntil(now: Date): Date | null {
    return quietUntil(this.timeZone(), (this.book()?.settings() ?? this.#start.settings).quietHours, now);
  }

  // What is not sent yet, and what happens to each at this look (10.9, A40):
  // of what waited for the phone, only the newest of each kind is tried, and
  // only while it is still true.
  #sendPlan(): { readonly rows: readonly OutboxRow[]; readonly plan: SendPlan } {
    const rows = outboxUnsent(this.#db);
    if (rows.length === 0) return { rows, plan: { go: [], held: [], notTrue: [] } };
    const world = this.#alertWorld();
    const ledger = this.#state.alerts;
    return { rows, plan: planSends(rows, (f) => world === null || stillTrueNow(world, ledger, f)) };
  }

  // What is not sent yet and due to be tried now, oldest first, as the phone
  // is to get it: nothing in quiet hours (10.8); of what waited for the phone,
  // the newest of each kind if still true, the rest never (10.9, A40); words
  // only on the lock screen unless the setting says amounts (10.10); and, sent
  // late, when it was due.
  toSend(): readonly OutgoingAlert[] {
    const now = this.#now();
    if (this.#quietUntil(now) !== null) return [];
    const { rows, plan } = this.#sendPlan();
    if (plan.notTrue.length > 0) markNotSent(this.#db, plan.notTrue, 'not-true', now.toISOString());
    const zone = this.timeZone();
    const amounts = (this.book()?.settings() ?? this.#start.settings).amountsOnLockScreen;
    const sentOn = todayIn(zone, now);
    const go = new Set(plan.go);
    return rows
      .filter((row) => go.has(row.key) && row.nextTryAt <= now.toISOString())
      .map((row) => ({ id: row.key, ...wordsToSend(row, amounts, sentOn), dueAt: row.dueAt, due: dueWords(zone, row.dueAt, now), screen: alertScreen(row.facts) }));
  }

  nextTryIn(): number | null {
    const { rows, plan } = this.#sendPlan();
    const go = new Set(plan.go);
    const tries = rows.filter((row) => go.has(row.key)).map((row) => Date.parse(row.nextTryAt));
    if (tries.length === 0) return null;
    const now = this.#now();
    const quiet = this.#quietUntil(now);
    return Math.max(Math.min(...tries), quiet?.getTime() ?? 0) - now.getTime();
  }

  trying(key: string): void {
    markTrying(this.#db, key, this.#now().toISOString());
  }

  // Sent: and the older ones of its kind that waited for the phone are
  // replaced by it, in the same step (10.9, A40: "Not sent: a newer one went.").
  sent(key: string): void {
    const at = this.#now().toISOString();
    this.#db.transaction(() => {
      const rows = outboxUnsent(this.#db);
      const row = rows.find((r) => r.key === key);
      markSent(this.#db, key, at);
      if (row !== undefined) markNotSent(this.#db, replacedBy(rows, row), 'newer', at);
    })();
  }

  failed(key: string, why: string): void {
    markFailed(this.#db, key, this.#now().toISOString(), why);
  }

  // The alerts the app worked out, newest first, in his home time zone.
  alertsView(): AlertsView {
    if (this.book() === null) return { state: 'not-set-up' };
    const zone = this.timeZone();
    const local = (at: string): string => timeIn(zone, new Date(at));
    const { rows, total } = readOutbox(this.#db, ALERTS_SHOWN);
    const quiet = this.#quietUntil(this.#now());
    const held = new Set(this.#sendPlan().plan.held);
    return {
      state: 'tracking',
      today: this.today(),
      timeZone: zone,
      total,
      alerts: rows.map((row) => ({
        key: row.key,
        kind: row.kind,
        title: row.title,
        body: row.body,
        dueAt: local(row.dueAt),
        sentAt: row.sentAt === null ? null : local(row.sentAt),
        tries: row.tries,
        lastError: row.sentAt === null && row.notSent === null ? row.lastError : null,
        nextTryAt: row.sentAt === null && row.notSent === null && row.tries > 0 && !held.has(row.key) ? local(row.nextTryAt) : null,
        quietUntil: row.sentAt === null && row.notSent === null && quiet !== null ? local(quiet.toISOString()) : null,
        notSent: row.notSent ?? (held.has(row.key) ? 'held' : null),
      })),
    };
  }

  // 0.7 (A57): the status page, in his home time zone. No amounts. backups:
  // the watch on Litestream's heartbeat, hosted only.
  statusView(backups?: { readonly healthy: () => boolean; readonly lastBeat: number | null }): StatusView {
    const zone = this.timeZone();
    const local = (at: Date | string | number): string => timeIn(zone, new Date(at));
    const lastRead = this.lastRead();
    const since = this.mismatchSince();
    const started = this.#startedAt;
    if (started === null) throw new Error('the status page is only for books being served (Keeper.server)');
    return {
      state: this.book() === null ? 'not-set-up' : 'tracking',
      today: this.today(),
      timeZone: zone,
      lastRead: lastRead === null ? null : local(lastRead),
      lastSync: this.#lastSync === null ? null : { at: local(this.#lastSync.at), result: this.#lastSync.result },
      backups: backups === undefined ? null : { copying: backups.healthy(), lastBeat: backups.lastBeat === null ? null : local(backups.lastBeat) },
      started: local(started),
      history: { whenOpened: this.#eventsWhenOpened, now: countEvents(this.#db) },
      mismatchSince: since === null ? null : local(since),
      alertsWaiting: outboxCounts(this.#db).notSent,
      // Her setup (0.7): each bank's own.
      ...(this.#banksInSetup() === 2
        ? {
            banks: connectionsOf(this.#db).map((c) => {
              const last = this.#lastSyncs.get(c.bank);
              return { bank: c.bank, name: bankNameOf(c), lastRead: c.lastRead === null ? null : local(c.lastRead), lastSync: last === undefined ? null : { at: local(last.at), result: last.result } };
            }),
          }
        : {}),
    };
  }

  // Phase 6, /health: the books can be read now. Says nothing of what is in them.
  healthy(): boolean {
    try {
      return statement(this.#db, 'SELECT 1 AS ok').get() !== undefined;
    } catch {
      return false;
    }
  }

  // The web server for the screens, with these books behind it. Every
  // screen and every /api address needs a login (Step 2), checked against
  // the app's own address, `origin`.
  // A43: hosted, `backups` watches Litestream's heartbeat for /health/backups.
  // 1.1 to 1.3: with `bank`, the Bank connection screen (the real server always has it).
  // Section 2 (A47): with `webhook`, Plaid's webhooks (the real server always has it).
  server(
    webRoot: string,
    origin: () => string,
    onError?: (error: unknown) => void,
    extras: { readonly backups?: { readonly beat: () => void; readonly healthy: () => boolean; readonly lastBeat: number | null }; readonly bank?: SyncBank; readonly webhook?: WebhookHandler } = {},
  ): Server {
    const { backups, bank, webhook } = extras;
    const desk = bank === undefined ? null : this.bankDesk(bank);
    this.#origin = origin;
    this.#startedAt ??= this.#now();
    const auth = this.#auth;
    // "Off in this setup": what is off is taken out of each screen before it
    // is sent; and in her setup each card is named as its bank names it (HB6).
    return createAppServer(cardsNamed(() => this.cardNames(), offTakenOut(() => this.#switches(), {
      webRoot,
      ...(onError === undefined ? {} : { onError }),
      gate: {
        origin,
        loggedIn: (request) => auth.session(request.headers.cookie) !== null,
        auth: (path, request, body) => answerAuth(auth, path, request, body, auth.session(request.headers.cookie)),
      },
      home: () => this.home(),
      buckets: () => this.buckets(),
      trends: () => this.trends(),
      review: () => this.review(),
      activity: (_request, pot) => this.activity(pot),
      wishlistActivity: () => this.activity('wishlist'),
      payday: () => this.payday(),
      settings: (request) => this.settings(request),
      setupView: () => this.setupView(),
      choice: (_request, choice) => this.choice(choice),
      move: (_request, move) => this.move(move),
      settingsChange: (_request, change) => this.settingsChange(change),
      ruleChange: (_request, change) => this.ruleChange(change),
      setup: (_request, answer) => this.setup(answer),
      bankRule: (_request, change) => this.bankRule(change),
      wishlist: (_request, change) => this.wishlist(change),
      seen: (_request, what) => this.seen(what),
      syncEvery: (_request, minutes) => this.changeSyncEvery(minutes),
      alerts: () => this.alertsView(),
      status: () => this.statusView(backups),
      statement: (_request, card) => this.statement(card),
      health: () => this.healthy(),
      ...(backups === undefined ? {} : { backups }),
      ...(webhook === undefined ? {} : { webhook }),
      ...(desk === null || bank === undefined
        ? {}
        : {
            bank: {
              bankAddress: PLAID_URLS[bank.plaid.environment],
              view: () => desk.view(),
              link: (_request, request) => desk.link(request),
              connected: (_request, request) => desk.connected(request),
              roles: (_request, request) => desk.roles(request),
              read: (_request, request) => desk.read(request),
            },
          }),
      push: {
        on: (request, subscription) => this.#asking(request, (asking) => this.#push.on(asking, subscription)),
        off: (request) => this.#asking(request, (asking) => this.#push.off(asking)),
        test: async (request) => {
          const session = auth.session(request.headers.cookie);
          return session === null ? NOT_LOGGED_IN : this.#push.test(session);
        },
      },
    })));
  }

  // The device asking, by its login (the gate let it through only logged in).
  #asking<T>(request: IncomingMessage, run: (asking: { readonly token: string; readonly device: string }) => T): T | typeof NOT_LOGGED_IN {
    const session = this.#auth.session(request.headers.cookie);
    return session === null ? NOT_LOGGED_IN : run(session);
  }

  // ----- Keeping it -----

  // A decision number already used: the same request gets its first answer
  // back, and changes nothing; a different one is refused.
  #earlier(desk: DeskName, request: { readonly id: string }): unknown {
    const saved = readDecision(this.#db, request.id);
    if (saved === null) return null;
    if (saved.fingerprint === canonical(request)) return { ...(saved.answer as object), replayed: true };
    return refuse('id-reused', `That decision number was already used for a different ${NOUNS[desk]}.`);
  }

  // An answer the book takes, through its desk. What the desk did to the
  // book is written down, and saved with the decision number and the answer.
  // Her rulebook, 50.3: `more` adds to the same answer what the book's change
  // means for her Wishlist list; if it refuses, the book's change is undone.
  #bookAnswer<R extends { readonly ok: boolean; readonly replayed?: boolean }>(
    desk: DeskName,
    request: { readonly id: string },
    run: (desk: ChoiceDesk) => R,
    beforeSetup: string,
    code: 'not-waiting' | 'refused',
    more?: () => { readonly ok: true; readonly wishlist?: readonly WishlistChange[]; readonly list?: WishlistList } | { readonly ok: false; readonly code: 'refused' | 'changed'; readonly why: string },
  ): R {
    const earlier = this.#earlier(desk, request);
    if (earlier !== null) return earlier as R;
    const { choices, recorder } = this.#state;
    if (choices === null || recorder === null) return refuse(code, beforeSetup) as unknown as R;
    recorder.start();
    let response: R;
    try {
      response = run(choices);
    } catch (error) {
      recorder.take();
      this.reload();
      throw error;
    }
    const calls = recorder.take();
    if (!response.ok || response.replayed === true) {
      if (calls.length > 0) {
        this.reload();
        throw new Error('an answer that was refused changed the book');
      }
      return response;
    }
    const extra = more?.() ?? { ok: true as const };
    if (!extra.ok) {
      this.reload();
      return extra as unknown as R;
    }
    this.#save({ answer: { book: calls, ...(extra.wishlist === undefined ? {} : { wishlist: extra.wishlist }) }, decision: { id: request.id, desk, fingerprint: canonical(request), answer: response } });
    if (extra.list !== undefined) this.#state = { ...this.#state, wishlist: extra.list };
    return response;
  }

  // Runs a desk; anything unexpected reads everything again, so nothing half
  // done stays in memory.
  #guarded<R>(run: () => R): R {
    try {
      return run();
    } catch (error) {
      this.reload();
      throw error;
    }
  }

  // The change log lines a bank rule change added, for its event.
  #bankRuleLines(before: number): Pick<Answer, 'bankRules'> {
    const lines = this.#state.bankRules.log().slice(before);
    return lines.length === 0 ? {} : { bankRules: lines };
  }

  // Saves one answer: the event, with the totals after it, its decision
  // number and first answer, and for a bank rule change the rules and their
  // change log lines. All in one transaction.
  #save(what: { readonly answer: Answer; readonly decision?: Omit<Parameters<typeof saveDecision>[1], 'seq'>; readonly bankRulesChanged?: boolean }): void {
    const today = this.today();
    const book = this.book();
    const rules = this.#state.bankRules;
    this.#write(() => {
      const seq = appendEvent(this.#db, { event: { kind: 'answer', answer: what.answer }, date: today, sync: null, totals: totalsOf(book) });
      if (what.bankRulesChanged === true) {
        saveBankRules(this.#db, rules.rules());
        for (const line of what.answer.bankRules ?? []) saveBankRuleLine(this.#db, line);
      }
      if (what.decision !== undefined) saveDecision(this.#db, { ...what.decision, seq });
    });
    this.#changed();
  }

  // One transaction. If it does not go through, nothing of it is saved, and
  // what is in memory is read again from the database, which never had it.
  #write(writes: () => void): void {
    try {
      this.#db.transaction(() => {
        writes();
        this.#beforeCommit?.();
      })();
      this.#lastSeq = lastSeqOf(this.#db);
    } catch (error) {
      this.reload();
      throw error;
    }
  }
}

// ----- Setup day answers, kept as lists -----

function savedSetupAnswers(a: SetupAnswers): SavedSetupAnswers {
  return { onItsWay: [...a.onItsWay], halvesWithinDays: a.halvesWithinDays, lastPaycheckDate: a.lastPaycheckDate, assignment: { ...a.assignment }, suggestions: [...a.suggestions] };
}

function setupAnswersOf(s: SavedSetupAnswers): SetupAnswers {
  return {
    onItsWay: new Map(s.onItsWay),
    halvesWithinDays: s.halvesWithinDays,
    lastPaycheckDate: s.lastPaycheckDate,
    assignment: s.assignment as unknown as SetupAnswers['assignment'],
    suggestions: new Map(s.suggestions) as SetupAnswers['suggestions'],
  };
}

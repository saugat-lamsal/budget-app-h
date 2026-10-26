import type { IncomingMessage, Server } from 'node:http';
import { DEFAULT_SETTINGS, type Book, type IsoDate } from '@budget-app/money';
import { BankRulesDesk } from '../bank-rules-desk.js';
import { RECENT_DAYS, bankLinesOf } from '../bank-rules.js';
import { ChoiceDesk } from '../choices.js';
import { createAppServer, send } from '../http/server.js';
import { activityView } from '../views/activity.js';
import { bucketsView } from '../views/buckets.js';
import { trendsView } from '../trends.js';
import { homeView, type HomeInput } from '../views/home.js';
import { paydayView } from '../views/payday.js';
import { reviewView } from '../views/review.js';
import { SetupDesk } from '../setup-desk.js';
import { settingsView } from '../views/settings.js';
import { NO_ANSWERS, SETUP_LOOK_BACK_DAYS, setupView } from '../setup-view.js';
import { madeUpHistory, madeUpLines } from './made-up-bank.js';
import { DEMO_BANK_RULES, DEMO_SCENARIOS, SETUP_SCENARIOS, demoScenario, madeUpFeed, type DemoScenario } from './scenarios.js';
import { HER_SCENARIOS, herScenario, type HerLive } from './her-lives.js';
import { herActivity, herBuckets, herChoice, herHome, herPayday, herReview, herSettings, herStatement, herTrends, herWishlist } from './her-screens.js';

// The screens on made-up data only (Phase 4). /demo lists the made-up
// lives; picking one remembers it in a cookie and opens Home. Nothing here
// reads the database or talks to the bank, so it is safe to open over wifi.

export function createDemoServer(options: { readonly webRoot: string; readonly onError?: (error: unknown) => void }): Server {
  // Each made-up life is lived once, in memory, while the demo runs: the
  // take-backs marked seen, and every choice made in Review, stay as they
  // are. Picking the life again starts it over.
  const lives = new Map<string, Live>();
  const liveOf = (scenario: DemoScenario): Live => {
    let live = lives.get(scenario.name);
    if (live === undefined) {
      if (scenario.input === null) throw new Error('made-up failure, for the demo');
      // Her lives (her-lives.ts) bring their cards, statements and list with their input.
      const her = scenario.her?.() ?? null;
      const input = her?.input ?? scenario.input();
      // The bank rules are kept per life, and read with Setup day and
      // Settings alike (section 2, 24c).
      const holder: { live?: Live } = {};
      const bankRules = demoBankRulesDesk(scenario, input.today, () => holder.live?.input.book ?? null, input.book);
      // A life not set up yet does setup day on its made-up bank (section 14).
      const setup = demoSetupDesk(scenario, input.today, bankRules);
      live = { input, seen: new Set(), desk: input.book === null ? null : new ChoiceDesk(input.book, () => input.today), setup, bankRules, her, wishlistDone: new Set() };
      holder.live = live;
      lives.set(scenario.name, live);
    }
    return live;
  };
  // Slow lives take their time before any screen's numbers arrive.
  const wait = async (scenario: DemoScenario): Promise<Live> => {
    if (scenario.delayMs !== undefined) await new Promise((done) => setTimeout(done, scenario.delayMs));
    return liveOf(scenario);
  };
  return createAppServer({
    webRoot: options.webRoot,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    home: async (request) => {
      const live = await wait(scenarioOf(request));
      const view = homeView({ ...live.input, seenTakeBacks: live.seen });
      return live.her === null ? view : herHome(live.her, view);
    },
    buckets: async (request) => {
      const { input, her } = await wait(scenarioOf(request));
      const view = bucketsView({ today: input.today, book: input.book, bank: input.bank, madeUpData: input.madeUpData, catchingUp: input.catchingUp ?? false, why: input.bankDetail?.why ?? null });
      return her === null ? view : herBuckets(view);
    },
    trends: async (request) => {
      const scenario = scenarioOf(request);
      const { input, her } = await wait(scenario);
      const view = trendsView({ today: input.today, book: input.book, bank: input.bank, madeUpData: input.madeUpData, catchingUp: input.catchingUp ?? false, why: input.bankDetail?.why ?? null, before: scenario.trends?.() ?? null });
      return her === null ? view : herTrends(view);
    },
    review: async (request) => {
      const { input, her } = await wait(scenarioOf(request));
      const view = reviewView({ today: input.today, book: input.book, madeUpData: input.madeUpData });
      return her === null ? view : herReview(her, view);
    },
    choice: (request, choice) => {
      const { desk, her } = liveOf(scenarioOf(request));
      // Before setup day there is nothing in review to choose from.
      if (desk === null) return { ok: false, code: 'not-waiting', why: 'That one was already dealt with. Nothing was changed.' };
      return her === null ? desk.decide(choice) : herChoice(her, desk, choice);
    },
    move: (request, move) => {
      const { desk } = liveOf(scenarioOf(request));
      // Before setup day there are no buckets to move money between.
      if (desk === null) return { ok: false, code: 'refused', why: 'There is nothing to move yet. Nothing was changed.' };
      return desk.move(move);
    },
    activity: async (request, pot) => {
      const { input, her } = await wait(scenarioOf(request));
      const view = activityView({ today: input.today, book: input.book, pot, madeUpData: input.madeUpData });
      return her === null ? view : herActivity(her, view, pot);
    },
    // Her setup's Wishlist list (50.2) and the changes to it (50.1); upstream's lives have none.
    wishlistActivity: async (request) => {
      const { input, her } = await wait(scenarioOf(request));
      if (her === null) throw new Error('this made-up life has no Wishlist');
      return herActivity(her, activityView({ today: input.today, book: input.book, pot: 'wishlist', madeUpData: input.madeUpData }), 'wishlist');
    },
    wishlist: (request, sent) => {
      const live = liveOf(scenarioOf(request));
      return live.her === null ? null : herWishlist(live.her, live.wishlistDone, sent);
    },
    statement: async (request, card) => {
      const { her } = await wait(scenarioOf(request));
      if (her === null) return { state: 'off' };
      return herStatement(her, card);
    },
    payday: async (request) => {
      const { input, her } = await wait(scenarioOf(request));
      const view = paydayView({ today: input.today, book: input.book, bank: input.bank, madeUpData: input.madeUpData });
      return her === null ? view : herPayday(view);
    },
    settings: async (request) => {
      const { input } = await wait(scenarioOf(request));
      const { bankRules, her } = liveOf(scenarioOf(request));
      const view = settingsView({ today: input.today, book: input.book, bank: input.bank, madeUpData: input.madeUpData, bankRules: { rules: bankRules.rules(), log: bankRules.log(), recentDays: RECENT_DAYS }, ...(input.cardsOff === undefined ? {} : { cardsOff: input.cardsOff }) });
      return her === null ? view : herSettings(view);
    },
    settingsChange: (request, change) => {
      const { desk } = liveOf(scenarioOf(request));
      // Before setup day there are no settings in the book to change.
      if (desk === null) return { ok: false, code: 'refused', why: 'There is nothing to change before setup day. Nothing was changed.' };
      return desk.settings(change);
    },
    ruleChange: (request, change) => {
      const { desk } = liveOf(scenarioOf(request));
      if (desk === null) return { ok: false, code: 'refused', why: 'There is nothing to change before setup day. Nothing was changed.' };
      return desk.rule(change);
    },
    setupView: async (request) => {
      const live = await wait(scenarioOf(request));
      if (live.setup !== null) return live.setup.view();
      // A life with a book is set up; the one before setup day has no bank to read.
      if (live.input.book !== null) return { state: 'tracking', madeUpData: true };
      return setupView({ today: live.input.today, madeUpData: true, bank: null, answers: NO_ANSWERS, settings: DEFAULT_SETTINGS, rules: [], halvesWithinDays: SETUP_LOOK_BACK_DAYS });
    },
    setup: (request, answer) => {
      const live = liveOf(scenarioOf(request));
      if (live.setup === null) {
        return { ok: false, code: 'refused', why: live.input.book === null ? 'There is no bank connection yet. Nothing was changed.' : 'Setup day is done already. Nothing was changed.' };
      }
      const response = live.setup.decide(answer);
      // Tracking has started: Home and every other screen read the new book.
      const started = live.setup.started();
      if (started !== null && live.input.book === null) {
        const today = live.input.today;
        live.input = { ...live.input, book: started.book, bank: started.bank };
        live.desk = new ChoiceDesk(started.book, () => today);
      }
      return response;
    },
    bankRule: (request, change) => {
      const live = liveOf(scenarioOf(request));
      // On Setup day, its desk takes it, so the transfers step follows (24c).
      if (live.setup !== null) return live.setup.bankRule(change);
      if (live.input.book === null) return { ok: false, code: 'refused', why: 'There is no bank connection yet. Nothing was changed.' };
      return live.bankRules.decide(change);
    },
    seen: (request, what) => {
      const live = liveOf(scenarioOf(request));
      const known = live.input.book?.changeLog().some((entry) => entry.kind === 'bank-took-back' && entry.id === what.id) ?? false;
      if (known) live.seen.add(what.id);
      return known;
    },
    extra: (request, response, path) => {
      if (path === '/demo' || path === '/demo/') {
        send(response, 200, 'text/html; charset=utf-8', demoPage(scenarioOf(request)), 'no-store');
        return true;
      }
      if (path === '/demo/demo.css') {
        send(response, 200, 'text/css; charset=utf-8', DEMO_CSS, 'no-store');
        return true;
      }
      const picked = /^\/demo\/([a-z-]+)$/.exec(path)?.[1];
      if (picked === undefined) return false;
      if (demoScenario(picked) === undefined && herScenario(picked) === undefined) {
        send(response, 404, 'text/plain; charset=utf-8', 'No such made-up life.', 'no-store');
        return true;
      }
      lives.delete(picked);
      response.setHeader('Set-Cookie', `demo=${picked}; Path=/; HttpOnly; SameSite=Strict`);
      response.setHeader('Location', '/home');
      send(response, 303, 'text/plain; charset=utf-8', 'Opening Home.', 'no-store');
      return true;
    },
  });
}

// One made-up life while the demo runs: its book, the take-backs seen, and
// the desk that takes his choices. A life not set up yet has a setup desk;
// once tracking starts, its book and a choice desk take over.
interface Live {
  input: HomeInput;
  readonly seen: Set<string>;
  desk: ChoiceDesk | null;
  readonly setup: SetupDesk | null;
  readonly bankRules: BankRulesDesk;
  // Her setup's life (her-lives.ts), or null for upstream's.
  readonly her: HerLive | null;
  // The decision numbers of the changes made to her Wishlist list.
  readonly wishlistDone: Set<string>;
}

// The setup desk of a made-up life not set up yet, on its made-up bank, with
// the settings tracking starts with (section 2: the paycheck rule and the
// mom rule are not set yet). Null for a life that has no bank to set up from.
// Tests make their twin of a life with this too.
export function demoSetupDesk(scenario: DemoScenario, today: IsoDate, bankRules?: BankRulesDesk): SetupDesk | null {
  if (scenario.setup === undefined) return null;
  return new SetupDesk({
    bank: madeUpHistory(scenario.setup()),
    today: () => today,
    settings: DEFAULT_SETTINGS,
    halvesWithinDays: SETUP_LOOK_BACK_DAYS,
    madeUpData: true,
    bankRules: bankRules ?? demoBankRulesDesk(scenario, today, () => null),
  });
}

// The bank rules of a made-up life, kept in memory (section 2, 24c): a life
// not set up yet starts with its made-up bank's rules and history; a life
// that is tracking, with the rules its made-up bank came with and what that
// bank sent its book. bookOf gives the life's book once it has one, for
// placing each change in the change log; made, the book the life began with
// (made again from the life when not given). Tests make their twin with this too.
export function demoBankRulesDesk(scenario: DemoScenario, today: IsoDate, bookOf: () => Book | null, made?: Book | null): BankRulesDesk {
  const bank = scenario.setup === undefined ? null : madeUpHistory(scenario.setup());
  const book = bank !== null ? null : made !== undefined ? made : (scenario.input?.().book ?? null);
  const lines = bank !== null ? bankLinesOf(bank) : book === null ? [] : madeUpLines(madeUpFeed(book));
  return new BankRulesDesk({ rules: bank?.rules ?? (book === null ? [] : (scenario.bankRules ?? DEMO_BANK_RULES)), lines: () => lines, today: () => today, bookLines: () => bookOf()?.changeLog().length ?? 0 });
}

// Where the demo listens: this computer only, unless --wifi.
export function demoAddress(args: readonly string[]): { readonly host: string; readonly port: number; readonly wifi: boolean } {
  const wifi = args.includes('--wifi');
  const portAt = args.indexOf('--port');
  const port = portAt === -1 ? 5180 : Number(args[portAt + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`--port needs a port number, got ${String(args[portAt + 1])}`);
  return { host: wifi ? '0.0.0.0' : '127.0.0.1', port, wifi };
}

function scenarioOf(request: IncomingMessage): DemoScenario {
  const cookie = request.headers.cookie ?? '';
  const name = /(?:^|;\s*)demo=([a-z-]+)/.exec(cookie)?.[1] ?? 'normal';
  return demoScenario(name) ?? herScenario(name) ?? (DEMO_SCENARIOS[0] as DemoScenario);
}

function demoPage(current: DemoScenario): string {
  const item = (s: DemoScenario): string => `<li><a href="/demo/${s.name}"${s === current ? ' aria-current="true"' : ''}>${s.title}</a></li>`;
  const items = DEMO_SCENARIOS.map(item).join('\n');
  const setupItems = SETUP_SCENARIOS.map(item).join('\n');
  const herItems = HER_SCENARIOS.map(item).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Made-up lives</title>
<link rel="stylesheet" href="/demo/demo.css">
</head>
<body>
<h1>Made-up lives</h1>
<p>Every number here is invented. Pick one to open Home with it. Come back to <b>/demo</b> to switch.</p>
<ul>
${items}
</ul>
<h2>Not set up yet</h2>
<p>These open Setup day with a made-up bank.</p>
<ul>
${setupItems}
</ul>
<h2>Her setup</h2>
<p>Made-up lives set up the way hers is: two cards, a Wishlist, and her paycheck asking first.</p>
<ul>
${herItems}
</ul>
</body>
</html>`;
}

const DEMO_CSS = `
:root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0 auto; max-width: 36rem; padding: max(16px, env(safe-area-inset-top)) 16px 32px; line-height: 1.4; }
ul { list-style: none; padding: 0; }
a { display: flex; align-items: center; min-height: 44px; padding: 4px 0; }
a[aria-current] { font-weight: 700; }
a[aria-current]::after { content: " (showing)"; font-weight: 400; }
`;

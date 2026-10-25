import { parseDollars, type Cents } from '@budget-app/money';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type BrowserType, type Page, type Request } from 'playwright';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createDemoServer } from '../../../server/src/demo/demo-server.js';
import { MINUS } from '../../src/ui/money-format.js';

// Browser tests: the built screens in real browsers, used like a person
// would on an iPhone, with what they show compared to the money math.
// Chromium, and WebKit because iPhone Safari is WebKit.

export const WEB_ROOT = fileURLToPath(new URL('../../dist/', import.meta.url));

// BROWSER_ENGINE=chromium (or webkit) runs one engine only. With none given,
// the default run (npm test, CI on every pull request) uses WebKit, iPhone
// Safari's engine, and the slow run (TEST_SLOW=1, npm run test:slow) uses
// Chromium. The break-it check uses BROWSER_ENGINE to go faster: a break that
// one engine's tests catch is caught.
const ENGINE = process.env['BROWSER_ENGINE'] ?? (process.env['TEST_SLOW'] === '1' ? 'chromium' : 'webkit');
export const ENGINES: readonly (readonly [string, BrowserType])[] = (
  [
    ['chromium', chromium],
    ['webkit', webkit],
  ] as const
).filter(([name]) => ENGINE === name);

// An iPhone 15 as a home-screen app: the whole screen, no browser bars.
export const IPHONE = { width: 393, height: 852 } as const;
// Where the iPhone 15's Dynamic Island and home bar are (safe areas).
export const IPHONE_INSETS = { top: 59, bottom: 34 } as const;

export interface PhoneOptions {
  readonly colorScheme?: 'light' | 'dark';
  // Reduced by default: the page's light floats forever, and animations must never make a test flaky.
  readonly reducedMotion?: 'reduce' | 'no-preference';
  // Only to add test styles (the notch, a bigger text size); the app itself
  // always runs under its own content security policy.
  readonly bypassCSP?: boolean;
  readonly deviceScaleFactor?: number;
}

export function phone(options: PhoneOptions = {}): BrowserContextOptions {
  return {
    userAgent: devices['iPhone 15']?.userAgent ?? 'iPhone',
    viewport: IPHONE,
    screen: IPHONE,
    deviceScaleFactor: options.deviceScaleFactor ?? 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: options.colorScheme ?? 'light',
    reducedMotion: options.reducedMotion ?? 'reduce',
    bypassCSP: options.bypassCSP ?? false,
    // Times on the screens are in the phone's time zone; the tests pin one.
    timezoneId: 'America/Chicago',
  };
}

// What each test server was asked, and when it answered, so a page that
// gets stuck can say whether its request reached the server at all.
interface ServerLogEntry {
  readonly method: string;
  readonly url: string;
  readonly at: number;
  // The browser's end of the connection it came on.
  readonly from: number | undefined;
  done: number | null;
  status: number | null;
}
const serverLogs = new Map<string, ServerLogEntry[]>();
// The connections each test server has open now, by the browser's end, with when each opened.
const serverConnections = new Map<string, Map<number | undefined, number>>();

// Every answer closes its connection (test/test-server.test.ts says why): WebKit,
// as Playwright builds it for Linux and Windows, loses the answer to a request
// on a connection that was reused after a cancelled one or while the server
// was closing it. With nothing to reuse, that cannot happen.
export async function listen(server: Server, port = 0): Promise<string> {
  server.prependListener('request', (_request, response) => {
    response.setHeader('Connection', 'close');
  });
  await listenOn(server, port);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const log: ServerLogEntry[] = [];
  serverLogs.set(base, log);
  const open = new Map<number | undefined, number>();
  serverConnections.set(base, open);
  server.on('connection', (socket) => {
    const from = socket.remotePort;
    open.set(from, Date.now());
    socket.on('close', () => open.delete(from));
  });
  server.on('request', (request, response) => {
    const entry: ServerLogEntry = { method: request.method ?? '?', url: request.url ?? '?', at: Date.now(), from: request.socket.remotePort, done: null, status: null };
    log.push(entry);
    if (log.length > 200) log.shift();
    response.on('finish', () => {
      entry.done = Date.now();
      entry.status = response.statusCode;
    });
  });
  return base;
}

// Browsers refuse to open some ports: Chromium's and WebKit's lists all end at
// 10080 (3659, 4045, 5060, 6000, 6665 to 6669, ...). This PC hands out ports
// from 1024 up, one after another, and gave a test server 3659 (Oct 9): every
// test on it failed with net::ERR_UNSAFE_PORT. The CI machines start at 32768
// (Linux) and 49152 (Windows). A server given such a port listens again.
const HIGHEST_PORT_A_BROWSER_REFUSES = 10_080;

async function listenOn(server: Server, port: number): Promise<void> {
  await listenAt(server, port);
  while ((server.address() as AddressInfo).port <= HIGHEST_PORT_A_BROWSER_REFUSES) {
    await new Promise<void>((done) => server.close(() => done()));
    await listenAt(server, 0);
  }
}

function listenAt(server: Server, port: number): Promise<void> {
  return new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail);
      done();
    });
  });
}

// What the page's own code has asked for with fetch and is still waiting on,
// kept inside the page, where it is exact: a fetch is counted the moment it
// starts, and only counts as answered once the whole answer has arrived (the
// body too, not just the headers). The events Playwright sends about requests
// can arrive late (CI, Oct 8: WebKit on Linux, Chromium on Windows), so the
// tests never decide anything from them; they are only reported when a page
// gets stuck.
interface PageFetches {
  // How many are on their way.
  count: number;
  // When one last started or was answered (performance.now()).
  changed: number;
  // What each one on its way is, for the report.
  readonly onTheirWay: Map<number, string>;
}

// Runs inside the page, before any of its own scripts.
function trackFetches(): void {
  const w = window as unknown as { __fetches?: PageFetches };
  if (w.__fetches !== undefined) return;
  const fetches: PageFetches = { count: 0, changed: performance.now(), onTheirWay: new Map() };
  w.__fetches = fetches;
  let next = 0;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    next += 1;
    const id = next;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetches.onTheirWay.set(id, `${init?.method ?? 'GET'} ${url}, started ${Math.round(performance.now())}ms after the page opened`);
    fetches.count += 1;
    fetches.changed = performance.now();
    const done = (): void => {
      if (!fetches.onTheirWay.delete(id)) return;
      fetches.count -= 1;
      fetches.changed = performance.now();
    };
    return real(input, init).then(
      (response) => {
        // Answered once the body has arrived too: a copy is read to the end for
        // that, and the page reads its own.
        response.clone().arrayBuffer().then(done, done);
        return response;
      },
      (error: unknown) => {
        done();
        throw error;
      },
    );
  };
}

// Follows a page's requests and console, for the report when it gets stuck.
const pageWatch = new WeakMap<Page, { readonly pending: Map<Request, number>; readonly started: [string, number][]; readonly failed: string[]; readonly console: string[] }>();

function followEvents(page: Page): void {
  if (pageWatch.has(page)) return;
  const watch = { pending: new Map<Request, number>(), started: [] as [string, number][], failed: [] as string[], console: [] as string[] };
  pageWatch.set(page, watch);
  page.on('request', (r) => {
    watch.pending.set(r, Date.now());
    watch.started.push([`${r.method()} ${r.url()}`, Date.now()]);
    if (watch.started.length > 50) watch.started.shift();
  });
  page.on('requestfinished', (r) => watch.pending.delete(r));
  // Playwright reports "finished" only for answers it counts as loaded: an error
  // answer (500) never says so. It is an answer all the same.
  page.on('response', (r) => watch.pending.delete(r.request()));
  page.on('requestfailed', (r) => {
    watch.pending.delete(r);
    watch.failed.push(`${r.method()} ${r.url()}: ${r.failure()?.errorText ?? '?'}`);
  });
  page.on('console', (m) => watch.console.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => watch.console.push(`page error: ${e.message}`));
}

// Every page of the context has its fetches counted from its first document:
// the script is in place before the context has a page.
export async function watchContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(trackFetches);
  for (const page of context.pages()) followEvents(page);
  context.on('page', followEvents);
}

// For a page of a context that is not watched. Awaited before the page opens:
// a script added without waiting can miss the page's first document, which
// would then have nothing counting its fetches.
export async function watchPage(page: Page): Promise<void> {
  followEvents(page);
  await page.addInitScript(trackFetches);
}

// Waits in the page, on its own count. A document that opened without the
// count cannot be waited on: that is said at once, not after a timeout.
async function waitInPage(page: Page, what: string, quietFor: number): Promise<void> {
  const counted = await page.evaluate(() => (window as unknown as { __fetches?: unknown }).__fetches !== undefined);
  if (!counted) throw new Error(`${what}: nothing in the page counts its requests (watchContext or watchPage must come before it opens)\n${await stuckReport(page)}`);
  try {
    await page.waitForFunction(
      (ms) => {
        const f = (window as unknown as { __fetches: PageFetches }).__fetches;
        return f.count === 0 && performance.now() - f.changed >= ms;
      },
      quietFor,
      { timeout: 15_000, polling: 20 },
    );
  } catch (error) {
    throw new Error(`${what}: still waiting after 15000ms\n${await stuckReport(page)}`, { cause: error });
  }
}

// Waits until nothing the page's own code asked for is still on its way, and
// nothing has started or been answered for a moment. A page closed (or left)
// with a request on its way cancels it, and WebKit then loses the answer to the
// next request (see CLAUDE.md, found on Linux CI Oct 7, and on Windows CI Oct
// 8). Waiting for "network idle" is no use for this: it only waits the first
// time the page goes idle. After a change the screens ask for their numbers
// again, one request at a time (src/app/api.ts), the next as soon as the last
// is answered; this waits until nothing has happened for 200 ms.
export async function untilQuiet(page: Page): Promise<void> {
  await waitInPage(page, 'untilQuiet', 200);
}

// For a page that has just opened: waits until every fetch the page itself has
// started is answered. It returns at once when nothing is on its way.
export async function untilAnswered(page: Page): Promise<void> {
  await waitInPage(page, 'untilAnswered', 0);
}

// What a stuck page was doing: the page itself, what it was still waiting on
// (its own count, and Playwright's events), what failed, its console, and what
// the test server it talks to was asked and answered.
// opening: the address it was asked to open, for a page still on its first (blank) one.
export async function stuckReport(page: Page, opening?: string): Promise<string> {
  const now = Date.now();
  const watch = pageWatch.get(page);
  const state = page
    .evaluate(() => {
      const f = (window as unknown as { __fetches?: PageFetches }).__fetches;
      return {
        readyState: document.readyState,
        rendered: document.getElementById('root')?.childElementCount ?? -1,
        busy: document.querySelector('main')?.getAttribute('aria-busy') ?? 'no main',
        errorShown: document.querySelector('[data-testid$="-error"]')?.getAttribute('data-testid') ?? 'none',
        visibility: document.visibilityState,
        fetchesOnTheirWay: f === undefined ? 'not counted' : [...f.onTheirWay.values()],
        msSinceAFetchStartedOrWasAnswered: f === undefined ? null : Math.round(performance.now() - f.changed),
        msSincePageOpened: Math.round(performance.now()),
      };
    })
    .catch((error: unknown) => ({ evaluateFailed: String(error) }));
  // A page in the middle of opening an address may never answer: the report does not wait for it.
  const looked = await Promise.race([state, new Promise<{ readonly evaluateFailed: string }>((done) => setTimeout(() => done({ evaluateFailed: 'the page did not answer within 2 s' }), 2_000))]);
  let origin = '';
  for (const address of [page.url(), opening ?? '']) {
    try {
      const url = new URL(address);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        origin = url.origin;
        break;
      }
    } catch {
      // A page that never opened an address has no server.
    }
  }
  const server = (serverLogs.get(origin) ?? []).slice(-12).map((e) => `${e.method} ${e.url} from :${e.from ?? '?'} at -${now - e.at}ms: ${e.done === null ? 'NOT ANSWERED' : `${e.status} after ${e.done - e.at}ms`}`);
  const connections = [...(serverConnections.get(origin) ?? new Map<number | undefined, number>())].map(([from, at]) => `:${from ?? '?'} open for ${now - at}ms`);
  return [
    `page ${page.url()}: ${JSON.stringify(looked)}`,
    `Playwright's events say the browser still waits on: ${watch === undefined ? '(not followed)' : [...watch.pending].map(([r, at]) => `${r.method()} ${r.url()} for ${now - at}ms`).join('; ') || 'nothing'}`,
    `browser requests started, the last 15: ${watch?.started.slice(-15).map(([url, at]) => `${url} at -${now - at}ms`).join('; ') || 'none'}`,
    `browser requests that failed: ${watch?.failed.join('; ') || 'none'}`,
    `console: ${watch?.console.slice(-10).join(' | ') || 'nothing'}`,
    `server, last requests: ${server.join('; ') || 'none'}`,
    `server, connections open now: ${connections.join('; ') || 'none'}`,
    `machine, connections to or from its port: ${origin === '' ? 'no port' : loopbackConnections(Number(new URL(origin).port))}`,
    `machine, browsers and memory: ${machineState()}`,
  ].join('\n');
}

// On Linux, the browser processes alive by name (with those left as zombies),
// the shared memory in use, the load and the free memory: a new page whose
// first address never starts loading points at the browser's own processes.
function machineState(): string {
  if (process.platform !== 'linux') return 'only looked at on Linux';
  try {
    const processes = new Map<string, number>();
    let zombies = 0;
    for (const line of execFileSync('ps', ['-eo', 'stat=,comm='], { encoding: 'utf8' }).split('\n')) {
      const [stat, name] = line.trim().split(/\s+/);
      if (stat === undefined || name === undefined || !/web|browser|pw_|playwright|node/i.test(name)) continue;
      processes.set(name, (processes.get(name) ?? 0) + 1);
      if (stat.startsWith('Z')) zombies += 1;
    }
    const shm = execFileSync('df', ['-k', '/dev/shm'], { encoding: 'utf8' }).trim().split('\n').at(-1)?.split(/\s+/).slice(2, 5).join(' ') ?? '?';
    const load = execFileSync('cat', ['/proc/loadavg'], { encoding: 'utf8' }).trim();
    const free = /MemAvailable:\s+(\d+)/.exec(execFileSync('cat', ['/proc/meminfo'], { encoding: 'utf8' }))?.[1] ?? '?';
    return `${JSON.stringify(Object.fromEntries(processes))}, ${zombies} zombies; /dev/shm used, free, use%: ${shm}; load ${load}; memory available ${free} kB`;
  } catch (error) {
    return `could not tell (${String(error)})`;
  }
}

// Waits for something on the page; if it never comes, fails with what the
// browser and the server were doing, instead of a bare timeout.
export async function waitOrReport(page: Page, selector: string, timeout = 15_000): Promise<void> {
  try {
    await page.locator(selector).first().waitFor({ timeout });
  } catch (error) {
    throw new Error(`waited ${timeout}ms for ${selector}\n${await stuckReport(page)}`, { cause: error });
  }
}

export async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

// Every browser the tests launch, so that a failing test can say what each
// page still open was doing.
const launched = new Set<Browser>();

// Launches a browser whose every context counts its pages' fetches from their
// first document (watchContext), whoever opens the pages.
export async function launch(engine: BrowserType): Promise<Browser> {
  const browser = await engine.launch();
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options?: BrowserContextOptions): Promise<BrowserContext> => {
    const context = await newContext(options);
    await watchContext(context);
    leaveOnlyWhenQuiet(context);
    return context;
  };
  launched.add(browser);
  browser.on('disconnected', () => launched.delete(browser));
  return browser;
}

// Leaving a page (closing it or its context, going to another address,
// reloading, going back) cancels what it still has on its way, and the browsers
// as Playwright builds them then sometimes lose the next request: WebKit on
// Linux and Windows (CI, Oct 7 and Oct 8), and the next page stalled after a
// close on Linux CI (Oct 8, twice; Chromium). Tests used to guard against it one
// by one (untilQuiet before a close). Now no page of a launched browser is ever
// left while a request of its own is on its way.
//
// One look when it has none. (untilQuiet also waits for the screen to ask
// again after a tap; a test that taps and then leaves still calls it.)
async function settle(page: Page): Promise<void> {
  if (page.isClosed()) return;
  try {
    await page.waitForFunction(
      () => {
        const f = (window as unknown as { __fetches?: PageFetches }).__fetches;
        return f === undefined || f.count === 0;
      },
      undefined,
      { timeout: 15_000, polling: 20 },
    );
  } catch (error) {
    // Already gone, or on its way to another document (its requests then went with the old one).
    if (page.isClosed() || !(error instanceof Error) || error.name !== 'TimeoutError') return;
    throw new Error(`leaving the page: a request of its own still on its way after 15000ms (a test that holds one on purpose lets it go first)\n${await stuckReport(page)}`, { cause: error });
  }
}

// A page that could not open an address says what it and its server were
// doing, at once: the test closes it afterwards, and the report made when a
// test fails then finds no page open (CI, Oct 10, twice).
async function withReport(page: Page, error: unknown, opening: string): Promise<unknown> {
  if (!(error instanceof Error) || error.name !== 'TimeoutError' || page.isClosed()) return error;
  const report = await stuckReport(page, opening).catch((also: unknown) => `no report: ${String(also)}`);
  const stuck = new Error(`${error.message}
${report}`, { cause: error });
  stuck.name = error.name;
  return stuck;
}

function leaveOnlyWhenQuiet(context: BrowserContext): void {
  const closeContext = context.close.bind(context);
  context.close = async (options?: Parameters<BrowserContext['close']>[0]): Promise<void> => {
    await Promise.all(context.pages().map(settle));
    await closeContext(options);
  };
  context.on('page', (page) => {
    const close = page.close.bind(page);
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    const goBack = page.goBack.bind(page);
    page.close = async (options?: Parameters<Page['close']>[0]) => {
      await settle(page);
      await close(options);
    };
    page.goto = async (url: string, options?: Parameters<Page['goto']>[1]) => {
      await settle(page);
      try {
        return await goto(url, options);
      } catch (error) {
        throw await withReport(page, error, url);
      }
    };
    page.reload = async (options?: Parameters<Page['reload']>[0]) => {
      await settle(page);
      return reload(options);
    };
    page.goBack = async (options?: Parameters<Page['goBack']>[0]) => {
      await settle(page);
      return goBack(options);
    };
  });
}

// A browser test that fails reports every page still open: what it shows, what
// it is still waiting on, and what its server was asked; and the machine's
// connections on 127.0.0.1 by state. A timeout alone says nothing about why.
beforeEach(({ onTestFailed }) => {
  onTestFailed(async () => {
    const pages = [...launched].flatMap((b) => b.contexts().flatMap((c) => c.pages()));
    const reports = await Promise.all(pages.map((page) => stuckReport(page).catch((error: unknown) => `no report: ${String(error)}`)));
    console.error(reports.length === 0 ? 'No page was open when the test failed.' : `Pages open when the test failed:\n${reports.join('\n\n')}`);
    console.error(`Connections on 127.0.0.1 when the test failed: ${loopbackConnections()}`);
  });
});

// How many TCP connections on 127.0.0.1 are in each state. A machine that ran
// out of ports would show it here (CI, Oct 9: the most the tests ever had
// waiting to be freed was 1,165 on Windows, of about 16,000).
// With a port: only the connections to or from it (a test server's), each
// one, so a page that got stuck says whether the browser connected at all.
function loopbackConnections(port?: number): string {
  try {
    const windows = process.platform === 'win32';
    const out = windows ? execFileSync('netstat', ['-an', '-p', 'tcp'], { encoding: 'utf8', maxBuffer: 64 << 20 }) : execFileSync('ss', ['-tan'], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const counts = new Map<string, number>();
    const each: string[] = [];
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      const [local, peer, state] = windows ? [parts[1], parts[2], parts[3]] : [parts[3], parts[4], parts[0]];
      if (local?.startsWith('127.0.0.1') !== true || state === undefined) continue;
      if (port !== undefined && !local.endsWith(`:${port}`) && peer?.endsWith(`:${port}`) !== true) continue;
      counts.set(state, (counts.get(state) ?? 0) + 1);
      if (port !== undefined && state !== 'TIME-WAIT' && state !== 'TIME_WAIT') each.push(`${state} ${local} ${peer ?? '?'}`);
    }
    return JSON.stringify(Object.fromEntries(counts)) + (each.length === 0 ? '' : `; not waiting to close: ${each.slice(0, 40).join(', ')}`);
  } catch (error) {
    return `could not tell (${String(error)})`;
  }
}

// One browser of an engine and one demo server for a test file.
export function useEngine(engine: BrowserType): { browser: () => Browser; base: () => string } {
  let browser: Browser | undefined;
  let server: Server | undefined;
  let base = '';
  beforeAll(async () => {
    browser = await launch(engine);
    server = createDemoServer({ webRoot: WEB_ROOT });
    base = await listen(server);
  });
  afterAll(async () => {
    await browser?.close();
    if (server !== undefined) await close(server);
  });
  return {
    browser: () => {
      if (browser === undefined) throw new Error('no browser yet');
      return browser;
    },
    base: () => base,
  };
}

// What a phone() context sets for its pages that a page can set for itself:
// the colour scheme and reduced motion. A test that moves one page from screen
// to screen (showLive in live.ts says why) sets them before each move; the next
// address, loaded afresh, then shows as a new page with those options would
// (the screens read both from CSS only).
export async function emulatePhone(page: Page, options: Pick<PhoneOptions, 'colorScheme' | 'reducedMotion'> = {}): Promise<void> {
  await page.emulateMedia({ colorScheme: options.colorScheme ?? 'light', reducedMotion: options.reducedMotion ?? 'reduce' });
}

// Opens Home with one of the demo's made-up lives.
export async function openScenario(context: BrowserContext, base: string, scenario: string, path = '/home'): Promise<Page> {
  const page = await context.newPage();
  await watchPage(page);
  await showScenario(page, base, scenario, path);
  return page;
}

// The same in a page already open, moved there instead of a new page opened
// (showLive in live.ts says why): the life starts over, and the address is a
// whole new document, as in a new page.
export async function showScenario(page: Page, base: string, scenario: string, path = '/home'): Promise<void> {
  await page.goto(`${base}/demo/${scenario}`);
  if (path !== '/home') {
    // Home loads its numbers first. Leave only once they are in: WebKit on
    // Linux can fail the next page when one is left mid-request (Oct 7, CI).
    await waitOrReport(page, 'main[aria-busy="false"]');
    await untilAnswered(page);
    await page.goto(`${base}${path}`);
  }
  // Home, Buckets, and Review are ready once their numbers have loaded.
  await waitOrReport(page, 'main[aria-busy="false"], [data-testid="settings"]');
  // Home's numbers are asked for on every screen: the page is handed over only
  // once that is answered too, so a test that closes it cancels nothing.
  await untilAnswered(page);
}

// Reads an amount off the screen as cents, the way a person reads it.
export function readCents(text: string): Cents {
  return parseDollars(text.trim().replace(MINUS, '-'));
}

export async function centsAt(page: Page, testId: string): Promise<Cents> {
  return readCents(await page.getByTestId(testId).innerText());
}

// Squashes the screen's text to single spaces, to compare words.
export async function textAt(page: Page, testId: string): Promise<string> {
  return (await page.getByTestId(testId).innerText()).replace(/\s+/g, ' ').trim();
}

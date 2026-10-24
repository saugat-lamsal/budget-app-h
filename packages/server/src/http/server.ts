import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { Pot } from '@budget-app/money';
import { randomBytes } from 'node:crypto';
import { BACKUP_BEAT_PATH, BACKUP_HEALTH_PATH, fromThisMachine } from '../backup/backup-watch.js';
import { WEBHOOK_BODY_LIMIT, WEBHOOK_PATH } from './webhook-path.js';
import type { BankAnswer, BankConnectedRequest, BankConnectionView, BankLinkAnswer, BankLinkRequest, BankRolesRequest } from '../views/bank.js';
import { parseRequest } from '../choices.js';
import { POT_SLUGS, potOfSlug, type ActivityView } from '../views/activity.js';
import type { AlertsView } from '../views/alerts.js';
import type { StatusView } from '../views/status.js';
import { STATEMENT_CARDS, type StatementScreenView } from '../views/statement.js';
import type { TrendsView } from '../views/trends.js';
import type { BucketsView } from '../views/buckets.js';
import type { BankRuleRequest, BankRuleResponse } from '../views/bank-rules.js';
import type { ChoiceRequest, ChoiceResponse, MoveRequest, MoveResponse, RuleRequest, RuleResponse, SettingsRequest, SettingsResponse, SetupRequest, SetupResponse } from '../views/choice.js';
import type { HomeView } from '../views/home.js';
import type { PaydayView } from '../views/payday.js';
import type { PushAnswer, PushOnRequest } from '../views/push.js';
import type { ReviewView } from '../views/review.js';
import type { SettingsView } from '../views/settings.js';
import type { SetupView } from '../views/setup.js';

// The web server for the screens (Phase 4): the built app from packages/web,
// and its numbers as JSON. It changes the app's books only with his answers,
// never the bank. On the real server every screen and every /api address
// needs him logged in with a passkey (Step 2, the gate below); the demo has
// no login. Phase 6: hosted on Fly.io, behind its proxy, at one https
// address (the gate's origin); a health address for an outside monitor.

// The screens' own addresses, one per tab, so a refresh or a notification
// link opens the right one. Must match packages/web/src/app/routes.ts (a
// test checks).
export const APP_PATHS: readonly string[] = ['/', '/home', '/buckets', '/review', '/trends', '/settings'];

// The screens that are not tabs: the activity of each bucket, Payday, and the
// alerts sent (Phase 5). They get the app too. Must match
// packages/web/src/app/routes.ts (a test checks).
export const SCREEN_PATHS: readonly string[] = ['/payday', '/alerts', '/bank', '/status', ...Object.keys(POT_SLUGS).map((slug) => `/buckets/${slug}`)];

// Her rulebook, 52.4 (PR 7+8): each card's statement, opened from Home. Kept
// apart from upstream's screens. Must match packages/web/src/app/routes.ts
// HER_SCREEN_ROUTES (a test checks).
export const HER_SCREEN_PATHS: readonly string[] = STATEMENT_CARDS.map((card) => `/statement/${card}`);

// 1.1 to 1.3: the Bank connection screen, the one page Plaid Link opens on
// (its page rules let Plaid's login in: bankPageHeaders), and its numbers and
// what it sends. They change which bank the app reads, never money (0.4).
export const BANK_SCREEN_PATH = '/bank';
export const BANK_PATHS = { view: '/api/bank', link: '/api/bank/link', connected: '/api/bank/connected', roles: '/api/bank/roles', read: '/api/bank/read' } as const;

// Plaid Link's own script, which Plaid says must come straight from its address.
export const PLAID_LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

// The Setup day screens, one address per step (section 14). They get the app
// too. Must match packages/web/src/app/routes.ts (a test checks).
export const SETUP_PATHS: readonly string[] = ['bank', 'rules', 'transfers', 'paycheck', 'assign', 'check'].map((step) => `/setup/${step}`);

// The login page (Step 2): on the real server, the one screen shown without a login.
export const LOGIN_PATH = '/login';

// Phase 6: for an outside uptime monitor. No login, any host name, and it
// says only "ok" (or "not ok"): never a number, never anything of his.
export const HEALTH_PATH = '/health';

// Phase 6: https only, for two years, on the hosted address (fly.dev).
export const HSTS = 'max-age=63072000; includeSubDomains';

// Step 3: how often the real server syncs with the bank (section 2), changed on Settings.
export const SYNC_EVERY_PATH = '/api/sync/every';

// Phase 5, the phone: Settings' Notifications card. Turn them on for this
// device (its push subscription), off, and send it a test alert. They change
// which devices get the alerts, never money (0.4).
export const PUSH_PATHS = { on: '/api/push/on', off: '/api/push/off', test: '/api/push/test' } as const;

export interface Route {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  // On the real server: refused without a good login.
  readonly login: boolean;
}

// The login's own addresses (Step 2, auth/http.ts answers them). Open: the
// login page's own; the rest need him logged in.
export const AUTH_ROUTES: readonly Route[] = [
  { method: 'GET', path: '/api/auth', login: false },
  { method: 'POST', path: '/api/auth/login/options', login: false },
  { method: 'POST', path: '/api/auth/login', login: false },
  { method: 'POST', path: '/api/auth/code/options', login: false },
  { method: 'POST', path: '/api/auth/code', login: false },
  { method: 'POST', path: '/api/auth/passkey/options', login: true },
  { method: 'POST', path: '/api/auth/passkey', login: true },
  { method: 'POST', path: '/api/auth/logout', login: true },
  { method: 'POST', path: '/api/auth/stay', login: true },
];

// Every address the real server answers with anything of his: every screen,
// every screen's numbers, his answers, and the login's own (a test checks
// each one against a login: login-guard.test.ts). The app's own files
// (scripts, styles, icons) are open: the login page needs them, and they hold
// nothing of his.
export const ROUTES: readonly Route[] = [
  ...[...APP_PATHS, ...SCREEN_PATHS, ...SETUP_PATHS, ...HER_SCREEN_PATHS].map((path): Route => ({ method: 'GET', path, login: true })),
  { method: 'GET', path: LOGIN_PATH, login: false },
  { method: 'GET', path: HEALTH_PATH, login: false },
  // A43: the backups' health, for a second monitor, and Litestream's beat (from this machine only).
  { method: 'GET', path: BACKUP_HEALTH_PATH, login: false },
  { method: 'GET', path: BACKUP_BEAT_PATH, login: false },
  // Section 2 (A47): Plaid's webhooks. Plaid has no login: each call is checked by Plaid's own signature instead.
  { method: 'POST', path: WEBHOOK_PATH, login: false },
  ...['home', 'buckets', 'review', 'trends', 'settings', 'setup', 'payday', 'alerts', 'status', ...Object.keys(POT_SLUGS).map((slug) => `activity/${slug}`), ...STATEMENT_CARDS.map((card) => `statement/${card}`)].map((name): Route => ({ method: 'GET', path: `/api/${name}`, login: true })),
  { method: 'POST', path: '/api/choice', login: true },
  { method: 'POST', path: '/api/seen', login: true },
  { method: 'POST', path: SYNC_EVERY_PATH, login: true },
  ...Object.values(PUSH_PATHS).map((path): Route => ({ method: 'POST', path, login: true })),
  { method: 'GET', path: BANK_PATHS.view, login: true },
  ...[BANK_PATHS.link, BANK_PATHS.connected, BANK_PATHS.roles, BANK_PATHS.read].map((path): Route => ({ method: 'POST', path, login: true })),
  ...AUTH_ROUTES,
];

// The real server's gate (Step 2): who is logged in, and the login's own
// addresses. Without it (the demo) there is no login.
export interface Gate {
  // The app's own address, as the browser shows it (http://localhost:5190, or
  // hosted https://budget-app-x7q2.fly.dev): every POST must come from it, and
  // every request be addressed to it. Hosted (https), every request must also
  // have reached the proxy over https.
  readonly origin: () => string;
  readonly loggedIn: (request: IncomingMessage) => boolean;
  // Answers one of AUTH_ROUTES: a status, a JSON body, and maybe a cookie.
  readonly auth: (path: string, request: IncomingMessage, body: unknown) => Promise<{ readonly status: number; readonly body: unknown; readonly setCookie?: string }>;
}

export interface AppServerOptions {
  // The built screens (packages/web/dist).
  readonly webRoot: string;
  // Home's numbers for this request.
  readonly home: (request: IncomingMessage) => HomeView | Promise<HomeView>;
  // Extra addresses, for the demo only. Returns true when it answered.
  readonly extra?: (request: IncomingMessage, response: ServerResponse, path: string) => boolean | Promise<boolean>;
  // Told about anything that went wrong while answering, without the details
  // reaching the phone.
  readonly onError?: (error: unknown) => void;
  // 10.6: he has seen a take-back (QUESTIONS.md B84). Returns false when
  // there is no such take-back. Without it, nothing can be marked seen.
  readonly seen?: SeenHandler;
  // The Buckets and Review screens' numbers for this request.
  readonly buckets?: (request: IncomingMessage) => BucketsView | Promise<BucketsView>;
  // Section 40: the Trends tab's numbers. It only reads.
  readonly trends?: (request: IncomingMessage) => TrendsView | Promise<TrendsView>;
  readonly review?: (request: IncomingMessage) => ReviewView | Promise<ReviewView>;
  // His choice for an item waiting in review. The money math decides; a
  // refusal comes back as an answer, with why. Without it, nothing can be sent.
  readonly choice?: ChoiceHandler;
  // His hand move between buckets (13.3). The money math decides, and says
  // when it needs his yes first (13.4). Without it, no move can be sent.
  readonly move?: MoveHandler;
  // What went in and out of one bucket (QUESTIONS.md B97), and the Payday screen's numbers.
  readonly activity?: (request: IncomingMessage, pot: Pot) => ActivityView | Promise<ActivityView>;
  readonly payday?: (request: IncomingMessage) => PaydayView | Promise<PaydayView>;
  // The Settings screen's numbers (section 2, 13.1, 13.5).
  readonly settings?: (request: IncomingMessage) => SettingsView | Promise<SettingsView>;
  // His change to the settings, or to a sorting rule. The money math decides,
  // and says when it needs his yes first. Without them, none can be sent.
  readonly settingsChange?: SettingsHandler;
  readonly ruleChange?: RuleHandler;
  // Setup day (section 14): the screens' numbers, and his answers. The money
  // math decides; starting to track asks first. Without them, none can be sent.
  readonly setupView?: (request: IncomingMessage) => SetupView | Promise<SetupView>;
  readonly setup?: SetupHandler;
  // His change to the bank rules (section 2, 24c), on Setup day or Settings.
  // It asks first, with what the rule would match. Without it, none can be sent.
  readonly bankRule?: BankRuleHandler;
  // The real server's login (Step 2). Without it, no login: the demo.
  readonly gate?: Gate;
  // Step 3: how often the real server syncs with the bank, in minutes (section
  // 2). The books check it. Without it (the demo, which has no bank), none can be sent.
  readonly syncEvery?: (request: IncomingMessage, minutes: unknown) => { readonly ok: true } | { readonly ok: false; readonly why: string };
  // Phase 5: the alerts the real server worked out and sent. Without it (the
  // demo, which sends none), /api/alerts is not there.
  readonly alerts?: (request: IncomingMessage) => AlertsView | Promise<AlertsView>;
  // 0.7 (A57): the status page, the real server only. Without it (the demo),
  // /api/status is not there.
  readonly status?: (request: IncomingMessage) => StatusView | Promise<StatusView>;
  // Her rulebook, 52.4: one card's statement, /api/statement/everyday-card. It only reads.
  readonly statement?: (request: IncomingMessage, card: (typeof STATEMENT_CARDS)[number]) => StatementScreenView | Promise<StatementScreenView>;
  // Phase 5, the phone: the Notifications card, for the device asking. Without
  // it (the demo, which sends no alerts), the addresses are not there.
  readonly push?: PushHandlers;
  // Phase 6: whether the server can read its books now, for /health. Without
  // it (the demo), the address is not there.
  readonly health?: () => boolean;
  // A43: whether Litestream's heartbeat still comes, for /health/backups, and
  // its beat. Only the hosted server has it: on a computer there is no backup.
  readonly backups?: { readonly beat: () => void; readonly healthy: () => boolean };
  // 1.1 to 1.3: the Bank connection screen. Without it (the demo, which has no
  // bank), its addresses are not there.
  readonly bank?: BankHandlers;
  // Section 2 (A47): Plaid's webhooks, with the exact bytes of each body.
  // Without it (the demo), the address is not there.
  readonly webhook?: WebhookHandler;
}

export interface WebhookHandler {
  readonly receive: (request: { readonly headers: IncomingMessage['headers']; readonly body: Buffer }) => Promise<{ readonly status: number; readonly text: string }>;
}

export interface BankHandlers {
  // The address of the Plaid bank in use (the test bank or the real one, from
  // the lock): the Bank page lets the page talk to that one only.
  readonly bankAddress: string;
  readonly view: (request: IncomingMessage) => BankConnectionView;
  readonly link: (request: IncomingMessage, link: BankLinkRequest) => Promise<BankLinkAnswer>;
  readonly connected: (request: IncomingMessage, connected: BankConnectedRequest) => Promise<BankAnswer>;
  readonly roles: (request: IncomingMessage, roles: BankRolesRequest) => BankAnswer;
  readonly read: (request: IncomingMessage, read: { readonly loggedInAgain?: true; readonly bank?: 1 | 2 }) => Promise<BankAnswer>;
}

export interface PushHandlers {
  readonly on: (request: IncomingMessage, subscription: PushOnRequest) => PushAnswer;
  readonly off: (request: IncomingMessage) => PushAnswer;
  readonly test: (request: IncomingMessage) => Promise<PushAnswer>;
}

export type Seen = { readonly kind: 'bank-took-back'; readonly id: string };
export type SeenHandler = (request: IncomingMessage, what: Seen) => boolean | Promise<boolean>;
export type ChoiceHandler = (request: IncomingMessage, choice: ChoiceRequest) => ChoiceResponse | Promise<ChoiceResponse>;
export type MoveHandler = (request: IncomingMessage, move: MoveRequest) => MoveResponse | Promise<MoveResponse>;
export type SettingsHandler = (request: IncomingMessage, change: SettingsRequest) => SettingsResponse | Promise<SettingsResponse>;
export type RuleHandler = (request: IncomingMessage, change: RuleRequest) => RuleResponse | Promise<RuleResponse>;
export type SetupHandler = (request: IncomingMessage, answer: SetupRequest) => SetupResponse | Promise<SetupResponse>;
export type BankRuleHandler = (request: IncomingMessage, change: BankRuleRequest) => BankRuleResponse | Promise<BankRuleResponse>;

// What handles each kind of request sent to /api/choice.
interface ChoiceHandlers {
  readonly choice: ChoiceHandler | undefined;
  readonly move: MoveHandler | undefined;
  readonly settingsChange: SettingsHandler | undefined;
  readonly ruleChange: RuleHandler | undefined;
  readonly setup: SetupHandler | undefined;
  readonly bankRule: BankRuleHandler | undefined;
}

// The most a "seen" request may carry; the real one is under 100 bytes.
const SEEN_LIMIT = 1024;
// A passkey's answer is a few kilobytes at most.
const AUTH_LIMIT = 16_384;
// A choice is small too: even a three-way split is under 400 bytes, and a
// change to every setting at once under 1,000.
const CHOICE_LIMIT = 4096;
// A push subscription: an address of a few hundred characters and two keys.
const PUSH_LIMIT = 4096;

// Reads what the app's own page sent: JSON (which another site cannot send
// without the browser asking first), from this origin, and small. Answers
// the request itself and returns undefined when it is not that.
async function readOwnJson(request: IncomingMessage, response: ServerResponse, limit: number): Promise<unknown> {
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    send(response, 415, 'text/plain; charset=utf-8', 'JSON only.', 'no-store');
    return undefined;
  }
  const site = request.headers['sec-fetch-site'];
  const origin = request.headers.origin;
  const host = request.headers.host ?? '';
  if ((site !== undefined && site !== 'same-origin') || (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`)) {
    send(response, 403, 'text/plain; charset=utf-8', 'Only from the app itself.', 'no-store');
    return undefined;
  }
  let body = '';
  let tooBig = false;
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > limit) {
      tooBig = true;
      break;
    }
  }
  if (tooBig) {
    response.setHeader('Connection', 'close');
    send(response, 413, 'text/plain; charset=utf-8', 'Too big.', 'no-store');
    return undefined;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    send(response, 400, 'text/plain; charset=utf-8', 'Not JSON.', 'no-store');
    return undefined;
  }
}

// A webhook: POST, JSON, at most WEBHOOK_BODY_LIMIT bytes, kept byte for
// byte (its signature is over the exact body), then answered as the desk says.
async function takeWebhook(request: IncomingMessage, response: ServerResponse, webhook: WebhookHandler): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
    return;
  }
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    send(response, 415, 'text/plain; charset=utf-8', 'JSON only.', 'no-store');
    return;
  }
  const tooBig = (): void => {
    response.setHeader('Connection', 'close');
    send(response, 413, 'text/plain; charset=utf-8', 'Too big.', 'no-store');
  };
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > WEBHOOK_BODY_LIMIT) {
      tooBig();
      return;
    }
    chunks.push(bytes);
  }
  const answer = await webhook.receive({ headers: request.headers, body: Buffer.concat(chunks) });
  send(response, answer.status, 'text/plain; charset=utf-8', answer.text, 'no-store');
}

async function markSeen(request: IncomingMessage, response: ServerResponse, seen: SeenHandler): Promise<void> {
  const what = await readOwnJson(request, response, SEEN_LIMIT);
  if (response.writableEnded || response.headersSent) return;
  if (!isSeen(what)) {
    send(response, 400, 'text/plain; charset=utf-8', 'Not something that can be seen.', 'no-store');
    return;
  }
  if (!(await seen(request, what))) {
    send(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not-found' }), 'no-store');
    return;
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  response.setHeader('Cache-Control', 'no-store');
  response.statusCode = 204;
  response.end();
}

// His choice for an item in review. A malformed request is a bad request;
// anything well formed gets an answer: done, or refused with why (nothing
// changed). A repeat of the same decision gets the first answer again.
async function takeChoice(request: IncomingMessage, response: ServerResponse, handlers: ChoiceHandlers): Promise<void> {
  const sent = await readOwnJson(request, response, CHOICE_LIMIT);
  if (response.writableEnded || response.headersSent) return;
  const parsed = parseRequest(sent);
  if (parsed === null) {
    send(response, 400, 'text/plain; charset=utf-8', 'Not a choice that can be made.', 'no-store');
    return;
  }
  // A hand move, a settings change, a rule change, a setup day answer, or a
  // choice for an item:
  // each goes to what handles it, and when nothing does, it is as if the
  // address were not there.
  const answer =
    'move' in parsed
      ? await handlers.move?.(request, parsed)
      : 'settings' in parsed
        ? await handlers.settingsChange?.(request, parsed)
        : 'rule' in parsed
          ? await handlers.ruleChange?.(request, parsed)
          : 'setup' in parsed
            ? await handlers.setup?.(request, parsed)
            : 'bankRule' in parsed
              ? await handlers.bankRule?.(request, parsed)
              : await handlers.choice?.(request, parsed);
  if (answer === undefined) {
    send(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not-found' }), 'no-store');
    return;
  }
  send(response, answer.ok ? 200 : 422, 'application/json; charset=utf-8', JSON.stringify(answer), 'no-store');
}

// What a browser's PushSubscription.toJSON() gives, and nothing else: the
// address, and the device's public key and secret (base64url).
function pushOnOf(value: unknown): PushOnRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).sort().join() !== 'endpoint,keys') return null;
  const { endpoint, keys } = value as Record<string, unknown>;
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) return null;
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys) || Object.keys(keys).sort().join() !== 'auth,p256dh') return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  const key = (v: unknown, most: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= most && /^[A-Za-z0-9_-]+=*$/.test(v);
  if (!key(p256dh, 128) || !key(auth, 64)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function isSeen(value: unknown): value is Seen {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const { kind, id } = value as Record<string, unknown>;
  return keys.join() === 'id,kind' && kind === 'bank-took-back' && typeof id === 'string' && id.length > 0 && id.length <= 200;
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Every answer: only this server's own scripts and styles run, the page
// cannot be framed, and no address is passed on to other sites.
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function createAppServer(options: AppServerOptions): Server {
  const webRoot = resolve(options.webRoot);
  return createServer((request, response) => {
    answer(request, response).catch((error: unknown) => {
      options.onError?.(error);
      if (!response.headersSent) send(response, 500, 'text/plain; charset=utf-8', 'Something went wrong.', 'no-store');
      else response.destroy();
    });
  });

  async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      send(response, 400, 'text/plain; charset=utf-8', 'Bad address.', 'no-store');
      return;
    }
    // Hosted, every answer tells the browser: this address over https only.
    if (options.gate !== undefined && options.gate.origin().startsWith('https:')) response.setHeader('Strict-Transport-Security', HSTS);
    // Before the gate: the monitor needs no login, and Fly's own check comes
    // from inside, under the machine's own address.
    if (path === HEALTH_PATH && options.health !== undefined) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        send(response, 405, 'text/plain; charset=utf-8', 'Only GET and HEAD.', 'no-store');
        return;
      }
      const ok = options.health();
      send(response, ok ? 200 : 503, 'text/plain; charset=utf-8', ok ? 'ok\n' : 'not ok\n', 'no-store');
      return;
    }
    // A43, the same way: the backups, for the second monitor. /health stays
    // the server's alone (Fly uses it: "not ok" there would take the app away).
    if (path === BACKUP_HEALTH_PATH && options.backups !== undefined) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        send(response, 405, 'text/plain; charset=utf-8', 'Only GET and HEAD.', 'no-store');
        return;
      }
      const ok = options.backups.healthy();
      send(response, ok ? 200 : 503, 'text/plain; charset=utf-8', ok ? 'ok\n' : 'not ok\n', 'no-store');
      return;
    }
    // Litestream's beat: from this machine only, never through Fly's proxy.
    if (path === BACKUP_BEAT_PATH && options.backups !== undefined) {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        send(response, 405, 'text/plain; charset=utf-8', 'Only GET.', 'no-store');
        return;
      }
      if (!fromThisMachine(request.socket.remoteAddress, request.headers)) {
        send(response, 403, 'text/plain; charset=utf-8', 'Only from this machine.', 'no-store');
        return;
      }
      options.backups.beat();
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
      response.setHeader('Cache-Control', 'no-store');
      response.statusCode = 204;
      response.end();
      return;
    }
    // Section 2 (A47): Plaid's webhooks, before the gate (Plaid has no login):
    // each is checked by Plaid's signature over the exact bytes of its body.
    if (path === WEBHOOK_PATH && options.webhook !== undefined) {
      await takeWebhook(request, response, options.webhook);
      return;
    }
    if (options.gate !== undefined && (await atTheGate(options.gate, request, response, path))) return;
    // The one thing the screens can send: that he has seen a notice. It
    // changes no money (0.4).
    if (path === '/api/seen' && options.seen !== undefined) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      await markSeen(request, response, options.seen);
      return;
    }
    // How often the real server syncs with the bank: a setting, never the bank (0.4).
    if (path === SYNC_EVERY_PATH && options.syncEvery !== undefined) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      const sent = await readOwnJson(request, response, SEEN_LIMIT);
      if (response.writableEnded || response.headersSent) return;
      if (typeof sent !== 'object' || sent === null || Array.isArray(sent) || Object.keys(sent).join() !== 'minutes') {
        send(response, 400, 'text/plain; charset=utf-8', 'Not a setting that can be changed.', 'no-store');
        return;
      }
      const said = options.syncEvery(request, (sent as { minutes: unknown }).minutes);
      send(response, said.ok ? 200 : 422, 'application/json; charset=utf-8', JSON.stringify(said), 'no-store');
      return;
    }
    // The Notifications card: which devices get the alerts, never money (0.4).
    const pushAction = (Object.entries(PUSH_PATHS) as [keyof typeof PUSH_PATHS, string][]).find(([, p]) => p === path)?.[0];
    if (pushAction !== undefined && options.push !== undefined) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      const sent = await readOwnJson(request, response, PUSH_LIMIT);
      if (response.writableEnded || response.headersSent) return;
      const subscription = pushAction === 'on' ? pushOnOf(sent) : null;
      if (pushAction === 'on' ? subscription === null : !isEmptyObject(sent)) {
        send(response, 400, 'text/plain; charset=utf-8', 'Not something the Notifications card sends.', 'no-store');
        return;
      }
      const said = subscription !== null ? options.push.on(request, subscription) : pushAction === 'off' ? options.push.off(request) : await options.push.test(request);
      send(response, said.ok ? 200 : 422, 'application/json; charset=utf-8', JSON.stringify(said), 'no-store');
      return;
    }
    // 1.1 to 1.3: the Bank connection screen's answers. They change which bank
    // the app reads, never money (0.4).
    const bankAction = (Object.entries(BANK_PATHS) as [keyof typeof BANK_PATHS, string][]).find(([, p]) => p === path)?.[0];
    if (bankAction !== undefined && bankAction !== 'view' && options.bank !== undefined) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      const sent = await readOwnJson(request, response, BANK_LIMIT);
      if (response.writableEnded || response.headersSent) return;
      const said = await bankAnswer(options.bank, bankAction, request, sent);
      if (said === null) {
        send(response, 400, 'text/plain; charset=utf-8', 'Not something the Bank screen sends.', 'no-store');
        return;
      }
      send(response, said.ok ? 200 : 422, 'application/json; charset=utf-8', JSON.stringify(said), 'no-store');
      return;
    }
    // His choices, moves, and changes to the settings: they change the app's
    // books, never the bank (0.4).
    const handlers: ChoiceHandlers = { choice: options.choice, move: options.move, settingsChange: options.settingsChange, ruleChange: options.ruleChange, setup: options.setup, bankRule: options.bankRule };
    if (path === '/api/choice' && Object.values(handlers).some((handler) => handler !== undefined)) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      await takeChoice(request, response, handlers);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(response, 405, 'text/plain; charset=utf-8', 'Only GET and HEAD.', 'no-store');
      return;
    }

    if (path === '/api/home') {
      let view: HomeView;
      try {
        view = await options.home(request);
      } catch (error) {
        options.onError?.(error);
        send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'home-unavailable' }), 'no-store');
        return;
      }
      send(response, 200, 'application/json; charset=utf-8', JSON.stringify(view), 'no-store');
      return;
    }
    for (const [name, make] of [
      ['buckets', options.buckets],
      ['trends', options.trends],
      ['review', options.review],
      ['settings', options.settings],
      ['setup', options.setupView],
      ['alerts', options.alerts],
      ['status', options.status],
    ] as const) {
      if (path !== `/api/${name}` || make === undefined) continue;
      let view: BucketsView | TrendsView | ReviewView | SettingsView | SetupView | AlertsView | StatusView;
      try {
        view = await make(request);
      } catch (error) {
        options.onError?.(error);
        send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: `${name}-unavailable` }), 'no-store');
        return;
      }
      send(response, 200, 'application/json; charset=utf-8', JSON.stringify(view), 'no-store');
      return;
    }
    // What went in and out of one bucket: /api/activity/needs.
    const activityPot = /^\/api\/activity\/([^/]+)$/.exec(path)?.[1];
    if (activityPot !== undefined && options.activity !== undefined) {
      const pot = potOfSlug(activityPot);
      if (pot !== null) {
        let view: ActivityView;
        try {
          view = await options.activity(request, pot);
        } catch (error) {
          options.onError?.(error);
          send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'activity-unavailable' }), 'no-store');
          return;
        }
        send(response, 200, 'application/json; charset=utf-8', JSON.stringify(view), 'no-store');
        return;
      }
    }
    // Her rulebook, 52.4: one card's statement: /api/statement/second-card.
    const statementCard = STATEMENT_CARDS.find((card) => path === `/api/statement/${card}`);
    if (statementCard !== undefined && options.statement !== undefined) {
      let view: StatementScreenView;
      try {
        view = await options.statement(request, statementCard);
      } catch (error) {
        options.onError?.(error);
        send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'statement-unavailable' }), 'no-store');
        return;
      }
      send(response, 200, 'application/json; charset=utf-8', JSON.stringify(view), 'no-store');
      return;
    }
    if (path === '/api/payday' && options.payday !== undefined) {
      let view: PaydayView;
      try {
        view = await options.payday(request);
      } catch (error) {
        options.onError?.(error);
        send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'payday-unavailable' }), 'no-store');
        return;
      }
      send(response, 200, 'application/json; charset=utf-8', JSON.stringify(view), 'no-store');
      return;
    }
    if (path === BANK_PATHS.view && options.bank !== undefined) {
      let view: BankConnectionView;
      try {
        view = options.bank.view(request);
      } catch (error) {
        options.onError?.(error);
        send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'bank-unavailable' }), 'no-store');
        return;
      }
      send(response, 200, 'application/json; charset=utf-8', JSON.stringify(view), 'no-store');
      return;
    }
    if (path.startsWith('/api/')) {
      send(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not-found' }), 'no-store');
      return;
    }
    if (options.extra !== undefined && (await options.extra(request, response, path))) return;
    if (path === BANK_SCREEN_PATH && options.bank !== undefined) {
      await sendBankPage(response, join(webRoot, 'index.html'), options.bank.bankAddress);
      return;
    }

    if (APP_PATHS.includes(path) || SCREEN_PATHS.includes(path) || SETUP_PATHS.includes(path) || HER_SCREEN_PATHS.includes(path) || (options.gate !== undefined && path === LOGIN_PATH)) {
      await sendFile(response, join(webRoot, 'index.html'), 'no-cache');
      return;
    }
    // A file of the built app, never anything outside it.
    const file = resolve(webRoot, `.${path}`);
    if (!file.startsWith(webRoot + sep) || path.includes('\0')) {
      send(response, 404, 'text/plain; charset=utf-8', 'Not found.', 'no-store');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (info === null || !info.isFile()) {
      send(response, 404, 'text/plain; charset=utf-8', 'Not found.', 'no-store');
      return;
    }
    // Built files under /assets/ have their content in their name, so they
    // never change; everything else is checked again each time.
    await sendFile(response, file, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  }
}

// The real server's gate (Step 2). Answers the request itself, and returns
// true, when it is not for the app's own address, a POST did not come from
// the app's own page, it is one of the login's own addresses, or it needs a
// login it does not have. Otherwise lets it through.
async function atTheGate(gate: Gate, request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
  const own = new URL(gate.origin());
  const host = request.headers.host ?? '';
  // Hosted: Fly's proxy takes the request over https and says so. Anything
  // that did not come that way is sent to the https address, or refused.
  if (own.protocol === 'https:' && request.headers['x-forwarded-proto'] !== 'https') {
    if (request.method === 'GET' || request.method === 'HEAD') {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
      response.setHeader('Location', `${own.origin}${request.url ?? '/'}`);
      response.setHeader('Cache-Control', 'no-store');
      response.statusCode = 308;
      response.end();
      return true;
    }
    send(response, 403, 'text/plain; charset=utf-8', 'Only over https.', 'no-store');
    return true;
  }
  if (host !== own.host) {
    // On this computer, the same server under its other loopback name: sent to
    // the app's own address, where the login and the passkeys are. Anything
    // else is not for us (hosted, only the one address is).
    const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/.exec(host);
    const ownIsLoopback = own.hostname === 'localhost' || own.hostname === '127.0.0.1';
    if (ownIsLoopback && loopback !== null && (loopback[2] ?? '') === (own.port === '' ? '' : `:${own.port}`) && (request.method === 'GET' || request.method === 'HEAD')) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
      response.setHeader('Location', `${own.origin}${request.url ?? '/'}`);
      response.setHeader('Cache-Control', 'no-store');
      response.statusCode = 307;
      response.end();
      return true;
    }
    send(response, 421, 'text/plain; charset=utf-8', 'Not this address.', 'no-store');
    return true;
  }
  // Every POST from the app's own page, and only from it.
  if (request.method === 'POST') {
    const site = request.headers['sec-fetch-site'];
    if (request.headers.origin !== own.origin || (site !== undefined && site !== 'same-origin')) {
      send(response, 403, 'text/plain; charset=utf-8', 'Only from the app itself.', 'no-store');
      return true;
    }
  }
  const loggedIn = gate.loggedIn(request);
  const route = AUTH_ROUTES.find((r) => r.path === path);
  if (route !== undefined) {
    if (request.method !== route.method) {
      response.setHeader('Allow', route.method);
      send(response, 405, 'text/plain; charset=utf-8', `Only ${route.method}.`, 'no-store');
      return true;
    }
    if (route.login && !loggedIn) {
      send(response, 401, 'application/json; charset=utf-8', JSON.stringify({ error: 'login-needed' }), 'no-store');
      return true;
    }
    const body = route.method === 'POST' ? await readOwnJson(request, response, AUTH_LIMIT) : undefined;
    if (response.writableEnded || response.headersSent) return true;
    const answer = await gate.auth(path, request, body);
    if (answer.setCookie !== undefined) response.setHeader('Set-Cookie', answer.setCookie);
    send(response, answer.status, 'application/json; charset=utf-8', JSON.stringify(answer.body), 'no-store');
    return true;
  }
  if (loggedIn || path === LOGIN_PATH) return false;
  if (path.startsWith('/api/')) {
    send(response, 401, 'application/json; charset=utf-8', JSON.stringify({ error: 'login-needed' }), 'no-store');
    return true;
  }
  if (path === '/' || APP_PATHS.includes(path) || SCREEN_PATHS.includes(path) || SETUP_PATHS.includes(path) || HER_SCREEN_PATHS.includes(path)) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    response.setHeader('Location', LOGIN_PATH);
    response.setHeader('Cache-Control', 'no-store');
    response.statusCode = 303;
    response.end();
    return true;
  }
  // The app's own files: the login page needs them.
  return false;
}

// 1.1: the Bank page, the one page whose rules let Plaid Link in, as Plaid
// asks: its script straight from its own address, its login in a frame of its
// own, its styles, and the page talking to the bank in use (the test bank or
// the real one), with a fresh nonce each time the page is loaded (Plaid's way
// without 'unsafe-inline'). The bank's own login may open in a window of its
// own (OAuth), so this page lets its windows keep in touch with it. Every
// other page keeps the strict rules.
export function bankPageHeaders(nonce: string, bankAddress: string): Record<string, string> {
  return {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' ${PLAID_LINK_SCRIPT}`,
      `style-src 'self' 'nonce-${nonce}'`,
      `style-src-elem 'self' 'nonce-${nonce}'`,
      "style-src-attr 'unsafe-inline'",
      "img-src 'self' data:",
      `connect-src 'self' ${bankAddress}`,
      'frame-src https://cdn.plaid.com/',
      "manifest-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  };
}

// The page is given the nonce and Link's address here, so the phone's own
// code never names Plaid (test/build-has-no-secrets.test.ts).
async function sendBankPage(response: ServerResponse, file: string, bankAddress: string): Promise<void> {
  const nonce = randomBytes(16).toString('base64');
  const html = (await readFile(file, 'utf8')).replace(/<head(\s[^>]*)?>/i, (head) => `${head}<meta name="plaid-nonce" content="${nonce}"><meta name="plaid-link" content="${PLAID_LINK_SCRIPT}">`);
  for (const [name, value] of Object.entries(bankPageHeaders(nonce, bankAddress))) response.setHeader(name, value);
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(html));
  response.statusCode = 200;
  response.end(response.req.method === 'HEAD' ? undefined : html);
}

// The most the Bank screen sends: an account id for each of the four.
const BANK_LIMIT = 2048;

function exactly(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
}

// Her rulebook, 1.3 (PR 6): which of her banks.
const isBank = (value: unknown): value is 1 | 2 => value === 1 || value === 2;

// Her rulebook, 1.1 (HB8): the bank Link says she logged in to, as Link hands it on.
function institutionOf(value: unknown): { readonly id: string; readonly name: string } | null {
  if (!exactly(value, ['id', 'name'])) return null;
  const { id, name } = value;
  return typeof id === 'string' && /^ins_[0-9]{1,12}$/.test(id) && typeof name === 'string' && name.trim().length > 0 && name.length <= 100 ? { id, name: name.trim() } : null;
}

// What the Bank screen sends, parsed strictly; null when it is not that.
async function bankAnswer(bank: BankHandlers, action: Exclude<keyof typeof BANK_PATHS, 'view'>, request: IncomingMessage, sent: unknown): Promise<BankLinkAnswer | BankAnswer | null> {
  switch (action) {
    case 'link':
      if (exactly(sent, ['mode', 'yes']) && sent['mode'] === 'connect' && typeof sent['yes'] === 'boolean') return bank.link(request, { mode: 'connect', yes: sent['yes'] });
      if (exactly(sent, ['mode']) && sent['mode'] === 'login-again') return bank.link(request, { mode: 'login-again' });
      if (exactly(sent, ['mode', 'bank']) && sent['mode'] === 'login-again' && isBank(sent['bank'])) return bank.link(request, { mode: 'login-again', bank: sent['bank'] });
      return null;
    case 'connected': {
      const named = exactly(sent, ['publicToken', 'institution']);
      const token = named || exactly(sent, ['publicToken']) ? (sent as Record<string, unknown>)['publicToken'] : null;
      if (typeof token !== 'string' || !/^public-[a-z]+-[A-Za-z0-9-]{1,200}$/.test(token)) return null;
      if (!named) return bank.connected(request, { publicToken: token });
      const institution = institutionOf((sent as Record<string, unknown>)['institution']);
      return institution === null ? null : bank.connected(request, { publicToken: token, institution });
    }
    case 'roles': {
      if (!exactly(sent, ['roles', 'yes']) || typeof sent['yes'] !== 'boolean') return null;
      const roles = sent['roles'];
      if (typeof roles !== 'object' || roles === null || Array.isArray(roles) || Object.keys(roles).length > 8) return null;
      if (!Object.values(roles).every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)) return null;
      return bank.roles(request, { roles: roles as BankRolesRequest['roles'], yes: sent['yes'] });
    }
    case 'read':
      if (isEmptyObject(sent)) return bank.read(request, {});
      if (exactly(sent, ['loggedInAgain']) && sent['loggedInAgain'] === true) return bank.read(request, { loggedInAgain: true });
      if (exactly(sent, ['loggedInAgain', 'bank']) && sent['loggedInAgain'] === true && isBank(sent['bank'])) return bank.read(request, { loggedInAgain: true, bank: sent['bank'] });
      return null;
  }
}

async function sendFile(response: ServerResponse, file: string, cache: string): Promise<void> {
  const body = await readFile(file);
  send(response, 200, TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', body, cache);
}

export function send(response: ServerResponse, status: number, type: string, body: string | Buffer, cache: string): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  response.setHeader('Content-Type', type);
  response.setHeader('Cache-Control', cache);
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.statusCode = status;
  response.end(response.req.method === 'HEAD' ? undefined : body);
}

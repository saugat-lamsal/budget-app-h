import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBankRules } from '../../../../server/src/bank/reading.js';
import { Keeper } from '../../../../server/src/history/keeper.js';
import { memoryLog, type LogLine } from '../../../../server/src/log.js';
import { serveBooks } from '../../../../server/src/serve/serving.js';
import type { SyncTimer } from '../../../../server/src/serve/sync-timer.js';
import { HER_START } from '../../../../server/src/setup-start.js';
import { FakeClock } from '../../../../server/test/fake-clock.js';
import { FakePhone } from '../../../../server/test/fake-phone.js';
import type { FakePlaid } from '../../../../server/test/fake-plaid.js';
import { bothBanks, connected } from '../../../../server/test/harness.js';
import { HER_BANK_RULES } from '../../../../server/test/her-harness.js';
import { loginForTests } from '../../../../server/test/login-for-tests.js';
import { atNewYork } from '../pay-period/real-server.js';
import { DAYS, SETUP_DAY, history, postedBeforeHistory } from './days-her.js';

// npm run pay-period-agent-her (scripts/pay-period-agent-her.mjs): PR 12's
// end check, the agent through a full pay period on her screens
// (agent-pay-period-h/). Upstream's agent server (pay-period/agent-server.ts)
// on her setup: the real server as npm run serve runs it with
// BUDGET_SETUP=her (serveBooks, HER_START), her two made-up banks, each its
// own connection (her rulebook, 1.1), her four accounts picked (1.2), and her
// pay period (days-her.ts) reaching the books only by the server's own sync
// timer, on a clock that moves only when a day is brought in. No real bank and
// no real money: Plaid is never called, and the books are in a database file
// of their own, removed when it stops.
//
// Beside it, on its own port, the same control page as upstream's: "Log this
// browser in" and "Bring in the next day". With AGENT_BOOKS_LOG set, what the
// screens' views said at the end of each day is added to that file, for
// checking the agent's report afterward; the agent is not told of it.

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  const value = i < 0 ? fallback : Number(process.argv[i + 1]);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`${name} needs a port number`);
  return value;
};
const APP_PORT = arg('--port', 5390);
const CONTROL_PORT = arg('--control', 5391);
const webRoot = process.env['WEB_ROOT'] ?? fileURLToPath(new URL('../../../web/dist/', import.meta.url));
if (!existsSync(`${webRoot}index.html`)) throw new Error(`the screens are not built at ${webRoot}`);
const booksLog = process.env['AGENT_BOOKS_LOG'];

const listenOn = (server: Server, port: number): Promise<string> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}`));
  });
const closeServer = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

// Her bank rules: the made-up banks' (her-harness.ts), and her Amex card's payments.
const RULES = checkBankRules([
  ...HER_BANK_RULES,
  { id: 'chk-pays-second', account: 'checking', contains: 'payment to CRD 5555', means: 'transfer', other: 'second-card' },
  { id: 'second-paid', account: 'second-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);

const dir = mkdtempSync(join(tmpdir(), 'budget-pay-period-her-'));
const path = join(dir, 'books.sqlite');
const start = postedBeforeHistory();
const h = await connected({
  posted: { checking: start.checking, savings: start.savings, everyday: start.capitalOne, old: 0 },
  secondCard: start.amex,
  history,
  rules: RULES,
  today: SETUP_DAY,
  path,
  herSetup: true,
  twoBanks: true,
});
const maybeSecond = h.second;
if (maybeSecond === undefined) throw new Error('her second bank is not connected');
const second: FakePlaid = maybeSecond;
const banks = bothBanks(h.fake, second);

const clock = { now: atNewYork(SETUP_DAY, 9) };
const fakeClock = new FakeClock(clock);
const lines: LogLine[] = [];
let base = '';
const keeper = Keeper.open({ db: h.db, now: () => clock.now, log: memoryLog(lines), origin: () => base, start: HER_START });
const { server, timer }: { server: Server; timer: SyncTimer } = serveBooks({
  keeper,
  bank: { plaid: h.plaid, box: h.box, log: memoryLog(lines), pageSize: 3 },
  clock: fakeClock,
  webRoot,
  origin: () => base,
  // The alerts are not looked at in the pay period, as upstream's.
  sender: new FakePhone(() => clock.now),
});
// Passkeys are made for the app's host name: localhost.
base = (await listenOn(server, APP_PORT)).replace('127.0.0.1', 'localhost');
timer.start();
await timer.idle();

let day = -1;
const brought: string[] = [];
const dates = [SETUP_DAY, ...DAYS.map((d) => d.date)];
const dayName = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// What the screens' own views say now, for checking the agent's report.
function record(label: string): void {
  if (booksLog === undefined) return;
  const view = (read: () => unknown): unknown => {
    try {
      return read();
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  const entry = {
    label,
    at: clock.now.toISOString(),
    pots: keeper.book()?.pots() ?? null,
    home: view(() => keeper.home()),
    buckets: view(() => keeper.buckets()),
    payday: view(() => keeper.payday()),
    review: view(() => keeper.review()),
  };
  appendFileSync(booksLog, `${JSON.stringify(entry)}\n`);
}

async function nextDay(): Promise<string> {
  const next = DAYS[day + 1];
  if (next === undefined) return 'That was the last day of the pay period. Nothing more comes in.';
  record(`end of ${dates[day + 1]}`);
  day += 1;
  // The clock moves on through the night, the timer syncing on the way.
  await fakeClock.advance(atNewYork(next.date, 7).getTime() - clock.now.getTime(), () => timer.idle());
  second.needsLogin = next.amexWantsLogin === true;
  next.bank(banks);
  const due = keeper.syncDueIn();
  if (due === null) throw new Error('nothing to sync with');
  await fakeClock.advance(Math.max(0, due) + 1, () => timer.idle());
  const line = `${dayName(next.date)}, 7:00 AM: the bank activity for the day has come in.`;
  brought.push(line);
  return line;
}

function page(message: string): string {
  const today = dates[day + 1] ?? '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pay period control</title>
<style>body{font:16px system-ui,sans-serif;margin:24px;max-width:640px}button{font:inherit;padding:10px 16px;margin:6px 0}li{margin:4px 0}</style></head><body>
<h1>Pay period control</h1>
<p>The app: <a href="${base}/home">${base}/home</a></p>
<p>Today in the app: <strong>${dayName(today)}</strong>${day === -1 ? ' (setup day)' : ''}.</p>
${message === '' ? '' : `<p role="status"><strong>${message}</strong></p>`}
<form method="post" action="/login"><button>Log this browser in</button></form>
<form method="post" action="/next-day"><button>Bring in the next day</button></form>
<h2>Days brought in</h2><ol>${brought.map((b) => `<li>${b}</li>`).join('')}</ol>
</body></html>`;
}

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(''));
    return;
  }
  if (request.method === 'GET' && url === '/status') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ app: base, today: dates[day + 1], lastDay: dates.at(-1), brought }));
    return;
  }
  if (request.method === 'POST' && url === '/login') {
    // Cookies are by host name, not port: this one reaches the app too.
    const cookie = loginForTests(h.db, clock.now, 'The agent\'s browser');
    response.writeHead(303, { 'Set-Cookie': `${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`, Location: `${base}/home` }).end();
    return;
  }
  if (request.method === 'POST' && url === '/next-day') {
    const message = await nextDay();
    if ((request.headers.accept ?? '').includes('text/html')) response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(message));
    else response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`${message}\n`);
    return;
  }
  if (request.method === 'POST' && url === '/record') {
    // For checking afterward: what the views say right now (not for the agent).
    record(`asked at ${dates[day + 1]}`);
    response.writeHead(204).end();
    return;
  }
  response.writeHead(404).end();
}

const control = createServer((request, response) => {
  answer(request, response).catch((error: unknown) => {
    response.writeHead(500, { 'Content-Type': 'text/plain' }).end(error instanceof Error ? error.message : String(error));
  });
});
await listenOn(control, CONTROL_PORT);
console.log('Her pay period, on the real server with her two made-up banks (no real bank, no real money).');
console.log(`  The app:     ${base}/home`);
console.log(`  The control: http://localhost:${CONTROL_PORT}/`);
console.log('  The books:   a database file of their own, removed when this stops.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void closeServer(control)
      .then(() => timer.stop())
      .then(() => closeServer(server))
      .then(() => {
        h.db.close();
        rmSync(dir, { recursive: true, force: true });
      })
      .finally(() => process.exit(0));
  });
}

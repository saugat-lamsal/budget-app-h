import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolesFor } from '@budget-app/money';
import { BackupWatch } from '../backup/backup-watch.js';
import { tokenBoxFromEnv, type TokenBox } from '../crypto/token-box.js';
import { openDatabase } from '../db/database.js';
import { migrateHer } from '../db/her-steps.js';
import { readConnection } from '../db/store.js';
import { HistoryDoesNotReplay } from '../history/history-db.js';
import { Keeper } from '../history/keeper.js';
import { consoleLog } from '../log.js';
import { PlaidClient } from '../plaid/client.js';
import { plaidKeysFromEnv, type PlaidKeys } from '../plaid/sandbox-lock.js';
import { pushKeysFromEnv, type PushKeys } from '../push/push-keys.js';
import { setupStartOf, type SetupStart } from '../setup-start.js';
import { serveOptions, testBankOnStart, type ServeOptions } from './options.js';
import { logSender, type AlertSender } from './alert-timer.js';
import { EXIT } from './exit-codes.js';
import { serveBooks } from './serving.js';
import { connectLikeHis } from './test-bank.js';

// npm run serve [-- --connect] [-- --sync] [-- --port N] [-- --db <file>]
// The real server: the screens from the database, through the same desks as
// the demo. Plaid's test bank only (the sandbox lock), this computer only.
// Every screen needs a passkey login (Step 2); with no passkey yet, it prints
// a one-time code here, in its own window, to make the first one. It syncs
// with the test bank by itself every 60 minutes (a setting, section 2), and at
// once when it starts if one is due (Step 3). Every answer of his is kept in
// the database. Before it starts, it replays the
// whole history and checks it against the totals saved with each event; if
// they differ, it does not start, and says at which event (0.6, A28).
// Phase 5: with push keys in .env (VAPID_*; npm run push-keys makes a pair),
// each alert goes to the phones that turned notifications on, through web
// push; without them, it is written in this window.
// Phase 6, hosted on Fly.io (APP_ORIGIN set, in fly.toml): it answers only to
// that https address, behind Fly's proxy; the keys come from Fly secrets; it
// never writes a one-time code in its log (fly ssh console makes one); and
// with --connect-once, its first start connects the test bank. The image runs
// it under start.ts, which keeps Litestream copying the books to R2.

// The repository's root, from packages/server/src/serve or packages/server/dist/serve.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const envFile = `${root}.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

let started: { options: ServeOptions; keys: PlaidKeys; box: TokenBox; push: PushKeys | null; start: SetupStart };
try {
  // The lock: Plaid's test bank, or (Phase 7, hosted, PLAID_ENV production)
  // the real one; anything else stops it here.
  started = { options: serveOptions(process.argv.slice(2), process.env, root), keys: plaidKeysFromEnv(process.env), box: tokenBoxFromEnv(process.env), push: pushKeysFromEnv(process.env), start: setupStartOf(process.env['BUDGET_SETUP']) };
} catch (error) {
  console.error(`The server did not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT.didNotStart);
}
// BUDGET_SETUP=her (her fly.toml): her setup day, with no mom reserve and no
// old card ("Off in this setup"). Unset, upstream's.
const { options, keys, box, push, start } = started;
// The app's own address: passkeys are made for its host name, localhost on
// this computer, or (hosted) its fly.dev name.
let origin = options.hosted ?? `http://localhost:${options.port}`;
const log = consoleLog([keys.clientId, keys.secret, process.env['BANK_TOKEN_KEY'] ?? '', ...(push === null ? [] : [push.privateKey])]);

mkdirSync(dirname(options.db), { recursive: true });
const db = openDatabase(options.db);
// Her setup: her own database steps too, once upstream's have run (db/her-steps.ts).
if (start.switches.secondCard === 'on') migrateHer(db);
let keeper: Keeper;
try {
  keeper = Keeper.open({ db, now: () => new Date(), log, origin: () => origin, push: { keys: push }, start });
} catch (error) {
  db.close();
  if (error instanceof HistoryDoesNotReplay) {
    console.error(error.message);
    console.error('The server did not start, and nothing was changed.');
    console.error(
      options.hosted === null
        ? 'To see each event whose totals would change, and decide (QUESTIONS.md A28): npm run replay-check'
        : 'To see each event whose totals would change, and decide (QUESTIONS.md A28): fly ssh console, then node /app/serve/replay-check.mjs',
    );
    process.exit(EXIT.historyDoesNotReplay);
  }
  throw error;
}

const plaid = new PlaidClient(keys, { log });
// Phase 7: on the real bank the test bank is never connected (1.1).
let testBank: ReturnType<typeof testBankOnStart>;
try {
  testBank = testBankOnStart(options, keys.environment);
} catch (error) {
  console.error(`The server did not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT.didNotStart);
}
const bankName = keys.environment === 'production' ? 'the bank' : 'the test bank';
if (testBank === 'connect') {
  console.log("Connecting Plaid's test bank, with made-up accounts like yours. This takes a minute.");
  await connectLikeHis({ db, plaid, box, log, today: keeper.today(), roles: rolesFor(start.switches) });
  keeper.reload();
}
if (options.sync) {
  const result = await keeper.sync({ plaid, box, log });
  console.log(`Synced with ${bankName}: ${result.added} new, ${result.modified} changed, ${result.removed} removed.`);
}
// The screens, and (Step 3) the timer that syncs by itself, every interval
// (section 2), and at once if one is due.
const webRoot = process.env['WEB_ROOT'] ?? fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const { server, timer, alerts } = serveBooks({
  keeper,
  bank: { plaid, box, log },
  clock: { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  webRoot,
  origin: () => origin,
  onError: (error) => log.error('a request failed', { error: error instanceof Error ? error.message : String(error) }),
  // Phase 5: to the phones, through web push; without push keys, written here, in this window.
  sender: phoneSender(keeper, log),
  // A43: hosted, Litestream runs beside it (start.ts) and its heartbeat comes here.
  ...(options.hosted === null ? {} : { backups: new BackupWatch(Date.now) }),
});
server.listen(options.port, options.host, () => {
  const address = server.address();
  const at = typeof address === 'object' && address !== null ? address.port : options.port;
  if (options.hosted === null) origin = `http://localhost:${at}`;
  if (keys.environment === 'production') console.log("Budget app: the real bank, through Plaid, hosted.");
  else console.log(options.hosted === null ? "Budget app: Plaid's test bank only, this computer only." : "Budget app: Plaid's test bank only, hosted.");
  console.log(`  The books: ${options.db}`);
  console.log(`  Open: ${origin}/home`);
  if (!keeper.hasPasskeys()) {
    console.log('');
    if (options.hosted === null) {
      console.log('  No passkey yet. To make your first one, open the address above and type this one-time code:');
      console.log(`    ${keeper.loginCode()}`);
      console.log('  Good once, for 15 minutes. npm run login-code prints a new one.');
    } else {
      // Never in the log: Fly keeps it. It is shown only to whoever asks for it on the machine.
      console.log('  No passkey yet. For a one-time code to make your first one: fly ssh console -C "node /app/serve/login-code.mjs"');
    }
  }
  console.log(`  It syncs with ${bankName} by itself every ${keeper.syncEveryMinutes()} minutes (a setting).`);
  if (readConnection(db) === null && testBank === 'never') console.log('  No bank is connected yet: connect it from Setup day (1.1).');
  console.log(push === null ? '  Alerts are worked out and written here, in this window (no push keys: npm run push-keys).' : '  Alerts go to each phone that turned notifications on (Settings, Notifications).');
  if (options.hosted === null) console.log('Stop it with Ctrl+C.');
  alerts.start();
  // Phase 6: the first start connects the test bank, after it listens (so
  // Fly sees it up), before the timer's first sync.
  void connectIfNone().finally(() => timer.start());
});

async function connectIfNone(): Promise<void> {
  if (testBank !== 'connect-once' || readConnection(db) !== null) return;
  log.info('connecting the test bank, with made-up accounts like his (first start)');
  try {
    await connectLikeHis({ db, plaid, box, log, today: keeper.today(), roles: rolesFor(start.switches) });
    keeper.reload();
    log.info('the test bank is connected');
  } catch (error) {
    log.error('the test bank could not be connected; the next start tries again if nothing was connected, and the sync timer goes on from where it got to if it was', { error: error instanceof Error ? error.message : String(error) });
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    // A sync on its way saves all or nothing; it is let finish first.
    void Promise.all([timer.stop(), alerts.stop()]).finally(() => {
      db.close();
      process.exit(0);
    });
  });
}

// The real sender, each alert also noted in this window once it went; or,
// without push keys, the window only.
function phoneSender(books: Keeper, out: typeof log): AlertSender {
  const real = books.pushSender();
  if (real === null) return logSender(out, options.hosted === null ? 'all' : 'title only');
  return {
    send: async (alert) => {
      await real.send(alert);
      out.info('alert sent', { title: alert.title, ...(alert.due === null ? {} : { late: alert.due }), due: alert.dueAt });
    },
  };
}

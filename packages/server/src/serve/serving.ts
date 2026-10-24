import type { Server } from 'node:http';
import type { BackupWatch } from '../backup/backup-watch.js';
import type { Keeper, SyncBank } from '../history/keeper.js';
import { WebhookKeys, plaidKeySource } from '../plaid/webhook.js';
import { WebhookDesk } from '../sync/webhook-desk.js';
import { AlertTimer, type AlertSender } from './alert-timer.js';
import { SyncTimer, type TimerClock } from './sync-timer.js';

// What npm run serve runs once the books are open (main.ts): the web server
// for the screens, with every screen behind the login, the timer that syncs
// with the bank by itself (Step 3), Plaid's webhooks, which sync as soon as
// Plaid has something new (section 2, A47), and the timer that works out the
// alerts and sends them (Phase 5), looking after every sync and answer too.
// The full pay period through the screens (packages/web,
// test/browser/pay-period) runs exactly this, with a made-up bank and a clock
// the test moves.

export interface ServeInput {
  readonly keeper: Keeper;
  // The bank to sync with.
  readonly bank: SyncBank;
  // Real time for npm run serve; a test's clock for the tests.
  readonly clock: TimerClock;
  readonly webRoot: string;
  // The app's own address, as the browser shows it, once it listens.
  readonly origin: () => string;
  readonly onError?: (error: unknown) => void;
  // Phase 5: the plug that sends the alerts.
  readonly sender: AlertSender;
  // A43: hosted, the watch on Litestream's heartbeat (/health/backups).
  readonly backups?: BackupWatch;
  // Real time for npm run serve (the default); a test's clock for the tests.
  readonly now?: () => Date;
}

export interface Serving {
  readonly server: Server;
  // Not started: start them once the server listens, the alerts first, so
  // what came due while the server was down is worked out from the books as
  // they were.
  readonly timer: SyncTimer;
  readonly alerts: AlertTimer;
  // Section 2 (A47): Plaid's webhooks. Stop it with the server.
  readonly webhooks: WebhookDesk;
}

export function serveBooks(input: ServeInput): Serving {
  const { keeper, bank } = input;
  const timer = new SyncTimer({
    syncer: { syncDueIn: () => keeper.syncDueIn(), sync: () => keeper.sync(bank) },
    clock: input.clock,
    log: bank.log,
  });
  const alerts = new AlertTimer({ alerter: keeper, sender: input.sender, clock: input.clock, log: bank.log });
  keeper.whenChanged(() => alerts.poke());
  const now = input.now ?? (() => new Date());
  const webhooks = new WebhookDesk({
    keys: new WebhookKeys({ source: plaidKeySource(bank.plaid), now, log: bank.log }),
    itemId: () => keeper.itemId(),
    sync: () => keeper.sync(bank),
    // Her setup (section 2, HB11): either connection's webhooks, each syncing its bank.
    ...(keeper.twoBanks() ? { itemIds: () => keeper.itemIds(), syncItems: (items: readonly string[]) => keeper.syncItems(bank, items) } : {}),
    onItsWay: () => keeper.syncOnItsWay(),
    clock: input.clock,
    now,
    log: bank.log,
  });
  const server = keeper.server(input.webRoot, input.origin, input.onError, { ...(input.backups === undefined ? {} : { backups: input.backups }), bank, webhook: webhooks });
  return { server, timer, alerts, webhooks };
}

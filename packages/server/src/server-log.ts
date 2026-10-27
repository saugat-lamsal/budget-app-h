import { bankRuleLogIn } from './bank-rules-db.js';
import type { Db } from './db/database.js';
import { logChange } from './db/store.js';
import type { ServerLogLine } from './views/server-log.js';

// Lines of the change log (13.5) that the server keeps, not the book: the
// history taking new totals (QUESTIONS.md A28), logins, new passkeys, log
// outs and the login setting, how often it syncs with the bank (Step 3), and
// notifications on a device (Phase 5). Kept in the change_log table like the bank
// rules' lines, and shown on Settings among the book's lines, in the order
// things happened.

export type { ServerLogLine };

// Her setup's setup day line is read elsewhere (setup-day-log.ts).
type ServerAction = Exclude<ServerLogLine['action'], 'setup-day'>;

export const WHAT: Readonly<Record<ServerAction, string>> = {
  'history-retotaled': 'history took new totals',
  'logged-in': 'logged in',
  'logged-out': 'logged out',
  'passkey-added': 'passkey added',
  'stay-logged-in-changed': 'stay logged in changed',
  'sync-every-changed': 'sync with the bank changed',
  'notifications-on': 'notifications on',
  'notifications-off': 'notifications off',
  'notifications-stopped': 'notifications stopped',
  'bank-connected': 'bank connected',
  'bank-accounts': 'bank accounts picked',
  'bank-logged-in-again': 'logged in to the bank again',
};

type WithoutBankLines<T> = T extends unknown ? Omit<T, 'afterBankLines'> : never;

// Keeps a line, noting how many bank rule lines came before it.
export function saveServerLine(db: Db, line: WithoutBankLines<Extract<ServerLogLine, { action: ServerAction }>>): void {
  const { date, action, ...detail } = line;
  logChange(db, date, WHAT[action], { ...detail, afterBankLines: bankRuleLogIn(db).length });
}

// Every such line, in the order they were written.
export function serverLinesIn(db: Db): ServerLogLine[] {
  const actions = Object.keys(WHAT) as ServerAction[];
  const rows = db.prepare(`SELECT date, what, detail FROM change_log WHERE what IN (${actions.map(() => '?').join(', ')}) ORDER BY id`).all(...actions.map((a) => WHAT[a])) as { date: string; what: string; detail: string }[];
  return rows.map((row) => {
    const action = actions.find((a) => WHAT[a] === row.what);
    if (action === undefined) throw new Error(`not a server line: ${row.what}`);
    return { date: row.date, action, ...(JSON.parse(row.detail) as object) } as ServerLogLine;
  });
}

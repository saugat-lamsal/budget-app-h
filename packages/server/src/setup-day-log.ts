import type { IsoDate, SortingRule, TextRule } from '@budget-app/money';
import { WHAT as BANK_RULE_WHAT } from './bank-rules-db.js';
import type { Db } from './db/database.js';
import { WHAT as SERVER_WHAT, serverLinesIn } from './server-log.js';
import type { ServerLogLine } from './views/server-log.js';

// Her rulebook, 53.1 and 13.5 (HA10, his answer of Oct 27, 2026): in her
// setup, Settings' change log shows setup day's line, with the rules she
// kept from the rule finder. Setup day logs them (keeper.ts, HB37); this
// reads that line back and puts it among the server's own lines where it was
// written, so the change log reads in the order things happened. Upstream's
// setup does not show it. It only reads.

const inList = (whats: readonly string[]): string => whats.map(() => '?').join(', ');

// The server's lines, with setup day's among them; as they were without it
// before tracking starts.
export function serverLinesWithSetupDay(db: Db): ServerLogLine[] {
  const lines = serverLinesIn(db);
  const row = db.prepare("SELECT id, date, detail FROM change_log WHERE what = 'setup day' ORDER BY id DESC LIMIT 1").get() as { id: number; date: IsoDate; detail: string } | undefined;
  if (row === undefined) return lines;
  const before = (whats: readonly string[]): number => (db.prepare(`SELECT COUNT(*) AS n FROM change_log WHERE id < ? AND what IN (${inList(whats)})`).get(row.id, ...whats) as { n: number }).n;
  const found = (JSON.parse(row.detail) as { found?: { readonly rules: readonly SortingRule[]; readonly paycheckRule: TextRule | null } }).found;
  const serverBefore = before(Object.values(SERVER_WHAT));
  // Setup day starts the book: no line of the book's comes before it.
  const line: ServerLogLine = { date: row.date, action: 'setup-day', rules: found?.rules ?? [], paycheckRule: found?.paycheckRule ?? null, afterBookLines: 0, afterBankLines: before(Object.values(BANK_RULE_WHAT)) };
  return [...lines.slice(0, serverBefore), line, ...lines.slice(serverBefore)];
}

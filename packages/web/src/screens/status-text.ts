import type { StatusView } from '@budget-app/server/views';
import { checkedAtText } from '../ui/dates.js';

// Rule 0.7 (QUESTIONS.md A57): the status page in words. Each line says
// whether it needs a look, so the screen marks it with an icon as well as the
// words, never colour alone. No amounts: the server sends none.

export interface StatusLine {
  readonly id: 'last-read' | 'last-sync' | `last-read-${1 | 2}` | `last-sync-${1 | 2}` | 'backups' | 'started' | 'history' | 'difference' | 'alerts';
  readonly title: string;
  readonly detail: string;
  // True when something is not as it should be.
  readonly look: boolean;
}

const SYNC_WORDS = {
  new: { words: 'new activity', look: false },
  'nothing-new': { words: 'nothing new', look: false },
  'needs-login': { words: 'the bank wants you to log in again.', look: true },
  failed: { words: 'it failed, so nothing changed. It is tried again at the next time.', look: true },
} as const;

export function statusLines(view: StatusView): StatusLine[] {
  const when = (at: string): string => checkedAtText(at, view.today, view.timeZone);
  const sync = view.lastSync;
  // Her setup (her rulebook, 0.7, PR 6): each bank's own, by name.
  const banks: StatusLine[] =
    view.banks === undefined
      ? [
          { id: 'last-read', title: 'Bank last read', detail: view.lastRead === null ? 'Not read yet.' : when(view.lastRead), look: false },
          {
            id: 'last-sync',
            title: 'Last sync',
            detail: sync === null ? 'None since the server started.' : `${when(sync.at)}: ${SYNC_WORDS[sync.result].words}`,
            look: sync !== null && SYNC_WORDS[sync.result].look,
          },
        ]
      : view.banks.flatMap((b): StatusLine[] => [
          { id: `last-read-${b.bank}`, title: `${b.name} last read`, detail: b.lastRead === null ? 'Not read yet.' : when(b.lastRead), look: false },
          {
            id: `last-sync-${b.bank}`,
            title: `${b.name}: last sync`,
            detail: b.lastSync === null ? 'None since the server started.' : `${when(b.lastSync.at)}: ${SYNC_WORDS[b.lastSync.result].words}`,
            look: b.lastSync !== null && SYNC_WORDS[b.lastSync.result].look,
          },
        ]);
  // Her setup (12.3, HB9, HB32): while a bank's last sync failed, the check
  // waits for it; its own line above already needs a look.
  const waitingFor = view.banks?.find((b) => b.lastSync !== null && (b.lastSync.result === 'failed' || b.lastSync.result === 'needs-login'));
  return [
    ...banks,
    backupsLine(view, when),
    { id: 'started', title: 'Server started', detail: when(view.started), look: false },
    { id: 'history', title: 'History', detail: historyText(view.history), look: false },
    {
      id: 'difference',
      title: 'Daily check',
      detail: view.mismatchSince !== null ? `The totals have not matched the bank since ${when(view.mismatchSince)}.` : waitingFor === undefined ? 'The totals match the bank.' : `Waiting until ${waitingFor.name} can be read.`,
      look: view.mismatchSince !== null,
    },
    { id: 'alerts', title: 'Alerts', detail: view.alertsWaiting === 0 ? 'None waiting to be sent.' : `${view.alertsWaiting} waiting to be sent.`, look: view.alertsWaiting > 0 },
  ];
}

// A43: copying while Litestream's heartbeat comes; none on this computer.
function backupsLine(view: StatusView, when: (at: string) => string): StatusLine {
  const b = view.backups;
  if (b === null) return { id: 'backups', title: 'Backups', detail: 'None on this computer.', look: false };
  if (b.copying) return { id: 'backups', title: 'Backups', detail: b.lastBeat === null ? 'Starting. Not confirmed yet.' : `Copying. Last confirmed ${when(b.lastBeat)}.`, look: false };
  return { id: 'backups', title: 'Backups', detail: `Not copying: none confirmed since ${b.lastBeat === null ? 'the server started' : when(b.lastBeat)}.`, look: true };
}

// 0.6: the books open only when every event replays to its totals.
function historyText({ whenOpened, now }: StatusView['history']): string {
  if (now === 0) return 'No events yet.';
  const kept = `${now} ${now === 1 ? 'event' : 'events'} kept`;
  if (whenOpened === 0) return `${kept}, all since the books opened.`;
  const since = now - whenOpened;
  if (whenOpened === 1 && since === 0) return `${kept}. It replayed to its totals when the books opened.`;
  if (since === 0) return `${kept}. All ${whenOpened} replayed to their totals when the books opened.`;
  return `${kept}. All ${whenOpened} there when the books opened replayed to their totals; ${since} since.`;
}

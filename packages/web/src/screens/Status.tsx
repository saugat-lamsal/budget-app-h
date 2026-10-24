import type { StatusView } from '@budget-app/server/views';
import type { Load, Reload } from '../app/api.js';
import type { IconName } from '../ui/Icon.js';
import { BackLink, Button, Card, ListRow, Skeleton, StateMessage } from '../ui/blocks.js';
import { longDate } from '../ui/dates.js';
import type { Back } from './Activity.js';
import { statusLines, type StatusLine } from './status-text.js';

// Rule 0.7 (QUESTIONS.md A57): the status page, opened from Settings, on the
// real server only. It shows how the bank, the backups, the server and its
// history are doing, and has no amounts. It only reads and never sends
// anything. What needs a look says so in words, with a warning icon.

const ICONS: Readonly<Record<StatusLine['id'], IconName>> = {
  'last-read': 'bank',
  'last-sync': 'clock',
  // Her setup (0.7, PR 6): each bank's own.
  'last-read-1': 'bank',
  'last-sync-1': 'clock',
  'last-read-2': 'bank',
  'last-sync-2': 'clock',
  backups: 'tray',
  started: 'info',
  history: 'check',
  difference: 'check',
  alerts: 'bell',
};

export function StatusScreen({ load, onRetry, back }: { readonly load: Load<StatusView>; readonly onRetry: Reload; readonly back: Back }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="status">
      <h1 className="sr-only">Status</h1>
      <BackLink href={back.href} label={back.label} onBack={back.onBack} testId="back" />
      {load.status === 'loading' && <StatusLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load the status" detail="Check your connection, then try again." testId="status-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && <StatusReady view={load.value} />}
    </main>
  );
}

function StatusLoading() {
  return (
    <div data-testid="status-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading the status</span>
      <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
        <Skeleton width="60%" height="1rem" />
        <Skeleton width="80%" height="1rem" />
        <Skeleton width="50%" height="1rem" />
      </div>
    </div>
  );
}

const GROUPS: readonly { readonly title: string; readonly ids: readonly StatusLine['id'][]; readonly testId: string }[] = [
  { title: 'The bank', ids: ['last-read', 'last-sync'], testId: 'status-card-bank' },
  { title: 'Backups', ids: ['backups'], testId: 'status-card-backups' },
  { title: 'The server', ids: ['started', 'history'], testId: 'status-card-server' },
  { title: 'Checks', ids: ['difference', 'alerts'], testId: 'status-card-checks' },
];

function StatusReady({ view }: { readonly view: StatusView }) {
  const lines = statusLines(view);
  const looks = lines.filter((l) => l.look).length;
  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
      </div>
      <section className="hero" aria-labelledby="status-label">
        <h2 id="status-label" className="hero__label">
          Status
        </h2>
        <p className="hero__sub" data-testid="status-summary">
          {looks === 0 ? 'All working' : looks === 1 ? '1 thing needs a look' : `${looks} things need a look`}
        </p>
      </section>
      {GROUPS.map((group) => (
        <Card key={group.testId} title={group.title} testId={group.testId}>
          {lines
            .filter((l) => group.ids.includes(l.id))
            .map((l) => (
              <ListRow key={l.id} icon={l.look ? 'alert' : ICONS[l.id]} tone={l.look ? 'warning' : 'info'} title={l.title} detail={l.detail} testId={`status-${l.id}`} />
            ))}
        </Card>
      ))}
      <p className="sheet__note">This page only reads. It shows no amounts.</p>
    </>
  );
}

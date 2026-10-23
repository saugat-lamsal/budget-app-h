import type { AlertLine, AlertsView } from '@budget-app/server/views';
import type { Load, Reload } from '../app/api.js';
import type { IconName } from '../ui/Icon.js';
import { BackLink, Button, Card, ListRow, Skeleton, StateMessage } from '../ui/blocks.js';
import { longDate } from '../ui/dates.js';
import type { Back } from './Activity.js';
import { alertCountText, alertWhenText } from './alerts-text.js';

// The alerts the app worked out and sent (Phase 5, rulebook sections 9 and
// 10), newest first, each with when it came due and when it went out, or why
// it has not gone out yet. Opened from Settings, on the real server only (the
// demo sends none). The screen only shows what the server kept; it reads and
// never sends anything.

const ICONS: Readonly<Record<AlertLine['kind'], IconName>> = {
  'low-bucket': 'low',
  'empty-bucket': 'empty',
  'daily-review': 'review',
  'card-reminder': 'card',
  'card-overdue': 'alert',
  'totals-mismatch': 'alert',
  'bank-login': 'bank',
  'bank-took-back': 'undo',
  'bank-not-read': 'clock',
  'bank-permission': 'bank',
  payday: 'move',
  'paycheck-waiting': 'review',
};

export function AlertsScreen({ load, onRetry, back }: { readonly load: Load<AlertsView>; readonly onRetry: Reload; readonly back: Back }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="alerts">
      <h1 className="sr-only">Alerts</h1>
      <BackLink href={back.href} label={back.label} onBack={back.onBack} testId="back" />
      {load.status === 'loading' && <AlertsLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load the alerts" detail="Check your connection, then try again." testId="alerts-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <StateMessage icon="bank" title="No alerts yet" detail="Alerts start once setup day is done. Each one the app sends is listed here, with when it was sent." testId="alerts-not-set-up" />
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <AlertsReady view={load.value} />}
    </main>
  );
}

function AlertsLoading() {
  return (
    <div data-testid="alerts-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading the alerts</span>
      <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
        <Skeleton width="60%" height="1rem" />
        <Skeleton width="80%" height="1rem" />
        <Skeleton width="50%" height="1rem" />
      </div>
    </div>
  );
}

function AlertsReady({ view }: { readonly view: Extract<AlertsView, { state: 'tracking' }> }) {
  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
      </div>
      {view.alerts.length === 0 ? (
        <StateMessage icon="clock" title="No alerts yet" detail="Each alert and card reminder the app sends is listed here, newest first, with when it was due and when it was sent." testId="alerts-empty" />
      ) : (
        <Card title={alertCountText(view.alerts.length, view.total)} testId="alerts-list">
          {view.alerts.map((line) => (
            <ListRow
              key={line.key}
              icon={line.sentAt === null ? 'clock' : ICONS[line.kind]}
              tone={line.sentAt === null ? 'warning' : 'info'}
              title={line.title}
              detail={
                <>
                  <span className="row__line" data-testid="alert-body">
                    {line.body}
                  </span>{' '}
                  <span className="row__line" data-testid="alert-when">
                    {alertWhenText(line, view.today)}
                  </span>
                </>
              }
              testId={`alert-${line.key}`}
            />
          ))}
        </Card>
      )}
    </>
  );
}

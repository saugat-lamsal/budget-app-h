import type { BucketsShown as BucketsView } from '@budget-app/server/views';
import { useState } from 'react';
import type { Load, Reload } from '../app/api.js';
import { activityPath, pathOf } from '../app/routes.js';
import { BucketBar, Button, Card, Hero, ListRow, MadeUpPill, Money, Skeleton, StateMessage, TargetBar } from '../ui/blocks.js';
import { longDate, monthName } from '../ui/dates.js';
import { Icon } from '../ui/Icon.js';
import { onItsWayDetail, onItsWayTitle } from './buckets-text.js';
import { SaidNotice, type Said } from './choose.js';
import { MoveMoney } from './Move.js';
import { CheckBanner } from './check-banner.js';

// Buckets: what is left in each bucket, the mom reserve with this month
// against the target, money held for others, and the old card debt. The one
// main number is everything in the buckets (12.2). Every number comes from
// the server, worked out by the money math. Each bucket opens the list of
// what went in and out of it (B97), money can be moved between them by hand
// (13.3), and Payday opens from here (B104).

export function BucketsScreen({ load, onRetry, onChanged }: { readonly load: Load<BucketsView>; readonly onRetry: Reload; readonly onChanged: Reload }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="buckets">
      <h1 className="sr-only">Buckets</h1>
      {load.status === 'loading' && <BucketsLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load your buckets" detail="Check your connection, then try again." testId="buckets-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="bank" title="No buckets yet" detail="Setup day reads your bank balances and lets you hand out your starting money. Your buckets show here after that." testId="buckets-not-set-up" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <BucketsReady view={load.value} reload={onRetry} onChanged={onChanged} />}
    </main>
  );
}

function BucketsLoading() {
  return (
    <div data-testid="buckets-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading your buckets</span>
      <div className="hero" aria-hidden="true">
        <Skeleton width="7rem" height="1rem" />
        <Skeleton width="13rem" height="3rem" />
        <Skeleton width="10rem" height="1rem" />
      </div>
      <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
        <Skeleton width="60%" height="1rem" />
        <Skeleton width="80%" height="1rem" />
        <Skeleton width="50%" height="1rem" />
      </div>
    </div>
  );
}

type Tracking = Extract<BucketsView, { state: 'tracking' }>;

// 7.3, B22
const HELD_WORDS = {
  settled: 'Settled: nothing held either way',
  'holding-for-others': "Holding money that isn't yours",
  'owed-to-you': 'Someone owes you',
} as const;

function BucketsReady({ view, reload, onChanged }: { readonly view: Tracking; readonly reload: Reload; readonly onChanged: Reload }) {
  const { check, momReserve, heldForOthers, waiting } = view;
  const [moving, setMoving] = useState(false);
  const [moved, setMoved] = useState<Said | null>(null);
  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>

      {moved !== null && <SaidNotice said={moved} sending={false} onRetry={() => undefined} onDismiss={() => setMoved(null)} sticky />}

      <CheckBanner check={check} />

      <Hero
        label="In your buckets"
        testId="buckets-hero"
        sub={
          check.state === 'matches' ? (
            <>
              <Icon name="check" size={16} />
              <span data-testid="check-line">Matches your bank, to the cent</span>
            </>
          ) : check.state === 'bank-not-read' ? (
            <>
              <Icon name="clock" size={16} />
              <span data-testid="check-line">Can't reach the bank to check this now</span>
            </>
          ) : undefined
        }
      >
        <Money cents={view.total} hero roll testId="buckets-total" />
      </Hero>

      <Card title="This pay period" testId="pay-period">
        <BucketBar name="Needs" {...view.needs} href={activityPath('needs')} testId="bucket-needs" />
        <BucketBar name="Wants" {...view.wants} href={activityPath('wants')} testId="bucket-wants" />
        <ListRow icon="bank" title="Payday" detail="What your last paycheck did, and how the pay period went" href="/payday" testId="row-payday" />
      </Card>

      {/* "Off in this setup": with no mom reserve, nothing about one. */}
      <Card title={momReserve === undefined ? 'Savings' : 'Savings and reserves'} testId="reserves">
        <ListRow icon="bank" title="Savings" trailing={<Money cents={view.savings} roll testId="savings" />} href={activityPath('savings')} testId="row-savings" />
        {momReserve !== undefined && (
          <ListRow
            icon="heart"
            title="Mom reserve"
            detail="Set aside from each paycheck. What you send her comes out of it."
            trailing={<Money cents={momReserve.amount} roll testId="mom-reserve" />}
            href={activityPath('momReserve')}
            testId="row-mom-reserve"
          />
        )}
        <ListRow
          icon="people"
          title="Held for others"
          detail={HELD_WORDS[heldForOthers.meaning]}
          trailing={<Money cents={heldForOthers.heldForOthers} roll testId="held-for-others" />}
          href={activityPath('heldForOthers')}
          testId="row-held"
        />
      </Card>

      <Card title="Move money" testId="move-money">
        <ListRow
          icon="move"
          title="Move money between buckets"
          detail={momReserve === undefined ? 'Needs, wants, savings, or money held for others' : 'Needs, wants, savings, the mom reserve, or money held for others'}
          onClick={() => setMoving(true)}
          testId="move-open"
        />
      </Card>

      {/* 8.2: what was sent this month, apart from what the reserve holds. */}
      {momReserve !== undefined && (
        <Card title="Sent to mom" testId="mom-month">
          <TargetBar
            testId="mom"
            name={`${monthName(momReserve.month)} so far`}
            amount={<Money cents={momReserve.sent} testId="mom-sent" />}
            caption={
              <>
                Target <Money cents={momReserve.target.low} testId="mom-target-low" /> to <Money cents={momReserve.target.high} testId="mom-target-high" /> a month.
              </>
            }
            sent={momReserve.sent}
            low={momReserve.target.low}
            high={momReserve.target.high}
            position={momReserve.position}
          />
        </Card>
      )}

      {waiting.count > 0 && (
        <Card title="Not in a bucket yet" testId="waiting">
          <ListRow
            icon="tray"
            title={`${waiting.count} waiting in review`}
            detail={
              <>
                {waiting.moneyIn !== 0 && (
                  <>
                    <Money cents={waiting.moneyIn} testId="waiting-in" /> coming in.{' '}
                  </>
                )}
                {waiting.spending !== 0 && (
                  <>
                    <Money cents={waiting.spending} testId="waiting-out" /> going out.
                  </>
                )}
                {waiting.moneyIn === 0 && waiting.spending === 0 && 'Questions to answer. No money is waiting.'}
              </>
            }
            href={pathOf('review')}
            testId="row-waiting"
          />
        </Card>
      )}

      {/* 12.5, B44: money on its way between his accounts, each with where it stands. */}
      {view.onItsWay.items.length > 0 && (
        <Card title="On its way" testId="on-its-way">
          {view.onItsWay.items.map((item) => (
            <ListRow
              key={item.id}
              icon="move"
              title={onItsWayTitle(item)}
              detail={onItsWayDetail(item)}
              trailing={<Money cents={item.amount} testId={`transit-${item.id}-amount`} />}
              testId={`transit-${item.id}`}
            />
          ))}
        </Card>
      )}

      {view.oldCard !== undefined && (
        <Card title="Old card" testId="old-card">
          <ListRow
            icon="card"
            title="Debt on the old card"
            detail={view.oldCard < 0 ? "You've paid more than it owed, so this is a credit. It is not part of your buckets." : 'Not part of your buckets.'}
            trailing={<Money cents={view.oldCard} testId="old-card-debt" />}
            testId="row-old-card"
          />
        </Card>
      )}

      <MoveMoney
        open={moving}
        onClose={() => setMoving(false)}
        balances={{ savings: view.savings, needs: view.needs.left, wants: view.wants.left, ...(momReserve === undefined ? {} : { momReserve: momReserve.amount }), heldForOthers: heldForOthers.heldForOthers }}
        start={{ from: 'wants', to: 'needs' }}
        onMoved={(text) => {
          setMoved({ tone: 'ok', text });
          reload('after');
          onChanged('after');
        }}
      />
    </>
  );
}

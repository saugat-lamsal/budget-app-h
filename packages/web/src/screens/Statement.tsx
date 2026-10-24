import type { StatementItem, StatementView } from '@budget-app/money';
import type { StatementScreenView } from '@budget-app/server/views';
import { useState } from 'react';
import type { Load, Reload } from '../app/api.js';
import type { StatementCard } from '../app/routes.js';
import { BackLink, BottomSheet, Button, Card, Hero, ListRow, MadeUpPill, Money, Segmented, Skeleton, StateMessage } from '../ui/blocks.js';
import { shortDate } from '../ui/dates.js';
import type { Back } from './Activity.js';
import { NOT_MATCHED, bucketTitle, cardName, carriedInText, noStatementText, periodTitle, statementDaysText } from './cards-text.js';

// Her rulebook, 52.4: one card's last statement, in lines that add up to its
// balance: what was carried in less the payments, the purchases by bucket or
// by paycheck, and anything the app's lines do not account for, never
// hidden. Tapping a bucket or a paycheck lists its purchases. Every number
// comes from the server; the screen only shows it, and it only reads.

export function StatementScreen({ card, load, onRetry, back }: { readonly card: StatementCard; readonly load: Load<StatementScreenView>; readonly onRetry: Reload; readonly back: Back }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="statement">
      <h1 className="sr-only">{`${cardName(card)} statement`}</h1>
      <BackLink href={back.href} label={back.label} onBack={back.onBack} testId="back" />
      {load.status === 'loading' && <StatementLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load the statement" detail="Check your connection, then try again." testId="statement-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'off' && <StateMessage icon="card" title="No statements here" detail="This setup has no statement screen." testId="statement-off" />}
      {load.status === 'ready' && load.value.state === 'no-statement' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="card" title={`No statement for ${cardName(card)} yet`} detail={noStatementText(load.value.why)} testId="statement-none" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'ready' && <StatementReady view={load.value.statement} madeUpData={load.value.madeUpData} />}
    </main>
  );
}

function StatementLoading() {
  return (
    <div data-testid="statement-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading the statement</span>
      <div className="hero" aria-hidden="true">
        <Skeleton width="7rem" height="1rem" />
        <Skeleton width="13rem" height="3rem" />
        <Skeleton width="10rem" height="1rem" />
      </div>
      <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
        <Skeleton width="60%" height="1rem" />
        <Skeleton width="80%" height="1rem" />
      </div>
    </div>
  );
}

type By = 'bucket' | 'paycheck';
interface Shown {
  readonly title: string;
  readonly items: readonly StatementItem[];
}

function StatementReady({ view, madeUpData }: { readonly view: StatementView; readonly madeUpData: boolean }) {
  const [by, setBy] = useState<By>('bucket');
  const [shown, setShown] = useState<Shown | null>(null);
  const carried = carriedInText(view.carriedIn);
  const groups =
    by === 'bucket'
      ? view.byBucket.map((g) => ({ key: g.bucket, title: bucketTitle(g.bucket), total: g.total, items: g.items }))
      : view.byPayPeriod.map((g) => ({ key: g.period === 'before-setup' ? 'before-setup' : `period-${g.period.number}`, title: periodTitle(g.period), total: g.total, items: g.items }));
  const credits = view.carriedIn.kind === 'from-statement-before' ? view.carriedIn.items : [];
  return (
    <>
      {madeUpData && <MadeUpPill />}
      <Hero label={`${cardName(view.card)} statement`} sub={statementDaysText(view.from, view.closingDate, view.dueDate)} testId="statement-hero">
        <Money cents={view.statementBalance} hero testId="statement-balance" />
      </Hero>

      <Card title="What is on it" testId="statement-lines">
        <ListRow
          icon="card"
          title={carried.title}
          detail={carried.detail}
          trailing={<Money cents={view.carriedIn.amount} testId="statement-carried-in" />}
          {...(credits.length === 0 ? {} : { onClick: () => setShown({ title: 'Payments and credits', items: credits }) })}
          testId="statement-carried"
        />
        <ListRow icon="tray" title="Purchases, fees and interest, less refunds" trailing={<Money cents={view.charges} testId="statement-charges" />} testId="statement-charges-row" />
        {view.notMatched !== 0 && (
          // Never hidden: what the app's lines do not account for.
          <ListRow icon="alert" tone="warning" title={NOT_MATCHED.title} detail={NOT_MATCHED.detail} trailing={<Money cents={view.notMatched} testId="statement-not-matched" />} testId="statement-not-matched-row" />
        )}
        <ListRow title="Statement balance" trailing={<Money cents={view.statementBalance} testId="statement-total" />} testId="statement-total-row" />
      </Card>

      <Segmented
        label="Show the purchases"
        options={[
          { value: 'bucket', label: 'By bucket' },
          { value: 'paycheck', label: 'By paycheck' },
        ]}
        value={by}
        onChange={setBy}
        testId="statement-by"
      />
      <Card testId="statement-groups">
        {groups.length === 0 ? (
          <ListRow icon="check" tone="ok" title="No purchases on this statement" testId="statement-no-purchases" />
        ) : (
          groups.map((g) => (
            <ListRow
              key={g.key}
              title={g.title}
              detail={`${g.items.length} ${g.items.length === 1 ? 'item' : 'items'}`}
              trailing={<Money cents={g.total} testId={`statement-group-${g.key}-total`} />}
              onClick={() => setShown({ title: g.title, items: g.items })}
              testId={`statement-group-${g.key}`}
            />
          ))
        )}
      </Card>

      <BottomSheet open={shown !== null} title={shown?.title ?? ''} onClose={() => setShown(null)} testId="statement-items-sheet">
        <div className="card">
          {(shown?.items ?? []).map((item, i) => (
            <ListRow key={`${item.id} ${i}`} title={item.description} detail={item.date === item.postedOn ? shortDate(item.date) : `${shortDate(item.date)}, posted ${shortDate(item.postedOn)}`} trailing={<Money cents={item.amount} testId={`statement-item-${i}-amount`} />} testId={`statement-item-${i}`} />
          ))}
        </div>
      </BottomSheet>
    </>
  );
}

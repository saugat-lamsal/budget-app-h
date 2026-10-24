import type { CSSProperties } from 'react';
import type { LeftoverReport } from '@budget-app/money';
import type { PaydayShown as PaydayView } from '@budget-app/server/views';
import type { Load, Reload } from '../app/api.js';
import { BackLink, Banner, Button, Card, Hero, ListRow, MadeUpPill, Money, Notice, Skeleton, StateMessage } from '../ui/blocks.js';
import { longDate, shortDate } from '../ui/dates.js';
import { POT_NAMES } from '../ui/names.js';
import type { Back } from './Activity.js';
import { ChoiceSheet, LeftoverDecision, SaidNotice, useChoiceFlow } from './choose.js';
import { paydayText } from './home-text.js';
import { lessSincePaydayWords, titleOf } from './review-text.js';
import type { PaycheckShown as PaycheckReport, PeriodSummaryShown as PeriodSummary } from '@budget-app/server/views';

// Payday (QUESTIONS.md B104 to B107): what the last paycheck did, the mom
// reserve first and then the split (rules 3.2, 3.3); how much is still to
// move into the savings account (3.8); what became of each bucket's
// leftover, with the questions still open to answer here (3.4, 3.5); and how
// the pay period that just ended went. Every number comes from the server,
// worked out by the money math; the screen only shows it.

export function PaydayScreen({ load, onRetry, onChanged, back }: { readonly load: Load<PaydayView>; readonly onRetry: Reload; readonly onChanged: Reload; readonly back: Back }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="payday">
      <h1 className="sr-only">Payday</h1>
      <BackLink href={back.href} label={back.label} onBack={back.onBack} testId="back" />
      {load.status === 'loading' && <PaydayLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load payday" detail="Check your connection, then try again." testId="payday-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="bank" title="No paydays yet" detail="Setup day reads your bank balances and lets you hand out your starting money. What each paycheck does shows here after that." testId="payday-not-set-up" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <PaydayReady view={load.value} reload={onRetry} onChanged={onChanged} />}
    </main>
  );
}

function PaydayLoading() {
  return (
    <div data-testid="payday-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading payday</span>
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

type Tracking = Extract<PaydayView, { state: 'tracking' }>;

function PaydayReady({ view, reload, onChanged }: { readonly view: Tracking; readonly reload: Reload; readonly onChanged: Reload }) {
  const { report } = view;
  // Answering a payday question here is the same as in Review: the same desk, the same promises.
  const flow = useChoiceFlow({ resort: false, reload, onChanged, keys: new Map(view.questions.map((q) => [q.item.id, q.key])), view });
  const { sheet, said, sending, setSaid, submit, choose } = flow;
  const open = sheet === null ? undefined : view.questions.find((q) => q.item.id === sheet.item);

  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>

      {said !== null && sheet === null && <SaidNotice said={said} sending={sending} onRetry={submit} onDismiss={() => setSaid(null)} sticky />}

      {report.paycheck === null ? (
        <StateMessage icon="clock" title="No paycheck yet" detail={`No paycheck has come in since setup day. The next one is expected ${shortDate(view.payday.next)}: ${paydayText(view.payday.days).toLowerCase()}.`} testId="payday-none" />
      ) : (
        <>
          <Hero
            label="Your last paycheck"
            testId="payday-hero"
            sub={
              <>
                <span data-testid="paycheck-when">{shortDate(report.paycheck.date)}</span> · <span data-testid="next-payday">{paydayText(view.payday.days)}</span>
              </>
            }
          >
            <Money cents={report.paycheck.amount} hero roll testId="paycheck-amount" />
          </Hero>
          {report.paycheck.takenBack && (
            <Banner tone="warning" icon="undo" title="The bank took this paycheck back" testId="paycheck-taken-back">
              <p className="banner__body">Its money came back out of your buckets. The pay period it began stays.</p>
            </Banner>
          )}
          <PaydayMoment paycheck={report.paycheck} />
          <WhatItDid paycheck={report.paycheck} />
        </>
      )}

      <MoveToSavings view={view} />

      {report.paycheck !== null && (
        <Card title="Left over from the last pay period" testId="payday-leftovers">
          {report.leftovers.map((l) => {
            const question = l.question === null ? undefined : view.questions.find((q) => q.item.id === l.question);
            return question === undefined ? <LeftoverRow key={l.bucket} leftover={l} /> : <LeftoverDecision key={l.bucket} detail={question} busy={sending || flow.holding(question.item.id)} changed={flow.changed(question.item.id)} onChoose={choose} />;
          })}
        </Card>
      )}

      {report.ended !== null && <EndedPeriod summary={report.ended} />}

      <ChoiceSheet flow={flow} itemId={open?.item.id} subject={undefined} title={open === undefined ? 'Are you sure?' : titleOf(open.item)} testId="payday-sheet" />
    </>
  );
}

// Redesign PR 3, the payday moment: the paycheck divides into its parts
// (3.2, 3.3) and the savings part lights up, with one sweep of light and a few
// sparks. Only saving is celebrated; nothing lights up for spending. The parts
// are the money math's own, as the cards below show them, and the words and
// amounts under the bar carry the same thing without color. All of it is CSS:
// reduced motion shows the bar at rest, and nothing here is asked of the server.
const SPARKS = ['12%', '32%', '50%', '70%', '88%'];

function PaydayMoment({ paycheck }: { readonly paycheck: PaycheckReport }) {
  const { split } = paycheck;
  // "Off in this setup": with no mom reserve, no part for one.
  const parts = [
    ...(split.momReserve === undefined ? [] : [{ key: 'mom', name: 'Mom reserve', cents: split.momReserve } as const]),
    { key: 'savings', name: 'Savings', cents: split.savings },
    { key: 'needs', name: 'Needs', cents: split.needs },
    { key: 'wants', name: 'Wants', cents: split.wants },
    // Her rulebook, 3.3: Wishlist's part, where the split names it.
    ...(split.wishlist === undefined ? [] : [{ key: 'wishlist', name: 'Wishlist', cents: split.wishlist } as const]),
  ] as const;
  // Parts that are zero or below take no room on the bar; the list still names them.
  const drawn = parts.filter((p) => p.cents > 0);
  if (drawn.length === 0) return null;
  return (
    <Card title="Where this paycheck went" testId="payday-moment">
      <div className="moment">
        <div className="moment__bar" aria-hidden="true" data-testid="moment-bar">
          {drawn.map((p, i) => (
            <div key={p.key} className="moment__cell" style={{ '--share': p.cents } as CSSProperties} data-testid={`moment-${p.key}`} data-cents={p.cents}>
              <div className={`moment__seg moment__seg--${p.key}`} style={{ '--i': i } as CSSProperties} />
              {p.key === 'savings' && (
                <div className="moment__sparks" data-testid="moment-sparks">
                  {SPARKS.map((at, n) => (
                    <span key={at} className="moment__spark" style={{ '--at': at, '--n': n } as CSSProperties} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <ul className="moment__legend" data-testid="moment-legend">
          {parts.map((p) => (
            <li key={p.key}>
              <span className={`moment__swatch moment__swatch--${p.key}`} aria-hidden="true" />
              <span>{p.name}</span>
              <Money cents={p.cents} testId={`moment-got-${p.key}`} />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// 3.2, 3.3: the mom reserve first, then the split, step by step. With no
// mom reserve ("Off in this setup"), the split alone.
function WhatItDid({ paycheck }: { readonly paycheck: PaycheckReport }) {
  const { split, percent } = paycheck;
  const d = split.detail;
  const { momReserve } = split;
  const { reserveTaken, overflowToSavings } = d;
  const { reserveCap, reserveBefore } = paycheck;
  const reserve = momReserve !== undefined && reserveTaken !== undefined && overflowToSavings !== undefined && reserveCap !== undefined && reserveBefore !== undefined;
  return (
    <>
      {reserve && (
        <Card title="1. The mom reserve comes off first" testId="payday-reserve">
          <dl className="figures">
            <dt>Taken off the top</dt>
            <dd>
              <Money cents={reserveTaken} testId="reserve-taken" />
            </dd>
            <dt>Went into the reserve</dt>
            <dd>
              <Money cents={momReserve} testId="reserve-in" />
            </dd>
            {overflowToSavings > 0 && (
              <>
                <dt>
                  Did not fit under the <Money cents={reserveCap} /> cap, so it went to Savings
                </dt>
                <dd>
                  <Money cents={overflowToSavings} testId="reserve-overflow" />
                </dd>
              </>
            )}
            <dt>The reserve held before</dt>
            <dd>
              <Money cents={reserveBefore} testId="reserve-before" />
            </dd>
          </dl>
        </Card>
      )}

      <Card title={reserve ? '2. The rest, split by the percentages' : 'The paycheck, split by the percentages'} testId="payday-split">
        <dl className="figures">
          <dt>Left to split</dt>
          <dd>
            <Money cents={d.rest} testId="split-rest" />
          </dd>
          <dt>Savings, {percent.savings}%</dt>
          <dd>
            <Money cents={d.savingsShare} testId="split-savings" />
          </dd>
          <dt>Needs, {percent.needs}%</dt>
          <dd>
            <Money cents={split.needs} testId="split-needs" />
          </dd>
          <dt>Wants, {percent.wants}%</dt>
          <dd>
            <Money cents={split.wants} testId="split-wants" />
          </dd>
          {split.wishlist !== undefined && (
            <>
              <dt>Wishlist, {percent.wishlist ?? 0}%</dt>
              <dd>
                <Money cents={split.wishlist} testId="split-wishlist" />
              </dd>
            </>
          )}
          {d.roundingToSavings > 0 && (
            <>
              <dt>Cents left over from rounding, to Savings</dt>
              <dd>
                <Money cents={d.roundingToSavings} testId="split-rounding" />
              </dd>
            </>
          )}
        </dl>
      </Card>
      <p className="sheet__note">These are the percentages {reserve ? 'and reserve ' : ''}this paycheck was worked out with. A change in settings applies from the next one.</p>

      <Card title="What each bucket got" testId="payday-got">
        <dl className="figures">
          {momReserve !== undefined && (
            <>
              <dt>Mom reserve</dt>
              <dd>
                <Money cents={momReserve} signed testId="got-mom" />
              </dd>
            </>
          )}
          <dt>Savings</dt>
          <dd>
            <Money cents={split.savings} signed testId="got-savings" />
          </dd>
          <dt>Needs</dt>
          <dd>
            <Money cents={split.needs} signed testId="got-needs" />
          </dd>
          <dt>Wants</dt>
          <dd>
            <Money cents={split.wants} signed testId="got-wants" />
          </dd>
          {split.wishlist !== undefined && (
            <>
              <dt>Wishlist</dt>
              <dd>
                <Money cents={split.wishlist} signed testId="got-wishlist" />
              </dd>
            </>
          )}
          <dt className="figures__total">The paycheck</dt>
          <dd className="figures__total">
            <Money cents={paycheck.amount} testId="got-total" />
          </dd>
        </dl>
      </Card>
    </>
  );
}

// 3.8: what the savings account should hold, and how much is still to move.
function MoveToSavings({ view }: { readonly view: Tracking }) {
  const t = view.toSavings;
  return (
    <Card title="Move to savings" testId="payday-savings">
      {t.state === 'bank-not-read' ? (
        <ListRow icon="clock" tone="warning" title="Can't reach the bank to check the savings account now" detail="How much is still to move shows here when it can be read again." testId="savings-not-read" />
      ) : (
        <>
          <dl className="figures">
            <dt>{view.withWishlist === true ? 'Savings plus Wishlist' : view.savingsAlone === true ? 'Savings' : 'Savings plus mom reserve'}</dt>
            <dd>
              <Money cents={t.transfer.shouldBeInSavings} testId="savings-should" />
            </dd>
            <dt>In the savings account</dt>
            <dd>
              <Money cents={t.transfer.savingsAccountBalance} testId="savings-holds" />
            </dd>
            {/* B46: money on its way to the account counts as moved. */}
            {t.onItsWay > 0 && (
              <>
                <dt>On its way to the account</dt>
                <dd>
                  <Money cents={t.onItsWay} testId="savings-on-its-way" />
                </dd>
              </>
            )}
            <dt className="figures__total">Still to move</dt>
            <dd className="figures__total">
              <Money cents={t.transfer.stillToMove} testId="savings-to-move" />
            </dd>
            {t.transfer.extraInSavings !== undefined && (
              <>
                <dt>Extra in the account</dt>
                <dd>
                  <Money cents={t.transfer.extraInSavings} testId="savings-extra" />
                </dd>
              </>
            )}
          </dl>
          <p className="sheet__note" style={{ padding: '0 var(--space-4) var(--space-4)' }}>
            {t.transfer.stillToMove > 0
              ? "Move it from checking to savings in your bank's app. This app never moves money."
              : t.transfer.extraInSavings === undefined && t.onItsWay > 0
                ? 'Nothing more to move: the rest is on its way to the account.'
                : 'The account already holds what it should.'}
          </p>
        </>
      )}
    </Card>
  );
}

// B4, B109: when spending from before payday that showed up since took something off what the bucket held, say so.
function withWhy(text: string, leftover: LeftoverReport): string {
  return leftover.lessSincePayday > 0 ? `${text} ${lessSincePaydayWords(leftover.leftAtPayday, leftover.lessSincePayday)}` : text;
}

// 3.4, 3.5: what became of a bucket's leftover, when nothing is left to answer.
function LeftoverRow({ leftover }: { readonly leftover: LeftoverReport }) {
  const name = POT_NAMES[leftover.bucket];
  const by = leftover.setting === 'ask' ? 'by your answer' : 'by your setting';
  switch (leftover.outcome) {
    case 'nothing-to-ask':
      return (
        <ListRow
          icon="check"
          tone="ok"
          title={`${name}: nothing to ask about`}
          detail={
            <>
              It held <Money cents={leftover.leftAtPayday} /> at payday. Nothing left, or overspent, carries over as it is.
            </>
          }
          testId={`leftover-${leftover.bucket}`}
        />
      );
    case 'kept':
      return (
        <ListRow
          icon="check"
          tone="ok"
          title={
            <>
              {name}: kept <Money cents={leftover.amount} />
            </>
          }
          detail={withWhy(`Rolled over into this pay period, ${by}.`, leftover)}
          testId={`leftover-${leftover.bucket}`}
        />
      );
    case 'moved-to-savings':
      return (
        <ListRow
          icon="move"
          title={
            <>
              {name}: <Money cents={leftover.amount} /> moved to Savings
            </>
          }
          detail={withWhy(`${by.charAt(0).toUpperCase()}${by.slice(1)}.`, leftover)}
          testId={`leftover-${leftover.bucket}`}
        />
      );
    case 'waiting':
      // Normally shown as a question; this is only if the question is not in review any more.
      return (
        <Notice tone="warning" icon="info" testId={`leftover-${leftover.bucket}`}>
          {name} has a question waiting in Review.
        </Notice>
      );
  }
}

// B105: how the pay period that just ended went, added up by the money math.
function EndedPeriod({ summary }: { readonly summary: PeriodSummary }) {
  const when = summary.endDate === null ? '' : `${shortDate(summary.startDate)} to ${shortDate(summary.endDate)}`;
  return (
    <Card title="The pay period that just ended" testId="payday-ended">
      <p className="sheet__note" style={{ padding: 'var(--space-4) var(--space-4) 0' }} data-testid="ended-dates">
        {when}
      </p>
      <dl className="figures">
        <dt>Spent from Needs</dt>
        <dd>
          <Money cents={summary.byKind.needs.spending} testId="ended-needs-spent" />
        </dd>
        <dt>Spent from Wants</dt>
        <dd>
          <Money cents={summary.byKind.wants.spending} testId="ended-wants-spent" />
        </dd>
        {summary.byKind.momReserve !== undefined && (
          <>
            <dt>Sent to mom</dt>
            <dd>
              <Money cents={summary.byKind.momReserve.mom ?? 0} testId="ended-mom" />
            </dd>
          </>
        )}
        <dt className="figures__total">Left in Needs at payday</dt>
        <dd className="figures__total">
          <Money cents={summary.closing.needs} testId="ended-needs-left" />
        </dd>
        <dt className="figures__total">Left in Wants at payday</dt>
        <dd className="figures__total">
          <Money cents={summary.closing.wants} testId="ended-wants-left" />
        </dd>
      </dl>
      <p className="sheet__note" style={{ padding: '0 var(--space-4) var(--space-4)' }}>
        Spent is what purchases, fees and payments took out, after refunds. What was left is what the questions above are about.
      </p>
    </Card>
  );
}

import type { ActivityWhat, AnyPot } from '@budget-app/money';
import type { ActivityShown as ActivityView } from '@budget-app/server/views';
import { useState } from 'react';
import type { Load, Reload } from '../app/api.js';
import { BackLink, Button, Card, Hero, ListRow, MadeUpPill, Money, Notice, Skeleton, StateMessage, StatusLabel } from '../ui/blocks.js';
import { longDate, shortDate } from '../ui/dates.js';
import type { IconName } from '../ui/Icon.js';
import { moneyText } from '../ui/money-format.js';
import { POT_NAMES } from '../ui/names.js';
import { ChoiceSheet, RuleOfferSheet, SaidNotice, subjectOfRow, useChoiceFlow, type Said } from './choose.js';
import { MoveMoney } from './Move.js';
import { ACCOUNT_NAMES } from './review-text.js';
import { WishlistList } from './wishlist-items.js';
import type { ActivityRowShown as ActivityRow } from '@budget-app/server/views';

// What went in and out of one bucket this pay period (QUESTIONS.md B97 to
// B102): what it held when the pay period began, each thing that changed it,
// and what it holds now. The numbers add up on the screen. Tapping a thing
// shows what it is, and, if it can be sorted again (rule 4.7), the choices
// the money math gives for it, with "always do this" (13.6). Every number
// comes from the server, worked out by the money math.

export interface Back {
  readonly href: string;
  readonly label: string;
  readonly onBack: () => void;
}

export function ActivityScreen({ pot, load, onRetry, onChanged, back }: { readonly pot: AnyPot; readonly load: Load<ActivityView>; readonly onRetry: Reload; readonly onChanged: Reload; readonly back: Back }) {
  // "Off in this setup": a bucket this setup does not have is not named.
  const off = load.status === 'ready' && load.value.state === 'off';
  const name = off ? 'Not in your setup' : POT_NAMES[pot];
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="activity">
      <h1 className="sr-only">{name}</h1>
      <BackLink href={back.href} label={back.label} onBack={back.onBack} testId="back" />
      {load.status === 'loading' && <ActivityLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title={`Couldn't load ${name}`} detail="Check your connection, then try again." testId="activity-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="bank" title="Nothing here yet" detail="Setup day reads your bank balances and lets you hand out your starting money. What goes in and out of each bucket shows here after that." testId="activity-not-set-up" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'off' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="bank" title="Not in your setup" detail="Your setup has no such bucket. Your buckets are on the Buckets tab." testId="activity-off" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <ActivityReady view={load.value} reload={onRetry} onChanged={onChanged} />}
    </main>
  );
}

function ActivityLoading() {
  return (
    <div data-testid="activity-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading what went in and out</span>
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

type Tracking = Extract<ActivityView, { state: 'tracking' }>;

// What a row is, in words (B97 to B100).
const WHAT_WORDS: Readonly<Record<ActivityWhat, string>> = {
  paycheck: 'Paycheck',
  'other-income': 'Other income',
  payback: 'Payback',
  'not-mine': 'Held for others',
  purchase: 'Purchase',
  'card-fee': 'Card fee',
  'card-interest': 'Card interest',
  'debt-payoff': 'Payment to the old card',
  'person-payment': 'Payment to a person',
  'mom-difference': 'Left over from a mom payment',
  mom: 'Sent to mom',
  move: 'Moved by hand',
  leftover: 'Left over at payday',
  removed: 'No longer in your books',
};

const WHAT_ICONS: Readonly<Record<ActivityWhat, IconName>> = {
  paycheck: 'bank',
  'other-income': 'bank',
  payback: 'swap',
  'not-mine': 'people',
  purchase: 'card',
  'card-fee': 'alert',
  'card-interest': 'alert',
  'debt-payoff': 'card',
  'person-payment': 'people',
  'mom-difference': 'heart',
  mom: 'heart',
  move: 'move',
  leftover: 'move',
  removed: 'info',
};

// A row's title: what the bank called it, or, for a move and a leftover,
// which way the money went.
export function rowTitle(row: ActivityRow): string {
  if (row.what === 'move' && row.other !== null) return row.amount >= 0 ? `Moved in from ${POT_NAMES[row.other]}` : `Moved out to ${POT_NAMES[row.other]}`;
  if (row.what === 'leftover' && row.other !== null) return row.amount >= 0 ? `Leftover moved in from ${POT_NAMES[row.other]}` : `Leftover moved to ${POT_NAMES[row.other]}`;
  return row.description === '' ? WHAT_WORDS[row.what] : row.description;
}

function ActivityReady({ view, reload, onChanged }: { readonly view: Tracking; readonly reload: Reload; readonly onChanged: Reload }) {
  const { activity, pot, balances } = view;
  const name = POT_NAMES[pot];
  const flow = useChoiceFlow({ resort: true, reload, onChanged, keys: new Map(Object.entries(view.keys)), view, wishlistItems: view.wishlistItems });
  const [moving, setMoving] = useState(false);
  const [moved, setMoved] = useState<Said | null>(null);
  const { sheet, said, sending, setSaid, submit, openSheet } = flow;

  const open = sheet === null ? undefined : activity.rows.find((r) => r.id === sheet.item);
  // Her rulebook, 50.3: a purchase marked bought says which thing it was.
  const boughtNames = new Map((view.list?.bought ?? []).map((b) => [b.purchase, b.name]));
  // Moving money starts from this bucket, to the one next to it (needs <-> wants).
  const other: AnyPot = pot === 'needs' ? 'wants' : pot === 'wants' ? 'needs' : 'needs';

  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>

      {said !== null && sheet === null && <SaidNotice said={said} sending={sending} onRetry={submit} onDismiss={() => setSaid(null)} onOffer={flow.openOffer} sticky />}
      {moved !== null && said === null && <SaidNotice said={moved} sending={false} onRetry={() => undefined} onDismiss={() => setMoved(null)} sticky />}

      <Hero label={name} testId="activity-hero" sub={`This pay period, since ${shortDate(activity.period.startDate)}`}>
        <Money cents={activity.closing} hero roll testId="activity-now" />
      </Hero>

      <Card title="This pay period" testId="activity-figures">
        <dl className="figures">
          <dt>Carried in</dt>
          <dd>
            <Money cents={activity.opening} testId="activity-opening" />
          </dd>
          <dt>Came in</dt>
          <dd>
            <Money cents={activity.in} signed testId="activity-in" />
          </dd>
          <dt>Went out</dt>
          <dd>
            <Money cents={activity.out} testId="activity-out" />
          </dd>
          <dt className="figures__total">Now</dt>
          <dd className="figures__total">
            <Money cents={activity.closing} testId="activity-closing" />
          </dd>
        </dl>
      </Card>
      <p className="sheet__note">Carried in is what {name} held when this pay period began. Came in and went out are the things below, added up.</p>

      <Button variant="secondary" wide onClick={() => setMoving(true)} testId="move-open">
        Move money
      </Button>

      {/* Her rulebook, 50.1 to 50.3: on Wishlist's screen, her list. */}
      {view.list !== undefined && <WishlistList list={view.list} reload={reload} onChanged={onChanged} />}

      <Card title="What went in and out" testId="activity-list">
        {activity.rows.length === 0 ? (
          <ListRow icon="check" tone="ok" title={`Nothing has gone in or out of ${name} yet this pay period`} testId="activity-empty" />
        ) : (
          activity.rows.map((row) => (
            <ListRow
              key={row.id}
              icon={WHAT_ICONS[row.what]}
              title={rowTitle(row)}
              detail={
                <>
                  {flow.changed(row.id) && <StatusLabel status="changed" testId="changed" />} {row.pending && <StatusLabel status="pending" />} {WHAT_WORDS[row.what]} · {shortDate(row.date)}
                  {row.account === null ? '' : ` · ${ACCOUNT_NAMES[row.account]}`}
                  {row.partOfSplit ? ' · Part of a split' : ''}
                  {row.refunded > 0 ? ` · Refunded ${moneyText(row.refunded)}` : ''}
                  {boughtNames.has(row.id) ? ` · Bought: ${boughtNames.get(row.id) ?? ''}` : ''}
                </>
              }
              trailing={<Money cents={row.amount} signed testId="row-amount" />}
              onClick={() => {
                // A32: a row that just changed opens only after a moment.
                if (!flow.holding(row.id)) openSheet(row.id);
              }}
              testId={`row-${row.id}`}
            />
          ))
        )}
      </Card>

      <ChoiceSheet flow={flow} itemId={open?.id} subject={open === undefined ? undefined : (subjectOfRow(open, view.keys[open.id], view.ruleTexts[open.id]) ?? undefined)} title={open === undefined ? 'Details' : rowTitle(open)} testId="activity-sheet" likely>
        {open !== undefined && <RowFacts row={open} bucket={name} />}
      </ChoiceSheet>
      <RuleOfferSheet flow={flow} testId="offer-sheet" />

      <MoveMoney open={moving} onClose={() => setMoving(false)} balances={balances} start={{ from: pot, to: other }} onMoved={(text) => {
          setMoved({ tone: 'ok', text });
          reload('after');
          onChanged('after');
        }}
      />
    </>
  );
}

// What the tapped thing did to this bucket, and, when it cannot be sorted
// again, why.
function RowFacts({ row, bucket }: { readonly row: ActivityRow; readonly bucket: string }) {
  const r = row.resort;
  return (
    <>
      {!r.resortable && (
        <>
          <div className="card">
            <dl className="figures">
              <dt>{WHAT_WORDS[row.what]}</dt>
              <dd>
                <Money cents={row.amount} signed testId="sheet-row-amount" />
              </dd>
              <dt>When</dt>
              <dd>{shortDate(row.date)}</dd>
              {row.account !== null && (
                <>
                  <dt>Account</dt>
                  <dd>{ACCOUNT_NAMES[row.account]}</dd>
                </>
              )}
            </dl>
          </div>
          <Notice tone="warning" icon="info" testId="cannot-resort">
            {r.why}
          </Notice>
        </>
      )}
      {r.resortable && row.partOfSplit && (
        <Notice tone="warning" icon="info" testId="split-part">
          This row is only the part of a split purchase that is in {bucket}: {moneyText(row.amount)}. Sorting it again sorts the whole purchase.
        </Notice>
      )}
    </>
  );
}

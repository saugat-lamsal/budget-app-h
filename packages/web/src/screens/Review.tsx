import { useState } from 'react';
import type { PickTo, ReviewDetail } from '@budget-app/money';
import type { ReviewItemShown as KeyedDetail, ReviewShown as ReviewView } from '@budget-app/server/views';
import { newDecisionId, type Load, type Reload } from '../app/api.js';
import { Button, ButtonRow, Card, Decision, Hero, HeroCount, LinkButton, MadeUpPill, Money, Skeleton, StateMessage, SwipeSort } from '../ui/blocks.js';
import { longDate, shortDate } from '../ui/dates.js';
import { ChoiceSheet, LeftoverDecision, LikelyPurchases, RuleOfferSheet, SaidNotice, askFor, subjectOfReview, useChoiceFlow, type Choose, type Kind, type Pending, type Target } from './choose.js';
import { ACCOUNT_NAMES, changedWords, groupTitle, labeledText, pickLabel, reasonText, titleOf } from './review-text.js';

// Review: everything waiting for him to decide, one tap each. Every choice
// shown is one the money math offers for that kind of item (the server sends
// them with the item); the screen decides nothing. A tap sends the choice
// and the server's money math does the rest. The same decision sent twice
// changes nothing the second time, a refused choice changes nothing and says
// why, and anything final asks first. The choosing itself is shared with the
// lists of what went in and out of a bucket (choose.tsx).

export function ReviewScreen({ load, onRetry, onChanged }: { readonly load: Load<ReviewView>; readonly onRetry: Reload; readonly onChanged: Reload }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="review">
      <h1 className="sr-only">Review</h1>
      {load.status === 'loading' && <ReviewLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load what is waiting" detail="Check your connection, then try again." testId="review-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="bank" title="Nothing to review yet" detail="Setup day reads your bank balances and lets you hand out your starting money. New activity waits here after that." testId="review-not-set-up" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <ReviewReady view={load.value} reload={onRetry} onChanged={onChanged} />}
    </main>
  );
}

function ReviewLoading() {
  return (
    <div data-testid="review-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading what is waiting</span>
      <div className="hero" aria-hidden="true">
        <Skeleton width="9rem" height="1rem" />
        <Skeleton width="5rem" height="3rem" />
        <Skeleton width="14rem" height="1rem" />
      </div>
      <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
        <Skeleton width="60%" height="1rem" />
        <Skeleton width="80%" height="1rem" />
        <Skeleton width="50%" height="1rem" />
      </div>
    </div>
  );
}

type Tracking = Extract<ReviewView, { state: 'tracking' }>;

const targetOf = (detail: KeyedDetail): Target => ({ id: detail.item.id, label: titleOf(detail.item), kind: detail.item.type, seen: detail.key });

function ReviewReady({ view, reload, onChanged }: { readonly view: Tracking; readonly reload: Reload; readonly onChanged: Reload }) {
  const flow = useChoiceFlow({ resort: false, reload, onChanged, keys: new Map(view.items.map((d) => [d.item.id, d.key])), view });
  const { sheet, said, sending, setSaid, submit, choose, openSheet } = flow;
  // "Later" (a swipe to the left, or its button) only moves a card to the end
  // of the list on this screen. It answers nothing and sends nothing.
  const [later, setLater] = useState<readonly string[]>([]);

  const byId = new Map(view.items.map((d) => [d.item.id, d]));
  const open = sheet === null ? undefined : byId.get(sheet.item);

  const groups: { readonly type: Kind; readonly items: KeyedDetail[] }[] = [];
  for (const d of view.items) {
    const last = groups.at(-1);
    if (last?.type === d.item.type) last.items.push(d);
    else groups.push({ type: d.item.type, items: [d] });
  }
  // A card put off goes to the end of its own group.
  for (const g of groups) g.items.sort((x, y) => Number(later.includes(x.item.id)) - Number(later.includes(y.item.id)) || later.indexOf(x.item.id) - later.indexOf(y.item.id));

  const waiting = view.items.length;
  const putOff = waiting > 1 ? (id: string): void => setLater((l) => [...l.filter((x) => x !== id), id]) : undefined;
  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>

      {said !== null && sheet === null && <SaidNotice said={said} sending={sending} onRetry={submit} onDismiss={() => setSaid(null)} onOffer={flow.openOffer} sticky />}

      <Hero
        label="Waiting in review"
        testId="review-hero"
        sub={
          waiting === 0 ? (
            "You're all caught up."
          ) : view.heldBack > 0 ? (
            <span>
              <Money cents={view.heldBack} testId="held-back" /> held back from safe to spend until sorted.
            </span>
          ) : view.heldBack < 0 ? (
            // Money back that has not been sorted yet adds to safe to spend (11.1).
            <span>
              Safe to spend is <Money cents={-view.heldBack} testId="raised-by" /> higher until sorted.
            </span>
          ) : (
            'Nothing is held back from safe to spend.'
          )
        }
      >
        <HeroCount count={waiting} testId="review-count" />
      </Hero>

      {waiting === 0 && <StateMessage icon="check" title="All sorted" detail="New activity that needs a decision shows up here." testId="review-empty" />}

      {groups.map((group, i) => (
        <Card key={`${group.type}-${i}`} title={groupTitle(group.type)} testId={`group-${group.type}`}>
          {group.items.map((d) => (
            <ItemCard key={d.item.id} detail={d} busy={sending || flow.holding(d.item.id)} changed={flow.changed(d.item.id)} onChoose={choose} onSend={submit} onLater={putOff} onMore={() => openSheet(d.item.id)} />
          ))}
        </Card>
      ))}

      <ChoiceSheet flow={flow} itemId={open?.item.id} subject={open === undefined ? undefined : (subjectOfReview(open) ?? undefined)} title={open === undefined ? 'Choices' : titleOf(open.item)} testId="review-sheet" />
      <RuleOfferSheet flow={flow} testId="offer-sheet" />
    </>
  );
}

// ----- One waiting item -----

// The two choices shown on the item itself: the suggested one first, then
// the usual ones in order. The rest are under "More choices".
const USUAL: readonly PickTo[] = ['paycheck', 'other-income', 'needs', 'wants', 'savings'];

function quickPicks(detail: Pick<ReviewDetail, 'options' | 'item'>): { readonly to: PickTo; readonly final: boolean }[] {
  const o = detail.options;
  if (o.type !== 'sort') return [];
  const suggestion = detail.item.type === 'spending' ? detail.item.suggestion : null;
  const order = [...(suggestion === null ? [] : [suggestion]), ...USUAL];
  const found: { to: PickTo; final: boolean }[] = [];
  for (const to of order) {
    const pick = o.picks.find((p) => p.to === to);
    if (pick !== undefined && !found.some((f) => f.to === to)) found.push({ to, final: pick.final });
  }
  return found.slice(0, 2);
}

function ItemCard({
  detail,
  busy,
  changed,
  onChoose,
  onSend,
  onLater,
  onMore,
}: {
  readonly detail: KeyedDetail;
  readonly busy: boolean;
  // A32: the item changed when the screen read its numbers again.
  readonly changed: boolean;
  readonly onChoose: Choose;
  readonly onSend: (pending: Pending) => void;
  readonly onLater: ((id: string) => void) | undefined;
  readonly onMore: () => void;
}) {
  const { item, options } = detail;
  const testId = `item-${item.id}`;
  const where = detail.account === null ? '' : ` · ${ACCOUNT_NAMES[detail.account]}`;

  if (item.type === 'leftover' && options.type === 'leftover') return <LeftoverDecision detail={detail} busy={busy} changed={changed} onChoose={onChoose} />;
  const changedNote = changed && item.type !== 'leftover' ? changedWords(item.amount, detail.pending) : undefined;

  if (item.type === 'old-card-purchase') {
    return (
      <Decision
        testId={testId}
        title={titleOf(item)}
        amount={<Money cents={item.amount} testId="item-amount" />}
        detail={`${reasonText(item)} · ${shortDate(item.date)}${where}`}
        status={detail.pending ? 'pending' : undefined}
        changed={changedNote}
        actions={
          <Button
            wide
            disabled={busy}
            testId="acknowledge"
            onClick={() => onSend({ id: newDecisionId(), item: item.id, label: titleOf(item), kind: item.type, choice: { acknowledge: true }, seen: detail.key })}
          >
            Got it
          </Button>
        }
      >
        <p className="decision__detail">It raises the old card debt. It touches a bucket only when you pay it.</p>
      </Decision>
    );
  }

  if ((item.type === 'spending' || item.type === 'money-in') && options.type === 'sort') {
    const kind = item.type;
    const picks = quickPicks(detail);
    const subject = subjectOfReview(detail);
    // A swipe to the right does what the suggested button does, and only
    // when that button sends at once. Anything the button would ask about
    // first (a final choice, a paycheck) takes the button.
    const suggested = item.type === 'spending' && item.suggestion !== null && picks[0]?.to === item.suggestion ? picks[0] : undefined;
    const askedFirst = suggested === undefined || suggested.final || askFor(detail.paycheckPreview, item.date, suggested.to) !== undefined;
    const accept = suggested === undefined || askedFirst ? undefined : suggested;
    const later = onLater === undefined ? undefined : () => onLater(item.id);
    return (
      <SwipeSort
        busy={busy}
        rightLabel={accept === undefined ? undefined : pickLabel(kind, accept.to, true)}
        onRight={accept === undefined ? undefined : () => onChoose(targetOf(detail), { to: accept.to }, { final: accept.final, ask: askFor(detail.paycheckPreview, item.date, accept.to) })}
        onLater={later}
      >
      <Decision
        testId={testId}
        title={titleOf(item)}
        amount={<Money cents={item.amount} testId="item-amount" />}
        detail={`${reasonText(item)} · ${shortDate(item.date)}${where}`}
        status={detail.pending ? 'pending' : undefined}
        changed={changedNote}
        actions={
          <>
            <ButtonRow>
              {picks.map((pick, i) => (
                <Button
                  key={pick.to}
                  variant={i === 0 ? 'primary' : 'secondary'}
                  disabled={busy}
                  testId={`pick-${pick.to}`}
                  onClick={() => onChoose(targetOf(detail), { to: pick.to }, { final: pick.final, ask: askFor(detail.paycheckPreview, item.date, pick.to) })}
                >
                  {pickLabel(kind, pick.to, true)}
                </Button>
              ))}
            </ButtonRow>
            <ButtonRow>
              <Button variant="plain" onClick={onMore} disabled={busy} testId="more">
                More choices
              </Button>
              {later !== undefined && (
                <Button variant="plain" onClick={later} disabled={busy} testId="later">
                  Later
                </Button>
              )}
            </ButtonRow>
          </>
        }
      >
        {item.type === 'money-in' && subject !== null && (subject.refund || subject.likely.length > 0) && <LikelyPurchases subject={subject} busy={busy} onChoose={onChoose} />}
        {detail.labeled !== undefined && (
          <>
            <p className="decision__detail" data-testid="item-labeled">
              <span>{labeledText(detail.labeled)}</span>
            </p>
            <ButtonRow>
              <LinkButton href="/settings" variant="secondary" testId="item-labeled-settings">
                Bank rules on Settings
              </LinkButton>
            </ButtonRow>
          </>
        )}
      </Decision>
      </SwipeSort>
    );
  }
  return null;
}

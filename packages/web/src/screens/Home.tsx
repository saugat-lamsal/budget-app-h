import type { SelfCheck } from '@budget-app/money';
// Her setup (52.1): Home with each card, as her server sends it; upstream's has none.
import type { Attention, BankDetail, HomeWithCards as HomeView } from '@budget-app/server/views';
import { Fragment, useState } from 'react';
import { markTakeBackSeen, type Load, type Reload } from '../app/api.js';
import { activityPath, pathOf, setupPath, statementPath } from '../app/routes.js';
import { Banner, BottomSheet, BucketTile, Button, Card, CountTile, LinkButton, ListRow, MadeUpPill, Money, PeriodRing, ScrollHero, Skeleton, StateMessage, StatusLabel, Tiles } from '../ui/blocks.js';
import { asOfText, checkedAtText, longDate, shortDate } from '../ui/dates.js';
import { Icon } from '../ui/Icon.js';
import { cardNames, withCardNames } from '../ui/card-names.js';
import { WHY_NOT_SPENDING, cardName, cardStateText, inSavingsText, noStatementText, setAsideText } from './cards-text.js';
import { cardsOffText, dueText, onItsWayInText, paydayText, stillToSetText, waitingText } from './home-text.js';
import { WhyList } from './why.js';

// Home: safe to spend is the one main number. Below it, what needs
// attention, then needs and wants as compact bars.

export function HomeScreen({ load, onRetry }: { readonly load: Load<HomeView>; readonly onRetry: Reload }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="home">
      <h1 className="sr-only">Home</h1>
      {load.status === 'loading' && <HomeLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load your numbers" detail="Check your connection, then try again." testId="home-error">
          <Button onClick={onRetry} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage
            icon="bank"
            title="Not set up yet"
            detail="Setup day reads your bank balances and lets you hand out your starting money. Your numbers show here after that."
            testId="home-not-set-up"
          >
            <LinkButton href={setupPath('bank')} testId="start-setup">
              Start setup day
            </LinkButton>
          </StateMessage>
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <HomeReady view={load.value} onChanged={onRetry} />}
    </main>
  );
}

function HomeLoading() {
  return (
    <div data-testid="home-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading your numbers</span>
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

type Tracking = Extract<HomeView, { state: 'tracking' }>;
type TakeBack = Extract<Attention, { kind: 'bank-took-back' }>;

function HomeReady({ view, onChanged }: { readonly view: Tracking; readonly onChanged: () => void }) {
  const [sheet, setSheet] = useState<'check' | 'savings' | 'cards' | TakeBack | null>(null);
  const close = (): void => setSheet(null);
  const { safeToSpend, payday } = view;
  const savings = view.attention.find((a) => a.kind === 'move-to-savings');

  const paydayLine = (
    <p className="hero__sub" data-testid="payday">
      <span>{paydayText(payday.days)}</span>
      <span aria-hidden="true">·</span>
      <span>{shortDate(payday.next)}</span>
    </p>
  );

  const ring = <PeriodRing start={payday.periodStart} today={view.today} next={payday.next} testId="period-ring" />;

  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>

      {safeToSpend.shown ? (
        <ScrollHero labelledBy="safe-to-spend-label" ring={ring}>
          <h2 id="safe-to-spend-label" className="hero__label">
            Safe to spend
          </h2>
          <Money cents={safeToSpend.amount} hero roll testId="safe-to-spend" />
          {paydayLine}
        </ScrollHero>
      ) : safeToSpend.why === 'totals-do-not-match' && safeToSpend.catchingUp ? (
        // 10.4 (A47): a difference younger than the setting's hours, said calmly, with the amount.
        <Banner tone="warning" icon="clock" title="The bank is still catching up" testId="catching-up">
          <p className="banner__big">
            Off by <Money cents={Math.abs(safeToSpend.check.difference)} testId="mismatch-amount" /> for now
          </p>
          <p className="banner__body">
            The bank shows {safeToSpend.check.difference > 0 ? 'more' : 'less'} than your buckets add up to. This usually clears within a few hours; you get an alert if it lasts. Safe to spend is hidden until they match.
          </p>
          <Button variant="secondary" onClick={() => setSheet('check')} testId="see-check">
            See the numbers
          </Button>
          {paydayLine}
        </Banner>
      ) : safeToSpend.why === 'totals-do-not-match' ? (
        <Banner tone="danger" icon="alert" title="Totals do not match the bank" testId="mismatch">
          <p className="banner__big">
            Off by <Money cents={Math.abs(safeToSpend.check.difference)} testId="mismatch-amount" />
          </p>
          <p className="banner__body">
            The bank shows {safeToSpend.check.difference > 0 ? 'more' : 'less'} than your buckets add up to. Safe to spend is hidden until they match.
          </p>
          <Button variant="secondary" onClick={() => setSheet('check')} testId="see-check">
            See the numbers
          </Button>
          {paydayLine}
        </Banner>
      ) : safeToSpend.lastChecked !== null ? (
        // B82: the bank cannot be read; the last checked number, greyed, with when.
        <ScrollHero labelledBy="safe-to-spend-label" ring={ring} testId="stale">
          <h2 id="safe-to-spend-label" className="hero__label">
            Safe to spend
          </h2>
          <Money cents={safeToSpend.lastChecked.amount} hero stale testId="safe-to-spend-stale" />
          <p className="hero__stale" data-testid="as-of">
            <Icon name="clock" size={16} />
            <span>As of {asOfText(safeToSpend.lastChecked.at, view.timeZone)}. Can't reach {notReadWords(safeToSpend.notRead)} to check it now.</span>
          </p>
          {paydayLine}
        </ScrollHero>
      ) : (
        <Banner tone="warning" icon="alert" title="Can't check against the bank" testId="bank-not-read">
          <p className="banner__body">Safe to spend is hidden until the bank can be read again.</p>
          {paydayLine}
        </Banner>
      )}

      {view.checkedAt !== null && (
        // Step 3: when the bank was last read, in his home time zone.
        <p className="checked-at" data-testid="checked-at">
          <Icon name="clock" size={16} />
          <span>Checked at {checkedAtText(view.checkedAt.at, view.today, view.checkedAt.timeZone)}</span>
        </p>
      )}

      {view.onItsWayIn.length > 0 && (
        // 11.4: money still pending at the bank, counted when it posts.
        <Card title="On its way in" testId="on-its-way-in">
          {view.onItsWayIn.map((item, i) => {
            const words = onItsWayInText(item, view.today, view.timeZone);
            return <ListRow key={`${item.date} ${item.account} ${i}`} icon="clock" title={words.title} detail={words.detail} trailing={<Money cents={item.amount} testId={`on-its-way-in-${i}-amount`} />} testId={`on-its-way-in-${i}`} />;
          })}
        </Card>
      )}

      <Card title="Needs attention" testId="attention">
        {view.attention.length === 0 ? (
          <ListRow icon="check" tone="ok" title="Nothing needs you right now" testId="all-clear" />
        ) : (
          view.attention.map((item) => <AttentionRow key={rowKey(item)} item={item} onSavings={() => setSheet('savings')} onTakeBack={setSheet} />)
        )}
      </Card>

      <Tiles title="This pay period" testId="buckets">
        <BucketTile name="Wants" {...view.buckets.wants} href={activityPath('wants')} tall testId="bucket-wants" />
        <BucketTile name="Needs" {...view.buckets.needs} href={activityPath('needs')} testId="bucket-needs" />
        <CountTile name="To sort" count={view.waitingInReview} go="Review" href={pathOf('review')} testId="to-sort" />
      </Tiles>
      {view.cards !== undefined && <CardRows cards={view.cards} onWhy={() => setSheet('cards')} />}
      <Card testId="home-links">
        <ListRow title="All buckets" href={pathOf('buckets')} testId="all-buckets" />
        <ListRow title="Payday" detail="What your last paycheck did" href="/payday" testId="home-payday" />
      </Card>

      {!safeToSpend.shown && safeToSpend.why === 'totals-do-not-match' && (
        <BottomSheet open={sheet === 'check'} title="The daily check" onClose={close} testId="check-sheet">
          <CheckFigures check={safeToSpend.check} detail={safeToSpend.detail} timeZone={view.timeZone} />
        </BottomSheet>
      )}
      {savings !== undefined && savings.kind === 'move-to-savings' && (
        <BottomSheet open={sheet === 'savings'} title="Money for savings" onClose={close} testId="savings-sheet">
          <div className="card">
            <dl className="figures">
              <dt>Savings plus mom reserve</dt>
              <dd>
                <Money cents={savings.shouldBeInSavings} testId="savings-should" />
              </dd>
              <dt>In the savings account</dt>
              <dd>
                <Money cents={savings.savingsAccountBalance} testId="savings-holds" />
              </dd>
              {/* B46: money on its way to the account counts as moved. */}
              {savings.onItsWay > 0 && (
                <>
                  <dt>On its way to the account</dt>
                  <dd>
                    <Money cents={savings.onItsWay} testId="savings-on-its-way" />
                  </dd>
                </>
              )}
              <dt className="figures__total">Still to move</dt>
              <dd className="figures__total">
                <Money cents={savings.stillToMove} testId="savings-to-move" />
              </dd>
            </dl>
          </div>
          <p className="sheet__note">Move it from checking to savings in your bank's app. This app never moves money.</p>
        </BottomSheet>
      )}
      {view.cards !== undefined && (
        <BottomSheet open={sheet === 'cards'} title={WHY_NOT_SPENDING.title} onClose={close} testId="cards-sheet">
          {WHY_NOT_SPENDING.paragraphs.map((p) => (
            <p key={p} className="sheet__note">
              {p}
            </p>
          ))}
        </BottomSheet>
      )}
      {view.attention.map((item) =>
        item.kind === 'bank-took-back' ? (
          <TakeBackSheet
            key={item.id}
            item={item}
            open={typeof sheet === 'object' && sheet?.id === item.id}
            onClose={close}
            onSeen={() => {
              close();
              onChanged();
            }}
          />
        ) : null,
      )}
    </>
  );
}

// Her rulebook, 52.1 and 52.2: each card, what it owes and that all of it is
// set aside, where its payment stands in words, and a tap to its statement.
function CardRows({ cards, onWhy }: { readonly cards: NonNullable<Tracking['cards']>; readonly onWhy: () => void }) {
  return (
    <Card title="Your cards" testId="cards">
      {cards.cards.map((c) => (
        <ListRow
          key={c.card}
          icon="card"
          tone={c.statement.shown && c.statement.state.kind === 'overdue' ? 'danger' : c.statement.shown ? 'info' : 'warning'}
          title={
            c.statement.shown ? (
              <>
                {cardName(c.card)} · {c.statement.state.kind === 'overdue' ? <StatusLabel status="overdue" /> : cardStateText(c.statement.state, c.statement.dueDate)}
              </>
            ) : (
              cardName(c.card)
            )
          }
          detail={
            c.statement.shown ? (
              <>
                Statement <Money cents={c.statement.statementBalance} />, due {shortDate(c.statement.dueDate)}; <Money cents={c.statement.paid} /> paid toward it. {setAsideText(c.owes)}
              </>
            ) : (
              `${noStatementText(c.statement.why)} ${setAsideText(c.owes)}`
            )
          }
          trailing={<Money cents={c.owes} testId={`card-${c.card}-owes`} />}
          href={statementPath(c.card)}
          testId={`card-${c.card}`}
        />
      ))}
      {cards.inSavings !== null && cards.inSavings > 0 && <ListRow icon="move" title={inSavingsText(cards.inSavings)} testId="cards-in-savings" />}
      <ListRow icon="info" title={WHY_NOT_SPENDING.title} onClick={onWhy} testId="cards-why" />
    </Card>
  );
}

// 10.6: what the bank took back, until he says he has seen it (B84).
function TakeBackSheet({ item, open, onClose, onSeen }: { readonly item: TakeBack; readonly open: boolean; readonly onClose: () => void; readonly onSeen: () => void }) {
  const [saving, setSaving] = useState<'idle' | 'saving' | 'failed'>('idle');
  return (
    <BottomSheet open={open} title="Taken back by the bank" onClose={onClose} testId={`took-back-sheet-${item.id}`}>
      <div className="card">
        <dl className="figures">
          <dt>What</dt>
          <dd>{item.description}</dd>
          <dt>Amount</dt>
          <dd>
            <Money cents={item.amount} testId="took-back-amount" />
          </dd>
          <dt>When</dt>
          <dd>{shortDate(item.date)}</dd>
        </dl>
      </div>
      <p className="sheet__note">The bank removed this after the app had counted it, so the app took it back too: its money went back where it came from. The change log keeps a record.</p>
      {saving === 'failed' && (
        <p className="hero__stale" role="alert" data-testid="seen-failed">
          <Icon name="alert" size={16} />
          <span>Couldn't save that. Try again.</span>
        </p>
      )}
      <Button
        wide
        testId="seen"
        onClick={() => {
          if (saving === 'saving') return;
          setSaving('saving');
          markTakeBackSeen(item.id).then(
            () => {
              setSaving('idle');
              onSeen();
            },
            () => setSaving('failed'),
          );
        }}
      >
        {saving === 'saving' ? 'Saving…' : 'Got it'}
      </Button>
    </BottomSheet>
  );
}

// 12.3: bank side plus money in transit, minus app side.
// Her second card, and in her setup each card as its bank names it (HB6).
const ACCOUNT_NAMES = withCardNames({ checking: 'Checking', savings: 'Savings', 'everyday-card': 'Everyday card', 'second-card': 'Second card' } as const);
const accountWords = (account: BankDetail['accounts'][number]['account']): string => (account === 'checking' || account === 'savings' ? ACCOUNT_NAMES[account] : `${ACCOUNT_NAMES[account]} owes`);

function CheckFigures({ check, detail, timeZone }: { readonly check: SelfCheck; readonly detail: BankDetail | null; readonly timeZone: string }) {
  return (
    <>
      <div className="card">
        <dl className="figures">
          <dt>The bank: checking + savings − {cardNames() === null ? 'everyday card' : 'both cards'}</dt>
          <dd>
            <Money cents={check.bankSide} testId="check-bank" />
          </dd>
          <dt>Money on its way between your accounts</dt>
          <dd>
            <Money cents={check.inTransit} testId="check-transit" />
          </dd>
          <dt>Your buckets added up</dt>
          <dd>
            <Money cents={check.appSide} testId="check-app" />
          </dd>
          <dt className="figures__total">Difference</dt>
          <dd className="figures__total">
            <Money cents={check.difference} testId="check-difference" />
          </dd>
        </dl>
      </div>
      <p className="sheet__note">The bank plus money on its way should equal your buckets to the cent. Something the app has not seen, or has counted wrong, makes the difference.</p>
      {detail !== null && detail.why.length > 0 && (
        // 12.6 (A57): why, in lines that add up to the difference.
        <WhyList lines={detail.why} />
      )}
      {detail !== null && (
        // "Why it doesn't match" (docs/later.txt 18): each account as the bank gave it (12.1).
        <>
          <div className="card" data-testid="check-accounts">
            <dl className="figures">
              {detail.accounts.map((a) => (
                <Fragment key={a.account}>
                  <dt>{accountWords(a.account)}, posted</dt>
                  <dd>
                    <Money cents={a.posted} testId={`check-${a.account}-posted`} />
                  </dd>
                  {a.available !== null && (
                    <>
                      <dt>{accountWords(a.account)}, available</dt>
                      <dd>
                        <Money cents={a.available} testId={`check-${a.account}-available`} />
                      </dd>
                    </>
                  )}
                  <dt className="figures__total">{accountWords(a.account)}, counted</dt>
                  <dd className="figures__total">
                    <Money cents={a.counted} testId={`check-${a.account}-counted`} />
                  </dd>
                </Fragment>
              ))}
            </dl>
          </div>
          <p className="sheet__note">
            Checking and savings count what the bank shows as available, with transfers and payments still pending put back; the card counts what it owes plus pending charges. The bank's posted balance can lag its own transactions for hours.
          </p>
          {detail.since !== null && (
            <p className="sheet__note" data-testid="check-since">
              The difference began {asOfText(detail.since, timeZone)}.
            </p>
          )}
        </>
      )}
    </>
  );
}

// Her rulebook, 0.5 (PR 6): the banks that could not be read, by name; "the bank" in upstream's setup.
function notReadWords(names: readonly string[] | undefined): string {
  if (names === undefined || names.length === 0) return 'the bank';
  return names.length === 1 ? (names[0] ?? 'the bank') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

function rowKey(item: Attention): string {
  if (item.kind === 'card-due' || item.kind === 'card-overdue' || item.kind === 'card-reminders-off') return `${item.kind}-${item.card}`;
  if (item.kind === 'bank-took-back' || item.kind === 'paycheck-waiting') return `${item.kind}-${item.id}`;
  // Her setup (PR 6): each bank's own row.
  if (item.kind === 'bank-login' && item.bank !== undefined) return `${item.kind}-${item.bank}`;
  return item.kind;
}

const CARD_NAMES = withCardNames({ 'everyday-card': 'Everyday card', 'old-card': 'Old card', 'second-card': 'Second card' } as const);

function AttentionRow({ item, onSavings, onTakeBack }: { readonly item: Attention; readonly onSavings: () => void; readonly onTakeBack: (item: TakeBack) => void }) {
  const testId = `attention-${rowKey(item)}`;
  switch (item.kind) {
    case 'bank-took-back':
      return (
        <ListRow
          icon="undo"
          tone="warning"
          title="The bank took back a transaction"
          detail={
            <>
              {item.description}, <Money cents={item.amount} />, on {shortDate(item.date)}.
            </>
          }
          onClick={() => onTakeBack(item)}
          testId={testId}
        />
      );
    case 'bank-login':
      return <ListRow icon="lock" tone="warning" title={item.name === undefined ? 'Log in to the bank again' : `Log in to ${item.name} again`} detail="New activity can't come in until you do." testId={testId} />;
    case 'card-overdue':
      return (
        <ListRow
          icon="alert"
          tone="danger"
          title={
            <>
              {CARD_NAMES[item.card]} payment <StatusLabel status="overdue" />
            </>
          }
          detail={
            <>
              Minimum <Money cents={item.minimumPayment} /> was due {shortDate(item.dueDate)}.
            </>
          }
          testId={testId}
        />
      );
    case 'card-reminders-off': {
      // 9.8 (A52): never dropped without a word. The days on Settings turn them on when the date is what is missing.
      const words = cardsOffText(item);
      return <ListRow icon="alert" tone="warning" title={words.title} detail={words.detail} {...(item.why === 'no-statement-date' ? { href: pathOf('settings') } : {})} testId={testId} />;
    }
    // Her rulebook, 51.1: nothing is split until she says yes in Review.
    case 'paycheck-waiting':
      return (
        <ListRow
          icon="review"
          title="Paycheck waiting for your yes"
          detail={
            <>
              <Money cents={item.amount} testId="paycheck-waiting-amount" /> came in {shortDate(item.date)}
              {item.early ? ', less than 10 days after your last one' : ''}. Nothing is split until you say yes.
            </>
          }
          href={pathOf('review')}
          testId={testId}
        />
      );
    case 'review':
      return (
        <ListRow
          icon="tray"
          title={waitingText(item.waiting)}
          detail={
            item.heldBack > 0 ? (
              <>
                <Money cents={item.heldBack} testId="held-back" /> held back from safe to spend until sorted.
              </>
            ) : (
              'Sort them when you have a minute.'
            )
          }
          href={pathOf('review')}
          testId={testId}
        />
      );
    case 'still-to-set': {
      const words = stillToSetText(item.settings);
      return <ListRow icon="settings" title={words.title} detail={words.detail} href={pathOf('settings')} testId={testId} />;
    }
    case 'move-to-savings':
      return (
        <ListRow
          icon="move"
          title={
            <>
              Move <Money cents={item.stillToMove} testId="move-amount" /> to savings
            </>
          }
          detail="Your savings account holds less than it should."
          onClick={onSavings}
          testId={testId}
        />
      );
    case 'card-due':
      return (
        <ListRow
          icon="card"
          title={`${CARD_NAMES[item.card]} ${dueText(item.daysLeft)}`}
          detail={
            item.card !== 'old-card' ? (
              <>
                {shortDate(item.dueDate)}. Statement <Money cents={item.statementBalance} />, minimum <Money cents={item.minimumPayment} />.
              </>
            ) : (
              <>
                {shortDate(item.dueDate)}. Minimum <Money cents={item.minimumPayment} />.
              </>
            )
          }
          testId={testId}
        />
      );
  }
}

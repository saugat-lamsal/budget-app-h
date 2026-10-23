import type { Cents } from '@budget-app/money';
import type { Landing, PlaceGroup, TrendsItem, TrendsPart, TrendsPeriodShown as TrendsPeriod, TrendsShown as TrendsView } from '@budget-app/server/views';
import { useState, type CSSProperties } from 'react';
import type { Load, Reload } from '../app/api.js';
import { BottomSheet, Button, Card, Hero, ListRow, MadeUpPill, Money, Segmented, Skeleton, StateMessage, StatusLabel } from '../ui/blocks.js';
import { ChartLegend, CompareBars, DateChart, LineChart, StackedBars } from '../ui/charts.js';
import { dayWithYear, monthDay, shortDate } from '../ui/dates.js';
import { moneyWords } from '../ui/money-format.js';
import { CheckBanner } from './check-banner.js';
import {
  barWords,
  dayOfText,
  landingWords,
  mostWords,
  oldCardWords,
  paceWords,
  partName,
  paydayEffectWords,
  periodNote,
  periodRange,
  periodShort,
  placeGroupName,
  repeatWords,
  savingsWords,
  sinceText,
  streakWords,
  usualLines,
  waitingWords,
  weekdayName,
} from './trends-text.js';

// The Trends tab (rulebook section 40, QUESTIONS.md A58, A59): Past, what was
// spent each pay period, savings over time and where it went; Now, this pay
// period against your usual and Wants against an even pace; Future, where
// the buckets land by payday, savings a year out and the old card's plan,
// each an estimate and marked so; Habits, the payday effect, the days of the
// week, repeat charges and the Wants streak. Every number is the server's,
// worked out from the books and the bank history kept from before setup day.
// It only reads and never sends anything. The one main number is what was
// spent so far this pay period.

const PARTS: readonly TrendsPart[] = ['needs', 'wants', 'old-card', 'unsorted'];

// "Off in this setup": with no old card there is no old card part (40.2, 40.4),
// and nothing is said about leaving its payments out.
const oldCardOn = (view: Tracking): boolean => view.future.oldCard !== undefined;
const partsOf = (period: TrendsPeriod): readonly TrendsPart[] => PARTS.filter((part) => period.spent[part] !== undefined);
type Segment = 'past' | 'now' | 'future' | 'habits';
type Tracking = Extract<TrendsView, { state: 'tracking' }>;
// What a tap on a habit opens: the items behind it, adding up to its total.
interface ItemsList {
  readonly title: string;
  readonly totalLabel: string;
  // What the server added up; none for a repeat charge (its charges are listed, each with its amount).
  readonly total?: Cents;
  readonly note?: string;
  readonly items: readonly TrendsItem[];
}
type Sheet = { readonly kind: 'period'; readonly index: number } | { readonly kind: 'place'; readonly index: number } | { readonly kind: 'items'; readonly list: ItemsList } | null;

export function TrendsScreen({ load, onRetry }: { readonly load: Load<TrendsView>; readonly onRetry: Reload }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="trends">
      {load.status === 'loading' && <TrendsLoading />}
      {load.status === 'error' && (
        <>
          <h1 className="sr-only">Trends</h1>
          <StateMessage icon="alert" tone="danger" title="Couldn't load Trends" detail="Check your connection, then try again." testId="trends-error">
            <Button onClick={() => onRetry()} testId="retry">
              Try again
            </Button>
          </StateMessage>
        </>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          <h1 className="sr-only">Trends</h1>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="trends" title="No trends yet" detail="Trends starts after setup day. It shows what you spent each pay period, your savings over time, and where your money went." testId="trends-not-set-up" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <TrendsReady view={load.value} />}
    </main>
  );
}

function TrendsLoading() {
  return (
    <div data-testid="trends-loading" style={{ display: 'contents' }}>
      <h1 className="sr-only">Trends</h1>
      <span className="sr-only">Loading Trends</span>
      <div className="hero" aria-hidden="true">
        <Skeleton width="9rem" height="1rem" />
        <Skeleton width="12rem" height="3rem" />
      </div>
      <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
        <Skeleton width="50%" height="1rem" />
        <Skeleton width="100%" height="8rem" />
      </div>
    </div>
  );
}

function TrendsReady({ view }: { readonly view: Tracking }) {
  const [segment, setSegment] = useState<Segment>('past');
  const [picked, setPicked] = useState(view.periods.length - 1);
  const [sheet, setSheet] = useState<Sheet>(null);
  const here = view.periods[view.periods.length - 1] as TrendsPeriod;
  const sheetPeriod = sheet?.kind === 'period' ? view.periods[sheet.index] : undefined;
  const sheetPlace = sheet?.kind === 'place' ? view.places.groups[sheet.index] : undefined;
  const sheetList = sheet?.kind === 'items' ? sheet.list : undefined;
  return (
    <>
      <div className="eyebrow">
        <span data-testid="trends-since">{sinceText(view.historyFrom, view.setupDay)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>
      <h1 className="screen-title">Trends</h1>

      <CheckBanner check={view.check} />

      <Hero label="Spent this pay period" testId="trends-hero" sub={<span data-testid="trends-hero-sub">{periodRange(here)}, so far.{oldCardOn(view) ? ' Old card payments left out.' : ''}</span>}>
        <Money cents={view.now.spentSoFar} hero roll testId="trends-spent-so-far" />
      </Hero>

      <Segmented<Segment>
        label="Show"
        options={[
          { value: 'past', label: 'Past' },
          { value: 'now', label: 'Now' },
          { value: 'future', label: 'Future' },
          { value: 'habits', label: 'Habits' },
        ]}
        value={segment}
        onChange={setSegment}
        testId="trends-segment"
      />

      {/* Each part is keyed, so switching to it comes in with the screen's own rise. */}
      {segment === 'past' && (
        <Past
          key="past"
          view={view}
          picked={picked}
          onPick={(index) => {
            setPicked(index);
            setSheet({ kind: 'period', index });
          }}
          onPlace={(index) => setSheet({ kind: 'place', index })}
        />
      )}
      {segment === 'now' && <Now key="now" view={view} />}
      {segment === 'future' && <Future key="future" view={view} />}
      {segment === 'habits' && <Habits key="habits" view={view} onList={(list) => setSheet({ kind: 'items', list })} />}

      <BottomSheet open={sheetPeriod !== undefined} title={sheetPeriod === undefined ? 'Pay period' : periodRange(sheetPeriod)} onClose={() => setSheet(null)} testId="period-sheet">
        {sheetPeriod !== undefined && <PeriodDetail period={sheetPeriod} />}
      </BottomSheet>
      <BottomSheet open={sheetPlace !== undefined} title={sheetPlace === undefined ? 'Place' : placeGroupName(sheetPlace)} onClose={() => setSheet(null)} testId="place-sheet">
        {sheetPlace !== undefined && <PlaceDetail group={sheetPlace} />}
      </BottomSheet>
      <BottomSheet open={sheetList !== undefined} title={sheetList?.title ?? 'Items'} onClose={() => setSheet(null)} testId="habit-sheet">
        {sheetList !== undefined && <ListDetail list={sheetList} />}
      </BottomSheet>
    </>
  );
}

// ----- Past -----

function Past({ view, picked, onPick, onPlace }: { readonly view: Tracking; readonly picked: number; readonly onPick: (index: number) => void; readonly onPlace: (index: number) => void }) {
  const selected = view.periods[Math.min(picked, view.periods.length - 1)] as TrendsPeriod;
  const note = periodNote(selected);
  const anyBefore = view.periods.some((p) => p.beforeSetup !== 'none');
  return (
    <>
      <Card title="Spent each pay period" padded testId="trends-periods">
        <div className="trend-total">
          <span data-testid="period-range">{periodRange(selected)}</span>
          <span className="trend-total__amount">
            <Money cents={selected.total} roll testId="period-total" />
          </span>
        </div>
        {note !== null && (
          <p className="trend-note" data-testid="period-note">
            {note}
          </p>
        )}
        <StackedBars
          label="Spent each pay period. Tap a pay period to see what is in it."
          testId="period-bar"
          onPick={(key) => onPick(Number(key))}
          bars={view.periods.map((p, i) => ({
            key: String(i),
            label: periodShort(p),
            words: barWords(p),
            parts: partsOf(p).map((part) => ({ tone: part, cents: p.spent[part] ?? 0 })),
            lighter: p.beforeSetup === 'all',
            selected: p === selected,
          }))}
        />
        <ChartLegend items={partsOf(selected).map((part) => ({ tone: part, label: partName(part) }))} />
        <div className="list" data-testid="period-parts">
          {partsOf(selected).map((part) => (
            <ListRow key={part} title={partName(part)} trailing={<Money cents={selected.spent[part] ?? 0} testId={`period-part-${part}`} />} testId={`period-part-row-${part}`} />
          ))}
        </div>
        {anyBefore && <p className="trend-note">Pay periods before setup day ({monthDay(view.setupDay)}) are read from the bank&rsquo;s history by today&rsquo;s rules, drawn lighter. Your books do not change.</p>}
      </Card>

      <Savings view={view} />

      <Card title="Where it went · last 90 days" padded testId="trends-places">
        {view.places.groups.length === 0 ? (
          <p className="trend-note" data-testid="places-empty">
            Nothing spent in the last 90 days.
          </p>
        ) : (
          <>
            <div className="list">
              {view.places.groups.map((g, i) => (
                <ListRow
                  key={`${g.kind}-${g.name}`}
                  title={placeGroupName(g)}
                  detail={
                    <span className="place-bar" aria-hidden="true">
                      <span className="place-bar__fill" style={{ display: 'block', width: `${share(g.amount, view.places.groups)}%` }} />
                    </span>
                  }
                  trailing={<Money cents={g.amount} testId={`place-amount-${i}`} />}
                  onClick={() => onPlace(i)}
                  testId={`place-${i}`}
                />
              ))}
            </div>
            <div className="trend-total" style={{ marginTop: 'var(--space-3)' }}>
              <span>
                In all, {monthDay(view.places.from)} – {monthDay(view.places.to)}
              </span>
              <Money cents={view.places.total} testId="places-total" />
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function share(amount: number, groups: readonly PlaceGroup[]): number {
  const most = Math.max(1, ...groups.map((g) => g.amount));
  return Math.max(0, Math.min(100, (amount / most) * 100));
}

function Savings({ view }: { readonly view: Tracking }) {
  const now = view.savings[view.savings.length - 1];
  if (now === undefined) return null;
  const first = view.savings[0] ?? now;
  // "Off in this setup": with no mom reserve, savings alone (40.5).
  const reserveNow = now.momReserve;
  return (
    <Card title="Savings" padded testId="trends-savings">
      <div className="list">
        <ListRow title="Savings" trailing={<Money cents={now.savings} testId="savings-now" />} />
        {reserveNow !== undefined && <ListRow title="Mom reserve" trailing={<Money cents={reserveNow} testId="mom-now" />} />}
      </div>
      <LineChart
        testId="savings-chart"
        length={view.savings.length}
        label={`Savings from ${moneyWords(first.savings)} on ${monthDay(first.date)} to ${moneyWords(now.savings)} now${reserveNow === undefined ? '' : `; the mom reserve from ${moneyWords(first.momReserve ?? 0)} to ${moneyWords(reserveNow)}`}.`}
        lines={[
          { key: 'savings', tone: 'savings', values: view.savings.map((p) => p.savings), area: true },
          ...(reserveNow === undefined ? [] : [{ key: 'mom', tone: 'mom' as const, values: view.savings.map((p) => p.momReserve ?? 0), dashed: true }]),
        ]}
      />
      <ChartLegend
        items={[
          { tone: 'savings', label: 'Savings' },
          ...(reserveNow === undefined ? [] : [{ tone: 'mom' as const, label: 'Mom reserve', dashed: true }]),
        ]}
      />
      <p className="trend-note">Since setup day ({monthDay(view.setupDay)}), at the end of each pay period. Nothing before: the buckets did not exist then.</p>
    </Card>
  );
}

// ----- Now -----

function Now({ view }: { readonly view: Tracking }) {
  const w = view.now.wants;
  const words = paceWords(w.pace);
  const usual = usualLines(view.now.usual, view.now.day, oldCardOn(view));
  const length = Math.max(w.line.length, w.pace.state === 'pace' ? w.pace.points.length : 0);
  return (
    <>
      <Card title="Wants against an even pace" padded testId="trends-pace">
        <ListRow icon={words.icon} tone={words.tone} title={<span data-testid="pace-words">{words.title}</span>} detail={<span data-testid="pace-day">{dayOfText(w.day, w.days)}</span>} />
        <LineChart
          testId="pace-chart"
          length={length}
          label={`Wants left each day of this pay period, ending at ${moneyWords(w.left)} today${w.pace.state === 'pace' ? `, against an even pace that leaves ${moneyWords(w.pace.today)} today` : ''}.`}
          lines={[
            ...(w.pace.state === 'pace' ? [{ key: 'pace', tone: 'pace' as const, values: w.pace.points.map((p) => p.left), dashed: true }] : []),
            { key: 'wants', tone: 'wants', values: w.line.map((p) => p.left), area: true },
          ]}
        />
        <ChartLegend
          items={[
            { tone: 'wants', label: 'Wants left' },
            ...(w.pace.state === 'pace' ? [{ tone: 'pace' as const, label: 'Even pace', dashed: true }] : []),
          ]}
        />
        <div className="list">
          <ListRow title="Wants holds now" trailing={<Money cents={w.left} testId="pace-left" />} />
          {w.pace.state === 'pace' && <ListRow title="An even pace leaves today" trailing={<Money cents={w.pace.today} testId="pace-today" />} />}
          <ListRow title="Wants started this pay period with" trailing={<Money cents={w.startedWith} testId="pace-started" />} />
        </div>
        <p className="trend-note">Spending waiting in Review is not in Wants until it is sorted, so this is not safe to spend.</p>
      </Card>

      <Card title="This pay period against your usual" padded testId="trends-usual">
        <div className="list">
          <ListRow title={`So far, day ${view.now.day}`} trailing={<Money cents={view.now.spentSoFar} testId="usual-so-far" />} />
          {view.now.usual.state === 'known' && (
            <>
              <ListRow title={`Usual by day ${view.now.day}`} trailing={<Money cents={view.now.usual.byToday} testId="usual-by-today" />} />
              <ListRow title="A whole pay period usually" trailing={<Money cents={view.now.usual.whole} testId="usual-whole" />} />
            </>
          )}
        </div>
        <p className="trend-note" data-testid="usual-note">
          {view.now.usual.state === 'known' ? usual[2] : `${usual[0]} ${usual[1]}`}
        </p>
      </Card>
    </>
  );
}

// ----- Future (40.11 to 40.13): every amount here is an estimate -----

function Future({ view }: { readonly view: Tracking }) {
  const { landing, savings, oldCard } = view.future;
  const waiting = waitingWords(landing.waitingInReview);
  const [rangeTitle, rangeNote] = savingsWords(savings);
  return (
    <>
      <Card title="By payday" padded testId="future-landing">
        <div className="trend-head">
          <span>Where each lands by {monthDay(landing.nextPayday)}</span>
          <StatusLabel status="estimate" />
        </div>
        <LandingRow name="Needs" landing={landing.needs} testId="landing-needs" />
        <LandingRow name="Wants" landing={landing.wants} testId="landing-wants" />
        {waiting !== null && (
          <p className="trend-note" data-testid="landing-waiting">
            {waiting}
          </p>
        )}
        <p className="trend-note">At this pay period’s pace{oldCardOn(view) ? ', old card payments left out' : ''}. Never a promise.</p>
      </Card>

      <Card title="Savings a year out" padded testId="future-savings">
        <div className="trend-head">
          <span data-testid="savings-range-words">{rangeTitle}</span>
          {savings.state === 'estimate' && <StatusLabel status="estimate" />}
        </div>
        {savings.state === 'estimate' && (
          <>
            <p className="trend-range">
              <Money cents={savings.low} roll testId="savings-low" />
              <span className="trend-range__to">to</span>
              <Money cents={savings.high} roll testId="savings-high" />
            </p>
            <DateChart
              testId="savings-range-chart"
              today={view.today}
              label={`Savings so far, then an estimate a year out: ${moneyWords(savings.low)} to ${moneyWords(savings.high)} by ${dayWithYear(savings.to)}.`}
              series={[{ key: 'savings', tone: 'savings', area: true, points: view.savings.map((p) => ({ date: p.date, value: p.savings })) }]}
              band={{ tone: 'savings', points: [{ date: view.today, low: savings.now, high: savings.now }, ...savings.points] }}
            />
            <ChartLegend
              items={[
                { tone: 'savings', label: 'Savings so far' },
                { tone: 'savings', label: 'Estimate, low to high', dashed: true },
              ]}
            />
          </>
        )}
        <div className="list">
          <ListRow title="Savings now" trailing={<Money cents={savings.now} roll testId="savings-year-now" />} />
        </div>
        <p className="trend-note" data-testid="savings-range-note">
          {rangeNote}
        </p>
      </Card>

      {oldCard !== undefined && <OldCardFuture view={view} oldCard={oldCard} />}
    </>
  );
}

// 40.13; not there with the old card off ("Off in this setup").
function OldCardFuture({ view, oldCard }: { readonly view: Tracking; readonly oldCard: NonNullable<Tracking['future']['oldCard']> }) {
  const owedNow = oldCard.owed[oldCard.owed.length - 1];
  const plan = oldCard.plan;
  return (
    <>
      <Card title="The old card" padded testId="future-old-card">
        <div className="trend-head">
          <span>Owes now</span>
          {plan.state === 'plan' && <StatusLabel status="estimate" />}
        </div>
        {owedNow !== undefined && (
          <p className="trend-range">
            <Money cents={owedNow.owed} roll testId="old-card-owes" />
          </p>
        )}
        {(oldCard.owed.length > 1 || plan.state === 'plan') && (
          <>
            <DateChart
              testId="old-card-chart"
              today={view.today}
              label={`What the old card owed since setup day${plan.state === 'plan' ? `, then the plan down to $0.00 by ${dayWithYear(plan.paidOffBy)}` : ''}.`}
              series={[
                { key: 'owed', tone: 'needs', points: oldCard.owed.map((p) => ({ date: p.date, value: p.owed })) },
                ...(plan.state === 'plan' ? [{ key: 'plan', tone: 'savings' as const, dashed: true, area: true, points: plan.points.map((p) => ({ date: p.date, value: p.owed })) }] : []),
              ]}
            />
            <ChartLegend items={[{ tone: 'needs', label: 'Owed so far' }, ...(plan.state === 'plan' ? [{ tone: 'savings' as const, label: 'The plan', dashed: true }] : [])]} />
          </>
        )}
        {plan.state === 'plan' && (
          <div className="list">
            <ListRow title="Each payday" trailing={<Money cents={plan.perPayday} roll testId="old-card-share" />} />
            <ListRow title="Paydays left" trailing={<span data-testid="old-card-paydays">{plan.paydaysLeft}</span>} />
          </div>
        )}
        <p className="trend-note" data-testid="old-card-words">
          {oldCardWords(plan)}
        </p>
      </Card>
    </>
  );
}

// 40.11: in words, and a bar from what it holds now to where it lands.
function LandingRow({ name, landing, testId }: { readonly name: string; readonly landing: Landing; readonly testId: string }) {
  const words = landingWords(name, landing);
  return (
    <div className="landing" data-testid={testId} data-state={landing.state}>
      <ListRow icon={words.icon} tone={words.tone} title={<span data-testid={`${testId}-words`}>{words.title}</span>} detail={words.detail} />
      {landing.state === 'estimate' && landing.holds > 0 && (
        <>
          <span className="landing__bar" aria-hidden="true">
            <span className="landing__fill" style={{ width: `${Math.max(0, Math.min(100, (landing.lands / landing.holds) * 100)).toFixed(2)}%` }} />
          </span>
          <span className="landing__ends">
            <span>
              Now <Money cents={landing.holds} testId={`${testId}-holds`} />
            </span>
            <span>
              By payday <Money cents={landing.lands} roll testId={`${testId}-lands`} />
            </span>
          </span>
        </>
      )}
    </div>
  );
}

// ----- Habits (40.14 to 40.17) -----

function Habits({ view, onList }: { readonly view: Tracking; readonly onList: (list: ItemsList) => void }) {
  const { paydayEffect, weekdays, repeats, streak } = view.habits;
  const effect = paydayEffectWords(paydayEffect);
  return (
    <>
      <Card title="The payday effect" padded testId="habit-payday">
        {paydayEffect.state === 'known' ? (
          <>
            <CompareBars
              testId="payday-effect"
              onPick={(key) => {
                const side = key === 'first' ? paydayEffect.first : paydayEffect.rest;
                onList({ title: key === 'first' ? 'Payday and the 2 days after' : 'The rest of the pay period', totalLabel: `In all, over ${side.days} days`, total: side.total, items: side.items });
              }}
              bars={[
                { key: 'first', tone: 'needs', title: 'Payday and the 2 days after', cents: paydayEffect.first.perDay, amount: <PerDay cents={paydayEffect.first.perDay} testId="payday-first" /> },
                { key: 'rest', tone: 'wants', title: 'The rest of the pay period', cents: paydayEffect.rest.perDay, amount: <PerDay cents={paydayEffect.rest.perDay} testId="payday-rest" /> },
              ]}
            />
            <p className="trend-note" data-testid="payday-effect-words">
              {effect[2]}
            </p>
          </>
        ) : (
          <p className="trend-note" data-testid="payday-effect-words">
            {effect.join('. ')}
          </p>
        )}
      </Card>

      <Card title="Day of the week · last 90 days" padded testId="habit-weekdays">
        <p className="trend-note" data-testid="weekday-most">
          {mostWords(weekdays)}
        </p>
        <CompareBars
          testId="weekday"
          onPick={(key) => {
            const d = weekdays.days.find((x) => String(x.weekday) === key);
            if (d !== undefined) onList({ title: `${weekdayName(d.weekday)}s`, totalLabel: `In all, over ${d.days} ${weekdayName(d.weekday)}s`, total: d.total, items: d.items });
          }}
          bars={weekdays.days.map((d) => ({
            key: String(d.weekday),
            tone: d.weekday === weekdays.most ? 'savings' : 'needs',
            title: d.weekday === weekdays.most ? `${weekdayName(d.weekday)} · the most` : weekdayName(d.weekday),
            cents: d.average,
            amount: <Money cents={d.average} roll testId={`weekday-average-${d.weekday}`} />,
          }))}
        />
        <p className="trend-note">An average one: what was spent on that weekday, divided by how many of it the 90 days hold.</p>
      </Card>

      <Card title="Repeat charges" padded testId="habit-repeats">
        {repeats.length === 0 ? (
          <p className="trend-note" data-testid="repeats-empty">
            No repeat charges spotted. One shows after 3 charges from the same place, a steady week, 2 weeks or month apart.
          </p>
        ) : (
          <div className="list">
            {repeats.map((r, i) => {
              const words = repeatWords(r);
              return (
                <ListRow
                  key={r.name}
                  icon="clock"
                  title={r.name}
                  detail={
                    <>
                      <span className="row__line">
                        {words.often} · {words.next}
                      </span>
                      <span className="row__line" data-testid={`repeat-year-${i}`}>
                        {words.year}
                      </span>
                    </>
                  }
                  trailing={<Money cents={r.newestAmount} testId={`repeat-amount-${i}`} />}
                  onClick={() => onList({ title: r.name, totalLabel: `${r.items.length} charges`, note: `${words.often}. The newest on ${monthDay(r.newestDate)}.`, items: r.items })}
                  testId={`repeat-${i}`}
                />
              );
            })}
          </div>
        )}
        <p className="trend-note">Only pointed out: nothing is changed or cancelled.</p>
      </Card>

      <Card title="The Wants streak" padded testId="habit-streak">
        {streak.ended > 0 && (
          <div className="streak" aria-hidden="true">
            <span className="streak__count">{streak.current}</span>
            <span className="streak__pips">
              {Array.from({ length: Math.min(Math.max(streak.best, streak.current), 12) }, (_, k) => (
                <span key={k} className={`streak__pip${k < streak.current ? ' is-on' : ''}`} style={{ '--i': k } as CSSProperties} />
              ))}
            </span>
          </div>
        )}
        <p className="trend-note" data-testid="streak-words">
          {streakWords(streak)}
        </p>
      </Card>
    </>
  );
}

function PerDay({ cents, testId }: { readonly cents: Cents; readonly testId: string }) {
  return (
    <>
      <Money cents={cents} roll testId={testId} />
      <span className="cbar__per"> a day</span>
    </>
  );
}

// ----- What is behind a bar, a place, or a habit -----

function Items({ items, testId }: { readonly items: readonly TrendsItem[]; readonly testId: string }) {
  if (items.length === 0) return <p className="sheet__note">Nothing spent.</p>;
  return (
    <div className="list" data-testid={testId}>
      {items.map((item) => (
        <ListRow
          key={`${item.id}-${item.part}`}
          title={item.description === '' ? 'No longer in your books' : item.description}
          detail={`${shortDate(item.date)} · ${partName(item.part)}${item.beforeSetup ? ' · before setup day' : ''}`}
          trailing={<Money cents={item.amount} testId={`${testId}-amount-${item.id}-${item.part}`} />}
          testId={`${testId}-${item.id}-${item.part}`}
        />
      ))}
    </div>
  );
}

function PeriodDetail({ period }: { readonly period: TrendsPeriod }) {
  const note = periodNote(period);
  return (
    <>
      {note !== null && <p className="sheet__note">{note}</p>}
      <div className="list">
        {partsOf(period).map((part) => (
          <ListRow key={part} title={partName(part)} trailing={<Money cents={period.spent[part] ?? 0} testId={`sheet-part-${part}`} />} />
        ))}
        <ListRow title="In all" trailing={<Money cents={period.total} testId="sheet-total" />} />
      </div>
      <Items items={period.items} testId="sheet-item" />
    </>
  );
}

function ListDetail({ list }: { readonly list: ItemsList }) {
  return (
    <>
      {list.note !== undefined && <p className="sheet__note">{list.note}</p>}
      <div className="list">
        <ListRow title={list.totalLabel} trailing={list.total === undefined ? undefined : <Money cents={list.total} testId="habit-sheet-total" />} />
      </div>
      <Items items={list.items} testId="habit-item" />
    </>
  );
}

function PlaceDetail({ group }: { readonly group: PlaceGroup }) {
  return (
    <>
      <div className="list">
        <ListRow title="In the last 90 days" trailing={<Money cents={group.amount} testId="place-sheet-total" />} />
      </div>
      <Items items={group.items} testId="place-item" />
    </>
  );
}

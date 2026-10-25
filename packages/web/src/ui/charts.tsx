import type { Cents, IsoDate } from '@budget-app/money';
import { curveMonotoneX } from '@visx/curve';
import { scaleLinear, scaleUtc } from '@visx/scale';
import { Area, LinePath } from '@visx/shape';
import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';

// The charts, on the Trends tab only (design rules). Each one draws numbers
// the server worked out and the screen also says in words: a bar is a button
// whose label says every amount, and a line's card says where it ends. They
// grow and draw in quickly (base.css turns it off with reduced motion). The
// lines and areas are drawn with @visx (pinned; plain SVG, nothing written
// into a style element, so the content policy is unchanged); the motion is
// the stylesheet's: a line draws in, its area wipes in from the left, and its
// end gets one soft ping. Nothing repeats, so a screen comes to rest.

export type ChartTone = 'needs' | 'wants' | 'old-card' | 'unsorted' | 'savings' | 'mom' | 'pace' | 'wishlist';

export interface BarPart {
  readonly tone: ChartTone;
  readonly cents: Cents;
}

export interface Bar {
  readonly key: string;
  // Under the bar: "9/25".
  readonly label: string;
  // Everything it shows, for a screen reader.
  readonly words: string;
  readonly parts: readonly BarPart[];
  // 40.1: read from the bank history, not the books: drawn lighter, and said in words.
  readonly lighter: boolean;
  readonly selected: boolean;
}

// Stacked bars, one a pay period (or a weekday), oldest on the left. Only what was spent is drawn (a part that
// came out below zero, money back, is said in words but not drawn).
export function StackedBars({ bars, label, onPick, testId }: { readonly bars: readonly Bar[]; readonly label: string; readonly onPick: (key: string) => void; readonly testId?: string | undefined }) {
  const drawn = (b: Bar): Cents => b.parts.reduce((sum, p) => sum + Math.max(0, p.cents), 0);
  const most = Math.max(1, ...bars.map(drawn));
  // Each bar is a 44-point tap target, so more than fit across a phone scroll
  // sideways; it opens at the newest, on the right.
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, [bars.length]);
  return (
    <div className="pbars" role="group" aria-label={label} data-testid={testId} ref={row}>
      {bars.map((bar, i) => {
        const height = (drawn(bar) / most) * 100;
        return (
          <button
            key={bar.key}
            type="button"
            className={`pbar${bar.lighter ? ' pbar--lighter' : ''}${bar.selected ? ' is-selected' : ''}`}
            aria-label={bar.words}
            aria-pressed={bar.selected}
            onClick={() => onPick(bar.key)}
            data-testid={`${testId ?? 'bar'}-${bar.key}`}
            style={{ '--i': i } as CSSProperties}
          >
            <span className="pbar__plot" aria-hidden="true">
              <span className="pbar__stack" style={{ height: `${height}%` }} data-height={height.toFixed(2)}>
                {bar.parts
                  .filter((p) => p.cents > 0)
                  .map((p) => (
                    <span key={p.tone} className={`pbar__part chart--${p.tone}`} style={{ flexGrow: p.cents }} />
                  ))}
              </span>
            </span>
            <span className="pbar__label" aria-hidden="true">
              {bar.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface Line {
  readonly key: string;
  readonly tone: ChartTone;
  readonly values: readonly Cents[];
  readonly dashed?: boolean;
  // A soft gradient under it, down to the bottom of the chart.
  readonly area?: boolean;
}

const W = 320;
const H = 120;
const PAD = 6;

// The gradient under a line, in its own tone (blocks.css .chart-stop).
function Fade({ id, tone }: { readonly id: string; readonly tone: ChartTone }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1" className={`chart--${tone}`}>
      <stop offset="0%" className="chart-stop chart-stop--top" />
      <stop offset="100%" className="chart-stop chart-stop--bottom" />
    </linearGradient>
  );
}

// The area under a line and a range wipe in from the left, once.
function Reveal({ id }: { readonly id: string }) {
  return (
    <clipPath id={id}>
      <rect className="chart-reveal" x={0} y={-PAD} width={W} height={H + 2 * PAD} />
    </clipPath>
  );
}

// Where a line ends: a dot, and one ping that fades out.
function EndDot({ cx, cy, tone }: { readonly cx: number; readonly cy: number; readonly tone: ChartTone }) {
  return (
    <>
      <circle className={`chart-halo chart--${tone}`} cx={cx} cy={cy} r={3.5} />
      <circle className={`linechart__dot chart--${tone}`} cx={cx} cy={cy} r={3.5} />
    </>
  );
}

// Lines over the same days or points, left to right. length is how many
// points wide the chart is (a line can stop early, as Wants does at today).
// What it shows is in label and in the words around it.
export function LineChart({ lines, length, label, testId }: { readonly lines: readonly Line[]; readonly length: number; readonly label: string; readonly testId?: string | undefined }) {
  const id = useId();
  const all = lines.flatMap((l) => l.values);
  const top = Math.max(1, ...all);
  const bottom = Math.min(0, ...all);
  const x = (i: number): number => (length <= 1 ? W / 2 : PAD + (i / (length - 1)) * (W - 2 * PAD));
  const y = scaleLinear<number>({ domain: [bottom, top], range: [H - PAD, PAD] });
  return (
    <svg className="linechart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} data-testid={testId}>
      <defs>
        {lines.map((l) => (l.area === true ? <Fade key={l.key} id={`${id}-${l.key}`} tone={l.tone} /> : null))}
        <Reveal id={`${id}-reveal`} />
      </defs>
      {bottom < 0 && <line className="linechart__zero" x1={0} x2={W} y1={y(0)} y2={y(0)} />}
      {lines.map((l) =>
        l.values.length === 0 ? null : (
          <g key={l.key} data-testid={testId === undefined ? undefined : `${testId}-${l.key}`} data-values={l.values.join(',')}>
            {l.values.length === 1 ? (
              <circle className={`linechart__dot chart--${l.tone}`} cx={x(0)} cy={y(l.values[0] as number)} r={3.5} />
            ) : (
              <>
                {l.area === true && (
                  <g clipPath={`url(#${id}-reveal)`}>
                    <Area<Cents> className="linechart__area" data={[...l.values]} x={(_, i) => x(i)} y0={H - PAD} y1={(v) => y(v)} curve={curveMonotoneX} fill={`url(#${id}-${l.key})`} />
                  </g>
                )}
                <LinePath<Cents>
                  className={`linechart__line chart--${l.tone}${l.dashed === true ? ' linechart__line--dashed' : ''}`}
                  data={[...l.values]}
                  x={(_, i) => x(i)}
                  y={(v) => y(v)}
                  curve={curveMonotoneX}
                  pathLength={l.dashed === true ? undefined : 1}
                />
              </>
            )}
            {l.dashed !== true && l.values.length > 1 && <EndDot cx={x(l.values.length - 1)} cy={y(l.values[l.values.length - 1] as number)} tone={l.tone} />}
          </g>
        ),
      )}
    </svg>
  );
}

// ----- Over dates (Future, 40.12, 40.13) -----

export interface DatePoint {
  readonly date: IsoDate;
  readonly value: Cents;
}

export interface DateSeries {
  readonly key: string;
  readonly tone: ChartTone;
  readonly points: readonly DatePoint[];
  readonly dashed?: boolean;
  readonly area?: boolean;
}

// A range: from low to high on each date (savings a year out, 40.12).
export interface DateBand {
  readonly tone: ChartTone;
  readonly points: readonly { readonly date: IsoDate; readonly low: Cents; readonly high: Cents }[];
}

const dayOf = (date: IsoDate): number => Date.parse(`${date}T00:00:00Z`);

// Lines and a range on a line of days, placed by their dates (a plan's
// paydays are two weeks apart, its history a pay period). today, when given,
// is a faint upright line: left of it is the books, right of it an estimate.
export function DateChart({ series, band, today, label, testId }: { readonly series: readonly DateSeries[]; readonly band?: DateBand | undefined; readonly today?: IsoDate | undefined; readonly label: string; readonly testId?: string | undefined }) {
  const id = useId();
  const dates = [...series.flatMap((s) => s.points.map((p) => dayOf(p.date))), ...(band?.points.map((p) => dayOf(p.date)) ?? [])];
  const values = [...series.flatMap((s) => s.points.map((p) => p.value)), ...(band?.points.flatMap((p) => [p.low, p.high]) ?? [])];
  const first = Math.min(...dates);
  const last = Math.max(...dates);
  const x = scaleUtc<number>({ domain: [new Date(first), new Date(last === first ? first + 86_400_000 : last)], range: [PAD, W - PAD] });
  const bottom = Math.min(0, ...values);
  const y = scaleLinear<number>({ domain: [bottom, Math.max(1, ...values)], range: [H - PAD, PAD] });
  const at = (date: IsoDate): number => x(new Date(dayOf(date)));
  return (
    <svg className="linechart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} data-testid={testId}>
      <defs>
        {series.map((s) => (s.area === true ? <Fade key={s.key} id={`${id}-${s.key}`} tone={s.tone} /> : null))}
        {band !== undefined && <Fade id={`${id}-band`} tone={band.tone} />}
        <Reveal id={`${id}-reveal`} />
      </defs>
      {bottom < 0 && <line className="linechart__zero" x1={0} x2={W} y1={y(0)} y2={y(0)} />}
      {today !== undefined && <line className="linechart__today" x1={at(today)} x2={at(today)} y1={PAD} y2={H - PAD} />}
      {band !== undefined && band.points.length > 1 && (
        <g clipPath={`url(#${id}-reveal)`} data-testid={testId === undefined ? undefined : `${testId}-band`} data-values={band.points.map((p) => `${p.low}:${p.high}`).join(',')}>
          <Area className="linechart__band" data={[...band.points]} x={(p) => at(p.date)} y0={(p) => y(p.low)} y1={(p) => y(p.high)} fill={`url(#${id}-band)`} />
          <LinePath className={`linechart__edge chart--${band.tone}`} data={[...band.points]} x={(p) => at(p.date)} y={(p) => y(p.high)} />
          <LinePath className={`linechart__edge chart--${band.tone}`} data={[...band.points]} x={(p) => at(p.date)} y={(p) => y(p.low)} />
        </g>
      )}
      {series.map((s) =>
        s.points.length === 0 ? null : (
          <g key={s.key} data-testid={testId === undefined ? undefined : `${testId}-${s.key}`} data-values={s.points.map((p) => p.value).join(',')}>
            {s.area === true && s.points.length > 1 && (
              <g clipPath={`url(#${id}-reveal)`}>
                <Area className="linechart__area" data={[...s.points]} x={(p) => at(p.date)} y0={H - PAD} y1={(p) => y(p.value)} fill={`url(#${id}-${s.key})`} />
              </g>
            )}
            {s.points.length > 1 && (
              <LinePath
                className={`linechart__line chart--${s.tone}${s.dashed === true ? ' linechart__line--dashed' : ''}`}
                data={[...s.points]}
                x={(p) => at(p.date)}
                y={(p) => y(p.value)}
                pathLength={s.dashed === true ? undefined : 1}
              />
            )}
            {s.dashed !== true && <EndDot cx={at((s.points[s.points.length - 1] as DatePoint).date)} cy={y((s.points[s.points.length - 1] as DatePoint).value)} tone={s.tone} />}
          </g>
        ),
      )}
    </svg>
  );
}

// ----- Bars across, to compare a few amounts (Habits, 40.14) -----

export interface CompareBar {
  readonly key: string;
  readonly tone: ChartTone;
  readonly title: string;
  readonly cents: Cents;
  // The amount, drawn right of the title. The title and the amount are the
  // button's name, as they read: what the bar shows is in them.
  readonly amount: ReactNode;
}

// One bar a row, as long as its amount against the biggest, each a button
// that opens what is behind it.
export function CompareBars({ bars, onPick, testId }: { readonly bars: readonly CompareBar[]; readonly onPick: (key: string) => void; readonly testId?: string | undefined }) {
  const most = Math.max(1, ...bars.map((b) => b.cents));
  return (
    <div className="cbars" data-testid={testId}>
      {bars.map((bar, i) => (
        <button key={bar.key} type="button" className={`cbar chart--${bar.tone}`} onClick={() => onPick(bar.key)} data-testid={`${testId ?? 'cbar'}-${bar.key}`} style={{ '--i': i } as CSSProperties}>
          <span className="cbar__line">
            <span className="cbar__title">{bar.title}</span>
            <span className="cbar__amount">{bar.amount}</span>
          </span>
          <span className="cbar__track" aria-hidden="true">
            <span className="cbar__fill" style={{ width: `${Math.max(0, Math.min(100, (bar.cents / most) * 100)).toFixed(2)}%` }} />
          </span>
        </button>
      ))}
    </div>
  );
}

// Which color is which, in words.
export function ChartLegend({ items }: { readonly items: readonly { readonly tone: ChartTone; readonly label: string; readonly dashed?: boolean }[] }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li key={item.label} className="legend__item">
          <span className={`legend__swatch chart--${item.tone}${item.dashed === true ? ' legend__swatch--dashed' : ''}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

import type { BucketLevel, Cents } from '@budget-app/money';
import { motion, useScroll, useTransform } from 'motion/react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { barFill } from './bar-fill.js';
import { Icon, type IconName } from './Icon.js';
import { moneyText, moneyWords } from './money-format.js';
import { EASE, ENTRANCE_S, QUICK_S, ringFraction, useReducedMotion, useSpotlight } from './motion.js';
import { hintLevel, limitSwipe, swipeOutcome } from './swipe.js';

// The shared building blocks (CLAUDE.md design rules). Screens are made of
// these and the tokens in tokens.css; no screen makes up its own.

export type Tone = 'info' | 'warning' | 'danger' | 'ok';

// ----- Money -----

// Every amount on every screen. Tabular digits, a real minus sign, and the
// negative color on top of the sign, never instead of it. A stale amount
// (one that could not be checked today) is greyed, and the screen says why.
// roll: the digits roll to a new amount (redesign PR 2). The real text stays in
// the page, unchanged, for the screen reader, copying and the tests; the rolling
// digits are drawn over it and hidden from the screen reader.
export function Money({ cents, hero = false, stale = false, signed = false, roll = false, testId }: { readonly cents: Cents; readonly hero?: boolean; readonly stale?: boolean; readonly signed?: boolean; readonly roll?: boolean; readonly testId?: string | undefined }) {
  // A list of money in and money out shows a plus on what came in, so the
  // direction is in the amount itself, not only in a color.
  const text = signed && cents > 0 ? `+${moneyText(cents)}` : moneyText(cents);
  const negative = cents < 0;
  return (
    <span
      className={`money${hero ? ' money--hero' : ''}${negative ? ' is-negative' : ''}${stale ? ' money--stale' : ''}${roll ? ' money--roll' : ''}`}
      data-money=""
      data-testid={testId}
      aria-label={negative ? moneyWords(cents) : signed && cents > 0 ? `plus ${moneyWords(cents)}` : undefined}
      style={hero ? ({ '--chars': text.length } as CSSProperties) : undefined}
    >
      {roll ? (
        <>
          <RollingDigits text={text} cents={hero} />
          <span className="money__text">{hero ? <HeroText text={text} /> : text}</span>
        </>
      ) : hero ? (
        <HeroText text={text} />
      ) : (
        text
      )}
    </span>
  );
}

// The digits of an amount, each a short column of 0 to 9 behind a window; a
// new amount slides each column to its digit (200 to 300 ms, expo-out, a few
// ms apart left to right). Written here, not with a library, because the
// library draws in a shadow root and needs a style element the app's content
// policy does not allow. On the first draw the columns start at 0 and roll in.
// Drawn over the real text, so it is hidden from a screen reader; the digits
// are drawn from data-d by the stylesheet, so they are no text to read or copy
// (a card's own text stays just what it says).
const DIGITS = '0123456789'.split('');

function RollingDigits({ text, cents }: { readonly text: string; readonly cents: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const dot = cents ? text.lastIndexOf('.') : -1;
  return (
    <span className="roll" aria-hidden="true" data-testid="rolling-digits">
      {[...text].map((ch, i) => {
        const small = dot !== -1 && i >= dot ? ' roll__small' : '';
        if (ch < '0' || ch > '9') {
          return (
            <span key={`${i}-${ch}`} className={`roll__char${small}`} data-d={ch} />
          );
        }
        // Counted from the right, so a digit keeps its column when the amount grows.
        const place = text.length - i;
        return (
          <span key={place} className={`roll__digit${small}`}>
            <span className="roll__col" style={{ '--digit': shown ? Number(ch) : 0, '--delay': `${Math.min(i, 8) * 20}ms` } as CSSProperties}>
              {DIGITS.map((d) => (
                <span key={d} data-d={d} />
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

// The main number: the cents smaller and quieter. The text is the same
// characters, so it reads and copies as the one amount.
function HeroText({ text }: { readonly text: string }) {
  const dot = text.lastIndexOf('.');
  if (dot === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, dot)}
      <span className="money__cents">{text.slice(dot)}</span>
    </>
  );
}

// ----- Card -----

export function Card({ title, padded = false, children, testId }: { readonly title?: string; readonly padded?: boolean; readonly children: ReactNode; readonly testId?: string | undefined }) {
  const id = useId();
  return (
    <section aria-labelledby={title === undefined ? undefined : id} data-testid={testId}>
      {title !== undefined && (
        <h2 id={id} className="section-title">
          {title}
        </h2>
      )}
      <div className={`card${padded ? ' card--padded' : ''}`}>{children}</div>
    </section>
  );
}

// ----- List row -----

interface ListRowProps {
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly icon?: IconName;
  readonly tone?: Tone;
  readonly trailing?: ReactNode;
  // A row that goes somewhere is a link; one that opens something here is a button.
  readonly href?: string;
  readonly onClick?: () => void;
  readonly testId?: string | undefined;
}

export function ListRow({ title, detail, icon, tone = 'info', trailing, href, onClick, testId }: ListRowProps) {
  const inner = (
    <>
      {icon !== undefined && (
        <span className={`row__icon${tone === 'info' ? '' : ` row__icon--${tone}`}`}>
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="row__text">
        <span className="row__title">{title}</span>
        {detail !== undefined && <span className="row__detail">{detail}</span>}
      </span>
      {trailing !== undefined && <span className="row__trailing">{trailing}</span>}
      {(href !== undefined || onClick !== undefined) && (
        <span className="row__chevron">
          <Icon name="chevron" size={16} />
        </span>
      )}
    </>
  );
  const className = `row${icon === undefined ? ' row--plain' : ''}${trailing === undefined ? '' : ' row--trailing'}`;
  if (href !== undefined) {
    return (
      <a className={className} href={href} data-testid={testId}>
        {inner}
      </a>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" className={className} onClick={onClick} data-testid={testId}>
        {inner}
      </button>
    );
  }
  return (
    <div className={className} data-testid={testId}>
      {inner}
    </div>
  );
}

// ----- Button -----

export function Button({
  children,
  onClick,
  variant = 'primary',
  wide = false,
  disabled = false,
  testId,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly variant?: 'primary' | 'secondary' | 'plain';
  readonly wide?: boolean;
  // Not while something is being saved.
  readonly disabled?: boolean;
  readonly testId?: string | undefined;
}) {
  return (
    <button type="button" className={`button button--${variant}${wide ? ' button--wide' : ''}`} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  );
}

// A link that looks like a button: it goes to another screen of the app.
export function LinkButton({ children, href, variant = 'primary', wide = false, testId }: { readonly children: ReactNode; readonly href: string; readonly variant?: 'primary' | 'secondary'; readonly wide?: boolean; readonly testId?: string | undefined }) {
  return (
    <a className={`button button--${variant}${wide ? ' button--wide' : ''}`} href={href} data-testid={testId}>
      {children}
    </a>
  );
}

// ----- Status label: a word and an icon, so color is never the only signal -----

export type Status = 'low' | 'empty' | 'overdue' | 'pending' | 'under-target' | 'in-target' | 'over-target' | 'changes' | 'changed' | 'estimate';

const STATUS: Readonly<Record<Status, { readonly word: string; readonly icon: IconName; readonly tone: Tone }>> = {
  low: { word: 'Low', icon: 'low', tone: 'warning' },
  empty: { word: 'Empty', icon: 'empty', tone: 'danger' },
  overdue: { word: 'Overdue', icon: 'alert', tone: 'danger' },
  pending: { word: 'Pending', icon: 'clock', tone: 'info' },
  'under-target': { word: 'Under target', icon: 'low', tone: 'info' },
  'in-target': { word: 'In the target', icon: 'check', tone: 'info' },
  'over-target': { word: 'Over target', icon: 'alert', tone: 'warning' },
  changes: { word: 'Changes', icon: 'swap', tone: 'info' },
  // A32 (13.7): the item is not what the screen showed before it read its numbers again.
  changed: { word: 'Changed', icon: 'alert', tone: 'warning' },
  // 40.10: anything about the future is an estimate, never a promise.
  estimate: { word: 'Estimate', icon: 'clock', tone: 'info' },
};

export function StatusLabel({ status, testId }: { readonly status: Status; readonly testId?: string | undefined }) {
  const s = STATUS[status];
  return (
    <span className={`status status--${s.tone}`} data-status={status} data-testid={testId}>
      <Icon name={s.icon} size={12} />
      {s.word}
    </span>
  );
}

// ----- Bucket bar -----

// What is left in a bucket, against what it started the pay period with
// (10.1). Low and empty say so in words (10.1, 10.2).
export function BucketBar({ name, left, startedWith, level, href, testId }: { readonly name: string; readonly left: Cents; readonly startedWith: Cents; readonly level: BucketLevel; readonly href?: string; readonly testId?: string | undefined }) {
  const fill = barFill(left, startedWith);
  // With an address, the whole bar is a link to what went in and out of the bucket.
  const Tag = href === undefined ? 'div' : 'a';
  return (
    <Tag className={`bucket${href === undefined ? '' : ' bucket--link'}`} data-testid={testId} data-level={level} {...(href === undefined ? {} : { href })}>
      <div className="bucket__line">
        <span className="bucket__name">{name}</span>
        {level !== 'ok' && <StatusLabel status={level} />}
        <span className="bucket__left">
          <Money cents={left} roll testId={testId === undefined ? undefined : `${testId}-left`} />
          <span className="bucket__of">
            {' '}
            left of <Money cents={startedWith} testId={testId === undefined ? undefined : `${testId}-of`} />
          </span>
        </span>
        {href !== undefined && (
          <span className="row__chevron">
            <Icon name="chevron" size={16} />
          </span>
        )}
      </div>
      <div className="bar" aria-hidden="true">
        <div className={`bar__fill${level === 'ok' ? '' : ` bar__fill--${level}`}`} style={{ width: `${(fill * 100).toFixed(2)}%` }} />
      </div>
    </Tag>
  );
}

// ----- The light behind every screen (base.css, blocks.css) -----

// Drawn once, fixed, and it takes no touch. It is decoration only.
export function Backdrop() {
  return (
    <>
      <div className="ambient" aria-hidden="true">
        <div className="ambient__blob ambient__blob--a" />
        <div className="ambient__blob ambient__blob--b" />
        <div className="ambient__blob ambient__blob--c" />
      </div>
      <div className="statusbar" aria-hidden="true" />
    </>
  );
}

// ----- Tiles: buckets and counts side by side -----

// A section of tiles under a small title (Home).
export function Tiles({ title, children, testId }: { readonly title: string; readonly children: ReactNode; readonly testId?: string | undefined }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      <div className="tiles-wrap">
        <div className="tiles">{children}</div>
      </div>
    </section>
  );
}

// A bucket as a tile: the same facts as the bucket bar (what is left, against
// what it started the pay period with, Low and Empty in words), with the same
// test ids. The tall one stands beside two short ones.
export function BucketTile({ name, left, startedWith, level, href, tall = false, testId }: { readonly name: string; readonly left: Cents; readonly startedWith: Cents; readonly level: BucketLevel; readonly href: string; readonly tall?: boolean; readonly testId?: string | undefined }) {
  const fill = barFill(left, startedWith);
  const spot = useSpotlight();
  return (
    <a className={`tile spot${tall ? ' tile--tall' : ''}`} href={href} data-testid={testId} data-level={level} {...spot}>
      <span className="tile__top">
        <span className="tile__name">{name}</span>
        {level !== 'ok' && <StatusLabel status={level} />}
      </span>
      <span className="tile__figure">
        <span className="tile__amount" style={{ '--chars': moneyText(left).length } as CSSProperties}>
          <Money cents={left} roll testId={testId === undefined ? undefined : `${testId}-left`} />
        </span>
        <span className="tile__of">
          left of <Money cents={startedWith} testId={testId === undefined ? undefined : `${testId}-of`} />
        </span>
        <span className="bar" aria-hidden="true">
          <span className={`bar__fill${level === 'ok' ? '' : ` bar__fill--${level}`}`} style={{ display: 'block', width: `${(fill * 100).toFixed(2)}%` }} />
        </span>
      </span>
    </a>
  );
}

// A count as a tile that goes somewhere (what is waiting to be sorted).
export function CountTile({ name, count, go, href, testId }: { readonly name: string; readonly count: number; readonly go: string; readonly href: string; readonly testId?: string | undefined }) {
  return (
    <a className="tile" href={href} data-testid={testId}>
      <span className="tile__top">
        <span className="tile__name">{name}</span>
      </span>
      <span className="tile__count">
        <span className="tile__amount" data-testid={testId === undefined ? undefined : `${testId}-count`}>
          {count}
        </span>
        <span className="tile__go">{go} →</span>
      </span>
    </a>
  );
}

// ----- Banner: a state that must not be missed -----

export function Banner({ tone, icon, title, children, testId }: { readonly tone: 'danger' | 'warning'; readonly icon: IconName; readonly title: string; readonly children: ReactNode; readonly testId?: string | undefined }) {
  return (
    <section className={`banner banner--${tone}`} role="alert" aria-label={title} data-testid={testId}>
      <div className="banner__head">
        <Icon name={icon} size={24} />
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

// ----- Bottom sheet -----

// Slides up from the bottom, over the screen. Closes with its button, a tap
// outside it, or Escape. Built on the browser's own dialog, so focus stays
// inside it while it is open.
// After a sheet closes, the screen takes no tap for TAP_HOLD_MS. A sheet
// closes the moment its answer comes back, and the rest of a double tap on its
// button then landed on whatever was under it: a Settings row, which opened
// another sheet and took the saved message away, or the Review tab (CI Oct 11,
// WebKit; B194). An invisible cover over the whole screen takes those taps.
export const TAP_HOLD_MS = 500;

function holdTaps(): void {
  const cover = document.createElement('div');
  cover.className = 'tap-hold';
  cover.setAttribute('aria-hidden', 'true');
  document.body.append(cover);
  window.setTimeout(() => cover.remove(), TAP_HOLD_MS);
}

// Dragged down from its grabber or title, a sheet follows the finger and closes
// when pulled far enough, or flicked (redesign PR 2). Anything less than that
// and it slides back. The close button, a tap outside and Escape work as before.
const DRAG_CLOSE_PX = 110;
const DRAG_FLICK_PX = 40;
const DRAG_FLICK_SPEED = 0.6;

export function BottomSheet({ open, title, onClose, children, testId }: { readonly open: boolean; readonly title: string; readonly onClose: () => void; readonly children: ReactNode; readonly testId?: string | undefined }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const reduced = useReducedMotion();
  const drag = useRef<{ readonly pointer: number; readonly from: number; readonly at: number; dy: number; moving: boolean } | null>(null);
  // The way back or the way out being drawn now, if any.
  const drawn = useRef<Animation | null>(null);
  // B265, as B264's swipe card: the sheet's own place is set first, and the
  // way there is only drawn over it by the browser's own animation, which
  // never writes the sheet's style. Before, Motion wrote the last frame after
  // telling it had ended: a short pull stayed off its place until then, and a
  // late write could land on a sheet already closed.
  const draw = (dialog: HTMLDialogElement, from: string, to: string): Animation => {
    drawn.current?.cancel();
    const a = dialog.animate([{ transform: from }, { transform: to }], { duration: QUICK_S * 1000, easing: `cubic-bezier(${EASE.join(', ')})` });
    drawn.current = a;
    return a;
  };
  const finishDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    const dialog = ref.current;
    if (d === null || d.pointer !== event.pointerId || dialog === null) return;
    drag.current = null;
    if (!d.moving) return;
    const speed = d.dy / Math.max(1, performance.now() - d.at);
    const closes = event.type !== 'pointercancel' && (d.dy > DRAG_CLOSE_PX || (d.dy > DRAG_FLICK_PX && speed > DRAG_FLICK_SPEED));
    const from = `translateY(${d.dy}px)`;
    const back = (): void => {
      const at = dialog.style.transform || from;
      dialog.style.transform = '';
      if (!reduced) draw(dialog, at, 'translateY(0px)');
    };
    if (closes) {
      const finish = (): void => {
        onClose();
        // A sheet its screen keeps open (it was not allowed to close) comes back.
        window.setTimeout(() => {
          if (dialog.open) back();
        }, 120);
      };
      dialog.style.transform = 'translateY(100%)';
      // A new pull that takes the sheet on its way out keeps it.
      if (reduced) finish();
      else void draw(dialog, from, 'translateY(100%)').finished.then(finish, () => undefined);
    } else back();
  };
  // Opens and closes in the same step that redraws the screen (not a moment
  // later), so a sheet whose job is done never sits open with its button
  // enabled again: a second tap in that moment would send the choice twice
  // (CI, Oct 8, WebKit on Linux).
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start at the title, so a screen reader reads the sheet from the top
      // and the close button does not start out highlighted.
      dialog.querySelector<HTMLElement>('.sheet__title')?.focus();
    }
    if (!open && dialog.open) {
      dialog.close();
      dialog.style.transform = '';
      holdTaps();
    }
  }, [open]);
  // Taken off the screen while open (its screen let it go when the answer
  // came): the same hold.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open === true) holdTaps();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={id}
      data-testid={testId}
      onClose={onClose}
      onClick={(event) => {
        // A tap on the backdrop lands on the dialog itself, outside the inner box.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet__inner">
        <div
          className="sheet__drag"
          data-testid={testId === undefined ? undefined : `${testId}-drag`}
          onPointerDown={(event) => {
            if ((event.pointerType === 'mouse' && event.button !== 0) || (event.target instanceof Element && event.target.closest('button') !== null)) return;
            drag.current = { pointer: event.pointerId, from: event.clientY, at: performance.now(), dy: 0, moving: false };
          }}
          onPointerMove={(event) => {
            const d = drag.current;
            const dialog = ref.current;
            if (d === null || d.pointer !== event.pointerId || dialog === null) return;
            const dy = Math.max(0, event.clientY - d.from);
            if (!d.moving) {
              if (dy < 4) return;
              d.moving = true;
              // A way back still being drawn gives way to the finger (B265).
              drawn.current?.cancel();
              drawn.current = null;
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // The pull still follows the finger over the sheet itself.
              }
            }
            d.dy = dy;
            dialog.style.transform = `translateY(${dy}px)`;
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <div className="sheet__grabber" aria-hidden="true" />
          <div className="sheet__head">
            <h2 id={id} className="sheet__title" tabIndex={-1}>
              {title}
            </h2>
            <button type="button" className="button button--plain" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </dialog>
  );
}

// ----- Made-up data pill: only the demo shows it -----

export function MadeUpPill() {
  return (
    <span className="pill" data-testid="made-up">
      <Icon name="info" size={12} />
      Made-up data
    </span>
  );
}

// ----- Hero: the one main number of a screen -----

export function Hero({ label, children, sub, testId }: { readonly label: string; readonly children: ReactNode; readonly sub?: ReactNode; readonly testId?: string | undefined }) {
  const id = useId();
  const spot = useSpotlight();
  return (
    <section className="hero spot" aria-labelledby={id} data-testid={testId} {...spot}>
      <h2 id={id} className="hero__label">
        {label}
      </h2>
      {children}
      {sub !== undefined && <p className="hero__sub">{sub}</p>}
    </section>
  );
}

// Home's hero: the same card, but it fades, scales and sinks a little as the
// screen scrolls away from it, and it carries the pay period's ring. Nothing
// moves with reduced motion.
export function ScrollHero({ labelledBy, ring, children, testId }: { readonly labelledBy: string; readonly ring?: ReactNode; readonly children: ReactNode; readonly testId?: string | undefined }) {
  const reduced = useReducedMotion();
  const spot = useSpotlight();
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [0, 180], [1, 0.55]);
  const scale = useTransform(scrollY, [0, 180], [1, 0.97]);
  const y = useTransform(scrollY, [0, 180], [0, 6]);
  return (
    <motion.section className="hero spot" aria-labelledby={labelledBy} data-testid={testId} style={reduced ? {} : { opacity, scale, y }} {...spot}>
      {ring}
      {children}
    </motion.section>
  );
}

// How far through the pay period it is, drawn in once when Home opens. It
// repeats what "N days to payday" already says, so it is hidden from a screen
// reader; data-fraction is the number it draws.
export function PeriodRing({ start, today, next, testId }: { readonly start: string; readonly today: string; readonly next: string; readonly testId?: string | undefined }) {
  const reduced = useReducedMotion();
  const fraction = ringFraction(start, today, next);
  return (
    <svg className="ring" viewBox="0 0 40 40" aria-hidden="true" data-testid={testId} data-fraction={fraction.toFixed(4)}>
      <circle className="ring__track" cx="20" cy="20" r="16" />
      {fraction > 0 && <motion.circle className="ring__arc" cx="20" cy="20" r="16" transform="rotate(-90 20 20)" initial={{ pathLength: reduced ? fraction : 0 }} animate={{ pathLength: fraction }} transition={{ duration: reduced ? 0 : ENTRANCE_S, ease: EASE }} />}
    </svg>
  );
}

// The main number when it is a count, not money.
export function HeroCount({ count, testId }: { readonly count: number; readonly testId?: string | undefined }) {
  return (
    <span className="hero__count" data-testid={testId}>
      {count}
    </span>
  );
}

// ----- Target bar: how much against a target range, such as mom this month -----

// The bar fills toward the high end of the range; a tick marks the low end.
// The position is said in words too.
export function TargetBar({
  name,
  amount,
  caption,
  sent,
  low,
  high,
  position,
  testId,
}: {
  readonly name: string;
  readonly amount: ReactNode;
  readonly caption: ReactNode;
  readonly sent: Cents;
  readonly low: Cents;
  readonly high: Cents;
  readonly position: 'under' | 'within' | 'over';
  readonly testId?: string | undefined;
}) {
  const fill = barFill(sent, high);
  const tick = high > 0 ? Math.min(1, Math.max(0, low / high)) : 0;
  return (
    <div className="bucket" data-testid={testId} data-position={position}>
      <div className="bucket__line">
        <span className="bucket__name">{name}</span>
        <span className="bucket__left">{amount}</span>
      </div>
      <div className="bar bar--target" aria-hidden="true">
        <div className="bar__fill" style={{ width: `${(fill * 100).toFixed(2)}%` }} />
        <div className="bar__tick" style={{ left: `${(tick * 100).toFixed(2)}%` }} />
      </div>
      <p className="bucket__caption">{caption}</p>
      <StatusLabel status={position === 'under' ? 'under-target' : position === 'within' ? 'in-target' : 'over-target'} />
    </div>
  );
}

// ----- Notice: a short message that is not a whole screen state -----

export function Notice({
  tone,
  icon,
  children,
  action,
  sticky = false,
  testId,
}: {
  readonly tone: 'ok' | 'warning' | 'danger';
  readonly icon: IconName;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  // Stays in view, under the notch, while the screen scrolls.
  readonly sticky?: boolean;
  readonly testId?: string | undefined;
}) {
  return (
    <div className={`notice notice--${tone}${sticky ? ' notice--sticky' : ''}`} role={tone === 'ok' ? 'status' : 'alert'} data-testid={testId}>
      <Icon name={icon} size={20} />
      <div className="notice__text">{children}</div>
      {action}
    </div>
  );
}

// ----- Toggle row: a switch with words -----

export function ToggleRow({
  label,
  detail,
  checked,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly detail?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly testId?: string | undefined;
}) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id}>
      <span className="row__text">
        <span className="row__title">{label}</span>
        {detail !== undefined && <span className="row__detail">{detail}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" className="toggle__input" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} data-testid={testId} />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </label>
  );
}

// ----- Text field -----

export function TextField({
  label,
  value,
  onChange,
  hint,
  money = false,
  kind = 'text',
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  // An amount in dollars: the phone shows the number pad.
  readonly money?: boolean;
  // A whole number (the phone shows the digits), or a date or a time (the
  // phone's own picker). Plain text otherwise.
  readonly kind?: 'text' | 'whole' | 'date' | 'time';
  readonly testId?: string | undefined;
}) {
  const id = useId();
  const picker = kind === 'date' || kind === 'time';
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <input
        id={id}
        className={`field__input${money || kind === 'whole' ? ' field__input--money' : ''}`}
        type={picker ? kind : 'text'}
        inputMode={picker ? undefined : money ? 'decimal' : kind === 'whole' ? 'numeric' : 'text'}
        autoComplete="off"
        autoCapitalize={money || kind !== 'text' ? 'off' : 'characters'}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        data-testid={testId}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}

// ----- Select field: one of a few, chosen from the phone's own list -----

export function SelectField({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly testId?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <select id={id} className="field__input field__input--select" value={value} onChange={(event) => onChange(event.currentTarget.value)} data-testid={testId}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ----- Compare table: two columns of the same things, such as this pay period and the next -----

// Each row has a name and a value in each column; a row whose values differ
// says so in words ("Changes"), so color is never the only signal. When the
// text is large the columns no longer fit side by side, so each row stacks,
// every value with its column's name (blocks.css).
export interface CompareColumn {
  readonly name: string;
  readonly sub?: string;
}

export function CompareTable({
  caption,
  columns,
  rows,
  testId,
}: {
  readonly caption: string;
  readonly columns: readonly [CompareColumn, CompareColumn];
  readonly rows: readonly { readonly label: string; readonly first: ReactNode; readonly second: ReactNode; readonly differs: boolean; readonly testId: string }[];
  readonly testId?: string | undefined;
}) {
  const label = (c: CompareColumn): string => (c.sub === undefined ? c.name : `${c.name}, ${c.sub}`);
  return (
    <div className="compare-wrap">
      <table className="compare" data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <td />
            {columns.map((c) => (
              <th key={c.name} scope="col">
                {c.name}
                {c.sub !== undefined && <span className="compare__sub">{c.sub}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.testId} data-testid={row.testId} data-differs={row.differs}>
              <th scope="row">{row.label}</th>
              <td data-testid={`${row.testId}-first`} data-label={label(columns[0])}>
                <span className="compare__value">{row.first}</span>
              </td>
              <td data-testid={`${row.testId}-second`} data-label={label(columns[1])}>
                <span className="compare__value">{row.second}</span>
                {row.differs && <StatusLabel status="changes" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----- Back link: goes back to the screen this one was opened from -----

export function BackLink({ href, label, onBack, testId }: { readonly href: string; readonly label: string; readonly onBack?: () => void; readonly testId?: string | undefined }) {
  return (
    <a
      className="back"
      href={href}
      data-testid={testId}
      onClick={(event) => {
        if (onBack === undefined || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onBack();
      }}
    >
      <Icon name="back" size={18} />
      <span>{label}</span>
    </a>
  );
}

// ----- Button row: buttons side by side, wrapping on a narrow screen -----

export function ButtonRow({ children }: { readonly children: ReactNode }) {
  return <div className="button-row">{children}</div>;
}

// ----- Decision: something waiting for him, with what to do about it -----

// A title and amount, a line saying what it is, optional extra content, and
// the buttons to decide. Several sit in one card.
export function Decision({
  title,
  amount,
  detail,
  status,
  changed,
  children,
  actions,
  testId,
}: {
  readonly title: ReactNode;
  readonly amount?: ReactNode;
  readonly detail: ReactNode;
  readonly status?: Status | undefined;
  // A32 (13.7): what the item is now, when it changed as the screen read its
  // numbers again ("Changed: now $21.50, posted"). In words, with an icon.
  readonly changed?: string | undefined;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
  readonly testId?: string | undefined;
}) {
  return (
    <article className="decision" data-testid={testId}>
      <div className="decision__head">
        <h3 className="decision__title">{title}</h3>
        {amount !== undefined && <span className="decision__amount">{amount}</span>}
      </div>
      <p className="decision__detail">
        {status !== undefined && <StatusLabel status={status} />}
        <span>{detail}</span>
      </p>
      {changed !== undefined && (
        <p className="decision__changed" data-testid="changed">
          <Icon name="alert" size={14} />
          <span>{changed}</span>
        </p>
      )}
      {children}
      <div className="decision__actions">{actions}</div>
    </article>
  );
}

// ----- SwipeSort: a card dragged right to accept, or left for later (redesign PR 3) -----

// The card follows the finger; hint words fade in on the side it is dragged
// toward. A swipe is only ever another way to press a button: onRight is that
// button's own call, and a side with no handler does not move at all. The
// buttons stay on the card, so nothing is swipe-only. A cancelled drag (the
// phone took the gesture for a scroll) answers nothing.
export function SwipeSort({
  rightLabel,
  onRight,
  onLater,
  busy,
  children,
}: {
  readonly rightLabel?: string | undefined;
  readonly onRight?: (() => void) | undefined;
  readonly onLater?: (() => void) | undefined;
  readonly busy: boolean;
  readonly children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const drag = useRef<{ readonly pointer: number; readonly x: number; readonly y: number; readonly at: number; dx: number; moving: boolean } | null>(null);
  const flown = useRef(false);
  const sides = { right: onRight !== undefined && !busy, left: onLater !== undefined && !busy };
  const latest = useRef({ sides, onRight, onLater });
  latest.current = { sides, onRight, onLater };

  const show = (dx: number): void => {
    const el = root.current;
    if (el === null) return;
    el.dataset['swiping'] = dx === 0 ? 'off' : dx > 0 ? 'right' : 'left';
    el.style.setProperty('--hint', String(hintLevel(dx)));
  };
  const bringBack = (): void => {
    const el = card.current;
    if (el === null) return;
    flown.current = false;
    const from = el.style.transform || 'translateX(0px)';
    // At rest at once: the card's own place is set back now, and the way back
    // is only drawn over it. Nothing that ends later can leave it off its place
    // (B264: on a busy machine Motion's last write of the way back landed after
    // its end was told, and the card stayed at translateX(0px)).
    el.style.transform = '';
    show(0);
    if (!reduced && from !== 'translateX(0px)') el.animate([{ transform: from }, { transform: 'translateX(0px)' }], { duration: QUICK_S * 1000, easing: `cubic-bezier(${EASE.join(', ')})` });
  };
  // An answer that went through takes the card off the screen with its item.
  // One that did not (it was refused, or nothing happened) brings it back,
  // in the same commit that shows the refusal: a passive effect can run after
  // a frame with the refusal already drawn (B264, on a busy machine).
  useLayoutEffect(() => {
    if (!busy && flown.current) bringBack();
  });
  useEffect(() => {
    if (!flown.current) return undefined;
    const timer = window.setTimeout(() => {
      if (flown.current) bringBack();
    }, 2_000);
    return () => window.clearTimeout(timer);
  });

  const finish = (event: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    const el = card.current;
    if (d === null || d.pointer !== event.pointerId || el === null) return;
    drag.current = null;
    if (!d.moving) return;
    const { sides: now, onRight: right, onLater: later } = latest.current;
    const outcome = event.type === 'pointercancel' ? 'back' : swipeOutcome(d.dx, performance.now() - d.at, now);
    if (outcome === 'back') {
      el.style.transform = `translateX(${d.dx}px)`;
      bringBack();
      return;
    }
    const to = (outcome === 'right' ? 1 : -1) * el.offsetWidth;
    const done = (): void => {
      if (outcome === 'right') {
        flown.current = true;
        right?.();
      } else {
        // Later moves the card to the end of the list: it is shown there at rest.
        el.style.transform = '';
        show(0);
        later?.();
      }
    };
    // The card's own place is set first, and the way out only drawn over it
    // (B264: Motion wrote its last frame after its end was told, over the
    // card already brought back). A way out cut short still ends.
    el.style.transform = `translateX(${to}px)`;
    if (reduced) done();
    else void el.animate([{ transform: `translateX(${d.dx}px)` }, { transform: `translateX(${to}px)` }], { duration: QUICK_S * 1000, easing: `cubic-bezier(${EASE.join(', ')})` }).finished.then(done, done);
  };

  return (
    <div ref={root} className="swipe" data-swiping="off" data-testid="swipe">
      <div className="swipe__hints" aria-hidden="true">
        {rightLabel !== undefined && <span className="swipe__hint swipe__hint--right">{rightLabel}</span>}
        <span className="swipe__hint swipe__hint--left">Later</span>
      </div>
      <div
        ref={card}
        className="swipe__card"
        data-testid="swipe-card"
        onPointerDown={(event) => {
          if (busy || (event.pointerType === 'mouse' && event.button !== 0) || (event.target instanceof Element && event.target.closest('button, a, input, select, textarea') !== null)) return;
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), dx: 0, moving: false };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          const el = card.current;
          if (d === null || d.pointer !== event.pointerId || el === null) return;
          const raw = event.clientX - d.x;
          if (!d.moving) {
            // Mostly sideways, and far enough to be a drag, not a tap or a scroll.
            if (Math.abs(raw) < 6 || Math.abs(raw) < Math.abs(event.clientY - d.y)) return;
            d.moving = true;
            // A way back still being drawn gives way to the finger.
            for (const a of event.currentTarget.getAnimations()) a.cancel();
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // The drag still follows the finger over the card itself.
            }
          }
          d.dx = limitSwipe(raw, latest.current.sides);
          el.style.transform = `translateX(${d.dx}px)`;
          show(d.dx);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        {children}
      </div>
    </div>
  );
}

// ----- Screen states: loading, empty, error -----

export function StateMessage({ icon, tone = 'info', title, detail, children, testId }: { readonly icon: IconName; readonly tone?: 'info' | 'danger'; readonly title: string; readonly detail?: string; readonly children?: ReactNode; readonly testId?: string | undefined }) {
  return (
    <div className="state" data-testid={testId}>
      <span className={`state__icon${tone === 'danger' ? ' state__icon--danger' : ''}`}>
        <Icon name={icon} size={28} />
      </span>
      <p className="state__title">{title}</p>
      {detail !== undefined && <p className="state__detail">{detail}</p>}
      {children}
    </div>
  );
}

export function Skeleton({ width, height }: { readonly width: string; readonly height: string }) {
  return <div className="skeleton" style={{ width, height }} />;
}

// ----- Segmented control -----

// A few views of one screen, one shown at a time (Trends: Past and Now). Each
// is a button that says whether it is the one shown; the light behind the
// one shown slides to it (none with reduced motion).
export function Segmented<T extends string>({ label, options, value, onChange, testId }: { readonly label: string; readonly options: readonly { readonly value: T; readonly label: string }[]; readonly value: T; readonly onChange: (value: T) => void; readonly testId?: string | undefined }) {
  const id = useId();
  return (
    <div className="segmented" role="group" aria-label={label} data-testid={testId}>
      {options.map((option) => (
        <button key={option.value} type="button" className="segmented__option" aria-pressed={option.value === value} onClick={() => onChange(option.value)} data-testid={`${testId ?? 'segment'}-${option.value}`}>
          {option.value === value && <motion.span layoutId={`segmented-${id}`} className="segmented__light" aria-hidden="true" transition={{ duration: QUICK_S, ease: EASE }} />}
          <span className="segmented__label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

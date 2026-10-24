import { parseDollars, type AccountId, type Cents, type IsoDate, type LikelyPurchase, type PickTo, type ReviewDetail, type ReviewOptions, type RuleOffer, type SortedNow } from '@budget-app/money';
import type { ChoiceOf, ChoicePart, ChoiceRequest, PaycheckSplitShown, ReviewItemShown as KeyedDetail } from '@budget-app/server/views';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { newDecisionId, sendChoice, type Reload } from '../app/api.js';
import { BottomSheet, Button, ButtonRow, Card, Decision, ListRow, Money, Notice, TextField, ToggleRow } from '../ui/blocks.js';
import { shortDate } from '../ui/dates.js';
import { moneyText } from '../ui/money-format.js';
import { ACCOUNT_NAMES, BUCKET_NAMES, RULE_WHAT, changedWords, doneText, lessSincePaydayWords, markedWords, nowWords, offerText, pickLabel, reasonText, ruleSentenceText, sortedWords, titleOf, transferWords } from './review-text.js';
import type { ActivityRowShown as ActivityRow } from '@budget-app/server/views';

// Choosing what happens to an item: the same for an item waiting in Review
// and for one sorted already, from the list of what went in and out of a
// bucket (rule 4.7, QUESTIONS.md B100 to B102). Every choice shown is one the
// money math offers for that kind of item (the server sends them with the
// item); the screen decides nothing. A tap sends the choice and the server's
// money math does the rest. The same decision sent twice changes nothing the
// second time, a refused choice changes nothing and says why, and anything
// final asks first.

export type Kind = ReviewDetail['item']['type'];
type SortOptions = Extract<ReviewOptions, { type: 'sort' }>;

// What a choice is about, as far as sending it and saying what was done.
export interface Target {
  readonly id: string;
  readonly label: string;
  readonly kind: Kind;
  // Step 3: the item's key as the screen shows it, sent with the choice: if a
  // sync has changed the item since, the server refuses it and says how it is now.
  readonly seen?: string;
}

// An item that can be sorted: what the sheet of choices needs to know.
export interface Subject {
  readonly target: Target & { readonly kind: 'spending' | 'money-in' };
  readonly amount: Cents;
  readonly date: IsoDate;
  readonly account: AccountId | null;
  // The first line of the sheet: why it waits, or where it is now.
  readonly heading: string;
  readonly options: SortOptions;
  readonly likely: readonly LikelyPurchase[];
  // "Off in this setup": with no mom reserve, no reserve part.
  readonly paycheckPreview: PaycheckSplitShown | null;
  // Where it is sorted now; null while it waits in review.
  readonly now: SortedNow | null;
  // The account he marked it a transfer with (5.6, A20), when he did.
  readonly marked: AccountId | null;
  // What a rule made from this item starts out as, and what it would catch.
  readonly ruleText: string;
  readonly ruleWhat: 'deposits' | 'payments to people' | 'purchases';
  // A store refund the app could not match to its purchase (4.5, A18).
  readonly refund: boolean;
  // Her rulebook, 3.1: a paycheck waiting for her yes.
  readonly paycheckAsk?: boolean;
}

// One decision, made once: its number stays the same for every retry of it.
export interface Pending {
  readonly id: string;
  readonly item: string;
  readonly label: string;
  readonly kind: Kind;
  readonly choice: ChoiceOf;
  readonly always?: { readonly contains: string };
  readonly confirmed?: boolean;
  // Step 3: the item's key as the screen showed it (Target).
  readonly seen?: string;
  // 13.8: a rule made from the offer, for an item already sorted (as from its
  // bucket's list, B101), whichever screen it was sorted on.
  readonly resort?: true;
  // What the confirm step says.
  readonly ask?: ReactNode;
  // What the choice pointed at, for the answer (doneText).
  readonly about?: string;
}

// What comes with a choice: a rule, what "are you sure" says, and what it pointed at.
export interface Extra {
  readonly always?: { readonly contains: string };
  readonly ask?: ReactNode;
  readonly final?: boolean;
  readonly about?: string;
}

export type Choose = (target: Target, choice: ChoiceOf, extra?: Extra) => void;

export type Sheet =
  // notAPaycheck: opened from "Not a paycheck" on a paycheck waiting for her yes (her rulebook, 3.1).
  | { readonly item: string; readonly step: 'choose'; readonly notAPaycheck?: true }
  | { readonly item: string; readonly step: 'confirm'; readonly pending: Pending }
  // 13.8: making the rule offered after a sort.
  | { readonly item: string; readonly step: 'offer'; readonly offer: Offered };

// 13.8: the rule the server offered with an answer, and the item it is about.
export interface Offered extends RuleOffer {
  readonly item: string;
  readonly label: string;
  readonly kind: Kind;
}

export interface Said {
  readonly tone: 'ok' | 'warning' | 'danger';
  readonly text: string;
  // Sending failed for want of a signal: the same decision can be sent again.
  readonly retry?: Pending;
  // 13.8: sorted the same way as an earlier one from the same place: the rule to offer.
  readonly offer?: Offered;
}

// ----- What each kind of item is, for the sheet -----

export function subjectOfReview(detail: KeyedDetail): Subject | null {
  const { item, options } = detail;
  if ((item.type !== 'spending' && item.type !== 'money-in') || options.type !== 'sort') return null;
  return {
    target: { id: item.id, label: item.description, kind: item.type, seen: detail.key },
    amount: item.amount,
    date: item.date,
    account: detail.account,
    heading: reasonText(item),
    options,
    likely: detail.likelyPurchases,
    paycheckPreview: detail.paycheckPreview,
    now: null,
    marked: null,
    ruleText: detail.ruleText,
    ruleWhat: item.type === 'money-in' ? 'deposits' : item.reason === 'person-payment' ? 'payments to people' : 'purchases',
    refund: item.type === 'money-in' && item.reason === 'refund',
    paycheckAsk: item.type === 'money-in' && item.reason === 'paycheck',
  };
}

// A row of a bucket's list, if it can be sorted again (B100).
export function subjectOfRow(row: ActivityRow, seen: string | undefined, ruleText?: string): Subject | null {
  const r = row.resort;
  if (!r.resortable) return null;
  return {
    target: { id: r.id, label: r.description, kind: r.type, ...(seen === undefined ? {} : { seen }) },
    amount: r.amount,
    date: r.date,
    account: r.account,
    heading: `Now ${nowWords(r.now)}`,
    options: r.options,
    likely: r.likelyPurchases,
    paycheckPreview: r.paycheckPreview,
    now: r.now,
    marked: r.marked,
    ruleText: ruleText ?? r.description,
    ruleWhat: r.type === 'money-in' ? 'deposits' : row.what === 'person-payment' ? 'payments to people' : 'purchases',
    refund: r.refund,
  };
}

// ----- Sending a choice -----

// QUESTIONS.md A32, rule 13.7: how long an item whose key changed when the
// screen read its numbers again takes no tap, so a tap meant for what was
// there before is not sent.
export const CHANGED_HOLD_MS = 1_000;

// The state of choosing and sending, for a screen. One request at a time: a
// second tap before the screen has redrawn must not send a second request.
// Nor one after an answer went through, while the screen still shows the
// numbers from before it (B92, as on Setup day; his PC under full load, Oct
// 11, WebKit: the second tap of a double tap came in that moment): view is the
// screen's numbers as shown, and the buttons stay off until the numbers asked
// for after the answer are shown.
//
// keys: each item's key as the screen shows it now, by its id (Step 3). When
// the screen reads its numbers again and an item's key is not the one it
// showed (a sync changed it), the item is marked changed for as long as the
// screen shows it, and takes no tap for CHANGED_HOLD_MS (A32). An item he
// answered himself is not marked: its change is his own.
export function useChoiceFlow(options: { readonly resort: boolean; readonly reload: Reload; readonly onChanged: Reload; readonly keys: ReadonlyMap<string, string>; readonly view: object }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  // The numbers shown when the last answer that asks for them again came back.
  const shownView = useRef(options.view);
  shownView.current = options.view;
  const [answeredOn, setAnsweredOn] = useState<object | null>(null);
  const fresh = useFresh(options.keys);

  // Closing the sheet by hand drops a refusal he has read. The sheet also
  // closes by itself when a choice goes through (or the item was already
  // dealt with): that must not wipe what was just said.
  const closeSheet = (): void => {
    if (sheet === null) return;
    setSheet(null);
    setSaid(null);
  };

  // A sheet opened later does not show what was said about the last thing.
  const openSheet = (id: string, options: { readonly notAPaycheck?: true } = {}): void => {
    setSaid(null);
    setSheet({ item: id, step: 'choose', ...options });
  };

  // 13.8: "Make it a rule" on the notice that offered one.
  const openOffer = (offer: Offered): void => {
    setSaid(null);
    setSheet({ item: offer.item, step: 'offer', offer });
  };

  const submit = (pending: Pending): void => {
    if (lock.current) return;
    lock.current = true;
    setSending(true);
    setSaid(null);
    const request: ChoiceRequest = {
      id: pending.id,
      item: pending.item,
      choice: pending.choice,
      ...(pending.always === undefined ? {} : { always: pending.always }),
      ...(pending.confirmed === true ? { confirmed: true } : {}),
      ...(options.resort || pending.resort === true ? { resort: true as const } : {}),
      ...(pending.seen === undefined ? {} : { seen: pending.seen }),
    };
    sendChoice(request).then(
      (answer) => {
        lock.current = false;
        setSending(false);
        if (answer.ok) {
          fresh.answered(pending.item);
          setSheet(null);
          const offer = answer.done.offer;
          setSaid({ tone: 'ok', text: doneText(pending.label, pending.kind, answer.done, pending.about), ...(offer === undefined ? {} : { offer: { ...offer, item: pending.item, label: pending.label, kind: pending.kind } }) });
        } else if (answer.code === 'not-waiting' || answer.code === 'changed') {
          // Not waiting any more, or changed since it was shown (Step 3): the
          // numbers are asked for again, and he looks at it as it is now. A
          // change already says what it is about.
          setSheet(null);
          setSaid({ tone: 'warning', text: answer.code === 'changed' ? answer.why : `${pending.label}: ${answer.why}` });
        } else {
          // Refused: nothing changed. Back to the choices, with the reason
          // (a rule from the offer stays where its text can be changed).
          setSheet((current) => (current === null ? null : current.step === 'offer' ? current : { item: current.item, step: 'choose' }));
          setSaid({ tone: 'danger', text: answer.why });
          return;
        }
        setAnsweredOn(shownView.current);
        options.reload('after');
        options.onChanged('after');
      },
      () => {
        lock.current = false;
        setSending(false);
        setSaid({ tone: 'danger', text: "Couldn't save that. Check your connection and try again. Nothing is counted twice.", retry: pending });
      },
    );
  };

  // A choice is made: final ones ask first, the rest are sent at once.
  const choose: Choose = (target, choice, extra = {}) => {
    const pending: Pending = {
      id: newDecisionId(),
      item: target.id,
      label: target.label,
      kind: target.kind,
      choice,
      ...(target.seen === undefined ? {} : { seen: target.seen }),
      ...(extra.always === undefined ? {} : { always: extra.always }),
      ...(extra.ask === undefined ? {} : { ask: extra.ask }),
      ...(extra.about === undefined ? {} : { about: extra.about }),
    };
    if (extra.final === true || extra.always !== undefined) {
      setSaid(null);
      setSheet({ item: target.id, step: 'confirm', pending });
    } else submit(pending);
  };

  return { sheet, said, sending: sending || answeredOn === options.view, setSaid, setSheet, openSheet, openOffer, closeSheet, submit, choose, changed: fresh.changed, holding: fresh.holding };
}

// A32: which items changed when the screen last read its numbers, and which
// of them still take no tap. Worked out as the new numbers are drawn, in the
// same step, so no tap can reach a card between the new numbers and the hold.
function useFresh(keys: ReadonlyMap<string, string>) {
  const shown = useRef<ReadonlyMap<string, string> | null>(null);
  const signature = useRef('');
  // Changed items, and until when (performance.now()) each takes no tap.
  const changedUntil = useRef(new Map<string, number>());
  // Items he answered since the screen last read its numbers.
  const own = useRef(new Set<string>());
  const [, redraw] = useState(0);

  const now = [...keys].map(([id, key]) => `${id}=${key}`).join('&');
  if (now !== signature.current) {
    const before = shown.current;
    const at = performance.now();
    for (const id of [...changedUntil.current.keys()]) if (!keys.has(id) || own.current.has(id)) changedUntil.current.delete(id);
    if (before !== null) {
      for (const [id, key] of keys) {
        const was = before.get(id);
        if (was !== undefined && was !== key && !own.current.has(id)) changedUntil.current.set(id, at + CHANGED_HOLD_MS);
      }
    }
    own.current.clear();
    shown.current = new Map(keys);
    signature.current = now;
  }

  // Drawn again when the first hold ends, so its buttons take a tap.
  useEffect(() => {
    const left = Math.min(...[...changedUntil.current.values()].map((until) => until - performance.now()).filter((ms) => ms > 0));
    if (!Number.isFinite(left)) return undefined;
    const timer = setTimeout(() => redraw((n) => n + 1), left + 1);
    return () => clearTimeout(timer);
  });

  return {
    changed: (id: string): boolean => changedUntil.current.has(id),
    holding: (id: string): boolean => (changedUntil.current.get(id) ?? 0) > performance.now(),
    answered: (id: string): void => {
      own.current.add(id);
    },
  };
}

export type ChoiceFlow = ReturnType<typeof useChoiceFlow>;

export function SaidNotice({
  said,
  sending,
  onRetry,
  onDismiss,
  onOffer,
  sticky = false,
}: {
  readonly said: Said;
  readonly sending: boolean;
  readonly onRetry: (pending: Pending) => void;
  readonly onDismiss: () => void;
  // 13.8: opens the sheet that makes the rule offered.
  readonly onOffer?: (offer: Offered) => void;
  readonly sticky?: boolean;
}) {
  const retry = said.retry;
  const offer = retry === undefined && onOffer !== undefined ? said.offer : undefined;
  return (
    <Notice
      tone={said.tone}
      icon={said.tone === 'ok' ? 'check' : 'alert'}
      sticky={sticky}
      testId="notice"
      action={
        retry !== undefined ? (
          <Button variant="secondary" onClick={() => onRetry(retry)} testId="notice-retry">
            {sending ? 'Saving…' : 'Try again'}
          </Button>
        ) : (
          <Button variant="plain" onClick={onDismiss} testId="notice-dismiss">
            OK
          </Button>
        )
      }
    >
      {said.text}
      {offer !== undefined && (
        <>
          <span data-testid="notice-offer-text">
            {' '}
            {offerText(offer)}
          </span>
          <span style={{ display: 'block', marginTop: 'var(--space-2)' }}>
            <Button variant="secondary" disabled={sending} onClick={() => onOffer?.(offer)} testId="notice-offer">
              Make it a rule
            </Button>
          </span>
        </>
      )}
    </Notice>
  );
}

// ----- 13.8: making the rule offered -----

// The rule offered after a sort: its text, which he can change first, and
// what it would do. "Yes, always" makes it from the item already sorted
// (13.6, B101); "Not now" changes nothing.
export function RuleOfferSheet({ flow, testId }: { readonly flow: ChoiceFlow; readonly testId: string }) {
  const { sheet, said, sending, setSaid, submit, closeSheet } = flow;
  const offer = sheet?.step === 'offer' ? sheet.offer : undefined;
  return (
    <BottomSheet open={offer !== undefined} title="Make it a rule?" onClose={closeSheet} testId={testId}>
      {offer !== undefined && <OfferForm key={`${offer.item} ${offer.contains}`} offer={offer} said={said} sending={sending} onDismiss={() => setSaid(null)} onRetry={submit} onYes={submit} onNotNow={closeSheet} />}
    </BottomSheet>
  );
}

function OfferForm({
  offer,
  said,
  sending,
  onDismiss,
  onRetry,
  onYes,
  onNotNow,
}: {
  readonly offer: Offered;
  readonly said: Said | null;
  readonly sending: boolean;
  readonly onDismiss: () => void;
  readonly onRetry: (pending: Pending) => void;
  readonly onYes: (pending: Pending) => void;
  readonly onNotNow: () => void;
}) {
  const [text, setText] = useState(offer.contains);
  const contains = text.trim();
  const label = pickLabel(offer.kind === 'money-in' ? 'money-in' : 'spending', offer.to);
  return (
    <>
      {said !== null && <SaidNotice said={said} sending={sending} onRetry={onRetry} onDismiss={onDismiss} />}
      <div className="card">
        <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
          <TextField label="When the description contains" value={text} onChange={setText} hint="Upper and lower case do not matter. A shorter piece, such as the store's name, catches more." testId="offer-text" />
          <p className="field__hint" data-testid="offer-sentence">
            {contains === '' ? 'Enter some text to match.' : ruleSentenceText(RULE_WHAT[offer.for], contains, label)}
          </p>
        </div>
      </div>
      <ButtonRow>
        <Button
          wide
          disabled={sending || contains === ''}
          testId="offer-yes"
          onClick={() =>
            onYes({ id: newDecisionId(), item: offer.item, label: offer.label, kind: offer.kind, choice: { to: offer.to }, always: { contains }, confirmed: true, resort: true })
          }
        >
          {sending ? 'Saving…' : 'Yes, always'}
        </Button>
        <Button variant="secondary" wide disabled={sending} testId="offer-not-now" onClick={onNotNow}>
          Not now
        </Button>
      </ButtonRow>
    </>
  );
}

// ----- A payday question (3.4): the same card in Review and on Payday -----

export function LeftoverDecision({ detail, busy, changed, onChoose }: { readonly detail: KeyedDetail; readonly busy: boolean; readonly changed?: boolean; readonly onChoose: Choose }) {
  const { item, options } = detail;
  if (item.type !== 'leftover' || options.type !== 'leftover') return null;
  const bucket = BUCKET_NAMES[item.bucket] ?? item.bucket;
  const target: Target = { id: item.id, label: titleOf(item), kind: item.type, seen: detail.key };
  return (
    <Decision
      testId={`item-${item.id}`}
      title={titleOf(item)}
      amount={<Money cents={item.amount} testId="item-amount" />}
      detail={`${reasonText(item)} · ${shortDate(item.date)}`}
      changed={changed === true ? changedWords(item.amount, null) : undefined}
      actions={
        <ButtonRow>
          {options.answers.map((answer) => (
            <Button
              key={answer}
              variant={answer === 'roll-over' ? 'primary' : 'secondary'}
              disabled={busy}
              testId={`answer-${answer}`}
              onClick={() =>
                onChoose(target, { leftover: answer }, {
                  final: true,
                  ask: answer === 'roll-over' ? `Keep ${moneyText(item.amount)} in ${bucket} for this pay period?` : `Move ${moneyText(item.amount)} from ${bucket} to Savings?`,
                })
              }
            >
              {answer === 'roll-over' ? 'Roll over' : 'Move to savings'}
            </Button>
          ))}
        </ButtonRow>
      }
    >
      {item.lessSincePayday > 0 && (
        <p className="decision__detail" data-testid="leftover-why">
          {lessSincePaydayWords(item.atPayday, item.lessSincePayday)}
        </p>
      )}
      <p className="decision__detail">Keep it in {bucket} for this pay period, or move it to Savings. Either answer is final.</p>
    </Decision>
  );
}

// ----- The sheet: all the choices, then "are you sure" -----

// The sheet for one item. The choices stay put (hidden) while it asks, so
// what was typed is still there after Cancel.
export function ChoiceSheet({
  flow,
  itemId,
  subject,
  title,
  testId,
  likely = false,
  children,
}: {
  readonly flow: ChoiceFlow;
  // The item the sheet is about, if it is still there. An item with nothing
  // to pick from (a payday question) has no subject but still asks first.
  readonly itemId: string | undefined;
  readonly subject: Subject | undefined;
  readonly title: string;
  readonly testId: string;
  // Also list the purchases a refund likely belongs to (A15, A18).
  readonly likely?: boolean;
  // Shown above the choices.
  readonly children?: ReactNode;
}) {
  const { sheet, said, setSaid, setSheet, closeSheet, submit, choose } = flow;
  // A32: an item that just changed takes no tap here either.
  const sending = flow.sending || (itemId !== undefined && flow.holding(itemId));
  return (
    <BottomSheet open={sheet !== null && itemId !== undefined} title={title} onClose={closeSheet} testId={testId}>
      {itemId !== undefined && sheet !== null && (
        <div key={itemId} style={{ display: 'contents' }}>
          {said !== null && <SaidNotice said={said} sending={sending} onRetry={submit} onDismiss={() => setSaid(null)} />}
          {children}
          <div hidden={sheet.step !== 'choose'} style={sheet.step === 'choose' ? { display: 'contents' } : undefined}>
            {subject !== undefined && <Choices subject={subject} busy={sending} onChoose={choose} startNotAPaycheck={sheet.step === 'choose' && sheet.notAPaycheck === true} />}
            {subject !== undefined && likely && (subject.refund || subject.likely.length > 0) && <LikelyPurchases subject={subject} busy={sending} onChoose={choose} />}
          </div>
          {sheet.step === 'confirm' && <Confirm pending={sheet.pending} busy={sending} onYes={() => submit({ ...sheet.pending, confirmed: true })} onBack={() => setSheet({ item: itemId, step: 'choose' })} />}
        </div>
      )}
    </BottomSheet>
  );
}

// What "are you sure" says for a final pick: for my paycheck, the split it would get.
export function askFor(preview: PaycheckSplitShown | null, date: IsoDate, to: PickTo): ReactNode {
  if (to !== 'paycheck' || preview === null) return undefined;
  return (
    <>
      <p>
        This starts a new pay period on {shortDate(date)}, the day it arrived. A paycheck can't be undone here.
      </p>
      <div className="card">
        <PaycheckParts preview={preview} prefix="preview" testId="paycheck-preview" />
      </div>
    </>
  );
}

// What each bucket gets from a paycheck (3.3); test ids start with prefix.
export function PaycheckParts({ preview: p, prefix, testId }: { readonly preview: PaycheckSplitShown; readonly prefix: string; readonly testId: string }) {
  return (
    <dl className="figures" data-testid={testId}>
      {p.momReserve !== undefined && (
        <>
          <dt>Mom reserve</dt>
          <dd>
            <Money cents={p.momReserve} testId={`${prefix}-mom`} />
          </dd>
        </>
      )}
      <dt>Savings</dt>
      <dd>
        <Money cents={p.savings} testId={`${prefix}-savings`} />
      </dd>
      <dt>Needs</dt>
      <dd>
        <Money cents={p.needs} testId={`${prefix}-needs`} />
      </dd>
      <dt>Wants</dt>
      <dd>
        <Money cents={p.wants} testId={`${prefix}-wants`} />
      </dd>
      {/* Her rulebook, 3.3: Wishlist's part, where the split names it. */}
      {p.wishlist !== undefined && (
        <>
          <dt>Wishlist</dt>
          <dd>
            <Money cents={p.wishlist} testId={`${prefix}-wishlist`} />
          </dd>
        </>
      )}
    </dl>
  );
}

// 20d, A15: the purchases a refund likely belongs to. A18: each one the
// money math offers can be picked as the one it is for; that is final, so it
// asks first. A29: money in to checking can be a store's refund to the debit
// card, so it shows its likely purchases too, when it has any.
export function LikelyPurchases({ subject, busy, onChoose }: { readonly subject: Subject; readonly busy: boolean; readonly onChoose: Choose }) {
  const list = subject.likely;
  const offered = subject.options.match;
  return (
    <div className="likely" data-testid="likely">
      <p className="likely__title">{subject.refund ? 'Likely purchases' : 'A refund to your debit card?'}</p>
      {!subject.refund && (
        <p className="likely__more" data-testid="likely-debit">
          A store's refund to your debit card shows up like a deposit. If this is one, it is likely for one of these.
        </p>
      )}
      {list.length === 0 ? (
        <p className="likely__more" data-testid="likely-none">
          No likely purchase found.
        </p>
      ) : (
        <>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {list.map((p) => (
              <li key={p.id} className="likely__item" data-testid={`likely-${p.id}`}>
                <span className="likely__line">
                  <span>{p.description}</span>
                  <Money cents={p.amount} />
                </span>
                <span className="likely__more">
                  {shortDate(p.date)} · {sortedWords(p.sortedTo)}
                  {p.sameName ? ' · Same name' : ''}
                  {p.sameAmount ? ' · Same amount' : ''}
                </span>
                {offered.includes(p.id) && (
                  <Button
                    variant="secondary"
                    wide
                    disabled={busy}
                    testId={`match-${p.id}`}
                    onClick={() =>
                      onChoose(subject.target, { refundOf: p.id }, {
                        final: true,
                        about: p.description,
                        ask: `${subject.target.label}, ${moneyText(subject.amount)}, is for ${p.description}, ${moneyText(p.amount)}, on ${shortDate(p.date)}. It then counts as if the bank had matched it, and goes back where that purchase came from. This can't be undone here.`,
                      })
                    }
                  >
                    This refund is for this one
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="likely__more">{offered.length > 0 ? 'If you know which one it is for, tap it. The refund then goes back where that purchase came from.' : 'Put the refund back where the purchase came from.'}</p>
        </>
      )}
    </div>
  );
}

// ----- All the choices, in a sheet -----

function Choices({ subject, busy, onChoose, startNotAPaycheck = false }: { readonly subject: Subject; readonly busy: boolean; readonly onChoose: Choose; readonly startNotAPaycheck?: boolean }) {
  const { options, target } = subject;
  const [always, setAlways] = useState(false);
  const [text, setText] = useState(subject.ruleText);
  const kind = target.kind;
  const ruleText = text.trim();
  const rule = always ? { contains: ruleText } : undefined;
  // Her rulebook, 3.1: a paycheck waiting for her yes shows what each bucket
  // would get, and yes asks first. "Not a paycheck" opens the other choices
  // of 6.1 (other income, payback, not mine).
  const [notAPaycheck, setNotAPaycheck] = useState(startNotAPaycheck);
  const asking = subject.paycheckAsk === true && subject.now === null && !notAPaycheck;
  const yes = options.picks.find((p) => p.to === 'paycheck');
  const shownPicks = subject.paycheckAsk === true && notAPaycheck ? options.picks.filter((p) => p.to !== 'paycheck') : options.picks;
  const picks = always ? shownPicks.filter((p) => options.always.includes(p.to)) : shownPicks;
  // Sorting it where it already is does nothing, unless it makes a rule (B101).
  const here = (to: PickTo): boolean => !always && subject.now !== null && 'to' in subject.now && subject.now.to === to;

  return (
    <>
      <div className="card">
        <dl className="figures">
          <dt>{subject.heading}</dt>
          <dd>
            <Money cents={subject.amount} testId="sheet-amount" />
          </dd>
          <dt>When</dt>
          <dd>{shortDate(subject.date)}</dd>
          {subject.account !== null && (
            <>
              <dt>Account</dt>
              <dd>{ACCOUNT_NAMES[subject.account]}</dd>
            </>
          )}
        </dl>
      </div>

      {subject.marked !== null && (
        <Notice tone="warning" icon="info" testId="marked-note">
          {markedWords(subject.marked)}
        </Notice>
      )}

      {options.unavailable.map((u) => (
        <Notice key={u.what} tone="warning" icon="info" testId={`unavailable-${u.what}`}>
          {u.why}
        </Notice>
      ))}

      {asking && (
        <>
          <Card title="What each bucket would get" testId="paycheck-ask">
            {subject.paycheckPreview === null ? (
              <p className="sheet__note">The parts can't be worked out for this one. Say what it is instead.</p>
            ) : (
              <div style={{ padding: 'var(--space-2) var(--space-4)' }}>
                <PaycheckParts preview={subject.paycheckPreview} prefix="ask" testId="paycheck-ask-parts" />
              </div>
            )}
          </Card>
          <p className="sheet__note">Nothing is split until you say yes. Yes starts the new pay period on {shortDate(subject.date)}, the day it arrived.</p>
          {yes !== undefined && (
            <Button
              wide
              disabled={busy}
              testId="paycheck-yes"
              onClick={() => {
                if (!busy) onChoose(target, { to: 'paycheck' }, { final: true, ask: askFor(subject.paycheckPreview, subject.date, 'paycheck') });
              }}
            >
              Yes, split it
            </Button>
          )}
          <Button variant="secondary" wide disabled={busy} testId="not-a-paycheck" onClick={() => setNotAPaycheck(true)}>
            Not a paycheck
          </Button>
        </>
      )}

      {!asking && subject.paycheckAsk === true && subject.now === null && (
        <Button variant="secondary" wide disabled={busy} testId="a-paycheck-after-all" onClick={() => setNotAPaycheck(false)}>
          It is a paycheck after all
        </Button>
      )}

      {!asking && options.always.length > 0 && (
        <div className="card">
          <ToggleRow label="Always do this" detail="Make a rule so the next one sorts itself." checked={always} onChange={setAlways} testId="always-toggle" />
          {always && (
            <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
              <TextField label="When the description contains" value={text} onChange={setText} hint="Upper and lower case do not matter. A shorter piece, such as the store's name, catches more." testId="always-text" />
            </div>
          )}
        </div>
      )}

      {!asking && (
        <Card title={always ? 'Always put it in' : subject.now === null ? (subject.paycheckAsk === true ? 'What is it, then?' : 'Put it in') : 'Put it in instead'} testId="sheet-picks">
          {picks.map((pick) =>
            here(pick.to) ? (
              <ListRow key={pick.to} title={pickLabel(kind, pick.to)} detail="It is here now." testId={`choice-${pick.to}`} />
            ) : (
              <ListRow
                key={pick.to}
                title={pickLabel(kind, pick.to)}
                detail={pick.final ? "This can't be undone here, so you'll be asked to confirm." : undefined}
                onClick={() => {
                  if (busy) return;
                  if (always && ruleText === '') return;
                  onChoose(target, { to: pick.to }, {
                    ...(rule === undefined ? {} : { always: rule }),
                    final: pick.final,
                    ask: always ? <p>{ruleSentence(subject, ruleText, pickLabel(kind, pick.to))}</p> : askFor(subject.paycheckPreview, subject.date, pick.to),
                  });
                }}
                testId={`choice-${pick.to}`}
              />
            ),
          )}
        </Card>
      )}

      {!asking && !always && options.split !== null && <SplitForm subject={subject} buckets={options.split} busy={busy} onChoose={onChoose} />}

      {!asking && !always && options.transfer.length > 0 && (
        <Card title="Transfer between my accounts" testId="sheet-transfer">
          {options.transfer.map((account) => {
            // What it does comes from the money math (5.1 to 5.3).
            const words = transferWords(options.transferOutcome[account]);
            return (
              <ListRow
                key={account}
                title={kind === 'money-in' ? `From ${ACCOUNT_NAMES[account]}` : `To ${ACCOUNT_NAMES[account]}`}
                detail={words.row}
                onClick={() => {
                  if (!busy) onChoose(target, { transfer: account }, words.done === '' ? {} : { about: words.done });
                }}
                testId={`choice-transfer-${account}`}
              />
            );
          })}
        </Card>
      )}

      {/* A21: its own choice, so Needs keeps meaning "out of Needs" (A4). */}
      {!always && options.unmark && (
        <Card title="Not a payment to the old card?" testId="sheet-unmark">
          <ListRow
            title="It was not a payment to the old card"
            detail="It becomes what the bank sent again, and waits in Review for you to sort it. The old card owes what it did before."
            onClick={() => {
              if (!busy) onChoose(target, { unmark: true });
            }}
            testId="choice-unmark"
          />
        </Card>
      )}

      {always && <p className="sheet__note">A rule picks one bucket. It can't split a purchase or mark a transfer.</p>}
    </>
  );
}

// What a rule would do, in words.
function ruleSentence(subject: Subject, text: string, label: string): string {
  return ruleSentenceText(subject.ruleWhat, text, label);
}

function SplitForm({
  subject,
  buckets,
  busy,
  onChoose,
}: {
  readonly subject: Subject;
  readonly buckets: readonly ('needs' | 'wants' | 'wishlist' | 'not-mine')[];
  readonly busy: boolean;
  readonly onChoose: Choose;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const rest = buckets[buckets.length - 1];
  const entered = buckets.slice(0, -1);
  if (rest === undefined) return null;

  // What he typed, as parts. Reading the digits is all that happens here: the
  // money math adds them up, works out "the rest", and refuses what is wrong.
  const read = (): { readonly parts: ChoicePart[] } | { readonly problem: string } => {
    const parts: ChoicePart[] = [];
    for (const bucket of entered) {
      const typed = (values[bucket] ?? '').trim();
      if (typed === '') continue;
      let cents: Cents;
      try {
        cents = parseDollars(typed);
      } catch {
        return { problem: `${BUCKET_NAMES[bucket]}: enter an amount like 4.00` };
      }
      if (cents <= 0) return { problem: `${BUCKET_NAMES[bucket]}: enter more than zero` };
      parts.push({ bucket, amount: cents });
    }
    if (parts.length === 0) return { problem: `Enter an amount for ${entered.map((b) => BUCKET_NAMES[b]).join(' or ')}` };
    parts.push({ bucket: rest, amount: 'rest' });
    return { parts };
  };
  const result = read();
  const typedAnything = entered.some((b) => (values[b] ?? '').trim() !== '');

  return (
    <Card title="Split it" testId="sheet-split">
      <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
        {entered.map((bucket) => (
          <TextField key={bucket} label={`${BUCKET_NAMES[bucket]} (dollars)`} money value={values[bucket] ?? ''} onChange={(v) => setValues((current) => ({ ...current, [bucket]: v }))} testId={`split-${bucket}`} />
        ))}
        <p className="field__hint" data-testid="split-rest">
          {BUCKET_NAMES[rest]} gets the rest.
        </p>
        {typedAnything && 'problem' in result && (
          <p className="field__hint" role="alert" data-testid="split-problem">
            {result.problem}
          </p>
        )}
        <Button
          wide
          disabled={busy || 'problem' in result}
          testId="split-submit"
          onClick={() => {
            if ('problem' in result) return;
            onChoose(subject.target, { split: result.parts });
          }}
        >
          Split it
        </Button>
      </div>
    </Card>
  );
}

// ----- Are you sure -----

function Confirm({ pending, busy, onYes, onBack }: { readonly pending: Pending; readonly busy: boolean; readonly onYes: () => void; readonly onBack: () => void }) {
  const c = pending.choice;
  const yes =
    pending.always !== undefined
      ? 'Yes, always'
      : 'leftover' in c
        ? c.leftover === 'roll-over'
          ? 'Yes, roll it over'
          : 'Yes, move it to savings'
        : 'to' in c && c.to === 'paycheck'
          ? 'Yes, this is my paycheck'
          : 'refundOf' in c
            ? "Yes, it's for this one"
            : 'Yes, do it';
  const title =
    pending.always !== undefined
      ? 'Make this a rule?'
      : 'leftover' in c
        ? 'Answer for good?'
        : 'to' in c && c.to === 'paycheck'
          ? 'Start a new pay period?'
          : 'refundOf' in c
            ? 'Match this refund?'
            : 'Are you sure?';
  return (
    <>
      <p className="sheet__title" data-testid="confirm-title">
        {title}
      </p>
      <Notice tone="warning" icon="alert" testId="confirm-ask">
        {pending.ask ?? "This can't be undone here."}
      </Notice>
      <ButtonRow>
        <Button wide disabled={busy} testId="confirm-yes" onClick={onYes}>
          {busy ? 'Saving…' : yes}
        </Button>
        <Button variant="secondary" wide disabled={busy} testId="confirm-cancel" onClick={onBack}>
          Cancel
        </Button>
      </ButtonRow>
    </>
  );
}

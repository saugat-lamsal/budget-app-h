import { formatDollars, parseDollars, type Cents, type AnyPot } from '@budget-app/money';
import type { HalfLine, SetupReadyShown as SetupReadyView, SetupResponse, SetupStep, SetupShown as SetupView, SuggestionLine } from '@budget-app/server/views';
import { useRef, useState, type ReactNode } from 'react';
import { newDecisionId, sendChoice, type Load, type Reload } from '../app/api.js';
import { SETUP_STEPS, SETUP_STEP_TITLES, pathOf, setupPath, type SetupStepName } from '../app/routes.js';
import { BackLink, BottomSheet, Button, ButtonRow, Card, Decision, Hero, HeroCount, LinkButton, ListRow, MadeUpPill, Money, Notice, Skeleton, StateMessage, TextField } from '../ui/blocks.js';
import { dayWithYear, shortDate } from '../ui/dates.js';
import { Icon } from '../ui/Icon.js';
import { POT_NAMES } from '../ui/names.js';
import { BankRuleRows, BankRuleSheet, Matches, type Editing, type Send } from './bank-rules.js';
import { pendingMisreadText, statusText, suggestionText } from './bank-rules-text.js';
import { paydayText } from './home-text.js';
import { ACCOUNT_NAMES, answerText, bankRuleText, effectLead, halfText, lookBackText, missingText, readDays, stepCount } from './setup-text.js';

// Setup day (rulebook section 14), one step per screen: what the bank shows
// today (14.1), bank rules suggested from the bank's labels (20a), transfers
// on their way (B48), the last paycheck (B42),
// handing out the starting money (14.2), and a last look before tracking
// starts (14.3). Every number comes from the server, worked out by the money
// math; the screen only shows it. His answers go to the server one at a time
// (the same desk, with decision numbers); starting asks first.

// Her rulebook, 14.2: Wishlist after wants, where the setup has it.
const POTS: readonly AnyPot[] = ['savings', 'needs', 'wants', 'wishlist', 'momReserve', 'heldForOthers'];

export function SetupScreen({ step, load, onRetry, onStarted }: { readonly step: SetupStepName; readonly load: Load<SetupView>; readonly onRetry: Reload; readonly onStarted: () => void }) {
  const index = SETUP_STEPS.indexOf(step);
  const previous = SETUP_STEPS[index - 1];
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="setup">
      <BackLink href={previous === undefined ? pathOf('home') : setupPath(previous)} label={previous === undefined ? 'Home' : SETUP_STEP_TITLES[previous]} testId="back" />
      <div className="eyebrow">
        <span data-testid="setup-step">Setup day · {stepCount(index, SETUP_STEPS.length)}</span>
        {load.status === 'ready' && load.value.madeUpData && <MadeUpPill />}
      </div>
      <h1 className="screen-title">{SETUP_STEP_TITLES[step]}</h1>
      {load.status === 'loading' && <SetupLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load setup day" detail="Check your connection, then try again." testId="setup-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && (
        <StateMessage icon="check" title="Setup day is done" detail="Tracking has started. Your numbers are on Home." testId="setup-done">
          <LinkButton href={pathOf('home')} testId="open-home">
            Open Home
          </LinkButton>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && !load.value.ready && (
        <StateMessage icon="bank" title="Setup day can't start yet" detail={`${capitalize(load.value.why)}.`} testId="setup-not-ready">
          {!load.value.madeUpData && (
            <LinkButton href="/bank" testId="setup-bank-connection">
              Bank connection
            </LinkButton>
          )}
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && load.value.ready && <SetupReady key={step} step={step} view={load.value} reload={onRetry} onStarted={onStarted} />}
    </main>
  );
}

function SetupLoading() {
  return (
    <div data-testid="setup-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading setup day</span>
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

// ----- Sending his answers -----

interface Sender {
  readonly sending: boolean;
  readonly problem: string | null;
  // Sends one answer. A retry of the same answer keeps its decision number.
  // A sheet says what went wrong itself (inSheet); otherwise the screen does.
  // Null while another answer is on its way; 'failed' when no answer came.
  readonly send: (step: SetupStep, options?: { readonly yes?: { readonly seen: string }; readonly inSheet?: boolean }) => Promise<SetupResponse | 'failed' | null>;
}

const NO_SIGNAL = "Couldn't save that. Check your connection and try again. Nothing is counted twice.";

function useSender(reload: Reload, view: SetupReadyView): Sender {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A second tap before the screen has redrawn must not send a second request.
  const lock = useRef(false);
  // Nor one after an answer went through, while the screen still shows the
  // numbers from before it (B92; CI's WebKit runner, PR #17): the buttons stay
  // off until the numbers asked for after the answer are shown.
  const [answeredOn, setAnsweredOn] = useState<SetupReadyView | null>(null);
  const attempt = useRef<{ readonly key: string; readonly id: string } | null>(null);
  const send = async (step: SetupStep, options: { readonly yes?: { readonly seen: string }; readonly inSheet?: boolean } = {}): Promise<SetupResponse | 'failed' | null> => {
    if (lock.current) return null;
    const { yes, inSheet = false } = options;
    const key = JSON.stringify([step, yes ?? null]);
    const id = attempt.current?.key === key ? attempt.current.id : newDecisionId();
    attempt.current = { key, id };
    lock.current = true;
    setSending(true);
    setProblem(null);
    try {
      const answer = await sendChoice({ id, setup: step, ...(yes === undefined ? {} : { confirmed: true, seen: yes.seen }) });
      if (answer.ok) {
        attempt.current = null;
        setAnsweredOn(view);
        reload('after');
      } else if (answer.code !== 'needs-confirmation' && !inSheet) setProblem(answer.why);
      return answer;
    } catch {
      if (!inSheet) setProblem(NO_SIGNAL);
      return 'failed';
    } finally {
      lock.current = false;
      setSending(false);
    }
  };
  return { sending: sending || answeredOn === view, problem, send };
}

// ----- The steps -----

function SetupReady({ step, view, reload, onStarted }: { readonly step: SetupStepName; readonly view: SetupReadyView; readonly reload: Reload; readonly onStarted: () => void }) {
  const sender = useSender(reload, view);
  const next = SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1];
  return (
    <>
      {sender.problem !== null && (
        <Notice tone="danger" icon="alert" testId="setup-problem" sticky>
          {sender.problem}
        </Notice>
      )}
      {step === 'bank' && <BankStep view={view} />}
      {step === 'rules' && <RulesStep view={view} sender={sender} reload={reload} />}
      {step === 'transfers' && <TransfersStep view={view} sender={sender} />}
      {step === 'paycheck' && <PaycheckStep view={view} sender={sender} />}
      {step === 'assign' && <AssignStep view={view} sender={sender} />}
      {step === 'check' && <CheckStep view={view} sender={sender} reload={reload} onStarted={onStarted} />}
      {next !== undefined && (
        <LinkButton href={setupPath(next)} wide testId="next">
          Next: {SETUP_STEP_TITLES[next]}
        </LinkButton>
      )}
    </>
  );
}

// Step 1, 14.1: each account as the bank shows it, with its charges pending.
function BankStep({ view }: { readonly view: SetupReadyView }) {
  return (
    <>
      <Hero label="Starting money" sub={`Checking + savings − ${cardsWord(view)}, with the charges still pending. Transfers on their way come next.`} testId="setup-hero">
        <Money cents={view.bankSide} hero testId="bank-side" />
      </Hero>
      <Card title="Your accounts today" testId="accounts">
        <dl className="figures">
          <AccountFigure name="Checking" line={view.checking} testId="checking" />
          <AccountFigure name="Savings" line={view.savings} testId="savings" />
          <AccountFigure name={`${ACCOUNT_NAMES['everyday-card']} owes`} line={view.everydayCard} testId="everyday-card" owes />
          {view.secondCard !== undefined && <AccountFigure name={`${ACCOUNT_NAMES['second-card']} owes`} line={view.secondCard} testId="second-card" owes />}
          <dt className="figures__total">Starting money</dt>
          <dd className="figures__total">
            <Money cents={view.bankSide} testId="bank-side-total" />
          </dd>
        </dl>
      </Card>
      <Card title="Charges still pending" testId="pending">
        {view.pendingCharges.filter((c) => c.account !== 'old-card').length === 0 ? (
          <p className="card__note" data-testid="pending-none">
            Nothing is pending.
          </p>
        ) : (
          view.pendingCharges.filter((c) => c.account !== 'old-card').map((c) => (
            <ListRow key={c.id} title={c.description} detail={`${ACCOUNT_NAMES[c.account]} · ${shortDate(c.date)}`} trailing={<Money cents={c.amount} testId={`pending-${c.id}`} />} testId={`pending-row-${c.id}`} />
          ))
        )}
        <p className="card__note">They count now, from the day of the purchase. Money still pending into your accounts counts once it posts.</p>
      </Card>
      {/* "Off in this setup": with no old card, nothing about one. */}
      {view.oldCard !== undefined && (
      <Card title="Old card" testId="old-card">
        <dl className="figures">
          <dt>Owes, as the bank shows it</dt>
          <dd>
            <Money cents={view.oldCard.posted} testId="old-posted" />
          </dd>
          <dt>Charges pending</dt>
          <dd>
            <Money cents={view.oldCard.pending} testId="old-pending" />
          </dd>
          <dt className="figures__total">Debt to pay off</dt>
          <dd className="figures__total">
            <Money cents={view.oldCard.debt} testId="old-debt" />
          </dd>
        </dl>
        {view.pendingCharges
          .filter((c) => c.account === 'old-card')
          .map((c) => (
            <ListRow key={c.id} title={c.description} detail={`Pending · ${shortDate(c.date)}`} trailing={<Money cents={c.amount} testId={`pending-${c.id}`} />} testId={`pending-row-${c.id}`} />
          ))}
        <p className="card__note">Tracked apart as debt. It is not part of the starting money.</p>
      </Card>
      )}
    </>
  );
}

// 14.2: the cards whose balances come off: her setup has two (her rulebook, section 1).
function cardsWord(view: Pick<SetupReadyView, 'secondCard'>): string {
  return view.secondCard === undefined ? 'everyday card' : 'both cards';
}

function AccountFigure({ name, line, owes = false, testId }: { readonly name: string; readonly line: SetupReadyView['checking']; readonly owes?: boolean; readonly testId: string }) {
  return (
    <>
      <dt>
        {name}
        <span className="row__detail" style={{ display: 'block' }} data-testid={`${testId}-detail`}>
          {' '}
          The bank shows <Money cents={line.posted} testId={`${testId}-posted`} />
          {line.pending === 0 ? (
            ', nothing pending.'
          ) : (
            <>
              , {owes ? 'plus' : 'less'} <Money cents={line.pending} testId={`${testId}-pending`} /> pending.
            </>
          )}
        </span>
      </dt>
      <dd>
        <Money cents={line.withPending} testId={`${testId}-counts`} />
      </dd>
    </>
  );
}

// Step 2, 20a: bank rules suggested from the labels in the bank's history,
// each to add, change, or skip; and the rules as they are, to change. The
// next steps read the history with them as they are now (24c).
function RulesStep({ view, sender, reload }: { readonly view: SetupReadyView; readonly sender: Sender; readonly reload: Reload }) {
  const [editing, setEditing] = useState<{ readonly editing: Editing; readonly suggestion: string | null } | null>(null);
  // Each opening of the sheet is a new sheet, filled in as things are then.
  const [opened, setOpened] = useState(0);
  const open = (e: { readonly editing: Editing; readonly suggestion: string | null }): void => {
    setOpened((n) => n + 1);
    setEditing(e);
  };
  const suggestion = editing?.suggestion ?? null;
  const send: Send = async (id, change, yes) => {
    const ok = yes === undefined ? {} : { confirmed: true, seen: yes.seen };
    try {
      // A suggestion changed before it is added is his answer to it (20a).
      if (suggestion !== null && 'add' in change) return await sendChoice({ id, setup: { suggestion: { id: suggestion, answer: 'change', rule: change.add } }, ...ok });
      return await sendChoice({ id, bankRule: change, ...ok });
    } catch {
      return 'failed';
    }
  };
  const left = view.unansweredSuggestions;
  return (
    <>
      <Hero label="Suggestions to answer" sub={view.suggestions.length === 0 ? 'Nothing to suggest.' : left === 0 ? 'Every suggestion is answered.' : 'Add, change, or skip each one.'} testId="setup-hero">
        <HeroCount count={left} testId="suggestions-left" />
      </Hero>
      <Card title="Suggested from your bank’s labels" testId="suggestions">
        <p className="card__note">Your bank labels each item. From those labels, these rules would tell your transfers, payments to people, and card fees from purchases. Nothing is assumed: each one is yours to add, change, or skip.</p>
        {view.suggestions.length === 0 ? (
          <p className="card__note" data-testid="suggestions-none">
            Nothing in your history has a label to suggest a rule from.
          </p>
        ) : (
          view.suggestions.map((s) => (
            <SuggestionDecision
              key={s.id}
              s={s}
              sender={sender}
              onChange={() => open({ editing: { start: { account: s.account, contains: s.contains, means: s.means, ...(s.other === null ? {} : { other: s.other }) }, title: 'Change it first' }, suggestion: s.id })}
            />
          ))
        )}
      </Card>
      <Card title="Your bank rules" testId="setup-bank-rules">
        {view.bankRules.length === 0 ? (
          <p className="card__note" data-testid="bank-rules-none">
            None yet.
          </p>
        ) : (
          <BankRuleRows rules={view.bankRules} onOpen={(rule) => open({ editing: { rule }, suggestion: null })} />
        )}
        <ListRow icon="settings" title="Add a bank rule" onClick={() => open({ editing: { start: null, title: 'New bank rule' }, suggestion: null })} testId="row-add-bank-rule" />
        <p className="card__note">The first rule that fits wins. The next steps read your history with these rules as they are now; Settings can change them later.</p>
      </Card>
      {editing !== null && (
        <BankRuleSheet
          key={opened}
          editing={editing.editing}
          rules={view.bankRules}
          {...(view.accounts === undefined ? {} : { accounts: view.accounts })}
          send={send}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload('after');
          }}
        />
      )}
    </>
  );
}

function SuggestionDecision({ s, sender, onChange }: { readonly s: SuggestionLine; readonly sender: Sender; readonly onChange: () => void }) {
  const added = s.status === 'added' || s.status === 'changed';
  const toPick = s.means === 'transfer' && s.other === null;
  return (
    <Decision
      title={suggestionText(s)}
      detail={`Your bank labels these ${s.label}.`}
      testId={`suggestion-${s.id}`}
      actions={
        s.status === 'covered' ? null : (
          <ButtonRow>
            <Button variant={added ? 'primary' : 'secondary'} disabled={sender.sending || added || toPick} testId="suggestion-add" onClick={() => void sender.send({ suggestion: { id: s.id, answer: 'add' } })}>
              {added && <Icon name="check" size={16} />}
              Add this rule
            </Button>
            <Button variant="secondary" disabled={sender.sending || added} testId="suggestion-change" onClick={onChange}>
              Change it first
            </Button>
            <Button variant={s.status === 'skipped' ? 'primary' : 'secondary'} disabled={sender.sending || s.status !== 'open'} testId="suggestion-skip" onClick={() => void sender.send({ suggestion: { id: s.id, answer: 'skip' } })}>
              {s.status === 'skipped' && <Icon name="check" size={16} />}
              Skip
            </Button>
          </ButtonRow>
        )
      }
    >
      {s.pending !== null && (
        <p className="decision__detail" data-testid="suggestion-pending">
          <span>{pendingMisreadText(s.pending)}</span>
        </p>
      )}
      <Matches matches={s.matches} recentDays={null} testId="suggestion-matches" />
      {toPick && !added && (
        <p className="decision__detail" data-testid="suggestion-pick">
          <span>Which account it is with does not show in your history: change it to pick the account.</span>
        </p>
      )}
      <p className="decision__detail" data-testid="suggestion-status">
        <strong>{statusText(s.status)}</strong>
      </p>
    </Decision>
  );
}

// Step 3, B48: each transfer with one half showing, on its way or not.
function TransfersStep({ view, sender }: { readonly view: SetupReadyView; readonly sender: Sender }) {
  const [lookBack, setLookBack] = useState(false);
  return (
    <>
      <Hero
        label="Starting money"
        sub={view.halves.length === 0 ? 'Nothing to answer here.' : view.unanswered === 0 ? 'Every transfer is answered.' : `${view.unanswered} still to answer.`}
        testId="setup-hero"
      >
        <Money cents={view.startingMoney} hero testId="starting-money" />
      </Hero>
      {view.missing.includes('suggestions') && (
        <Notice tone="warning" icon="alert" testId="rules-first">
          Answer the suggested bank rules first: they decide which items are transfers.
        </Notice>
      )}
      <Card title="How far back" testId="look-back">
        <ListRow title="Transfers from" detail={lookBackText(view.halvesWithinDays)} onClick={() => setLookBack(true)} testId="look-back-row" />
        <p className="card__note">A transfer lands within a few days, so an older one is history. Changing this drops your answers about transfers it no longer asks about.</p>
      </Card>
      {view.halves.length === 0 ? (
        <StateMessage icon="check" title="Nothing on its way" detail={`Every transfer between your accounts from ${lookBackText(view.halvesWithinDays).toLowerCase()} shows both sides.`} testId="transfers-none" />
      ) : (
        <Card title="Only one side shows" testId="halves">
          <p className="card__note">Say whether each is still on its way. The starting money follows your answers.</p>
          {view.halves.map((half) => (
            <HalfDecision key={half.id} half={half} sender={sender} />
          ))}
        </Card>
      )}
      {lookBack && <LookBackSheet view={view} sender={sender} onClose={() => setLookBack(false)} />}
    </>
  );
}

// A25: how many days back setup day asks about transfers with one side showing.
function LookBackSheet({ view, sender, onClose }: { readonly view: SetupReadyView; readonly sender: Sender; readonly onClose: () => void }) {
  const [text, setText] = useState(String(view.halvesWithinDays));
  const [problem, setProblem] = useState<string | null>(null);
  const days = readDays(text);
  const save = (): void => {
    if (days === null) return;
    void sender.send({ lookBack: days }, { inSheet: true }).then((answer) => {
      if (answer === 'failed') setProblem(NO_SIGNAL);
      else if (answer?.ok === true) onClose();
      else if (answer !== null && !answer.ok) setProblem(answer.why);
    });
  };
  return (
    <BottomSheet open title="How far back" onClose={onClose} testId="look-back-sheet">
      {problem !== null && (
        <Notice tone="danger" icon="alert" testId="sheet-problem">
          {problem}
        </Notice>
      )}
      <div className="card" style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
        <TextField label="Days back" kind="whole" value={text} onChange={setText} hint="0 is today only." testId="look-back-days" />
        {days === null && text.trim() !== '' && (
          <p className="field__hint" role="alert" data-testid="sheet-reading">
            Enter a whole number of days, like 10
          </p>
        )}
      </div>
      <Button wide disabled={sender.sending || days === null} testId="sheet-save" onClick={save}>
        {sender.sending ? 'Saving…' : 'Save'}
      </Button>
    </BottomSheet>
  );
}

function HalfDecision({ half, sender }: { readonly half: HalfLine; readonly sender: Sender }) {
  return (
    <Decision
      title={half.description}
      amount={<Money cents={half.amount} />}
      detail={halfText(half)}
      testId={`half-${half.id}`}
      actions={
        <ButtonRow>
          <Button variant={half.onItsWay === true ? 'primary' : 'secondary'} disabled={sender.sending || half.onItsWay === true} testId="on-its-way" onClick={() => void sender.send({ onItsWay: { half: half.id, answer: true } })}>
            {half.onItsWay === true && <Icon name="check" size={16} />}
            On its way
          </Button>
          <Button variant={half.onItsWay === false ? 'primary' : 'secondary'} disabled={sender.sending || half.onItsWay === false} testId="not-on-its-way" onClick={() => void sender.send({ onItsWay: { half: half.id, answer: false } })}>
            {half.onItsWay === false && <Icon name="check" size={16} />}
            Not on its way
          </Button>
        </ButtonRow>
      }
    >
      <p className="decision__detail" data-testid="effect">
        <span>
          {half.effect === 0 ? (
            effectLead(half)
          ) : (
            <>
              If it is on its way: <Money cents={half.effect} signed testId="effect-amount" /> to the starting money. {effectLead(half)}
            </>
          )}
        </span>
      </p>
      <p className="decision__detail" data-testid="rule">
        <span>{half.rule === null ? 'No bank rule names it.' : `Read as a transfer by the bank rule ${bankRuleText(half.rule)}.`}</span>
      </p>
      <p className="decision__detail" data-testid="answer">
        <strong>{answerText(half.onItsWay)}</strong>
      </p>
    </Decision>
  );
}

// Step 4, B42: his last paycheck, which the pay schedule counts from.
function PaycheckStep({ view, sender }: { readonly view: SetupReadyView; readonly sender: Sender }) {
  const [open, setOpen] = useState(false);
  const last = view.lastPaycheck;
  return (
    <>
      <Hero label="Next payday" sub={last === null ? 'Enter your last paycheck to see it.' : paydayText(last.daysToPayday)} testId="setup-hero">
        <span className="hero__count" data-testid="next-payday">
          {last === null ? 'Not yet' : shortDate(last.nextPayday)}
        </span>
      </Hero>
      <Card title="Your last paycheck" testId="paycheck">
        <ListRow title="Day it came in" detail={last === null ? 'Not entered yet' : dayWithYear(last.date)} onClick={() => setOpen(true)} testId="last-paycheck" />
        <p className="card__note">
          {view.paySchedule === 'twice-a-month'
            ? 'Paydays are twice a month, on the 15th and the last day of the month (the Friday before when that is a weekend), counted from your last paycheck, until the next one comes in.'
            : `Paydays are every ${view.payScheduleDays} days, counted from your last paycheck, until the next one comes in.`}{' '}
          It can be today, not after.
        </p>
      </Card>
      {open && <DateSheet view={view} sender={sender} onClose={() => setOpen(false)} />}
    </>
  );
}

function DateSheet({ view, sender, onClose }: { readonly view: SetupReadyView; readonly sender: Sender; readonly onClose: () => void }) {
  const [date, setDate] = useState(view.lastPaycheck?.date ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = (): void => {
    if (date === '') {
      setProblem('Pick a date');
      return;
    }
    void sender.send({ lastPaycheck: date }, { inSheet: true }).then((answer) => {
      if (answer === 'failed') setProblem(NO_SIGNAL);
      else if (answer?.ok === true) onClose();
      else if (answer !== null && !answer.ok) setProblem(answer.why);
    });
  };
  return (
    <BottomSheet open title="Your last paycheck" onClose={onClose} testId="date-sheet">
      {problem !== null && (
        <Notice tone="danger" icon="alert" testId="sheet-problem">
          {problem}
        </Notice>
      )}
      <div className="card" style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
        <TextField label="Day it came in" kind="date" value={date} onChange={setDate} testId="date" />
      </div>
      <Button wide disabled={sender.sending} testId="sheet-save" onClick={save}>
        {sender.sending ? 'Saving…' : 'Save'}
      </Button>
    </BottomSheet>
  );
}

// Step 5, 14.2: the starting money handed out across the buckets. What is
// left to assign comes from the server after every amount.
function AssignStep({ view, sender }: { readonly view: SetupReadyView; readonly sender: Sender }) {
  const [editing, setEditing] = useState<AnyPot | null>(null);
  return (
    <>
      <Hero label="Left to assign" sub={<LeftWords view={view} />} testId="setup-hero">
        <Money cents={view.leftToAssign} hero testId="left-to-assign" />
      </Hero>
      <Card title="Where it goes" testId="assignment">
        {potsOf(view).map(([pot, cents]) => (
          <ListRow key={pot} title={POT_NAMES[pot]} trailing={<Money cents={cents} testId={`assigned-${pot}`} />} onClick={() => setEditing(pot)} testId={`assign-${pot}`} />
        ))}
        <dl className="figures">
          <dt>Assigned</dt>
          <dd>
            <Money cents={view.assigned} testId="assigned" />
          </dd>
          <dt>Starting money</dt>
          <dd>
            <Money cents={view.startingMoney} testId="starting-money" />
          </dd>
        </dl>
        <p className="card__note">Tracking starts only when it is handed out to the cent. Below zero is allowed: when the card owes more than you have, that is where it starts.</p>
      </Card>
      {editing !== null && <AmountSheet pot={editing} view={view} sender={sender} onClose={() => setEditing(null)} />}
    </>
  );
}

// The buckets the starting money goes to, in order, with what each has: the
// mom reserve only when this setup has one ("Off in this setup").
function potsOf(view: SetupReadyView): (readonly [AnyPot, Cents])[] {
  return POTS.flatMap((pot) => {
    const cents = view.assignment[pot];
    return cents === undefined ? [] : [[pot, cents] as const];
  });
}

function LeftWords({ view }: { readonly view: SetupReadyView }): ReactNode {
  if (view.leftToAssign === 0) return 'All of it is handed out, to the cent.';
  if (view.leftToAssign > 0) return 'Still to hand out.';
  return 'More is handed out than there is. Take some back.';
}

function AmountSheet({ pot, view, sender, onClose }: { readonly pot: AnyPot; readonly view: SetupReadyView; readonly sender: Sender; readonly onClose: () => void }) {
  const [text, setText] = useState(() => typed(view.assignment[pot] ?? 0));
  const [problem, setProblem] = useState<string | null>(null);
  const amount = readAmount(text);
  const finish = (answer: SetupResponse | 'failed' | null): void => {
    if (answer === 'failed') setProblem(NO_SIGNAL);
    else if (answer?.ok === true) onClose();
    else if (answer !== null && !answer.ok) setProblem(answer.why);
  };
  return (
    <BottomSheet open title={POT_NAMES[pot]} onClose={onClose} testId="amount-sheet">
      {problem !== null && (
        <Notice tone="danger" icon="alert" testId="sheet-problem">
          {problem}
        </Notice>
      )}
      <div className="card" style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
        <TextField label="Amount" money value={text} onChange={setText} hint="Like 1,500.00. Below zero starts with a minus sign." testId="amount" />
        {amount === null && text.trim() !== '' && (
          <p className="field__hint" role="alert" data-testid="sheet-reading">
            Enter an amount like 1,500.00
          </p>
        )}
      </div>
      <Button wide disabled={sender.sending || amount === null} testId="sheet-save" onClick={() => amount !== null && void sender.send({ assign: { pot, amount } }, { inSheet: true }).then(finish)}>
        {sender.sending ? 'Saving…' : 'Save'}
      </Button>
      <Button variant="secondary" wide disabled={sender.sending || view.leftToAssign === 0} testId="sheet-rest" onClick={() => void sender.send({ assign: { pot, rest: true } }, { inSheet: true }).then(finish)}>
        Put what is left here
      </Button>
      <p className="sheet__note">What is left to assign is worked out for you after you save.</p>
    </BottomSheet>
  );
}

// An amount as typed: 1,500.00, -1,756.47, or with the minus sign the app shows.
function readAmount(text: string): Cents | null {
  try {
    return parseDollars(text.trim().replace(/^[−–]/, '-'));
  } catch {
    return null;
  }
}

function typed(cents: Cents): string {
  return formatDollars(cents).replace('$', '');
}

// Step 6, 14.3: a last look at everything, then start. It asks first.
function CheckStep({ view, sender, reload, onStarted }: { readonly view: SetupReadyView; readonly sender: Sender; readonly reload: Reload; readonly onStarted: () => void }) {
  const [asked, setAsked] = useState<{ readonly why: string; readonly key: string } | null>(null);
  // What the server said after his yes, when it did not start.
  const [after, setAfter] = useState<string | null>(null);
  const [sheetProblem, setSheetProblem] = useState<string | null>(null);
  const start = (yes?: { readonly seen: string }): void => {
    setAfter(null);
    setSheetProblem(null);
    void sender.send({ start: true }, yes === undefined ? {} : { yes, inSheet: true }).then((answer) => {
      if (answer === null) return;
      if (answer === 'failed') {
        setSheetProblem(NO_SIGNAL);
        return;
      }
      if (answer.ok) {
        setAsked(null);
        onStarted();
      } else if (answer.code === 'needs-confirmation' && yes === undefined) {
        setAsked({ why: answer.why, key: view.key });
      } else {
        // Refused after his yes, or what he saw has changed: he looks again first.
        setAsked(null);
        setAfter(answer.why);
        reload();
      }
    });
  };
  return (
    <>
      <Hero label="Starting money" sub={`Checking + savings − ${cardsWord(view)}, with charges pending and money on its way.`} testId="setup-hero">
        <Money cents={view.startingMoney} hero testId="starting-money" />
      </Hero>
      {after !== null && (
        <Notice tone="warning" icon="alert" testId="setup-after">
          {after}
        </Notice>
      )}
      {view.missing.length > 0 ? (
        <Notice tone="warning" icon="alert" testId="missing">
          <p>Before tracking can start:</p>
          <ul>
            {view.missing.map((m) => (
              <li key={m} data-testid={`missing-${m}`}>
                {missingText(m, view.unanswered)}
                {m === 'assignment' && (
                  <>
                    {' '}
                    Left to assign: <Money cents={view.leftToAssign} testId="missing-left" />.
                  </>
                )}
              </li>
            ))}
          </ul>
        </Notice>
      ) : (
        view.selfCheck !== null && (
          <>
            <Notice tone="ok" icon="check" testId="self-check-passes">
              The self-check passes: the bank and money on its way match your buckets to the cent.
            </Notice>
            <Card title="Self-check" testId="self-check">
              <dl className="figures">
                <dt>The bank: checking + savings − {cardsWord(view)}</dt>
                <dd>
                  <Money cents={view.selfCheck.bankSide} testId="check-bank" />
                </dd>
                <dt>Money on its way between your accounts</dt>
                <dd>
                  <Money cents={view.selfCheck.inTransit} testId="check-transit" />
                </dd>
                <dt>Your buckets added up</dt>
                <dd>
                  <Money cents={view.selfCheck.appSide} testId="check-app" />
                </dd>
                <dt className="figures__total">Difference</dt>
                <dd className="figures__total">
                  <Money cents={view.selfCheck.difference} testId="check-difference" />
                </dd>
              </dl>
            </Card>
          </>
        )
      )}
      <Card title="Starting money" testId="check-money">
        <dl className="figures">
          <dt>The bank, with charges pending</dt>
          <dd>
            <Money cents={view.bankSide} testId="check-bank-side" />
          </dd>
          <dt>Money on its way</dt>
          <dd>
            <Money cents={view.inTransit} testId="check-in-transit" />
          </dd>
          <dt className="figures__total">Starting money</dt>
          <dd className="figures__total">
            <Money cents={view.startingMoney} testId="check-starting-money" />
          </dd>
        </dl>
      </Card>
      <Card title="Where it goes" testId="check-assignment">
        <dl className="figures">
          {potsOf(view).map(([pot, cents]) => (
            <Fragmented key={pot} label={POT_NAMES[pot]}>
              <Money cents={cents} testId={`check-${pot}`} />
            </Fragmented>
          ))}
          <dt className="figures__total">Left to assign</dt>
          <dd className="figures__total">
            <Money cents={view.leftToAssign} testId="check-left" />
          </dd>
        </dl>
      </Card>
      <Card title={view.oldCard === undefined ? 'Paydays' : 'Paydays and the old card'} testId="check-other">
        <ListRow title="Last paycheck" detail={view.lastPaycheck === null ? 'Not entered yet' : `${dayWithYear(view.lastPaycheck.date)}. Next payday ${shortDate(view.lastPaycheck.nextPayday)}.`} testId="check-paycheck" />
        {view.oldCard !== undefined && <ListRow title="Old card debt" detail="Tracked apart, not part of the starting money." trailing={<Money cents={view.oldCard.debt} testId="check-old-debt" />} testId="check-old" />}
      </Card>
      <Card title="Bank rules" testId="bank-rules">
        <p className="card__note">How the app tells your transfers, payments to people, and card fees from purchases. Set on the Bank rules step; Settings can change them later.</p>
        {view.bankRules.length === 0 ? (
          <p className="card__note" data-testid="bank-rules-none">
            None yet.
          </p>
        ) : (
          view.bankRules.map((rule) => <ListRow key={rule.id} title={bankRuleText(rule)} testId={`bank-rule-${rule.id}`} />)
        )}
      </Card>
      <Button wide disabled={sender.sending} testId="start" onClick={() => start()}>
        {sender.sending && asked === null ? 'Checking…' : 'Start tracking'}
      </Button>
      <p className="sheet__note">Once tracking starts, setup day is done. Amounts can still be moved between buckets by hand.</p>
      <BottomSheet open={asked !== null} title="Start tracking?" onClose={() => setAsked(null)} testId="start-sheet">
        {asked !== null && (
          <>
            <Notice tone="warning" icon="alert" testId="confirm-ask">
              {asked.why}
            </Notice>
            {sheetProblem !== null && (
              <Notice tone="danger" icon="alert" testId="sheet-problem">
                {sheetProblem}
              </Notice>
            )}
            <div className="card">
              <dl className="figures">
                <dt>Starting money</dt>
                <dd>
                  <Money cents={view.startingMoney} testId="confirm-starting-money" />
                </dd>
                <dt>Last paycheck</dt>
                <dd>{view.lastPaycheck === null ? 'Not entered' : shortDate(view.lastPaycheck.date)}</dd>
              </dl>
            </div>
            <ButtonRow>
              <Button wide disabled={sender.sending} testId="confirm-yes" onClick={() => start({ seen: asked.key })}>
                {sender.sending ? 'Starting…' : 'Yes, start tracking'}
              </Button>
              <Button variant="secondary" wide disabled={sender.sending} testId="confirm-cancel" onClick={() => setAsked(null)}>
                Cancel
              </Button>
            </ButtonRow>
          </>
        )}
      </BottomSheet>
    </>
  );
}

function Fragmented({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

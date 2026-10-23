import { MOVABLE_POTS, parseDollars, type Cents, type Pot } from '@budget-app/money';
import { useEffect, useRef, useState } from 'react';
import { newDecisionId, sendChoice } from '../app/api.js';
import { BottomSheet, Button, ButtonRow, Notice, SelectField, TextField } from '../ui/blocks.js';
import { moneyText } from '../ui/money-format.js';
import { POT_NAMES } from '../ui/names.js';

// Moving money between buckets by hand (rules 13.3, 13.4; QUESTIONS.md B103).
// He picks where it comes from, where it goes, and how much. The money math
// on the server decides: it says when it needs his yes first (money out of
// savings or the mom reserve, or a move that would leave a bucket below
// zero), and a refusal changes nothing and says why. The screen only reads
// the digits. The same move sent twice, as a retry, changes nothing the
// second time.

export function MoveMoney({
  open,
  onClose,
  balances,
  start,
  onMoved,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  // What every bucket holds now. A bucket that is not there ("Off in this
  // setup": the mom reserve) is not offered.
  readonly balances: Readonly<Partial<Record<Pot, Cents>>>;
  // Where it comes from and goes to, to begin with.
  readonly start: { readonly from: Pot; readonly to: Pot };
  // He moved it: what to say.
  readonly onMoved: (said: string) => void;
}) {
  const [from, setFrom] = useState<Pot>(start.from);
  const [to, setTo] = useState<Pot>(start.to);
  const [typed, setTyped] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  // What the server said when it asked first (13.4).
  const [asked, setAsked] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A second tap before the screen has redrawn must not send a second request.
  const lock = useRef(false);
  // The decision number goes with the move: the same move sent again (a retry, or his yes after it asked) keeps it.
  const attempt = useRef<{ readonly key: string; readonly id: string } | null>(null);

  // A sheet opened later starts clean.
  useEffect(() => {
    if (!open) return;
    setFrom(start.from);
    setTo(start.to);
    setTyped('');
    setStep('form');
    setAsked('');
    setProblem(null);
    attempt.current = null;
  }, [open, start.from, start.to]);

  // Reading the digits is all that happens here: the money math decides the rest.
  const read = (): { readonly cents: Cents } | { readonly problem: string } => {
    const text = typed.trim();
    if (text === '') return { problem: 'Enter an amount like 25.00' };
    let cents: Cents;
    try {
      cents = parseDollars(text);
    } catch {
      return { problem: 'Enter an amount like 25.00' };
    }
    if (cents <= 0) return { problem: 'Enter more than zero' };
    return { cents };
  };
  const amount = read();

  const send = (confirmed: boolean): void => {
    if (lock.current || 'problem' in amount) return;
    const cents = amount.cents;
    const key = `${from}|${to}|${cents}`;
    const id = attempt.current?.key === key ? attempt.current.id : newDecisionId();
    attempt.current = { key, id };
    lock.current = true;
    setSending(true);
    setProblem(null);
    sendChoice({ id, move: { from, to, amount: cents }, ...(confirmed ? { confirmed: true } : {}) }).then(
      (answer) => {
        lock.current = false;
        setSending(false);
        if (answer.ok) {
          onMoved(`Moved ${moneyText(cents)} from ${POT_NAMES[from]} to ${POT_NAMES[to]}.`);
          onClose();
        } else if (answer.code === 'needs-confirmation') {
          setAsked(answer.why);
          setStep('confirm');
        } else {
          // Refused: nothing changed. Back to the form, with the reason.
          setStep('form');
          setProblem(answer.why);
        }
      },
      () => {
        lock.current = false;
        setSending(false);
        setProblem("Couldn't save that. Check your connection and try again. Nothing is counted twice.");
      },
    );
  };

  const options = MOVABLE_POTS.flatMap((pot) => {
    const held = balances[pot];
    return held === undefined ? [] : [{ value: pot, label: `${POT_NAMES[pot]} · ${moneyText(held)}` }];
  });
  const reading = typed.trim() !== '' && 'problem' in amount ? amount.problem : null;

  return (
    <BottomSheet open={open} title={step === 'confirm' ? 'Are you sure?' : 'Move money'} onClose={onClose} testId="move-sheet">
      {step === 'form' && (
        <>
          {problem !== null && (
            <Notice tone="danger" icon="alert" testId="move-problem">
              {problem}
            </Notice>
          )}
          <div className="card" style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
            <SelectField label="From" value={from} onChange={(v) => setFrom(v as Pot)} options={options} testId="move-from" />
            <SelectField label="To" value={to} onChange={(v) => setTo(v as Pot)} options={options} testId="move-to" />
            <TextField label="Amount (dollars)" money value={typed} onChange={setTyped} testId="move-amount" />
            {reading !== null && (
              <p className="field__hint" role="alert" data-testid="move-reading">
                {reading}
              </p>
            )}
          </div>
          <Button wide disabled={sending || 'problem' in amount} testId="move-submit" onClick={() => send(false)}>
            {sending ? 'Saving…' : 'Move it'}
          </Button>
          <p className="sheet__note">This only moves money between your buckets in this app. It never moves money at the bank.</p>
        </>
      )}
      {step === 'confirm' && 'cents' in amount && (
        <>
          <p className="sheet__title" data-testid="move-confirm-title">
            Move {moneyText(amount.cents)} out of {POT_NAMES[from]}?
          </p>
          <Notice tone="warning" icon="alert" testId="move-confirm-ask">
            {asked}
          </Notice>
          <ButtonRow>
            <Button wide disabled={sending} testId="move-confirm-yes" onClick={() => send(true)}>
              {sending ? 'Saving…' : 'Yes, move it'}
            </Button>
            <Button variant="secondary" wide disabled={sending} testId="move-confirm-cancel" onClick={() => setStep('form')}>
              Cancel
            </Button>
          </ButtonRow>
          {problem !== null && (
            <Notice tone="danger" icon="alert" testId="move-problem">
              {problem}
            </Notice>
          )}
        </>
      )}
    </BottomSheet>
  );
}

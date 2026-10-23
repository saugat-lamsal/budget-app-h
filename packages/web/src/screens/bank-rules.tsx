import type { AccountId } from '@budget-app/money';
import type { BankMeaning, BankRule, BankRuleChange, BankRulePreview, BankRuleSpec, RuleMatches } from '@budget-app/server/views';
import { useRef, useState } from 'react';
import { newDecisionId } from '../app/api.js';
import { BottomSheet, Button, ButtonRow, Card, ListRow, Money, Notice, SelectField, TextField } from '../ui/blocks.js';
import { MEANING_NAMES, exampleDetail, matchesText, meaningsOn, movesOf, moveText, othersOf, overlapText } from './bank-rules-text.js';
import { ACCOUNT_NAMES, bankRuleText } from './setup-text.js';

// Bank rules (rulebook section 2, 20a, 24c), the same on Setup day and on
// Settings: the list, what a rule matches, and the sheet that adds, changes,
// or removes one. Every change asks first, with what the server says the rule
// would have matched lately; his yes names that preview. The screen works
// nothing out.

// The bank rules in the order they are tried: the first that fits wins (A27).
export function BankRuleRows({ rules, onOpen }: { readonly rules: readonly BankRule[]; readonly onOpen: (rule: BankRule) => void }) {
  return (
    <>
      {rules.map((rule, i) => (
        <ListRow
          key={rule.id}
          title={
            <>
              <span className="position">{i + 1}.</span> {bankRuleText(rule)}
            </>
          }
          onClick={() => onOpen(rule)}
          testId={`bank-rule-${rule.id}`}
        />
      ))}
    </>
  );
}

// What a rule matches, with a few of them, newest first. recentDays: null for
// the whole history.
export function Matches({ matches, recentDays, testId }: { readonly matches: RuleMatches; readonly recentDays: number | null; readonly testId?: string }) {
  const overlap = overlapText(matches);
  return (
    <div data-testid={testId} style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <p className="card__note" data-testid="matches-count">
        {matchesText(matches, recentDays)}
        {matches.count > matches.examples.length && matches.examples.length > 0 ? ` The newest ${matches.examples.length}:` : ''}
      </p>
      {matches.examples.map((e) => (
        <ListRow key={e.id} title={e.description} detail={exampleDetail(e)} trailing={<Money cents={e.amount} />} testId={`match-${e.id}`} />
      ))}
      {overlap !== null && (
        <p className="card__note" data-testid="matches-overlap">
          {overlap}
        </p>
      )}
    </div>
  );
}

// What the sheet edits: a rule he has (change or remove), a new one, or a
// suggestion he changes before adding it.
export type Editing = { readonly rule: BankRule } | { readonly start: BankRuleSpec | null; readonly title: string };

// The answer to a change, from whichever desk took it.
export type Answer = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly why: string; readonly preview?: BankRulePreview } | 'failed';

// Sends one change with its decision number, and his yes when he gave it.
export type Send = (id: string, change: BankRuleChange, yes?: { readonly seen: string }) => Promise<Answer>;

const NO_SIGNAL = "Couldn't save that. Check your connection and try again. Nothing is counted twice.";

// rules: the whole list, in the order they are tried, so a rule he has can
// move a place up or down among the rules on its account (A27).
export function BankRuleSheet({
  editing,
  rules,
  send,
  onClose,
  onDone,
  canRemove = true,
  accounts = ['checking', 'savings', 'everyday-card', 'old-card'],
}: {
  readonly editing: Editing;
  readonly rules: readonly BankRule[];
  readonly send: Send;
  readonly onClose: () => void;
  readonly onDone: (change: BankRuleChange) => void;
  readonly canRemove?: boolean;
  // The accounts this setup has ("Off in this setup": no old card).
  readonly accounts?: readonly AccountId[];
}) {
  const first: BankRuleSpec | null = 'rule' in editing ? editing.rule : editing.start;
  const [account, setAccount] = useState<AccountId>(first?.account ?? 'checking');
  const [contains, setContains] = useState(first?.contains ?? '');
  const [means, setMeans] = useState<BankMeaning>(first?.means ?? 'transfer');
  const [other, setOther] = useState<AccountId | ''>(first?.other ?? '');
  const [asked, setAsked] = useState<{ readonly change: BankRuleChange; readonly why: string; readonly preview: BankRulePreview } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A second tap before the screen has redrawn must not send a second request.
  const lock = useRef(false);
  // The decision number goes with the change: the same change sent again (a retry, or his yes) keeps it.
  const attempt = useRef<{ readonly key: string; readonly id: string } | null>(null);

  const spec: BankRuleSpec = { account, contains, means, ...(means === 'transfer' && other !== '' ? { other } : {}) };
  const go = (change: BankRuleChange, yes?: { readonly seen: string }): void => {
    if (lock.current) return;
    const key = JSON.stringify(change);
    const id = attempt.current?.key === key ? attempt.current.id : newDecisionId();
    attempt.current = { key, id };
    lock.current = true;
    setSending(true);
    setProblem(null);
    void send(id, change, yes).then((answer) => {
      lock.current = false;
      setSending(false);
      if (answer === 'failed') setProblem(NO_SIGNAL);
      else if (answer.ok) onDone(change);
      else if (answer.code === 'needs-confirmation' && answer.preview !== undefined) setAsked({ change, why: answer.why, preview: answer.preview });
      else {
        setAsked(null);
        setProblem(answer.why);
      }
    });
  };
  const pickAccount = (value: string): void => {
    const a = value as AccountId;
    setAccount(a);
    // What the new account cannot have starts over at its first choice.
    if (!meaningsOn(a).includes(means)) setMeans(meaningsOn(a)[0] ?? 'transfer');
    if (other !== '' && !othersOf(a, accounts).includes(other)) setOther('');
  };
  const missing = contains.trim() === '' ? 'Enter the text the bank’s description contains.' : means === 'transfer' && other === '' ? 'Pick the other account.' : null;
  const change: BankRuleChange = 'rule' in editing ? { change: { id: editing.rule.id, ...spec } } : { add: spec };
  const title = 'rule' in editing ? 'Bank rule' : editing.title;
  const moves = 'rule' in editing ? movesOf(editing.rule, rules) : { up: false, down: false };

  return (
    <BottomSheet open title={asked !== null ? 'Are you sure?' : title} onClose={onClose} testId="bank-rule-sheet">
      {asked === null && (
        <>
          {problem !== null && (
            <Notice tone="danger" icon="alert" testId="sheet-problem">
              {problem}
            </Notice>
          )}
          <div className="card" style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
            <SelectField label="Account" value={account} onChange={pickAccount} options={accounts.map((a) => ({ value: a, label: ACCOUNT_NAMES[a] }))} testId="field-bank-account" />
            <TextField label="The bank’s description contains" value={contains} onChange={setContains} testId="field-bank-text" />
            <SelectField label="It is" value={means} onChange={(v) => setMeans(v as BankMeaning)} options={meaningsOn(account).map((m) => ({ value: m, label: MEANING_NAMES[m] }))} testId="field-bank-means" />
            {means === 'transfer' && (
              <SelectField
                label="With"
                value={other}
                onChange={(v) => setOther(v as AccountId | '')}
                options={[{ value: '', label: 'Pick the account' }, ...othersOf(account, accounts).map((a) => ({ value: a, label: ACCOUNT_NAMES[a] }))]}
                testId="field-bank-other"
              />
            )}
            {missing !== null && (contains !== '' || other !== '' || 'rule' in editing) && (
              <p className="field__hint" role="alert" data-testid="sheet-reading">
                {missing}
              </p>
            )}
          </div>
          <Button wide disabled={sending || missing !== null} testId="sheet-save" onClick={() => go(change)}>
            {sending ? 'Checking…' : 'Save'}
          </Button>
          {'rule' in editing && (moves.up || moves.down) && (
            // A27: one place up or down among the rules on its account; the first that fits wins.
            <ButtonRow>
              {moves.up && (
                <Button variant="secondary" wide disabled={sending} testId="sheet-move-up" onClick={() => go({ move: { id: editing.rule.id, direction: 'up' } })}>
                  Move up
                </Button>
              )}
              {moves.down && (
                <Button variant="secondary" wide disabled={sending} testId="sheet-move-down" onClick={() => go({ move: { id: editing.rule.id, direction: 'down' } })}>
                  Move down
                </Button>
              )}
            </ButtonRow>
          )}
          {'rule' in editing && canRemove && (
            <Button variant="secondary" wide disabled={sending} testId="sheet-remove" onClick={() => go({ remove: editing.rule.id })}>
              Remove this rule
            </Button>
          )}
          <p className="sheet__note" data-testid="sheet-note">
            Before it is saved, you see what it would have matched lately. It reads what the bank sends from then on; what was already read stays as it was.
          </p>
        </>
      )}
      {asked !== null && (
        <>
          <Notice tone="warning" icon="alert" testId="confirm-ask">
            {asked.why}
          </Notice>
          <Card title={'remove' in asked.change ? 'What it reads' : 'What it would read'} testId="bank-rule-preview">
            <p className="card__note" data-testid="preview-rule">
              {bankRuleText(asked.preview.rule)}
            </p>
            {asked.preview.move !== undefined && (
              <p className="card__note" data-testid="preview-move">
                {moveText(asked.preview.move, asked.preview.recentDays)}
              </p>
            )}
            <Matches matches={asked.preview.matches} recentDays={asked.preview.recentDays} testId="preview-matches" />
          </Card>
          <ButtonRow>
            <Button wide disabled={sending} testId="confirm-yes" onClick={() => go(asked.change, { seen: asked.preview.key })}>
              {sending ? 'Saving…' : 'remove' in asked.change ? 'Yes, remove it' : 'move' in asked.change ? 'Yes, move it' : 'Yes, save it'}
            </Button>
            <Button variant="secondary" wide disabled={sending} testId="confirm-cancel" onClick={() => setAsked(null)}>
              Back
            </Button>
          </ButtonRow>
          {problem !== null && (
            <Notice tone="danger" icon="alert" testId="sheet-problem">
              {problem}
            </Notice>
          )}
        </>
      )}
    </BottomSheet>
  );
}

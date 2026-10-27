import { formatDollars } from '@budget-app/money';
import type { FoundLine, FoundPreview, SetupResponse, SetupStep } from '@budget-app/server/views';
import { useState } from 'react';
import { BottomSheet, Button, ButtonRow, Card, Decision, Hero, HeroCount, ListRow, TextField } from '../ui/blocks.js';
import { dayWithYear } from '../ui/dates.js';
import { Icon } from '../ui/Icon.js';
import { FINDER_SHEET, FOUND_GROUPS, GROUP_NOTES, GROUP_TITLES, itemText, matchedText, overlapText, ruleMeaning, statusWords } from './rule-finder-text.js';

// Her rulebook, section 53: the rule finder on setup day's rules step, in
// place of the suggestions from the bank's labels. Each suggestion with what
// it would have matched (53.8) and what it shares with others (53.9), to
// keep, keep with her own words, or skip; a whole group can be skipped.
// Every number and word of the history comes from the server.

// How the setup screen sends an answer (Setup.tsx's sender).
export interface FinderSender {
  readonly sending: boolean;
  readonly send: (step: SetupStep, options?: { readonly yes?: { readonly seen: string }; readonly inSheet?: boolean }) => Promise<SetupResponse | 'failed' | null>;
}

export function RuleFinder({ found, sender }: { readonly found: readonly FoundLine[]; readonly sender: FinderSender }) {
  const [about, setAbout] = useState(false);
  const open = found.filter((l) => l.status === 'open').length;
  return (
    <>
      <Hero label="Rules found in your history" sub={found.length === 0 ? 'Nothing repeats enough to suggest a rule.' : open === 0 ? 'Every suggestion is answered.' : 'Keep, change, or skip each one. You can also leave them.'} testId="setup-hero">
        <HeroCount count={open} testId="found-left" />
      </Hero>
      <Card testId="finder-about">
        <p className="card__note">Rules the app found in what both your banks sent. Nothing is made until you keep it, and you can finish setup day without them.</p>
        <ListRow icon="info" title="How the rule finder works" onClick={() => setAbout(true)} testId="row-finder-about" />
      </Card>
      {FOUND_GROUPS.map((group) => {
        const lines = found.filter((l) => l.group === group);
        if (lines.length === 0) return null;
        return (
          <Card key={group} title={GROUP_TITLES[group]} testId={`found-group-${group}`}>
            <p className="card__note">{GROUP_NOTES[group]}</p>
            {lines.map((line) => (
              <FoundDecision key={line.id} line={line} found={found} sender={sender} />
            ))}
            {lines.some((l) => l.status === 'open') && (
              <ButtonRow>
                <Button variant="plain" disabled={sender.sending} testId={`skip-group-${group}`} onClick={() => void sender.send({ foundGroup: { group, answer: 'skip' } })}>
                  Skip the rest of this group
                </Button>
              </ButtonRow>
            )}
          </Card>
        );
      })}
      <BottomSheet open={about} title="Find rules in your history" onClose={() => setAbout(false)} testId="finder-sheet">
        {FINDER_SHEET.map((text) => (
          <p key={text} className="sheet__note">
            {text}
          </p>
        ))}
      </BottomSheet>
    </>
  );
}

function FoundDecision({ line, found, sender }: { readonly line: FoundLine; readonly found: readonly FoundLine[]; readonly sender: FinderSender }) {
  const [words, setWords] = useState<string | null>(null);
  const [bucket, setBucket] = useState<'needs' | 'wants' | null>(line.rule.kind === 'place' ? line.rule.bucket : null);
  const [preview, setPreview] = useState<FoundPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const kept = line.status === 'added' || line.status === 'changed';
  const place = line.rule.kind === 'place';
  const clash = line.overlaps.some((o) => 'rule' in o.with);
  const changeStep = (): SetupStep => ({ found: { id: line.id, answer: 'change', contains: words ?? '', ...(place && bucket !== null ? { bucket } : {}) } });
  const close = (): void => {
    setWords(null);
    setPreview(null);
    setProblem(null);
  };
  const check = async (): Promise<void> => {
    const answer = await sender.send(changeStep(), { inSheet: true });
    if (answer === null || answer === 'failed') return setProblem(answer === 'failed' ? "Couldn't check that. Check your connection and try again." : null);
    if (answer.ok) return close();
    if (answer.code === 'needs-confirmation' && answer.foundPreview !== undefined) {
      setProblem(null);
      return setPreview(answer.foundPreview);
    }
    setProblem(answer.why);
  };
  const keepChanged = async (): Promise<void> => {
    if (preview === null) return;
    const answer = await sender.send(changeStep(), { yes: { seen: preview.key }, inSheet: true });
    if (answer === null) return;
    if (answer === 'failed') return setProblem("Couldn't save that. Check your connection and try again.");
    if (answer.ok) return close();
    if (answer.code === 'needs-confirmation' && answer.foundPreview !== undefined) return setPreview(answer.foundPreview);
    setProblem(answer.why);
  };
  const keepButtons = place ? (
    <>
      {(['needs', 'wants'] as const).map((b) => (
        <Button key={b} variant={line.rule.kind === 'place' && line.rule.bucket === b ? 'primary' : 'secondary'} disabled={sender.sending || kept || clash} testId={`found-keep-${b}`} onClick={() => void sender.send({ found: { id: line.id, answer: 'add', bucket: b } })}>
          {kept && line.rule.kind === 'place' && line.rule.bucket === b && <Icon name="check" size={16} />}
          {b === 'needs' ? 'Keep as needs' : 'Keep as wants'}
        </Button>
      ))}
    </>
  ) : (
    <Button variant={kept ? 'primary' : 'secondary'} disabled={sender.sending || kept || clash} testId="found-keep" onClick={() => void sender.send({ found: { id: line.id, answer: 'add' } })}>
      {kept && <Icon name="check" size={16} />}
      Keep this rule
    </Button>
  );
  return (
    <Decision
      title={`“${line.rule.contains}”`}
      detail={ruleMeaning(line.rule, kept)}
      testId={`found-${line.id}`}
      actions={
        line.status === 'covered' ? null : (
          <ButtonRow>
            {keepButtons}
            <Button variant="secondary" disabled={sender.sending || kept} testId="found-change" onClick={() => setWords(line.rule.contains)}>
              Change its words
            </Button>
            <Button variant={line.status === 'skipped' ? 'primary' : 'secondary'} disabled={sender.sending || line.status !== 'open'} testId="found-skip" onClick={() => void sender.send({ found: { id: line.id, answer: 'skip' } })}>
              {line.status === 'skipped' && <Icon name="check" size={16} />}
              Skip
            </Button>
          </ButtonRow>
        )
      }
    >
      {line.pending && (
        <p className="decision__detail" data-testid="found-pending">
          <span>Worded as your bank shows it while it is still pending.</span>
        </p>
      )}
      <p className="decision__detail" data-testid="found-matched">
        <span>{matchedText(line.matches)}</span>
      </p>
      {line.run !== null && (
        <p className="decision__detail" data-testid="found-run">
          <span>{line.run.map((r) => `${dayWithYear(r.date)} ${formatDollars(r.amount)}`).join(' · ')}</span>
        </p>
      )}
      <details className="decision__detail" data-testid="found-items">
        <summary>See what it would have matched</summary>
        <ul>
          {line.matches.items.map((i) => (
            <li key={i.id}>{itemText(i)}</li>
          ))}
        </ul>
        {line.matches.foundCount > line.matches.items.length && <p className="decision__detail">And {line.matches.foundCount - line.matches.items.length} older.</p>}
        {line.matches.alsoCount > 0 && (
          <>
            <p className="decision__detail">
              <strong>Also matches</strong>
            </p>
            <ul data-testid="found-also">
              {line.matches.also.map((i) => (
                <li key={i.id}>{itemText(i)}</li>
              ))}
            </ul>
          </>
        )}
      </details>
      {line.overlaps.map((o, n) => (
        <p key={n} className="decision__changed" data-testid="found-overlap">
          <Icon name="alert" size={14} />
          <span>{overlapText(o, found)}</span>
        </p>
      ))}
      <p className="decision__detail" data-testid="found-status">
        <strong>{statusWords(line.status, line.rule)}</strong>
      </p>
      {words !== null && (
        <div style={{ display: 'grid', gap: '12px' }} data-testid="found-edit">
          <TextField label="The words the bank’s description contains" value={words} onChange={(value) => { setWords(value); setPreview(null); }} testId="found-words" />
          {place && (
            <ButtonRow>
              {(['needs', 'wants'] as const).map((b) => (
                <Button key={b} variant={bucket === b ? 'primary' : 'secondary'} pressed={bucket === b} testId={`found-bucket-${b}`} onClick={() => { setBucket(b); setPreview(null); }}>
                  {bucket === b && <Icon name="check" size={16} />}
                  {b === 'needs' ? 'Needs' : 'Wants'}
                </Button>
              ))}
            </ButtonRow>
          )}
          {preview !== null && (
            <div data-testid="found-preview">
              <p className="decision__detail">
                <span>{matchedText(preview.matches)}</span>
              </p>
              {preview.overlaps.map((o, n) => (
                <p key={n} className="decision__changed">
                  <Icon name="alert" size={14} />
                  <span>{overlapText(o, found)}</span>
                </p>
              ))}
            </div>
          )}
          {problem !== null && (
            <p className="decision__changed" role="alert" data-testid="found-problem">
              <Icon name="alert" size={14} />
              <span>{problem}</span>
            </p>
          )}
          <ButtonRow>
            {preview === null ? (
              <Button disabled={sender.sending || (words ?? '').trim() === '' || (place && bucket === null)} testId="found-check" onClick={() => void check()}>
                Check what it would match
              </Button>
            ) : (
              <Button disabled={sender.sending} testId="found-keep-changed" onClick={() => void keepChanged()}>
                Keep it with these words
              </Button>
            )}
            <Button variant="secondary" disabled={sender.sending} testId="found-cancel" onClick={close}>
              Cancel
            </Button>
          </ButtonRow>
        </div>
      )}
    </Decision>
  );
}

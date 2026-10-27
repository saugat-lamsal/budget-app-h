import type { AccountId } from '@budget-app/money';
import type { BankConnectionView } from '@budget-app/server/views';
import { useState } from 'react';
import { bankSend, type Load, type Reload } from '../app/api.js';
import { runLink } from '../app/plaid-link.js';
import { BackLink, BottomSheet, Button, ButtonRow, Card, ListRow, Notice, Skeleton, StateMessage } from '../ui/blocks.js';
import { longDate } from '../ui/dates.js';
import type { Back } from './Activity.js';
import { BANK_WORDS as W, HER_BANK_WORDS as H, ROLE_HINTS, ROLE_NAMES, ROLE_ORDER, accountLabel, counted } from './bank-text.js';
import type { Said } from './choose.js';

// The Bank connection screen (rules 1.1 to 1.3), on the real server only,
// opened from Settings and from Setup day. Connecting the bank (asks first:
// it uses 1 of the 10 connections Plaid allows), which account is which
// (asks first: it cannot change once tracking starts), and logging in to the
// bank again on the same connection. The bank's own login is Plaid Link's;
// this page is the one whose rules let it in, so it is always opened as a
// page of its own. The server decides everything and keeps the bank key; the
// screen only asks, and hands Link's answer to the server.
// Her setup (her rulebook, 1.1 and 1.3, PR 6): two banks, connected one at a
// time, each by its name, each logged in to again on its own connection; the
// server sends `banks` only then.

type Connected = Extract<BankConnectionView, { state: 'connected' }>;
type HerBank = NonNullable<Connected['banks']>[number];

const nameOf = (b: HerBank): string => b.name ?? H.unnamed(b.bank);

export function BankScreen({ load, onRetry, back }: { readonly load: Load<BankConnectionView>; readonly onRetry: Reload; readonly back: Back }) {
  const [said, setSaid] = useState<Said | null>(null);
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="bank">
      <h1 className="sr-only">Bank</h1>
      <BackLink href={back.href} label={back.label} onBack={back.onBack} testId="back" />
      {said !== null && (
        <Notice tone={said.tone} icon={said.tone === 'ok' ? 'check' : 'alert'} testId="bank-said">
          {said.text}
        </Notice>
      )}
      {load.status === 'loading' && (
        <div data-testid="bank-loading" style={{ display: 'contents' }}>
          <span className="sr-only">Loading the bank connection</span>
          <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
            <Skeleton width="50%" height="1rem" />
            <Skeleton width="80%" height="1rem" />
          </div>
        </div>
      )}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load the bank connection" detail="Check your connection, then try again." testId="bank-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'none' && <ConnectCard bank={load.value.bank} her={load.value.banks !== undefined} other={false} onSaid={setSaid} reload={onRetry} />}
      {load.status === 'ready' && load.value.state === 'connected' && <ConnectedCards view={load.value} onSaid={setSaid} reload={onRetry} />}
    </main>
  );
}

// Runs one request at a time; a second tap meanwhile does nothing.
function useBusy(): [boolean, (run: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const guard = async (run: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await run();
    } finally {
      setBusy(false);
    }
  };
  return [busy, guard];
}

// 1.1: nothing connected yet; in her setup, also her other bank (other).
function ConnectCard({ bank, her, other, onSaid, reload }: { readonly bank: 'test' | 'real'; readonly her: boolean; readonly other: boolean; readonly onSaid: (said: Said) => void; readonly reload: Reload }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, guard] = useBusy();
  const start = (yes: boolean): Promise<void> =>
    guard(async () => {
      setAsking(null);
      try {
        const link = await bankSend('/api/bank/link', { mode: 'connect', yes });
        if (!link.ok) {
          if (link.code === 'needs-yes') setAsking(link.why);
          else onSaid({ tone: 'danger', text: link.why });
          return;
        }
        const outcome = await runLink(link.linkToken);
        if (outcome.kind === 'unavailable') onSaid({ tone: 'danger', text: W.unavailable });
        else if (outcome.kind === 'closed') onSaid({ tone: 'warning', text: outcome.failed ? W.closedFailed : W.closed });
        else {
          // Her setup: with the bank Link says it was (HB8).
          const answer = await bankSend('/api/bank/connected', her && outcome.institution !== null ? { publicToken: outcome.publicToken, institution: outcome.institution } : { publicToken: outcome.publicToken });
          onSaid(answer.ok ? { tone: 'ok', text: answer.said } : { tone: 'danger', text: answer.why });
        }
      } catch {
        onSaid({ tone: 'danger', text: W.noSignal });
      } finally {
        reload('after');
      }
    });
  return (
    <>
      <Card title={her ? (other ? H.otherTitle : H.noneTitle) : W.noneTitle} padded testId="bank-connect-card">
        <p className="card__note">{her ? (other ? H.otherDetail : bank === 'test' ? H.noneTest : H.noneReal) : bank === 'test' ? W.noneTest : W.noneReal}</p>
        <p className="card__note">{bank === 'test' ? W.slotsTest : W.slots}</p>
        <p className="card__note">{W.computer}</p>
        <Button variant={other ? 'secondary' : 'primary'} wide disabled={busy} onClick={() => void start(false)} testId="bank-connect">
          {busy ? W.connecting : her ? H.connect : W.connect}
        </Button>
      </Card>
      {asking !== null && (
        <BottomSheet open title={her ? H.askTitle : W.askTitle} onClose={() => setAsking(null)} testId="bank-ask">
          <p className="card__note">{asking}</p>
          <ButtonRow>
            <Button wide disabled={busy} onClick={() => void start(true)} testId="bank-ask-yes">
              {W.askYes}
            </Button>
            <Button variant="secondary" wide onClick={() => setAsking(null)} testId="bank-ask-no">
              {W.askNo}
            </Button>
          </ButtonRow>
        </BottomSheet>
      )}
    </>
  );
}

function ConnectedCards({ view, onSaid, reload }: { readonly view: Connected; readonly onSaid: (said: Said) => void; readonly reload: Reload }) {
  const [busy, guard] = useBusy();
  const [picking, setPicking] = useState(!view.rolesSet && !view.rolesFixed);

  // Reads the bank again (and the accounts), after logging in again or to look again.
  const read = (body: object, done?: string): Promise<void> =>
    guard(async () => {
      try {
        const answer = await bankSend('/api/bank/read', body);
        onSaid(answer.ok ? { tone: 'ok', text: done ?? answer.said } : { tone: 'danger', text: answer.why });
      } catch {
        onSaid({ tone: 'danger', text: W.noSignal });
      } finally {
        reload('after');
      }
    });

  // 1.3: the bank's own login again, on the same connection; in her setup, that bank's.
  const loginAgain = (bank?: 1 | 2): Promise<void> =>
    guard(async () => {
      try {
        const link = await bankSend('/api/bank/link', bank === undefined ? { mode: 'login-again' } : { mode: 'login-again', bank });
        if (!link.ok) {
          onSaid({ tone: 'danger', text: link.why });
          return;
        }
        const outcome = await runLink(link.linkToken);
        if (outcome.kind === 'unavailable') onSaid({ tone: 'danger', text: W.unavailable });
        else if (outcome.kind === 'closed') onSaid({ tone: 'warning', text: outcome.failed ? W.closedFailed : 'Nothing was changed.' });
        else {
          const answer = await bankSend('/api/bank/read', bank === undefined ? { loggedInAgain: true } : { loggedInAgain: true, bank });
          onSaid(answer.ok ? { tone: 'ok', text: W.loggedIn } : { tone: 'danger', text: answer.why });
        }
      } catch {
        onSaid({ tone: 'danger', text: W.noSignal });
      } finally {
        reload('after');
      }
    });

  const banks = view.banks;
  return (
    <>
      <Card title={banks === undefined ? W.connectedTitle : H.banksTitle} testId="bank-connected">
        {banks === undefined ? (
          <>
            <ListRow icon="bank" title={view.bank === 'test' ? W.testBank : W.realBank} detail={W.connectedOn(longDate(view.connectedOn))} testId="bank-state" />
            {view.permissionEnds !== null && <ListRow icon="clock" title="The bank's permission runs out" detail={longDate(view.permissionEnds)} testId="bank-permission" />}
          </>
        ) : (
          banks.map((b) => (
            <div key={b.bank} style={{ display: 'contents' }}>
              <ListRow icon="bank" title={nameOf(b)} detail={W.connectedOn(longDate(b.connectedOn))} testId={`bank-state-${b.bank}`} />
              {b.permissionEnds !== null && <ListRow icon="clock" title={H.permission(nameOf(b))} detail={longDate(b.permissionEnds)} testId={`bank-permission-${b.bank}`} />}
            </div>
          ))
        )}
        {view.rolesSet &&
          (view.roles ?? ROLE_ORDER).map((role) => {
            const account = view.accounts.find((a) => a.role === role);
            return <ListRow key={role} icon="card" title={ROLE_NAMES[role]} detail={account === undefined ? W.pickOne : accountLabel(account)} testId={`bank-role-${role}`} />;
          })}
      </Card>
      {banks === undefined
        ? view.needsLogin && (
            <Notice tone="danger" icon="alert" testId="bank-needs-login">
              {W.needsLogin}
            </Notice>
          )
        : banks
            .filter((b) => b.needsLogin)
            .map((b) => (
              <Notice key={b.bank} tone="danger" icon="alert" testId={`bank-needs-login-${b.bank}`}>
                {H.needsLogin(nameOf(b))}
              </Notice>
            ))}
      {view.canConnect === true && <ConnectCard bank={view.bank} her other onSaid={onSaid} reload={reload} />}
      {view.rolesSet && !view.historyComplete && (
        <Notice tone="warning" icon="clock" testId="bank-history" action={<Button variant="secondary" disabled={busy} onClick={() => void read({})} testId="bank-look-again">{W.lookAgain}</Button>}>
          {W.history}
        </Notice>
      )}
      {(picking || (!view.rolesSet && !view.rolesFixed)) && <PickCard view={view} onSaid={onSaid} reload={reload} onDone={() => setPicking(false)} onRead={() => void read({})} busyElsewhere={busy} />}
      <ButtonRow>
        {banks === undefined ? (
          <Button variant={view.needsLogin ? 'primary' : 'secondary'} wide disabled={busy} onClick={() => void loginAgain()} testId="bank-login-again">
            {busy ? W.loggingIn : W.loginAgain}
          </Button>
        ) : (
          banks.map((b) => (
            <Button key={b.bank} variant={b.needsLogin ? 'primary' : 'secondary'} wide disabled={busy} onClick={() => void loginAgain(b.bank)} testId={`bank-login-again-${b.bank}`}>
              {busy ? W.loggingIn : H.loginAgain(nameOf(b))}
            </Button>
          ))
        )}
        {view.rolesSet && !view.rolesFixed && !picking && (
          <Button variant="secondary" wide disabled={busy} onClick={() => setPicking(true)} testId="bank-change-picks">
            {W.changePicks}
          </Button>
        )}
      </ButtonRow>
      <p className="card__note">{view.rolesFixed ? `${banks === undefined ? W.loginAgainDetail : H.loginAgainDetail} ${W.fixed}` : banks === undefined ? W.loginAgainDetail : H.loginAgainDetail}</p>
    </>
  );
}

// 1.2: which of the bank's accounts is each of his four.
function PickCard({
  view,
  onSaid,
  reload,
  onDone,
  onRead,
  busyElsewhere,
}: {
  readonly view: Connected;
  readonly onSaid: (said: Said) => void;
  readonly reload: Reload;
  readonly onDone: () => void;
  readonly onRead: () => void;
  readonly busyElsewhere: boolean;
}) {
  const [picks, setPicks] = useState<Partial<Record<AccountId, string>>>(() => Object.fromEntries(view.accounts.flatMap((a) => (a.role === null ? [] : [[a.role, a.id]]))));
  const [open, setOpen] = useState<AccountId | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, guard] = useBusy();
  // The accounts this setup asks for ("Off in this setup": no old card).
  const roles = view.roles ?? ROLE_ORDER;
  const complete = roles.every((role) => picks[role] !== undefined);

  const save = (yes: boolean): Promise<void> =>
    guard(async () => {
      setAsking(null);
      try {
        const answer = await bankSend('/api/bank/roles', { roles: picks, yes });
        if (!answer.ok) {
          if (answer.code === 'needs-yes') setAsking(answer.why);
          else onSaid({ tone: 'danger', text: answer.why });
          return;
        }
        onSaid({ tone: 'ok', text: answer.said });
        onDone();
        // The list shows the picks just kept at once: reading the bank can
        // take a while (her two banks, with their history).
        reload('after');
        // The bank is read once all four are picked.
        const read = await bankSend('/api/bank/read', {});
        if (!read.ok) onSaid({ tone: 'danger', text: read.why });
      } catch {
        onSaid({ tone: 'danger', text: W.noSignal });
      } finally {
        reload('after');
      }
    });

  if (view.accounts.length === 0) {
    return (
      <Card title={W.pickTitle} padded testId="bank-pick">
        <p className="card__note">{W.noAccounts}</p>
        <Button wide disabled={busyElsewhere} onClick={onRead} testId="bank-read-accounts">
          {W.readNow}
        </Button>
      </Card>
    );
  }

  return (
    <>
      <Card title={W.pickTitle} testId="bank-pick">
        <p className="card__note">{counted(W.pickDetail, roles)}</p>
        {roles.map((role) => {
          const account = view.accounts.find((a) => a.id === picks[role]);
          return (
            <ListRow
              key={role}
              icon="card"
              tone={account === undefined ? 'warning' : 'info'}
              title={ROLE_NAMES[role]}
              detail={account === undefined ? `${W.pickOne}: ${ROLE_HINTS[role].toLowerCase()}` : accountLabel(account)}
              onClick={() => setOpen(role)}
              testId={`bank-pick-${role}`}
            />
          );
        })}
        <p className="card__note">{view.banks === undefined ? counted(W.missing, roles) : H.missing}</p>
        <ButtonRow>
          <Button wide disabled={busy || !complete} onClick={() => void save(false)} testId="bank-pick-save">
            {busy ? W.saving : W.save}
          </Button>
        </ButtonRow>
      </Card>
      {open !== null && (
        <BottomSheet open title={W.pickSheet(open)} onClose={() => setOpen(null)} testId="bank-pick-sheet">
          {view.accounts.map((a) => (
            <ListRow
              key={a.id}
              icon={picks[open] === a.id ? 'check' : 'card'}
              title={accountLabel(a)}
              detail={a.kind}
              onClick={() => {
                // An account is only one of the four: picked here, it leaves any other.
                const next: Partial<Record<AccountId, string>> = Object.fromEntries(Object.entries(picks).filter(([, id]) => id !== a.id));
                next[open] = a.id;
                setPicks(next);
                setOpen(null);
              }}
              testId={`bank-pick-account-${a.id}`}
            />
          ))}
        </BottomSheet>
      )}
      {asking !== null && (
        <BottomSheet open title={counted(W.keepTitle, roles)} onClose={() => setAsking(null)} testId="bank-keep">
          <p className="card__note">{asking}</p>
          <ButtonRow>
            <Button wide disabled={busy} onClick={() => void save(true)} testId="bank-keep-yes">
              {W.keepYes}
            </Button>
            <Button variant="secondary" wide onClick={() => setAsking(null)} testId="bank-keep-no">
              {W.askNo}
            </Button>
          </ButtonRow>
        </BottomSheet>
      )}
    </>
  );
}

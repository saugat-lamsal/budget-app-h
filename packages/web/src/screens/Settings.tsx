import { formatDollars, parseDollars, type Cents, type LeftoverChoice, type Settings } from '@budget-app/money';
import type { BankRuleChange, LoginView, LogRow, PushView, RuleRequest, RuleRow, RuleSpec, SettingsPreviewView, SettingsRequest, SettingsShown as SettingsView, SettingsValuesShown, SyncView } from '@budget-app/server/views';
import { useRef, useState, type ReactNode } from 'react';
import { newDecisionId, sendChoice, type Load, type Reload } from '../app/api.js';
import { pathOf, pathOfRoute } from '../app/routes.js';
import { Banner, BottomSheet, Button, ButtonRow, Card, CompareTable, ListRow, MadeUpPill, Money, Notice, SelectField, Skeleton, StateMessage, TextField } from '../ui/blocks.js';
import { dayWithYear, longDate, shortDate } from '../ui/dates.js';
import { POT_NAMES } from '../ui/names.js';
import { alertsRowText } from './alerts-text.js';
import { BankRuleRows, BankRuleSheet, type Editing as BankEditing } from './bank-rules.js';
import { bankRuleDoneText } from './bank-rules-text.js';
import { HER_BANK_WORDS } from './bank-text.js';
import { SaidNotice, type Said } from './choose.js';
import { LoginCard } from './login-card.js';
import { NotificationsCard } from './notifications-card.js';
import { SyncCard } from './sync-card.js';
import { setupDayText } from './setup-day-log-text.js';
import { bankRuleText } from './setup-text.js';
import { cardsOffText } from './home-text.js';
import {
  LEFTOVER_NAMES,
  LOGIN_LINES,
  NOTIFICATION_LINES,
  RULE_CHOICE_NAMES,
  RULE_KINDS,
  RULE_KIND_DETAIL,
  SETTING_NAMES,
  daysText,
  payScheduleText,
  minutesText,
  leftoverText,
  recheckedText,
  retotaledText,
  askPaycheckText,
  lockAmountsText,
  notReadText,
  permissionWarnText,
  quietHoursText,
  reminderText,
  ruleDoneText,
  ruleText,
  settingValueText,
  settingsDoneText,
  closingDayText,
  textRuleText,
  timeText,
  ZONE_CHOICES,
  zoneText,
  bankAccountsText,
} from './settings-text.js';

// Settings: every number and rule in rulebook section 2, the sorting rules,
// and the change log (13.5). Every value shown comes from the server, worked
// out by the money math; the screen only reads what he types and sends it.
// A change goes through the same desk as every other choice, with a decision
// number: a repeat changes nothing, a refusal changes nothing and says why.
// The split and the mom reserve start at the next paycheck (13.1), and the
// screen shows this pay period's next to what comes next. Anything hard to
// undo asks first: the paycheck rule and the mom rule, with what they would
// do to what is waiting (A9), and removing a sorting rule.

type Tracking = Extract<SettingsView, { state: 'tracking' }>;

export function SettingsScreen({ load, onRetry, onChanged }: { readonly load: Load<SettingsView>; readonly onRetry: Reload; readonly onChanged: Reload }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="settings">
      {/* With the books open, the day comes first and the title under it, as on every other screen. */}
      {!(load.status === 'ready' && load.value.state === 'tracking') && <h1 className="screen-title">Settings</h1>}
      {load.status === 'loading' && <SettingsLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load your settings" detail="Check your connection, then try again." testId="settings-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="settings" title="No settings yet" detail="Setup day reads your bank and starts your buckets. Your settings and rules show here after that." testId="settings-not-set-up" />
          {(load.value.login !== undefined || load.value.sync !== undefined || load.value.push !== undefined) && <NotSetUpCards login={load.value.login} sync={load.value.sync} push={load.value.push} reload={onRetry} />}
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <SettingsReady view={load.value} reload={onRetry} onChanged={onChanged} />}
    </main>
  );
}

// Before setup day there are no settings, but he can still log out (Step 2),
// the server already syncs with the bank (Step 3), and notifications can be
// turned on ahead of the first alert (Phase 5).
function NotSetUpCards({ login, sync, push, reload }: { readonly login: LoginView | undefined; readonly sync: SyncView | undefined; readonly push: PushView | undefined; readonly reload: Reload }) {
  const [said, setSaid] = useState<Said | null>(null);
  return (
    <>
      {said !== null && <SaidNotice said={said} sending={false} onRetry={() => undefined} onDismiss={() => setSaid(null)} sticky />}
      {push !== undefined && <NotificationsCard push={push} onSaid={setSaid} reload={reload} />}
      {sync !== undefined && <SyncCard sync={sync} onSaid={setSaid} reload={reload} />}
      {login !== undefined && <LoginCard login={login} onSaid={setSaid} reload={reload} />}
    </>
  );
}

function SettingsLoading() {
  return (
    <div data-testid="settings-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading your settings</span>
      {[0, 1, 2].map((n) => (
        <div key={n} className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
          <Skeleton width="50%" height="1rem" />
          <Skeleton width="80%" height="1rem" />
          <Skeleton width="65%" height="1rem" />
        </div>
      ))}
    </div>
  );
}

// What is being changed in the sheet.
type Editing =
  | { readonly what: 'split' | 'reserve' | 'target' | 'low-alert' | 'reminders' | 'review-time' | 'time-zone' | 'quiet-hours' | 'not-read' | 'mismatch-wait' | 'permission-warn' | 'lock-amounts' | 'ask-paycheck' | 'leftover' | 'promo' | 'paycheck-rule' | 'pay-schedule' | 'mom-rule' | 'early-days' | 'closing-day-everyday' | 'closing-day-old' | 'closing-day-second' }
  // A sorting rule: null to add one.
  | { readonly what: 'rule'; readonly rule: RuleRow | null };

function SettingsReady({ view, reload, onChanged }: { readonly view: Tracking; readonly reload: Reload; readonly onChanged: Reload }) {
  const { settings: s, split, check, payoff } = view;
  // The mom reserve in force and from the next paycheck; null when it is off ("Off in this setup").
  const reserve = reserveOf(split);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Each opening of the sheet is a new sheet, filled in from the values as they are then.
  const [opened, setOpened] = useState(0);
  const [said, setSaid] = useState<Said | null>(null);
  const open = (e: Editing): void => {
    setSaid(null);
    setOpened((n) => n + 1);
    setEditing(e);
  };
  const row = (what: Exclude<Editing['what'], 'rule'>, title: string, value: ReactNode, detail?: ReactNode): ReactNode => (
    <ListRow title={title} detail={detail} trailing={<span data-testid={`value-${what}`}>{value}</span>} onClick={() => open({ what })} testId={`row-${what}`} />
  );
  const textRow = (what: Exclude<Editing['what'], 'rule'>, title: string, value: string, detail: string): ReactNode => (
    <ListRow
      title={title}
      detail={
        <>
          <span data-testid={`value-${what}`}>{value}</span>. {detail}
        </>
      }
      onClick={() => open({ what })}
      testId={`row-${what}`}
    />
  );
  const next = shortDate(split.nextPayday.date);
  // Section 2, 24c: the sheet for a bank rule, and what the last change did.
  const [bankEditing, setBankEditing] = useState<BankEditing | null>(null);
  const openBank = (e: BankEditing): void => {
    setSaid(null);
    setOpened((n) => n + 1);
    setBankEditing(e);
  };
  const sendBankRule = async (id: string, change: BankRuleChange, yes?: { readonly seen: string }) => {
    try {
      return await sendChoice({ id, bankRule: change, ...(yes === undefined ? {} : { confirmed: true, seen: yes.seen }) });
    } catch {
      return 'failed' as const;
    }
  };

  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>
      <h1 className="screen-title">Settings</h1>

      {said !== null && <SaidNotice said={said} sending={false} onRetry={() => undefined} onDismiss={() => setSaid(null)} sticky />}

      {check.state === 'does-not-match' && (
        <Banner tone="danger" icon="alert" title="Totals do not match the bank" testId="mismatch">
          <p className="banner__big">
            Off by <Money cents={Math.abs(check.difference)} testId="mismatch-amount" />
          </p>
          <p className="banner__body">The bank shows {check.difference > 0 ? 'more' : 'less'} than your buckets add up to. Home has the numbers behind it.</p>
          <ListRow title="Open Home" href={pathOf('home')} testId="see-home" />
        </Banner>
      )}

      {/* 13.1: this pay period's split and reserve, next to what the next paycheck will use.
          "Off in this setup": with no mom reserve, the split alone. */}
      <Card title="Paycheck split" testId="split-card">
        <p className="card__note" data-testid="split-note">
          {split.waiting.length > 0 ? `Your changes start at your next paycheck, ${next}. ` : 'A change starts at your next paycheck. '}
          This pay period keeps what it started with.
        </p>
        <CompareTable
          caption={reserve === null ? 'The split, this pay period and from your next paycheck' : 'The split and the mom reserve, this pay period and from your next paycheck'}
          testId="split-table"
          columns={[
            { name: 'This pay period', sub: `since ${shortDate(split.payPeriodStarted)}` },
            { name: 'From next paycheck', sub: next },
          ]}
          rows={[
            // Her rulebook, section 2: Wishlist too, where the split names it.
            ...(split.thisPayPeriod.split.wishlist === undefined ? (['savings', 'needs', 'wants'] as const) : (['savings', 'needs', 'wants', 'wishlist'] as const)).map((bucket) => ({
              label: POT_NAMES[bucket],
              first: `${split.thisPayPeriod.split[bucket] ?? 0}%`,
              second: `${split.fromNextPaycheck.split[bucket] ?? 0}%`,
              differs: split.thisPayPeriod.split[bucket] !== split.fromNextPaycheck.split[bucket],
              testId: `split-${bucket}`,
            })),
            ...(reserve === null
              ? []
              : [
                  {
                    label: 'Mom reserve per paycheck',
                    first: <Money cents={reserve.now.perPaycheck} />,
                    second: <Money cents={reserve.next.perPaycheck} />,
                    differs: split.waiting.includes('momReservePerPaycheck'),
                    testId: 'split-reserve',
                  },
                  {
                    label: 'Mom reserve cap',
                    first: <Money cents={reserve.now.cap} />,
                    second: <Money cents={reserve.next.cap} />,
                    differs: split.waiting.includes('momReserveCap'),
                    testId: 'split-cap',
                  },
                ]),
          ]}
        />
        <ListRow icon="settings" title="Change the split" detail={s.split.wishlist === undefined ? 'Savings, needs, and wants, in whole percents' : 'Savings, needs, wants, and Wishlist, in whole percents'} onClick={() => open({ what: 'split' })} testId="row-split" />
        {reserve !== null && <ListRow icon="heart" title="Change the mom reserve" detail="What each paycheck sets aside for mom, and the most it holds" onClick={() => open({ what: 'reserve' })} testId="row-reserve" />}
      </Card>

      <Card title="Paycheck" testId="paycheck-card">
        {textRow('paycheck-rule', 'Paycheck rule', textRuleText(s.paycheckRule), 'Text the bank shows on your paycheck')}
        {row('pay-schedule', 'Pay schedule', payScheduleText(s), `Next payday ${next}`)}
        {row('early-days', 'Early paycheck check', daysText(s.earlyPaycheckDays), 'A paycheck sooner than this after the last one waits in Review')}
        {/* Her rulebook, section 2: only a setup that has the setting shows it. */}
        {s.askBeforeSplittingPaycheck !== undefined && textRow('ask-paycheck', 'Ask before splitting a paycheck', askPaycheckText(s.askBeforeSplittingPaycheck), 'Nothing is split until you say yes in Review')}
        {textRow('leftover', 'Leftover at payday', leftoverText(s.leftoverAtPayday), 'What happens to what is left in needs and wants')}
      </Card>

      {s.momRule !== undefined && s.momMonthlyTarget !== undefined && (
        <Card title="Mom" testId="mom-card">
          {textRow('mom-rule', 'Mom rule', textRuleText(s.momRule), 'Her name as it shows on your transfers')}
          <ListRow
            title="Monthly target"
            detail={
              <span data-testid="value-target">
                <Money cents={s.momMonthlyTarget.low} testId="target-low" /> to <Money cents={s.momMonthlyTarget.high} testId="target-high" /> a month
              </span>
            }
            onClick={() => open({ what: 'target' })}
            testId="row-target"
          />
        </Card>
      )}

      <Card title="Alerts and reminders" testId="alerts-card">
        {/* 9.8 (A52): a card whose statement cannot be read is never dropped without a word. */}
        {view.cardsOff.length > 0 && (
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            {view.cardsOff.map((off) => {
              const words = cardsOffText(off);
              return (
                <Notice key={off.card} tone="warning" icon="alert" testId={`cards-off-${off.card}`}>
                  {words.title}. {words.detail}
                </Notice>
              );
            })}
          </div>
        )}
        {row('low-alert', 'Low-bucket alert', `${s.lowBucketAlertPercent}%`, 'Of what needs or wants started the pay period with')}
        {textRow('reminders', 'Card reminders', reminderText(s.cardReminderDaysBefore), 'Before each card is due')}
        {textRow('closing-day-everyday', SETTING_NAMES.everydayCardClosingDay, closingDayText(s.everydayCardClosingDay), 'Used only when the bank does not send the statement date')}
        {/* Her second card's own closing day (her rulebook, 9.8); only her setup has the setting. */}
        {s.secondCardClosingDay !== undefined && textRow('closing-day-second', SETTING_NAMES.secondCardClosingDay, closingDayText(s.secondCardClosingDay), 'Used only when the bank does not send the statement date')}
        {s.oldCardClosingDay !== undefined && textRow('closing-day-old', 'Old card: statement closing day', closingDayText(s.oldCardClosingDay), 'Used only when the bank does not send the statement date')}
        {row('review-time', 'Daily review', timeText(s.dailyReviewTime), 'Only when something waits in Review')}
        {textRow('time-zone', 'Home time zone', zoneText(s.homeTimeZone), 'Today is the date here, and the daily review time is in it')}
        {textRow('quiet-hours', 'Quiet hours', quietHoursText(s.quietHours), 'No alerts then. What comes due waits until they end')}
        {textRow('not-read', 'Bank not read', notReadText(s.bankNotReadAlertHours), 'An alert when the bank has not been read for this long')}
        {textRow('mismatch-wait', 'Totals do not match', notReadText(s.totalsMismatchAlertHours), 'An alert once a difference with the bank has lasted this long')}
        {textRow('permission-warn', 'Bank permission ending', permissionWarnText(s.bankPermissionWarnDays), 'Told before the bank stops letting the app read your accounts')}
        {textRow('lock-amounts', 'Amounts on the lock screen', lockAmountsText(s.amountsOnLockScreen), 'The amounts are always in the app')}
        {view.alerts !== undefined && <ListRow icon="tray" title="Alerts sent" detail={alertsRowText(view.alerts)} href={pathOfRoute({ screen: 'alerts' })} testId="row-alerts-sent" />}
      </Card>

      {view.push !== undefined && (
        <NotificationsCard
          push={view.push}
          onSaid={setSaid}
          reload={(when) => {
            reload(when);
            onChanged(when);
          }}
        />
      )}

      {payoff !== undefined && s.oldCardPromoEndDate !== undefined && (
        <Card title="Old card" testId="old-card-card">
          {row('promo', 'Promo end date', s.oldCardPromoEndDate === null ? 'Not entered' : dayWithYear(s.oldCardPromoEndDate))}
          <ListRow
            title="Payoff countdown"
            testId="payoff"
            detail={
              <span data-testid="payoff-text">
                {!payoff.on
                  ? 'Off until you enter the promo end date'
                  : payoff.owed <= 0
                    ? 'Nothing owed on the old card'
                    : payoff.paydaysLeft === 0
                      ? `No paydays left before ${dayWithYear(payoff.promoEndDate)}: all of it is due now`
                      : `${payoff.paydaysLeft} ${payoff.paydaysLeft === 1 ? 'payday' : 'paydays'} left before ${dayWithYear(payoff.promoEndDate)}`}
              </span>
            }
            trailing={payoff.on ? <Money cents={payoff.perPayday} testId="payoff-per-payday" /> : undefined}
          />
        </Card>
      )}

      <Card title="Sorting rules" testId="rules-card">
        <p className="card__note">The first rule that matches wins. A new rule goes to the end of its list. Fees, money out of savings, and paychecks have no rules.</p>
        {(['purchase', 'deposit', 'person'] as const).map((kind) => (
          <section key={kind} aria-label={RULE_KINDS[kind]} data-testid={`rules-${kind}`}>
            <h3 className="card__subtitle">{RULE_KINDS[kind]}</h3>
            {view.rules[kind].length === 0 ? (
              <p className="card__note" data-testid={`rules-${kind}-empty`}>
                None yet. {RULE_KIND_DETAIL[kind]}
              </p>
            ) : (
              view.rules[kind].map((rule) => (
                <ListRow
                  key={rule.id}
                  title={
                    <>
                      <span className="position">{rule.position}.</span> “{rule.contains}”
                    </>
                  }
                  trailing={<span data-testid={`rule-${rule.id}-to`}>{RULE_CHOICE_NAMES[rule.to]}</span>}
                  onClick={() => open({ what: 'rule', rule })}
                  testId={`rule-${rule.id}`}
                />
              ))
            )}
          </section>
        ))}
        <ListRow icon="settings" title="Add a rule" onClick={() => open({ what: 'rule', rule: null })} testId="row-add-rule" />
      </Card>

      {/* Section 2, 24c: how the app tells transfers, payments to people, and card charges from purchases. */}
      <Card title="Bank rules" testId="bank-rules-card">
        <p className="card__note">How the app tells your transfers, payments to people, and card fees from purchases. The first rule that fits wins. A change reads what the bank sends from then on; what was already read stays as it was.</p>
        {view.bankRules.length === 0 ? (
          <p className="card__note" data-testid="bank-rules-empty">
            None yet.
          </p>
        ) : (
          <BankRuleRows rules={view.bankRules} onOpen={(rule) => openBank({ rule })} />
        )}
        <ListRow icon="settings" title="Add a bank rule" onClick={() => openBank({ start: null, title: 'New bank rule' })} testId="row-add-bank-rule" />
      </Card>

      {view.sync !== undefined && (
        <SyncCard
          sync={view.sync}
          onSaid={setSaid}
          reload={(when) => {
            reload(when);
            onChanged(when);
          }}
        />
      )}

      {view.login !== undefined && (
        <LoginCard
          login={view.login}
          onSaid={setSaid}
          reload={(when) => {
            reload(when);
            onChanged(when);
          }}
        />
      )}

      <Card title="Change log" testId="log">
        {view.log.length === 0 ? (
          <StateMessage icon="clock" title="Nothing changed yet" detail="Every change to your settings and rules, and every hand move, shows here with its date." testId="log-empty" />
        ) : (
          view.log.map((line) => <LogLine key={line.key} line={line} />)
        )}
      </Card>

      {bankEditing !== null && (
        <BankRuleSheet
          // Its own key: the settings sheet beside it is keyed by the same count.
          key={`bank-${opened}`}
          editing={bankEditing}
          rules={view.bankRules}
          {...(view.accounts === undefined ? {} : { accounts: view.accounts })}
          send={sendBankRule}
          onClose={() => setBankEditing(null)}
          onDone={(change) => {
            setBankEditing(null);
            setSaid({ tone: 'ok', text: bankRuleDoneText(change) });
            reload('after');
          }}
        />
      )}

      <SettingSheet
        key={opened}
        editing={editing}
        view={view}
        onClose={() => setEditing(null)}
        onDone={(text) => {
          setEditing(null);
          setSaid({ tone: 'ok', text });
          reload('after');
          onChanged('after');
        }}
      />
    </>
  );
}

// ----- The change log (13.5) -----

function LogLine({ line }: { readonly line: LogRow }) {
  const when = shortDate(line.date);
  const testId = `log-${line.key}`;
  switch (line.kind) {
    case 'setting': {
      const { change } = line;
      const before = settingValueText(change.key, change.before);
      const after = settingValueText(change.key, change.after);
      return <ListRow icon="settings" title={SETTING_NAMES[change.key]} detail={`${before} → ${after} · ${when}${line.fromNextPaycheck ? ' · from the next paycheck' : ''}`} testId={testId} />;
    }
    case 'rule-added':
      return (
        <ListRow
          icon="swap"
          title={line.fromCorrection ? 'Rule added from a correction' : 'Rule added'}
          detail={`${RULE_KINDS[line.rule.for]}: ${ruleText(line.rule)}${line.aheadOf === null ? '' : `, ahead of ${ruleText(line.aheadOf)}`} · ${when}`}
          testId={testId}
        />
      );
    case 'rule-changed':
      return <ListRow icon="swap" title="Rule changed" detail={`${ruleText(line.before)} to ${ruleText(line.after)} · ${when}`} testId={testId} />;
    case 'rule-removed':
      return <ListRow icon="swap" title="Rule removed" detail={`${RULE_KINDS[line.rule.for]}: ${ruleText(line.rule)} · ${when}`} testId={testId} />;
    case 'rule-moved':
      return (
        <ListRow
          icon="swap"
          title={line.direction === 'up' ? 'Rule moved up' : 'Rule moved down'}
          detail={`${RULE_KINDS[line.rule.for]}: ${ruleText(line.rule)}, now number ${line.position}, ${line.direction === 'up' ? 'ahead of' : 'after'} ${ruleText(line.past)} · ${when}`}
          testId={testId}
        />
      );
    case 'money-moved':
      return <ListRow icon="move" title={`Moved from ${POT_NAMES[line.from]} to ${POT_NAMES[line.to]}`} detail={when} trailing={<Money cents={line.amount} />} testId={testId} />;
    case 'bank-took-back':
      return <ListRow icon="undo" title={`The bank took back ${line.description}`} detail={when} trailing={<Money cents={line.amount} />} testId={testId} />;
    case 'bank-rule-added':
      return <ListRow icon="bank" title="Bank rule added" detail={`${bankRuleText(line.rule)} · ${when}`} testId={testId} />;
    case 'bank-rule-changed':
      return <ListRow icon="bank" title="Bank rule changed" detail={`${bankRuleText(line.before)} to ${bankRuleText(line.after)} · ${when}`} testId={testId} />;
    case 'bank-rule-removed':
      return <ListRow icon="bank" title="Bank rule removed" detail={`${bankRuleText(line.rule)} · ${when}`} testId={testId} />;
    case 'bank-rule-moved':
      return (
        <ListRow
          icon="bank"
          title={line.direction === 'up' ? 'Bank rule moved up' : 'Bank rule moved down'}
          detail={`${bankRuleText(line.rule)}, now number ${line.position}, ${line.direction === 'up' ? 'ahead of' : 'after'} ${bankRuleText(line.past)} · ${when}`}
          testId={testId}
        />
      );
    case 'history-retotaled':
      return <ListRow icon="undo" title="History took new totals" detail={`${retotaledText(line)} · ${when}`} testId={testId} />;
    case 'logged-in':
    case 'logged-out':
    case 'passkey-added':
      return <ListRow icon="lock" title={LOGIN_LINES[line.kind]} detail={`${line.device} · ${when}`} testId={testId} />;
    case 'stay-logged-in-changed':
      return <ListRow icon="lock" title="Stay logged in" detail={`${daysText(line.before)} → ${daysText(line.after)} · ${when}`} testId={testId} />;
    case 'sync-every-changed':
      return <ListRow icon="clock" title="Sync with the bank" detail={`Every ${minutesText(line.before)} → every ${minutesText(line.after)} · ${when}`} testId={testId} />;
    case 'notifications-on':
    case 'notifications-off':
      return <ListRow icon="bell" title={NOTIFICATION_LINES[line.kind]} detail={`${line.device} · ${when}`} testId={testId} />;
    case 'notifications-stopped':
      return <ListRow icon="bell" title={NOTIFICATION_LINES[line.kind]} detail={`${line.device}: its push service would not take them any more · ${when}`} testId={testId} />;
    case 'bank-connected':
      // Her setup names her bank (HB8).
      return <ListRow icon="bank" title="Bank connected" detail={`${line.name !== undefined ? HER_BANK_WORDS.connectedThrough(line.name) : line.bank === 'test' ? "Plaid's test bank" : 'Bank of America, through Plaid'} · ${when}`} testId={testId} />;
    case 'bank-accounts':
      return <ListRow icon="bank" title="Which account is which" detail={`${bankAccountsText(line.accounts)} · ${when}`} testId={testId} />;
    case 'bank-logged-in-again':
      return <ListRow icon="bank" title="Logged in to the bank again" detail={when} testId={testId} />;
    case 'setup-day':
      return <ListRow icon="check" title="Setup day" detail={`${setupDayText(line)} · ${when}`} testId={testId} />;
  }
}

// ----- The sheet that changes one setting or rule -----

type Fields = Readonly<Record<string, string>>;

// What he types, read as what the money math keeps; or what is wrong with it.
type Reading<T> = { readonly value: T } | { readonly problem: string };

const whole = (text: string): number | null => (/^\d{1,6}$/.test(text.trim()) ? Number(text.trim()) : null);
const dollars = (text: string): Cents | null => {
  try {
    return parseDollars(text.trim());
  } catch {
    return null;
  }
};
// An amount as it is typed: 1,500.00 (never negative here).
const typed = (cents: Cents): string => formatDollars(cents).replace('$', '');

function reserveOf(split: Tracking['split']): { readonly now: { readonly perPaycheck: Cents; readonly cap: Cents }; readonly next: { readonly perPaycheck: Cents; readonly cap: Cents } } | null {
  const { momReservePerPaycheck: perPaycheck, momReserveCap: cap } = split.thisPayPeriod;
  const { momReservePerPaycheck: nextPerPaycheck, momReserveCap: nextCap } = split.fromNextPaycheck;
  if (perPaycheck === undefined || cap === undefined || nextPerPaycheck === undefined || nextCap === undefined) return null;
  return { now: { perPaycheck, cap }, next: { perPaycheck: nextPerPaycheck, cap: nextCap } };
}

// "Off in this setup": a setting that is not there is never opened (its row is not shown).
function startFields(editing: Editing, s: SettingsValuesShown): Fields {
  switch (editing.what) {
    case 'split':
      return { savings: String(s.split.savings), needs: String(s.split.needs), wants: String(s.split.wants), ...(s.split.wishlist === undefined ? {} : { wishlist: String(s.split.wishlist) }) };
    case 'reserve':
      return { perPaycheck: typed(s.momReservePerPaycheck ?? 0), cap: typed(s.momReserveCap ?? 0) };
    case 'target':
      return { low: typed(s.momMonthlyTarget?.low ?? 0), high: typed(s.momMonthlyTarget?.high ?? 0) };
    case 'low-alert':
      return { percent: String(s.lowBucketAlertPercent) };
    case 'reminders':
      return { days: s.cardReminderDaysBefore.join(', ') };
    case 'review-time':
      return { time: s.dailyReviewTime };
    case 'time-zone':
      return { zone: s.homeTimeZone };
    case 'quiet-hours':
      return { from: s.quietHours.from, to: s.quietHours.to };
    case 'not-read':
      return { hours: String(s.bankNotReadAlertHours) };
    case 'mismatch-wait':
      return { hours: String(s.totalsMismatchAlertHours) };
    case 'permission-warn':
      return { days: String(s.bankPermissionWarnDays) };
    case 'lock-amounts':
      return { on: s.amountsOnLockScreen ? 'on' : 'off' };
    case 'ask-paycheck':
      return { on: s.askBeforeSplittingPaycheck === true ? 'on' : 'off' };
    case 'leftover':
      return { needs: s.leftoverAtPayday.needs, wants: s.leftoverAtPayday.wants };
    case 'promo':
      return { date: s.oldCardPromoEndDate ?? '' };
    case 'paycheck-rule':
      return { text: s.paycheckRule?.contains ?? '' };
    case 'mom-rule':
      return { text: s.momRule?.contains ?? '' };
    case 'pay-schedule':
      return { schedule: s.paySchedule, scheduleWas: s.paySchedule, days: String(s.payScheduleDays) };
    case 'early-days':
      return { days: String(s.earlyPaycheckDays) };
    case 'closing-day-everyday':
      return { day: s.everydayCardClosingDay === null ? '' : String(s.everydayCardClosingDay) };
    case 'closing-day-old':
      return { day: s.oldCardClosingDay === null || s.oldCardClosingDay === undefined ? '' : String(s.oldCardClosingDay) };
    case 'closing-day-second':
      return { day: s.secondCardClosingDay === null || s.secondCardClosingDay === undefined ? '' : String(s.secondCardClosingDay) };
    case 'rule':
      return editing.rule === null ? { kind: 'purchase', text: '', to: 'needs' } : { kind: editing.rule.for, text: editing.rule.contains, to: editing.rule.to };
  }
}

// The settings to send, from what he typed. Nothing is worked out: the money
// math checks every value and says what is wrong.
function readSettings(editing: Editing, f: Fields): Reading<Partial<Settings>> {
  const get = (name: string): string => f[name] ?? '';
  const wholes = (names: readonly string[]): Reading<number[]> => {
    const values = names.map((n) => whole(get(n)));
    return values.every((v): v is number => v !== null) ? { value: values } : { problem: 'Enter whole numbers, like 30' };
  };
  const amounts = (names: readonly string[]): Reading<Cents[]> => {
    const values = names.map((n) => dollars(get(n)));
    return values.every((v): v is Cents => v !== null) ? { value: values } : { problem: 'Enter amounts like 1,500.00' };
  };
  switch (editing.what) {
    case 'split': {
      // Her rulebook, section 2: with Wishlist's share, where the setup has it.
      const withWishlist = 'wishlist' in f;
      const r = wholes(['savings', 'needs', 'wants', ...(withWishlist ? ['wishlist'] : [])]);
      if ('problem' in r) return r;
      const [savings = 0, needs = 0, wants = 0, wishlist = 0] = r.value;
      return { value: { split: withWishlist ? { savings, needs, wants, wishlist } : { savings, needs, wants } } };
    }
    case 'reserve': {
      const r = amounts(['perPaycheck', 'cap']);
      if ('problem' in r) return r;
      const [perPaycheck = 0, cap = 0] = r.value;
      return { value: { momReservePerPaycheck: perPaycheck, momReserveCap: cap } };
    }
    case 'target': {
      const r = amounts(['low', 'high']);
      if ('problem' in r) return r;
      const [low = 0, high = 0] = r.value;
      return { value: { momMonthlyTarget: { low, high } } };
    }
    case 'low-alert': {
      const r = wholes(['percent']);
      return 'problem' in r ? r : { value: { lowBucketAlertPercent: r.value[0] ?? 0 } };
    }
    case 'reminders': {
      const parts = get('days').split(/[\s,]+/).filter((p) => p !== '');
      const days = parts.map(whole);
      if (!days.every((d): d is number => d !== null)) return { problem: 'Enter days like 7, 2' };
      return { value: { cardReminderDaysBefore: days } };
    }
    case 'review-time':
      return /^\d{2}:\d{2}$/.test(get('time')) ? { value: { dailyReviewTime: get('time') } } : { problem: 'Pick a time' };
    case 'time-zone':
      return { value: { homeTimeZone: get('zone') } };
    case 'quiet-hours':
      return /^\d{2}:\d{2}$/.test(get('from')) && /^\d{2}:\d{2}$/.test(get('to')) ?{ value: { quietHours: { from: get('from'), to: get('to') } } } : { problem: 'Pick two times' };
    case 'not-read': {
      const r = wholes(['hours']);
      return 'problem' in r ? r : { value: { bankNotReadAlertHours: r.value[0] ?? 0 } };
    }
    case 'mismatch-wait': {
      const r = wholes(['hours']);
      return 'problem' in r ? r : { value: { totalsMismatchAlertHours: r.value[0] ?? 0 } };
    }
    case 'permission-warn': {
      const r = wholes(['days']);
      return 'problem' in r ? r : { value: { bankPermissionWarnDays: r.value[0] ?? 0 } };
    }
    case 'lock-amounts':
      return { value: { amountsOnLockScreen: get('on') === 'on' } };
    case 'ask-paycheck':
      return { value: { askBeforeSplittingPaycheck: get('on') === 'on' } };
    case 'leftover':
      return { value: { leftoverAtPayday: { needs: get('needs') as LeftoverChoice, wants: get('wants') as LeftoverChoice } } };
    case 'promo':
      return get('date') === '' ? { problem: 'Pick a date' } : { value: { oldCardPromoEndDate: get('date') } };
    case 'paycheck-rule':
      return get('text').trim() === '' ? { problem: 'Enter the text the bank shows' } : { value: { paycheckRule: { contains: get('text').trim() } } };
    case 'mom-rule':
      return get('text').trim() === '' ? { problem: 'Enter the text the bank shows' } : { value: { momRule: { contains: get('text').trim() } } };
    case 'pay-schedule': {
      // Only what changed is sent, as on every other sheet.
      if (get('schedule') === 'twice-a-month') return { value: { paySchedule: 'twice-a-month' } };
      const r = wholes(['days']);
      if ('problem' in r) return r;
      return { value: { ...(get('scheduleWas') === 'every-n-days' ? {} : { paySchedule: 'every-n-days' as const }), payScheduleDays: r.value[0] ?? 0 } };
    }
    case 'early-days': {
      const r = wholes(['days']);
      return 'problem' in r ? r : { value: { earlyPaycheckDays: r.value[0] ?? 0 } };
    }
    case 'closing-day-everyday':
    case 'closing-day-old':
    case 'closing-day-second': {
      const r = wholes(['day']);
      if ('problem' in r) return r;
      return { value: { [CLOSING_DAY_KEY[editing.what]]: r.value[0] ?? 0 } };
    }
    case 'rule':
      return { problem: 'not a setting' };
  }
}

function readRule(f: Fields): Reading<RuleSpec> {
  const text = (f['text'] ?? '').trim();
  if (text === '') return { problem: 'Enter the text the bank shows' };
  return { value: { for: f['kind'], contains: text, to: f['to'] } as RuleSpec };
}

const TITLES: Readonly<Record<Editing['what'], string>> = {
  split: 'Change the split',
  reserve: 'Change the mom reserve',
  target: 'Mom monthly target',
  'low-alert': 'Low-bucket alert',
  reminders: 'Card reminders',
  'review-time': 'Daily review',
  'time-zone': 'Home time zone',
  'quiet-hours': 'Quiet hours',
  'not-read': 'Bank not read',
  'mismatch-wait': 'Totals do not match',
  'permission-warn': 'Bank permission ending',
  'lock-amounts': 'Amounts on the lock screen',
  'ask-paycheck': 'Ask before splitting a paycheck',
  leftover: 'Leftover at payday',
  promo: 'Old card promo end date',
  'paycheck-rule': 'Paycheck rule',
  'pay-schedule': 'Pay schedule',
  'mom-rule': 'Mom rule',
  'early-days': 'Early paycheck check',
  'closing-day-everyday': 'Everyday card: statement closing day',
  'closing-day-old': 'Old card: statement closing day',
  'closing-day-second': 'Second card: statement closing day',
  rule: 'Sorting rule',
};

// Which setting each card's closing day is.
const CLOSING_DAY_KEY = { 'closing-day-everyday': 'everydayCardClosingDay', 'closing-day-old': 'oldCardClosingDay', 'closing-day-second': 'secondCardClosingDay' } as const;

// A card's closing day is called by its name in her setup (HB6).
function titleOf(what: Editing['what']): string {
  if (what === 'closing-day-everyday') return SETTING_NAMES.everydayCardClosingDay;
  if (what === 'closing-day-second') return SETTING_NAMES.secondCardClosingDay;
  return TITLES[what];
}

// What is being sent: a settings change or a rule change, without its decision number.
type Change = Omit<SettingsRequest, 'id'> | Omit<RuleRequest, 'id'>;

interface Asked {
  readonly change: Change;
  readonly why: string;
  readonly preview: SettingsPreviewView | null;
  readonly yes: string;
}

// Made anew each time it opens (see the key above): it starts with the values
// as they are then, and keeps showing what it was opened for while it closes.
function SettingSheet({ editing, view, onClose, onDone }: { readonly editing: Editing | null; readonly view: Tracking; readonly onClose: () => void; readonly onDone: (text: string) => void }) {
  const [shown] = useState<Editing | null>(editing);
  const [fields, setFields] = useState<Fields>(() => (editing === null ? {} : startFields(editing, view.settings)));
  const [asked, setAsked] = useState<Asked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A second tap before the screen has redrawn must not send a second request.
  const lock = useRef(false);
  // The decision number goes with the change: the same change sent again (a retry, or his yes) keeps it.
  const attempt = useRef<{ readonly key: string; readonly id: string } | null>(null);

  const e = shown;
  if (e === null) return <BottomSheet open={false} title="Settings" onClose={onClose} testId="settings-sheet">{null}</BottomSheet>;
  const set = (name: string) => (value: string) => setFields((old) => ({ ...old, [name]: value }));
  const get = (name: string): string => fields[name] ?? '';

  const send = (change: Change, yes?: { readonly seen?: string }): void => {
    if (lock.current) return;
    const key = JSON.stringify(change);
    const id = attempt.current?.key === key ? attempt.current.id : newDecisionId();
    attempt.current = { key, id };
    lock.current = true;
    setSending(true);
    setProblem(null);
    const confirmed = yes === undefined ? {} : { confirmed: true, ...(yes.seen === undefined ? {} : { seen: yes.seen }) };
    const answered = (answer: { readonly ok: boolean; readonly code?: string; readonly why?: string; readonly preview?: SettingsPreviewView }, done: () => string): void => {
      lock.current = false;
      setSending(false);
      if (answer.ok) {
        onDone(done());
      } else if (answer.code === 'needs-confirmation') {
        setAsked({ change, why: answer.why ?? '', preview: answer.preview ?? null, yes: 'rule' in change ? 'Yes, remove it' : 'paycheckRule' in change.settings && change.settings.paycheckRule === null ? 'Yes, clear it' : 'momRule' in change.settings && change.settings.momRule === null ? 'Yes, clear it' : 'Yes, set it' });
      } else {
        // Refused: nothing changed. Back to the form, with the reason.
        setAsked(null);
        setProblem(answer.why ?? 'That was not saved.');
      }
    };
    const failed = (): void => {
      lock.current = false;
      setSending(false);
      setProblem("Couldn't save that. Check your connection and try again. Nothing is counted twice.");
    };
    if ('settings' in change) {
      sendChoice({ id, ...change, ...confirmed }).then((answer) => answered(answer, () => (answer.ok ? settingsDoneText(answer.done, view.split.nextPayday.date) : '')), failed);
    } else {
      sendChoice({ id, ...change, ...confirmed }).then((answer) => answered(answer, () => (answer.ok ? ruleDoneText(answer.done) : '')), failed);
    }
  };

  const reading: Reading<Change> =
    e.what === 'rule'
      ? (() => {
          const r = readRule(fields);
          if ('problem' in r) return r;
          return { value: e.rule === null ? { rule: { add: r.value } } : { rule: { change: { id: e.rule.id, ...r.value } } } };
        })()
      : (() => {
          const r = readSettings(e, fields);
          return 'problem' in r ? r : { value: { settings: r.value } };
        })();
  const showReading = 'problem' in reading && Object.values(fields).some((v) => v.trim() !== '') ? reading.problem : null;
  const rule = e.what === 'rule' ? e.rule : null;
  const kind = (get('kind') || 'purchase') as RuleSpec['for'];

  return (
    <BottomSheet open={editing !== null} title={asked !== null ? 'Are you sure?' : titleOf(e.what)} onClose={onClose} testId="settings-sheet">
      {asked === null && (
        <>
          {problem !== null && (
            <Notice tone="danger" icon="alert" testId="sheet-problem">
              {problem}
            </Notice>
          )}
          <div className="card" style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
            <SheetFields editing={e} get={get} set={set} view={view} kind={kind} />
            {showReading !== null && (
              <p className="field__hint" role="alert" data-testid="sheet-reading">
                {showReading}
              </p>
            )}
          </div>
          <Button wide disabled={sending || 'problem' in reading} testId="sheet-save" onClick={() => 'value' in reading && send(reading.value)}>
            {sending ? 'Saving…' : 'Save'}
          </Button>
          {(e.what === 'paycheck-rule' && view.settings.paycheckRule !== null) || (e.what === 'mom-rule' && view.settings.momRule !== null) ? (
            <Button variant="secondary" wide disabled={sending} testId="sheet-clear" onClick={() => send({ settings: e.what === 'paycheck-rule' ? { paycheckRule: null } : { momRule: null } })}>
              Clear the rule
            </Button>
          ) : null}
          {(e.what === 'closing-day-everyday' || e.what === 'closing-day-old' || e.what === 'closing-day-second') && (view.settings[CLOSING_DAY_KEY[e.what]] ?? null) !== null && (
            <Button variant="secondary" wide disabled={sending} testId="sheet-clear" onClick={() => send({ settings: { [CLOSING_DAY_KEY[e.what as keyof typeof CLOSING_DAY_KEY]]: null } })}>
              Clear the day
            </Button>
          )}
          {e.what === 'promo' && view.settings.oldCardPromoEndDate !== null && (
            <Button variant="secondary" wide disabled={sending} testId="sheet-clear" onClick={() => send({ settings: { oldCardPromoEndDate: null } })}>
              Clear the date
            </Button>
          )}
          {rule !== null && (
            // A22: one place up or down among the rules of its kind; the first that matches wins.
            <ButtonRow>
              {rule.position > 1 && (
                <Button variant="secondary" wide disabled={sending} testId="sheet-move-up" onClick={() => send({ rule: { move: { id: rule.id, direction: 'up' } } })}>
                  Move up
                </Button>
              )}
              {rule.position < view.rules[rule.for].length && (
                <Button variant="secondary" wide disabled={sending} testId="sheet-move-down" onClick={() => send({ rule: { move: { id: rule.id, direction: 'down' } } })}>
                  Move down
                </Button>
              )}
            </ButtonRow>
          )}
          {rule !== null && (
            <Button variant="secondary" wide disabled={sending} testId="sheet-remove" onClick={() => send({ rule: { remove: rule.id } })}>
              Remove this rule
            </Button>
          )}
          <p className="sheet__note" data-testid="sheet-note">
            {sheetNote(e, view)}
          </p>
        </>
      )}
      {asked !== null && (
        <>
          <Notice tone="warning" icon="alert" testId="confirm-ask">
            {asked.why}
          </Notice>
          {asked.preview !== null && <PreviewOf preview={asked.preview} view={view} />}
          <ButtonRow>
            <Button wide disabled={sending} testId="confirm-yes" onClick={() => send(asked.change, asked.preview === null ? {} : { seen: asked.preview.key })}>
              {sending ? 'Saving…' : asked.yes}
            </Button>
            <Button variant="secondary" wide disabled={sending} testId="confirm-cancel" onClick={() => setAsked(null)}>
              Cancel
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

function sheetNote(e: Editing, view: Tracking): string {
  switch (e.what) {
    case 'split':
    case 'reserve':
      return `This starts at your next paycheck, ${shortDate(view.split.nextPayday.date)}. This pay period keeps what it started with.`;
    case 'paycheck-rule':
    case 'mom-rule':
      return 'Before it is saved, you see what it would do to what is waiting in Review. That part cannot be undone here.';
    case 'leftover':
      return 'Used at your next payday. This payday’s questions stay as they are.';
    case 'rule':
      return e.rule === null
        ? 'It goes to the end of its list, and sorts what is waiting in Review that it is the first match for. What is already sorted stays where it is.'
        : 'It keeps its place in the list, and sorts what is waiting in Review that it is now the first match for. What is already sorted stays where it is.';
    default:
      return 'This applies right away.';
  }
}

function SheetFields({ editing, get, set, view, kind }: { readonly editing: Editing; readonly get: (name: string) => string; readonly set: (name: string) => (value: string) => void; readonly view: Tracking; readonly kind: RuleSpec['for'] }) {
  const leftoverOptions = (['ask', 'roll-over', 'move-to-savings'] as const).map((c) => ({ value: c, label: LEFTOVER_NAMES[c] }));
  switch (editing.what) {
    case 'split':
      return (
        <>
          <TextField label="Savings (%)" kind="whole" value={get('savings')} onChange={set('savings')} testId="field-savings" />
          <TextField label="Needs (%)" kind="whole" value={get('needs')} onChange={set('needs')} testId="field-needs" />
          {view.settings.split.wishlist === undefined ? (
            <TextField label="Wants (%)" kind="whole" value={get('wants')} onChange={set('wants')} testId="field-wants" hint="The three must add up to 100." />
          ) : (
            <>
              <TextField label="Wants (%)" kind="whole" value={get('wants')} onChange={set('wants')} testId="field-wants" />
              <TextField label="Wishlist (%)" kind="whole" value={get('wishlist')} onChange={set('wishlist')} testId="field-wishlist" hint="The four must add up to 100. Wishlist money is kept in savings and is not part of safe to spend." />
            </>
          )}
        </>
      );
    case 'reserve':
      return (
        <>
          <TextField label="Per paycheck (dollars)" money value={get('perPaycheck')} onChange={set('perPaycheck')} testId="field-reserve" />
          <TextField label="Most it holds (dollars)" money value={get('cap')} onChange={set('cap')} testId="field-cap" hint="What does not fit goes to savings." />
        </>
      );
    case 'target':
      return (
        <>
          <TextField label="At least (dollars a month)" money value={get('low')} onChange={set('low')} testId="field-target-low" />
          <TextField label="At most (dollars a month)" money value={get('high')} onChange={set('high')} testId="field-target-high" />
        </>
      );
    case 'low-alert':
      return <TextField label="Alert below (% of what the bucket started with)" kind="whole" value={get('percent')} onChange={set('percent')} testId="field-low-alert" />;
    case 'reminders':
      return <TextField label="Days before the due date" value={get('days')} onChange={set('days')} testId="field-reminders" hint="Like 7, 2. Leave it empty for no reminders." />;
    case 'review-time':
      return <TextField label="Time" kind="time" value={get('time')} onChange={set('time')} testId="field-review-time" />;
    case 'time-zone': {
      // His zone is always one of the choices, even one not in the list.
      const zones = ZONE_CHOICES.includes(get('zone')) ? ZONE_CHOICES : [get('zone'), ...ZONE_CHOICES];
      return <SelectField label="Time zone" value={get('zone')} onChange={set('zone')} options={zones.map((z) => ({ value: z, label: zoneText(z) }))} testId="field-time-zone" />;
    }
    case 'quiet-hours':
      return (
        <>
          <TextField label="From" kind="time" value={get('from')} onChange={set('from')} testId="field-quiet-from" />
          <TextField label="To" kind="time" value={get('to')} onChange={set('to')} testId="field-quiet-to" hint="No alert is sent then; what comes due waits until they end and says when it was due. The same time twice means no quiet hours." />
        </>
      );
    case 'not-read':
      return <TextField label="Alert after this many hours" kind="whole" value={get('hours')} onChange={set('hours')} testId="field-not-read" hint="1 to 168 (a week). Told once, and again only after the bank is read." />;
    case 'mismatch-wait':
      return <TextField label="Alert after this many hours" kind="whole" value={get('hours')} onChange={set('hours')} testId="field-mismatch-wait" hint="1 to 168 (a week). Until then Home says the bank is still catching up, with the difference." />;
    case 'permission-warn':
      return <TextField label="Days before it runs out" kind="whole" value={get('days')} onChange={set('days')} testId="field-permission-warn" hint="1 to 60. Told once, at the daily review time. Logging in to the bank again moves the date." />;
    case 'lock-amounts':
      return (
        <SelectField
          label="On the lock screen"
          value={get('on')}
          onChange={set('on')}
          options={[
            { value: 'off', label: 'Words only, such as "Needs is low"' },
            { value: 'on', label: 'With the amounts' },
          ]}
          testId="field-lock-amounts"
        />
      );
    case 'ask-paycheck':
      return (
        <>
          <SelectField
            label="When a paycheck comes in"
            value={get('on')}
            onChange={set('on')}
            options={[
              { value: 'on', label: 'Wait for my yes in Review, showing what each bucket would get' },
              { value: 'off', label: 'Split it by itself' },
            ]}
            testId="field-ask-paycheck"
          />
          <p className="sheet__note">Turning it off splits only the paychecks that come in after. One already waiting still waits for your yes.</p>
        </>
      );
    case 'leftover':
      return (
        <>
          <SelectField label="Needs" value={get('needs')} onChange={set('needs')} options={leftoverOptions} testId="field-leftover-needs" />
          <SelectField label="Wants" value={get('wants')} onChange={set('wants')} options={leftoverOptions} testId="field-leftover-wants" />
        </>
      );
    case 'promo':
      return <TextField label="Promo ends on" kind="date" value={get('date')} onChange={set('date')} testId="field-promo" hint="Entering it turns on the payoff countdown." />;
    case 'paycheck-rule':
      return <TextField label="Your paycheck's description contains" value={get('text')} onChange={set('text')} testId="field-paycheck-rule" />;
    case 'mom-rule':
      return <TextField label="Payments to mom contain" value={get('text')} onChange={set('text')} testId="field-mom-rule" />;
    case 'pay-schedule':
      return (
        <>
          <SelectField
            label="Paid"
            value={get('schedule')}
            onChange={set('schedule')}
            options={[
              { value: 'twice-a-month', label: 'Twice a month, the 15th and the last day' },
              { value: 'every-n-days', label: 'Every so many days' },
            ]}
            testId="field-pay-schedule-kind"
          />
          {get('schedule') === 'twice-a-month' ? (
            <p className="card__note">A 15th or last day on a Saturday or Sunday is paid the Friday before. A paycheck a few days early or late does not move the next payday.</p>
          ) : (
            <TextField label="Days between paychecks" kind="whole" value={get('days')} onChange={set('days')} testId="field-pay-schedule" />
          )}
        </>
      );
    case 'early-days':
      return <TextField label="Days" kind="whole" value={get('days')} onChange={set('days')} testId="field-early-days" />;
    case 'closing-day-everyday':
    case 'closing-day-old':
    case 'closing-day-second':
      return (
        <TextField
          label="Day of the month the statement closes"
          kind="whole"
          value={get('day')}
          onChange={set('day')}
          testId="field-closing-day"
          hint="Read it off a statement: the day of its closing date. 1 to 31; a month without that day closes on its last day. Used only when the bank does not send the statement date."
        />
      );
    case 'rule': {
      const choices = view.ruleChoices[kind] as readonly RuleSpec['to'][];
      const to = get('to');
      return (
        <>
          <SelectField
            label="For"
            value={kind}
            onChange={(value) => {
              set('kind')(value);
              // A choice the new kind cannot make starts over at its first one.
              const allowed = view.ruleChoices[value as RuleSpec['for']] as readonly string[];
              if (!allowed.includes(to)) set('to')(allowed[0] ?? '');
            }}
            options={(['purchase', 'deposit', 'person'] as const).map((k) => ({ value: k, label: RULE_KINDS[k] }))}
            testId="field-rule-kind"
          />
          <TextField label="The bank's description contains" value={get('text')} onChange={set('text')} testId="field-rule-text" />
          <SelectField label="Then" value={to} onChange={set('to')} options={choices.map((c) => ({ value: c, label: RULE_CHOICE_NAMES[c] }))} testId="field-rule-to" />
        </>
      );
    }
  }
}

// A9: what the paycheck rule or the mom rule would do, from the money math, before the yes.
function PreviewOf({ preview, view }: { readonly preview: SettingsPreviewView; readonly view: Tracking }) {
  const { potsBefore: before, potsAfter: after } = preview;
  // Her rulebook, "Off in this setup" and section 2 (PR 12): no mom reserve
  // where the setup has none, and Wishlist where the split names it.
  const mom = view.settings.momReservePerPaycheck !== undefined;
  const wishlist = view.settings.split.wishlist !== undefined;
  const pots: readonly ('savings' | 'needs' | 'wants' | 'wishlist' | 'momReserve' | 'heldForOthers')[] = ['savings', 'needs', 'wants', ...(wishlist ? (['wishlist'] as const) : []), ...(mom ? (['momReserve'] as const) : []), 'heldForOthers'];
  return (
    <div data-testid="preview" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Card title="What it would do">
        {preview.items.length === 0 ? (
          <p className="card__note" data-testid="preview-none">
            Nothing waiting in Review matches it now.
          </p>
        ) : (
          preview.items.map((item) => (
            <ListRow
              key={item.id}
              title={item.description}
              detail={
                <>
                  {shortDate(item.date)}. {recheckedText(item, view.settings.earlyPaycheckDays)}
                  {item.kind === 'paycheck' && (
                    <>
                      {' '}
                      {mom && (
                        <>
                          Mom reserve <Money cents={item.split.momReserve} />,{' '}
                        </>
                      )}
                      Savings <Money cents={item.split.savings} />, Needs <Money cents={item.split.needs} />, Wants <Money cents={item.split.wants} />
                      {item.split.wishlist === undefined ? '' : <>, Wishlist <Money cents={item.split.wishlist} /></>}.
                    </>
                  )}
                </>
              }
              trailing={<Money cents={item.amount} />}
              testId={`preview-item-${item.id}`}
            />
          ))
        )}
      </Card>
      <Card title="Your buckets">
        <CompareTable
          caption="Your buckets now, and after it"
          testId="preview-buckets"
          columns={[{ name: 'Now' }, { name: 'After' }]}
          rows={[
            ...pots.map((pot) => ({
              label: POT_NAMES[pot],
              first: <Money cents={before[pot] ?? 0} />,
              second: <Money cents={after[pot] ?? 0} testId={`preview-after-${pot}`} />,
              differs: before[pot] !== after[pot],
              testId: `preview-${pot}`,
            })),
            { label: 'Waiting in Review', first: String(preview.waitingBefore), second: <span data-testid="preview-after-waiting">{preview.waitingAfter}</span>, differs: preview.waitingBefore !== preview.waitingAfter, testId: 'preview-waiting' },
          ]}
        />
        {preview.items.some((item) => item.kind === 'paycheck') && (
          <p className="card__note" data-testid="preview-questions">
            A paycheck also asks what to do with what is left in needs and wants, unless your leftover setting answers it. Those questions wait in Review.
          </p>
        )}
      </Card>
    </div>
  );
}

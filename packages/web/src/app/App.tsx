import type { Pot } from '@budget-app/money';
import { MotionConfig } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { ActivityScreen, type Back } from '../screens/Activity.js';
import { AlertsScreen } from '../screens/Alerts.js';
import { StatusScreen } from '../screens/Status.js';
import { BankScreen } from '../screens/Bank.js';
import { BucketsScreen } from '../screens/Buckets.js';
import { HomeScreen } from '../screens/Home.js';
import { PaydayScreen } from '../screens/Payday.js';
import { ReviewScreen } from '../screens/Review.js';
import { SettingsScreen } from '../screens/Settings.js';
import { TrendsScreen } from '../screens/Trends.js';
import { SetupScreen } from '../screens/Setup.js';
import { StatementScreen } from '../screens/Statement.js';
import { Backdrop } from '../ui/blocks.js';
import { TabBar } from '../ui/TabBar.js';
import { useActivity, useAlerts, useBank, useBuckets, useHome, usePayday, useReview, useSettings, useSetup, useStatement, useStatus, useTrends, type Reload } from './api.js';
import { backTarget, pathOfRoute, routeLabel, routeOf, routeTitle, tabOfRoute, type Route, type SetupStepName, type StatementCard, type Tab } from './routes.js';

// Each of these loads its numbers when its screen opens, so it is always fresh.
// A change on one of them (a choice, a move) also asks Home for its numbers
// again: safe to spend and what needs him may have changed.
function BucketsTab({ onChanged }: { readonly onChanged: Reload }) {
  const [load, reload] = useBuckets();
  return <BucketsScreen load={load} onRetry={reload} onChanged={onChanged} />;
}

function ReviewTab({ onChanged }: { readonly onChanged: Reload }) {
  const [load, reload] = useReview();
  return <ReviewScreen load={load} onRetry={reload} onChanged={onChanged} />;
}

// Section 40: the Trends tab. It only reads.
function TrendsTab() {
  const [load, reload] = useTrends();
  return <TrendsScreen load={load} onRetry={reload} />;
}

function SettingsTab({ onChanged }: { readonly onChanged: Reload }) {
  const [load, reload] = useSettings();
  return <SettingsScreen load={load} onRetry={reload} onChanged={onChanged} />;
}

function ActivityTab({ pot, onChanged, back }: { readonly pot: Pot; readonly onChanged: Reload; readonly back: Back }) {
  const [load, reload] = useActivity(pot);
  return <ActivityScreen pot={pot} load={load} onRetry={reload} onChanged={onChanged} back={back} />;
}

function PaydayTab({ onChanged, back }: { readonly onChanged: Reload; readonly back: Back }) {
  const [load, reload] = usePayday();
  return <PaydayScreen load={load} onRetry={reload} onChanged={onChanged} back={back} />;
}

// The alerts sent (Phase 5), opened from Settings. It only reads.
function AlertsTab({ back }: { readonly back: Back }) {
  const [load, reload] = useAlerts();
  return <AlertsScreen load={load} onRetry={reload} back={back} />;
}

// 0.7 (A57): the status page, opened from Settings. It only reads.
function StatusTab({ back }: { readonly back: Back }) {
  const [load, reload] = useStatus();
  return <StatusScreen load={load} onRetry={reload} back={back} />;
}

// 1.1 to 1.3: the Bank connection screen, opened from Settings and Setup day.
function BankTab({ back }: { readonly back: Back }) {
  const [load, reload] = useBank();
  return <BankScreen load={load} onRetry={reload} back={back} />;
}

// Her rulebook, 52.4: a card's statement, opened from Home. It only reads.
function StatementTab({ card, back }: { readonly card: StatementCard; readonly back: Back }) {
  const [load, reload] = useStatement(card);
  return <StatementScreen card={card} load={load} onRetry={reload} back={back} />;
}

// Setup day (section 14). Once tracking starts, Home shows.
function SetupTab({ step, onStarted }: { readonly step: SetupStepName; readonly onStarted: () => void }) {
  const [load, reload] = useSetup();
  return <SetupScreen step={step} load={load} onRetry={reload} onStarted={onStarted} />;
}

const HOME: Route = { screen: 'tab', tab: 'home' };

// The address it was opened from, kept in the history entry (see go).
function cameFrom(): unknown {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null && 'from' in state ? (state as { from: unknown }).from : undefined;
}

// The app: the current screen and the tab bar. The screen is in the address
// (/home, /buckets, /review, /settings, and the screens opened from them,
// /buckets/needs and /payday), so a refresh or a notification link opens the
// right screen, and Back goes to the last one.
export function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname) ?? HOME);
  const [home, retryHome] = useHome();

  useEffect(() => {
    const onBack = (): void => setRoute(routeOf(window.location.pathname) ?? HOME);
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  useEffect(() => {
    document.title = routeTitle(route);
  }, [route]);

  const go = useCallback(
    (next: Route) => {
      if (pathOfRoute(next) === pathOfRoute(route)) {
        window.scrollTo({ top: 0 });
        return;
      }
      // 1.1: the Bank screen is always a page of its own, so its page rules
      // (the only ones that let Plaid's login in) apply; leaving it, the
      // strict rules come back with the next page.
      if (next.screen === 'bank' || route.screen === 'bank') {
        window.location.assign(pathOfRoute(next));
        return;
      }
      // The address he left is kept with the new one, so a screen opened from
      // two places can go back to the right one.
      window.history.pushState({ from: window.location.pathname }, '', pathOfRoute(next));
      setRoute(next);
      window.scrollTo({ top: 0 });
    },
    [route],
  );

  // Links inside a screen (like "3 waiting in review", or a bucket on Buckets) change screens too.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const target = link === null ? null : routeOf(new URL((link as HTMLAnchorElement).href).pathname);
      if (target === null) return;
      event.preventDefault();
      go(target);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [go]);

  // The link at the top of a screen that is not a tab. It goes back to where
  // he came from when the app knows it, otherwise to Buckets.
  const from = cameFrom();
  const target = backTarget(route, from);
  const cameFromTarget = typeof from === 'string' && routeOf(from) !== null && pathOfRoute(routeOf(from) as Route) === pathOfRoute(target);
  const back: Back = {
    href: pathOfRoute(target),
    label: routeLabel(target),
    onBack: () => (cameFromTarget ? window.history.back() : go(target)),
  };

  const waiting = home.status === 'ready' && home.value.state === 'tracking' ? home.value.waitingInReview : 0;
  return (
    // Reduced motion turns every Motion animation off (the CSS ones: base.css).
    <MotionConfig reducedMotion="user">
    <div className="app">
      <Backdrop />
      {route.screen === 'activity' ? (
        <ActivityTab key={route.pot} pot={route.pot} onChanged={retryHome} back={back} />
      ) : route.screen === 'payday' ? (
        <PaydayTab onChanged={retryHome} back={back} />
      ) : route.screen === 'alerts' ? (
        <AlertsTab back={back} />
      ) : route.screen === 'bank' ? (
        <BankTab back={back} />
      ) : route.screen === 'status' ? (
        <StatusTab back={back} />
      ) : route.screen === 'statement' ? (
        <StatementTab key={route.card} card={route.card} back={back} />
      ) : route.screen === 'setup' ? (
        <SetupTab
          step={route.step}
          onStarted={() => {
            retryHome('after');
            go(HOME);
          }}
        />
      ) : route.tab === 'home' ? (
        <HomeScreen load={home} onRetry={retryHome} />
      ) : route.tab === 'buckets' ? (
        <BucketsTab onChanged={retryHome} />
      ) : route.tab === 'review' ? (
        <ReviewTab onChanged={retryHome} />
      ) : route.tab === 'trends' ? (
        <TrendsTab />
      ) : (
        <SettingsTab onChanged={retryHome} />
      )}
      <TabBar current={tabOfRoute(route)} onGo={(tab: Tab) => go({ screen: 'tab', tab })} waitingInReview={waiting} />
    </div>
    </MotionConfig>
  );
}

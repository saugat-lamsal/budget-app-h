import type { Pot } from '@budget-app/money';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rememberCardNames } from '../ui/card-names.js';
import type {
  AlertsView,
  StatusView,
  ActivityShown as ActivityView,
  AuthState,
  BankAnswer,
  BankConnectionView,
  BankLinkAnswer,
  BankRuleRequest,
  BankRuleResponse,
  BucketsShown as BucketsView,
  CardNames,
  TrendsShown as TrendsView,
  ChoiceRequest,
  ChoiceResponse,
  HomeWithCards as HomeView,
  MoveRequest,
  MoveResponse,
  PaydayShown as PaydayView,
  PushAnswer,
  ReviewShown as ReviewView,
  RuleRequest,
  RuleResponse,
  SettingsRequest,
  SettingsResponse,
  SettingsShown as SettingsView,
  SetupRequest,
  SetupResponse,
  SetupShown as SetupView,
  StatementScreenView,
} from '@budget-app/server/views';
import type { StatementCard } from './routes.js';
// "Off in this setup" (her rulebook): the views as the phone gets them,
// which leave out the mom reserve and the old card when they are off.

// The screens' numbers, from the server. The screens never work money out
// themselves: every amount comes from the money math on the server.

export type Load<T> = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly value: T };

// Each screen's numbers are read from its own address on the app's own server.
const READ = { cache: 'no-store', headers: { Accept: 'application/json' } } as const;
const READS = {
  '/api/home': () => fetch('/api/home', READ),
  '/api/buckets': () => fetch('/api/buckets', READ),
  '/api/trends': () => fetch('/api/trends', READ),
  '/api/review': () => fetch('/api/review', READ),
  '/api/payday': () => fetch('/api/payday', READ),
  '/api/settings': () => fetch('/api/settings', READ),
  '/api/setup': () => fetch('/api/setup', READ),
  '/api/alerts': () => fetch('/api/alerts', READ),
  '/api/status': () => fetch('/api/status', READ),
  '/api/bank': () => fetch('/api/bank', READ),
  '/api/activity/savings': () => fetch('/api/activity/savings', READ),
  '/api/activity/needs': () => fetch('/api/activity/needs', READ),
  '/api/activity/wants': () => fetch('/api/activity/wants', READ),
  '/api/activity/mom-reserve': () => fetch('/api/activity/mom-reserve', READ),
  '/api/activity/held-for-others': () => fetch('/api/activity/held-for-others', READ),
  // Her rulebook, 52.4: each card's statement.
  '/api/statement/everyday-card': () => fetch('/api/statement/everyday-card', READ),
  '/api/statement/second-card': () => fetch('/api/statement/second-card', READ),
} as const;
const STATEMENT_URL: Readonly<Record<StatementCard, ViewUrl>> = { 'everyday-card': '/api/statement/everyday-card', 'second-card': '/api/statement/second-card' };
// Each bucket's activity is read from its own address.
const ACTIVITY_URL: Readonly<Record<Pot, ViewUrl>> = {
  savings: '/api/activity/savings',
  needs: '/api/activity/needs',
  wants: '/api/activity/wants',
  momReserve: '/api/activity/mom-reserve',
  heldForOthers: '/api/activity/held-for-others',
};
type ViewUrl = keyof typeof READS;

// On the real server, a screen whose login has ended goes to the login page
// (Step 2). The demo has no login, so it never answers 401.
function toLogin(response: Response): void {
  if (response.status === 401) window.location.assign('/login');
}

async function fetchView<T extends { readonly state: string }>(url: ViewUrl): Promise<T> {
  const response = await READS[url]();
  toLogin(response);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const view = (await response.json()) as T;
  // "Off in this setup": a bucket this setup does not have is 'off'.
  const statement = (Object.values(STATEMENT_URL) as string[]).includes(url);
  const states = url === '/api/bank' ? ['none', 'connected'] : url === ACTIVITY_URL.momReserve ? ['tracking', 'not-set-up', 'off'] : statement ? ['ready', 'no-statement', 'off'] : ['tracking', 'not-set-up'];
  if (!states.includes(view.state)) throw new Error(`${url} sent something unexpected`);
  // Her setup (HB6): each card as its bank names it, sent with the screens that name cards.
  if ('cardNames' in view) rememberCardNames((view as { readonly cardNames?: CardNames }).cardNames);
  return view;
}

// 10.6: tells the server he has seen a take-back, so Home stops showing it
// (QUESTIONS.md B84). Changes no money.
export async function markTakeBackSeen(id: string): Promise<void> {
  const response = await fetch('/api/seen', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'bank-took-back', id }),
  });
  if (!response.ok) throw new Error(`marking it seen answered ${response.status}`);
}

// His choice for an item (waiting in review, or sorted already), a move of
// money between buckets by hand, or a change to the settings or a sorting
// rule. All go to the same address. The money math on the server decides; a
// refusal comes back as an answer with the reason (nothing was changed).
// Anything else, such as no signal, throws: the same request, with the same
// decision number, can be sent again and changes nothing twice. It changes
// the app's books, never the bank (0.4).
export async function sendChoice(request: ChoiceRequest): Promise<ChoiceResponse>;
export async function sendChoice(request: MoveRequest): Promise<MoveResponse>;
export async function sendChoice(request: SettingsRequest): Promise<SettingsResponse>;
export async function sendChoice(request: RuleRequest): Promise<RuleResponse>;
export async function sendChoice(request: SetupRequest): Promise<SetupResponse>;
export async function sendChoice(request: BankRuleRequest): Promise<BankRuleResponse>;
export async function sendChoice(
  request: ChoiceRequest | MoveRequest | SettingsRequest | RuleRequest | SetupRequest | BankRuleRequest,
): Promise<ChoiceResponse | MoveResponse | SettingsResponse | RuleResponse | SetupResponse | BankRuleResponse> {
  const response = await fetch('/api/choice', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  toLogin(response);
  if (response.status !== 200 && response.status !== 422) throw new Error(`sending the choice answered ${response.status}`);
  const answer = (await response.json()) as ChoiceResponse | MoveResponse | SettingsResponse | RuleResponse | SetupResponse | BankRuleResponse;
  if (typeof answer !== 'object' || answer === null || typeof answer.ok !== 'boolean') throw new Error('the choice was answered with something unexpected');
  return answer;
}

// ----- Logging in (Step 2, the real server only) -----

// Whether this device is logged in, and whether any passkey exists yet.
export async function authState(): Promise<AuthState> {
  const response = await fetch('/api/auth', READ);
  if (!response.ok) throw new Error(`the login page's state answered ${response.status}`);
  return (await response.json()) as AuthState;
}

// The login's own addresses. They change who is logged in, and which
// passkeys can log in; never money (0.4).
type AuthPath = '/api/auth/login/options' | '/api/auth/login' | '/api/auth/code/options' | '/api/auth/code' | '/api/auth/passkey/options' | '/api/auth/passkey' | '/api/auth/logout' | '/api/auth/stay';

// What the server answers: done (with the passkey question, when one was
// asked for), or refused with why. No signal throws.
export type AuthReply = { readonly ok: true; readonly options?: unknown } | { readonly ok: false; readonly why: string; readonly code?: string };

export async function authSend(path: AuthPath, body: object): Promise<AuthReply> {
  const response = await fetch(path, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (response.status === 401) return { ok: false, why: 'You are not logged in any more. Log in again.' };
  if (response.status !== 200 && response.status !== 422) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as AuthReply;
}

// Step 3: how often the real server syncs with the bank (section 2), in
// minutes. A setting of the server's, never money (0.4); the server checks it.
export async function sendSyncEvery(minutes: number): Promise<AuthReply> {
  const response = await fetch('/api/sync/every', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes }) });
  if (response.status === 401) return { ok: false, why: 'You are not logged in any more. Log in again.' };
  if (response.status !== 200 && response.status !== 422) throw new Error(`/api/sync/every answered ${response.status}`);
  return (await response.json()) as AuthReply;
}

// Phase 5: the Notifications card's addresses (app/push.ts). They change which
// devices get the alerts, never money (0.4).
export type PushPath = '/api/push/on' | '/api/push/off' | '/api/push/test';

export async function pushSend(pushPath: PushPath, body: object): Promise<PushAnswer> {
  const response = await fetch(pushPath, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (response.status === 401) return { ok: false, why: 'You are not logged in any more. Log in again.' };
  if (response.status !== 200 && response.status !== 422) throw new Error(`${pushPath} answered ${response.status}`);
  return (await response.json()) as PushAnswer;
}

// 1.1 to 1.3: the Bank connection screen's addresses. They change which bank
// the app reads, never money (0.4): a link key for the bank's own login
// (Plaid Link), Link's answer once he logged in, his four accounts, and
// reading the bank again. The bank key never comes to the phone.
export type BankPath = '/api/bank/link' | '/api/bank/connected' | '/api/bank/roles' | '/api/bank/read';

export async function bankSend(bankPath: '/api/bank/link', body: object): Promise<BankLinkAnswer>;
export async function bankSend(bankPath: Exclude<BankPath, '/api/bank/link'>, body: object): Promise<BankAnswer>;
export async function bankSend(bankPath: BankPath, body: object): Promise<BankLinkAnswer | BankAnswer> {
  const response = await fetch(bankPath, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  toLogin(response);
  if (response.status !== 200 && response.status !== 422) throw new Error(`${bankPath} answered ${response.status}`);
  return (await response.json()) as BankLinkAnswer | BankAnswer;
}

// A new number for a decision, made once when it is made and kept for every
// retry of it. Random, but needs no secure connection (the demo runs over
// plain http on the home wifi).
export function newDecisionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// How long to wait for a screen's numbers before showing the error and Try
// again. Loading always ends: in the numbers or in the error.
export const TIME_LIMIT_MS = 15_000;

// Loads a screen's numbers, again when asked (Try again), and again when the
// app comes back after being in the background. One request at a time, and a
// request is never cancelled: WebKit on Linux was found (CI, Oct 7) to lose
// the answer to the request sent right after one it cancelled, which left
// Home loading for good. reload('after') is for after a choice: if a load is
// already on its way it may have been asked before the choice, so one more
// follows it. Nothing else is queued.
export type Reload = (when?: 'after') => void;

function useView<T extends { readonly state: string }>(url: ViewUrl): [Load<T>, Reload] {
  const [load, setLoad] = useState<Load<T>>({ status: 'loading' });
  const inFlight = useRef(false);
  const again = useRef(false);

  const start = useCallback<Reload>(
    (when) => {
      if (inFlight.current) {
        if (when === 'after') again.current = true;
        return;
      }
      inFlight.current = true;
      // Numbers already shown stay while they are fetched again.
      setLoad((current) => (current.status === 'ready' ? current : { status: 'loading' }));
      let settled = false;
      const settle = (next: Load<T>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        inFlight.current = false;
        // What came back may have been asked before the choice went through,
        // so it is not shown: the answer to one more request is.
        if (again.current) {
          again.current = false;
          start();
          return;
        }
        setLoad(next);
      };
      // An answer that comes after the time limit is not shown; Try again asks again.
      const timer = setTimeout(() => settle({ status: 'error' }), TIME_LIMIT_MS);
      fetchView<T>(url).then(
        (value) => settle({ status: 'ready', value }),
        (error: unknown) => {
          console.error(error);
          settle({ status: 'error' });
        },
      );
    },
    [url],
  );

  useEffect(() => start(), [start]);

  useEffect(() => {
    // Only a real return from the background counts; a page that says it is
    // visible as it opens has not been away.
    let wasHidden = document.visibilityState === 'hidden';
    const onChange = (): void => {
      if (document.visibilityState === 'hidden') wasHidden = true;
      else if (wasHidden) {
        wasHidden = false;
        start();
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [start]);

  return [load, start];
}

export const useHome = (): [Load<HomeView>, Reload] => useView<HomeView>('/api/home');
export const useBuckets = (): [Load<BucketsView>, Reload] => useView<BucketsView>('/api/buckets');
export const useTrends = (): [Load<TrendsView>, Reload] => useView<TrendsView>('/api/trends');
export const useReview = (): [Load<ReviewView>, Reload] => useView<ReviewView>('/api/review');
export const usePayday = (): [Load<PaydayView>, Reload] => useView<PaydayView>('/api/payday');
export const useSettings = (): [Load<SettingsView>, Reload] => useView<SettingsView>('/api/settings');
export const useSetup = (): [Load<SetupView>, Reload] => useView<SetupView>('/api/setup');
export const useAlerts = (): [Load<AlertsView>, Reload] => useView<AlertsView>('/api/alerts');
export const useStatus = (): [Load<StatusView>, Reload] => useView<StatusView>('/api/status');
export const useBank = (): [Load<BankConnectionView>, Reload] => useView<BankConnectionView>('/api/bank');
export const useActivity = (pot: Pot): [Load<ActivityView>, Reload] => useView<ActivityView>(ACTIVITY_URL[pot]);
export const useStatement = (card: StatementCard): [Load<StatementScreenView>, Reload] => useView<StatementScreenView>(STATEMENT_URL[card]);

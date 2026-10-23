import type { IncomingMessage } from 'node:http';
import type { Pot, Switches } from '@budget-app/money';
import type { ActivityView } from '../views/activity.js';
import type { BucketsView } from '../views/buckets.js';
import { shownActivity, shownBuckets, shownPayday, shownReview, shownSettings, shownSetup, shownTrends } from '../views/off.js';
import type { PaydayView } from '../views/payday.js';
import type { ReviewView } from '../views/review.js';
import type { SettingsView } from '../views/settings.js';
import type { SetupView } from '../views/setup.js';
import type { TrendsView } from '../views/trends.js';
import type { AppServerOptions } from './server.js';

// Her rulebook, "Off in this setup": every screen's numbers, worked out as
// upstream's, with what is off taken out before they are sent to the phone
// (views/off.ts). The server and its options stay exactly upstream's; this
// wraps the options, so with upstream's switches every screen is sent as it
// always was.
//
// The web server only turns each view into JSON, so here, at that one edge,
// a shown view is handed on under the upstream view's type. The phone reads
// it as what it is: packages/web reads the ...Shown types (app/api.ts).

export function offTakenOut(switches: () => Switches, options: AppServerOptions): AppServerOptions {
  const { buckets, trends, review, activity, payday, settings, setupView } = options;
  return {
    ...options,
    ...(buckets === undefined ? {} : { buckets: async (request: IncomingMessage) => shownBuckets(await buckets(request), switches()) as BucketsView }),
    ...(trends === undefined ? {} : { trends: async (request: IncomingMessage) => shownTrends(await trends(request), switches()) as TrendsView }),
    ...(review === undefined ? {} : { review: async (request: IncomingMessage) => shownReview(await review(request), switches()) as ReviewView }),
    ...(activity === undefined ? {} : { activity: async (request: IncomingMessage, pot: Pot) => shownActivity(await activity(request, pot), pot, switches()) as ActivityView }),
    ...(payday === undefined ? {} : { payday: async (request: IncomingMessage) => shownPayday(await payday(request), switches()) as PaydayView }),
    ...(settings === undefined ? {} : { settings: async (request: IncomingMessage) => shownSettings(await settings(request), switches()) as SettingsView }),
    ...(setupView === undefined ? {} : { setupView: async (request: IncomingMessage) => shownSetup(await setupView(request), switches()) as SetupView }),
  };
}

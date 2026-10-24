import type { IncomingMessage } from 'node:http';
import type { CardNames } from '../bank/card-names.js';
import type { AppServerOptions } from './server.js';

// Her rulebook, section 1, and HB6: the screens that name a card (Home,
// Buckets, Review, a bucket's list, Settings, Setup day) get each card's name as its bank
// gives it, beside their numbers, just before they are sent (views/cards.ts).
// Like offTakenOut, this only wraps the options: with no second card there
// are no names, and every screen is sent exactly as upstream's.

type View = (request: IncomingMessage, ...rest: never[]) => unknown;

export function cardsNamed(names: () => CardNames | null, options: AppServerOptions): AppServerOptions {
  const named = <F extends View>(view: F): F => {
    return (async (request: IncomingMessage, ...rest: never[]) => {
      const shown = await view(request, ...rest);
      const cardNames = names();
      // An answer that something is off in this setup names nothing.
      const off = typeof shown === 'object' && shown !== null && (shown as { state?: unknown }).state === 'off';
      return cardNames === null || typeof shown !== 'object' || shown === null || off ? shown : { ...shown, cardNames };
    }) as unknown as F;
  };
  const { home, buckets, review, activity, settings, setupView } = options;
  return {
    ...options,
    home: named(home),
    ...(buckets === undefined ? {} : { buckets: named(buckets) }),
    ...(review === undefined ? {} : { review: named(review) }),
    ...(activity === undefined ? {} : { activity: named(activity) }),
    ...(settings === undefined ? {} : { settings: named(settings) }),
    ...(setupView === undefined ? {} : { setupView: named(setupView) }),
  };
}

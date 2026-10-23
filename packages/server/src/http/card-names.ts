import type { IncomingMessage } from 'node:http';
import type { CardNames } from '../bank/card-names.js';
import type { AppServerOptions } from './server.js';

// Her rulebook, section 1, and HB6: the screens that name a card (Home,
// Buckets, Review, Settings, Setup day) get each card's name as its bank
// gives it, beside their numbers, just before they are sent (views/cards.ts).
// Like offTakenOut, this only wraps the options: with no second card there
// are no names, and every screen is sent exactly as upstream's.

type View = (request: IncomingMessage) => unknown;

export function cardsNamed(names: () => CardNames | null, options: AppServerOptions): AppServerOptions {
  const named = <F extends View>(view: F): F => {
    return (async (request: IncomingMessage) => {
      const shown = await view(request);
      const cardNames = names();
      return cardNames === null || typeof shown !== 'object' || shown === null ? shown : { ...shown, cardNames };
    }) as unknown as F;
  };
  const { home, buckets, review, settings, setupView } = options;
  return {
    ...options,
    home: named(home),
    ...(buckets === undefined ? {} : { buckets: named(buckets) }),
    ...(review === undefined ? {} : { review: named(review) }),
    ...(settings === undefined ? {} : { settings: named(settings) }),
    ...(setupView === undefined ? {} : { setupView: named(setupView) }),
  };
}

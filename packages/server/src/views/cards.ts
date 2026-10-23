import type { CardNames } from '../bank/card-names.js';

export type { CardNames, NamedCard } from '../bank/card-names.js';

// Her rulebook, section 1, and HB6: in her setup a screen that names a card
// gets the names its bank gives each one, with its numbers
// (http/card-names.ts). Upstream's screens get none and keep their own words.
export type Named<T> = T & { readonly cardNames?: CardNames };

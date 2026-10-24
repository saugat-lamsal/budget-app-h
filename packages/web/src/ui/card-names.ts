import type { CardNames, NamedCard } from '@budget-app/server/views';

// Her rulebook, section 1, and HB6: in her setup the server sends, with each
// screen's numbers, the name each card's bank gives it (views/cards.ts). The
// screens name a card that way once they have it; until then, and always in
// upstream's setup, which sends none, they keep their own words.

let known: CardNames | null = null;

// What a screen's numbers said about the names (app/api.ts).
export function rememberCardNames(names: CardNames | null | undefined): void {
  if (names !== undefined) known = names;
}

export function cardNames(): CardNames | null {
  return known;
}

const NAMED: readonly NamedCard[] = ['everyday-card', 'second-card'];

// The bank's name for a card, or null when there is none to use.
export function nameOf(account: string): string | null {
  return known !== null && (NAMED as readonly string[]).includes(account) ? known[account as NamedCard] : null;
}

// A map of words by account, whose cards read as their banks name them once
// the names are known: the same words otherwise.
export function withCardNames<T extends Readonly<Record<string, string>>>(words: T): T {
  const shown: Record<string, string> = { ...words };
  for (const card of NAMED) {
    if (!(card in words)) continue;
    Object.defineProperty(shown, card, { enumerable: true, get: () => nameOf(card) ?? words[card] });
  }
  return Object.freeze(shown) as T;
}

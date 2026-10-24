import type { StoredAccount } from './stored-account.js';

// Her rulebook, section 1, and HB6 (docs/her-questions.txt): in her setup the
// screens and the alerts name each card by the name its bank gives the
// account, so no card's name is written in the code (docs/her-plan.txt,
// Piece C). Upstream's setup keeps its own words ("Everyday card", "Old
// card"): there are no names without a second card.
export type NamedCard = 'everyday-card' | 'second-card';
export type CardNames = Readonly<Record<NamedCard, string>>;

// What a card is called when its bank gives it no name.
const FALLBACK: CardNames = Object.freeze({ 'everyday-card': 'Everyday card', 'second-card': 'Second card' });

// Null unless a second card is picked (1.2).
export function cardNamesOf(accounts: readonly StoredAccount[]): CardNames | null {
  const account = (card: NamedCard): StoredAccount | undefined => accounts.find((a) => a.role === card);
  const second = account('second-card');
  if (second === undefined) return null;
  const everyday = account('everyday-card');
  const named = (a: StoredAccount | undefined): string | null => {
    const name = (a?.raw.name ?? '').trim() || (a?.raw.official_name ?? '').trim();
    return name === '' ? null : name;
  };
  const names: Record<NamedCard, string | null> = { 'everyday-card': named(everyday), 'second-card': named(second) };
  // Two cards with the same name: told apart by the last digits their banks show.
  if (names['everyday-card'] !== null && names['everyday-card'] === names['second-card']) {
    const masks = [everyday?.raw.mask ?? null, second.raw.mask ?? null];
    if (masks[0] !== null && masks[1] !== null && masks[0] !== masks[1]) {
      names['everyday-card'] = `${names['everyday-card']} ••${masks[0]}`;
      names['second-card'] = `${names['second-card']} ••${masks[1]}`;
    } else {
      names['everyday-card'] = null;
      names['second-card'] = null;
    }
  }
  return Object.freeze({ 'everyday-card': names['everyday-card'] ?? FALLBACK['everyday-card'], 'second-card': names['second-card'] ?? FALLBACK['second-card'] });
}

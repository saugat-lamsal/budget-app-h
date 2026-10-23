// Her rulebook, PR 5 (docs/her-plan.txt, Piece C): every everyday-card test
// has a second-card twin, made by this one helper, with no test copied.
//
// mirrorMoney takes the money package and gives it back as a test sees it,
// with the second card in the everyday card's place: the second card is
// switched on in every book, and everything a test hands in that names the
// everyday card names the second card instead (its account, its balance, its
// closing day). Everything handed back that names the second card names the
// everyday card again, and the everyday card itself, which the test never
// touches, is left out (it holds nothing). So a test written for the everyday
// card, run unchanged through the mirror, says the same about the second
// card: that it is read, counted, checked and reminded about exactly like the
// everyday card (her rulebook, section 1: "Both cards are used day to day and
// work the same way").
//
// Only the names move: amounts, dates and descriptions pass through as they are.

type Money = Record<string, unknown>;

const EVERYDAY = 'everyday-card';
const SECOND = 'second-card';
// Keys that name the everyday card, with the second card's key and what the
// everyday card holds while the test is not using it.
const KEYS: readonly (readonly [string, string, unknown])[] = [
  [EVERYDAY, SECOND, undefined],
  ['everydayCard', 'secondCard', 0],
  ['everydayCardClosingDay', 'secondCardClosingDay', null],
];

export function mirrorMoney(real: Money): Money {
  const RealBook = real['Book'] as abstract new (...args: never[]) => object;
  const wrapped = new WeakMap<object, unknown>();

  const isPlain = (value: object): boolean => {
    const proto = Object.getPrototypeOf(value) as unknown;
    return proto === Object.prototype || proto === null;
  };

  // What the test hands in, as the second card.
  const toSecond = (value: unknown): unknown => {
    if (value === EVERYDAY) return SECOND;
    if (Array.isArray(value)) return value.map(toSecond);
    if (typeof value !== 'object' || value === null || !isPlain(value)) return value;
    const copy: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) copy[key] = toSecond(inner);
    for (const [everyday, second, idle] of KEYS) {
      if (!(everyday in copy)) continue;
      copy[second] = copy[everyday];
      if (idle === undefined) delete copy[everyday];
      else copy[everyday] = idle;
    }
    return Object.isFrozen(value) ? Object.freeze(copy) : copy;
  };

  // What comes back, as the everyday card.
  const toEveryday = (value: unknown): unknown => {
    if (value === SECOND) return EVERYDAY;
    if (typeof value === 'function') return value;
    if (typeof value !== 'object' || value === null) return value;
    if (value instanceof RealBook) return bookMirror(value);
    if (Array.isArray(value)) {
      const kept = value.filter((inner) => inner !== EVERYDAY).map(toEveryday);
      return Object.isFrozen(value) ? Object.freeze(kept) : kept;
    }
    if (!isPlain(value)) return value;
    const copy: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) copy[key] = toEveryday(inner);
    for (const [everyday, second] of KEYS) {
      if (!(second in copy)) continue;
      copy[everyday] = copy[second];
      delete copy[second];
    }
    // The second card's switch is the mirror's, not the test's.
    if ('oldCard' in copy && copy['secondCard'] === 'on') delete copy['secondCard'];
    return Object.isFrozen(value) ? Object.freeze(copy) : copy;
  };

  const call = (fn: (...args: unknown[]) => unknown, self: unknown, args: unknown[]): unknown => toEveryday(fn.apply(self, args.map(toSecond)));

  function bookMirror(book: object): unknown {
    const known = wrapped.get(book);
    if (known !== undefined) return known;
    const proxy = new Proxy(book, {
      get(target, key) {
        const value = Reflect.get(target, key, target) as unknown;
        return typeof value === 'function' ? (...args: unknown[]) => call(value as (...a: unknown[]) => unknown, target, args) : toEveryday(value);
      },
    });
    wrapped.set(book, proxy);
    return proxy;
  }

  // Every book has the second card switched on (the mom reserve and the old
  // card stay as the test has them).
  const withSecondCard = (input: unknown): unknown => {
    const copy = toSecond(input) as Record<string, unknown>;
    const switches = (copy['switches'] ?? real['UPSTREAM_SWITCHES']) as Record<string, unknown>;
    return { ...copy, switches: { ...switches, secondCard: 'on' } };
  };

  const mirror: Money = {};
  for (const [name, value] of Object.entries(real)) {
    if (name === 'Book' || name === 'MoneyError') mirror[name] = value;
    else if (name === 'openBook' || name === 'startTracking') mirror[name] = (input: unknown) => toEveryday((value as (i: unknown) => unknown)(withSecondCard(input)));
    else if (typeof value === 'function') mirror[name] = (...args: unknown[]) => call(value as (...a: unknown[]) => unknown, undefined, args);
    // Constants (ACCOUNTS, DEFAULT_SETTINGS, ...) as they are: what a test
    // takes from them goes in through the mirror like anything else.
    else mirror[name] = value;
  }
  return mirror;
}

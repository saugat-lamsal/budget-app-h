import { describe, expect, it } from 'vitest';
import { appOf } from '../scripts/deploy-check-lib.mjs';

// Her plan, PR 2: the deploy check reads the app from fly.toml, so this copy
// of the project checks its own app and never upstream's.

describe('her plan PR 2 the deploy check takes its app from fly.toml', () => {
  it('her plan PR 2 the app line, with or without spaces around =', () => {
    expect(appOf('# a comment\napp = "made-up-app-1"\nprimary_region = "ewr"\n')).toBe('made-up-app-1');
    expect(appOf('app="made-up-app-2"\n')).toBe('made-up-app-2');
  });

  it('her plan PR 2 not an app named only in a comment, or in another key', () => {
    expect(() => appOf('# app = "in-a-comment"\n')).toThrow('fly.toml names no app');
    expect(() => appOf('[env]\n  APP_ORIGIN = "https://made-up.fly.dev"\n')).toThrow('fly.toml names no app');
  });

  it('her plan PR 2 no app at all is refused, never a name made up', () => {
    expect(() => appOf('')).toThrow('fly.toml names no app');
    expect(() => appOf('app = ""\n')).toThrow('fly.toml names no app');
    expect(() => appOf('app = "Not A Fly Name"\n')).toThrow('fly.toml names no app');
  });
});

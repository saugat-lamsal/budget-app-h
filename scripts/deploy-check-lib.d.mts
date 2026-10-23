// Types for scripts/deploy-check-lib.mjs, so its tests are type-checked.
// The app named in fly.toml (her plan, PR 2).
export function appOf(flyToml: string): string;
export const APP: string;
export const CHECK_COMMAND: string;
export const WORKS: string;
export const CHECK_TRIES: number;
export const RETRY_WAIT_MS: number;

export interface FlyAnswer {
  readonly code: number;
  readonly out: string;
  readonly stdout?: string;
}

export function labelFor(now: Date): string;

export function deployCheck(input: {
  readonly run: (args: readonly string[]) => Promise<FlyAnswer>;
  readonly say: (line: string) => void;
  readonly app?: string;
  readonly label: string;
  readonly wait?: (ms: number) => Promise<void>;
}): Promise<{ readonly ok: boolean; readonly lastLine: string; readonly image: string }>;

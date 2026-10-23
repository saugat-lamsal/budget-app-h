// Rulebook section 1: four Bank of America accounts on one connection.
// Her rulebook, section 1: her second card ('second-card'), used day to day
// and working exactly like the everyday card. It is there only with its
// switch on (switches.ts, her setup).
export type AccountId = 'checking' | 'savings' | 'everyday-card' | 'old-card' | 'second-card';

export const ACCOUNTS: readonly AccountId[] = Object.freeze(['checking', 'savings', 'everyday-card', 'old-card']);

// Every account the money math knows, the second card just after the
// everyday card, as the screens list them.
export const ALL_ACCOUNTS: readonly AccountId[] = Object.freeze(['checking', 'savings', 'everyday-card', 'second-card', 'old-card']);

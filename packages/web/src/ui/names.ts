import type { AnyPot } from '@budget-app/money';

// What each bucket is called, everywhere.
export const POT_NAMES: Readonly<Record<AnyPot, string>> = {
  savings: 'Savings',
  needs: 'Needs',
  wants: 'Wants',
  momReserve: 'Mom reserve',
  heldForOthers: 'Held for others',
  // Her rulebook, section 2: only in a setup that has it.
  wishlist: 'Wishlist',
};

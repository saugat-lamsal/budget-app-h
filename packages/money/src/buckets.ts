// The buckets a paycheck is split into, plus the mom reserve.
export type Bucket = 'savings' | 'needs' | 'wants' | 'momReserve';

// The buckets spending can be sorted to (QUESTIONS.md asks whether savings
// and the mom reserve should be allowed too).
export type SplitBucket = 'needs' | 'wants';

// Her rulebook, 4.2 and 4.4: with Wishlist on, spending can also go to
// Wishlist, or be split across needs, wants and Wishlist. A sorting rule still
// picks needs or wants only (4.2, 6.2), and the leftover question and the low
// and empty alerts are still about needs and wants (3.4, 10.1, 10.2).
export type SortBucket = SplitBucket | 'wishlist';

export const BUCKETS: readonly Bucket[] = Object.freeze(['savings', 'needs', 'wants', 'momReserve']);
export const SPENDING_BUCKETS: readonly SplitBucket[] = Object.freeze(['needs', 'wants']);

export function isBucket(value: unknown): value is Bucket {
  return (BUCKETS as readonly unknown[]).includes(value);
}

export function isSpendingBucket(value: unknown): value is SplitBucket {
  return (SPENDING_BUCKETS as readonly unknown[]).includes(value);
}

export function isSortBucket(value: unknown): value is SortBucket {
  return value === 'wishlist' || isSpendingBucket(value);
}

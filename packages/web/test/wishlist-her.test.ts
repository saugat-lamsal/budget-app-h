import { describe, expect, it } from 'vitest';
import { HER_BUCKET_PATHS, SCREEN_PATHS } from '../../server/src/http/server.js';
import { HER_POT_SLUGS as SERVER_HER_SLUGS } from '../../server/src/views/activity.js';
import { HER_BUCKET_ROUTES, HER_POT_SLUGS, POT_SLUGS, SCREEN_ROUTES, activityPath, pathOfRoute, routeOf } from '../src/app/routes.js';
import { bucketTitle, wishlistMoveText } from '../src/screens/cards-text.js';
import { splitText } from '../src/screens/settings-text.js';
import { POT_NAMES } from '../src/ui/names.js';

// Her rulebook, PR 9: the Wishlist bucket on the phone: its name, its list's
// address (kept apart from upstream's buckets), its group on a card's
// statement (52.4), and Home's words for 50.4. Every number is made up.

describe('Section 2 the Wishlist bucket on the phone', () => {
  it("Section 2: Wishlist has its name and its own list at /buckets/wishlist, kept apart from upstream's buckets, as the server serves it", () => {
    expect(POT_NAMES.wishlist).toBe('Wishlist');
    expect(HER_POT_SLUGS).toEqual(SERVER_HER_SLUGS);
    expect(Object.hasOwn(POT_SLUGS, 'wishlist')).toBe(false);
    expect(activityPath('wishlist')).toBe('/buckets/wishlist');
    expect(routeOf('/buckets/wishlist')).toEqual({ screen: 'activity', pot: 'wishlist' });
    expect(HER_BUCKET_ROUTES.map(pathOfRoute)).toEqual([...HER_BUCKET_PATHS]);
    expect(SCREEN_ROUTES.map(pathOfRoute)).not.toContain('/buckets/wishlist');
    expect(SCREEN_PATHS).not.toContain('/buckets/wishlist');
  });

  // PR 12, found by the agent on her screens: the change log said "50 / 30 /
  // 20 -> 40 / 30 / 20" for a change that also gave Wishlist 10%.
  it("13.5 the change log says the split with Wishlist's share where the split names it; upstream's split as it was", () => {
    expect(splitText({ savings: 40, needs: 30, wants: 20, wishlist: 10 })).toBe('40 / 30 / 20, Wishlist 10');
    expect(splitText({ savings: 50, needs: 30, wants: 20, wishlist: 0 })).toBe('50 / 30 / 20, Wishlist 0');
    expect(splitText({ savings: 50, needs: 30, wants: 20 })).toBe('50 / 30 / 20');
  });

  it('52.4 a card statement lists Wishlist purchases under Wishlist', () => {
    expect(bucketTitle('wishlist')).toBe('Wishlist');
  });
});

describe('50.4 Home says to move Wishlist money from savings to checking', () => {
  const base = { amount: 4_250, extra: 10_000, notMoved: 4_250, cards: [] } as const;

  it('50.4 for a debit card purchase: now, since it already left checking', () => {
    expect(wishlistMoveText({ ...base, when: { kind: 'now' } })).toEqual({
      title: 'Move $42.50 from savings to checking',
      detail: 'For what you bought from Wishlist, whose money is kept in savings. Now: it has already left checking.',
    });
  });

  it("50.4 before the card is due, with its due date; while its statement has not closed, before the card's next due date", () => {
    expect(wishlistMoveText({ ...base, when: { kind: 'before-due', card: 'second-card', dueDate: '2026-11-03', day: 'before' } }).detail).toBe('For what you bought from Wishlist, whose money is kept in savings. Before the Second card is due, Tue, Nov 3.');
    expect(wishlistMoveText({ ...base, when: { kind: 'before-next-due', card: 'everyday-card' } }).detail).toBe("For what you bought from Wishlist, whose money is kept in savings. Before the Everyday card's next due date.");
  });

  it('50.4 exactly on the due date, and the day after, the words change as 9.6 does', () => {
    expect(wishlistMoveText({ ...base, when: { kind: 'before-due', card: 'second-card', dueDate: '2026-11-03', day: 'on' } }).detail).toBe('For what you bought from Wishlist, whose money is kept in savings. Today: the Second card is due today, Tue, Nov 3.');
    expect(wishlistMoveText({ ...base, when: { kind: 'before-due', card: 'second-card', dueDate: '2026-11-03', day: 'after' } }).detail).toBe('For what you bought from Wishlist, whose money is kept in savings. Now: the Second card was due Tue, Nov 3.');
  });
});

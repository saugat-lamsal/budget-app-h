import { MOVABLE_POTS } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { APP_PATHS, SCREEN_PATHS } from '../../server/src/http/server.js';
import { POT_SLUGS as SERVER_SLUGS } from '../../server/src/views/activity.js';
import { POT_SLUGS, SCREEN_ROUTES, TABS, activityPath, backTarget, pathOf, pathOfRoute, routeOf, routeTitle, tabOf, tabOfRoute } from '../src/app/routes.js';

// The screens that are not tabs (QUESTIONS.md B97, B104): the activity of
// each bucket, and Payday. Each has its own address, so a refresh or a link
// opens the right screen, and the tab bar still says where you are.

describe('B97 each bucket has its own address', () => {
  it('B97 the addresses are /buckets/ and the bucket\'s name', () => {
    expect(MOVABLE_POTS.map(activityPath)).toEqual(['/buckets/savings', '/buckets/needs', '/buckets/wants', '/buckets/mom-reserve', '/buckets/held-for-others']);
  });

  it('B97 an address leads back to its bucket, and a trailing slash does not matter', () => {
    for (const pot of MOVABLE_POTS) {
      expect(routeOf(activityPath(pot))).toEqual({ screen: 'activity', pot });
      expect(routeOf(`${activityPath(pot)}/`)).toEqual({ screen: 'activity', pot });
    }
  });

  it('B97 the names are the server\'s names', () => {
    expect(POT_SLUGS).toEqual(SERVER_SLUGS);
  });

  it('B104 Payday has its own address', () => {
    expect(pathOfRoute({ screen: 'payday' })).toBe('/payday');
    expect(routeOf('/payday')).toEqual({ screen: 'payday' });
    expect(routeOf('/payday/')).toEqual({ screen: 'payday' });
  });
});

describe('the tabs are as they were', () => {
  it('each tab is still a route, with its own address', () => {
    expect(TABS.map(pathOf)).toEqual(['/home', '/buckets', '/review', '/trends', '/settings']);
    for (const tab of TABS) expect(routeOf(pathOf(tab))).toEqual({ screen: 'tab', tab });
    expect(tabOf('/buckets/needs')).toBeNull();
    expect(tabOf('/payday')).toBeNull();
  });
});

describe('anything else is not a screen', () => {
  it('addresses near the real ones lead nowhere', () => {
    for (const path of ['/', '', '/buckets/other', '/buckets/needs/extra', '/buckets/Needs', '/buckets/momReserve', '/buckets/constructor', '/buckets/__proto__', '/paydays', '/payday/extra', '/home/extra', '/review/x', '//buckets/needs']) {
      expect(routeOf(path), path).toBeNull();
    }
  });
});

describe('the tab bar says where you are', () => {
  it('a bucket\'s screen and Payday belong to Buckets', () => {
    for (const pot of MOVABLE_POTS) expect(tabOfRoute({ screen: 'activity', pot })).toBe('buckets');
    expect(tabOfRoute({ screen: 'payday' })).toBe('buckets');
    for (const tab of TABS) expect(tabOfRoute({ screen: 'tab', tab })).toBe(tab);
  });

  it('each screen has a title for the tab of the browser', () => {
    expect(routeTitle({ screen: 'activity', pot: 'needs' })).toBe('Needs · Budget');
    expect(routeTitle({ screen: 'activity', pot: 'momReserve' })).toBe('Mom reserve · Budget');
    expect(routeTitle({ screen: 'activity', pot: 'heldForOthers' })).toBe('Other · Budget');
    expect(routeTitle({ screen: 'payday' })).toBe('Payday · Budget');
    expect(routeTitle({ screen: 'tab', tab: 'home' })).toBe('Home · Budget');
  });

  it('going back from a bucket or Payday leads to Buckets unless you came from somewhere else', () => {
    expect(backTarget({ screen: 'activity', pot: 'needs' }, undefined)).toEqual({ screen: 'tab', tab: 'buckets' });
    expect(backTarget({ screen: 'payday' }, undefined)).toEqual({ screen: 'tab', tab: 'buckets' });
    // Came from Home: back goes there.
    expect(backTarget({ screen: 'payday' }, '/home')).toEqual({ screen: 'tab', tab: 'home' });
    expect(backTarget({ screen: 'payday' }, '/buckets')).toEqual({ screen: 'tab', tab: 'buckets' });
    // From a place that is not a screen of the app, or from itself, it does not go there.
    expect(backTarget({ screen: 'payday' }, '/somewhere-else')).toEqual({ screen: 'tab', tab: 'buckets' });
    expect(backTarget({ screen: 'payday' }, '/payday')).toEqual({ screen: 'tab', tab: 'buckets' });
    expect(backTarget({ screen: 'payday' }, 42)).toEqual({ screen: 'tab', tab: 'buckets' });
  });
});

describe('10 the list of alerts sent has its own address', () => {
  it('10.3 the list is at /alerts, on the Settings tab, and goes back to Settings', () => {
    expect(pathOfRoute({ screen: 'alerts' })).toBe('/alerts');
    expect(routeOf('/alerts')).toEqual({ screen: 'alerts' });
    expect(routeOf('/alerts/')).toEqual({ screen: 'alerts' });
    expect(routeOf('/alerts/extra')).toBeNull();
    expect(tabOfRoute({ screen: 'alerts' })).toBe('settings');
    expect(routeTitle({ screen: 'alerts' })).toBe('Alerts · Budget');
    expect(backTarget({ screen: 'alerts' }, undefined)).toEqual({ screen: 'tab', tab: 'settings' });
    expect(backTarget({ screen: 'alerts' }, '/alerts')).toEqual({ screen: 'tab', tab: 'settings' });
    expect(backTarget({ screen: 'alerts' }, '/home')).toEqual({ screen: 'tab', tab: 'home' });
    // Going back from the other screens is as it was.
    expect(backTarget({ screen: 'payday' }, '/alerts')).toEqual({ screen: 'alerts' });
  });

  it('0.7 the status page is at /status, on the Settings tab, and goes back to Settings', () => {
    expect(pathOfRoute({ screen: 'status' })).toBe('/status');
    expect(routeOf('/status')).toEqual({ screen: 'status' });
    expect(routeOf('/status/')).toEqual({ screen: 'status' });
    expect(routeOf('/status/extra')).toBeNull();
    expect(tabOfRoute({ screen: 'status' })).toBe('settings');
    expect(routeTitle({ screen: 'status' })).toBe('Status · Budget');
    expect(backTarget({ screen: 'status' }, undefined)).toEqual({ screen: 'tab', tab: 'settings' });
    expect(backTarget({ screen: 'status' }, '/status')).toEqual({ screen: 'tab', tab: 'settings' });
    expect(backTarget({ screen: 'payday' }, '/status')).toEqual({ screen: 'status' });
  });
});

describe('the server answers every one of them with the app', () => {
  it('the server\'s list of screens is the app\'s list of screens, and none is a tab', () => {
    expect([...SCREEN_PATHS].sort()).toEqual(SCREEN_ROUTES.map(pathOfRoute).sort());
    for (const path of SCREEN_PATHS) expect(APP_PATHS).not.toContain(path);
  });
});

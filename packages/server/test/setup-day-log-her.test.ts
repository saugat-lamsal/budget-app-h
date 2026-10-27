// Her rulebook, 53.1 and 13.5 (HA10, his answer of Oct 27, 2026): in her
// setup, Settings' change log shows setup day's line, naming the rules she
// kept from the rule finder. They were logged with setup day (HB37), but the
// screen never showed that line, so she could not see them there (found in
// her rehearsal). Upstream's change log is unchanged. Every name and number
// is made up.
import { afterEach, describe, expect, it } from 'vitest';
import { saveServerLine } from '../src/server-log.js';
import { HER_START } from '../src/setup-start.js';
import type { FoundLine } from '../src/views/rule-finder.js';
import type { LogRow } from '../src/views/settings.js';
import { finderLife, setUpHer } from './her-harness.js';
import { decision, lifeInAFile, setUpThroughTheDesk, type Life } from './keeper-harness.js';

let lives: Life[] = [];
afterEach(() => {
  for (const life of lives) life.done();
  lives = [];
});

function found(life: Life): readonly FoundLine[] {
  const view = life.keeper.setupView();
  if (view.state !== 'not-set-up' || !view.ready || view.found === undefined) throw new Error('no rule finder');
  return view.found;
}

function keep(life: Life, pick: (l: FoundLine) => boolean, bucket?: 'needs' | 'wants'): void {
  const line = found(life).find(pick);
  if (line === undefined) throw new Error('no such suggestion');
  const answer = life.keeper.setup({ id: decision(), setup: { found: { id: line.id, answer: 'add', ...(bucket === undefined ? {} : { bucket }) } } });
  if (!answer.ok) throw new Error(answer.why);
}

function log(life: Life): readonly LogRow[] {
  const view = life.keeper.settings();
  if (view.state !== 'tracking') throw new Error('not tracking');
  return view.log;
}

describe('13.5 53.1 setup day\'s line in her change log (HA10)', () => {
  it('53.1 13.5 it names the place and the paycheck rule she kept, and sits after the lines before tracking started and before the ones after', async () => {
    const life = await finderLife();
    lives.push(life);
    // A server line before setup day (a passkey made), then a bank rule kept from the finder.
    saveServerLine(life.h.db, { date: '2026-10-01', action: 'passkey-added', device: 'Made-up Phone', afterBookLines: 0 });
    keep(life, (l) => l.group === 'people-fees' && l.rule.kind === 'bank-rule' && l.rule.means === 'payment-to-person');
    keep(life, (l) => l.rule.kind === 'place' && l.rule.contains === 'GREEN LEAF MARKET', 'needs');
    keep(life, (l) => l.rule.kind === 'paycheck');
    setUpHer(life);
    // After it: a login (a server line, still before any line of the book's), then a setting.
    saveServerLine(life.h.db, { date: '2026-10-01', action: 'logged-in', device: 'Made-up Phone', afterBookLines: 0 });
    expect(life.keeper.settingsChange({ id: decision(), settings: { everydayCardClosingDay: 5 } })).toMatchObject({ ok: true });
    const rows = log(life);
    const setupDay = rows.find((r) => r.kind === 'setup-day');
    expect(setupDay).toMatchObject({ kind: 'setup-day', date: '2026-10-01', rules: [{ for: 'purchase', contains: 'GREEN LEAF MARKET', to: 'needs' }], paycheckRule: { contains: 'MADEUP CORP PAYROLL PPD ID 4455' } });
    // Newest first, in the order they happened.
    const at = (kind: LogRow['kind']): number => rows.findIndex((r) => r.kind === kind);
    expect([at('setting'), at('logged-in'), at('setup-day'), at('bank-rule-added'), at('passkey-added')]).toEqual([0, 1, 2, 3, 4]);
  });

  it('13.5 with nothing kept from the finder, the line is still there: tracking started', async () => {
    const life = await finderLife();
    lives.push(life);
    setUpHer(life);
    expect(log(life).filter((r) => r.kind === 'setup-day')).toMatchObject([{ kind: 'setup-day', rules: [], paycheckRule: null }]);
  });

  it('13.5 kept after a restart, in the same place', async () => {
    const life = await finderLife();
    lives.push(life);
    keep(life, (l) => l.rule.kind === 'place' && l.rule.contains === 'GREEN LEAF MARKET', 'wants');
    setUpHer(life);
    const before = log(life);
    life.restart({ start: HER_START });
    expect(log(life)).toEqual(before);
    expect(before.find((r) => r.kind === 'setup-day')).toMatchObject({ rules: [{ contains: 'GREEN LEAF MARKET', to: 'wants' }] });
  });

  it('13.5 upstream\'s change log has no setup day line', async () => {
    const life = await lifeInAFile();
    lives.push(life);
    setUpThroughTheDesk(life);
    expect(log(life).some((r) => r.kind === 'setup-day')).toBe(false);
  });
});

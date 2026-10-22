import { basic, schedule, segment, T0 } from '@/core/testing/schedules';
import { MINUTE, SECOND } from '@/core/time';
import type { ClockAnchor, DeriveOptions } from '@/core/timer/anchor';
import { alertEnabled, alertVolume } from './alerts';
import { dueAlerts, FIRED_RETENTION_MS, planAlerts, recordFired } from './plan';

const auto = { breakEndBehaviour: 'auto' } as const;
const wait = { breakEndBehaviour: 'waitForHost' } as const;

/** Started at T0 on l1 (l1 10m · l2 10m · b1 5m · l3 10m). */
const running = (overrides: Partial<ClockAnchor> = {}): ClockAnchor => ({
  status: 'running',
  segmentIndex: 0,
  deadline: T0 + 10 * MINUTE,
  revision: 1,
  updatedAt: T0,
  ...overrides,
});

const summary = (from: number, to: number, anchor = running(), opts: DeriveOptions = auto) =>
  planAlerts(basic, anchor, from, to, opts).map((a) => `${a.key.split(':').slice(0, 2).join(':')}@${(a.at - T0) / SECOND}`);

describe('planAlerts', () => {
  it('plans level warnings, the countdown and the next level chime', () => {
    expect(summary(T0, T0 + 10 * MINUTE)).toEqual([
      'l1:fiveMinutes@300',
      'l1:oneMinute@540',
      ...Array.from({ length: 10 }, (_, i) => `l1:countdown${10 - i}@${590 + i}`),
      'l2:levelStart@600',
    ]);
  });

  it('only returns alerts inside (from, to]', () => {
    expect(summary(T0 + 540 * SECOND, T0 + 591 * SECOND)).toEqual([
      'l1:countdown10@590',
      'l1:countdown9@591',
    ]);
    expect(planAlerts(basic, running(), T0 + 5, T0 + 5, auto)).toEqual([]);
  });

  it('keys carry the time so the same anchor always gives the same keys', () => {
    const [first] = planAlerts(basic, running(), T0, T0 + 5 * MINUTE, auto);
    expect(first).toEqual({
      key: `l1:fiveMinutes:${T0 + 5 * MINUTE}`,
      type: 'fiveMinutes',
      segmentId: 'l1',
      at: T0 + 5 * MINUTE,
    });
    const later = running({ updatedAt: T0 + 1000 });
    expect(planAlerts(basic, later, T0, T0 + 5 * MINUTE, auto)[0]?.key).toBe(first?.key);
  });

  it('walks across segments: break start, break warnings and break end', () => {
    expect(summary(T0 + 19 * MINUTE + 54_500, T0 + 25 * MINUTE)).toEqual([
      'l2:countdown5@1195',
      'l2:countdown4@1196',
      'l2:countdown3@1197',
      'l2:countdown2@1198',
      'l2:countdown1@1199',
      'b1:breakStart@1200',
      'b1:breakEnding@1440',
      ...Array.from({ length: 10 }, (_, i) => `b1:countdown${10 - i}@${1490 + i}`),
      'b1:breakEnd@1500',
    ]);
  });

  it('stops at the break end when the host must resume', () => {
    const plan = summary(T0 + 24 * MINUTE + 59 * SECOND, T0 + 40 * MINUTE, running(), wait);
    expect(plan.at(-1)).toBe('b1:breakEnd@1500');
    expect(plan.some((p) => p.startsWith('l3'))).toBe(false);
  });

  it('plans nothing at the end of the schedule (overtime)', () => {
    const last = running({ segmentIndex: 3, deadline: T0 + 10 * MINUTE });
    const plan = summary(T0 + 9 * MINUTE, T0 + 20 * MINUTE, last);
    expect(plan.at(-1)).toBe('l3:countdown1@599');
    expect(summary(T0 + 11 * MINUTE, T0 + 20 * MINUTE, last)).toEqual([]);
  });

  it('skips thresholds longer than the segment', () => {
    const short = schedule([segment('a', 'level', 3), segment('b', 'level', 0.1)]);
    const anchor = running({ deadline: T0 + 3 * MINUTE });
    const keys = planAlerts(short, anchor, T0 - 1, T0 + 4 * MINUTE, auto).map((a) => a.key);
    expect(keys.some((k) => k.startsWith('a:fiveMinutes'))).toBe(false);
    // b is 6 s long: only the beats after its start.
    expect(keys.filter((k) => k.startsWith('b:countdown'))).toHaveLength(5);
  });

  it('ignores anything before the last write, e.g. right after a resume', () => {
    // Resumed with 59.5 s left: the one-minute warning is already behind it.
    const resumed = running({ deadline: T0 + 59_500, updatedAt: T0 });
    expect(summary(T0 - 5 * SECOND, T0 + SECOND, resumed)).toEqual([]);
  });

  it('plans an ad-hoc break, then the level that resumes after it', () => {
    const interlude = running({
      deadline: undefined,
      interlude: { deadline: T0 + 2 * MINUTE, resumeLevelRemainingMs: 30 * SECOND },
    });
    const plan = summary(T0, T0 + 3 * MINUTE, interlude);
    expect(plan.slice(0, 2)).toEqual(['l1:breakEnding@60', 'l1:countdown10@110']);
    expect(plan).toContain('l1:breakEnd@120');
    // 30 s of level left: no one-minute warning, but the countdown and the next chime.
    expect(plan).not.toContain('l1:oneMinute@90');
    expect(plan).toContain('l1:countdown10@140');
    expect(plan.at(-1)).toBe('l2:levelStart@150');
    expect(summary(T0, T0 + 3 * MINUTE, interlude, wait).at(-1)).toBe('l1:breakEnd@120');
  });

  it('plans nothing for a paused clock or one held for the host', () => {
    const paused: ClockAnchor = { status: 'paused', segmentIndex: 0, remainingMs: MINUTE, revision: 1, updatedAt: T0 };
    expect(planAlerts(basic, paused, T0, T0 + 10 * MINUTE, auto)).toEqual([]);
    const breakOver = running({ segmentIndex: 2, deadline: T0 });
    expect(planAlerts(basic, breakOver, T0 + SECOND, T0 + 10 * MINUTE, wait)).toEqual([]);
  });
});

describe('dueAlerts', () => {
  const at590 = T0 + 590 * SECOND;

  it('sounds alerts crossed during live ticking', () => {
    const due = dueAlerts(basic, running(), at590 - 250, at590, auto, new Set());
    expect(due.live.map((a) => a.type)).toEqual(['countdown']);
    expect(due.missed).toEqual([]);
  });

  it('marks alerts crossed during a gap as fired without a sound', () => {
    const due = dueAlerts(basic, running(), T0 + 8 * MINUTE, T0 + 13 * MINUTE, auto, new Set());
    expect(due.live).toEqual([]);
    expect(due.missed.map((a) => a.type)).toContain('levelStart');
  });

  it('never repeats a fired key', () => {
    const [beat] = planAlerts(basic, running(), at590 - 1, at590, auto);
    const due = dueAlerts(basic, running(), at590 - 250, at590, auto, new Set([beat?.key ?? '']));
    expect(due.live).toEqual([]);
  });
});

describe('recordFired', () => {
  it('merges keys and drops old ones', () => {
    const old = `l1:oneMinute:${T0}`;
    const recent = `l2:oneMinute:${T0 + FIRED_RETENTION_MS}`;
    expect(recordFired([old], [recent, recent], T0 + FIRED_RETENTION_MS + 1)).toEqual([recent]);
    expect(recordFired(['garbage'], [], T0)).toEqual([]);
  });
});

describe('alert preferences', () => {
  it('defaults: five-minute warning off, everything else on', () => {
    expect(alertEnabled(undefined, 'fiveMinutes')).toBe(false);
    expect(alertEnabled({}, 'oneMinute')).toBe(true);
    expect(alertEnabled({ enabled: { oneMinute: false } }, 'oneMinute')).toBe(false);
    expect(alertVolume(undefined)).toBe(0.8);
    expect(alertVolume({ volume: 0.2 })).toBe(0.2);
  });
});

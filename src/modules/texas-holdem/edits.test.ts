import type { ModuleContext } from '@/core/modules/contract';
import { ScheduleSchema } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import {
  extend,
  HoldemEditError,
  insertBreak,
  regenerateFrom,
  removeBreak,
  setAllLevelDurations,
  setLevel,
} from './edits';
import { buildSchedule, levelData } from './generate';
import { defaultConfig } from './structure';

let n = 0;
const ctx: ModuleContext = { clock: { now: () => 5_000 }, newId: () => `id-${++n}` };
const config = defaultConfig({ players: 6, targetDurationMin: 180 });
// Levels 1–5, break (index 5), levels 6–10, break (index 11), levels 11–15, break (17), 16–20.
const base = buildSchedule(config, ctx);
const snapshot = JSON.stringify(base);
const ids = base.segments.map((s) => s.id);

afterEach(() => {
  expect(JSON.stringify(base)).toBe(snapshot); // edits never mutate their input
});

describe('setLevel', () => {
  it('changes one level and previews the diff', () => {
    const { schedule, report, diff } = setLevel(base, config, ctx, 1, {
      sb: 75,
      bb: 150,
      ante: 0,
      durationMin: 15,
    });
    expect(schedule.id).not.toBe(base.id);
    expect(schedule.createdAt).toBe(5_000);
    expect(schedule.segments.map((s) => s.id)).toEqual(ids);
    expect(schedule.segments[1]?.durationMs).toBe(15 * MINUTE);
    expect(diff).toEqual({
      added: [],
      removed: [],
      changed: [{ before: base.segments[1], after: schedule.segments[1] }],
    });
    expect(report.errors).toEqual([]);
    expect(ScheduleSchema.parse(schedule)).toEqual(schedule);
  });

  it('reports invalid blinds instead of rejecting them', () => {
    const { report } = setLevel(base, config, ctx, 1, {
      sb: 50,
      bb: 100,
      ante: 0,
      durationMin: 12,
    });
    expect(report.errors.map((e) => e.code)).toEqual(['blindsNotIncreasing']);
  });

  it('moves the estimated finish when blinds change', () => {
    const { schedule } = setLevel(base, config, ctx, 13, {
      sb: 1_500,
      bb: 3_000,
      ante: 3_000,
      durationMin: 12,
    });
    expect(schedule.segments.findIndex((s) => s.estimatedFinish === true)).toBe(13);
    expect(schedule.segments[14]?.estimatedFinish).toBe(false);
  });

  it('throws on breaks and non-positive durations', () => {
    const patch = { sb: 50, bb: 100, ante: 0, durationMin: 12 };
    expect(() => setLevel(base, config, ctx, 5, patch)).toThrow(HoldemEditError);
    expect(() => setLevel(base, config, ctx, 99, patch)).toThrow(HoldemEditError);
    expect(() => setLevel(base, config, ctx, 0, { ...patch, durationMin: 0 })).toThrow(
      HoldemEditError,
    );
  });
});

describe('setAllLevelDurations', () => {
  it('changes levels from an index on, leaving breaks alone', () => {
    const { schedule, diff } = setAllLevelDurations(base, config, ctx, 20, 6);
    schedule.segments.forEach((s, i) => {
      const expected = s.kind === 'break' ? 10 : i >= 6 ? 20 : 12;
      expect(s.durationMs).toBe(expected * MINUTE);
    });
    expect(diff.changed).toHaveLength(15);
    expect(() => setAllLevelDurations(base, config, ctx, 20, -1)).toThrow(HoldemEditError);
  });
});

describe('breaks', () => {
  it('inserts a break between segments without renumbering levels', () => {
    const { schedule, diff } = insertBreak(base, config, ctx, 1, 5);
    expect(schedule.segments[2]).toMatchObject({ kind: 'break', durationMs: 5 * MINUTE });
    expect(diff.added).toEqual([schedule.segments[2]]);
    expect(diff.changed).toEqual([]);
    expect(schedule.segments[3]?.levelNumber).toBe(3);
    expect(() => insertBreak(base, config, ctx, base.segments.length - 1, 5)).toThrow(
      HoldemEditError,
    );
    expect(() => insertBreak(base, config, ctx, -1, 5)).toThrow(HoldemEditError);
    expect(() => insertBreak(base, config, ctx, 4, 5)).toThrow(HoldemEditError); // next to a break
  });

  it('removes a break and only a break', () => {
    const { schedule, diff } = removeBreak(base, config, ctx, 5);
    expect(schedule.segments).toHaveLength(base.segments.length - 1);
    expect(diff.removed).toEqual([base.segments[5]]);
    expect(() => removeBreak(base, config, ctx, 4)).toThrow(HoldemEditError);
  });
});

describe('regenerateFrom', () => {
  it('keeps earlier segments and rebuilds later ones from the current config', () => {
    const faster = { ...config, growth: 0.5, levelDurationMin: 15 };
    const { schedule, report, diff } = regenerateFrom(base, faster, ctx, 8);
    expect(schedule.segments.slice(0, 8)).toEqual(base.segments.slice(0, 8));
    expect(schedule.segments.slice(8).every((s) => !ids.includes(s.id))).toBe(true);
    expect(diff.removed).toHaveLength(base.segments.length - 8);
    expect(report.errors).toEqual([]);

    const levels = schedule.segments.filter((s) => s.kind === 'level');
    const bbs = levels.map((s) => levelData(s)?.bb ?? 0);
    expect(bbs.slice(0, 7)).toEqual([100, 150, 200, 250, 300, 400, 500]);
    expect(bbs[7]).toBe(800); // 500 × 1.5 = 750 → nearest payable nice value
    bbs.slice(1).forEach((bb, i) => expect(bb).toBeGreaterThan(bbs[i] ?? Infinity));
    expect(levels.slice(7).every((s) => s.durationMs === 15 * MINUTE)).toBe(true);
    expect(levels.map((s) => s.levelNumber)).toEqual(levels.map((_, i) => i + 1));
    expect(schedule.segments.at(-1)?.kind).toBe('level');
    expect(schedule.segments.filter((s) => s.estimatedFinish === true)).toHaveLength(1);
  });

  it('rebuilds everything from index 0 and rejects out-of-range indexes', () => {
    const { schedule } = regenerateFrom(base, config, ctx, 0);
    expect(schedule.segments.map((s) => levelData(s)?.bb)).toEqual(
      base.segments.map((s) => levelData(s)?.bb),
    );
    expect(() => regenerateFrom(base, config, ctx, base.segments.length + 1)).toThrow(
      HoldemEditError,
    );
  });
});

describe('extend', () => {
  it('continues the progression for overtime', () => {
    const { schedule, diff } = extend(base, config, ctx, 3);
    expect(diff.added.map((s) => [s.levelNumber, levelData(s)])).toEqual([
      [21, { sb: 12_500, bb: 25_000, ante: 25_000 }],
      [22, { sb: 15_000, bb: 30_000, ante: 30_000 }],
      [23, { sb: 20_000, bb: 40_000, ante: 40_000 }],
    ]);
    expect(diff.added.every((s) => s.durationMs === 12 * MINUTE)).toBe(true);
    expect(schedule.segments.slice(0, base.segments.length)).toEqual(base.segments);
    expect(() => extend(base, config, ctx, 0)).toThrow(HoldemEditError);
  });
});

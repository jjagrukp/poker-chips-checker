import type { ModuleContext } from '@/core/modules/contract';
import { ScheduleSchema, type Schedule } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import { isValid } from '@/core/validation/report';
import { HoldemConfigSchema, type HoldemConfig } from './config';
import { levelData, summarise } from './generate';
import { texasHoldemModule } from './module';
import { PRESET_VERSION, PRESETS, type PresetTable } from './presets';
import { applyStructure, defaultConfig } from './structure';

function context(): ModuleContext {
  let n = 0;
  return { clock: { now: () => 1_000 }, newId: () => `id-${++n}` };
}

const bbs = (s: Schedule) => s.segments.map((x) => levelData(x)?.bb ?? 'break');

describe('defaults and structures', () => {
  it('derives a standard 3-hour config for 6 players', () => {
    const config = defaultConfig({ players: 6, targetDurationMin: 180 });
    expect(HoldemConfigSchema.parse(config)).toEqual(config);
    expect(config).toMatchObject({
      structure: 'standard',
      startingStack: 10_000,
      startingBlinds: { sb: 50, bb: 100 },
      growth: 0.33,
      levelDurationMin: 12,
      ante: { mode: 'bigBlind', startLevel: 5 },
      breaks: { everyMin: 60, durationMin: 10 },
      presetVersion: PRESET_VERSION,
    });
    expect(texasHoldemModule.validateConfig(config, context())).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('drops breaks for targets of 75 minutes or less', () => {
    expect(defaultConfig({ players: 6, targetDurationMin: 75 }).breaks).toBeNull();
    expect(defaultConfig({ players: 6, targetDurationMin: 76 }).breaks).not.toBeNull();
  });

  it('applies each preset and leaves custom configs alone', () => {
    const base = defaultConfig({ players: 6, targetDurationMin: 180 });
    expect(applyStructure({ ...base, structure: 'gentle' })).toMatchObject({
      startingBlinds: { bb: 50 },
      growth: 0.25,
      ante: { mode: 'none' },
    });
    expect(applyStructure({ ...base, structure: 'turbo' })).toMatchObject({
      startingBlinds: { bb: 150 },
      growth: 0.5,
      ante: { mode: 'bigBlind', startLevel: 4 },
      breaks: { durationMin: 5 },
    });
    const custom: HoldemConfig = { ...base, structure: 'custom', levelDurationMin: 33 };
    expect(applyStructure(custom)).toBe(custom);
  });
});

describe('generateSchedule', () => {
  const config = defaultConfig({ players: 6, targetDurationMin: 180 });
  const { schedule, report } = texasHoldemModule.generateSchedule(config, context());

  it('builds the standard ladder with antes, breaks, finish and buffer levels', () => {
    expect(isValid(report)).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(bbs(schedule)).toEqual([
      100,
      150,
      200,
      250,
      300,
      'break',
      400,
      500,
      600,
      800,
      1_000,
      'break',
      1_400,
      2_000,
      3_000,
      4_000,
      5_000,
      'break',
      6_000,
      8_000,
      10_000,
      15_000,
      20_000,
    ]);
    const levels = schedule.segments.filter((s) => s.kind === 'level');
    expect(levels.map((s) => s.levelNumber)).toEqual(levels.map((_, i) => i + 1));
    expect(levels.every((s) => s.durationMs === 12 * MINUTE)).toBe(true);
    expect(levels.map((s) => levelData(s)?.ante)).toEqual(
      levels.map((s, i) => (i >= 4 ? levelData(s)?.bb : 0)),
    );
    // Finish at level 13 (BB 3,000 = 60,000 ÷ 20), then max(4, ceil(6.5)) = 7 buffer levels.
    const finish = schedule.segments.filter((s) => s.estimatedFinish === true);
    expect(finish.map((s) => s.levelNumber)).toEqual([13]);
    expect(levels.length).toBe(20);
    expect(summarise(schedule.segments)).toMatchObject({ toFinishMin: 176 });
    expect(
      schedule.segments
        .filter((s) => s.kind === 'break')
        .every((s) => s.durationMs === 10 * MINUTE),
    ).toBe(true);
  });

  it('renders display lines and parses as a schedule', () => {
    expect(ScheduleSchema.parse(schedule)).toEqual(schedule);
    expect(schedule.segments[0]?.display).toEqual({
      title: 'Level 1',
      lines: [{ label: 'Blinds', value: '50 / 100' }],
    });
    expect(schedule.segments[4]?.display.lines).toEqual([
      { label: 'Blinds', value: '150 / 300' },
      { label: 'Ante', value: '300' },
    ]);
    expect(schedule.segments[5]?.display).toEqual({ title: 'Break', lines: [] });
    expect(schedule.segments.at(-1)?.display.lines[0]?.value).toBe('10,000 / 20,000');
    expect(schedule).toMatchObject({
      moduleId: 'texas-holdem',
      createdAt: 1_000,
      generatorVersion: 'holdem-generator-1',
    });
  });

  it('is deterministic for the same config and ids', () => {
    expect(texasHoldemModule.generateSchedule(config, context()).schedule).toEqual(schedule);
  });

  it('keeps saved schedules and configs independent of later preset changes', () => {
    const saved = JSON.parse(JSON.stringify({ config, schedule })) as {
      config: HoldemConfig;
      schedule: Schedule;
    };
    const changed: PresetTable = {
      ...PRESETS,
      standard: { ...PRESETS.standard, depth: 50, growth: 0.5, minLevelMin: 20 },
    };
    // Re-deriving with new presets changes a fresh config...
    expect(applyStructure(config, changed)).not.toEqual(config);
    // ...but the saved config still regenerates the saved schedule exactly.
    const savedConfig = HoldemConfigSchema.parse(saved.config);
    expect(texasHoldemModule.generateSchedule(savedConfig, context()).schedule).toEqual(
      ScheduleSchema.parse(saved.schedule),
    );
  });
});

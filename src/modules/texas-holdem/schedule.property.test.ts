import fc from 'fast-check';
import type { ModuleContext } from '@/core/modules/contract';
import { ScheduleSchema, type Schedule } from '@/core/scheduling/schedule';
import type { HoldemConfig } from './config';
import { levelData } from './generate';
import { isPayableBB, ladderRules } from './ladder';
import { texasHoldemModule } from './module';
import { MIN_BUFFER_LEVELS } from './presets';
import { applyStructure, defaultConfig } from './structure';

// Spec 04 §8: every preset × players × duration yields a valid schedule.

function context(): ModuleContext {
  let n = 0;
  return { clock: { now: () => 0 }, newId: () => `id-${++n}` };
}

function expectWellFormed(schedule: Schedule, config: HoldemConfig) {
  ScheduleSchema.parse(schedule);
  const report = texasHoldemModule.validateSchedule(schedule, config, context());
  expect(report.errors).toEqual([]);
  const { segments } = schedule;
  expect(segments.at(-1)?.kind).toBe('level');
  segments.forEach((s, i) => {
    if (s.kind === 'break') expect(segments[i + 1]?.kind).toBe('level');
  });
  const rules = ladderRules(config.denominations);
  const levels = segments.filter((s) => s.kind === 'level');
  levels.forEach((s, i) => {
    const bb = levelData(s)?.bb ?? 0;
    expect(isPayableBB(bb, rules)).toBe(true);
    if (i > 0) expect(bb).toBeGreaterThan(levelData(levels[i - 1] ?? s)?.bb ?? Infinity);
  });
  const finish = levels.findIndex((s) => s.estimatedFinish === true);
  expect(finish).toBeGreaterThanOrEqual(0);
  expect(levels.filter((s) => s.estimatedFinish === true)).toHaveLength(1);
  expect(levels.length - 1 - finish).toBeGreaterThanOrEqual(MIN_BUFFER_LEVELS);
}

describe('preset matrix', () => {
  for (const structure of ['gentle', 'standard', 'turbo'] as const) {
    for (const players of [2, 6, 10]) {
      for (const targetDurationMin of [60, 120, 180, 240]) {
        it(`${structure}, ${players} players, ${targetDurationMin} min`, () => {
          const config = applyStructure({
            ...defaultConfig({ players, targetDurationMin }),
            structure,
          });
          expectWellFormed(texasHoldemModule.generateSchedule(config, context()).schedule, config);
        });
      }
    }
  }
});

describe('random configs', () => {
  it('always produce a valid schedule', () => {
    const chipSets = [
      [1, 5, 25, 100],
      [5, 25, 100, 500],
      [25, 100, 500, 1000],
      [10, 50, 100, 500],
      [100, 500, 1000, 5000],
      [25],
      [7, 30],
    ];
    fc.assert(
      fc.property(
        fc.constantFrom('gentle', 'standard', 'turbo'),
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 30, max: 360 }),
        fc.constantFrom(...chipSets),
        fc.integer({ min: 20, max: 2_000 }),
        (structure, players, targetDurationMin, denominations, stackInChips) => {
          const smallest = denominations[0] ?? 1;
          const config = applyStructure({
            ...defaultConfig({ players, targetDurationMin }),
            structure,
            startingStack: smallest * stackInChips,
            smallestDenomination: smallest,
            denominations,
          });
          expect(texasHoldemModule.validateConfig(config, context()).errors).toEqual([]);
          expectWellFormed(texasHoldemModule.generateSchedule(config, context()).schedule, config);
        },
      ),
      { numRuns: 200 },
    );
  });
});

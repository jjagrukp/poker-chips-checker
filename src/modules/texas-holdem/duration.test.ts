import fc from 'fast-check';
import {
  breakCount,
  bufferLevels,
  finishBigBlind,
  ladderToFinish,
  planDuration,
  snapLevelLength,
} from './duration';
import { ladderRules } from './ladder';
import { LEVEL_LENGTHS_MIN, MAX_DURATION_ITERATIONS, PRESETS } from './presets';

const R = ladderRules([25, 100, 500, 1000]);
const STANDARD = { minLevelMin: 12, maxLevelMin: 30 };

describe('duration model', () => {
  it('estimates the finish at total chips ÷ 20 and adds buffer levels', () => {
    expect(finishBigBlind(6, 10_000)).toBe(3_000);
    expect(bufferLevels(4)).toBe(4);
    expect(bufferLevels(10)).toBe(5);
    expect(bufferLevels(11)).toBe(6);
  });

  it('builds the ladder up to the finishing big blind', () => {
    expect(ladderToFinish(100, 0.33, R, 3_000)).toEqual([
      100, 150, 200, 250, 300, 400, 500, 600, 800, 1_000, 1_400, 2_000, 3_000,
    ]);
    expect(ladderToFinish(5_000, 0.33, R, 3_000)).toEqual([5_000]);
  });

  it('snaps level lengths within bounds, ties to the shorter', () => {
    expect(snapLevelLength(17, STANDARD)).toBe(15);
    expect(snapLevelLength(17.5, STANDARD)).toBe(15);
    expect(snapLevelLength(5, STANDARD)).toBe(12);
    expect(snapLevelLength(100, STANDARD)).toBe(30);
  });

  it('places a break after each hour of play', () => {
    expect(breakCount(13, 12, { everyMin: 60, durationMin: 10 })).toBe(2);
    expect(breakCount(13, 15, { everyMin: 60, durationMin: 10 })).toBe(3);
    expect(breakCount(13, 15, null)).toBe(0);
  });

  it('solves playing time around breaks (3 h standard, 6 players)', () => {
    const plan = planDuration({
      targetDurationMin: 180,
      levelsToFinish: 13,
      breaks: PRESETS.standard.breaks,
      bounds: STANDARD,
    });
    // 15-min levels need 3 breaks, which leaves room for only ~11.5-min levels → 12 with 2 breaks.
    expect(plan).toMatchObject({
      levelDurationMin: 12,
      breaksBeforeFinish: 2,
      scheduledToFinishMin: 176,
      clamp: 'none',
    });
  });

  it('flags targets the preset bounds cannot reach', () => {
    const base = { breaks: null, bounds: STANDARD };
    expect(planDuration({ ...base, targetDurationMin: 60, levelsToFinish: 13 })).toMatchObject({
      levelDurationMin: 12,
      clamp: 'tooShort',
    });
    expect(planDuration({ ...base, targetDurationMin: 240, levelsToFinish: 5 })).toMatchObject({
      levelDurationMin: 30,
      clamp: 'tooLong',
      neededMin: 48,
    });
  });

  it('always converges to an allowed length', () => {
    const boundsArb = fc.constantFrom(
      ...Object.values(PRESETS).map(({ minLevelMin, maxLevelMin }) => ({
        minLevelMin,
        maxLevelMin,
      })),
    );
    const breaksArb = fc.option(
      fc.record({
        everyMin: fc.integer({ min: 20, max: 120 }),
        durationMin: fc.integer({ min: 1, max: 30 }),
      }),
      { nil: null },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 15, max: 720 }),
        fc.integer({ min: 1, max: 60 }),
        breaksArb,
        boundsArb,
        (targetDurationMin, levelsToFinish, breaks, bounds) => {
          const plan = planDuration({ targetDurationMin, levelsToFinish, breaks, bounds });
          expect(plan.iterations).toBeLessThan(MAX_DURATION_ITERATIONS);
          expect(LEVEL_LENGTHS_MIN).toContain(plan.levelDurationMin);
          expect(plan.levelDurationMin).toBeGreaterThanOrEqual(bounds.minLevelMin);
          expect(plan.levelDurationMin).toBeLessThanOrEqual(bounds.maxLevelMin);
        },
      ),
      { numRuns: 300 },
    );
  });
});

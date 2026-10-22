import type { ModuleContext } from '@/core/modules/contract';
import type { Schedule, Segment } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import type { HoldemConfig } from './config';
import { breakSegment, levelSegment, makeSchedule, markFinish } from './generate';
import { applyStructure, defaultConfig } from './structure';
import { validateConfig, validateSchedule } from './validate';

let n = 0;
const ctx: ModuleContext = { clock: { now: () => 0 }, newId: () => `id-${++n}` };
const config = defaultConfig({ players: 6, targetDurationMin: 180 });

/** A schedule of 12-minute levels from [sb, bb, ante] triples; 'B' is a break. */
function schedule(levels: ([number, number, number] | 'B')[], minutes = 12): Schedule {
  let level = 0;
  const segments: Segment[] = levels.map((l) =>
    l === 'B'
      ? breakSegment(ctx.newId(), 10 * MINUTE)
      : levelSegment(ctx.newId(), ++level, { sb: l[0], bb: l[1], ante: l[2] }, minutes * MINUTE),
  );
  return makeSchedule(segments, ctx);
}

const codes = (r: { errors: { code: string }[]; warnings: { code: string }[] }) => ({
  errors: r.errors.map((i) => i.code),
  warnings: r.warnings.map((i) => i.code),
});

describe('validateConfig', () => {
  it('rejects bad starting blinds and shallow stacks', () => {
    const bad: HoldemConfig = {
      ...config,
      structure: 'custom',
      startingBlinds: { sb: 30, bb: 2_000 },
    };
    expect(codes(validateConfig(bad))).toEqual({
      errors: ['blindRatio', 'sbNotPayable', 'stackTooShallow'],
      warnings: [],
    });
  });

  it('warns when a preset needs levels outside its bounds', () => {
    const turbo = applyStructure({
      ...defaultConfig({ players: 2, targetDurationMin: 240 }),
      structure: 'turbo',
    });
    const report = validateConfig(turbo);
    expect(codes(report).warnings).toEqual(['levelsTooLong']);
    expect(report.warnings[0]?.params).toMatchObject({ target: '4h', depth: 67 });
    const gentle = applyStructure({
      ...defaultConfig({ players: 10, targetDurationMin: 60 }),
      structure: 'gentle',
    });
    expect(codes(validateConfig(gentle)).warnings).toEqual(['levelsTooShort']);
  });
});

describe('validateSchedule', () => {
  it('requires at least one level', () => {
    const onlyBreak = makeSchedule([breakSegment('b', MINUTE)], ctx);
    expect(codes(validateSchedule(onlyBreak, config)).errors).toEqual(['noLevels']);
  });

  it('reports blind errors per level', () => {
    const s = schedule([
      [50, 100, 0],
      [60, 120, 0], // SB not payable
      [50, 100, 0], // not increasing
      [0, 0, 0], // non-positive
      [100, 200, 30], // ante not payable
    ]);
    const report = validateSchedule(s, config);
    expect(codes(report).errors).toEqual([
      'sbNotPayable',
      'blindsNotIncreasing',
      'nonPositiveBlinds',
      'anteNotPayable',
    ]);
    expect(report.errors[0]).toMatchObject({
      messageKey: 'holdem.schedule.error.sbNotPayable',
      params: { level: 2, sb: '60', chip: '25' },
      path: 'segments.1',
    });
  });

  it('reports unreadable level data and non-positive durations', () => {
    const level = levelSegment('x', 1, { sb: 50, bb: 100, ante: 0 }, MINUTE);
    const broken = makeSchedule([{ ...level, data: { sb: 'x' }, durationMs: 0 }], ctx);
    expect(codes(validateSchedule(broken, config)).errors).toEqual([
      'nonPositiveDuration',
      'invalidLevelData',
    ]);
  });

  it('warns about jumps, ratios, antes, lengths, depth and missing finish', () => {
    const s = schedule(
      [
        [25, 50, 0],
        [100, 250, 0], // ratio + more than double
        [150, 300, 400], // ante above BB
      ],
      45,
    );
    expect(codes(validateSchedule(s, config))).toEqual({
      errors: [],
      warnings: ['levelLength', 'blindRatio', 'growthJump', 'anteAboveBB', 'noFinish'],
    });
  });

  it('flags starting depth outside 10–300 BB and a finish far from the target', () => {
    const heads = { ...config, players: 2, startingStack: 20_000 };
    const plain = schedule(
      [25, 50, 100, 200, 400, 800, 1_000].map((sb) => [sb, sb * 2, 0] as [number, number, number]),
    );
    const doubling = { ...plain, segments: markFinish(plain.segments, heads) };
    // 2 players × 20,000 → finish at BB 2,000 after 84 min (target 180); 400 BB deep.
    expect(codes(validateSchedule(doubling, heads))).toEqual({
      errors: [],
      warnings: ['depthHigh', 'finishOffTarget'],
    });

    const one = schedule([[25, 50, 0]]);
    expect(codes(validateSchedule(one, { ...config, startingStack: 1_000 }))).toEqual({
      errors: [],
      warnings: ['depthLow', 'noFinish'],
    });
    expect(codes(validateSchedule(one, { ...config, startingStack: 400 })).errors).toEqual([
      'stackTooShallow',
    ]);
  });
});

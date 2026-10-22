import type { ModuleContext } from '@/core/modules/contract';
import { SCHEDULE_SCHEMA_VERSION, type Schedule, type Segment } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import { t } from '@/shared/messages';
import { LevelDataSchema, type HoldemConfig, type LevelData } from './config';
import { breakDue, bufferLevels, finishBigBlind } from './duration';
import { formatChips } from './format';
import { anteFor, ladderRules, snapNextBB } from './ladder';
import { GENERATOR_VERSION, HOLDEM_MODULE_ID, HOLDEM_MODULE_VERSION, MAX_LEVELS } from './presets';

// Schedule generator (spec 04 §3–4). Uses the config literally; presets only matter when the
// config is derived (structure.ts), so saved schedules never move when presets change.

export function levelData(segment: Segment): LevelData | undefined {
  if (segment.kind !== 'level') return undefined;
  const parsed = LevelDataSchema.safeParse(segment.data);
  return parsed.success ? parsed.data : undefined;
}

export function levelSegment(
  id: string,
  levelNumber: number,
  data: LevelData,
  durationMs: number,
): Segment {
  const lines = [
    {
      label: t('holdem.display.blinds', 'neutral'),
      value: `${formatChips(data.sb)} / ${formatChips(data.bb)}`,
    },
  ];
  if (data.ante > 0) {
    lines.push({ label: t('holdem.display.ante', 'neutral'), value: formatChips(data.ante) });
  }
  return {
    id,
    kind: 'level',
    durationMs,
    levelNumber,
    display: { title: t('holdem.segment.level', 'neutral', { number: levelNumber }), lines },
    data,
  };
}

export function breakSegment(id: string, durationMs: number): Segment {
  return {
    id,
    kind: 'break',
    durationMs,
    display: { title: t('holdem.segment.break', 'neutral'), lines: [] },
    data: null,
  };
}

/** Renumbers levels from 1 and re-renders their display. */
export function renumber(segments: readonly Segment[]): Segment[] {
  let n = 0;
  return segments.map((s) => {
    if (s.kind !== 'level') return s;
    n += 1;
    const data = levelData(s);
    if (!data) return { ...s, levelNumber: n };
    const fresh = levelSegment(s.id, n, data, s.durationMs);
    return s.estimatedFinish === undefined
      ? fresh
      : { ...fresh, estimatedFinish: s.estimatedFinish };
  });
}

/** Marks the first level with BB ≥ total chips ÷ 20 as the estimated finish. */
export function markFinish(segments: readonly Segment[], config: HoldemConfig): Segment[] {
  const finishBB = finishBigBlind(config.players, config.startingStack);
  const index = segments.findIndex((s) => (levelData(s)?.bb ?? 0) >= finishBB);
  return segments.map((s, i) =>
    i === index
      ? { ...s, estimatedFinish: true }
      : s.estimatedFinish === undefined
        ? s
        : { ...s, estimatedFinish: false },
  );
}

/**
 * Keeps `prefix` and appends levels (with breaks) continuing its progression until the
 * estimated finish plus buffer levels. Breaks never come last.
 */
export function buildFrom(
  prefix: readonly Segment[],
  config: HoldemConfig,
  ctx: ModuleContext,
): Segment[] {
  const rules = ladderRules(config.denominations);
  const finishBB = finishBigBlind(config.players, config.startingStack);
  const segments = [...prefix];
  let levels = 0;
  let lastBB: number | undefined;
  let finishLevel: number | undefined;
  let playSinceBreak = 0;
  for (const s of prefix) {
    if (s.kind === 'break') {
      playSinceBreak = 0;
      continue;
    }
    levels += 1;
    playSinceBreak += s.durationMs / MINUTE;
    const bb = levelData(s)?.bb;
    if (bb !== undefined) lastBB = bb;
    if (finishLevel === undefined && bb !== undefined && bb >= finishBB) finishLevel = levels;
  }

  const durationMs = config.levelDurationMin * MINUTE;
  const lastIsLevel = () => segments.at(-1)?.kind === 'level';
  while (levels < MAX_LEVELS) {
    const done = finishLevel !== undefined && levels - finishLevel >= bufferLevels(finishLevel);
    if (done && lastIsLevel()) break;
    if (lastIsLevel() && breakDue(playSinceBreak, config.breaks)) {
      segments.push(breakSegment(ctx.newId(), (config.breaks?.durationMin ?? 0) * MINUTE));
      playSinceBreak = 0;
    }
    const bb =
      lastBB === undefined
        ? config.startingBlinds.bb
        : snapNextBB(lastBB, lastBB * (1 + config.growth), rules);
    levels += 1;
    const ante = anteFor(levels, bb, config.ante, config.smallestDenomination);
    segments.push(levelSegment(ctx.newId(), levels, { sb: bb / 2, bb, ante }, durationMs));
    playSinceBreak += config.levelDurationMin;
    lastBB = bb;
    if (finishLevel === undefined && bb >= finishBB) finishLevel = levels;
  }
  return markFinish(segments, config);
}

export function makeSchedule(segments: Segment[], ctx: ModuleContext): Schedule {
  return {
    id: ctx.newId(),
    moduleId: HOLDEM_MODULE_ID,
    moduleVersion: HOLDEM_MODULE_VERSION,
    generatorVersion: GENERATOR_VERSION,
    segments,
    createdAt: ctx.clock.now(),
    schemaVersion: SCHEDULE_SCHEMA_VERSION,
  };
}

export function buildSchedule(config: HoldemConfig, ctx: ModuleContext): Schedule {
  return makeSchedule(buildFrom([], config, ctx), ctx);
}

export interface ScheduleSummary {
  /** Index of the estimated-finish segment, if any. */
  finishIndex: number | undefined;
  /** Minutes to the end of the estimated-finish level, breaks included. */
  toFinishMin: number | undefined;
  totalMin: number;
}

export function summarise(segments: readonly Segment[]): ScheduleSummary {
  const finish = segments.findIndex((s) => s.estimatedFinish === true);
  const minutes = (list: readonly Segment[]) =>
    list.reduce((sum, s) => sum + s.durationMs, 0) / MINUTE;
  return {
    finishIndex: finish === -1 ? undefined : finish,
    toFinishMin: finish === -1 ? undefined : minutes(segments.slice(0, finish + 1)),
    totalMin: minutes(segments),
  };
}

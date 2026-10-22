import type { ModuleContext } from '@/core/modules/contract';
import type { Schedule, Segment } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import type { ValidationReport } from '@/core/validation/report';
import type { HoldemConfig } from './config';
import {
  breakSegment,
  buildFrom,
  levelData,
  levelSegment,
  makeSchedule,
  markFinish,
  renumber,
} from './generate';
import { anteFor, ladderRules, snapNextBB } from './ladder';
import { validateSchedule } from './validate';

// Pure schedule edits with a preview diff (spec 04 §6). Each returns a new schedule (new id);
// untouched segments keep their ids, so core `editSchedule` can enforce the running-tournament
// rules (spec 03 §7). Indexes are segment indexes; bad indexes are programmer errors and throw.

export interface ScheduleDiff {
  added: Segment[];
  removed: Segment[];
  changed: { before: Segment; after: Segment }[];
}

export interface EditResult {
  schedule: Schedule;
  report: ValidationReport;
  diff: ScheduleDiff;
}

export interface LevelPatch {
  sb: number;
  bb: number;
  ante: number;
  durationMin: number;
}

export class HoldemEditError extends Error {
  constructor(operation: string, reason: string) {
    super(`${operation}: ${reason}`);
    this.name = 'HoldemEditError';
  }
}

const essence = (s: Segment) =>
  JSON.stringify([s.kind, s.durationMs, s.levelNumber, s.data, s.estimatedFinish === true]);

export function diffSchedules(before: readonly Segment[], after: readonly Segment[]): ScheduleDiff {
  const beforeById = new Map(before.map((s) => [s.id, s]));
  const afterIds = new Set(after.map((s) => s.id));
  const diff: ScheduleDiff = { added: [], removed: [], changed: [] };
  for (const s of after) {
    const old = beforeById.get(s.id);
    if (!old) diff.added.push(s);
    else if (essence(old) !== essence(s)) diff.changed.push({ before: old, after: s });
  }
  diff.removed = before.filter((s) => !afterIds.has(s.id));
  return diff;
}

function result(
  before: Schedule,
  segments: Segment[],
  config: HoldemConfig,
  ctx: ModuleContext,
): EditResult {
  const schedule = makeSchedule(markFinish(renumber(segments), config), ctx);
  return {
    schedule,
    report: validateSchedule(schedule, config),
    diff: diffSchedules(before.segments, schedule.segments),
  };
}

function toMs(operation: string, durationMin: number): number {
  const ms = Math.round(durationMin * MINUTE);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new HoldemEditError(operation, 'duration must be above 0 minutes');
  }
  return ms;
}

function segmentAt(operation: string, schedule: Schedule, index: number, kind: Segment['kind']) {
  const segment = schedule.segments[index];
  if (!Number.isInteger(index) || !segment || segment.kind !== kind) {
    throw new HoldemEditError(operation, `segment ${index} is not a ${kind}`);
  }
  return segment;
}

export function setLevel(
  schedule: Schedule,
  config: HoldemConfig,
  ctx: ModuleContext,
  index: number,
  patch: LevelPatch,
): EditResult {
  const segment = segmentAt('setLevel', schedule, index, 'level');
  const edited = levelSegment(
    segment.id,
    segment.levelNumber ?? 1,
    { sb: patch.sb, bb: patch.bb, ante: patch.ante },
    toMs('setLevel', patch.durationMin),
  );
  const segments = schedule.segments.map((s, i) => (i === index ? edited : s));
  return result(schedule, segments, config, ctx);
}

export function setAllLevelDurations(
  schedule: Schedule,
  config: HoldemConfig,
  ctx: ModuleContext,
  durationMin: number,
  fromIndex = 0,
): EditResult {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= schedule.segments.length) {
    throw new HoldemEditError('setAllLevelDurations', `index ${fromIndex} is outside the schedule`);
  }
  const ms = toMs('setAllLevelDurations', durationMin);
  const segments = schedule.segments.map((s, i) =>
    i >= fromIndex && s.kind === 'level' ? { ...s, durationMs: ms } : s,
  );
  return result(schedule, segments, config, ctx);
}

export function insertBreak(
  schedule: Schedule,
  config: HoldemConfig,
  ctx: ModuleContext,
  afterIndex: number,
  durationMin: number,
): EditResult {
  const last = schedule.segments.length - 1;
  if (!Number.isInteger(afterIndex) || afterIndex < 0 || afterIndex >= last) {
    throw new HoldemEditError('insertBreak', 'a break must sit between two segments');
  }
  if (
    schedule.segments[afterIndex]?.kind === 'break' ||
    schedule.segments[afterIndex + 1]?.kind === 'break'
  ) {
    throw new HoldemEditError('insertBreak', 'breaks cannot be next to each other');
  }
  const segments = [...schedule.segments];
  segments.splice(afterIndex + 1, 0, breakSegment(ctx.newId(), toMs('insertBreak', durationMin)));
  return result(schedule, segments, config, ctx);
}

export function removeBreak(
  schedule: Schedule,
  config: HoldemConfig,
  ctx: ModuleContext,
  index: number,
): EditResult {
  segmentAt('removeBreak', schedule, index, 'break');
  return result(
    schedule,
    schedule.segments.filter((_, i) => i !== index),
    config,
    ctx,
  );
}

/** Keeps segments before `fromIndex` and rebuilds the rest from the current config. */
export function regenerateFrom(
  schedule: Schedule,
  config: HoldemConfig,
  ctx: ModuleContext,
  fromIndex: number,
): EditResult {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex > schedule.segments.length) {
    throw new HoldemEditError('regenerateFrom', `index ${fromIndex} is outside the schedule`);
  }
  const segments = buildFrom(schedule.segments.slice(0, fromIndex), config, ctx);
  return result(schedule, segments, config, ctx);
}

/** Appends `levels` levels continuing the progression (for overtime); no breaks. */
export function extend(
  schedule: Schedule,
  config: HoldemConfig,
  ctx: ModuleContext,
  levels: number,
): EditResult {
  if (!Number.isInteger(levels) || levels < 1) {
    throw new HoldemEditError('extend', 'add at least one level');
  }
  const rules = ladderRules(config.denominations);
  const segments = [...schedule.segments];
  const lastLevel = segments.filter((s) => s.kind === 'level').at(-1);
  let bb =
    (lastLevel && levelData(lastLevel)?.bb) ?? config.startingBlinds.bb / (1 + config.growth);
  let number = segments.filter((s) => s.kind === 'level').length;
  const durationMs = lastLevel?.durationMs ?? config.levelDurationMin * MINUTE;
  for (let i = 0; i < levels; i += 1) {
    bb = snapNextBB(bb, bb * (1 + config.growth), rules);
    number += 1;
    const ante = anteFor(number, bb, config.ante, config.smallestDenomination);
    segments.push(levelSegment(ctx.newId(), number, { sb: bb / 2, bb, ante }, durationMs));
  }
  return result(schedule, segments, config, ctx);
}

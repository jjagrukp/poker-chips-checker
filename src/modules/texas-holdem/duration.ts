import { snapNextBB, type LadderRules } from './ladder';
import {
  BUFFER_RATIO,
  CLAMP_TOLERANCE,
  FINISH_FACTOR,
  LEVEL_LENGTHS_MIN,
  MAX_DURATION_ITERATIONS,
  MAX_LEVELS,
  MIN_BUFFER_LEVELS,
} from './presets';

// Freezeout duration model (spec 04 §3). Levels-to-finish comes from the snapped ladder itself
// (D22), so the plan and the generated schedule agree on where the estimated finish falls.

export interface Bounds {
  minLevelMin: number;
  maxLevelMin: number;
}

export type BreakRule = { everyMin: number; durationMin: number } | null;

export function finishBigBlind(players: number, startingStack: number): number {
  return (players * startingStack) / FINISH_FACTOR;
}

export function bufferLevels(levelsToFinish: number): number {
  return Math.max(MIN_BUFFER_LEVELS, Math.ceil(BUFFER_RATIO * levelsToFinish));
}

/** BBs from the start up to and including the first BB ≥ `finishBB` (capped at MAX_LEVELS). */
export function ladderToFinish(
  startBB: number,
  growth: number,
  rules: LadderRules,
  finishBB: number,
): number[] {
  const out = [startBB];
  let bb = startBB;
  while (bb < finishBB && out.length < MAX_LEVELS) {
    bb = snapNextBB(bb, bb * (1 + growth), rules);
    out.push(bb);
  }
  return out;
}

/** Nearest allowed level length within bounds; ties go to the shorter length. */
export function snapLevelLength(rawMin: number, bounds: Bounds): number {
  const allowed = LEVEL_LENGTHS_MIN.filter(
    (m) => m >= bounds.minLevelMin && m <= bounds.maxLevelMin,
  );
  const pool = allowed.length > 0 ? allowed : [bounds.minLevelMin];
  let best = pool[0] ?? bounds.minLevelMin;
  for (const m of pool) if (Math.abs(m - rawMin) < Math.abs(best - rawMin)) best = m;
  return best;
}

/** True when a break belongs after a level, given play since the last break (spec 04 §4). */
export function breakDue(playSinceBreakMin: number, breaks: BreakRule): boolean {
  return breaks !== null && playSinceBreakMin >= breaks.everyMin;
}

/** Breaks placed between the first `levels` levels of uniform length. */
export function breakCount(levels: number, levelMin: number, breaks: BreakRule): number {
  let count = 0;
  let since = 0;
  for (let i = 1; i < levels; i += 1) {
    since += levelMin;
    if (breakDue(since, breaks)) {
      count += 1;
      since = 0;
    }
  }
  return count;
}

export interface DurationInput {
  targetDurationMin: number;
  levelsToFinish: number;
  breaks: BreakRule;
  bounds: Bounds;
}

export interface DurationPlan {
  levelDurationMin: number;
  /** Unsnapped level length the target needs, after breaks. */
  neededMin: number;
  breaksBeforeFinish: number;
  /** Minutes to the end of the estimated-finish level, breaks included. */
  scheduledToFinishMin: number;
  iterations: number;
  clamp: 'none' | 'tooLong' | 'tooShort';
}

/**
 * Solves P = target − breaks(P) by fixed-point iteration over snapped level lengths. If the
 * snapping makes it cycle, the visited length closest to the target wins.
 */
export function planDuration(input: DurationInput): DurationPlan {
  const { targetDurationMin: target, levelsToFinish: levels, breaks, bounds } = input;
  const evaluate = (levelMin: number) => {
    const b = breakCount(levels, levelMin, breaks);
    const breakMin = b * (breaks?.durationMin ?? 0);
    return {
      breaks: b,
      needed: Math.max(1, (target - breakMin) / levels),
      scheduled: levels * levelMin + breakMin,
    };
  };

  let levelMin = snapLevelLength(target / levels, bounds);
  const seen: number[] = [];
  let iterations = 0;
  while (iterations < MAX_DURATION_ITERATIONS) {
    iterations += 1;
    seen.push(levelMin);
    const next = snapLevelLength(evaluate(levelMin).needed, bounds);
    if (next === levelMin) break;
    if (seen.includes(next)) {
      levelMin = seen
        .slice(seen.indexOf(next))
        .reduce((a, b) =>
          Math.abs(evaluate(b).scheduled - target) < Math.abs(evaluate(a).scheduled - target)
            ? b
            : a,
        );
      break;
    }
    levelMin = next;
  }

  const result = evaluate(levelMin);
  const clamp =
    result.needed > bounds.maxLevelMin * (1 + CLAMP_TOLERANCE)
      ? 'tooLong'
      : result.needed < bounds.minLevelMin * (1 - CLAMP_TOLERANCE)
        ? 'tooShort'
        : 'none';
  return {
    levelDurationMin: levelMin,
    neededMin: result.needed,
    breaksBeforeFinish: result.breaks,
    scheduledToFinishMin: result.scheduled,
    iterations,
    clamp,
  };
}

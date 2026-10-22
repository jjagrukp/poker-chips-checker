import type { Schedule, SegmentKind } from '@/core/scheduling/schedule';
import { MINUTE, SECOND, type EpochMs, type Ms } from '@/core/time';
import type { ClockAnchor, DeriveOptions } from '@/core/timer/anchor';
import { normalise, required } from '@/core/timer/derive-clock';
import type { SoundAlertType } from './alerts';

// Alert planning (spec 03 §6.2). Pure: alert times come from the anchor, so the same anchor
// always gives the same keys, after a refresh or in another tab.

export interface PlannedAlert {
  /** `${segmentId}:${type}:${at}` (D27): a restarted level or extended break alerts again. */
  key: string;
  type: Exclude<SoundAlertType, 'complete'>;
  segmentId: string;
  at: EpochMs;
  /** Countdown only: seconds left when it sounds (10…1). */
  beat?: number;
}

export const COUNTDOWN_BEATS = 10;
/** An alert crossed by a longer gap between ticks (sleep, throttling) is marked fired silently. */
export const LIVE_GAP_MS: Ms = 2 * SECOND;
/** Sounds this close are pre-scheduled on the audio timeline (background tabs throttle timers). */
export const LOOKAHEAD_MS: Ms = 15 * SECOND;
/** Fired keys older than this can never be planned again, so they're dropped. */
export const FIRED_RETENTION_MS: Ms = 10 * MINUTE;

const THRESHOLDS: Record<SegmentKind, { type: 'fiveMinutes' | 'oneMinute' | 'breakEnding'; ms: Ms }[]> = {
  level: [
    { type: 'fiveMinutes', ms: 5 * MINUTE },
    { type: 'oneMinute', ms: MINUTE },
  ],
  break: [{ type: 'breakEnding', ms: MINUTE }],
};

/** Every timed alert in `(from, to]` for a running clock. */
export function planAlerts(
  schedule: Schedule,
  anchor: ClockAnchor,
  from: EpochMs,
  to: EpochMs,
  opts: DeriveOptions,
): PlannedAlert[] {
  // Anything at or before the last write was already past when it was made (e.g. a resume).
  const start = Math.max(from, anchor.updatedAt);
  if (to <= start || anchor.status !== 'running') return [];
  const a = normalise(schedule, anchor, start, opts).anchor;
  if (a.status !== 'running') return [];

  const out: PlannedAlert[] = [];
  const add = (type: PlannedAlert['type'], segmentId: string, at: EpochMs, beat?: number) => {
    if (at <= start || at > to) return;
    const key = `${segmentId}:${type}${beat ?? ''}:${at}`;
    out.push(beat === undefined ? { key, type, segmentId, at } : { key, type, segmentId, at, beat });
  };
  /** Thresholds before a segment's own start belong to nothing. */
  const ending = (kind: SegmentKind, segmentId: string, deadline: EpochMs, startedAt: EpochMs) => {
    for (const { type, ms } of THRESHOLDS[kind]) {
      if (deadline - ms > startedAt) add(type, segmentId, deadline - ms);
    }
    for (let beat = COUNTDOWN_BEATS; beat >= 1; beat--) {
      if (deadline - beat * SECOND > startedAt) add('countdown', segmentId, deadline - beat * SECOND, beat);
    }
  };

  const { segments } = schedule;
  const waitForHost = opts.breakEndBehaviour === 'waitForHost';
  let index = a.segmentIndex;
  let startedAt = -Infinity;
  let deadline: EpochMs;
  if (a.interlude) {
    const breakEnd = required(a.interlude.deadline, 'interlude.deadline');
    const id = required(segments[index], 'segment').id;
    ending('break', id, breakEnd, startedAt);
    add('breakEnd', id, breakEnd);
    if (waitForHost) return out;
    startedAt = breakEnd;
    deadline = breakEnd + a.interlude.resumeLevelRemainingMs;
  } else {
    deadline = required(a.deadline, 'deadline');
  }

  for (;;) {
    const segment = required(segments[index], 'segment');
    ending(segment.kind, segment.id, deadline, startedAt);
    const next = segments[index + 1];
    // Overtime: the schedule never invents a next level, so nothing sounds at its end.
    if (!next) break;
    if (segment.kind === 'break') add('breakEnd', segment.id, deadline);
    else add(next.kind === 'break' ? 'breakStart' : 'levelStart', next.id, deadline);
    // Later segments' alerts all fall after this deadline.
    if (deadline >= to || (waitForHost && segment.kind === 'break')) break;
    index += 1;
    startedAt = deadline;
    deadline += next.durationMs;
  }
  return out;
}

export interface DueAlerts {
  /** Crossed during live ticking: sound and show them. */
  live: PlannedAlert[];
  /** Crossed during a gap (sleep, catch-up): mark fired without a sound. */
  missed: PlannedAlert[];
}

/** Alerts crossed between two ticks that haven't fired yet (spec 03 §6.2). */
export function dueAlerts(
  schedule: Schedule,
  anchor: ClockAnchor,
  previousTick: EpochMs,
  now: EpochMs,
  opts: DeriveOptions,
  fired: ReadonlySet<string>,
): DueAlerts {
  const due = planAlerts(schedule, anchor, previousTick, now, opts).filter((a) => !fired.has(a.key));
  return now - previousTick < LIVE_GAP_MS ? { live: due, missed: [] } : { live: [], missed: due };
}

/** Adds newly fired keys and drops ones too old to matter. */
export function recordFired(
  fired: readonly string[],
  added: readonly string[],
  now: EpochMs,
): string[] {
  const keep = (key: string) => alertTime(key) >= now - FIRED_RETENTION_MS;
  return [...new Set([...fired, ...added])].filter(keep);
}

function alertTime(key: string): EpochMs {
  const at = Number(key.slice(key.lastIndexOf(':') + 1));
  return Number.isFinite(at) ? at : -Infinity;
}

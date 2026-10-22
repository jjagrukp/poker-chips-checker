import type { Schedule } from '@/core/scheduling/schedule';
import type { EpochMs, Ms } from '@/core/time';
import type { ClockAnchor, DeriveOptions, Interlude } from './anchor';

export interface ClockView {
  segmentIndex: number;
  remainingMs: Ms;
  status: 'idle' | 'running' | 'paused' | 'awaitingHost';
  inInterlude: boolean;
  /** > 0 when the schedule is exhausted. */
  overtimeMs: Ms;
  /** Segments that ended between `anchor.updatedAt` and `now`. */
  passedSegmentIds: string[];
  /** Device clock is earlier than the last write: state frozen as paused (spec 03 §3). */
  clockWentBackwards: boolean;
}

export interface StartedSegment {
  segmentIndex: number;
  segmentId: string;
  at: EpochMs;
}

export interface Normalised {
  /** Equivalent anchor rewritten to `now` (revision/updatedAt untouched). */
  anchor: ClockAnchor;
  view: ClockView;
  /** Segments that began during catch-up, for lazy `segment_started` events. */
  started: StartedSegment[];
}

export const CLOCK_SKEW_TOLERANCE_MS: Ms = 5_000;

export class CorruptAnchor extends Error {
  constructor(reason: string) {
    super(`Corrupt clock anchor: ${reason}`);
    this.name = 'CorruptAnchor';
  }
}

/** Pure: used every UI tick and on recovery alike. */
export function deriveClock(
  schedule: Schedule,
  anchor: ClockAnchor,
  now: EpochMs,
  opts: DeriveOptions,
): ClockView {
  return normalise(schedule, anchor, now, opts).view;
}

export function normalise(
  schedule: Schedule,
  anchor: ClockAnchor,
  now: EpochMs,
  opts: DeriveOptions,
): Normalised {
  if (anchor.segmentIndex >= schedule.segments.length) {
    throw new CorruptAnchor('segmentIndex is outside the schedule');
  }
  if (anchor.status !== 'running') {
    return { anchor, view: staticView(anchor), started: [] };
  }
  if (now < anchor.updatedAt - CLOCK_SKEW_TOLERANCE_MS) {
    // Never regress: freeze at the last known moment and let the host decide.
    const frozen = freeze(
      normalise(schedule, anchor, anchor.updatedAt, opts).anchor,
      anchor.updatedAt,
    );
    return {
      anchor: frozen,
      view: { ...staticView(frozen), clockWentBackwards: true },
      started: [],
    };
  }
  return catchUp(schedule, anchor, now, opts);
}

/** Converts a running anchor to the equivalent paused one at `at`. */
export function freeze(anchor: ClockAnchor, at: EpochMs): ClockAnchor {
  if (anchor.status !== 'running') return anchor;
  if (anchor.interlude) {
    const remainingMs = Math.max(0, required(anchor.interlude.deadline, 'interlude.deadline') - at);
    return compact<ClockAnchor>({
      ...anchor,
      status: 'paused',
      interlude: compact<Interlude>({ ...anchor.interlude, deadline: undefined, remainingMs }),
    });
  }
  const remainingMs = Math.max(0, required(anchor.deadline, 'deadline') - at);
  return compact<ClockAnchor>({ ...anchor, status: 'paused', deadline: undefined, remainingMs });
}

export function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new CorruptAnchor(`${field} is missing`);
  return value;
}

/** Drops keys whose value is undefined so persisted anchors stay minimal. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function staticView(anchor: ClockAnchor): ClockView {
  const held = anchor.status === 'paused' && anchor.holdAtIndex === anchor.segmentIndex;
  const remainingMs = anchor.interlude
    ? required(anchor.interlude.remainingMs, 'interlude.remainingMs')
    : required(anchor.remainingMs, 'remainingMs');
  return {
    segmentIndex: anchor.segmentIndex,
    remainingMs,
    status: held ? 'awaitingHost' : anchor.status,
    inInterlude: anchor.interlude !== undefined,
    overtimeMs: 0,
    passedSegmentIds: [],
    clockWentBackwards: false,
  };
}

function hold(anchor: ClockAnchor, segmentIndex: number, remainingMs: Ms): ClockAnchor {
  return compact<ClockAnchor>({
    ...anchor,
    status: 'paused',
    segmentIndex,
    deadline: undefined,
    interlude: undefined,
    remainingMs,
    holdAtIndex: segmentIndex,
  });
}

function catchUp(
  schedule: Schedule,
  anchor: ClockAnchor,
  now: EpochMs,
  opts: DeriveOptions,
): Normalised {
  const { segments } = schedule;
  const waitForHost = opts.breakEndBehaviour === 'waitForHost';
  const passedSegmentIds: string[] = [];
  const started: StartedSegment[] = [];
  let index = anchor.segmentIndex;
  let deadline: EpochMs;

  if (anchor.interlude) {
    const breakDeadline = required(anchor.interlude.deadline, 'interlude.deadline');
    const levelRemaining = anchor.interlude.resumeLevelRemainingMs;
    if (now < breakDeadline) {
      const view = { ...staticView(freeze(anchor, now)), status: 'running' as const };
      return { anchor, view, started };
    }
    if (waitForHost) {
      const held = hold(anchor, index, levelRemaining);
      return { anchor: held, view: staticView(held), started };
    }
    deadline = breakDeadline + levelRemaining;
  } else {
    deadline = required(anchor.deadline, 'deadline');
  }

  // Catch-up (spec 03 §2): advance while the current segment's deadline has passed.
  while (now >= deadline) {
    const current = required(segments[index], 'segment');
    if (deadline > anchor.updatedAt) passedSegmentIds.push(current.id);
    const next = segments[index + 1];
    if (!next) {
      const overtime = compact<ClockAnchor>({
        ...anchor,
        segmentIndex: index,
        deadline,
        interlude: undefined,
      });
      const view: ClockView = {
        ...staticView(freeze(overtime, now)),
        status: 'running',
        overtimeMs: now - deadline,
        passedSegmentIds,
      };
      return { anchor: overtime, view, started };
    }
    // A held segment starts when the host resumes, not when the break ends.
    if (waitForHost && current.kind === 'break') {
      const held = hold(anchor, index + 1, next.durationMs);
      return { anchor: held, view: { ...staticView(held), passedSegmentIds }, started };
    }
    started.push({ segmentIndex: index + 1, segmentId: next.id, at: deadline });
    index += 1;
    deadline += next.durationMs;
  }

  const running = compact<ClockAnchor>({
    ...anchor,
    segmentIndex: index,
    deadline,
    interlude: undefined,
  });
  const view: ClockView = {
    ...staticView(freeze(running, now)),
    status: 'running',
    passedSegmentIds,
  };
  return { anchor: running, view, started };
}

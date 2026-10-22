import type { EventDraft } from '@/core/events/events';
import type { Schedule } from '@/core/scheduling/schedule';
import type { EpochMs, Ms } from '@/core/time';
import type { ClockAnchor, ClockCommandName, DeriveOptions, Interlude } from './anchor';
import { compact, normalise, required, type Normalised, type StartedSegment } from './derive-clock';

// Clock commands (spec 03 §1): pure `(state, now) → { anchor, events }`. Each normalises via
// `deriveClock` first, then applies its change. Invalid commands throw InvalidClockCommand.

export interface ClockState {
  schedule: Schedule;
  anchor: ClockAnchor;
  options: DeriveOptions;
}

export interface CommandResult {
  anchor: ClockAnchor;
  events: EventDraft[];
}

export class InvalidClockCommand extends Error {
  constructor(
    readonly command: ClockCommandName,
    reason: string,
  ) {
    super(`Cannot ${command}: ${reason}`);
    this.name = 'InvalidClockCommand';
  }
}

/** Idle at the first segment with its full duration. */
export function initialAnchor(schedule: Schedule, now: EpochMs): ClockAnchor {
  const first = required(schedule.segments[0], 'schedule.segments[0]');
  return {
    status: 'idle',
    segmentIndex: 0,
    remainingMs: first.durationMs,
    revision: 0,
    updatedAt: now,
  };
}

export function start(state: ClockState, now: EpochMs): CommandResult {
  return apply(state, now, 'start', ({ anchor, view }) => {
    if (view.status !== 'idle') fail('start', 'the clock has already started');
    return {
      anchor: compact<ClockAnchor>({
        ...anchor,
        status: 'running',
        remainingMs: undefined,
        deadline: now + view.remainingMs,
      }),
      started: [startedAt(state.schedule, anchor.segmentIndex, now)],
    };
  });
}

export function pause(state: ClockState, now: EpochMs): CommandResult {
  return apply(state, now, 'pause', ({ anchor, view }) => {
    if (view.status !== 'running') fail('pause', 'the clock is not running');
    return { anchor: frozenAt(anchor, view.remainingMs) };
  });
}

export function resume(state: ClockState, now: EpochMs): CommandResult {
  return apply(state, now, 'resume', ({ anchor, view }) => {
    if (view.status !== 'paused' && view.status !== 'awaitingHost') {
      fail('resume', 'the clock is not paused');
    }
    const deadline = now + view.remainingMs;
    // A held segment only really starts when the host resumes.
    const started =
      view.status === 'awaitingHost' ? [startedAt(state.schedule, anchor.segmentIndex, now)] : [];
    if (anchor.interlude) {
      return {
        anchor: compact<ClockAnchor>({
          ...anchor,
          status: 'running',
          holdAtIndex: undefined,
          interlude: compact<Interlude>({ ...anchor.interlude, remainingMs: undefined, deadline }),
        }),
      };
    }
    return {
      anchor: compact<ClockAnchor>({
        ...anchor,
        status: 'running',
        holdAtIndex: undefined,
        remainingMs: undefined,
        deadline,
      }),
      started,
    };
  });
}

export function next(state: ClockState, now: EpochMs): CommandResult {
  return jump(state, now, 'next', +1);
}

export function previous(state: ClockState, now: EpochMs): CommandResult {
  return jump(state, now, 'previous', -1);
}

/** Ad-hoc break outside the schedule; the current level waits with its remaining time. */
export function startBreakNow(state: ClockState, now: EpochMs, durationMs: Ms): CommandResult {
  return apply(state, now, 'startBreakNow', ({ anchor, view }) => {
    if (!(durationMs > 0)) fail('startBreakNow', 'the break needs a positive duration');
    if (view.status === 'idle') fail('startBreakNow', 'the clock has not started');
    if (view.inInterlude) fail('startBreakNow', 'a break is already in progress');
    return {
      anchor: compact<ClockAnchor>({
        ...anchor,
        status: 'running',
        deadline: undefined,
        remainingMs: undefined,
        holdAtIndex: undefined,
        interlude: { deadline: now + durationMs, resumeLevelRemainingMs: view.remainingMs },
      }),
    };
  });
}

/** Ends an ad-hoc break (level resumes) or a scheduled break (next segment starts). */
export function endBreak(state: ClockState, now: EpochMs): CommandResult {
  return apply(state, now, 'endBreak', ({ anchor, view }) => {
    if (anchor.interlude) {
      return {
        anchor: compact<ClockAnchor>({
          ...anchor,
          status: 'running',
          interlude: undefined,
          holdAtIndex: undefined,
          deadline: now + anchor.interlude.resumeLevelRemainingMs,
        }),
      };
    }
    if (!onScheduledBreak(state.schedule, anchor, view.status)) {
      fail('endBreak', 'no break is in progress');
    }
    const target = requireSegment(state.schedule, anchor.segmentIndex + 1, 'endBreak');
    return {
      anchor: runningAt(anchor, anchor.segmentIndex + 1, now + target.durationMs),
      started: [startedAt(state.schedule, anchor.segmentIndex + 1, now)],
    };
  });
}

export function extendBreak(state: ClockState, now: EpochMs, extraMs: Ms): CommandResult {
  return apply(state, now, 'extendBreak', ({ anchor, view }) => {
    if (!(extraMs > 0)) fail('extendBreak', 'the extension needs a positive duration');
    if (anchor.interlude) {
      return { anchor: { ...anchor, interlude: extended(anchor.interlude, extraMs) } };
    }
    if (!onScheduledBreak(state.schedule, anchor, view.status)) {
      fail('extendBreak', 'no break is in progress');
    }
    return { anchor: extended(anchor, extraMs) };
  });
}

export interface EditOptions {
  /** Host explicitly chose "restart this level"; otherwise elapsed time is kept. */
  restartCurrent: boolean;
  /** Module-level description of the edit for the audit log. */
  detail?: unknown;
}

/**
 * Swaps in an edited schedule (spec 03 §7). Past and current segments must keep their ids;
 * the current segment keeps its elapsed time. If the new duration is shorter than the elapsed
 * time the segment ends now (callers confirm with the host first).
 */
export function editSchedule(
  state: ClockState,
  now: EpochMs,
  schedule: Schedule,
  options: EditOptions,
): CommandResult {
  const n = normalise(state.schedule, state.anchor, now, state.options);
  const index = n.anchor.segmentIndex;
  for (let i = 0; i <= index; i += 1) {
    if (schedule.segments[i]?.id !== state.schedule.segments[i]?.id) {
      fail('editSchedule', 'past and current segments cannot change');
    }
  }
  const before = required(state.schedule.segments[index], 'segment');
  const after = required(schedule.segments[index], 'segment');
  const levelRemaining = n.anchor.interlude
    ? n.anchor.interlude.resumeLevelRemainingMs
    : n.view.remainingMs;
  // Negative when a scheduled break was extended; keeps the extension.
  const elapsed = before.durationMs - levelRemaining;
  const remaining = options.restartCurrent
    ? after.durationMs
    : Math.max(0, after.durationMs - elapsed);

  let edited: ClockAnchor;
  if (n.anchor.interlude) {
    edited = {
      ...n.anchor,
      interlude: { ...n.anchor.interlude, resumeLevelRemainingMs: remaining },
    };
  } else if (n.anchor.status === 'running') {
    edited = { ...n.anchor, deadline: now + remaining };
  } else {
    edited = { ...n.anchor, remainingMs: remaining };
  }
  edited = { ...edited, revision: state.anchor.revision + 1, updatedAt: now };

  // Re-normalise against the new schedule: a shortened running segment may end right now.
  const settled = normalise(schedule, edited, now, state.options);
  const editEvent: EventDraft = {
    type: 'schedule_edited',
    at: now,
    payload: {
      beforeScheduleId: state.schedule.id,
      afterScheduleId: schedule.id,
      segmentIndex: index,
      restartCurrent: options.restartCurrent,
      detail: options.detail,
    },
  };
  return {
    anchor: settled.anchor,
    events: [
      ...startedEvents(n.started),
      editEvent,
      ...startedEvents(settled.started),
      commandEvent('editSchedule', settled.anchor, now),
    ],
  };
}

/**
 * Recovery (spec 03 §4) uses the same `deriveClock` path as ticking. Returns null when there
 * is nothing worth persisting.
 */
export function recover(state: ClockState, now: EpochMs): CommandResult | null {
  const n = normalise(state.schedule, state.anchor, now, state.options);
  const stamp = (a: ClockAnchor): ClockAnchor => ({
    ...a,
    revision: state.anchor.revision + 1,
    updatedAt: now,
  });
  if (n.view.clockWentBackwards) {
    return {
      anchor: stamp(n.anchor),
      events: [{ type: 'clock_skew', at: now, payload: { deltaMs: now - state.anchor.updatedAt } }],
    };
  }
  const passed = n.view.passedSegmentIds;
  const interludeEnded = state.anchor.interlude !== undefined && n.anchor.interlude === undefined;
  if (passed.length === 0 && !interludeEnded) return null;
  return {
    anchor: stamp(n.anchor),
    events: [
      ...startedEvents(n.started),
      {
        type: 'recovered',
        at: now,
        payload: {
          count: passed.length,
          fromSegmentId: required(state.schedule.segments[state.anchor.segmentIndex], 'segment').id,
          toSegmentId: required(state.schedule.segments[n.anchor.segmentIndex], 'segment').id,
          gapMs: Math.max(0, now - state.anchor.updatedAt),
        },
      },
    ],
  };
}

// ── internals ────────────────────────────────────────────────────────────────

interface Change {
  anchor: ClockAnchor;
  started?: StartedSegment[];
}

function apply(
  state: ClockState,
  now: EpochMs,
  command: ClockCommandName,
  change: (n: Normalised) => Change,
): CommandResult {
  const n = normalise(state.schedule, state.anchor, now, state.options);
  const result = change(n);
  const anchor: ClockAnchor = {
    ...result.anchor,
    revision: state.anchor.revision + 1,
    updatedAt: now,
  };
  return {
    anchor,
    events: [
      ...startedEvents(n.started),
      ...startedEvents(result.started ?? []),
      commandEvent(command, anchor, now),
    ],
  };
}

function jump(
  state: ClockState,
  now: EpochMs,
  command: 'next' | 'previous',
  step: 1 | -1,
): CommandResult {
  return apply(state, now, command, ({ anchor, view }) => {
    if (view.inInterlude) fail(command, 'end the break first');
    const index = anchor.segmentIndex + step;
    const target = requireSegment(state.schedule, index, command);
    const moved =
      view.status === 'running'
        ? runningAt(anchor, index, now + target.durationMs)
        : compact<ClockAnchor>({
            ...anchor,
            status: view.status === 'idle' ? 'idle' : 'paused',
            segmentIndex: index,
            remainingMs: target.durationMs,
            holdAtIndex: undefined,
          });
    const started = view.status === 'running' ? [startedAt(state.schedule, index, now)] : [];
    return { anchor: moved, started };
  });
}

function runningAt(anchor: ClockAnchor, segmentIndex: number, deadline: EpochMs): ClockAnchor {
  return compact<ClockAnchor>({
    ...anchor,
    status: 'running',
    segmentIndex,
    deadline,
    remainingMs: undefined,
    holdAtIndex: undefined,
    interlude: undefined,
  });
}

/** Paused copy of a normalised anchor with the level (or interlude) time left. */
function frozenAt(anchor: ClockAnchor, remainingMs: Ms): ClockAnchor {
  if (anchor.interlude) {
    return compact<ClockAnchor>({
      ...anchor,
      status: 'paused',
      interlude: compact<Interlude>({ ...anchor.interlude, deadline: undefined, remainingMs }),
    });
  }
  return compact<ClockAnchor>({ ...anchor, status: 'paused', deadline: undefined, remainingMs });
}

function extended<T extends { deadline?: number | undefined; remainingMs?: number | undefined }>(
  timed: T,
  extraMs: Ms,
): T {
  return timed.deadline !== undefined
    ? { ...timed, deadline: timed.deadline + extraMs }
    : { ...timed, remainingMs: required(timed.remainingMs, 'remainingMs') + extraMs };
}

function onScheduledBreak(schedule: Schedule, anchor: ClockAnchor, status: string): boolean {
  return (
    status !== 'idle' &&
    status !== 'awaitingHost' &&
    required(schedule.segments[anchor.segmentIndex], 'segment').kind === 'break'
  );
}

function requireSegment(schedule: Schedule, index: number, command: ClockCommandName) {
  const segment = schedule.segments[index];
  if (!segment) fail(command, 'there is no segment there');
  return segment;
}

function startedAt(schedule: Schedule, segmentIndex: number, at: EpochMs): StartedSegment {
  return { segmentIndex, segmentId: required(schedule.segments[segmentIndex], 'segment').id, at };
}

function startedEvents(started: StartedSegment[]): EventDraft[] {
  return started.map(({ segmentIndex, segmentId, at }) => ({
    type: 'segment_started',
    at,
    payload: { segmentIndex, segmentId },
  }));
}

function commandEvent(command: ClockCommandName, anchor: ClockAnchor, now: EpochMs): EventDraft {
  return {
    type: 'clock_command',
    at: now,
    payload: { command, segmentIndex: anchor.segmentIndex, revision: anchor.revision },
  };
}

function fail(command: ClockCommandName, reason: string): never {
  throw new InvalidClockCommand(command, reason);
}

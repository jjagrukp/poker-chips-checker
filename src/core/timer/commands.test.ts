import { basic, schedule, segment, T0 } from '@/core/testing/schedules';
import { MINUTE, SECOND } from '@/core/time';
import type { ClockAnchor, DeriveOptions } from './anchor';
import {
  editSchedule,
  endBreak,
  extendBreak,
  initialAnchor,
  InvalidClockCommand,
  next,
  pause,
  previous,
  reanchor,
  recover,
  resume,
  start,
  startBreakNow,
  type ClockState,
} from './commands';
import { deriveClock } from './derive-clock';

const auto: DeriveOptions = { breakEndBehaviour: 'auto' };
const wait: DeriveOptions = { breakEndBehaviour: 'waitForHost' };
const state = (anchor: ClockAnchor, options: DeriveOptions = auto, sched = basic): ClockState => ({
  schedule: sched,
  anchor,
  options,
});
const view = (s: ClockState, now: number) => deriveClock(s.schedule, s.anchor, now, s.options);
const types = (events: { type: string }[]) => events.map((e) => e.type);

const idle = initialAnchor(basic, T0);
const runningFromT0 = start(state(idle), T0).anchor;

describe('initialAnchor', () => {
  it('is idle on the first segment with its full duration', () => {
    expect(idle).toEqual({
      status: 'idle',
      segmentIndex: 0,
      remainingMs: 10 * MINUTE,
      revision: 0,
      updatedAt: T0,
    });
  });

  it('rejects an empty schedule', () => {
    expect(() => initialAnchor(schedule([]), T0)).toThrow();
  });
});

describe('start / pause / resume', () => {
  it('start runs the clock and logs the first segment', () => {
    const r = start(state(idle), T0 + MINUTE);
    expect(r.anchor).toEqual({
      status: 'running',
      segmentIndex: 0,
      deadline: T0 + 11 * MINUTE,
      revision: 1,
      updatedAt: T0 + MINUTE,
    });
    expect(r.events).toEqual([
      { type: 'segment_started', at: T0 + MINUTE, payload: { segmentIndex: 0, segmentId: 'l1' } },
      {
        type: 'clock_command',
        at: T0 + MINUTE,
        payload: { command: 'start', segmentIndex: 0, revision: 1 },
      },
    ]);
  });

  it('start only works from idle', () => {
    expect(() => start(state(runningFromT0), T0)).toThrow(InvalidClockCommand);
  });

  it('pause keeps the remaining time; resume continues from it', () => {
    const paused = pause(state(runningFromT0), T0 + 3 * MINUTE).anchor;
    expect(paused).toEqual({
      status: 'paused',
      segmentIndex: 0,
      remainingMs: 7 * MINUTE,
      revision: 2,
      updatedAt: T0 + 3 * MINUTE,
    });
    expect(view(state(paused), T0 + 60 * MINUTE).remainingMs).toBe(7 * MINUTE);
    const resumed = resume(state(paused), T0 + 60 * MINUTE).anchor;
    expect(resumed).toMatchObject({ status: 'running', deadline: T0 + 67 * MINUTE, revision: 3 });
  });

  it('pause normalises first, logging segments that passed', () => {
    const r = pause(state(runningFromT0), T0 + 12 * MINUTE);
    expect(r.anchor).toMatchObject({ segmentIndex: 1, remainingMs: 8 * MINUTE });
    expect(types(r.events)).toEqual(['segment_started', 'clock_command']);
  });

  it('rejects pause when not running and resume when not paused', () => {
    expect(() => pause(state(idle), T0)).toThrow(InvalidClockCommand);
    expect(() => resume(state(idle), T0)).toThrow(InvalidClockCommand);
    expect(() => resume(state(runningFromT0), T0)).toThrow(InvalidClockCommand);
  });

  it('resume releases a host hold after a scheduled break', () => {
    const atBreak: ClockAnchor = {
      status: 'running',
      segmentIndex: 2,
      deadline: T0 + 5 * MINUTE,
      revision: 4,
      updatedAt: T0,
    };
    const s = state(atBreak, wait);
    expect(view(s, T0 + 9 * MINUTE).status).toBe('awaitingHost');
    const r = resume(s, T0 + 9 * MINUTE);
    expect(r.anchor).toEqual({
      status: 'running',
      segmentIndex: 3,
      deadline: T0 + 19 * MINUTE,
      revision: 5,
      updatedAt: T0 + 9 * MINUTE,
    });
    expect(types(r.events)).toEqual(['segment_started', 'clock_command']);
  });

  it('resume starts the next level only when the host says so (spec 11)', () => {
    const level1: ClockAnchor = {
      status: 'running',
      segmentIndex: 0,
      deadline: T0 + 10 * MINUTE,
      revision: 2,
      updatedAt: T0,
    };
    const s = state(level1, { breakEndBehaviour: 'auto', levelEndBehaviour: 'waitForHost' });
    // The hand ran four minutes over: level 2 still has its full ten minutes.
    expect(view(s, T0 + 14 * MINUTE)).toMatchObject({ status: 'awaitingHost', segmentIndex: 1 });
    const r = resume(s, T0 + 14 * MINUTE);
    expect(r.anchor).toEqual({
      status: 'running',
      segmentIndex: 1,
      deadline: T0 + 24 * MINUTE,
      revision: 3,
      updatedAt: T0 + 14 * MINUTE,
    });
    expect(types(r.events)).toEqual(['segment_started', 'clock_command']);
  });

  it('pause in overtime keeps zero remaining', () => {
    const last: ClockAnchor = {
      status: 'running',
      segmentIndex: 3,
      deadline: T0,
      revision: 1,
      updatedAt: T0 - MINUTE,
    };
    expect(pause(state(last), T0 + MINUTE).anchor).toMatchObject({
      status: 'paused',
      segmentIndex: 3,
      remainingMs: 0,
    });
  });
});

describe('segment_started logging', () => {
  it('logs a held segment when the host resumes, not when the break ended', () => {
    const atBreak: ClockAnchor = {
      status: 'running',
      segmentIndex: 2,
      deadline: T0 + 5 * MINUTE,
      revision: 1,
      updatedAt: T0,
    };
    expect(recover(state(atBreak, wait), T0 + 9 * MINUTE)?.events.map((e) => e.type)).toEqual([
      'recovered',
    ]);
    const r = resume(state(atBreak, wait), T0 + 9 * MINUTE);
    expect(r.events[0]).toEqual({
      type: 'segment_started',
      at: T0 + 9 * MINUTE,
      payload: { segmentIndex: 3, segmentId: 'l3' },
    });
  });

  it('does not log a start when moving while paused or idle', () => {
    expect(types(next(state(idle), T0).events)).toEqual(['clock_command']);
  });
});

describe('next / previous', () => {
  it('moves while running with the full target duration', () => {
    const r = next(state(runningFromT0), T0 + 2 * MINUTE);
    expect(r.anchor).toMatchObject({
      status: 'running',
      segmentIndex: 1,
      deadline: T0 + 12 * MINUTE,
    });
    expect(r.events[0]).toMatchObject({ type: 'segment_started', payload: { segmentId: 'l2' } });
    const back = previous(state(r.anchor), T0 + 3 * MINUTE);
    expect(back.anchor).toMatchObject({
      status: 'running',
      segmentIndex: 0,
      deadline: T0 + 13 * MINUTE,
    });
  });

  it('keeps idle and paused status, and clears a host hold', () => {
    expect(next(state(idle), T0).anchor).toMatchObject({
      status: 'idle',
      segmentIndex: 1,
      remainingMs: 10 * MINUTE,
    });
    const held: ClockAnchor = {
      status: 'paused',
      segmentIndex: 1,
      remainingMs: 1,
      holdAtIndex: 1,
      revision: 1,
      updatedAt: T0,
    };
    const moved = next(state(held), T0).anchor;
    expect(moved).toEqual({
      status: 'paused',
      segmentIndex: 2,
      remainingMs: 5 * MINUTE,
      revision: 2,
      updatedAt: T0,
    });
  });

  it('cannot move past either end or during an interlude', () => {
    expect(() => previous(state(idle), T0)).toThrow(InvalidClockCommand);
    const last: ClockAnchor = {
      status: 'paused',
      segmentIndex: 3,
      remainingMs: 1,
      revision: 1,
      updatedAt: T0,
    };
    expect(() => next(state(last), T0)).toThrow(InvalidClockCommand);
    const onBreak = startBreakNow(state(runningFromT0), T0, 5 * MINUTE).anchor;
    expect(() => next(state(onBreak), T0)).toThrow(InvalidClockCommand);
  });
});

describe('ad-hoc breaks', () => {
  const onBreak = startBreakNow(state(runningFromT0), T0 + 4 * MINUTE, 5 * MINUTE).anchor;

  it('startBreakNow parks the level and runs the interlude', () => {
    expect(onBreak).toEqual({
      status: 'running',
      segmentIndex: 0,
      interlude: { deadline: T0 + 9 * MINUTE, resumeLevelRemainingMs: 6 * MINUTE },
      revision: 2,
      updatedAt: T0 + 4 * MINUTE,
    });
    expect(view(state(onBreak), T0 + 6 * MINUTE)).toMatchObject({
      inInterlude: true,
      remainingMs: 3 * MINUTE,
    });
  });

  it('startBreakNow from paused clears a hold; rejects bad input', () => {
    const held: ClockAnchor = {
      status: 'paused',
      segmentIndex: 1,
      remainingMs: MINUTE,
      holdAtIndex: 1,
      revision: 1,
      updatedAt: T0,
    };
    expect(startBreakNow(state(held), T0, MINUTE).anchor).toMatchObject({
      status: 'running',
      interlude: { resumeLevelRemainingMs: MINUTE },
    });
    expect(startBreakNow(state(held), T0, MINUTE).anchor.holdAtIndex).toBeUndefined();
    expect(() => startBreakNow(state(runningFromT0), T0, 0)).toThrow(InvalidClockCommand);
    expect(() => startBreakNow(state(runningFromT0), T0, Number.NaN)).toThrow(InvalidClockCommand);
    expect(() => startBreakNow(state(idle), T0, MINUTE)).toThrow(InvalidClockCommand);
    expect(() => startBreakNow(state(onBreak), T0 + 5 * MINUTE, MINUTE)).toThrow(
      InvalidClockCommand,
    );
  });

  it('pause and resume work inside an interlude', () => {
    const paused = pause(state(onBreak), T0 + 6 * MINUTE).anchor;
    expect(paused.interlude).toEqual({
      remainingMs: 3 * MINUTE,
      resumeLevelRemainingMs: 6 * MINUTE,
    });
    const resumed = resume(state(paused), T0 + 20 * MINUTE).anchor;
    expect(resumed).toMatchObject({ status: 'running', interlude: { deadline: T0 + 23 * MINUTE } });
  });

  it('endBreak resumes the level with its parked time', () => {
    const r = endBreak(state(onBreak), T0 + 5 * MINUTE);
    expect(r.anchor).toEqual({
      status: 'running',
      segmentIndex: 0,
      deadline: T0 + 11 * MINUTE,
      revision: 3,
      updatedAt: T0 + 5 * MINUTE,
    });
  });

  it('extendBreak adds time to a running or paused interlude', () => {
    expect(extendBreak(state(onBreak), T0 + 5 * MINUTE, MINUTE).anchor.interlude).toMatchObject({
      deadline: T0 + 10 * MINUTE,
    });
    const paused = pause(state(onBreak), T0 + 6 * MINUTE).anchor;
    expect(extendBreak(state(paused), T0 + 7 * MINUTE, MINUTE).anchor.interlude).toMatchObject({
      remainingMs: 4 * MINUTE,
    });
  });
});

describe('scheduled breaks', () => {
  const onBreak: ClockAnchor = {
    status: 'running',
    segmentIndex: 2,
    deadline: T0 + 5 * MINUTE,
    revision: 1,
    updatedAt: T0,
  };

  it('endBreak starts the next segment now', () => {
    const r = endBreak(state(onBreak), T0 + MINUTE);
    expect(r.anchor).toEqual({
      status: 'running',
      segmentIndex: 3,
      deadline: T0 + 11 * MINUTE,
      revision: 2,
      updatedAt: T0 + MINUTE,
    });
    expect(r.events[0]).toMatchObject({ type: 'segment_started', payload: { segmentId: 'l3' } });
  });

  it('endBreak from a paused break also starts play', () => {
    const paused = pause(state(onBreak), T0).anchor;
    expect(endBreak(state(paused), T0 + MINUTE).anchor).toMatchObject({
      status: 'running',
      segmentIndex: 3,
    });
  });

  it('extendBreak pushes the deadline or remaining time', () => {
    expect(extendBreak(state(onBreak), T0, 2 * MINUTE).anchor.deadline).toBe(T0 + 7 * MINUTE);
    const paused = pause(state(onBreak), T0).anchor;
    expect(extendBreak(state(paused), T0, 2 * MINUTE).anchor.remainingMs).toBe(7 * MINUTE);
  });

  it('rejects break commands outside a break', () => {
    expect(() => endBreak(state(runningFromT0), T0)).toThrow(InvalidClockCommand);
    expect(() => extendBreak(state(runningFromT0), T0, MINUTE)).toThrow(InvalidClockCommand);
    expect(() => extendBreak(state(onBreak), T0, -1)).toThrow(InvalidClockCommand);
    const idleOnBreak: ClockAnchor = {
      status: 'idle',
      segmentIndex: 2,
      remainingMs: 1,
      revision: 0,
      updatedAt: T0,
    };
    expect(() => endBreak(state(idleOnBreak), T0)).toThrow(InvalidClockCommand);
  });

  it('cannot end a break that is the final segment', () => {
    const endsOnBreak = schedule([segment('l1', 'level', 10), segment('b1', 'break', 5)]);
    const anchor: ClockAnchor = {
      status: 'running',
      segmentIndex: 1,
      deadline: T0 + MINUTE,
      revision: 1,
      updatedAt: T0,
    };
    expect(() => endBreak(state(anchor, auto, endsOnBreak), T0)).toThrow(InvalidClockCommand);
  });
});

describe('editSchedule', () => {
  const longer = schedule(
    [
      segment('l1', 'level', 15),
      segment('l2', 'level', 10),
      segment('b1', 'break', 5),
      segment('l3', 'level', 10),
    ],
    'sched-2',
  );
  const shorter = schedule([segment('l1', 'level', 2), ...basic.segments.slice(1)], 'sched-3');

  it('keeps elapsed time when the current duration changes', () => {
    const r = editSchedule(state(runningFromT0), T0 + 4 * MINUTE, longer, {
      restartCurrent: false,
      detail: { field: 'duration' },
    });
    expect(r.anchor).toMatchObject({ segmentIndex: 0, deadline: T0 + 15 * MINUTE, revision: 2 });
    expect(r.events).toContainEqual({
      type: 'schedule_edited',
      at: T0 + 4 * MINUTE,
      payload: {
        beforeScheduleId: 'sched-1',
        afterScheduleId: 'sched-2',
        segmentIndex: 0,
        restartCurrent: false,
        detail: { field: 'duration' },
      },
    });
  });

  it('restarts the current segment on request', () => {
    const r = editSchedule(state(runningFromT0), T0 + 4 * MINUTE, longer, { restartCurrent: true });
    expect(r.anchor.deadline).toBe(T0 + 19 * MINUTE);
  });

  it('ends the current segment now when the new duration is shorter than elapsed', () => {
    const r = editSchedule(state(runningFromT0), T0 + 4 * MINUTE, shorter, {
      restartCurrent: false,
    });
    expect(r.anchor).toMatchObject({ segmentIndex: 1, deadline: T0 + 14 * MINUTE });
    expect(types(r.events)).toEqual(['schedule_edited', 'segment_started', 'clock_command']);
  });

  it('adjusts paused time and parked interlude time', () => {
    const paused = pause(state(runningFromT0), T0 + 4 * MINUTE).anchor;
    expect(
      editSchedule(state(paused), T0 + 9 * MINUTE, longer, { restartCurrent: false }).anchor
        .remainingMs,
    ).toBe(11 * MINUTE);
    const onBreak = startBreakNow(state(runningFromT0), T0 + 4 * MINUTE, 5 * MINUTE).anchor;
    const edited = editSchedule(state(onBreak), T0 + 5 * MINUTE, longer, {
      restartCurrent: false,
    }).anchor;
    expect(edited.interlude).toEqual({
      deadline: T0 + 9 * MINUTE,
      resumeLevelRemainingMs: 11 * MINUTE,
    });
  });

  it('keeps a scheduled break extension when a later segment is edited', () => {
    const onBreak: ClockAnchor = {
      status: 'running',
      segmentIndex: 2,
      deadline: T0 + 5 * MINUTE,
      revision: 1,
      updatedAt: T0,
    };
    const extendedBreak = extendBreak(state(onBreak), T0, 3 * MINUTE).anchor;
    const laterEdit = schedule(
      [...basic.segments.slice(0, 3), segment('l3', 'level', 20)],
      'sched-5',
    );
    const r = editSchedule(state(extendedBreak), T0 + MINUTE, laterEdit, { restartCurrent: false });
    expect(r.anchor.deadline).toBe(T0 + 8 * MINUTE);
  });

  it('resolves overtime when levels are added', () => {
    const overtime: ClockAnchor = {
      status: 'running',
      segmentIndex: 3,
      deadline: T0,
      revision: 1,
      updatedAt: T0 - MINUTE,
    };
    const extended = schedule([...basic.segments, segment('l4', 'level', 10)], 'sched-4');
    const r = editSchedule(state(overtime), T0 + 3 * MINUTE, extended, { restartCurrent: false });
    expect(r.anchor).toMatchObject({ segmentIndex: 4, deadline: T0 + 13 * MINUTE });
    expect(view(state(r.anchor, auto, extended), T0 + 3 * MINUTE).overtimeMs).toBe(0);
    expect(types(r.events)).toEqual(['schedule_edited', 'segment_started', 'clock_command']);
  });

  it('refuses edits to past or current segment identity', () => {
    const later = next(state(runningFromT0), T0).anchor;
    const rewritten = schedule([segment('x1', 'level', 10), ...basic.segments.slice(1)]);
    expect(() => editSchedule(state(later), T0, rewritten, { restartCurrent: false })).toThrow(
      InvalidClockCommand,
    );
    const truncated = schedule([segment('l1', 'level', 10)]);
    expect(() => editSchedule(state(later), T0, truncated, { restartCurrent: false })).toThrow(
      InvalidClockCommand,
    );
  });
});

describe('recover', () => {
  it('returns null when nothing passed', () => {
    expect(recover(state(runningFromT0), T0 + MINUTE)).toBeNull();
    expect(recover(state(idle), T0 + 99 * MINUTE)).toBeNull();
  });

  it('persists the caught-up anchor with one recovered event', () => {
    const r = recover(state(runningFromT0), T0 + 27 * MINUTE);
    expect(r?.anchor).toMatchObject({
      segmentIndex: 3,
      deadline: T0 + 35 * MINUTE,
      revision: 2,
      updatedAt: T0 + 27 * MINUTE,
    });
    expect(r?.events.at(-1)).toEqual({
      type: 'recovered',
      at: T0 + 27 * MINUTE,
      payload: { count: 3, fromSegmentId: 'l1', toSegmentId: 'l3', gapMs: 27 * MINUTE },
    });
    expect(types(r?.events ?? [])).toEqual([
      'segment_started',
      'segment_started',
      'segment_started',
      'recovered',
    ]);
    // Recovering again from the persisted anchor is a no-op.
    if (!r) throw new Error('expected a recovery');
    expect(recover(state(r.anchor), T0 + 27 * MINUTE + SECOND)).toBeNull();
  });

  it('persists when an ad-hoc break ended during the gap', () => {
    const onBreak = startBreakNow(state(runningFromT0), T0 + MINUTE, 5 * MINUTE).anchor;
    const r = recover(state(onBreak, wait), T0 + 30 * MINUTE);
    expect(r?.anchor).toMatchObject({ status: 'paused', holdAtIndex: 0, remainingMs: 9 * MINUTE });
    expect(r?.events.at(-1)).toMatchObject({ type: 'recovered', payload: { count: 0 } });
  });

  it('pauses and records clock skew when the clock went backwards', () => {
    const r = recover(state(runningFromT0), T0 - MINUTE);
    expect(r?.anchor).toMatchObject({
      status: 'paused',
      remainingMs: 10 * MINUTE,
      updatedAt: T0 - MINUTE,
    });
    expect(r?.events).toEqual([
      { type: 'clock_skew', at: T0 - MINUTE, payload: { deltaMs: -MINUTE } },
    ]);
  });
});

describe('reanchor', () => {
  it('keeps the time left when the device clock jumps forward', () => {
    // At T0+1m the wall clock jumps 1h ahead; only 1 minute really passed.
    const r = reanchor(state(runningFromT0), T0 + 61 * MINUTE, 60 * MINUTE);
    expect(r.anchor).toMatchObject({
      status: 'running',
      segmentIndex: 0,
      deadline: T0 + 70 * MINUTE,
      revision: 2,
      updatedAt: T0 + 61 * MINUTE,
    });
    expect(view(state(r.anchor), T0 + 61 * MINUTE).remainingMs).toBe(9 * MINUTE);
    expect(r.events).toEqual([
      { type: 'clock_skew', at: T0 + 61 * MINUTE, payload: { deltaMs: 60 * MINUTE } },
    ]);
  });

  it('keeps running when the clock jumps backwards, and shifts an ad-hoc break', () => {
    const onBreak = startBreakNow(state(runningFromT0), T0 + MINUTE, 5 * MINUTE).anchor;
    const r = reanchor(state(onBreak), T0 - 58 * MINUTE, -60 * MINUTE);
    expect(r.anchor).toMatchObject({
      status: 'running',
      interlude: { deadline: T0 - 54 * MINUTE, resumeLevelRemainingMs: 9 * MINUTE },
    });
    expect(view(state(r.anchor), T0 - 58 * MINUTE).remainingMs).toBe(4 * MINUTE);
  });

  it('leaves paused anchors untouched apart from the stamp', () => {
    const paused = pause(state(runningFromT0), T0 + MINUTE).anchor;
    const r = reanchor(state(paused), T0 + 90 * MINUTE, 80 * MINUTE);
    expect(r.anchor).toEqual({ ...paused, revision: paused.revision + 1, updatedAt: T0 + 90 * MINUTE });
  });
});

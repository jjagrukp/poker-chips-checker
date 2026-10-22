import { EventDraftSchema } from '@/core/events/events';
import { basic, segment, T0 } from '@/core/testing/schedules';
import { MINUTE } from '@/core/time';
import { pause, start } from '@/core/timer/commands';
import { emptyReport } from '@/core/validation/report';
import {
  applyClockCommand,
  applyScheduleEdit,
  canTransition,
  InvalidTransition,
  transition,
  TRANSITIONS,
} from './lifecycle';
import { LifecycleActionSchema, TournamentStatusSchema, type TournamentStatus } from './status';
import { TournamentSchema, type Tournament } from './tournament';

const draft: Tournament = {
  id: 't1',
  schemaVersion: 1,
  moduleId: 'test',
  moduleVersion: '1',
  status: 'draft',
  config: {},
  scheduleId: basic.id,
  allocation: undefined,
  participants: { count: 8, remaining: 8 },
  settings: { breakEndBehaviour: 'auto' },
  createdAt: T0,
  updatedAt: T0,
};
const ok = { schedule: basic, config: emptyReport(), scheduleReport: emptyReport() };
const withStatus = (status: TournamentStatus): Tournament => ({ ...draft, status });

describe('lifecycle', () => {
  it('allows exactly the transitions in the table', () => {
    const allowed = new Set(
      Object.entries(TRANSITIONS).flatMap(([action, { from }]) =>
        (from as readonly string[]).map((f) => `${f}:${action}`),
      ),
    );
    for (const status of TournamentStatusSchema.options) {
      for (const action of LifecycleActionSchema.options) {
        expect(canTransition(status, action)).toBe(allowed.has(`${status}:${action}`));
      }
    }
    expect(allowed).toEqual(
      new Set([
        'draft:markReady',
        'ready:edit',
        'ready:start',
        'active:complete',
        'draft:cancel',
        'ready:cancel',
        'active:cancel',
      ]),
    );
  });

  it('throws InvalidTransition for anything else', () => {
    expect(() => transition(withStatus('completed'), { action: 'cancel' }, T0)).toThrow(
      InvalidTransition,
    );
    expect(() => transition(withStatus('draft'), { action: 'start', schedule: basic }, T0)).toThrow(
      'Cannot start a draft tournament',
    );
  });

  it('draft → ready requires a generated schedule and error-free reports', () => {
    const r = transition(draft, { action: 'markReady', readiness: ok }, T0 + 1);
    expect(r.tournament).toMatchObject({ status: 'ready', updatedAt: T0 + 1 });
    expect(r.events).toEqual([
      {
        type: 'lifecycle_transition',
        at: T0 + 1,
        payload: { action: 'markReady', from: 'draft', to: 'ready' },
      },
    ]);
    const warnOnly = { errors: [], warnings: [{ code: 'w', messageKey: 'w' }] };
    expect(
      transition(draft, { action: 'markReady', readiness: { ...ok, config: warnOnly } }, T0)
        .tournament.status,
    ).toBe('ready');

    const failing = { errors: [{ code: 'e', messageKey: 'e' }], warnings: [] };
    expect(() =>
      transition(draft, { action: 'markReady', readiness: { ...ok, allocation: failing } }, T0),
    ).toThrow('validation errors remain');
    expect(() =>
      transition({ ...draft, scheduleId: 'other' }, { action: 'markReady', readiness: ok }, T0),
    ).toThrow('schedule has not been generated');
  });

  it('ready → active starts an idle clock; ready → draft for edits', () => {
    const ready = withStatus('ready');
    const r = transition(ready, { action: 'start', schedule: basic }, T0 + 5);
    expect(r.tournament).toMatchObject({
      status: 'active',
      startedAt: T0 + 5,
      clock: { status: 'idle', segmentIndex: 0 },
    });
    expect(() =>
      transition({ ...ready, scheduleId: 'other' }, { action: 'start', schedule: basic }, T0),
    ).toThrow(InvalidTransition);
    expect(transition(ready, { action: 'edit' }, T0).tournament.status).toBe('draft');
  });

  it('complete and cancel record endedAt', () => {
    expect(
      transition(withStatus('active'), { action: 'complete' }, T0 + 9).tournament,
    ).toMatchObject({ status: 'completed', endedAt: T0 + 9 });
    expect(transition(draft, { action: 'cancel' }, T0 + 9).tournament).toMatchObject({
      status: 'cancelled',
      endedAt: T0 + 9,
    });
  });

  it('every produced tournament and event passes its schema', () => {
    const ready = transition(draft, { action: 'markReady', readiness: ok }, T0);
    const active = transition(ready.tournament, { action: 'start', schedule: basic }, T0);
    const running = applyClockCommand(active.tournament, basic, T0, start);
    for (const r of [ready, active, running]) {
      expect(TournamentSchema.parse(r.tournament)).toBeTruthy();
      r.events.forEach((e) => expect(EventDraftSchema.parse(e)).toEqual(e));
    }
  });
});

describe('applyClockCommand', () => {
  it('only runs clock commands on active tournaments', () => {
    expect(() => applyClockCommand(withStatus('ready'), basic, T0, start)).toThrow(
      InvalidTransition,
    );
    expect(() => applyClockCommand(withStatus('active'), basic, T0, start)).toThrow(
      InvalidTransition,
    );
  });

  it('applies the command with the tournament settings', () => {
    const active = transition(
      withStatus('ready'),
      { action: 'start', schedule: basic },
      T0,
    ).tournament;
    const running = applyClockCommand(active, basic, T0, start).tournament;
    const paused = applyClockCommand(running, basic, T0 + 3 * MINUTE, pause);
    expect(paused.tournament).toMatchObject({
      updatedAt: T0 + 3 * MINUTE,
      clock: { status: 'paused', remainingMs: 7 * MINUTE },
    });
    expect(paused.events.at(-1)).toMatchObject({
      type: 'clock_command',
      payload: { command: 'pause' },
    });
  });
});

describe('applyScheduleEdit', () => {
  const active = transition(
    withStatus('ready'),
    { action: 'start', schedule: basic },
    T0,
  ).tournament;
  const running = applyClockCommand(active, basic, T0, start).tournament;

  it('rejects a schedule that is not the tournament snapshot', () => {
    const other = { ...basic, id: 'other' };
    expect(() => applyClockCommand(running, other, T0, pause)).toThrow('schedule does not belong');
  });

  it('moves the tournament onto the edited schedule so it reloads consistently', () => {
    const overtime = {
      ...running,
      clock: {
        status: 'running' as const,
        segmentIndex: 3,
        deadline: T0,
        revision: 1,
        updatedAt: T0 - MINUTE,
      },
    };
    const extended = {
      ...basic,
      id: 'sched-2',
      segments: [...basic.segments, segment('l4', 'level', 10)],
    };
    const r = applyScheduleEdit(overtime, basic, extended, T0 + MINUTE, { restartCurrent: false });
    expect(r.tournament).toMatchObject({ scheduleId: 'sched-2', clock: { segmentIndex: 4 } });
    expect(() => applyClockCommand(r.tournament, extended, T0 + 2 * MINUTE, pause)).not.toThrow();
    expect(() => applyClockCommand(r.tournament, basic, T0 + 2 * MINUTE, pause)).toThrow(
      InvalidTransition,
    );
  });
});

describe('TournamentSchema', () => {
  it('rejects more remaining players than entrants', () => {
    expect(
      TournamentSchema.safeParse({ ...draft, participants: { count: 2, remaining: 3 } }).success,
    ).toBe(false);
  });
});

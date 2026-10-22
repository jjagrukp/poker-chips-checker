import type { EventDraft } from '@/core/events/events';
import type { Schedule } from '@/core/scheduling/schedule';
import type { EpochMs } from '@/core/time';
import { freeze, normalise } from '@/core/timer/derive-clock';
import {
  editSchedule,
  initialAnchor,
  type ClockState,
  type CommandResult,
  type EditOptions,
} from '@/core/timer/commands';
import { emptyReport, isValid, type ValidationReport } from '@/core/validation/report';
import type { LifecycleAction, TournamentStatus } from './status';
import type { Tournament } from './tournament';

// The single lifecycle service (spec 02 §5). Pure: callers persist the result.

export const TRANSITIONS = {
  markReady: { from: ['draft'], to: 'ready' },
  edit: { from: ['ready'], to: 'draft' },
  start: { from: ['ready'], to: 'active' },
  complete: { from: ['active'], to: 'completed' },
  cancel: { from: ['draft', 'ready', 'active'], to: 'cancelled' },
} as const satisfies Record<
  LifecycleAction,
  { from: readonly TournamentStatus[]; to: TournamentStatus }
>;

export class InvalidTransition extends Error {
  constructor(
    readonly from: TournamentStatus,
    readonly action: LifecycleAction | 'clockCommand',
    reason?: string,
  ) {
    super(`Cannot ${action} a ${from} tournament${reason ? `: ${reason}` : ''}`);
    this.name = 'InvalidTransition';
  }
}

/** Everything draft→ready depends on (spec 02 §5); every report must be error-free. */
export interface Readiness {
  schedule: Schedule;
  config: ValidationReport;
  scheduleReport: ValidationReport;
  /** Omit only when the module has no `allocate`. */
  allocation?: ValidationReport;
}

export type TransitionInput =
  | { action: 'markReady'; readiness: Readiness }
  | { action: 'start'; schedule: Schedule }
  /** With the schedule, a started clock is frozen at `now` so it stops counting. */
  | { action: 'complete' | 'cancel'; schedule?: Schedule }
  | { action: 'edit' };

export interface TransitionResult {
  tournament: Tournament;
  events: EventDraft[];
}

export function canTransition(status: TournamentStatus, action: LifecycleAction): boolean {
  return (TRANSITIONS[action].from as readonly TournamentStatus[]).includes(status);
}

export function transition(t: Tournament, input: TransitionInput, now: EpochMs): TransitionResult {
  const { action } = input;
  if (!canTransition(t.status, action)) throw new InvalidTransition(t.status, action);
  const to = TRANSITIONS[action].to;
  let next: Tournament = { ...t, status: to, updatedAt: now };
  const events: EventDraft[] = [];

  switch (input.action) {
    case 'markReady': {
      const { schedule, config, scheduleReport, allocation = emptyReport() } = input.readiness;
      if (schedule.id !== t.scheduleId) {
        throw new InvalidTransition(t.status, action, 'schedule has not been generated');
      }
      if (![config, scheduleReport, allocation].every(isValid)) {
        throw new InvalidTransition(t.status, action, 'validation errors remain');
      }
      break;
    }
    case 'start':
      if (input.schedule.id !== t.scheduleId) {
        throw new InvalidTransition(t.status, action, 'schedule does not belong to tournament');
      }
      next = { ...next, startedAt: now, clock: initialAnchor(input.schedule, now) };
      break;
    case 'complete':
    case 'cancel':
      next = { ...next, endedAt: now };
      if (t.clock && input.schedule) {
        if (input.schedule.id !== t.scheduleId) {
          throw new InvalidTransition(t.status, action, 'schedule does not belong to tournament');
        }
        const n = normalise(input.schedule, t.clock, now, {
          breakEndBehaviour: t.settings.breakEndBehaviour,
        });
        const clock = { ...freeze(n.anchor, now), revision: t.clock.revision + 1, updatedAt: now };
        next = { ...next, clock };
        events.push(
          ...n.started.map(({ segmentIndex, segmentId, at }): EventDraft => ({
            type: 'segment_started',
            at,
            payload: { segmentIndex, segmentId },
          })),
        );
      }
      break;
    case 'edit':
      break;
  }

  return {
    tournament: next,
    events: [
      ...events,
      { type: 'lifecycle_transition', at: now, payload: { action, from: t.status, to } },
    ],
  };
}

/** Clock commands are only valid while the tournament is active. */
export function applyClockCommand(
  t: Tournament,
  schedule: Schedule,
  now: EpochMs,
  command: (state: ClockState, now: EpochMs) => CommandResult,
): TransitionResult {
  const result = command(clockState(t, schedule), now);
  return { tournament: { ...t, clock: result.anchor, updatedAt: now }, events: result.events };
}

/** Swaps the tournament onto an edited schedule snapshot while it is running (spec 03 §7). */
export function applyScheduleEdit(
  t: Tournament,
  current: Schedule,
  edited: Schedule,
  now: EpochMs,
  options: EditOptions,
): TransitionResult {
  const result = editSchedule(clockState(t, current), now, edited, options);
  return {
    tournament: { ...t, scheduleId: edited.id, clock: result.anchor, updatedAt: now },
    events: result.events,
  };
}

function clockState(t: Tournament, schedule: Schedule): ClockState {
  if (t.status !== 'active' || !t.clock) throw new InvalidTransition(t.status, 'clockCommand');
  if (schedule.id !== t.scheduleId) {
    throw new InvalidTransition(t.status, 'clockCommand', 'schedule does not belong to tournament');
  }
  return {
    schedule,
    anchor: t.clock,
    options: { breakEndBehaviour: t.settings.breakEndBehaviour },
  };
}

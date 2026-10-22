import { z } from 'zod';

const epoch = z.number().int();
const ms = z.number().int().nonnegative();

/** Ad-hoc break outside the schedule. The level is effectively paused meanwhile. */
export const InterludeSchema = z.object({
  deadline: epoch.optional(),
  remainingMs: ms.optional(),
  resumeLevelRemainingMs: ms,
});
export type Interlude = z.infer<typeof InterludeSchema>;

/**
 * The only persisted clock state; everything else is derived by `deriveClock`.
 * running → `deadline` is set; paused/idle → `remainingMs` is set. When an interlude is
 * present those fields describe the interlude instead and the level waits at
 * `interlude.resumeLevelRemainingMs`. `holdAtIndex === segmentIndex` on a paused anchor
 * means the host must press Resume after a break (`awaitingHost`).
 */
export const ClockAnchorSchema = z
  .object({
    status: z.enum(['idle', 'running', 'paused']),
    segmentIndex: z.number().int().nonnegative(),
    deadline: epoch.optional(),
    remainingMs: ms.optional(),
    interlude: InterludeSchema.optional(),
    holdAtIndex: z.number().int().nonnegative().optional(),
    revision: z.number().int().nonnegative(),
    updatedAt: epoch,
  })
  .refine(hasTimeForStatus, 'Anchor is missing the time field its status requires');
export type ClockAnchor = z.infer<typeof ClockAnchorSchema>;

export type BreakEndBehaviour = 'auto' | 'waitForHost';

export interface DeriveOptions {
  breakEndBehaviour: BreakEndBehaviour;
}

export const CLOCK_COMMANDS = [
  'start',
  'pause',
  'resume',
  'next',
  'previous',
  'startBreakNow',
  'endBreak',
  'extendBreak',
  'editSchedule',
] as const;
export const ClockCommandNameSchema = z.enum(CLOCK_COMMANDS);
export type ClockCommandName = z.infer<typeof ClockCommandNameSchema>;

/** Exactly the time field its status needs, and no conflicting ones. */
function hasTimeForStatus(a: {
  status: 'idle' | 'running' | 'paused';
  deadline?: number | undefined;
  remainingMs?: number | undefined;
  interlude?: Interlude | undefined;
}): boolean {
  if (a.interlude) {
    if (a.status === 'idle' || a.deadline !== undefined || a.remainingMs !== undefined)
      return false;
  }
  const timed = a.interlude ?? a;
  const running = a.status === 'running';
  return (
    (timed.deadline !== undefined) === running && (timed.remainingMs !== undefined) === !running
  );
}

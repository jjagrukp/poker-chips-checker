import { z } from 'zod';
import { ClockCommandNameSchema } from '@/core/timer/anchor';
import { LifecycleActionSchema, TournamentStatusSchema } from '@/core/tournaments/status';

// Audit log (spec 03 §8): used for results and debugging, never to rebuild state (D4).
export const EVENT_SCHEMA_VERSION = 1;

const at = z.number().int();
const index = z.number().int().nonnegative();
const count = z.number().int().nonnegative();

export const EventDraftSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('lifecycle_transition'),
    at,
    payload: z.object({
      action: LifecycleActionSchema,
      from: TournamentStatusSchema,
      to: TournamentStatusSchema,
    }),
  }),
  z.object({
    type: z.literal('clock_command'),
    at,
    payload: z.object({ command: ClockCommandNameSchema, segmentIndex: index, revision: count }),
  }),
  z.object({
    type: z.literal('segment_started'),
    at,
    payload: z.object({ segmentIndex: index, segmentId: z.string() }),
  }),
  z.object({
    type: z.literal('recovered'),
    at,
    payload: z.object({
      count,
      fromSegmentId: z.string(),
      toSegmentId: z.string(),
      gapMs: count,
    }),
  }),
  z.object({
    type: z.literal('clock_skew'),
    at,
    payload: z.object({ deltaMs: z.number().int() }),
  }),
  z.object({
    type: z.literal('schedule_edited'),
    at,
    payload: z.object({
      beforeScheduleId: z.string(),
      afterScheduleId: z.string(),
      segmentIndex: index,
      restartCurrent: z.boolean(),
      /** Module-level detail of the edit (preview diff), opaque to core. */
      detail: z.unknown(),
    }),
  }),
  z.object({
    type: z.literal('participants_changed'),
    at,
    payload: z.object({ count, remaining: count }),
  }),
]);
/** An event before the repository assigns its identity and sequence number. */
export type EventDraft = z.infer<typeof EventDraftSchema>;
export type EventType = EventDraft['type'];

export const TournamentEventSchema = z
  .object({
    id: z.string().min(1),
    tournamentId: z.string().min(1),
    seq: index,
    schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  })
  .and(EventDraftSchema);
export type TournamentEvent = z.infer<typeof TournamentEventSchema>;

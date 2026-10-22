import { z } from 'zod';

export const SCHEDULE_SCHEMA_VERSION = 1;

export const DisplayLineSchema = z.object({ label: z.string(), value: z.string() });
export type DisplayLine = z.infer<typeof DisplayLineSchema>;

export const SegmentSchema = z.object({
  /** Stable across edits; used for alert dedupe and event payloads. */
  id: z.string().min(1),
  kind: z.enum(['level', 'break']),
  durationMs: z.number().int().positive(),
  /** 'level' only, 1-based. */
  levelNumber: z.number().int().positive().optional(),
  /** Module-rendered; core never interprets it. */
  display: z.object({ title: z.string(), lines: z.array(DisplayLineSchema) }),
  /** Module-owned payload (e.g. blinds), opaque to core. */
  data: z.unknown(),
  /** Module marks the projected finishing level. */
  estimatedFinish: z.boolean().optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;
export type SegmentKind = Segment['kind'];

export const ScheduleSchema = z.object({
  id: z.string().min(1),
  moduleId: z.string().min(1),
  moduleVersion: z.string().min(1),
  generatorVersion: z.string().min(1),
  segments: z
    .array(SegmentSchema)
    .min(1)
    .refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'Segment ids must be unique'),
  createdAt: z.number().int().nonnegative(),
  schemaVersion: z.literal(SCHEDULE_SCHEMA_VERSION),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

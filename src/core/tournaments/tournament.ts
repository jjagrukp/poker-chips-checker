import { z } from 'zod';
import { ClockAnchorSchema } from '@/core/timer/anchor';
import { TournamentStatusSchema } from './status';

export const TOURNAMENT_SCHEMA_VERSION = 1;

const epoch = z.number().int();
const count = z.number().int().nonnegative();

export const TournamentSettingsSchema = z.object({
  breakEndBehaviour: z.enum(['auto', 'waitForHost']),
});
export type TournamentSettings = z.infer<typeof TournamentSettingsSchema>;

// Refined in M8 (results).
export const TournamentResultsSchema = z.object({
  positions: z.array(z.object({ place: z.number().int().positive(), name: z.string().optional() })),
  actualDurationMs: count.optional(),
});
export type TournamentResults = z.infer<typeof TournamentResultsSchema>;

export const TournamentSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(TOURNAMENT_SCHEMA_VERSION),
  name: z.string().optional(),
  moduleId: z.string().min(1),
  moduleVersion: z.string().min(1),
  status: TournamentStatusSchema,
  /** Module config, validated by the module's own schema. */
  config: z.unknown(),
  scheduleId: z.string().optional(),
  inventoryId: z.string().optional(),
  /** AllocationResult is owned by chip-inventory/domain (M3); opaque to core. */
  allocation: z.unknown(),
  participants: z
    .object({ count, remaining: count, names: z.array(z.string()).optional() })
    .refine((p) => p.remaining <= p.count, 'remaining cannot exceed count'),
  clock: ClockAnchorSchema.optional(),
  settings: TournamentSettingsSchema,
  results: TournamentResultsSchema.optional(),
  createdAt: epoch,
  updatedAt: epoch,
  startedAt: epoch.optional(),
  endedAt: epoch.optional(),
});
export type Tournament = z.infer<typeof TournamentSchema>;

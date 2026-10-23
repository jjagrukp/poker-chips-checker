import { z } from 'zod';
import { ClockAnchorSchema, type DeriveOptions } from '@/core/timer/anchor';
import { TournamentStatusSchema } from './status';

export const TOURNAMENT_SCHEMA_VERSION = 1;

const epoch = z.number().int();
const count = z.number().int().nonnegative();

export const TournamentSettingsSchema = z.object({
  breakEndBehaviour: z.enum(['auto', 'waitForHost']),
  /** Absent (tournaments made before D45) means auto; setup writes it for new ones. */
  levelEndBehaviour: z.enum(['auto', 'waitForHost']).optional(),
  /** Show the module's reference panel (Hold'em: hand rankings) beside a big-screen clock (D44). */
  showReference: z.boolean().optional(),
  /** Background music on the shared TV (spec 12, D46). Absent means none. */
  music: z
    .object({
      videoId: z.string().regex(/^[\w-]{11}$/).optional(),
      listId: z.string().regex(/^[\w-]{2,64}$/).optional(),
      playing: z.boolean(),
      volume: z.number().int().min(0).max(100),
      shuffle: z.boolean(),
      /** Bumped by each "Next"; a screen skips when it sees it go up. */
      skips: count,
    })
    .refine((m) => m.videoId !== undefined || m.listId !== undefined, 'Needs a video or playlist')
    .optional(),
});
export type MusicSettings = NonNullable<TournamentSettings['music']>;
export type TournamentSettings = z.infer<typeof TournamentSettingsSchema>;

/** Finishing positions (optional names; place 1 is the winner) and the host-editable duration. */
export const TournamentResultsSchema = z.object({
  positions: z
    .array(z.object({ place: z.number().int().positive(), name: z.string().optional() }))
    .refine((p) => new Set(p.map((x) => x.place)).size === p.length, 'Places must be unique'),
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
  /** Alert keys already fired, so a refresh or another tab never repeats one (spec 03 §6.2). */
  firedAlerts: z.array(z.string()).optional(),
  settings: TournamentSettingsSchema,
  results: TournamentResultsSchema.optional(),
  /** Informational countdown only; never auto-starts (spec 01 §5). */
  plannedStartAt: epoch.optional(),
  /** Setup-wizard working state, owned and parsed by features/tournament-setup (D23). */
  setupDraft: z.unknown().optional(),
  createdAt: epoch,
  updatedAt: epoch,
  startedAt: epoch.optional(),
  endedAt: epoch.optional(),
});
export type Tournament = z.infer<typeof TournamentSchema>;

/** The clock options a tournament runs with; every caller derives through this (D45). */
export function deriveOptions(tournament: Pick<Tournament, 'settings'>): DeriveOptions {
  return {
    breakEndBehaviour: tournament.settings.breakEndBehaviour,
    levelEndBehaviour: tournament.settings.levelEndBehaviour ?? 'auto',
  };
}

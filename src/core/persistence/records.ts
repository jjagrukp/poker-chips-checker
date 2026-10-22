import { z } from 'zod';
import { EVENT_SCHEMA_VERSION, TournamentEventSchema } from '@/core/events/events';
import { SCHEDULE_SCHEMA_VERSION, ScheduleSchema } from '@/core/scheduling/schedule';
import { TOURNAMENT_SCHEMA_VERSION, TournamentSchema } from '@/core/tournaments/tournament';
import type { RecordType } from './migrations';

const epoch = z.number().int();

export const PRESET_SCHEMA_VERSION = 1;

// Refined in M8 (presets). `presetVersion` is the preset's own content version (spec 02 §7.3).
export const PresetSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(PRESET_SCHEMA_VERSION),
  name: z.string().min(1),
  moduleId: z.string().min(1),
  moduleVersion: z.string().min(1),
  presetVersion: z.number().int().positive(),
  config: z.unknown(),
  createdAt: epoch,
  updatedAt: epoch,
});
export type Preset = z.infer<typeof PresetSchema>;

export const SETTINGS_SCHEMA_VERSION = 1;
export const SETTINGS_ID = 'app';

export const StoragePersistenceSchema = z.enum(['granted', 'denied', 'unsupported']);
export type StoragePersistence = z.infer<typeof StoragePersistenceSchema>;

export const SettingsSchema = z.object({
  id: z.literal(SETTINGS_ID),
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  tone: z.enum(['playful', 'neutral']).optional(),
  /** Result of `navigator.storage.persist()`, shown in Settings (spec 02 §7.6). */
  storagePersistence: StoragePersistenceSchema.optional(),
  durabilityNoticeDismissedAt: epoch.optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return { id: SETTINGS_ID, schemaVersion: SETTINGS_SCHEMA_VERSION };
}

/** A record that failed to migrate or parse, kept verbatim so it can be exported (spec 02 §7.4). */
export const QuarantineEntrySchema = z.object({
  id: z.string().min(1),
  store: z.string().min(1),
  key: z.string().optional(),
  raw: z.unknown(),
  error: z.string(),
  quarantinedAt: epoch,
});
export type QuarantineEntry = z.infer<typeof QuarantineEntrySchema>;

// No migrations yet: every record type is still at v1.
export const tournamentRecord: RecordType<z.infer<typeof TournamentSchema>> = {
  name: 'tournament',
  version: TOURNAMENT_SCHEMA_VERSION,
  schema: TournamentSchema,
  migrations: {},
};

export const scheduleRecord: RecordType<z.infer<typeof ScheduleSchema>> = {
  name: 'schedule',
  version: SCHEDULE_SCHEMA_VERSION,
  schema: ScheduleSchema,
  migrations: {},
};

export const eventRecord: RecordType<z.infer<typeof TournamentEventSchema>> = {
  name: 'event',
  version: EVENT_SCHEMA_VERSION,
  schema: TournamentEventSchema,
  migrations: {},
};

export const presetRecord: RecordType<Preset> = {
  name: 'preset',
  version: PRESET_SCHEMA_VERSION,
  schema: PresetSchema,
  migrations: {},
};

export const settingsRecord: RecordType<Settings> = {
  name: 'settings',
  version: SETTINGS_SCHEMA_VERSION,
  schema: SettingsSchema,
  migrations: {},
};

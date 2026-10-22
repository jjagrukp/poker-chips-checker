import { z } from 'zod';

// Alert types and host preferences (spec 03 §6.1). Game-agnostic: alerts hang off segment
// kinds (level/break) and the clock, never module data.

export const ALERT_TYPES = [
  'fiveMinutes',
  'oneMinute',
  'countdown',
  'levelStart',
  'breakStart',
  'breakEnding',
  'breakEnd',
  'complete',
  'recovery',
] as const;
export const AlertTypeSchema = z.enum(ALERT_TYPES);
export type AlertType = z.infer<typeof AlertTypeSchema>;

/** Recovery is a banner only (spec 03 §6.1); everything else has a sound too. */
export const SOUND_ALERT_TYPES = ALERT_TYPES.filter(
  (type): type is Exclude<AlertType, 'recovery'> => type !== 'recovery',
);
export type SoundAlertType = (typeof SOUND_ALERT_TYPES)[number];

const DEFAULT_ENABLED: Record<AlertType, boolean> = {
  fiveMinutes: false,
  oneMinute: true,
  countdown: true,
  levelStart: true,
  breakStart: true,
  breakEnding: true,
  breakEnd: true,
  complete: true,
  recovery: true,
};

export const DEFAULT_VOLUME = 0.8;

/** Stored in Settings (D27). Every field optional so older settings parse unchanged. */
export const AlertPrefsSchema = z.object({
  enabled: z.record(AlertTypeSchema, z.boolean()).optional(),
  volume: z.number().min(0).max(1).optional(),
  /** Screen flash; never shown under reduced motion. */
  flash: z.boolean().optional(),
  /** Browser notifications while the tab is hidden (opt-in). */
  notifications: z.boolean().optional(),
});
export type AlertPrefs = z.infer<typeof AlertPrefsSchema>;

export function alertEnabled(prefs: AlertPrefs | undefined, type: AlertType): boolean {
  return prefs?.enabled?.[type] ?? DEFAULT_ENABLED[type];
}

export function alertVolume(prefs: AlertPrefs | undefined): number {
  return prefs?.volume ?? DEFAULT_VOLUME;
}

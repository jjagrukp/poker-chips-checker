import type { ZodType, ZodTypeDef } from 'zod';
import type { DisplayLine, Schedule, Segment } from '@/core/scheduling/schedule';
import type { Clock } from '@/core/time';
import type { Tournament } from '@/core/tournaments/tournament';
import type { ValidationReport } from '@/core/validation/report';

// Game module contract (spec 02 §4). Modules are pure and UI-free: issues carry
// message-catalogue keys, display data is plain strings.

export interface ModuleContext {
  clock: Clock;
  newId(): string;
}

/**
 * `Inventory`/`Allocation` default to unknown because their types live in
 * features/chip-inventory/domain, which core may not import.
 */
export interface GameModule<C = unknown, Inventory = unknown, Allocation = unknown> {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly formats: readonly string[];
  readonly playerRange: { min: number; max: number };
  readonly configSchema: ZodType<C, ZodTypeDef, unknown>;
  defaults(input: { players: number; targetDurationMin: number }): C;
  /** Errors block; warnings inform. */
  validateConfig(config: C, ctx: ModuleContext): ValidationReport;
  generateSchedule(config: C, ctx: ModuleContext): { schedule: Schedule; report: ValidationReport };
  validateSchedule(schedule: Schedule, config: C, ctx: ModuleContext): ValidationReport;
  regenerateFrom?(schedule: Schedule, fromIndex: number, config: C, ctx: ModuleContext): Schedule;
  allocate?(config: C, inventory: Inventory): Allocation;
  liveExtras?(config: C, segment: Segment, tournament: Tournament): DisplayLine[];
  migrateConfig?(raw: unknown, fromVersion: string): C;
}

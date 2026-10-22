import type { EventDraft, TournamentEvent } from '@/core/events/events';
import type { Schedule } from '@/core/scheduling/schedule';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Preset, QuarantineEntry, Settings } from './records';

// Repository interfaces (spec 02 §7.1). Implementations live in infrastructure; every read
// returns Zod-parsed data, and unreadable records are quarantined rather than thrown.

export interface KeyedRepo<T> {
  get(id: string): Promise<T | undefined>;
  list(): Promise<T[]>;
  put(record: T): Promise<void>;
  delete(id: string): Promise<void>;
}

/** One atomic write: the tournament plus whatever a transition/command produced. */
export interface TournamentChange {
  tournament: Tournament;
  /** New schedule snapshots, e.g. from `applyScheduleEdit`. */
  schedules?: Schedule[];
  events?: EventDraft[];
  /**
   * Fallback concurrency guard when Web Locks is unavailable (spec 02 §7.7): the stored
   * anchor revision this change was derived from. A mismatch rejects the whole write.
   */
  expectedClockRevision?: number;
}

export type CommitResult =
  | { ok: true; events: TournamentEvent[] }
  | { ok: false; reason: 'conflict'; current: Tournament | undefined };

export interface TournamentRepo {
  get(id: string): Promise<Tournament | undefined>;
  list(): Promise<Tournament[]>;
  /** Serialised per tournament; writes tournament, schedules and events in one transaction. */
  commit(change: TournamentChange): Promise<CommitResult>;
  /** Also deletes the tournament's events and the schedule snapshots it references. */
  delete(id: string): Promise<void>;
}

export interface ScheduleRepo {
  get(id: string): Promise<Schedule | undefined>;
  put(schedule: Schedule): Promise<void>;
}

export interface EventRepo {
  /** Assigns ids and the next `seq` numbers for the tournament. */
  append(tournamentId: string, drafts: EventDraft[]): Promise<TournamentEvent[]>;
  /** Ordered by `seq`. */
  listByTournament(tournamentId: string): Promise<TournamentEvent[]>;
}

export type InventoryRepo<TInventory> = KeyedRepo<TInventory>;
export type PresetRepo = KeyedRepo<Preset>;

export type SettingsPatch = Partial<Omit<Settings, 'id' | 'schemaVersion'>>;

export interface SettingsRepo {
  /** Defaults when nothing is stored yet. */
  get(): Promise<Settings>;
  update(patch: SettingsPatch): Promise<Settings>;
}

export interface QuarantineRepo {
  list(): Promise<QuarantineEntry[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface Repositories<TInventory> {
  tournaments: TournamentRepo;
  schedules: ScheduleRepo;
  events: EventRepo;
  inventories: InventoryRepo<TInventory>;
  presets: PresetRepo;
  settings: SettingsRepo;
  quarantine: QuarantineRepo;
}

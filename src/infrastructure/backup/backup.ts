import { z } from 'zod';
import type { TournamentEvent } from '@/core/events/events';
import { migrateRecord, type RecordType } from '@/core/persistence/migrations';
import {
  eventRecord,
  presetRecord,
  scheduleRecord,
  SETTINGS_ID,
  settingsRecord,
  tournamentRecord,
  type QuarantineEntry,
} from '@/core/persistence/records';
import type { Repositories } from '@/core/persistence/repositories';
import type { Schedule } from '@/core/scheduling/schedule';
import type { Clock } from '@/core/time';
import type { Tournament } from '@/core/tournaments/tournament';
import type { DataStore, StorageDatabase } from '@/infrastructure/indexeddb/database';

// Single-file JSON backup (spec 02 §7.6): every store except quarantine, or one tournament.
// Import is all-or-nothing, preserves ids, and keeps both copies on an id clash.
export const BACKUP_FORMAT = 'tournament-platform-backup';
export const BACKUP_FORMAT_VERSION = 1;

const records = z.array(z.unknown()).default([]);

export const BackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  exportedAt: z.number().int(),
  scope: z.enum(['all', 'tournament']),
  stores: z.object({
    tournaments: records,
    schedules: records,
    events: records,
    inventories: records,
    presets: records,
    settings: records,
  }),
});
export type Backup = z.infer<typeof BackupSchema>;

export async function exportBackup<TInventory extends { id: string }>(
  repos: Repositories<TInventory>,
  clock: Clock,
  tournamentId?: string,
): Promise<Backup> {
  const tournaments = tournamentId
    ? [await repos.tournaments.get(tournamentId)].filter((t) => t !== undefined)
    : await repos.tournaments.list();
  const events = (
    await Promise.all(tournaments.map((t) => repos.events.listByTournament(t.id)))
  ).flat();
  const schedules = await loadAll(scheduleRefs(tournaments, events), (id) =>
    repos.schedules.get(id),
  );
  const inventories = tournamentId
    ? await loadAll(
        tournaments.flatMap((t) => (t.inventoryId ? [t.inventoryId] : [])),
        (id) => repos.inventories.get(id),
      )
    : await repos.inventories.list();
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: clock.now(),
    scope: tournamentId ? 'tournament' : 'all',
    stores: {
      tournaments,
      schedules,
      events,
      inventories,
      presets: tournamentId ? [] : await repos.presets.list(),
      settings: tournamentId ? [] : [await repos.settings.get()],
    },
  };
}

/** Quarantined records are excluded from backups; this exports them on their own. */
export async function exportQuarantine<TInventory extends { id: string }>(
  repos: Repositories<TInventory>,
  clock: Clock,
): Promise<{ format: string; exportedAt: number; entries: QuarantineEntry[] }> {
  return {
    format: `${BACKUP_FORMAT}-quarantine`,
    exportedAt: clock.now(),
    entries: await repos.quarantine.list(),
  };
}

export type ImportResult =
  | { ok: true; imported: Record<DataStore, number>; renamed: number }
  | {
      ok: false;
      reason: 'invalidJson' | 'invalidFormat' | 'invalidRecords' | 'writeFailed';
      errors: string[];
    };

export interface ImportOptions<TInventory extends { id: string }> {
  inventory: RecordType<TInventory>;
  newId?: () => string;
}

export async function importBackup<TInventory extends { id: string }>(
  db: StorageDatabase,
  text: string,
  options: ImportOptions<TInventory>,
): Promise<ImportResult> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: 'invalidJson', errors: [String(e)] };
  }
  const backup = BackupSchema.safeParse(json);
  if (!backup.success) {
    return {
      ok: false,
      reason: 'invalidFormat',
      errors: backup.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  const errors: string[] = [];
  const parseAll = <T>(type: RecordType<T>, raws: unknown[]): T[] =>
    raws.flatMap((raw, i) => {
      const result = migrateRecord(type, raw);
      if (result.ok) return [result.value];
      errors.push(`#${i} ${result.error}`);
      return [];
    });
  const { stores } = backup.data;
  const tournaments = parseAll(tournamentRecord, stores.tournaments);
  const schedules = parseAll(scheduleRecord, stores.schedules);
  // Events without their tournament in the file are orphans; importing them could only clash.
  const importedTournamentIds = new Set(tournaments.map((t) => t.id));
  const events = parseAll(eventRecord, stores.events).filter((e) =>
    importedTournamentIds.has(e.tournamentId),
  );
  const inventories = parseAll(options.inventory, stores.inventories);
  const presets = parseAll(presetRecord, stores.presets);
  const settings = parseAll(settingsRecord, stores.settings);
  if (errors.length > 0) return { ok: false, reason: 'invalidRecords', errors };

  const newId = options.newId ?? (() => crypto.randomUUID());
  const tx = db.transaction(
    ['tournaments', 'schedules', 'events', 'inventories', 'presets', 'settings'],
    'readwrite',
  );
  // Handled via the awaited path below; this only stops an abort becoming unhandled.
  tx.done.catch(() => undefined);
  try {
    let renamed = 0;
    // Conflict = keep both: a clashing id gets a fresh one, and references follow it.
    const remap = async (store: DataStore, ids: string[]) => {
      const map = new Map<string, string>();
      for (const id of ids) {
        if ((await tx.objectStore(store).getKey(id)) === undefined) continue;
        map.set(id, newId());
        renamed++;
      }
      return (id: string) => map.get(id) ?? id;
    };
    const tournamentId = await remap(
      'tournaments',
      tournaments.map((t) => t.id),
    );
    const scheduleId = await remap(
      'schedules',
      schedules.map((s) => s.id),
    );
    const inventoryId = await remap(
      'inventories',
      inventories.map((i) => i.id),
    );
    const presetId = await remap(
      'presets',
      presets.map((p) => p.id),
    );
    const eventClashes = new Set<string>();
    for (const e of events) {
      if ((await tx.objectStore('events').getKey(e.id)) !== undefined) eventClashes.add(e.id);
    }
    // Settings are a singleton: an existing copy wins.
    const keepSettings = (await tx.objectStore('settings').getKey(SETTINGS_ID)) !== undefined;

    // All reads are done: issue every write synchronously so each rejection is handled below.

    const puts: Promise<unknown>[] = [];
    for (const t of tournaments) {
      const next: Tournament = { ...t, id: tournamentId(t.id) };
      if (t.scheduleId) next.scheduleId = scheduleId(t.scheduleId);
      if (t.inventoryId) next.inventoryId = inventoryId(t.inventoryId);
      puts.push(tx.objectStore('tournaments').put(tournamentRecord.schema.parse(next)));
    }
    for (const s of schedules) {
      const next: Schedule = { ...s, id: scheduleId(s.id) };
      puts.push(tx.objectStore('schedules').put(next));
    }
    for (const e of events) {
      const owner = tournamentId(e.tournamentId);
      const next = {
        ...e,
        id: eventClashes.has(e.id) || owner !== e.tournamentId ? newId() : e.id,
        tournamentId: owner,
      } as TournamentEvent;
      if (next.type === 'schedule_edited') {
        next.payload = {
          ...next.payload,
          beforeScheduleId: scheduleId(next.payload.beforeScheduleId),
          afterScheduleId: scheduleId(next.payload.afterScheduleId),
        };
      }
      puts.push(tx.objectStore('events').put(eventRecord.schema.parse(next)));
    }
    for (const i of inventories) {
      puts.push(tx.objectStore('inventories').put({ ...i, id: inventoryId(i.id) }));
    }
    for (const p of presets) {
      puts.push(tx.objectStore('presets').put({ ...p, id: presetId(p.id) }));
    }
    for (const s of keepSettings ? [] : settings) puts.push(tx.objectStore('settings').put(s));

    await Promise.all(puts);
    await tx.done;
    return {
      ok: true,
      renamed,
      imported: {
        tournaments: tournaments.length,
        schedules: schedules.length,
        events: events.length,
        inventories: inventories.length,
        presets: presets.length,
        settings: keepSettings ? 0 : settings.length,
      },
    };
  } catch (e) {
    try {
      tx.abort();
    } catch {
      // Already finished or aborted.
    }
    return { ok: false, reason: 'writeFailed', errors: [String(e)] };
  }
}

function scheduleRefs(tournaments: Tournament[], events: TournamentEvent[]): string[] {
  const ids = new Set<string>();
  for (const t of tournaments) if (t.scheduleId) ids.add(t.scheduleId);
  for (const e of events) {
    if (e.type !== 'schedule_edited') continue;
    ids.add(e.payload.beforeScheduleId);
    ids.add(e.payload.afterScheduleId);
  }
  return [...ids];
}

async function loadAll<T>(ids: string[], get: (id: string) => Promise<T | undefined>) {
  const loaded: (T | undefined)[] = await Promise.all(ids.map(get));
  return loaded.filter((x): x is T => x !== undefined);
}

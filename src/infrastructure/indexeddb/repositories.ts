import type { IDBPObjectStore, StoreNames } from 'idb';
import { EventDraftSchema, type EventDraft, type TournamentEvent } from '@/core/events/events';
import { migrateRecord, type RecordType } from '@/core/persistence/migrations';
import {
  defaultSettings,
  eventRecord,
  presetRecord,
  QuarantineEntrySchema,
  scheduleRecord,
  SETTINGS_ID,
  settingsRecord,
  tournamentRecord,
} from '@/core/persistence/records';
import type {
  CommitResult,
  KeyedRepo,
  QuarantineRepo,
  Repositories,
  SettingsRepo,
  TournamentRepo,
} from '@/core/persistence/repositories';
import type { Clock } from '@/core/time';
import { createKeyedQueue, type KeyedQueue } from '@/shared/utilities/keyed-queue';
import type { DataStore, StorageDatabase, StorageSchema } from './database';

export interface RepositoryOptions<TInventory extends { id: string }> {
  /** Inventory records are owned by chip-inventory/domain; the composition root supplies them. */
  inventory: RecordType<TInventory>;
  clock?: Clock;
  newId?: () => string;
}

interface Context {
  db: StorageDatabase;
  clock: Clock;
  newId: () => string;
  queue: KeyedQueue;
}

interface Entry {
  key: string;
  raw: unknown;
}

const systemClock: Clock = { now: () => Date.now() };

export function createRepositories<TInventory extends { id: string }>(
  db: StorageDatabase,
  options: RepositoryOptions<TInventory>,
): Repositories<TInventory> {
  const ctx: Context = {
    db,
    clock: options.clock ?? systemClock,
    newId: options.newId ?? (() => crypto.randomUUID()),
    queue: createKeyedQueue(),
  };
  const schedules = keyedRepo(ctx, 'schedules', scheduleRecord);
  return {
    tournaments: tournamentRepo(ctx),
    schedules: { get: schedules.get, put: schedules.put },
    events: {
      append: async (tournamentId, drafts) => {
        const valid = drafts.map((d) => EventDraftSchema.parse(d));
        return ctx.queue.run(tournamentKey(tournamentId), () => {
          const tx = ctx.db.transaction('events', 'readwrite');
          return finishOrAbort(tx, () =>
            appendEvents(ctx, tx.objectStore('events'), tournamentId, valid),
          );
        });
      },
      listByTournament: async (tournamentId) => {
        const index = ctx.db.transaction('events').store.index('byTournamentSeq');
        const range = tournamentRange(tournamentId);
        const [keys, raws] = await Promise.all([index.getAllKeys(range), index.getAll(range)]);
        return settle(ctx, 'events', eventRecord, zip(keys, raws));
      },
    },
    inventories: keyedRepo(ctx, 'inventories', options.inventory),
    presets: keyedRepo(ctx, 'presets', presetRecord),
    settings: settingsRepo(ctx),
    quarantine: quarantineRepo(ctx),
  };
}

function tournamentRepo(ctx: Context): TournamentRepo {
  const base = keyedRepo(ctx, 'tournaments', tournamentRecord);
  return {
    get: base.get,
    list: base.list,
    commit: async (change) => {
      // Validate everything up front so a bad draft can never leave a half-written change.
      const tournament = tournamentRecord.schema.parse(change.tournament);
      const schedules = (change.schedules ?? []).map((s) => scheduleRecord.schema.parse(s));
      const drafts = (change.events ?? []).map((d) => EventDraftSchema.parse(d));
      return ctx.queue.run(tournamentKey(tournament.id), () => {
        const tx = ctx.db.transaction(['tournaments', 'schedules', 'events'], 'readwrite');
        return finishOrAbort(tx, async (): Promise<CommitResult> => {
          if (change.expectedClockRevision !== undefined) {
            const stored = migrateRecord(
              tournamentRecord,
              await tx.objectStore('tournaments').get(tournament.id),
            );
            const current = stored.ok ? stored.value : undefined;
            if (current?.clock?.revision !== change.expectedClockRevision) {
              return { ok: false, reason: 'conflict', current };
            }
          }
          await Promise.all(schedules.map((s) => tx.objectStore('schedules').put(s)));
          await tx.objectStore('tournaments').put(tournament);
          const events = await appendEvents(ctx, tx.objectStore('events'), tournament.id, drafts);
          return { ok: true, events };
        });
      });
    },
    delete: (id) =>
      ctx.queue.run(tournamentKey(id), () => {
        const tx = ctx.db.transaction(['tournaments', 'schedules', 'events'], 'readwrite');
        return finishOrAbort(tx, async () => {
          const scheduleIds = new Set<string>();
          const scheduleId = stringField(await tx.objectStore('tournaments').get(id), 'scheduleId');
          if (scheduleId) scheduleIds.add(scheduleId);
          const index = tx.objectStore('events').index('byTournamentSeq');
          const range = tournamentRange(id);
          const [eventIds, raws] = await Promise.all([
            index.getAllKeys(range),
            index.getAll(range),
          ]);
          for (const raw of raws) {
            const payload = (raw as { payload?: unknown } | undefined)?.payload;
            for (const field of ['beforeScheduleId', 'afterScheduleId']) {
              const ref = stringField(payload, field);
              if (ref) scheduleIds.add(ref);
            }
          }
          await Promise.all([
            tx.objectStore('tournaments').delete(id),
            ...eventIds.map((key) => tx.objectStore('events').delete(key)),
            ...[...scheduleIds].map((key) => tx.objectStore('schedules').delete(key)),
          ]);
        });
      }),
  };
}

function settingsRepo(ctx: Context): SettingsRepo {
  const base = keyedRepo(ctx, 'settings', settingsRecord);
  return {
    get: async () => (await base.get(SETTINGS_ID)) ?? defaultSettings(),
    update: (patch) =>
      ctx.queue.run('settings', () => {
        // Read-merge-write in one transaction so another tab's update can't be lost.
        const tx = ctx.db.transaction('settings', 'readwrite');
        return finishOrAbort(tx, async () => {
          const stored = migrateRecord(settingsRecord, await tx.store.get(SETTINGS_ID));
          const current = stored.ok ? stored.value : defaultSettings();
          const next = settingsRecord.schema.parse({ ...current, ...patch });
          await tx.store.put(next);
          return next;
        });
      }),
  };
}

function quarantineRepo(ctx: Context): QuarantineRepo {
  return {
    list: async () =>
      (await ctx.db.getAll('quarantine')).flatMap((entry) => {
        const parsed = QuarantineEntrySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    delete: (id) => ctx.db.delete('quarantine', id),
    clear: () => ctx.db.clear('quarantine'),
  };
}

function keyedRepo<T extends { id: string }>(
  ctx: Context,
  store: DataStore,
  type: RecordType<T>,
): KeyedRepo<T> {
  return {
    get: async (id) => {
      const raw = await ctx.db.get(store, id);
      if (raw === undefined) return undefined;
      return (await settle(ctx, store, type, [{ key: id, raw }]))[0];
    },
    list: async () => {
      const tx = ctx.db.transaction(store);
      const [keys, raws] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
      return settle(ctx, store, type, zip(keys, raws));
    },
    put: async (record) => {
      await ctx.db.put(store, type.schema.parse(record));
    },
    delete: (id) => ctx.db.delete(store, id),
  };
}

/**
 * Migrates + parses raw records. Migrated records are written back; unreadable ones move to
 * quarantine (spec 02 §7.4). Repair failures never fail the read.
 */
async function settle<T>(
  ctx: Context,
  store: DataStore,
  type: RecordType<T>,
  entries: Entry[],
): Promise<T[]> {
  const values: T[] = [];
  const repairs: string[] = [];
  for (const { key, raw } of entries) {
    const result = migrateRecord(type, raw);
    if (result.ok) values.push(result.value);
    if (!result.ok || result.migrated) repairs.push(key);
  }
  if (repairs.length > 0) {
    try {
      await repair(ctx, store, type, repairs);
    } catch {
      // The data stays readable this session; repair is retried on the next read.
    }
  }
  return values;
}

async function repair<T>(ctx: Context, store: DataStore, type: RecordType<T>, keys: string[]) {
  const tx = ctx.db.transaction([store, 'quarantine'], 'readwrite');
  const records = tx.objectStore(store);
  await finishOrAbort(tx, async () => {
    for (const key of keys) {
      // Re-read inside the transaction so a concurrent newer write is never clobbered.
      const raw = await records.get(key);
      if (raw === undefined) continue;
      const result = migrateRecord(type, raw);
      if (result.ok) {
        if (result.migrated) await records.put(result.value);
        continue;
      }
      await tx.objectStore('quarantine').put({
        id: ctx.newId(),
        store,
        key,
        raw,
        error: result.error,
        quarantinedAt: ctx.clock.now(),
      });
      await records.delete(key);
    }
  });
}

/**
 * Runs `work` in `tx`, resolving once the transaction commits. Any failure aborts the whole
 * transaction (IndexedDB would otherwise auto-commit the writes made so far) and rethrows.
 */
async function finishOrAbort<T>(
  tx: { done: Promise<void>; abort(): void },
  work: () => Promise<T>,
): Promise<T> {
  tx.done.catch(() => undefined); // Surfaced via the awaited path; never unhandled.
  try {
    const result = await work();
    await tx.done;
    return result;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      // Already committed or aborted.
    }
    throw e;
  }
}

/**
 * `drafts` must already be validated. `seq` continues from the highest stored event, so a
 * quarantined last event's seq can be reused; seq orders events, it isn't a permanent id.
 */
async function appendEvents<TxStores extends ArrayLike<StoreNames<StorageSchema>>>(
  ctx: Context,
  store: IDBPObjectStore<StorageSchema, TxStores, 'events', 'readwrite'>,
  tournamentId: string,
  drafts: EventDraft[],
): Promise<TournamentEvent[]> {
  if (drafts.length === 0) return [];
  const last = await store
    .index('byTournamentSeq')
    .openKeyCursor(tournamentRange(tournamentId), 'prev');
  const firstSeq = last ? last.key[1] + 1 : 0;
  const events = drafts.map((draft, i): TournamentEvent =>
    eventRecord.schema.parse({
      ...draft,
      id: ctx.newId(),
      tournamentId,
      seq: firstSeq + i,
      schemaVersion: eventRecord.version,
    }),
  );
  await Promise.all(events.map((e) => store.put(e)));
  return events;
}

/** Queue keys are namespaced so a tournament id can never share a queue with settings. */
function tournamentKey(id: string): string {
  return `tournament:${id}`;
}

function tournamentRange(tournamentId: string): IDBKeyRange {
  return IDBKeyRange.bound([tournamentId, 0], [tournamentId, Number.MAX_SAFE_INTEGER]);
}

function zip(keys: IDBValidKey[], raws: unknown[]): Entry[] {
  return keys.map((key, i) => ({ key: String(key), raw: raws[i] }));
}

function stringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = (value as Record<string, unknown>)[field];
  return typeof v === 'string' ? v : undefined;
}

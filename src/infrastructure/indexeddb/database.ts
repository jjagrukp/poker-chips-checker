import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { QuarantineEntry } from '@/core/persistence/records';

// IndexedDB layout (spec 02 §7.2). The name is fixed, not branded, so a rename keeps data.
export const DB_NAME = 'tournament-platform';
export const DB_VERSION = 1;

/** Stores holding versioned domain records. Values are raw until migrated + parsed on read. */
export const DATA_STORES = [
  'tournaments',
  'schedules',
  'events',
  'inventories',
  'presets',
  'settings',
] as const;
export type DataStore = (typeof DATA_STORES)[number];

export interface StorageSchema extends DBSchema {
  tournaments: { key: string; value: unknown };
  schedules: { key: string; value: unknown };
  events: { key: string; value: unknown; indexes: { byTournamentSeq: [string, number] } };
  inventories: { key: string; value: unknown };
  presets: { key: string; value: unknown };
  settings: { key: string; value: unknown };
  quarantine: { key: string; value: QuarantineEntry };
  meta: { key: string; value: { key: string; value: unknown } };
}

export type StorageDatabase = IDBPDatabase<StorageSchema>;

export async function openDatabase(name: string = DB_NAME): Promise<StorageDatabase> {
  const db: StorageDatabase = await openDB<StorageSchema>(name, DB_VERSION, {
    // A newer version in another tab is upgrading: let it proceed (reload notice comes in M10).
    blocking: () => db.close(),
    upgrade(db, oldVersion, _newVersion, tx) {
      // Each block upgrades from one db version; add `if (oldVersion < 2)` etc. below.
      if (oldVersion < 1) {
        for (const store of DATA_STORES) {
          if (store !== 'events') db.createObjectStore(store, { keyPath: 'id' });
        }
        db.createObjectStore('events', { keyPath: 'id' }).createIndex(
          'byTournamentSeq',
          ['tournamentId', 'seq'],
          { unique: true },
        );
        db.createObjectStore('quarantine', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      void tx.objectStore('meta').put({ key: 'dbVersion', value: DB_VERSION });
    },
  });
  return db;
}

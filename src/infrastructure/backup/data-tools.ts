import type { RecordType } from '@/core/persistence/migrations';
import type { Repositories } from '@/core/persistence/repositories';
import type { Clock } from '@/core/time';
import { clearAllData, type StorageDatabase } from '@/infrastructure/indexeddb/database';
import { exportBackup, exportQuarantine, importBackup, type ImportResult } from './backup';

// Settings' "Your data" actions as one injectable object, so the UI never touches the database.

export interface DataTools {
  /** The whole backup as JSON text. */
  exportAll(): Promise<string>;
  exportQuarantine(): Promise<string>;
  importBackup(text: string): Promise<ImportResult>;
  deleteEverything(): Promise<void>;
}

export function createDataTools<TInventory extends { id: string }>(
  db: StorageDatabase,
  repos: Repositories<TInventory>,
  options: { inventory: RecordType<TInventory>; clock: Clock; newId: () => string },
): DataTools {
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  return {
    exportAll: async () => json(await exportBackup(repos, options.clock)),
    exportQuarantine: async () => json(await exportQuarantine(repos, options.clock)),
    importBackup: (text) =>
      importBackup(db, text, { inventory: options.inventory, newId: options.newId }),
    deleteEverything: () => clearAllData(db),
  };
}

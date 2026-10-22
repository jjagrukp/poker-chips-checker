import type { StoragePersistence } from '@/core/persistence/records';
import type { SettingsRepo } from '@/core/persistence/repositories';

type PersistApi = Partial<Pick<StorageManager, 'persist' | 'persisted'>>;

/** Asks the browser not to evict our data (spec 02 §7.6). Never throws. */
export async function requestPersistentStorage(
  storage: PersistApi | undefined = globalThis.navigator?.storage,
): Promise<StoragePersistence> {
  if (!storage?.persist) return 'unsupported';
  try {
    if (await storage.persisted?.()) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Called on first tournament start; the result is shown in Settings. */
export async function ensurePersistentStorage(
  settings: SettingsRepo,
  storage?: PersistApi,
): Promise<StoragePersistence> {
  const storagePersistence = await requestPersistentStorage(storage);
  await settings.update({ storagePersistence });
  return storagePersistence;
}

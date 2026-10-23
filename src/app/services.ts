import { createContext, useContext } from 'react';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { ClockPlatform } from '@/features/live-clock/state/clock-store';
import { inventoryRecord, type Inventory } from '@/features/chip-inventory/domain/inventory';
import type { PhotoService } from '@/features/chip-inventory/photo/service';
import { createBrowserPhotoService } from '@/infrastructure/ai-photo/photo-service';
import { createDataTools, type DataTools } from '@/infrastructure/backup/data-tools';
import { openDatabase } from '@/infrastructure/indexeddb/database';
import { appStatus } from '@/infrastructure/pwa/app-status';
import type { Tone } from '@/shared/messages';
import { createRepositories } from '@/infrastructure/indexeddb/repositories';

// Composition root for storage (D15): the only place repositories are created.

export interface Services {
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
  /** Tests inject fakes; the app uses the browser APIs (clock-platform.ts). */
  clockPlatform?: ClockPlatform | undefined;
  /** Tests inject a fake or leave it out (no photo route). */
  photo?: PhotoService | undefined;
  /** Backup/import/delete-all (Settings); left out, Settings has no data section. */
  data?: DataTools | undefined;
}

export const ServicesContext = createContext<Services | null>(null);

/** Settings changes the tone for the whole app without a reload. */
export const SetToneContext = createContext<(tone: Tone) => void>(() => undefined);

export const browserContext: ModuleContext = {
  clock: { now: () => Date.now() },
  newId: () => crypto.randomUUID(),
};

export async function openServices(): Promise<Services> {
  const db = await openDatabase(undefined, {
    onReplaced: () => appStatus.set({ storageReplaced: true }),
  });
  const repos = createRepositories(db, { inventory: inventoryRecord });
  return {
    repos,
    ctx: browserContext,
    photo: createBrowserPhotoService(),
    data: createDataTools(db, repos, {
      inventory: inventoryRecord,
      clock: browserContext.clock,
      newId: browserContext.newId,
    }),
  };
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices outside ServicesProvider');
  return services;
}

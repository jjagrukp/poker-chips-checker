import { createContext, useContext } from 'react';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { ClockPlatform } from '@/features/live-clock/state/clock-store';
import { inventoryRecord, type Inventory } from '@/features/chip-inventory/domain/inventory';
import type { PhotoService } from '@/features/chip-inventory/photo/service';
import { createBrowserPhotoService } from '@/infrastructure/ai-photo/photo-service';
import { openDatabase } from '@/infrastructure/indexeddb/database';
import { createRepositories } from '@/infrastructure/indexeddb/repositories';

// Composition root for storage (D15): the only place repositories are created.

export interface Services {
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
  /** Tests inject fakes; the app uses the browser APIs (clock-platform.ts). */
  clockPlatform?: ClockPlatform | undefined;
  /** Tests inject a fake or leave it out (no photo route). */
  photo?: PhotoService | undefined;
}

export const ServicesContext = createContext<Services | null>(null);

export const browserContext: ModuleContext = {
  clock: { now: () => Date.now() },
  newId: () => crypto.randomUUID(),
};

export async function openServices(): Promise<Services> {
  const db = await openDatabase();
  return {
    repos: createRepositories(db, { inventory: inventoryRecord }),
    ctx: browserContext,
    photo: createBrowserPhotoService(),
  };
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices outside ServicesProvider');
  return services;
}

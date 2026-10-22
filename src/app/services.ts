import { createContext, useContext } from 'react';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import { inventoryRecord, type Inventory } from '@/features/chip-inventory/domain/inventory';
import { openDatabase } from '@/infrastructure/indexeddb/database';
import { createRepositories } from '@/infrastructure/indexeddb/repositories';

// Composition root for storage (D15): the only place repositories are created.

export interface Services {
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
}

export const ServicesContext = createContext<Services | null>(null);

export const browserContext: ModuleContext = {
  clock: { now: () => Date.now() },
  newId: () => crypto.randomUUID(),
};

export async function openServices(): Promise<Services> {
  const db = await openDatabase();
  return { repos: createRepositories(db, { inventory: inventoryRecord }), ctx: browserContext };
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices outside ServicesProvider');
  return services;
}

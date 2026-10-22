// Test-only helpers for infrastructure storage tests.
import 'fake-indexeddb/auto';
import { z } from 'zod';
import type { RecordType } from '@/core/persistence/migrations';
import { inventoryRecord } from '@/features/chip-inventory/domain/inventory';
import { T0 } from '@/core/testing/schedules';
import type { Tournament } from '@/core/tournaments/tournament';
import { openDatabase } from '@/infrastructure/indexeddb/database';
import { createRepositories } from '@/infrastructure/indexeddb/repositories';

/** Stand-in until chip-inventory/domain defines the real inventory record (M3). */
export const TestInventorySchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: z.string(),
});
export type TestInventory = z.infer<typeof TestInventorySchema>;

export const testInventoryRecord: RecordType<TestInventory> = {
  name: 'inventory',
  version: 1,
  schema: TestInventorySchema,
  migrations: {},
};

let dbCounter = 0;

export function uniqueDbName(): string {
  return `test-db-${++dbCounter}-${Math.random().toString(36).slice(2)}`;
}

export function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export async function openTestStorage(name = uniqueDbName(), idPrefix = 'id') {
  const db = await openDatabase(name);
  const repos = createRepositories(db, {
    inventory: testInventoryRecord,
    clock: { now: () => T0 },
    newId: sequentialIds(idPrefix),
  });
  return { db, repos, name };
}

export function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 't1',
    schemaVersion: 1,
    moduleId: 'test',
    moduleVersion: '1',
    status: 'draft',
    config: { any: 'thing' },
    allocation: undefined,
    participants: { count: 6, remaining: 6 },
    settings: { breakEndBehaviour: 'auto' },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** Repositories with the real inventory record, for app and feature tests. */
export async function openAppTestStorage(name = uniqueDbName()) {
  const db = await openDatabase(name);
  return createRepositories(db, { inventory: inventoryRecord, clock: { now: () => T0 } });
}

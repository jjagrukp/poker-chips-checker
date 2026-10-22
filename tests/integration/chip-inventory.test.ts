import { allocate } from '@/features/chip-inventory/domain/allocate';
import { inventoryRecord } from '@/features/chip-inventory/domain/inventory';
import { classic300 } from '@/features/chip-inventory/domain/testing/fixtures';
import { validateAllocation } from '@/features/chip-inventory/domain/validate-allocation';
import { exportBackup, importBackup } from '@/infrastructure/backup/backup';
import { openDatabase } from '@/infrastructure/indexeddb/database';
import { createRepositories } from '@/infrastructure/indexeddb/repositories';
import { sequentialIds, tournament, uniqueDbName } from '@/infrastructure/testing/storage';
import { messages } from '@/shared/messages/catalogue';

// M3: the real inventory record type plugs into storage (D15), and every issue key the
// domain can emit exists in the message catalogue.
const clock = { now: () => 1_700_000_000_000 };

async function open() {
  const db = await openDatabase(uniqueDbName());
  return {
    db,
    repos: createRepositories(db, { inventory: inventoryRecord, clock, newId: sequentialIds() }),
  };
}

describe('chip inventory through storage', () => {
  it('stores an inventory and a validated allocation, and restores both from a backup', async () => {
    const { repos } = await open();
    const { inventory, assignment } = classic300();
    await repos.inventories.put(inventory);
    expect(await repos.inventories.get(inventory.id)).toEqual(inventory);

    const outcome = allocate({ inventory, assignment, players: 6, targetStack: 1500, firstSB: 5 });
    if (outcome.kind !== 'ok') throw new Error(JSON.stringify(outcome));
    expect(
      validateAllocation(outcome.result, inventory, 6, assignment, {
        targetStack: 1500,
        firstSB: 5,
      }).errors,
    ).toEqual([]);
    const t = tournament({
      inventoryId: inventory.id,
      allocation: { assignment, result: outcome.result },
    });
    await repos.tournaments.commit({ tournament: t });

    const backup = await exportBackup(repos, clock);
    const restored = await open();
    const result = await importBackup(restored.db, JSON.stringify(backup), {
      inventory: inventoryRecord,
    });
    expect(result.ok).toBe(true);
    expect(await restored.repos.inventories.get(inventory.id)).toEqual(inventory);
    expect((await restored.repos.tournaments.get(t.id))?.allocation).toEqual(t.allocation);
  });

  it('rejects a backup whose inventory breaks the schema', async () => {
    const { repos } = await open();
    await repos.inventories.put(classic300().inventory);
    const backup = await exportBackup(repos, clock);
    const text = JSON.stringify(backup).replace('"quantity":100', '"quantity":-1');
    const target = await open();
    expect((await importBackup(target.db, text, { inventory: inventoryRecord })).ok).toBe(false);
  });
});

describe('chip-inventory message keys', () => {
  it('every messageKey in the domain exists in the catalogue', () => {
    const sources = import.meta.glob<string>(
      [
        '/src/features/chip-inventory/domain/*.ts',
        '!/src/features/chip-inventory/domain/*.test.ts',
      ],
      { query: '?raw', import: 'default', eager: true },
    );
    const keys = Object.values(sources).flatMap((source) =>
      [...source.matchAll(/messageKey: '([^']+)'/g)].map((m) => m[1] ?? ''),
    );
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((k) => !(k in messages))).toEqual([]);
  });
});

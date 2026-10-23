import { openDB } from 'idb';
import { openTestStorage, tournament } from '@/infrastructure/testing/storage';
import { clearAllData, DB_VERSION, openDatabase } from './database';

describe('database', () => {
  it('clears every data store and the quarantine, keeping meta', async () => {
    const { db, repos } = await openTestStorage();
    await repos.tournaments.commit({ tournament: tournament() });
    await db.put('quarantine', { id: 'q1', store: 'tournaments', raw: 1, error: 'bad', quarantinedAt: 0 });
    await clearAllData(db);
    expect(await repos.tournaments.list()).toEqual([]);
    expect(await repos.quarantine.list()).toEqual([]);
    expect(await db.get('meta', 'dbVersion')).toEqual({ key: 'dbVersion', value: DB_VERSION });
  });

  it('closes and reports when a newer version needs the database', async () => {
    const onReplaced = vi.fn();
    const name = `replaced-${Math.random()}`;
    await openDatabase(name, { onReplaced });
    const newer = await openDB(name, DB_VERSION + 1);
    expect(onReplaced).toHaveBeenCalledOnce();
    newer.close();
  });
});

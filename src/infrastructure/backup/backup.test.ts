import type { EventDraft } from '@/core/events/events';
import { basic, schedule, segment, T0 } from '@/core/testing/schedules';
import {
  openTestStorage,
  sequentialIds,
  testInventoryRecord,
  tournament,
} from '@/infrastructure/testing/storage';
import { exportBackup, exportQuarantine, importBackup } from './backup';

const clock = { now: () => T0 };
const edited = schedule([segment('l1', 'level', 20)], 'sched-2');
const scheduleEdited: EventDraft = {
  type: 'schedule_edited',
  at: T0,
  payload: {
    beforeScheduleId: basic.id,
    afterScheduleId: edited.id,
    segmentIndex: 0,
    restartCurrent: false,
    detail: null,
  },
};

async function seeded() {
  const storage = await openTestStorage();
  const { repos } = storage;
  await repos.inventories.put({ id: 'inv', schemaVersion: 1, name: 'Home set' });
  await repos.inventories.put({ id: 'inv-unused', schemaVersion: 1, name: 'Spare' });
  await repos.presets.put({
    id: 'p1',
    schemaVersion: 1,
    name: 'Friday',
    moduleId: 'test',
    moduleVersion: '1',
    presetVersion: 1,
    config: {},
    createdAt: T0,
    updatedAt: T0,
  });
  await repos.settings.update({ tone: 'neutral' });
  await repos.tournaments.commit({
    tournament: tournament({ scheduleId: edited.id, inventoryId: 'inv' }),
    schedules: [basic, edited],
    events: [scheduleEdited],
  });
  await repos.tournaments.commit({ tournament: tournament({ id: 't2', name: 'Other' }) });
  return storage;
}

const importOptions = (prefix: string) => ({
  inventory: testInventoryRecord,
  newId: sequentialIds(prefix),
});

describe('backup export/import', () => {
  it('exports everything and imports it into an empty database unchanged', async () => {
    const source = await seeded();
    const backup = await exportBackup(source.repos, clock);
    expect(backup.scope).toBe('all');
    expect(backup.stores.tournaments).toHaveLength(2);
    expect(backup.stores.schedules).toHaveLength(2);
    expect(backup.stores.inventories).toHaveLength(2);

    const target = await openTestStorage();
    const result = await importBackup(target.db, JSON.stringify(backup), importOptions('new'));
    expect(result).toMatchObject({ ok: true, renamed: 0 });
    expect(await exportBackup(target.repos, clock)).toEqual(backup);
  });

  it('keeps both copies on an id clash and remaps references to the new ids', async () => {
    const { db, repos } = await seeded();
    const backup = await exportBackup(repos, clock, 't1');
    expect(backup.scope).toBe('tournament');
    expect(backup.stores.inventories).toEqual([{ id: 'inv', schemaVersion: 1, name: 'Home set' }]);
    expect(backup.stores.presets).toEqual([]);
    expect(backup.stores.settings).toEqual([]);

    const result = await importBackup(db, JSON.stringify(backup), importOptions('new'));
    expect(result).toMatchObject({ ok: true, renamed: 4 }); // tournament, 2 schedules, inventory

    const copies = (await repos.tournaments.list()).filter((t) => t.id !== 't2');
    expect(copies).toHaveLength(2);
    const copy = copies.find((t) => t.id !== 't1');
    if (!copy?.scheduleId || !copy.inventoryId) throw new Error('expected a remapped copy');
    expect(copy.scheduleId).not.toBe(edited.id);
    expect(copy.inventoryId).not.toBe('inv');
    expect(await repos.schedules.get(copy.scheduleId)).toMatchObject({ segments: edited.segments });
    expect(await repos.inventories.get(copy.inventoryId)).toMatchObject({ name: 'Home set' });

    const [event] = await repos.events.listByTournament(copy.id);
    expect(event?.type === 'schedule_edited' && event.payload.afterScheduleId).toBe(
      copy.scheduleId,
    );
    expect(event?.type === 'schedule_edited' && event.payload.beforeScheduleId).not.toBe(basic.id);
    expect(await repos.events.listByTournament('t1')).toHaveLength(1);
  });

  it('keeps existing settings over imported ones', async () => {
    const source = await seeded();
    const backup = await exportBackup(source.repos, clock);
    const target = await openTestStorage();
    await target.repos.settings.update({ tone: 'playful' });
    const result = await importBackup(target.db, JSON.stringify(backup), importOptions('new'));
    expect(result.ok && result.imported.settings).toBe(0);
    expect((await target.repos.settings.get()).tone).toBe('playful');
  });

  it.each([
    ['invalid JSON', 'not json', 'invalidJson'],
    ['a foreign file', JSON.stringify({ hello: 'world' }), 'invalidFormat'],
  ])('rejects %s', async (_, text, reason) => {
    const { db } = await openTestStorage();
    expect(await importBackup(db, text, importOptions('new'))).toMatchObject({ ok: false, reason });
  });

  it('imports nothing when any record is invalid', async () => {
    const source = await seeded();
    const backup = await exportBackup(source.repos, clock);
    backup.stores.schedules.push({ id: 'bad', schemaVersion: 1 });
    const target = await openTestStorage();
    const result = await importBackup(target.db, JSON.stringify(backup), importOptions('new'));
    expect(result).toMatchObject({ ok: false, reason: 'invalidRecords' });
    expect(await target.repos.tournaments.list()).toEqual([]);
  });

  it('rolls back the whole import when a write fails', async () => {
    const source = await seeded();
    const backup = await exportBackup(source.repos, clock);
    const target = await openTestStorage();
    // An orphan event already holding (t1, seq 0) violates the unique index mid-import.
    await target.db.put('events', {
      id: 'orphan',
      tournamentId: 't1',
      seq: 0,
      schemaVersion: 1,
      type: 'participants_changed',
      at: T0,
      payload: { count: 1, remaining: 1 },
    });
    const result = await importBackup(target.db, JSON.stringify(backup), importOptions('new'));
    expect(result).toMatchObject({ ok: false, reason: 'writeFailed' });
    expect(await target.repos.tournaments.list()).toEqual([]);
  });

  it('exports quarantined records separately', async () => {
    const { db, repos } = await openTestStorage();
    await db.put('presets', { id: 'bad', schemaVersion: 1 });
    await repos.presets.list();
    const exported = await exportQuarantine(repos, clock);
    expect(exported.entries.map((e) => e.key)).toEqual(['bad']);
    expect((await exportBackup(repos, clock)).stores.presets).toEqual([]);
  });
});

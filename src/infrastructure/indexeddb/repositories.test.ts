import type { EventDraft } from '@/core/events/events';
import { basic, schedule, segment, T0 } from '@/core/testing/schedules';
import { openTestStorage, tournament, uniqueDbName } from '@/infrastructure/testing/storage';
import { z } from 'zod';
import { openDatabase } from './database';
import { createRepositories } from './repositories';

const participantsChanged = (remaining: number): EventDraft => ({
  type: 'participants_changed',
  at: T0,
  payload: { count: 6, remaining },
});

describe('IndexedDB repositories', () => {
  it('creates every store and records the db version in meta', async () => {
    const { db } = await openTestStorage();
    expect([...db.objectStoreNames].sort()).toEqual(
      [
        'events',
        'inventories',
        'meta',
        'presets',
        'quarantine',
        'schedules',
        'settings',
        'tournaments',
      ].sort(),
    );
    expect(await db.get('meta', 'dbVersion')).toEqual({ key: 'dbVersion', value: 1 });
  });

  it('commits a tournament, its schedule and events atomically, numbering events per tournament', async () => {
    const { repos } = await openTestStorage();
    const t = tournament({ scheduleId: basic.id });
    const first = await repos.tournaments.commit({
      tournament: t,
      schedules: [basic],
      events: [participantsChanged(6), participantsChanged(5)],
    });
    const second = await repos.tournaments.commit({
      tournament: t,
      events: [participantsChanged(4)],
    });
    await repos.events.append('t2', [participantsChanged(1)]);

    expect(first.ok && first.events.map((e) => e.seq)).toEqual([0, 1]);
    expect(second.ok && second.events.map((e) => e.seq)).toEqual([2]);
    expect(await repos.tournaments.get('t1')).toEqual(t);
    expect(await repos.schedules.get(basic.id)).toEqual(basic);
    const events = await repos.events.listByTournament('t1');
    expect(
      events.map((e) => [e.seq, e.type === 'participants_changed' && e.payload.remaining]),
    ).toEqual([
      [0, 6],
      [1, 5],
      [2, 4],
    ]);
    expect((await repos.events.listByTournament('t2')).map((e) => e.seq)).toEqual([0]);
  });

  it('serialises concurrent writes to one tournament so event seqs never collide', async () => {
    const { repos } = await openTestStorage();
    await Promise.all(
      [5, 4, 3, 2].map((remaining) =>
        repos.tournaments.commit({
          tournament: tournament({ participants: { count: 6, remaining } }),
          events: [participantsChanged(remaining)],
        }),
      ),
    );
    const events = await repos.events.listByTournament('t1');
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect((await repos.tournaments.get('t1'))?.participants.remaining).toBe(2);
  });

  it('rejects a write whose expected clock revision is stale and writes nothing', async () => {
    const { repos } = await openTestStorage();
    const clock = {
      status: 'paused' as const,
      segmentIndex: 0,
      remainingMs: 1,
      revision: 3,
      updatedAt: T0,
    };
    await repos.tournaments.commit({ tournament: tournament({ status: 'active', clock }) });

    const stale = await repos.tournaments.commit({
      tournament: tournament({
        status: 'active',
        clock: { ...clock, revision: 3, remainingMs: 2 },
      }),
      events: [participantsChanged(1)],
      expectedClockRevision: 2,
    });
    expect(stale).toMatchObject({ ok: false, reason: 'conflict', current: { clock } });
    expect(await repos.events.listByTournament('t1')).toEqual([]);

    const fresh = await repos.tournaments.commit({
      tournament: tournament({ status: 'active', clock: { ...clock, revision: 4 } }),
      expectedClockRevision: 3,
    });
    expect(fresh.ok).toBe(true);
  });

  it('rejects invalid records on write', async () => {
    const { repos } = await openTestStorage();
    await expect(
      repos.tournaments.commit({
        tournament: tournament({ participants: { count: 2, remaining: 3 } }),
      }),
    ).rejects.toThrow();
    expect(await repos.tournaments.list()).toEqual([]);
  });

  it('writes nothing when any part of a change is invalid', async () => {
    const { repos } = await openTestStorage();
    const bad = { type: 'participants_changed', at: T0, payload: {} } as unknown as EventDraft;
    await expect(
      repos.tournaments.commit({ tournament: tournament(), schedules: [basic], events: [bad] }),
    ).rejects.toThrow();
    await expect(repos.events.append('t1', [bad])).rejects.toThrow();
    expect(await repos.tournaments.list()).toEqual([]);
    expect(await repos.schedules.get(basic.id)).toBeUndefined();
  });

  it('deletes a tournament with its events and every schedule snapshot it references', async () => {
    const { repos } = await openTestStorage();
    const edited = schedule([segment('l1', 'level', 20)], 'sched-2');
    const unrelated = schedule([segment('x', 'level', 5)], 'sched-other');
    await repos.schedules.put(unrelated);
    await repos.tournaments.commit({
      tournament: tournament({ scheduleId: edited.id }),
      schedules: [basic, edited],
      events: [
        {
          type: 'schedule_edited',
          at: T0,
          payload: {
            beforeScheduleId: basic.id,
            afterScheduleId: edited.id,
            segmentIndex: 0,
            restartCurrent: false,
            detail: null,
          },
        },
      ],
    });
    await repos.tournaments.commit({
      tournament: tournament({ id: 't2' }),
      events: [participantsChanged(3)],
    });

    await repos.tournaments.delete('t1');
    expect(await repos.tournaments.get('t1')).toBeUndefined();
    expect(await repos.events.listByTournament('t1')).toEqual([]);
    expect(await repos.schedules.get(basic.id)).toBeUndefined();
    expect(await repos.schedules.get(edited.id)).toBeUndefined();
    expect(await repos.schedules.get(unrelated.id)).toEqual(unrelated);
    expect(await repos.events.listByTournament('t2')).toHaveLength(1);
  });

  it('quarantines unreadable records, keeps loading the rest, and never throws', async () => {
    const { db, repos } = await openTestStorage();
    await repos.tournaments.commit({ tournament: tournament() });
    await db.put('tournaments', { id: 'broken', schemaVersion: 1, status: 'nonsense' });
    await db.put('tournaments', { id: 'future', schemaVersion: 99 });

    expect((await repos.tournaments.list()).map((t) => t.id)).toEqual(['t1']);
    const quarantined = await repos.quarantine.list();
    expect(quarantined.map((q) => [q.store, q.key])).toEqual([
      ['tournaments', 'broken'],
      ['tournaments', 'future'],
    ]);
    expect(quarantined[0]).toMatchObject({
      raw: { id: 'broken', status: 'nonsense' },
      error: expect.stringContaining('status'),
      quarantinedAt: T0,
    });
    expect(await db.getKey('tournaments', 'broken')).toBeUndefined();
    expect(await repos.tournaments.get('future')).toBeUndefined();

    await repos.quarantine.delete(quarantined[0]?.id ?? '');
    expect(await repos.quarantine.list()).toHaveLength(1);
    await repos.quarantine.clear();
    expect(await repos.quarantine.list()).toEqual([]);
  });

  it('quarantines a corrupted event without hiding the others', async () => {
    const { db, repos } = await openTestStorage();
    await repos.events.append('t1', [participantsChanged(5), participantsChanged(4)]);
    const [first] = await repos.events.listByTournament('t1');
    await db.put('events', { ...first, type: 'mystery' });

    expect((await repos.events.listByTournament('t1')).map((e) => e.seq)).toEqual([1]);
    expect((await repos.quarantine.list()).map((q) => q.store)).toEqual(['events']);
  });

  it('migrates old records lazily on read and writes them back', async () => {
    const name = uniqueDbName();
    const db = await openDatabase(name);
    const V2 = z.object({ id: z.string(), schemaVersion: z.literal(2), label: z.string() });
    const repos = createRepositories(db, {
      inventory: {
        name: 'inventory',
        version: 2,
        schema: V2,
        migrations: { 1: ({ title, ...rest }) => ({ ...rest, label: String(title) }) },
      },
    });
    await db.put('inventories', { id: 'inv', schemaVersion: 1, title: 'Home set' });

    expect(await repos.inventories.get('inv')).toEqual({
      id: 'inv',
      schemaVersion: 2,
      label: 'Home set',
    });
    expect(await db.get('inventories', 'inv')).toEqual({
      id: 'inv',
      schemaVersion: 2,
      label: 'Home set',
    });
    expect(await repos.inventories.list()).toHaveLength(1);
  });

  it('round-trips inventories and presets', async () => {
    const { repos } = await openTestStorage();
    await repos.inventories.put({ id: 'inv', schemaVersion: 1, name: 'Home set' });
    const preset = {
      id: 'p1',
      schemaVersion: 1 as const,
      name: 'Friday',
      moduleId: 'test',
      moduleVersion: '1',
      presetVersion: 1,
      config: {},
      createdAt: T0,
      updatedAt: T0,
    };
    await repos.presets.put(preset);
    expect(await repos.inventories.list()).toEqual([
      { id: 'inv', schemaVersion: 1, name: 'Home set' },
    ]);
    expect(await repos.presets.get('p1')).toEqual(preset);
    await repos.presets.delete('p1');
    await repos.inventories.delete('inv');
    expect(await repos.presets.list()).toEqual([]);
    expect(await repos.inventories.get('inv')).toBeUndefined();
  });

  it('returns default settings until updated, then merges patches', async () => {
    const { repos } = await openTestStorage();
    expect(await repos.settings.get()).toEqual({ id: 'app', schemaVersion: 1 });
    await repos.settings.update({ tone: 'neutral' });
    await repos.settings.update({ storagePersistence: 'granted' });
    expect(await repos.settings.get()).toEqual({
      id: 'app',
      schemaVersion: 1,
      tone: 'neutral',
      storagePersistence: 'granted',
    });
  });

  it('keeps data across reopening the database', async () => {
    const { db, repos, name } = await openTestStorage();
    await repos.tournaments.commit({ tournament: tournament(), events: [participantsChanged(5)] });
    db.close();
    const reopened = await openTestStorage(name);
    expect(await reopened.repos.tournaments.get('t1')).toEqual(tournament());
    expect(await reopened.repos.events.listByTournament('t1')).toHaveLength(1);
  });
});

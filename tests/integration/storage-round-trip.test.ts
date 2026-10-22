import type { ModuleContext } from '@/core/modules/contract';
import { MINUTE } from '@/core/time';
import { next, start } from '@/core/timer/commands';
import { deriveClock } from '@/core/timer/derive-clock';
import { applyClockCommand, transition } from '@/core/tournaments/lifecycle';
import type { Tournament } from '@/core/tournaments/tournament';
import { exportBackup, importBackup } from '@/infrastructure/backup/backup';
import {
  openTestStorage,
  sequentialIds,
  testInventoryRecord,
} from '@/infrastructure/testing/storage';
import { mockRoundsModule } from '../fixtures/mock-rounds-module';

// M2 exit criterion: a mock-module tournament round-trips through storage at every step.
const T0 = 1_700_000_000_000;
const ctx: ModuleContext = { clock: { now: () => T0 }, newId: sequentialIds('gen') };

describe('mock rounds tournament through IndexedDB', () => {
  it('persists every transition and command, then survives reopen and backup restore', async () => {
    const storage = await openTestStorage();
    const { repos } = storage;
    const config = mockRoundsModule.configSchema.parse({
      rounds: 3,
      roundMinutes: 10,
      pointsPerRound: 5,
      breakMinutes: 5,
    });
    const { schedule, report } = mockRoundsModule.generateSchedule(config, ctx);

    let t: Tournament = {
      id: 'mock-1',
      schemaVersion: 1,
      moduleId: mockRoundsModule.id,
      moduleVersion: mockRoundsModule.version,
      status: 'draft',
      config,
      scheduleId: schedule.id,
      allocation: undefined,
      participants: { count: 4, remaining: 4 },
      settings: { breakEndBehaviour: 'auto' },
      createdAt: T0,
      updatedAt: T0,
    };
    await repos.tournaments.commit({ tournament: t, schedules: [schedule] });

    // Each step is written as one change, the way the app will (spec 02 §7.5).
    const save = async (r: {
      tournament: Tournament;
      events: Parameters<typeof repos.events.append>[1];
    }) => {
      const expectedClockRevision = t.clock?.revision;
      t = r.tournament;
      const result = await repos.tournaments.commit({
        tournament: t,
        events: r.events,
        ...(expectedClockRevision !== undefined && r.tournament.clock
          ? { expectedClockRevision }
          : {}),
      });
      expect(result.ok).toBe(true);
      expect(await repos.tournaments.get(t.id)).toEqual(t);
    };

    const scheduleReport = mockRoundsModule.validateSchedule(schedule, config, ctx);
    await save(
      transition(
        t,
        { action: 'markReady', readiness: { schedule, config: report, scheduleReport } },
        T0,
      ),
    );
    await save(transition(t, { action: 'start', schedule }, T0));
    await save(applyClockCommand(t, schedule, T0, start));
    await save(applyClockCommand(t, schedule, T0 + 4 * MINUTE, next));

    // Reopen as a fresh page load would and derive the clock from what was stored.
    storage.db.close();
    const reopened = await openTestStorage(storage.name);
    const stored = await reopened.repos.tournaments.get('mock-1');
    const storedSchedule = await reopened.repos.schedules.get(stored?.scheduleId ?? '');
    expect(stored).toEqual(t);
    expect(storedSchedule).toEqual(schedule);
    if (!stored?.clock || !storedSchedule || !t.clock) throw new Error('expected stored clock');
    const now = T0 + 6 * MINUTE;
    const opts = { breakEndBehaviour: stored.settings.breakEndBehaviour };
    expect(deriveClock(storedSchedule, stored.clock, now, opts)).toEqual(
      deriveClock(schedule, t.clock, now, opts),
    );

    const events = await reopened.repos.events.listByTournament('mock-1');
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(events.filter((e) => e.type === 'lifecycle_transition')).toHaveLength(2);

    // A backup restored into a different browser profile reproduces the same data.
    const backup = await exportBackup(reopened.repos, ctx.clock);
    const restored = await openTestStorage();
    const result = await importBackup(restored.db, JSON.stringify(backup), {
      inventory: testInventoryRecord,
    });
    expect(result.ok).toBe(true);
    expect(await restored.repos.tournaments.get('mock-1')).toEqual(t);
    expect(await restored.repos.events.listByTournament('mock-1')).toEqual(events);
  });
});

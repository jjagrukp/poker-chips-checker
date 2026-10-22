import { EventDraftSchema, type EventDraft } from '@/core/events/events';
import type { ModuleContext } from '@/core/modules/contract';
import { createModuleRegistry } from '@/core/modules/registry';
import { ScheduleSchema } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import { next, recover, start } from '@/core/timer/commands';
import { deriveClock } from '@/core/timer/derive-clock';
import { applyClockCommand, transition } from '@/core/tournaments/lifecycle';
import { TournamentSchema, type Tournament } from '@/core/tournaments/tournament';
import { isValid } from '@/core/validation/report';
import { mockRoundsModule } from '../fixtures/mock-rounds-module';

// Extensibility test (spec 02 §4): a non-poker module goes through the whole generic core.
const T0 = 1_700_000_000_000;
let ids = 0;
const ctx: ModuleContext = { clock: { now: () => T0 }, newId: () => `id-${++ids}` };

describe('mock rounds module through the generic core', () => {
  const registry = createModuleRegistry([mockRoundsModule]);
  const module = registry.require('mock-rounds');

  it('registers and validates its config', () => {
    expect(registry.list().map((m) => m.id)).toEqual(['mock-rounds']);
    const config = module.configSchema.parse(
      module.defaults({ players: 6, targetDurationMin: 60 }),
    );
    expect(isValid(module.validateConfig(config, ctx))).toBe(true);

    const tooMany = module.configSchema.parse({
      rounds: 51,
      roundMinutes: 1,
      pointsPerRound: 1,
      breakMinutes: 5,
    });
    const report = module.validateConfig(tooMany, ctx);
    expect(report.errors.map((e) => e.code)).toEqual(['tooManyRounds']);
    expect(report.warnings.map((w) => w.code)).toEqual(['shortRounds']);
    expect(module.configSchema.safeParse({ rounds: 'x' }).success).toBe(false);
  });

  it('generates a valid schedule and runs a tournament through deriveClock', () => {
    const config = module.configSchema.parse({
      rounds: 4,
      roundMinutes: 10,
      pointsPerRound: 5,
      breakEveryRounds: 2,
      breakMinutes: 5,
    });
    const { schedule, report } = module.generateSchedule(config, ctx);
    expect(isValid(report)).toBe(true);
    expect(ScheduleSchema.parse(schedule)).toEqual(schedule);
    expect(schedule.segments.map((s) => s.id)).toEqual([
      'round-1',
      'round-2',
      'break-after-2',
      'round-3',
      'round-4',
    ]);
    expect(isValid(module.validateSchedule(schedule, config, ctx))).toBe(true);

    const events: EventDraft[] = [];
    let t: Tournament = {
      id: 't1',
      schemaVersion: 1,
      moduleId: module.id,
      moduleVersion: module.version,
      status: 'draft',
      config,
      scheduleId: schedule.id,
      allocation: undefined,
      participants: { count: 6, remaining: 6 },
      settings: { breakEndBehaviour: 'auto' },
      createdAt: T0,
      updatedAt: T0,
    };
    const step = (r: { tournament: Tournament; events: EventDraft[] }) => {
      t = r.tournament;
      events.push(...r.events);
    };

    step(
      transition(
        t,
        {
          action: 'markReady',
          readiness: {
            schedule,
            config: report,
            scheduleReport: module.validateSchedule(schedule, config, ctx),
          },
        },
        T0,
      ),
    );
    step(transition(t, { action: 'start', schedule }, T0));
    step(applyClockCommand(t, schedule, T0, start));
    const opts = { breakEndBehaviour: t.settings.breakEndBehaviour };
    if (!t.clock) throw new Error('expected a clock');

    // 27 minutes in: round 1, round 2 and the break have passed.
    expect(deriveClock(schedule, t.clock, T0 + 27 * MINUTE, opts)).toMatchObject({
      segmentIndex: 3,
      remainingMs: 8 * MINUTE,
    });
    step(
      applyClockCommand(
        t,
        schedule,
        T0 + 27 * MINUTE,
        (s, now) => recover(s, now) ?? { anchor: s.anchor, events: [] },
      ),
    );
    step(applyClockCommand(t, schedule, T0 + 28 * MINUTE, next));
    expect(deriveClock(schedule, t.clock, T0 + 99 * MINUTE, opts)).toMatchObject({
      segmentIndex: 4,
      overtimeMs: 61 * MINUTE,
    });
    step(transition(t, { action: 'complete' }, T0 + 99 * MINUTE));

    expect(TournamentSchema.parse(t).status).toBe('completed');
    events.forEach((e) => EventDraftSchema.parse(e));
    expect(
      events.flatMap((e) => (e.type === 'lifecycle_transition' ? [e.payload.to] : [])),
    ).toEqual(['ready', 'active', 'completed']);
    expect(events.some((e) => e.type === 'recovered')).toBe(true);
  });

  it('flags a schedule that ends on a break', () => {
    const config = module.configSchema.parse({
      rounds: 1,
      roundMinutes: 10,
      pointsPerRound: 1,
      breakMinutes: 5,
    });
    const { schedule } = module.generateSchedule(config, ctx);
    const extraBreak = {
      id: 'b',
      kind: 'break' as const,
      durationMs: MINUTE,
      display: { title: 'b', lines: [] },
      data: null,
    };
    const broken = { ...schedule, segments: [...schedule.segments, extraBreak] };
    expect(module.validateSchedule(broken, config, ctx).errors.map((e) => e.code)).toEqual([
      'endsOnBreak',
    ]);
  });
});

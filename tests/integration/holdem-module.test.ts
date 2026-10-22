import { EventDraftSchema, type EventDraft } from '@/core/events/events';
import type { ModuleContext } from '@/core/modules/contract';
import { createModuleRegistry } from '@/core/modules/registry';
import { MINUTE } from '@/core/time';
import { start } from '@/core/timer/commands';
import { deriveClock } from '@/core/timer/derive-clock';
import { applyClockCommand, applyScheduleEdit, transition } from '@/core/tournaments/lifecycle';
import { TournamentSchema, type Tournament } from '@/core/tournaments/tournament';
import { isValid } from '@/core/validation/report';
import { extend } from '@/modules/texas-holdem/edits';
import { texasHoldemModule } from '@/modules/texas-holdem/module';
import { mockRoundsModule } from '../fixtures/mock-rounds-module';

// The Hold'em module through the generic core: register, configure, run, extend in overtime.
const T0 = 1_700_000_000_000;
let ids = 0;
const ctx: ModuleContext = { clock: { now: () => T0 }, newId: () => `id-${++ids}` };

describe("Texas Hold'em module through the generic core", () => {
  it('registers alongside other modules and runs a tournament', () => {
    const registry = createModuleRegistry([texasHoldemModule, mockRoundsModule]);
    const module = registry.require('texas-holdem');
    const config = texasHoldemModule.configSchema.parse(
      module.defaults({ players: 6, targetDurationMin: 180 }),
    );
    const configReport = module.validateConfig(config, ctx);
    const { schedule, report } = module.generateSchedule(config, ctx);
    expect(isValid(configReport) && isValid(report)).toBe(true);

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
          readiness: { schedule, config: configReport, scheduleReport: report },
        },
        T0,
      ),
    );
    step(transition(t, { action: 'start', schedule }, T0));
    step(applyClockCommand(t, schedule, T0, start));
    if (!t.clock) throw new Error('expected a clock');
    const opts = { breakEndBehaviour: 'auto' as const };

    // Five 12-minute levels, then the 10-minute break.
    expect(deriveClock(schedule, t.clock, T0 + 61 * MINUTE, opts)).toMatchObject({
      segmentIndex: 5,
      remainingMs: 9 * MINUTE,
    });

    // Run past the end (20 levels + 3 breaks = 270 min), then extend for overtime.
    const late = T0 + 280 * MINUTE;
    expect(deriveClock(schedule, t.clock, late, opts)).toMatchObject({
      segmentIndex: schedule.segments.length - 1,
      overtimeMs: 10 * MINUTE,
    });
    const extended = extend(schedule, config, ctx, 2);
    expect(isValid(extended.report)).toBe(true);
    step(applyScheduleEdit(t, schedule, extended.schedule, late, { restartCurrent: false }));
    expect(t.scheduleId).toBe(extended.schedule.id);
    if (!t.clock) throw new Error('expected a clock');
    // The overtime level ends now, so the first added level has just begun.
    expect(deriveClock(extended.schedule, t.clock, late, opts)).toMatchObject({
      segmentIndex: schedule.segments.length,
      overtimeMs: 0,
    });

    expect(TournamentSchema.parse(t).status).toBe('active');
    events.forEach((e) => EventDraftSchema.parse(e));
    expect(events.some((e) => e.type === 'schedule_edited')).toBe(true);
  });
});

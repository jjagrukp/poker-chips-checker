import fc from 'fast-check';
import { schedule, segment, T0 } from '@/core/testing/schedules';
import type { Schedule } from '@/core/scheduling/schedule';
import { ClockAnchorSchema, type ClockAnchor, type DeriveOptions } from './anchor';
import * as commands from './commands';
import { deriveClock, normalise } from './derive-clock';

const MAX_GAP = 3 * 60 * 60 * 1000;

const scheduleArb: fc.Arbitrary<Schedule> = fc
  .array(
    fc.record({
      kind: fc.constantFrom('level', 'break'),
      minutes: fc.integer({ min: 1, max: 30 }),
    }),
    {
      minLength: 1,
      maxLength: 8,
    },
  )
  .map((specs) =>
    schedule(specs.map((s, i) => segment(`s${i}`, s.kind as 'level' | 'break', s.minutes))),
  );

const optionsArb: fc.Arbitrary<DeriveOptions> = fc.constantFrom<DeriveOptions>(
  { breakEndBehaviour: 'auto' },
  { breakEndBehaviour: 'waitForHost' },
);

type Run = (s: commands.ClockState, now: number, ms: number) => commands.CommandResult;
const RUNS: Run[] = [
  commands.start,
  commands.pause,
  commands.resume,
  commands.next,
  commands.previous,
  commands.endBreak,
  commands.startBreakNow,
  commands.extendBreak,
];
const stepArb = fc.record({
  gap: fc.integer({ min: 0, max: MAX_GAP }),
  run: fc.constantFrom(...RUNS),
  ms: fc.integer({ min: 1, max: 30 * 60 * 1000 }),
});
type Step = { gap: number; run: Run; ms: number };

/** Plays a random command sequence, skipping commands that are invalid in the current state. */
function play(sched: Schedule, options: DeriveOptions, sequence: Step[]) {
  let anchor: ClockAnchor = commands.initialAnchor(sched, T0);
  let now = T0;
  const anchors = [anchor];
  for (const step of sequence) {
    now += step.gap;
    try {
      anchor = step.run({ schedule: sched, anchor, options }, now, step.ms).anchor;
      anchors.push(anchor);
    } catch (e) {
      if (!(e instanceof commands.InvalidClockCommand)) throw e;
    }
  }
  return { anchor, now, anchors };
}

describe('timer properties', () => {
  it('every anchor produced by commands is valid and revisions increase', () => {
    fc.assert(
      fc.property(
        scheduleArb,
        optionsArb,
        fc.array(stepArb, { maxLength: 30 }),
        (sched, options, sequence) => {
          const { anchors } = play(sched, options, sequence);
          anchors.forEach((a, i) => {
            expect(ClockAnchorSchema.safeParse(a).success).toBe(true);
            if (i > 0) expect(a.revision).toBeGreaterThan(anchors[i - 1]?.revision ?? Infinity);
          });
        },
      ),
    );
  });

  it('derived views stay within bounds', () => {
    fc.assert(
      fc.property(
        scheduleArb,
        optionsArb,
        fc.array(stepArb, { maxLength: 30 }),
        fc.integer({ min: 0, max: MAX_GAP }),
        (sched, options, sequence, later) => {
          const { anchor, now } = play(sched, options, sequence);
          const view = deriveClock(sched, anchor, now + later, options);
          expect(view.segmentIndex).toBeLessThan(sched.segments.length);
          expect(view.remainingMs).toBeGreaterThanOrEqual(0);
          expect(view.overtimeMs).toBeGreaterThanOrEqual(0);
          if (view.overtimeMs > 0) expect(view.remainingMs).toBe(0);
          const current = sched.segments[view.segmentIndex];
          if (current?.kind === 'level' && !view.inInterlude) {
            expect(view.remainingMs).toBeLessThanOrEqual(current.durationMs);
          }
        },
      ),
    );
  });

  it('deriving is path-independent: re-anchoring at t1 does not change the view at t2', () => {
    fc.assert(
      fc.property(
        scheduleArb,
        optionsArb,
        fc.array(stepArb, { maxLength: 20 }),
        fc.integer({ min: 0, max: MAX_GAP }),
        fc.integer({ min: 0, max: MAX_GAP }),
        (sched, options, sequence, d1, d2) => {
          const { anchor, now } = play(sched, options, sequence);
          const t1 = now + d1;
          const t2 = t1 + d2;
          const direct = deriveClock(sched, anchor, t2, options);
          const via = deriveClock(sched, normalise(sched, anchor, t1, options).anchor, t2, options);
          const pick = ({
            segmentIndex,
            remainingMs,
            status,
            inInterlude,
            overtimeMs,
          }: typeof direct) => ({
            segmentIndex,
            remainingMs,
            status,
            inInterlude,
            overtimeMs,
          });
          expect(pick(via)).toEqual(pick(direct));
        },
      ),
    );
  });

  it('an uninterrupted run accounts for every millisecond', () => {
    fc.assert(
      fc.property(scheduleArb, fc.integer({ min: 0, max: 5 * MAX_GAP }), (sched, elapsed) => {
        const running = commands.start(
          {
            schedule: sched,
            anchor: commands.initialAnchor(sched, T0),
            options: { breakEndBehaviour: 'auto' },
          },
          T0,
        ).anchor;
        const view = deriveClock(sched, running, T0 + elapsed, { breakEndBehaviour: 'auto' });
        const before = sched.segments
          .slice(0, view.segmentIndex)
          .reduce((sum, s) => sum + s.durationMs, 0);
        const current = sched.segments[view.segmentIndex]?.durationMs ?? Number.NaN;
        expect(before + (current - view.remainingMs) + view.overtimeMs).toBe(elapsed);
      }),
    );
  });

  it('pausing for any gap shifts the timeline by exactly that gap', () => {
    fc.assert(
      fc.property(
        scheduleArb,
        fc.integer({ min: 0, max: MAX_GAP }),
        fc.integer({ min: 0, max: MAX_GAP }),
        fc.integer({ min: 0, max: MAX_GAP }),
        (sched, t1, gap, d) => {
          const options: DeriveOptions = { breakEndBehaviour: 'auto' };
          const running = commands.start(
            { schedule: sched, anchor: commands.initialAnchor(sched, T0), options },
            T0,
          ).anchor;
          const paused = commands.pause({ schedule: sched, anchor: running, options }, T0 + t1);
          // Paused in overtime loses the overtime count by design; compare only pre-overtime.
          fc.pre(deriveClock(sched, running, T0 + t1, options).overtimeMs === 0);
          const resumed = commands.resume(
            { schedule: sched, anchor: paused.anchor, options },
            T0 + t1 + gap,
          ).anchor;
          const a = deriveClock(sched, resumed, T0 + t1 + gap + d, options);
          const b = deriveClock(sched, running, T0 + t1 + d, options);
          expect([a.segmentIndex, a.remainingMs, a.overtimeMs]).toEqual([
            b.segmentIndex,
            b.remainingMs,
            b.overtimeMs,
          ]);
        },
      ),
    );
  });
});

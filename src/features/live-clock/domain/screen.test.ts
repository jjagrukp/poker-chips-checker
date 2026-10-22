import { MINUTE, SECOND } from '@/core/time';
import { initialAnchor, start, startBreakNow } from '@/core/timer/commands';
import { deriveClock } from '@/core/timer/derive-clock';
import { setLevel } from '@/modules/texas-holdem/edits';
import { holdemConfig, holdemSchedule, readyTournament, settableClock, T0 } from '../testing/fixtures';
import {
  changeRemaining,
  checkRunningEdit,
  classifyTick,
  clockScreen,
  countPassed,
  displayKey,
  endsCurrentNow,
  formatCountdown,
  formatElapsed,
} from './screen';

const schedule = holdemSchedule();
const config = holdemConfig();
const options = { breakEndBehaviour: 'auto' as const };
const running = start({ schedule, anchor: initialAnchor(schedule, T0), options }, T0).anchor;
const at = (now: number, anchor = running, t = readyTournament()) =>
  clockScreen(schedule, anchor, deriveClock(schedule, anchor, now, options), t, config);

describe('clockScreen', () => {
  it('shows blinds, next level, time to break and average stack', () => {
    const m = at(T0 + 4 * MINUTE);
    expect(m.segment.id).toBe('l1');
    expect(m.blinds).toEqual({ sb: 25, bb: 50, ante: 0 });
    expect(m.next?.segment.id).toBe('l2');
    expect(m.untilBreakMs).toBe(16 * MINUTE);
    // 6 × 10,000 chips over 6 players at BB 50.
    expect(m.averageStackBB).toBe(200);
  });

  it('measures the average stack against the next level during a scheduled break', () => {
    const t = readyTournament({ participants: { count: 6, remaining: 3 } });
    const m = at(T0 + 21 * MINUTE, running, t);
    expect(m.segment.kind).toBe('break');
    expect(m.blinds).toBeUndefined();
    expect(m.untilBreakMs).toBeUndefined();
    expect(m.averageStackBB).toBe(100);
  });

  it('has no next break or next segment on the last level', () => {
    const m = at(T0 + 30 * MINUTE);
    expect(m.segment.id).toBe('l3');
    expect(m.next).toBeUndefined();
    expect(m.untilBreakMs).toBeUndefined();
  });

  it('hides time to break during an ad-hoc break and skips the stack without config', () => {
    const onBreak = startBreakNow({ schedule, anchor: running, options }, T0 + MINUTE, 5 * MINUTE)
      .anchor;
    expect(at(T0 + 2 * MINUTE, onBreak).untilBreakMs).toBeUndefined();
    const view = deriveClock(schedule, running, T0, options);
    expect(clockScreen(schedule, running, view, readyTournament(), undefined).averageStackBB).toBe(
      undefined,
    );
  });
});

describe('formatting', () => {
  it('rounds countdowns up and elapsed time down', () => {
    expect(formatCountdown(9 * MINUTE + 1)).toBe('09:01');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5)).toBe('00:00');
    expect(formatCountdown(65 * MINUTE)).toBe('1:05:00');
    expect(formatElapsed(61 * SECOND - 1)).toBe('01:00');
  });

  it('changes the display key only when the shown second changes', () => {
    const view = deriveClock(schedule, running, T0 + 100, options);
    const later = deriveClock(schedule, running, T0 + 900, options);
    const nextSecond = deriveClock(schedule, running, T0 + 1100, options);
    expect(displayKey(view)).toBe(displayKey(later));
    expect(displayKey(view)).not.toBe(displayKey(nextSecond));
  });
});

describe('classifyTick', () => {
  it('treats forward jumps as waking up and backward jumps as clock changes', () => {
    expect(classifyTick(250, 250)).toBe('ok');
    expect(classifyTick(5_250, 250)).toBe('ok');
    // Monotonic clock stopped while the device slept.
    expect(classifyTick(30 * MINUTE, 250)).toBe('wake');
    expect(classifyTick(-MINUTE, 250)).toBe('skew');
  });
});

describe('countPassed', () => {
  it('counts levels and breaks separately', () => {
    expect(countPassed(schedule, ['l1', 'l2', 'b1'])).toEqual({ levels: 2, breaks: 1 });
    expect(countPassed(schedule, [])).toEqual({ levels: 0, breaks: 0 });
  });
});

describe('changeRemaining', () => {
  it('clamps between 1 and the player count and logs the change', () => {
    const t = readyTournament();
    expect(changeRemaining(t, 1, T0)).toBeNull();
    const out = changeRemaining(t, -2, T0 + 5);
    expect(out?.tournament.participants).toEqual({ count: 6, remaining: 4 });
    expect(out?.events).toEqual([
      { type: 'participants_changed', at: T0 + 5, payload: { count: 6, remaining: 4 } },
    ]);
    const one = readyTournament({ participants: { count: 6, remaining: 1 } });
    expect(changeRemaining(one, -1, T0)).toBeNull();
  });
});

describe('running edits', () => {
  const { ctx } = settableClock();

  it('rejects content changes to past levels but allows the current and later ones', () => {
    const pastEdit = setLevel(schedule, config, ctx, 0, {
      sb: 50,
      bb: 100,
      ante: 0,
      durationMin: 10,
    }).schedule;
    expect(checkRunningEdit(schedule, pastEdit, 1)).toBe('pastChanged');
    expect(checkRunningEdit(schedule, pastEdit, 0)).toBe('ok');
    const reordered = { ...schedule, segments: [...schedule.segments].reverse() };
    expect(checkRunningEdit(schedule, reordered, 0)).toBe('pastChanged');
  });

  it('ignores key order differences from storage', () => {
    const shuffled = {
      ...schedule,
      segments: schedule.segments.map((s) => Object.fromEntries(Object.entries(s).reverse())),
    } as typeof schedule;
    expect(checkRunningEdit(schedule, shuffled, 3)).toBe('ok');
  });

  it('flags edits that make the current level shorter than the time played', () => {
    const shorter = setLevel(schedule, config, ctx, 0, {
      sb: 25,
      bb: 50,
      ante: 0,
      durationMin: 5,
    }).schedule;
    // 6 minutes played (4 left of 10).
    expect(endsCurrentNow(schedule, shorter, 0, 4 * MINUTE)).toBe(true);
    expect(endsCurrentNow(schedule, shorter, 0, 6 * MINUTE)).toBe(false);
    expect(endsCurrentNow(schedule, shorter, 9, 0)).toBe(false);
  });
});

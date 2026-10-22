import { basic, T0 } from '@/core/testing/schedules';
import { MINUTE, SECOND } from '@/core/time';
import { ClockAnchorSchema, type ClockAnchor } from './anchor';
import { CorruptAnchor, deriveClock, freeze, normalise } from './derive-clock';

const auto = { breakEndBehaviour: 'auto' } as const;
const wait = { breakEndBehaviour: 'waitForHost' } as const;

const running = (segmentIndex: number, deadline: number, updatedAt = T0): ClockAnchor => ({
  status: 'running',
  segmentIndex,
  deadline,
  revision: 1,
  updatedAt,
});

describe('deriveClock', () => {
  it('idle and paused anchors never change', () => {
    const idle: ClockAnchor = {
      status: 'idle',
      segmentIndex: 0,
      remainingMs: 10 * MINUTE,
      revision: 0,
      updatedAt: T0,
    };
    const n = normalise(basic, idle, T0 + 99 * MINUTE, auto);
    expect(n.anchor).toBe(idle);
    expect(n.view).toMatchObject({ status: 'idle', remainingMs: 10 * MINUTE, overtimeMs: 0 });

    const paused: ClockAnchor = { ...idle, status: 'paused', segmentIndex: 1, remainingMs: 42 };
    expect(deriveClock(basic, paused, T0 + 99 * MINUTE, auto)).toMatchObject({
      status: 'paused',
      segmentIndex: 1,
      remainingMs: 42,
    });
  });

  it('reports awaitingHost for a paused anchor held at its segment', () => {
    const held: ClockAnchor = {
      status: 'paused',
      segmentIndex: 3,
      remainingMs: 10 * MINUTE,
      holdAtIndex: 3,
      revision: 1,
      updatedAt: T0,
    };
    expect(deriveClock(basic, held, T0, auto).status).toBe('awaitingHost');
    expect(deriveClock(basic, { ...held, holdAtIndex: 1 }, T0, auto).status).toBe('paused');
  });

  it('counts down within the current segment', () => {
    const view = deriveClock(basic, running(0, T0 + 10 * MINUTE), T0 + 3 * MINUTE, auto);
    expect(view).toMatchObject({
      status: 'running',
      segmentIndex: 0,
      remainingMs: 7 * MINUTE,
      passedSegmentIds: [],
    });
  });

  it('catches up across levels and scheduled breaks', () => {
    const n = normalise(basic, running(0, T0 + 10 * MINUTE), T0 + 27 * MINUTE, auto);
    expect(n.view).toMatchObject({ segmentIndex: 3, remainingMs: 8 * MINUTE, status: 'running' });
    expect(n.view.passedSegmentIds).toEqual(['l1', 'l2', 'b1']);
    expect(n.started.map((s) => [s.segmentId, s.at])).toEqual([
      ['l2', T0 + 10 * MINUTE],
      ['b1', T0 + 20 * MINUTE],
      ['l3', T0 + 25 * MINUTE],
    ]);
    expect(n.anchor).toMatchObject({
      segmentIndex: 3,
      deadline: T0 + 35 * MINUTE,
      revision: 1,
      updatedAt: T0,
    });
  });

  it('treats a deadline equal to now as ended', () => {
    expect(deriveClock(basic, running(0, T0 + 10 * MINUTE), T0 + 10 * MINUTE, auto)).toMatchObject({
      segmentIndex: 1,
      remainingMs: 10 * MINUTE,
    });
  });

  it('stops after a scheduled break when waiting for the host', () => {
    const n = normalise(basic, running(1, T0 + 10 * MINUTE), T0 + 60 * MINUTE, wait);
    expect(n.view).toMatchObject({
      status: 'awaitingHost',
      segmentIndex: 3,
      remainingMs: 10 * MINUTE,
    });
    expect(n.view.passedSegmentIds).toEqual(['l2', 'b1']);
    expect(n.anchor).toEqual({
      status: 'paused',
      segmentIndex: 3,
      remainingMs: 10 * MINUTE,
      holdAtIndex: 3,
      revision: 1,
      updatedAt: T0,
    });
  });

  it('runs into overtime on the last segment without inventing levels', () => {
    const n = normalise(basic, running(3, T0 + 10 * MINUTE), T0 + 12 * MINUTE, auto);
    expect(n.view).toMatchObject({
      status: 'running',
      segmentIndex: 3,
      remainingMs: 0,
      overtimeMs: 2 * MINUTE,
      passedSegmentIds: ['l3'],
    });
    expect(n.anchor.deadline).toBe(T0 + 10 * MINUTE);
  });

  it('does not report segments that ended before the anchor was written', () => {
    const anchor = running(3, T0 + 10 * MINUTE, T0 + 11 * MINUTE);
    expect(deriveClock(basic, anchor, T0 + 12 * MINUTE, auto).passedSegmentIds).toEqual([]);
  });

  describe('clock skew', () => {
    it('tolerates small backwards jumps', () => {
      const view = deriveClock(basic, running(0, T0 + 10 * MINUTE, T0), T0 - 4 * SECOND, auto);
      expect(view).toMatchObject({
        status: 'running',
        remainingMs: 10 * MINUTE + 4 * SECOND,
        clockWentBackwards: false,
      });
    });

    it('freezes as paused at the last known moment when the clock went backwards', () => {
      const anchor = running(0, T0 + 10 * MINUTE, T0 + 2 * MINUTE);
      const n = normalise(basic, anchor, T0, auto);
      expect(n.view).toMatchObject({
        status: 'paused',
        remainingMs: 8 * MINUTE,
        clockWentBackwards: true,
      });
      expect(n.anchor).toEqual({
        status: 'paused',
        segmentIndex: 0,
        remainingMs: 8 * MINUTE,
        revision: 1,
        updatedAt: T0 + 2 * MINUTE,
      });
    });

    it('catches up to the last known moment before freezing', () => {
      const anchor = running(0, T0 + 10 * MINUTE, T0 + 15 * MINUTE);
      expect(deriveClock(basic, anchor, T0, auto)).toMatchObject({
        status: 'paused',
        segmentIndex: 1,
        remainingMs: 5 * MINUTE,
      });
    });
  });

  describe('interludes', () => {
    const inBreak = (deadline: number): ClockAnchor => ({
      status: 'running',
      segmentIndex: 1,
      interlude: { deadline, resumeLevelRemainingMs: 4 * MINUTE },
      revision: 2,
      updatedAt: T0,
    });

    it('counts down the interlude while the level waits', () => {
      const n = normalise(basic, inBreak(T0 + 5 * MINUTE), T0 + 2 * MINUTE, auto);
      expect(n.view).toMatchObject({
        status: 'running',
        inInterlude: true,
        remainingMs: 3 * MINUTE,
        segmentIndex: 1,
      });
    });

    it('auto-resumes the level when the interlude ends, then keeps catching up', () => {
      expect(deriveClock(basic, inBreak(T0 + 5 * MINUTE), T0 + 6 * MINUTE, auto)).toMatchObject({
        segmentIndex: 1,
        remainingMs: 3 * MINUTE,
        inInterlude: false,
      });
      const later = normalise(basic, inBreak(T0 + 5 * MINUTE), T0 + 10 * MINUTE, auto);
      expect(later.view).toMatchObject({ segmentIndex: 2, remainingMs: 4 * MINUTE });
      expect(later.view.passedSegmentIds).toEqual(['l2']);
      expect(later.anchor.interlude).toBeUndefined();
    });

    it('waits for the host with the level time preserved', () => {
      const n = normalise(basic, inBreak(T0 + 5 * MINUTE), T0 + 30 * MINUTE, wait);
      expect(n.view).toMatchObject({
        status: 'awaitingHost',
        segmentIndex: 1,
        remainingMs: 4 * MINUTE,
        inInterlude: false,
      });
    });

    it('shows a paused interlude', () => {
      const paused = freeze(inBreak(T0 + 5 * MINUTE), T0 + MINUTE);
      expect(paused.interlude).toEqual({
        remainingMs: 4 * MINUTE,
        resumeLevelRemainingMs: 4 * MINUTE,
      });
      expect(deriveClock(basic, paused, T0 + 9 * MINUTE, auto)).toMatchObject({
        status: 'paused',
        inInterlude: true,
        remainingMs: 4 * MINUTE,
      });
    });
  });

  describe('corruption', () => {
    it('rejects a segment index outside the schedule', () => {
      expect(() => deriveClock(basic, running(9, T0), T0, auto)).toThrow(CorruptAnchor);
    });

    it('rejects anchors missing the field their status needs', () => {
      const noDeadline: ClockAnchor = {
        status: 'running',
        segmentIndex: 0,
        revision: 0,
        updatedAt: T0,
      };
      expect(() => deriveClock(basic, noDeadline, T0, auto)).toThrow(CorruptAnchor);
      expect(() => deriveClock(basic, { ...noDeadline, status: 'paused' }, T0, auto)).toThrow(
        CorruptAnchor,
      );
      expect(() =>
        deriveClock(basic, { ...noDeadline, interlude: { resumeLevelRemainingMs: 0 } }, T0, auto),
      ).toThrow(CorruptAnchor);
      expect(() => freeze({ ...noDeadline, interlude: { resumeLevelRemainingMs: 0 } }, T0)).toThrow(
        CorruptAnchor,
      );
    });

    it('schema enforces the same invariants', () => {
      const base = { segmentIndex: 0, revision: 0, updatedAt: T0 };
      expect(
        ClockAnchorSchema.safeParse({ ...base, status: 'running', deadline: T0 }).success,
      ).toBe(true);
      expect(ClockAnchorSchema.safeParse({ ...base, status: 'running' }).success).toBe(false);
      expect(
        ClockAnchorSchema.safeParse({ ...base, status: 'paused', remainingMs: 1 }).success,
      ).toBe(true);
      expect(ClockAnchorSchema.safeParse({ ...base, status: 'paused' }).success).toBe(false);
      expect(
        ClockAnchorSchema.safeParse({
          ...base,
          status: 'idle',
          interlude: { remainingMs: 1, resumeLevelRemainingMs: 1 },
        }).success,
      ).toBe(false);
      expect(
        ClockAnchorSchema.safeParse({
          ...base,
          status: 'running',
          interlude: { deadline: T0, resumeLevelRemainingMs: 1 },
        }).success,
      ).toBe(true);
    });
  });
});

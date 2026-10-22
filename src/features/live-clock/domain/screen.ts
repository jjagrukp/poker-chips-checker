import type { EventDraft } from '@/core/events/events';
import type { Schedule, Segment } from '@/core/scheduling/schedule';
import { SECOND, type EpochMs, type Ms } from '@/core/time';
import type { ClockAnchor } from '@/core/timer/anchor';
import { CLOCK_SKEW_TOLERANCE_MS, type ClockView } from '@/core/timer/derive-clock';
import type { Tournament } from '@/core/tournaments/tournament';
import type { HoldemConfig, LevelData } from '@/modules/texas-holdem/config';
import { levelData } from '@/modules/texas-holdem/generate';

// Pure read-model for the live clock (spec 01 §6): what the screen shows for a derived view.

export interface ClockScreenModel {
  segment: Segment;
  /** Blinds of the current level; undefined on a scheduled break. */
  blinds: LevelData | undefined;
  next: { segment: Segment; blinds: LevelData | undefined } | undefined;
  /** Time until the next scheduled break; undefined on a break or when none is left. */
  untilBreakMs: Ms | undefined;
  /** Average stack in big blinds of the level being (or about to be) played. */
  averageStackBB: number | undefined;
}

export function clockScreen(
  schedule: Schedule,
  anchor: ClockAnchor,
  view: ClockView,
  tournament: Tournament,
  config: HoldemConfig | undefined,
): ClockScreenModel {
  const index = view.segmentIndex;
  const segment = schedule.segments[index];
  if (!segment) throw new Error(`clockScreen: no segment ${index}`);
  const following = schedule.segments[index + 1];
  const blinds = levelData(segment);
  const levelRemainingMs = levelRemaining(anchor, view);

  // On a break the stack is measured against the level that comes next.
  const playing = blinds ?? schedule.segments.slice(index + 1).map(levelData).find(Boolean);
  const { count, remaining } = tournament.participants;
  const averageStackBB =
    config && playing && playing.bb > 0 && remaining > 0
      ? (count * config.startingStack) / remaining / playing.bb
      : undefined;

  return {
    segment,
    blinds,
    next: following ? { segment: following, blinds: levelData(following) } : undefined,
    untilBreakMs:
      segment.kind === 'break' || view.inInterlude
        ? undefined
        : untilBreak(schedule, index, levelRemainingMs),
    averageStackBB,
  };
}

/** Time left in the current segment; during an ad-hoc break, the time the level resumes with. */
export function levelRemaining(anchor: ClockAnchor, view: ClockView): Ms {
  return view.inInterlude && anchor.interlude
    ? anchor.interlude.resumeLevelRemainingMs
    : view.remainingMs;
}

function untilBreak(schedule: Schedule, index: number, levelRemainingMs: Ms): Ms | undefined {
  let total = levelRemainingMs;
  for (const segment of schedule.segments.slice(index + 1)) {
    if (segment.kind === 'break') return total;
    total += segment.durationMs;
  }
  return undefined;
}

/** Countdown text: rounds up so "00:01" shows until the very end. */
export function formatCountdown(ms: Ms): string {
  return formatSeconds(Math.ceil(Math.max(0, ms) / SECOND));
}

/** Count-up text (elapsed, overtime): rounds down. */
export function formatElapsed(ms: Ms): string {
  return formatSeconds(Math.floor(Math.max(0, ms) / SECOND));
}

function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Changes whenever the displayed clock would; the ticker re-renders only then. */
export function displayKey(view: ClockView): string {
  return [
    view.segmentIndex,
    view.status,
    view.inInterlude,
    Math.ceil(view.remainingMs / SECOND),
    Math.floor(view.overtimeMs / SECOND),
  ].join('|');
}

export type TickKind = 'ok' | 'wake' | 'skew';

/**
 * Compares the wall-clock and monotonic deltas between two ticks (spec 03 §3). Some browsers
 * stop the monotonic clock while the device sleeps, so a forward jump is indistinguishable
 * from waking up: treat it as a wake (recovery trusts the wall clock). Only a backward jump is
 * a device clock change that needs re-anchoring.
 */
export function classifyTick(wallDeltaMs: Ms, monoDeltaMs: Ms): TickKind {
  const skew = wallDeltaMs - monoDeltaMs;
  if (skew > CLOCK_SKEW_TOLERANCE_MS) return 'wake';
  if (skew < -CLOCK_SKEW_TOLERANCE_MS) return 'skew';
  return 'ok';
}

export function countPassed(
  schedule: Schedule,
  passedIds: readonly string[],
): { levels: number; breaks: number } {
  const ids = new Set(passedIds);
  const passed = schedule.segments.filter((s) => ids.has(s.id));
  return {
    levels: passed.filter((s) => s.kind === 'level').length,
    breaks: passed.filter((s) => s.kind === 'break').length,
  };
}

/** Players remaining +/- (spec 01 §6); clamped to 1…count. Null when nothing changes. */
export function changeRemaining(
  tournament: Tournament,
  delta: number,
  now: EpochMs,
): { tournament: Tournament; events: EventDraft[] } | null {
  const { count, remaining } = tournament.participants;
  const next = Math.min(count, Math.max(1, remaining + delta));
  if (next === remaining) return null;
  return {
    tournament: {
      ...tournament,
      participants: { ...tournament.participants, remaining: next },
      updatedAt: now,
    },
    events: [{ type: 'participants_changed', at: now, payload: { count, remaining: next } }],
  };
}

export type RunningEditCheck = 'ok' | 'pastChanged';

/**
 * Core `editSchedule` only compares ids, so a content edit to a past level would slip through.
 * Past segments must be identical; the current one must keep its id (spec 03 §7).
 */
export function checkRunningEdit(
  before: Schedule,
  after: Schedule,
  currentIndex: number,
): RunningEditCheck {
  for (let i = 0; i <= currentIndex; i += 1) {
    const a = before.segments[i];
    const b = after.segments[i];
    if (!a || !b || a.id !== b.id) return 'pastChanged';
    if (i < currentIndex && stable(a) !== stable(b)) return 'pastChanged';
  }
  return 'ok';
}

/** JSON with sorted keys: stored segments come back in schema key order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** The edit makes the current segment shorter than the time already played (confirm first). */
export function endsCurrentNow(
  before: Schedule,
  after: Schedule,
  currentIndex: number,
  levelRemainingMs: Ms,
): boolean {
  const old = before.segments[currentIndex];
  const edited = after.segments[currentIndex];
  if (!old || !edited) return false;
  return edited.durationMs <= old.durationMs - levelRemainingMs;
}

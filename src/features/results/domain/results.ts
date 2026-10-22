import type { TournamentEvent } from '@/core/events/events';
import { MINUTE, type EpochMs, type Ms } from '@/core/time';
import type { Tournament, TournamentResults } from '@/core/tournaments/tournament';

// Results (spec 02 §6): finishing positions with optional names, and the actual duration,
// derived from the event log and editable by the host. Pure.

export const MAX_DURATION_MIN = 24 * 60;

/** Wall time from the start transition to the end one (pauses and breaks included). */
export function actualDuration(t: Tournament, events: readonly TournamentEvent[]): Ms | undefined {
  const at = (action: string) =>
    events.find((e) => e.type === 'lifecycle_transition' && e.payload.action === action)?.at;
  const start = at('start') ?? t.startedAt;
  const end = at('complete') ?? at('cancel') ?? t.endedAt;
  return start !== undefined && end !== undefined && end >= start ? end - start : undefined;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Form state kept as text so half-typed values never corrupt anything. */
export interface ResultsForm {
  /** Index 0 is 1st place. */
  names: string[];
  durationMin: string;
}

export function resultsForm(t: Tournament, derivedMs: Ms | undefined): ResultsForm {
  const byPlace = new Map((t.results?.positions ?? []).map((p) => [p.place, p.name ?? '']));
  const names = Array.from({ length: t.participants.count }, (_, i) => byPlace.get(i + 1) ?? '');
  const ms = t.results?.actualDurationMs ?? derivedMs;
  return { names, durationMin: ms === undefined ? '' : String(Math.round(ms / MINUTE)) };
}

export type ApplyResults =
  | { ok: true; tournament: Tournament }
  | { ok: false; error: 'duration' };

export function applyResults(t: Tournament, form: ResultsForm, now: EpochMs): ApplyResults {
  const text = form.durationMin.trim();
  const minutes = Number(text);
  if (text !== '' && (!/^\d+$/.test(text) || minutes > MAX_DURATION_MIN)) {
    return { ok: false, error: 'duration' };
  }
  const results: TournamentResults = {
    positions: form.names.map((raw, i) => {
      const name = raw.trim();
      return name ? { place: i + 1, name } : { place: i + 1 };
    }),
  };
  if (text !== '') results.actualDurationMs = minutes * MINUTE;
  return { ok: true, tournament: { ...t, results, updatedAt: now } };
}

/** The winner's name, when the host entered one. */
export function winnerName(t: Tournament): string | undefined {
  return t.results?.positions.find((p) => p.place === 1)?.name;
}

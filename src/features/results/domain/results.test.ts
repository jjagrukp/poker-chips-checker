import type { TournamentEvent } from '@/core/events/events';
import { MINUTE } from '@/core/time';
import { TournamentSchema, type Tournament } from '@/core/tournaments/tournament';
import { readyTournament, T0 } from '@/features/live-clock/testing/fixtures';
import { actualDuration, applyResults, ordinal, resultsForm, winnerName } from './results';

const finished = (overrides: Partial<Tournament> = {}): Tournament =>
  readyTournament({ status: 'completed', startedAt: T0, endedAt: T0 + 90 * MINUTE, ...overrides });

const transition = (action: 'start' | 'complete' | 'cancel', at: number, seq: number): TournamentEvent => ({
  id: `e${seq}`,
  tournamentId: 't1',
  seq,
  schemaVersion: 1,
  type: 'lifecycle_transition',
  at,
  payload: { action, from: action === 'start' ? 'ready' : 'active', to: action === 'start' ? 'active' : 'completed' },
});

describe('actualDuration', () => {
  it('comes from the start and end events', () => {
    const events = [transition('start', T0 + MINUTE, 1), transition('complete', T0 + 121 * MINUTE, 2)];
    expect(actualDuration(finished(), events)).toBe(120 * MINUTE);
    expect(actualDuration(finished(), [transition('start', T0, 1), transition('cancel', T0 + MINUTE, 2)])).toBe(MINUTE);
  });

  it('falls back to the tournament times, and is unknown without them', () => {
    expect(actualDuration(finished(), [])).toBe(90 * MINUTE);
    expect(actualDuration(readyTournament(), [])).toBeUndefined();
    expect(actualDuration(finished({ endedAt: T0 - 1 }), [])).toBeUndefined();
  });
});

describe('ordinal', () => {
  it('uses English suffixes', () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th',
    ]);
  });
});

describe('results form', () => {
  it('starts with a blank row per player and the derived duration', () => {
    expect(resultsForm(finished(), 95 * MINUTE + 20_000)).toEqual({ names: ['', '', '', '', '', ''], durationMin: '95' });
    expect(resultsForm(finished(), undefined).durationMin).toBe('');
  });

  it('round-trips saved results', () => {
    const form = { names: [' Sam ', '', 'Alex', '', '', ''], durationMin: '100' };
    const result = applyResults(finished(), form, T0 + 2 * 60 * MINUTE);
    if (!result.ok) throw new Error('expected ok');
    const saved = TournamentSchema.parse(result.tournament);
    expect(saved.results).toEqual({
      positions: [{ place: 1, name: 'Sam' }, { place: 2 }, { place: 3, name: 'Alex' }, { place: 4 }, { place: 5 }, { place: 6 }],
      actualDurationMs: 100 * MINUTE,
    });
    expect(winnerName(saved)).toBe('Sam');
    expect(resultsForm(saved, MINUTE)).toEqual({ names: ['Sam', '', 'Alex', '', '', ''], durationMin: '100' });
  });

  it('rejects a bad duration and allows a blank one', () => {
    const names = ['', '', '', '', '', ''];
    expect(applyResults(finished(), { names, durationMin: '1.5' }, T0)).toEqual({ ok: false, error: 'duration' });
    expect(applyResults(finished(), { names, durationMin: '-3' }, T0).ok).toBe(false);
    expect(applyResults(finished(), { names, durationMin: '99999' }, T0).ok).toBe(false);
    expect(applyResults(finished(), { names, durationMin: '1e2' }, T0).ok).toBe(false);
    const blank = applyResults(finished(), { names, durationMin: ' ' }, T0);
    expect(blank.ok && blank.tournament.results?.actualDurationMs).toBe(undefined);
    expect(winnerName(finished())).toBeUndefined();
  });
});

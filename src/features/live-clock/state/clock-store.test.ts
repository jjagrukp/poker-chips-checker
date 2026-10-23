import { MINUTE } from '@/core/time';
import { pause, resume, start } from '@/core/timer/commands';
import { applyClockCommand, transition } from '@/core/tournaments/lifecycle';
import type { Tournament } from '@/core/tournaments/tournament';
import type { TabRole } from '@/infrastructure/tab-lock/controller-lock';
import { openAppTestStorage } from '@/infrastructure/testing/storage';
import { setLevel } from '@/modules/texas-holdem/edits';
import {
  fakePlatform,
  holdemConfig,
  holdemSchedule,
  readyTournament,
  settableClock,
  T0,
} from '../testing/fixtures';
import { createClockStore } from './clock-store';

function activeFrom(at = T0): Tournament {
  const schedule = holdemSchedule();
  const begun = transition(readyTournament(), { action: 'start', schedule }, at).tournament;
  return applyClockCommand(begun, schedule, at, start).tournament;
}

async function setup(seed: Tournament, options: { now?: number; role?: TabRole } = {}) {
  const repos = await openAppTestStorage();
  await repos.tournaments.commit({ tournament: seed, schedules: [holdemSchedule()] });
  const clock = settableClock(options.now ?? T0);
  const platform = fakePlatform(clock.now, options.role ?? 'controller');
  const store = createClockStore({ tournamentId: seed.id, repos, ctx: clock.ctx, platform });
  const dispose = store.getState().init();
  await vi.waitFor(() => expect(store.getState().phase).toBe('loaded'));
  await settle(store);
  const s = () => store.getState();
  return { repos, clock, platform, store, dispose, s };
}

async function settle(store: { getState(): { flush(): Promise<void> } }) {
  await new Promise((r) => setTimeout(r, 0));
  await store.getState().flush();
}

describe('clock store', () => {
  it('starts a ready tournament and its clock in one write', async () => {
    const { s, repos, clock, platform } = await setup(readyTournament());
    clock.advance(MINUTE);
    await s().begin();
    expect(s().tournament).toMatchObject({
      status: 'active',
      startedAt: T0 + MINUTE,
      clock: { status: 'running', deadline: T0 + 11 * MINUTE },
    });
    const events = await repos.events.listByTournament('t1');
    expect(events.map((e) => e.type)).toEqual([
      'lifecycle_transition',
      'segment_started',
      'clock_command',
    ]);
    expect(platform.saved).toEqual([1]);
  });

  it('runs clock commands and ignores invalid ones', async () => {
    const { s, clock, repos } = await setup(activeFrom());
    clock.advance(2 * MINUTE);
    await s().command(pause);
    expect(s().tournament?.clock).toMatchObject({ status: 'paused', remainingMs: 8 * MINUTE });
    await s().command(pause);
    clock.advance(MINUTE);
    await s().command(resume);
    expect(s().tournament?.clock).toMatchObject({ status: 'running', deadline: T0 + 11 * MINUTE });
    expect((await repos.tournaments.get('t1'))?.clock?.revision).toBe(3);
    expect(s().warning).toBeUndefined();
  });

  it('lets viewers read but never write', async () => {
    const { s, repos } = await setup(readyTournament(), { role: 'viewer' });
    await s().begin();
    expect((await repos.tournaments.get('t1'))?.status).toBe('ready');
  });

  it('recovers on load and summarises what passed', async () => {
    const { s, repos } = await setup(activeFrom(), { now: T0 + 27 * MINUTE });
    expect(s().recovery).toEqual({ levels: 2, breaks: 1 });
    expect((await repos.tournaments.get('t1'))?.clock).toMatchObject({
      segmentIndex: 3,
      updatedAt: T0 + 27 * MINUTE,
    });
    const types = (await repos.events.listByTournament('t1')).map((e) => e.type);
    expect(types.at(-1)).toBe('recovered');
    s().dismissRecovery();
    expect(s().recovery).toBeUndefined();
  });

  it('pauses and warns when the clock went backwards while closed', async () => {
    const seed = activeFrom(T0 + 10 * MINUTE);
    const { s } = await setup(seed, { now: T0 });
    expect(s().warning).toBe('backwards');
    expect(s().tournament?.clock).toMatchObject({ status: 'paused', remainingMs: 10 * MINUTE });
  });

  it('re-anchors on in-session skew', async () => {
    const { s, clock } = await setup(activeFrom());
    clock.advance(61 * MINUTE);
    await s().skewed(60 * MINUTE);
    expect(s().warning).toBe('skew');
    expect(s().tournament?.clock).toMatchObject({ deadline: T0 + 70 * MINUTE });
    s().dismissWarning();
    expect(s().warning).toBeUndefined();
  });

  it('keeps a backwards warning when skew follows', async () => {
    const { s, clock } = await setup(activeFrom(T0 + 10 * MINUTE), { now: T0 });
    expect(s().warning).toBe('backwards');
    await s().command(resume);
    clock.advance(MINUTE);
    await s().skewed(-MINUTE);
    expect(s().warning).toBe('backwards');
  });

  it('reloads and warns when another tab wrote first', async () => {
    const { s, repos, clock } = await setup(activeFrom());
    const other = applyClockCommand(activeFrom(), holdemSchedule(), T0 + MINUTE, pause);
    await repos.tournaments.commit({ tournament: other.tournament, events: other.events });
    clock.advance(2 * MINUTE);
    await s().command(pause);
    expect(s().warning).toBe('conflict');
    expect(s().tournament?.clock).toMatchObject({ status: 'paused', remainingMs: 9 * MINUTE });
  });

  it('reports each committed change to onSaved, but not a refused one (spec 08)', async () => {
    const { s, repos, clock, platform } = await setup(activeFrom());
    const onSaved = vi.fn();
    platform.onSaved = onSaved;
    clock.advance(MINUTE);
    await s().command(pause);
    expect(onSaved).toHaveBeenCalledTimes(1);
    const [tournament, schedule] = onSaved.mock.calls[0] as [Tournament, { id: string }];
    expect(tournament.clock).toMatchObject({ status: 'paused', remainingMs: 9 * MINUTE });
    expect(schedule.id).toBe(holdemSchedule().id);

    const stored = await repos.tournaments.get('t1');
    if (!stored) throw new Error('missing');
    const other = applyClockCommand(stored, holdemSchedule(), T0 + 2 * MINUTE, resume);
    await repos.tournaments.commit({ tournament: other.tournament, events: other.events });
    await s().command(resume);
    expect(s().warning).toBe('conflict');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('saves the hand-rankings toggle on the tournament and reports it (spec 10)', async () => {
    const { s, repos, platform } = await setup(activeFrom());
    const onSaved = vi.fn();
    platform.onSaved = onSaved;
    await s().setReference(true);
    expect(s().tournament?.settings.showReference).toBe(true);
    expect((await repos.tournaments.get('t1'))?.settings.showReference).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
    // No change, no write.
    await s().setReference(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
    await s().setReference(false);
    expect((await repos.tournaments.get('t1'))?.settings.showReference).toBe(false);
  });

  it('sets and clears the TV music', async () => {
    const { s, repos, platform } = await setup(activeFrom());
    const onSaved = vi.fn();
    platform.onSaved = onSaved;
    const music = { videoId: 'dQw4w9WgXcQ', playing: true, volume: 60, shuffle: false, skips: 0 };
    await s().setMusic(music);
    expect((await repos.tournaments.get('t1'))?.settings.music).toEqual(music);
    expect(onSaved).toHaveBeenCalledTimes(1);
    // No change, no write.
    await s().setMusic({ ...music });
    expect(onSaved).toHaveBeenCalledTimes(1);
    await s().setMusic(undefined);
    const settings = (await repos.tournaments.get('t1'))?.settings;
    expect(settings).toBeDefined();
    expect(settings && 'music' in settings).toBe(false);
  });

  it('re-reads when the controller tab saves', async () => {
    const { s, repos, platform } = await setup(activeFrom(), { role: 'viewer' });
    const other = applyClockCommand(activeFrom(), holdemSchedule(), T0 + MINUTE, pause);
    await repos.tournaments.commit({ tournament: other.tournament });
    platform.emitSaved();
    await settle({ getState: s });
    expect(s().tournament?.clock?.status).toBe('paused');
  });

  it('recovers when a viewer becomes the controller', async () => {
    const { s, clock, platform } = await setup(activeFrom(), { role: 'viewer' });
    clock.advance(12 * MINUTE);
    s().takeControl();
    expect(platform.lock.role).toBe('controller');
    await vi.waitFor(() => expect(s().recovery).toEqual({ levels: 1, breaks: 0 }));
  });

  it('changes players remaining', async () => {
    const { s, repos } = await setup(activeFrom());
    await s().changePlayers(-1);
    expect((await repos.tournaments.get('t1'))?.participants.remaining).toBe(5);
    const types = (await repos.events.listByTournament('t1')).map((e) => e.type);
    expect(types.at(-1)).toBe('participants_changed');
  });

  it('applies running edits and refuses changes to past levels', async () => {
    const { s, clock, repos } = await setup(activeFrom());
    clock.advance(12 * MINUTE);
    const schedule = holdemSchedule();
    const config = holdemConfig();
    const patch = { sb: 50, bb: 100, ante: 0, durationMin: 15 };
    const past = setLevel(schedule, config, clock.ctx, 0, patch).schedule;
    expect(await s().applyEdit(past, { restartCurrent: false })).toBe('pastChanged');

    const current = setLevel(schedule, config, clock.ctx, 1, patch).schedule;
    expect(await s().applyEdit(current, { restartCurrent: false })).toBe('applied');
    expect(s().schedule?.id).toBe(current.id);
    // 2 minutes into a level now 15 long.
    expect(s().tournament?.clock).toMatchObject({ segmentIndex: 1, deadline: T0 + 25 * MINUTE });
    expect(await repos.schedules.get(current.id)).toBeDefined();
    const types = (await repos.events.listByTournament('t1')).map((e) => e.type);
    expect(types).toContain('schedule_edited');
  });

  it('ends the tournament with the clock frozen', async () => {
    const { s, clock } = await setup(activeFrom());
    clock.advance(3 * MINUTE);
    await s().end();
    expect(s().tournament).toMatchObject({
      status: 'completed',
      endedAt: T0 + 3 * MINUTE,
      clock: { status: 'paused', remainingMs: 7 * MINUTE },
    });
  });

  it('remembers mute and releases the lock on dispose', async () => {
    const { s, repos, dispose, platform } = await setup(readyTournament());
    await s().toggleMute();
    expect(s().muted).toBe(true);
    expect((await repos.settings.get()).alertsMuted).toBe(true);
    dispose();
    expect(platform.lock.released).toBe(true);
  });

  it('applies two quick mute presses in order, saving before showing each', async () => {
    const { s, repos } = await setup(readyTournament());
    const first = s().toggleMute();
    const second = s().toggleMute();
    await Promise.all([first, second]);
    expect(s().muted).toBe(false);
    expect((await repos.settings.get()).alertsMuted).toBe(false);

    const third = s().toggleMute();
    expect(s().muted).toBe(false);
    await third;
    expect(s().muted).toBe(true);
    expect((await repos.settings.get()).alertsMuted).toBe(true);
  });

  it('saves alert preferences and loads them next time', async () => {
    const { s, repos, dispose } = await setup(readyTournament());
    await s().updateAlertPrefs({ volume: 0.5 });
    await s().updateAlertPrefs({ enabled: { countdown: false } });
    expect((await repos.settings.get()).alerts).toEqual({ volume: 0.5, enabled: { countdown: false } });
    dispose();

    const clock = settableClock();
    const again = createClockStore({ tournamentId: 't1', repos, ctx: clock.ctx, platform: fakePlatform(clock.now) });
    again.getState().init();
    await vi.waitFor(() => expect(again.getState().alertPrefs).toEqual({ volume: 0.5, enabled: { countdown: false } }));
  });

  it('persists fired alert keys, dropping stale ones, only from the controller', async () => {
    const stale = `l1:oneMinute:${T0 - 20 * MINUTE}`;
    const { s, repos, clock } = await setup({ ...activeFrom(), firedAlerts: [stale] });
    clock.advance(MINUTE);
    const key = `l1:oneMinute:${T0 + MINUTE}`;
    await s().markAlertsFired([key]);
    expect((await repos.tournaments.get('t1'))?.firedAlerts).toEqual([key]);

    const viewer = await setup(activeFrom(), { role: 'viewer' });
    await viewer.s().markAlertsFired([key]);
    expect((await viewer.repos.tournaments.get('t1'))?.firedAlerts).toBeUndefined();
  });

  it('reports a missing tournament', async () => {
    const repos = await openAppTestStorage();
    const clock = settableClock();
    const store = createClockStore({
      tournamentId: 'nope',
      repos,
      ctx: clock.ctx,
      platform: fakePlatform(clock.now),
    });
    store.getState().init();
    await vi.waitFor(() => expect(store.getState().phase).toBe('missing'));
  });
});

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AlertPrefs } from '@/core/alerts/alerts';
import { recordFired } from '@/core/alerts/plan';
import type { EventDraft } from '@/core/events/events';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Schedule } from '@/core/scheduling/schedule';
import type { EpochMs } from '@/core/time';
import {
  InvalidClockCommand,
  reanchor,
  recover as recoverClock,
  start,
  type ClockState,
  type CommandResult,
  type EditOptions,
} from '@/core/timer/commands';
import { deriveClock } from '@/core/timer/derive-clock';
import {
  applyClockCommand,
  applyScheduleEdit,
  InvalidTransition,
  transition,
} from '@/core/tournaments/lifecycle';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import type { AlertAudio } from '@/infrastructure/audio/alert-audio';
import type { AlertNotifier } from '@/infrastructure/notifications/notifier';
import type { ScreenWakeLock } from '@/infrastructure/screen/wake-lock';
import type { TournamentChannel } from '@/infrastructure/tab-lock/broadcast';
import type { ControllerLock, TabRole } from '@/infrastructure/tab-lock/controller-lock';
import { HoldemConfigSchema, type HoldemConfig } from '@/modules/texas-holdem/config';
import { changeRemaining, checkRunningEdit, countPassed } from '../domain/screen';

// Live-clock store (spec 03): one per open tournament. Every change is a pure core command
// committed atomically (D16); writes run one at a time so each sees the latest anchor.
// Only the controller tab writes (D18); viewers re-read when the controller saves.

export interface ClockPlatform {
  acquireLock(tournamentId: string): Promise<ControllerLock>;
  openChannel(tournamentId: string, onSaved: () => void): TournamentChannel;
  /** Monotonic milliseconds (`performance.now`) for in-session skew detection. */
  monotonic(): number;
  wakeLock: ScreenWakeLock;
  audio: AlertAudio;
  notifier: AlertNotifier;
  /** After a tournament first starts (the app asks for persistent storage then). */
  onStarted?: () => void;
}

export interface Recovery {
  levels: number;
  breaks: number;
}

export type ClockWarning = 'skew' | 'backwards' | 'conflict' | 'saveFailed' | 'loadFailed';
export type EditOutcome = 'applied' | 'pastChanged' | 'failed';

export interface ClockStore {
  phase: 'loading' | 'missing' | 'loaded';
  tournament: Tournament | undefined;
  schedule: Schedule | undefined;
  config: HoldemConfig | undefined;
  role: TabRole;
  muted: boolean;
  alertPrefs: AlertPrefs;
  recovery: Recovery | undefined;
  warning: ClockWarning | undefined;
  /** Loads, takes the controller lock and recovers. Returns the cleanup. */
  init(): () => void;
  reload(): Promise<void>;
  command(run: (state: ClockState, now: EpochMs) => CommandResult): Promise<void>;
  /** ready → active and starts the clock in one write. */
  begin(): Promise<void>;
  end(): Promise<void>;
  changePlayers(delta: number): Promise<void>;
  applyEdit(edited: Schedule, options: EditOptions): Promise<EditOutcome>;
  /** Cold load and visibility regain share this path (spec 03 §4). */
  recover(): Promise<void>;
  skewed(skewMs: number): Promise<void>;
  toggleMute(): Promise<void>;
  updateAlertPrefs(patch: AlertPrefs): Promise<void>;
  /** Persists fired alert keys so a refresh or another tab never repeats them. */
  markAlertsFired(keys: string[]): Promise<void>;
  dismissRecovery(): void;
  dismissWarning(): void;
  takeControl(): void;
  /** Resolves once every queued task has finished. */
  flush(): Promise<void>;
}

export interface ClockDeps {
  tournamentId: string;
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
  platform: ClockPlatform;
}

interface Change {
  tournament: Tournament;
  events: EventDraft[];
  schedules?: Schedule[];
}

export function createClockStore({
  tournamentId,
  repos,
  ctx,
  platform,
}: ClockDeps): StoreApi<ClockStore> {
  let chain: Promise<unknown> = Promise.resolve();
  let lock: ControllerLock | undefined;
  let channel: TournamentChannel | undefined;

  return createStore<ClockStore>()((set, get) => {
    const enqueue = <T>(
      task: () => Promise<T>,
      fallback: T,
      failure: ClockWarning = 'saveFailed',
    ): Promise<T> => {
      const run = chain.then(task).catch(() => {
        set({ warning: failure });
        return fallback;
      });
      chain = run;
      return run;
    };

    const load = async () => {
      const tournament = await repos.tournaments.get(tournamentId);
      if (!tournament) {
        set({ phase: 'missing', tournament: undefined, schedule: undefined });
        return;
      }
      const schedule = tournament.scheduleId
        ? await repos.schedules.get(tournament.scheduleId)
        : undefined;
      const config = HoldemConfigSchema.safeParse(tournament.config);
      set({
        phase: 'loaded',
        tournament,
        schedule,
        config: config.success ? config.data : undefined,
      });
    };

    /** Commits against the anchor revision this change was derived from. */
    const save = async (change: Change): Promise<boolean> => {
      const revision = get().tournament?.clock?.revision;
      const result = await repos.tournaments.commit(
        revision === undefined ? change : { ...change, expectedClockRevision: revision },
      );
      if (!result.ok) {
        await load();
        set({ warning: 'conflict' });
        return false;
      }
      set({ tournament: change.tournament, schedule: change.schedules?.[0] ?? get().schedule });
      channel?.notifySaved(change.tournament.clock?.revision);
      return true;
    };

    /** The tournament and schedule when this tab may write in the given status. */
    const writable = (status: Tournament['status']) => {
      const { tournament, schedule, role } = get();
      if (role !== 'controller' || !tournament || !schedule || tournament.status !== status) {
        return undefined;
      }
      return { tournament, schedule };
    };

    /** Double presses and stale buttons raise these; the screen re-renders from state anyway. */
    const attempt = <T>(build: () => T): T | undefined => {
      try {
        return build();
      } catch (error) {
        if (error instanceof InvalidClockCommand || error instanceof InvalidTransition) {
          return undefined;
        }
        throw error;
      }
    };

    const clockState = (t: Tournament, schedule: Schedule): ClockState | undefined =>
      t.clock && {
        schedule,
        anchor: t.clock,
        options: { breakEndBehaviour: t.settings.breakEndBehaviour },
      };

    return {
      phase: 'loading',
      tournament: undefined,
      schedule: undefined,
      config: undefined,
      role: 'viewer',
      muted: false,
      alertPrefs: {},
      recovery: undefined,
      warning: undefined,

      init() {
        let disposed = false;
        let unsubscribe: (() => void) | undefined;
        channel = platform.openChannel(tournamentId, () => void get().reload());
        void (async () => {
          const settings = await repos.settings.get().catch(() => undefined);
          if (settings?.alertsMuted) set({ muted: true });
          if (settings?.alerts) set({ alertPrefs: settings.alerts });
          await get().reload();
          const acquired = await platform.acquireLock(tournamentId);
          if (disposed) {
            acquired.release();
            return;
          }
          lock = acquired;
          set({ role: acquired.role });
          unsubscribe = acquired.subscribe((role) => {
            set({ role });
            if (role === 'controller') void get().reload().then(() => get().recover());
          });
          if (acquired.role === 'controller') await get().recover();
        })().catch(() => set({ warning: 'loadFailed' }));
        return () => {
          disposed = true;
          unsubscribe?.();
          lock?.release();
          lock = undefined;
          channel?.close();
          channel = undefined;
        };
      },

      reload: () => enqueue(load, undefined, 'loadFailed'),

      command: (run) =>
        enqueue(async () => {
          const current = writable('active');
          if (!current) return;
          const change = attempt(() =>
            applyClockCommand(current.tournament, current.schedule, ctx.clock.now(), run),
          );
          if (change) await save(change);
        }, undefined),

      begin: () =>
        enqueue(async () => {
          const current = writable('ready');
          if (!current) return;
          const now = ctx.clock.now();
          const change = attempt(() => {
            const started = transition(
              current.tournament,
              { action: 'start', schedule: current.schedule },
              now,
            );
            const running = applyClockCommand(started.tournament, current.schedule, now, start);
            return {
              tournament: running.tournament,
              events: [...started.events, ...running.events],
            };
          });
          if (change && (await save(change))) platform.onStarted?.();
        }, undefined),

      end: () =>
        enqueue(async () => {
          const current = writable('active');
          if (!current) return;
          const change = attempt(() =>
            transition(
              current.tournament,
              { action: 'complete', schedule: current.schedule },
              ctx.clock.now(),
            ),
          );
          if (change) await save(change);
        }, undefined),

      changePlayers: (delta) =>
        enqueue(async () => {
          const current = writable('active');
          if (!current) return;
          const change = changeRemaining(current.tournament, delta, ctx.clock.now());
          if (change) await save(change);
        }, undefined),

      applyEdit: (edited, options) =>
        enqueue<EditOutcome>(async () => {
          const current = writable('active');
          const state = current && clockState(current.tournament, current.schedule);
          if (!current || !state) return 'failed';
          const now = ctx.clock.now();
          const view = deriveClock(state.schedule, state.anchor, now, state.options);
          if (checkRunningEdit(current.schedule, edited, view.segmentIndex) !== 'ok') {
            return 'pastChanged';
          }
          const change = attempt(() =>
            applyScheduleEdit(current.tournament, current.schedule, edited, now, options),
          );
          if (!change) return 'pastChanged';
          return (await save({ ...change, schedules: [edited] })) ? 'applied' : 'failed';
        }, 'failed'),

      recover: () =>
        enqueue(async () => {
          const current = writable('active');
          const state = current && clockState(current.tournament, current.schedule);
          if (!current || !state) return;
          const now = ctx.clock.now();
          const result = recoverClock(state, now);
          if (!result) return;
          const view = deriveClock(state.schedule, state.anchor, now, state.options);
          const saved = await save({
            tournament: { ...current.tournament, clock: result.anchor, updatedAt: now },
            events: result.events,
          });
          if (!saved) return;
          if (view.clockWentBackwards) set({ warning: 'backwards' });
          else set({ recovery: countPassed(state.schedule, view.passedSegmentIds) });
        }, undefined),

      skewed: (skewMs) =>
        enqueue(async () => {
          const current = writable('active');
          const state = current && clockState(current.tournament, current.schedule);
          if (!current || !state) return;
          const now = ctx.clock.now();
          const result = reanchor(state, now, skewMs);
          const saved = await save({
            tournament: { ...current.tournament, clock: result.anchor, updatedAt: now },
            events: result.events,
          });
          // Never hide a warning the host still has to act on (e.g. 'backwards').
          if (saved && !get().warning) set({ warning: 'skew' });
        }, undefined),

      async toggleMute() {
        const muted = !get().muted;
        set({ muted });
        await repos.settings.update({ alertsMuted: muted }).catch(() => undefined);
      },

      async updateAlertPrefs(patch) {
        const current = get().alertPrefs;
        const alertPrefs = { ...current, ...patch };
        if (patch.enabled) alertPrefs.enabled = { ...current.enabled, ...patch.enabled };
        set({ alertPrefs });
        await repos.settings.update({ alerts: alertPrefs }).catch(() => undefined);
      },

      markAlertsFired: (keys) =>
        enqueue(async () => {
          const current = writable('active');
          if (!current || keys.length === 0) return;
          const now = ctx.clock.now();
          const firedAlerts = recordFired(current.tournament.firedAlerts ?? [], keys, now);
          await save({ tournament: { ...current.tournament, firedAlerts }, events: [] });
        }, undefined),

      dismissRecovery: () => set({ recovery: undefined }),
      dismissWarning: () => set({ warning: undefined }),
      takeControl: () => lock?.takeControl(),

      async flush() {
        let current: Promise<unknown>;
        do {
          current = chain;
          await current;
        } while (current !== chain);
      },
    };
  });
}

// Test-only fixtures for the live clock: a small Hold'em schedule, a settable clock and a
// fake platform (tab lock, broadcast, wake lock, audio, notifications).
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Schedule } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import type { SoundAlertType } from '@/core/alerts/alerts';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import type { AlertAudio, AudioState } from '@/infrastructure/audio/alert-audio';
import type { AlertNotifier, NotificationAccess } from '@/infrastructure/notifications/notifier';
import type { ScreenWakeLock, WakeLockState } from '@/infrastructure/screen/wake-lock';
import type { ControllerLock, TabRole } from '@/infrastructure/tab-lock/controller-lock';
import type { HoldemConfig } from '@/modules/texas-holdem/config';
import { breakSegment, levelSegment } from '@/modules/texas-holdem/generate';
import { defaultConfig } from '@/modules/texas-holdem/structure';
import type { ClockPlatform } from '../state/clock-store';

export const T0 = 1_700_000_000_000;

export function settableClock(start = T0) {
  let now = start;
  let ids = 0;
  const ctx: ModuleContext = { clock: { now: () => now }, newId: () => `gen-${++ids}` };
  return {
    ctx,
    advance: (ms: number) => {
      now += ms;
    },
    set: (at: number) => {
      now = at;
    },
    now: () => now,
  };
}

/** L1 25/50 · L2 50/100 · Break · L3 100/200, 10 minutes each (break 5). */
export function holdemSchedule(): Schedule {
  return {
    id: 'sched-1',
    moduleId: 'texas-holdem',
    moduleVersion: '1',
    generatorVersion: '1',
    createdAt: T0,
    schemaVersion: 1,
    segments: [
      levelSegment('l1', 1, { sb: 25, bb: 50, ante: 0 }, 10 * MINUTE),
      levelSegment('l2', 2, { sb: 50, bb: 100, ante: 0 }, 10 * MINUTE),
      breakSegment('b1', 5 * MINUTE),
      levelSegment('l3', 3, { sb: 100, bb: 200, ante: 25 }, 10 * MINUTE),
    ],
  };
}

export function holdemConfig(overrides: Partial<HoldemConfig> = {}): HoldemConfig {
  return {
    ...defaultConfig({ players: 6, targetDurationMin: 120 }),
    startingStack: 10_000,
    breakEndBehaviour: 'auto',
    breaks: { everyMin: 20, durationMin: 5 },
    ...overrides,
  };
}

export function readyTournament(overrides: Partial<Tournament> = {}): Tournament {
  const config = holdemConfig();
  return {
    id: 't1',
    schemaVersion: 1,
    name: 'Friday night',
    moduleId: 'texas-holdem',
    moduleVersion: '1',
    status: 'ready',
    config,
    scheduleId: 'sched-1',
    allocation: undefined,
    participants: { count: 6, remaining: 6 },
    settings: { breakEndBehaviour: config.breakEndBehaviour },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export async function seedReady(
  repos: Repositories<Inventory>,
  overrides: Partial<Tournament> = {},
): Promise<Tournament> {
  const tournament = readyTournament(overrides);
  await repos.tournaments.commit({ tournament, schedules: [holdemSchedule()] });
  return tournament;
}

export interface FakeLock extends ControllerLock {
  setRole(role: TabRole): void;
  released: boolean;
}

function fakeLock(initial: TabRole): FakeLock {
  let role = initial;
  const listeners = new Set<(role: TabRole) => void>();
  const lock: FakeLock = {
    get role() {
      return role;
    },
    exclusive: true,
    released: false,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    takeControl: () => lock.setRole('controller'),
    release() {
      lock.released = true;
    },
    setRole(next) {
      role = next;
      listeners.forEach((l) => l(next));
    },
  };
  return lock;
}

export interface FakeAudio extends AlertAudio {
  played: { type: SoundAlertType; delayMs: number; beat?: number | undefined }[];
  volume: number;
  cancels: number;
}

/** Locked until `unlock` (a gesture), like a real browser; `refuse` keeps it locked. `played`
 * lists sounds started now (delayMs 0) or still queued on the audio timeline. */
export function fakeAudio(refuse = false): FakeAudio {
  let state: AudioState = 'locked';
  const audio: FakeAudio = {
    played: [],
    volume: 0.8,
    cancels: 0,
    get state() {
      return state;
    },
    unlock() {
      if (!refuse) state = 'ready';
      return Promise.resolve(state);
    },
    setVolume(volume) {
      audio.volume = volume;
    },
    play(type, delayMs = 0, beat) {
      if (state === 'ready') audio.played.push({ type, delayMs, beat });
    },
    cancelAll() {
      // Queued (future) sounds never play once cancelled.
      audio.cancels += 1;
      audio.played = audio.played.filter((p) => p.delayMs === 0);
    },
  };
  return audio;
}

export interface FakeNotifier extends AlertNotifier {
  shown: { title: string; body: string }[];
}

export function fakeNotifier(answer: NotificationAccess = 'granted'): FakeNotifier {
  let access: NotificationAccess = 'default';
  const notifier: FakeNotifier = {
    shown: [],
    access: () => access,
    request() {
      access = answer;
      return Promise.resolve(access);
    },
    show(title, body) {
      if (access === 'granted') notifier.shown.push({ title, body });
    },
  };
  return notifier;
}

export interface FakePlatform extends ClockPlatform {
  audio: FakeAudio;
  notifier: FakeNotifier;
  lock: FakeLock;
  saved: (number | undefined)[];
  /** Simulates another tab saving. */
  emitSaved(): void;
  wakeLockRequests: number;
}

export function fakePlatform(
  monotonic: () => number,
  role: TabRole = 'controller',
  wakeLockResult: WakeLockState = 'held',
  audio: FakeAudio = fakeAudio(),
  notifier: FakeNotifier = fakeNotifier(),
): FakePlatform {
  const lock = fakeLock(role);
  let onSaved: (() => void) | undefined;
  const platform: FakePlatform = {
    lock,
    audio,
    notifier,
    saved: [],
    wakeLockRequests: 0,
    emitSaved: () => onSaved?.(),
    acquireLock: () => Promise.resolve(lock),
    openChannel: (_id, listener) => {
      onSaved = listener;
      return { notifySaved: (revision) => platform.saved.push(revision), close: () => undefined };
    },
    monotonic,
    wakeLock: {
      supported: wakeLockResult !== 'unsupported',
      request: () => {
        platform.wakeLockRequests += 1;
        return Promise.resolve(wakeLockResult);
      },
      release: () => undefined,
    } satisfies ScreenWakeLock,
  };
  return platform;
}

import type { Schedule } from '@/core/scheduling/schedule';
import type { Tournament } from '@/core/tournaments/tournament';
import type { ScreenClient } from '@/infrastructure/screen-share/client';
import type { Share, ShareStorage } from '@/infrastructure/screen-share/shares';
import { forScreen } from './schema';
import { SCREEN_SCHEMA_VERSION } from './wire';

// The phone side of screen share (spec 08 §1): one share per tournament, and a latest-wins push
// after every commit. A failed push retries with backoff (2 s doubling to 30 s) and only ever
// sends the newest snapshot, so a flaky connection can't replay old states onto the TV.

export type ShareStatus = 'sending' | 'live' | 'offline' | 'failed';

export interface ScreenShareService {
  /** The share for this tournament, if it's being shown on a screen. */
  current(tournamentId: string): Share | undefined;
  status(tournamentId: string): ShareStatus | undefined;
  /** Makes a share (or keeps the existing one) and sends the current state. */
  start(tournament: Tournament, schedule: Schedule): Share;
  stop(tournamentId: string): Promise<void>;
  /** After a commit: sends the state if this tournament is shared, else does nothing. */
  push(tournament: Tournament, schedule: Schedule): void;
  subscribe(listener: () => void): () => void;
}

export interface ScreenShareDeps {
  client: ScreenClient;
  storage: ShareStorage;
  newShare: () => Share;
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;
/** A new code is tried this many times if the first ones are already in use. */
const CLAIM_ATTEMPTS = 3;

interface Channel {
  status: ShareStatus;
  pending: { tournament: Tournament; schedule: Schedule } | undefined;
  sending: boolean;
  retryMs: number;
  timer: unknown;
  claims: number;
  /** Settles when the current PUT does. */
  inflight?: Promise<void>;
}

export function createScreenShareService(deps: ScreenShareDeps): ScreenShareService {
  const channels = new Map<string, Channel>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());

  const channel = (id: string): Channel => {
    let c = channels.get(id);
    if (!c) {
      c = { status: 'sending', pending: undefined, sending: false, retryMs: FIRST_RETRY_MS, timer: undefined, claims: 0 };
      channels.set(id, c);
    }
    return c;
  };

  const setStatus = (c: Channel, status: ShareStatus) => {
    if (c.status === status) return;
    c.status = status;
    changed();
  };

  const send = async (id: string): Promise<void> => {
    const c = channels.get(id);
    const share = deps.storage.get(id);
    if (!c || !share || c.sending || !c.pending) return;
    const { tournament, schedule } = c.pending;
    c.pending = undefined;
    c.sending = true;
    setStatus(c, 'sending');
    const put = deps.client.put(share.code, share.key, {
      schemaVersion: SCREEN_SCHEMA_VERSION,
      tournament: forScreen(tournament),
      schedule,
      sentAt: deps.now(),
    });
    c.inflight = put.then(() => undefined);
    const result = await put;
    c.sending = false;
    // Stopped while this was in flight: leave the relay's copy to the delete.
    if (channels.get(id) !== c) return;

    if (result.ok) {
      c.retryMs = FIRST_RETRY_MS;
      c.claims = 0;
      if (c.pending) return send(id);
      setStatus(c, 'live');
      return;
    }
    // Keep the newest state for the retry; one sent meanwhile is newer still.
    c.pending ??= { tournament, schedule };
    if (result.reason === 'taken' && c.claims + 1 < CLAIM_ATTEMPTS) {
      c.claims += 1;
      deps.storage.set(id, deps.newShare());
      changed();
      return send(id);
    }
    // Refused (bad origin, too big…): retrying won't help, and the phone isn't offline.
    if (result.reason !== 'network') {
      setStatus(c, 'failed');
      return;
    }
    setStatus(c, 'offline');
    c.timer = deps.setTimer(() => {
      c.timer = undefined;
      void send(id);
    }, c.retryMs);
    c.retryMs = Math.min(c.retryMs * 2, MAX_RETRY_MS);
  };

  const queue = (tournament: Tournament, schedule: Schedule) => {
    const c = channel(tournament.id);
    c.pending = { tournament, schedule };
    // A push while waiting to retry goes now: the connection may well be back.
    if (c.timer !== undefined) {
      deps.clearTimer(c.timer);
      c.timer = undefined;
    }
    void send(tournament.id);
  };

  return {
    current: (id) => deps.storage.get(id),
    status: (id) => (deps.storage.get(id) ? (channels.get(id)?.status ?? 'sending') : undefined),

    start(tournament, schedule) {
      let share = deps.storage.get(tournament.id);
      if (!share) {
        share = deps.newShare();
        deps.storage.set(tournament.id, share);
      }
      queue(tournament, schedule);
      changed();
      return share;
    },

    async stop(id) {
      const share = deps.storage.get(id);
      const c = channels.get(id);
      if (c?.timer !== undefined) deps.clearTimer(c.timer);
      channels.delete(id);
      deps.storage.remove(id);
      changed();
      // A push still in flight would land after the delete and bring the screen back.
      await c?.inflight;
      if (share) await deps.client.remove(share.code, share.key);
    },

    push(tournament, schedule) {
      if (deps.storage.get(tournament.id)) queue(tournament, schedule);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

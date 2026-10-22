// Screen Wake Lock (spec 03 §5). The browser drops the lock whenever the page is hidden, so
// callers request it again on `visibilitychange`.

export type WakeLockState = 'off' | 'held' | 'denied' | 'unsupported';

export interface ScreenWakeLock {
  readonly supported: boolean;
  request(): Promise<WakeLockState>;
  release(): void;
}

type WakeLockApi = Pick<WakeLock, 'request'>;

export function createWakeLock(
  api: WakeLockApi | undefined = globalThis.navigator?.wakeLock,
): ScreenWakeLock {
  let sentinel: WakeLockSentinel | undefined;
  let wanted = false;

  return {
    supported: api !== undefined,
    async request() {
      if (!api) return 'unsupported';
      wanted = true;
      if (sentinel && !sentinel.released) return 'held';
      try {
        const next = await api.request('screen');
        // Released while the request was in flight.
        if (!wanted) {
          void next.release().catch(() => undefined);
          return 'off';
        }
        sentinel = next;
        return 'held';
      } catch {
        return 'denied';
      }
    },
    release() {
      wanted = false;
      const held = sentinel;
      sentinel = undefined;
      if (held && !held.released) void held.release().catch(() => undefined);
    },
  };
}

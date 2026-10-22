// One controlling tab per tournament (spec 02 §7.7) via the Web Locks API. Other tabs are
// viewers, wait in the lock queue, and take over automatically when the controller leaves.

export type TabRole = 'controller' | 'viewer';

export interface ControllerLock {
  readonly role: TabRole;
  /**
   * false when Web Locks is unavailable: every tab is a controller and writes rely on the
   * anchor revision check (`TournamentChange.expectedClockRevision`).
   */
  readonly exclusive: boolean;
  subscribe(listener: (role: TabRole) => void): () => void;
  /** "Take control": steals the lock from the current controller. */
  takeControl(): void;
  release(): void;
}

type Locks = Pick<LockManager, 'request'>;

export function controllerLockName(tournamentId: string): string {
  return `tournament:${tournamentId}:controller`;
}

export async function acquireControllerLock(
  tournamentId: string,
  locks: Locks | undefined = globalThis.navigator?.locks,
): Promise<ControllerLock> {
  if (!locks) {
    return {
      role: 'controller',
      exclusive: false,
      subscribe: () => () => undefined,
      takeControl: () => undefined,
      release: () => undefined,
    };
  }

  const name = controllerLockName(tournamentId);
  const listeners = new Set<(role: TabRole) => void>();
  let role: TabRole = 'viewer';
  let released = false;
  // Only the newest request's outcome changes state; older ones were aborted or superseded.
  let generation = 0;
  let pending: AbortController | undefined;
  let releaseHeld: (() => void) | undefined;
  let decided: (() => void) | undefined;
  const firstDecision = new Promise<void>((resolve) => (decided = resolve));

  const setRole = (next: TabRole) => {
    if (next === role) return;
    role = next;
    listeners.forEach((listener) => listener(next));
  };

  const run = (options: LockOptions) => {
    const gen = ++generation;
    locks
      .request(name, options, (lock) => {
        if (!lock || released || gen !== generation) {
          decided?.();
          return undefined;
        }
        setRole('controller');
        decided?.();
        return new Promise<void>((resolve) => (releaseHeld = resolve));
      })
      .catch(() => undefined)
      .then(() => {
        decided?.();
        if (gen !== generation) return;
        releaseHeld = undefined;
        setRole('viewer');
        if (!released) wait();
      });
  };

  const wait = () => {
    pending = new AbortController();
    run({ signal: pending.signal });
  };

  run({ ifAvailable: true });
  await firstDecision;
  decided = undefined;

  return {
    get role() {
      return role;
    },
    exclusive: true,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    takeControl() {
      if (released || role === 'controller') return;
      pending?.abort();
      run({ steal: true });
    },
    release() {
      released = true;
      pending?.abort();
      releaseHeld?.();
      listeners.clear();
    },
  };
}

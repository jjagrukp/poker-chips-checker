import { acquireControllerLock, controllerLockName } from './controller-lock';

type Callback = (lock: Lock | null) => unknown;

/** Minimal single-name Web Locks fake: exclusive mode, ifAvailable, steal and signal. */
function fakeLocks() {
  let holder: { reject: (e: unknown) => void } | undefined;
  const waiting: Array<() => void> = [];
  const abortError = () => new DOMException('aborted', 'AbortError');

  const grantNext = () => waiting.shift()?.();

  function request(name: string, options: LockOptions, callback: Callback): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        const me = { reject };
        holder = me;
        Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).then((value) => {
          if (holder !== me) return;
          holder = undefined;
          resolve(value);
          grantNext();
        });
      };
      if (options.steal) {
        holder?.reject(abortError());
        holder = undefined;
        grant();
      } else if (!holder) {
        grant();
      } else if (options.ifAvailable) {
        Promise.resolve(callback(null)).then(resolve);
      } else {
        waiting.push(grant);
        options.signal?.addEventListener('abort', () => {
          const i = waiting.indexOf(grant);
          if (i >= 0) waiting.splice(i, 1);
          reject(abortError());
        });
      }
    });
  }
  return { request: request as LockManager['request'] };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('acquireControllerLock', () => {
  it('names the lock per tournament', () => {
    expect(controllerLockName('t1')).toBe('tournament:t1:controller');
  });

  it('falls back to a non-exclusive controller without Web Locks', async () => {
    const lock = await acquireControllerLock('t1', undefined);
    expect(lock).toMatchObject({ role: 'controller', exclusive: false });
    lock.takeControl();
    lock.subscribe(() => undefined)();
    lock.release();
  });

  it('makes the first tab controller and later tabs viewers', async () => {
    const locks = fakeLocks();
    const a = await acquireControllerLock('t1', locks);
    const b = await acquireControllerLock('t1', locks);
    expect([a.role, b.role]).toEqual(['controller', 'viewer']);
    expect(a.exclusive).toBe(true);
  });

  it('lets go of the lock when the page is hidden for navigation', async () => {
    const locks = fakeLocks();
    const page = new EventTarget();
    const a = await acquireControllerLock('t1', locks, page);
    const b = await acquireControllerLock('t1', locks, new EventTarget());
    page.dispatchEvent(new Event('pagehide'));
    await flush();
    await flush();
    expect(b.role).toBe('controller');
    expect(a.role).toBe('viewer');
  });

  it('hands control to a waiting viewer when the controller leaves', async () => {
    const locks = fakeLocks();
    const a = await acquireControllerLock('t1', locks);
    const b = await acquireControllerLock('t1', locks);
    const roles: string[] = [];
    b.subscribe((role) => roles.push(role));
    a.release();
    await flush();
    expect(b.role).toBe('controller');
    expect(roles).toEqual(['controller']);
  });

  it('lets a viewer take control; the old controller becomes a viewer and waits', async () => {
    const locks = fakeLocks();
    const a = await acquireControllerLock('t1', locks);
    const b = await acquireControllerLock('t1', locks);
    b.takeControl();
    await flush();
    expect([a.role, b.role]).toEqual(['viewer', 'controller']);

    b.release();
    await flush();
    expect(a.role).toBe('controller');
  });

  it('drops out of the queue when a waiting viewer is released', async () => {
    const locks = fakeLocks();
    const a = await acquireControllerLock('t1', locks);
    const b = await acquireControllerLock('t1', locks);
    const c = await acquireControllerLock('t1', locks);
    b.release();
    a.release();
    await flush();
    expect([b.role, c.role]).toEqual(['viewer', 'controller']);
  });

  it('ignores takeControl from the controller or after release', async () => {
    const locks = fakeLocks();
    const a = await acquireControllerLock('t1', locks);
    a.takeControl();
    await flush();
    expect(a.role).toBe('controller');
    a.release();
    a.takeControl();
    await flush();
    const b = await acquireControllerLock('t1', locks);
    expect(b.role).toBe('controller');
  });
});

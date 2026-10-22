import { createWakeLock } from './wake-lock';

function fakeApi(fail = false) {
  const sentinels: Array<{ released: boolean; release: () => Promise<void> }> = [];
  return {
    sentinels,
    request: () => {
      if (fail) return Promise.reject(new DOMException('no', 'NotAllowedError'));
      const s = {
        released: false,
        release() {
          s.released = true;
          return Promise.resolve();
        },
      };
      sentinels.push(s);
      return Promise.resolve(s as unknown as WakeLockSentinel);
    },
  };
}

describe('createWakeLock', () => {
  it('reports unsupported without the API', async () => {
    const lock = createWakeLock(undefined);
    expect(lock.supported).toBe(false);
    expect(await lock.request()).toBe('unsupported');
    expect(() => lock.release()).not.toThrow();
  });

  it('holds one sentinel and re-requests after the browser drops it', async () => {
    const api = fakeApi();
    const lock = createWakeLock(api);
    expect(await lock.request()).toBe('held');
    expect(await lock.request()).toBe('held');
    expect(api.sentinels).toHaveLength(1);
    // The page was hidden: the browser released it.
    const first = api.sentinels[0];
    if (first) first.released = true;
    expect(await lock.request()).toBe('held');
    expect(api.sentinels).toHaveLength(2);
    lock.release();
    expect(api.sentinels[1]?.released).toBe(true);
  });

  it('reports denied when the request fails', async () => {
    expect(await createWakeLock(fakeApi(true)).request()).toBe('denied');
  });

  it('drops a sentinel that arrives after release', async () => {
    const api = fakeApi();
    const lock = createWakeLock(api);
    const pending = lock.request();
    lock.release();
    expect(await pending).toBe('off');
    expect(api.sentinels[0]?.released).toBe(true);
  });
});

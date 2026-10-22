import { createKeyedQueue } from './keyed-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createKeyedQueue', () => {
  it('runs tasks for one key in order, one at a time', async () => {
    const queue = createKeyedQueue();
    const log: string[] = [];
    const gate = deferred();
    const a = queue.run('t1', async () => {
      log.push('a:start');
      await gate.promise;
      log.push('a:end');
    });
    const b = queue.run('t1', async () => {
      log.push('b');
    });
    await Promise.resolve();
    expect(log).toEqual(['a:start']);
    gate.resolve();
    await Promise.all([a, b]);
    expect(log).toEqual(['a:start', 'a:end', 'b']);
  });

  it('runs different keys concurrently', async () => {
    const queue = createKeyedQueue();
    const gate = deferred();
    const blocked = queue.run('t1', () => gate.promise);
    await expect(queue.run('t2', async () => 'free')).resolves.toBe('free');
    gate.resolve();
    await blocked;
  });

  it('keeps going after a failed task', async () => {
    const queue = createKeyedQueue();
    const failed = queue.run('t1', async () => {
      throw new Error('nope');
    });
    const next = queue.run('t1', async () => 'ok');
    await expect(failed).rejects.toThrow('nope');
    await expect(next).resolves.toBe('ok');
  });
});

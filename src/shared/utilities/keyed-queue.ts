/**
 * Serialises async tasks per key (spec 02 §7.5: writes are serialised per tournament).
 * Tasks for different keys run concurrently; a failed task doesn't block the next one.
 */
export interface KeyedQueue {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export function createKeyedQueue(): KeyedQueue {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run(key, task) {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task, task);
      const tail = result.catch(() => undefined);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}

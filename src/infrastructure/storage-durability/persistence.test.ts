import { openTestStorage } from '@/infrastructure/testing/storage';
import type { StoragePersistence } from '@/core/persistence/records';
import { ensurePersistentStorage, requestPersistentStorage } from './persistence';

type Case = [string, Parameters<typeof requestPersistentStorage>[0], StoragePersistence];
const yes = () => Promise.resolve(true);
const no = () => Promise.resolve(false);

describe('requestPersistentStorage', () => {
  it.each<Case>([
    ['unsupported without the API', undefined, 'unsupported'],
    ['unsupported without persist()', {}, 'unsupported'],
    ['granted when already persisted', { persisted: yes, persist: no }, 'granted'],
    ['granted when the browser agrees', { persisted: no, persist: yes }, 'granted'],
    ['denied when the browser refuses', { persist: no }, 'denied'],
    [
      'denied when the browser throws',
      { persist: () => Promise.reject(new Error('nope')) },
      'denied',
    ],
  ])('is %s', async (_, storage, expected) => {
    expect(await requestPersistentStorage(storage)).toBe(expected);
  });

  it('records the result in settings', async () => {
    const { repos } = await openTestStorage();
    expect(await ensurePersistentStorage(repos.settings, { persist: yes })).toBe('granted');
    expect((await repos.settings.get()).storagePersistence).toBe('granted');
  });
});

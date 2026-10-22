import { createNotifier } from './notifier';

function fakeApi(permission: NotificationPermission, answer: NotificationPermission = permission) {
  const shown: { title: string; options?: NotificationOptions | undefined }[] = [];
  const api = Object.assign(
    function FakeNotification(this: unknown, title: string, options?: NotificationOptions) {
      shown.push({ title, options });
    },
    {
      permission,
      requestPermission: () => {
        api.permission = answer;
        return Promise.resolve(answer);
      },
    },
  );
  return { api: api as unknown as typeof Notification, shown };
}

describe('createNotifier', () => {
  it('is unsupported without the Notification API', async () => {
    const notifier = createNotifier(undefined);
    expect(notifier.access()).toBe('unsupported');
    expect(await notifier.request()).toBe('unsupported');
    notifier.show('a', 'b', 'c');
  });

  it('shows nothing when permission is denied', async () => {
    const { api, shown } = fakeApi('default', 'denied');
    const notifier = createNotifier(api);
    expect(await notifier.request()).toBe('denied');
    notifier.show('Clock', 'One minute left', 'k');
    expect(shown).toEqual([]);
  });

  it('shows a notification once granted', async () => {
    const { api, shown } = fakeApi('default', 'granted');
    const notifier = createNotifier(api);
    expect(await notifier.request()).toBe('granted');
    notifier.show('Clock', 'One minute left', 'k');
    expect(shown).toEqual([{ title: 'Clock', options: { body: 'One minute left', tag: 'k' } }]);
  });

  it('treats a throwing permission request as denied', async () => {
    const { api } = fakeApi('default');
    api.requestPermission = () => Promise.reject(new Error('blocked'));
    expect(await createNotifier(api).request()).toBe('denied');
  });
});

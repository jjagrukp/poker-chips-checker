// Browser notifications for alerts while the tab is hidden (spec 03 §6.2). Opt-in, never
// required, and unreliable once the device sleeps (known-limitations page).

export type NotificationAccess = 'default' | 'granted' | 'denied' | 'unsupported';

export interface AlertNotifier {
  access(): NotificationAccess;
  /** Asks for permission. Call from a user gesture. */
  request(): Promise<NotificationAccess>;
  show(title: string, body: string, tag: string): void;
}

type NotificationApi = Pick<typeof Notification, 'permission' | 'requestPermission'> &
  (new (title: string, options?: NotificationOptions) => Notification);

export function createNotifier(
  api: NotificationApi | undefined = (globalThis as { Notification?: NotificationApi }).Notification,
): AlertNotifier {
  return {
    access: () => (api ? api.permission : 'unsupported'),
    async request() {
      if (!api) return 'unsupported';
      try {
        return await api.requestPermission();
      } catch {
        return 'denied';
      }
    },
    show(title, body, tag) {
      if (api?.permission !== 'granted') return;
      try {
        new api(title, { body, tag });
      } catch {
        // Some mobile browsers only allow notifications from a service worker.
      }
    },
  };
}

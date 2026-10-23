import { createAppStatus } from './app-status';

describe('app status', () => {
  it('notifies subscribers and runs the registered updater', () => {
    const status = createAppStatus();
    const seen: boolean[] = [];
    status.subscribe(() => seen.push(status.get().updateReady));
    status.set({ updateReady: true });
    const update = vi.fn();
    status.setUpdater(update);
    status.applyUpdate();
    expect(seen).toEqual([true]);
    expect(update).toHaveBeenCalledOnce();
  });

  it('keeps the install prompt for the button and uses it once', async () => {
    const status = createAppStatus();
    const target = new EventTarget();
    const stop = status.watchInstall(target as unknown as Window);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(() => Promise.resolve()),
    });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(status.get().canInstall).toBe(true);

    await status.install();
    await status.install();
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(status.get().canInstall).toBe(false);

    target.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
    target.dispatchEvent(new Event('appinstalled'));
    expect(status.get().canInstall).toBe(false);
    stop();
  });
});

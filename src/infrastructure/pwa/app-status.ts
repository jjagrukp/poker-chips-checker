import { useSyncExternalStore } from 'react';

// App-wide signals from the browser (D31): a new service-worker version waiting, the database
// taken over by a newer tab, and the install prompt. main.tsx feeds it; notices read it.

export interface AppStatus {
  /** A new version is installed and waits for a reload. */
  updateReady: boolean;
  /** Another tab upgraded the database, so this tab's connection is closed. */
  storageReplaced: boolean;
  /** The browser offered an install prompt (Chromium); iOS never does. */
  canInstall: boolean;
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface AppStatusStore {
  get(): AppStatus;
  subscribe(listener: () => void): () => void;
  set(patch: Partial<AppStatus>): void;
  /** Reloads into the waiting version (set by the service-worker registration). */
  applyUpdate(): void;
  setUpdater(update: () => void): void;
  install(): Promise<void>;
  /** Listens for `beforeinstallprompt`; returns the cleanup. */
  watchInstall(target: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void;
}

export function createAppStatus(): AppStatusStore {
  let state: AppStatus = { updateReady: false, storageReplaced: false, canInstall: false };
  const listeners = new Set<() => void>();
  let update: () => void = () => undefined;
  let prompt: InstallPromptEvent | undefined;

  const set = (patch: Partial<AppStatus>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    applyUpdate: () => update(),
    setUpdater(next) {
      update = next;
    },
    async install() {
      if (!prompt) return;
      const event = prompt;
      prompt = undefined;
      set({ canInstall: false });
      await event.prompt();
    },
    watchInstall(target) {
      const onPrompt = (e: Event) => {
        // Keep the browser's mini-infobar away; the durability notice offers the button.
        e.preventDefault();
        prompt = e as InstallPromptEvent;
        set({ canInstall: true });
      };
      const onInstalled = () => {
        prompt = undefined;
        set({ canInstall: false });
      };
      target.addEventListener('beforeinstallprompt', onPrompt);
      target.addEventListener('appinstalled', onInstalled);
      return () => {
        target.removeEventListener('beforeinstallprompt', onPrompt);
        target.removeEventListener('appinstalled', onInstalled);
      };
    },
  };
}

/** The app's single instance. */
export const appStatus = createAppStatus();

export function useAppStatus(store: AppStatusStore = appStatus): AppStatus {
  return useSyncExternalStore(store.subscribe, store.get);
}

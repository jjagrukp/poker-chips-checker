import type { SettingsRepo } from '@/core/persistence/repositories';
import type { ClockPlatform } from '@/features/live-clock/state/clock-store';
import { createAlertAudio } from '@/infrastructure/audio/alert-audio';
import { createNotifier } from '@/infrastructure/notifications/notifier';
import { createWakeLock } from '@/infrastructure/screen/wake-lock';
import { ensurePersistentStorage } from '@/infrastructure/storage-durability/persistence';
import { openTournamentChannel } from '@/infrastructure/tab-lock/broadcast';
import { acquireControllerLock } from '@/infrastructure/tab-lock/controller-lock';

// Composition root for the live clock's browser APIs; tests pass fakes instead.

export function browserClockPlatform(settings: SettingsRepo): ClockPlatform {
  return {
    // Spec 02 §7.6: ask once, on the first tournament start; Settings shows the answer.
    onStarted: () =>
      void settings
        .get()
        .then((s) => s.storagePersistence ?? ensurePersistentStorage(settings))
        .catch(() => undefined),
    acquireLock: (id) => acquireControllerLock(id),
    openChannel: (id, onSaved) => openTournamentChannel(id, onSaved),
    monotonic: () => performance.now(),
    wakeLock: createWakeLock(),
    audio: createAlertAudio(),
    notifier: createNotifier(),
  };
}

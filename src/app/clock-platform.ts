import type { ClockPlatform } from '@/features/live-clock/state/clock-store';
import { createWakeLock } from '@/infrastructure/screen/wake-lock';
import { openTournamentChannel } from '@/infrastructure/tab-lock/broadcast';
import { acquireControllerLock } from '@/infrastructure/tab-lock/controller-lock';

// Composition root for the live clock's browser APIs; tests pass fakes instead.

export function browserClockPlatform(): ClockPlatform {
  return {
    acquireLock: (id) => acquireControllerLock(id),
    openChannel: (id, onSaved) => openTournamentChannel(id, onSaved),
    monotonic: () => performance.now(),
    wakeLock: createWakeLock(),
  };
}

import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useServices } from '@/app/services';
import { ScreenEntry, ScreenUnavailable, ScreenView } from '@/features/screen-share/ui/ScreenView';
import { normaliseCode } from '@/features/screen-share/wire';
import { createAlertAudio } from '@/infrastructure/audio/alert-audio';
import { createNotifier } from '@/infrastructure/notifications/notifier';
import { createWakeLock } from '@/infrastructure/screen/wake-lock';

// `/screen` (code entry) and `/screen/:code` (the shared clock on a TV, spec 08).

export function ScreenRoute() {
  const { code } = useParams();
  const { screenClient, clockPlatform } = useServices();
  const [platform] = useState(
    () =>
      clockPlatform ?? {
        monotonic: () => performance.now(),
        wakeLock: createWakeLock(),
        audio: createAlertAudio(),
        notifier: createNotifier(),
      },
  );
  if (!screenClient) return <ScreenUnavailable />;
  if (code === undefined) return <ScreenEntry />;
  const normalised = normaliseCode(code);
  if (!normalised) return <Navigate to="/screen" replace />;
  if (normalised !== code) return <Navigate to={`/screen/${normalised}`} replace />;
  return <ScreenView key={code} code={code} client={screenClient} platform={platform} />;
}

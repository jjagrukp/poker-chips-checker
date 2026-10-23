import { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { brand } from '@/app/configuration/brand';
import { SetToneContext, useServices } from '@/app/services';
import { SettingsScreen } from '@/features/settings/ui/SettingsScreen';
import { createAlertAudio } from '@/infrastructure/audio/alert-audio';
import { createNotifier } from '@/infrastructure/notifications/notifier';
import { DEFAULT_TONE } from '@/shared/messages';

export function SettingsRoute() {
  const { repos, ctx, data, clockPlatform } = useServices();
  const setTone = useContext(SetToneContext);
  const navigate = useNavigate();
  const [audio] = useState(() => clockPlatform?.audio ?? createAlertAudio());
  const [notifier] = useState(() => clockPlatform?.notifier ?? createNotifier());
  if (!data) return null;
  return (
    <SettingsScreen
      repos={repos}
      data={data}
      clock={ctx.clock}
      audio={audio}
      notifier={notifier}
      appName={brand.appName}
      onToneChange={setTone}
      onDeleted={() => {
        setTone(DEFAULT_TONE);
        navigate('/', { replace: true, state: { deleted: true } });
      }}
    />
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_TONE, type Tone } from '@/shared/messages';
import { useT } from '@/shared/messages/tone';
import { ToneProvider } from '@/shared/messages/ToneProvider';
import { openServices, ServicesContext, SetToneContext, type Services } from './services';

interface Props {
  /** Tests pass in-memory services; the app opens IndexedDB. */
  services?: Services;
  children: ReactNode;
}

export function ServicesProvider({ services: given, children }: Props) {
  const [services, setServices] = useState<Services | null>(given ?? null);
  const [tone, setTone] = useState<Tone>(DEFAULT_TONE);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (given) return;
    let cancelled = false;
    openServices().then(
      (s) => !cancelled && setServices(s),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [given]);

  useEffect(() => {
    if (!services) return;
    services.repos.settings.get().then(
      (s) => s.tone && setTone(s.tone),
      () => undefined,
    );
  }, [services]);

  if (failed) return <StorageUnavailable />;
  if (!services) return null;
  return (
    <ServicesContext.Provider value={services}>
      <SetToneContext.Provider value={setTone}>
        <ToneProvider tone={tone}>{children}</ToneProvider>
      </SetToneContext.Provider>
    </ServicesContext.Provider>
  );
}

function StorageUnavailable() {
  const t = useT();
  return (
    <main className="mx-auto max-w-xl p-4">
      <p role="alert">{t('storage.unavailable')}</p>
    </main>
  );
}

import { Link } from 'react-router-dom';
import { buttonSecondary, card } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';

// Known limitations (spec 07 §4): the list Settings shows, plus a standalone page at
// /limitations that needs no stored data, so it can be shared before game night.

const LIMITATIONS = [
  'storage',
  'safari',
  'offline',
  'wakeLock',
  'silent',
  'notifications',
  'clock',
  'target',
  'photos',
] as const;

const BEFORE_GAME = ['online', 'home', 'power', 'sound', 'clock', 'backup'] as const;

export function LimitationsList() {
  const t = useT();
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5" id="limitations">
      {LIMITATIONS.map((key) => (
        <li key={key}>{t(`settings.about.${key}`)}</li>
      ))}
    </ul>
  );
}

export function LimitationsScreen({ appName }: { appName: string }) {
  const t = useT();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl text-accent">{t('limitations.title')}</h1>
        <Link to="/" className={`${buttonSecondary} inline-flex items-center`}>
          {t('limitations.home')}
        </Link>
      </div>
      <section aria-labelledby="limitations-known" className={`${card} flex flex-col gap-4`}>
        <h2 id="limitations-known" className="font-display text-2xl">
          {t('limitations.known')}
        </h2>
        <p>{t('settings.about.intro', { name: appName })}</p>
        <LimitationsList />
      </section>
      <section aria-labelledby="limitations-before" className={`${card} flex flex-col gap-4`}>
        <h2 id="limitations-before" className="font-display text-2xl">
          {t('limitations.before.heading')}
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          {BEFORE_GAME.map((key) => (
            <li key={key}>{t(`limitations.before.${key}`)}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

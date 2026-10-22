import { brand } from '@/app/configuration/brand';
import { t } from '@/shared/messages';

const placeholderActions = ['home.newTournament', 'home.settings'] as const;

export function Home() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center gap-6 text-center">
      <img src={brand.logo} alt="" width={96} height={96} />
      <h1 className="font-display text-4xl text-accent sm:text-5xl">{brand.appName}</h1>
      <p className="text-lg text-ink-muted">{brand.tagline}</p>
      <ul className="flex w-full flex-col gap-3">
        {placeholderActions.map((key) => (
          <li key={key}>
            <button
              type="button"
              disabled
              aria-describedby="home-coming-soon"
              className="min-h-11 w-full rounded-xl bg-surface-raised px-4 py-3 font-semibold text-ink disabled:cursor-not-allowed"
            >
              {t(key)}
            </button>
          </li>
        ))}
      </ul>
      <p id="home-coming-soon" className="text-sm text-ink-muted">
        {t('home.comingSoon')}
      </p>
    </main>
  );
}

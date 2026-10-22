import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { brand } from '@/app/configuration/brand';
import { useServices } from '@/app/services';
import type { Tournament } from '@/core/tournaments/tournament';
import { createDraft } from '@/features/tournament-setup/state/create';
import { resumePath, setupPath, tournamentPath } from '@/features/tournament-setup/ui/paths';
import { buttonPrimary, buttonSecondary, card } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';

export function Home() {
  const t = useT();
  const navigate = useNavigate();
  const { repos, ctx } = useServices();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repos.tournaments.list().then(
      (list) =>
        !cancelled &&
        setTournaments(
          list
            .filter((x) => x.status === 'draft' || x.status === 'ready')
            .sort((a, b) => b.updatedAt - a.updatedAt),
        ),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [repos]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createDraft(repos, ctx);
      navigate(setupPath(id, 'basics'));
    } catch {
      setFailed(true);
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto flex max-w-xl flex-col items-center gap-6 text-center">
      <img src={brand.logo} alt="" width={96} height={96} />
      <h1 className="font-display text-4xl text-accent sm:text-5xl">{brand.appName}</h1>
      <p className="text-lg text-ink-muted">{brand.tagline}</p>
      <button
        type="button"
        className={buttonPrimary + ' w-full'}
        disabled={creating}
        onClick={() => void create()}
      >
        {t('home.newTournament')}
      </button>
      {failed && <p role="alert">{t('setup.saveFailed')}</p>}

      {tournaments.length > 0 && (
        <section className="flex w-full flex-col gap-2 text-left" aria-labelledby="home-saved">
          <h2 id="home-saved" className="text-xl font-semibold">
            {t('home.saved')}
          </h2>
          <ul className="flex flex-col gap-2">
            {tournaments.map((x) => (
              <li key={x.id} className={`${card} flex items-center justify-between gap-3`}>
                <span>
                  <span className="block font-semibold">{x.name ?? t('home.untitled')}</span>
                  <span className="text-sm text-ink-muted">
                    {t(x.status === 'draft' ? 'home.status.draft' : 'home.status.ready')}
                  </span>
                </span>
                <Link
                  to={x.status === 'draft' ? resumePath(x.id) : tournamentPath(x.id)}
                  className={buttonSecondary + ' inline-flex items-center bg-surface'}
                  aria-label={t('home.itemAction', {
                    action: x.status === 'draft' ? t('home.continueSetup') : t('home.open'),
                    name: x.name ?? t('home.untitled'),
                  })}
                >
                  {x.status === 'draft' ? t('home.continueSetup') : t('home.open')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        type="button"
        disabled
        aria-describedby="home-coming-soon"
        className={buttonSecondary + ' w-full'}
      >
        {t('home.settings')}
      </button>
      <p id="home-coming-soon" className="text-sm text-ink-muted">
        {t('home.comingSoon')}
      </p>
    </main>
  );
}

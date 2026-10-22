import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { brand } from '@/app/configuration/brand';
import { useServices } from '@/app/services';
import { Library } from '@/features/library/ui/Library';
import { createDraft } from '@/features/tournament-setup/state/create';
import { setupPath } from '@/features/tournament-setup/ui/paths';
import { buttonPrimary, buttonSecondary } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';

export function Home() {
  const t = useT();
  const navigate = useNavigate();
  const { repos, ctx } = useServices();
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

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
      <Library
        repos={repos}
        ctx={ctx}
        newTournament={
          <>
            <button
              type="button"
              className={buttonPrimary + ' w-full'}
              disabled={creating}
              onClick={() => void create()}
            >
              {t('home.newTournament')}
            </button>
            {failed && <p role="alert">{t('setup.saveFailed')}</p>}
          </>
        }
      />

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

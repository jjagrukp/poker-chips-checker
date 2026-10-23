import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { brand } from '@/app/configuration/brand';
import { useServices } from '@/app/services';
import { Library } from '@/features/library/ui/Library';
import { DurabilityNotice, QuarantineNotice } from '@/features/settings/ui/StorageNotices';
import { createDraft } from '@/features/tournament-setup/state/create';
import { setupPath } from '@/features/tournament-setup/ui/paths';
import { buttonPrimary, buttonSecondary } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';

export function Home() {
  const t = useT();
  const navigate = useNavigate();
  const { repos, ctx, data } = useServices();
  const location = useLocation();
  // Shown once: the flag is cleared from history so a reload or Back doesn't repeat it.
  const [deleted] = useState(() => (location.state as { deleted?: boolean } | null)?.deleted === true);
  useEffect(() => {
    if (deleted) navigate('.', { replace: true, state: null });
  }, [deleted, navigate]);
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
      {deleted && <p role="status">{t('settings.data.deleteAll.done')}</p>}
      {data && (
        <>
          <QuarantineNotice repos={repos} data={data} clock={ctx.clock} />
          <DurabilityNotice repos={repos} data={data} clock={ctx.clock} />
        </>
      )}
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

      <Link to="/settings" className={buttonSecondary + ' inline-flex w-full items-center justify-center'}>
        {t('home.settings')}
      </Link>
    </main>
  );
}

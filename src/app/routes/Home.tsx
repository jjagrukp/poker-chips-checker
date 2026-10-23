import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { brand } from '@/app/configuration/brand';
import { useServices } from '@/app/services';
import { Library } from '@/features/library/ui/Library';
import { DurabilityNotice, QuarantineNotice } from '@/features/settings/ui/StorageNotices';
import { createDraft } from '@/features/tournament-setup/state/create';
import { setupPath } from '@/features/tournament-setup/ui/paths';
import { Icon } from '@/shared/components/Icon';
import { buttonPrimary, buttonQuiet } from '@/shared/components/styles';
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
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src={brand.logo} alt="" width={48} height={48} className="drop-shadow-[0_6px_14px_rgba(242,193,78,0.35)]" />
          <div className="text-left">
            <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">{brand.appName}</h1>
            <p className="text-sm text-ink-muted">{brand.tagline}</p>
          </div>
        </div>
        <Link to="/settings" className={`${buttonQuiet} shrink-0`}>
          <Icon name="settings" />
          <span className="sr-only sm:not-sr-only">{t('home.settings')}</span>
        </Link>
      </header>
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
              className={`${buttonPrimary} h-14 w-full text-lg`}
              disabled={creating}
              onClick={() => void create()}
            >
              <Icon name="plus" />
              {t('home.newTournament')}
            </button>
            {failed && <p role="alert">{t('setup.saveFailed')}</p>}
          </>
        }
      />
    </main>
  );
}

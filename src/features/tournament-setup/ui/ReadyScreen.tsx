import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { HoldemConfigSchema } from '@/modules/texas-holdem/config';
import { formatChips } from '@/modules/texas-holdem/format';
import { buttonPrimary, buttonSecondary, card } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { reopenSetup } from '../state/create';
import { setupPath } from './paths';

// Landing page for a ready tournament. The live clock (M6) takes over from here.

interface Props {
  tournamentId: string;
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
}

export function ReadyScreen({ tournamentId, repos, ctx }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repos.tournaments.get(tournamentId).then(
      (found) => !cancelled && setTournament(found ?? null),
      () => !cancelled && setTournament(null),
    );
    return () => {
      cancelled = true;
    };
  }, [repos, tournamentId]);

  if (tournament === undefined) return <p className="text-center text-ink-muted">{t('setup.loading')}</p>;
  if (tournament === null) {
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-4">
        <p role="alert">{t('setup.notFound')}</p>
        <Link to="/" className={buttonSecondary + ' text-center'}>
          {t('setup.home')}
        </Link>
      </main>
    );
  }
  if (tournament.status === 'draft') return <Navigate to={setupPath(tournament.id, 'review')} replace />;

  const config = HoldemConfigSchema.safeParse(tournament.config);
  const edit = async () => {
    try {
      await reopenSetup(repos, ctx, tournament);
      navigate(setupPath(tournament.id, 'review'));
    } catch {
      setFailed(true);
    }
  };

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 text-center">
      <h1 className="font-display text-4xl text-accent">{t('ready.title')}</h1>
      <p className="text-lg">{t('transition.chipsCounted')}</p>
      {config.success && (
        <dl className={`${card} grid grid-cols-2 gap-2 text-left`}>
          {tournament.name && (
            <>
              <dt className="font-semibold">{t('setup.review.name')}</dt>
              <dd>{tournament.name}</dd>
            </>
          )}
          <dt className="font-semibold">{t('setup.review.players')}</dt>
          <dd>{config.data.players}</dd>
          <dt className="font-semibold">{t('setup.review.stack')}</dt>
          <dd>{formatChips(config.data.startingStack)}</dd>
        </dl>
      )}
      <p>{t('ready.nextStep')}</p>
      {failed && <p role="alert">{t('setup.saveFailed')}</p>}
      <div className="flex flex-col gap-3">
        {tournament.status === 'ready' && (
          <button type="button" className={buttonSecondary} onClick={() => void edit()}>
            {t('ready.editSetup')}
          </button>
        )}
        <Link to="/" className={buttonPrimary + ' inline-flex items-center justify-center'}>
          {t('setup.home')}
        </Link>
      </div>
    </main>
  );
}

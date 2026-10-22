import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { HoldemConfigSchema } from '@/modules/texas-holdem/config';
import { formatChips } from '@/modules/texas-holdem/format';
import { buttonPrimary, buttonQuiet, buttonSecondary, card } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { reopenSetup } from '../state/create';
import { setupPath } from './paths';

// Landing page for a ready tournament; the live clock takes over once it starts.

interface Props {
  tournament: Tournament;
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
  /** Omitted in viewer tabs: only the controller starts the clock. */
  onStart?: (() => void) | undefined;
}

export function ReadyScreen({ tournament, repos, ctx, onStart }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

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
        {onStart && (
          <button type="button" className={buttonPrimary} onClick={onStart}>
            {t('ready.startClock')}
          </button>
        )}
        {onStart && (
          <button type="button" className={buttonSecondary} onClick={() => void edit()}>
            {t('ready.editSetup')}
          </button>
        )}
        <Link to="/" className={buttonQuiet + ' inline-flex items-center justify-center'}>
          {t('setup.home')}
        </Link>
      </div>
    </main>
  );
}

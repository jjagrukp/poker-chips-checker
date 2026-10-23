import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { HoldemConfigSchema } from '@/modules/texas-holdem/config';
import { formatChips } from '@/modules/texas-holdem/format';
import { Chip } from '@/shared/components/Chip';
import { Icon } from '@/shared/components/Icon';
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  card,
  eyebrow,
  pageTitle,
} from '@/shared/components/styles';
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
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 text-center">
      <div aria-hidden="true" className="mx-auto flex -space-x-5 pt-2">
        {READY_CHIPS.map((colour, i) => (
          <Chip key={colour} colour={colour} className={`size-14 ${i === 1 ? '-translate-y-2' : ''}`} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>{t('ready.title')}</h1>
        <p className="text-lg text-ink-muted">{t('transition.chipsCounted')}</p>
      </div>
      {config.success && (
        <dl className="grid grid-cols-2 gap-2 text-left sm:gap-3">
          {tournament.name && (
            <div className={`${card} col-span-2`}>
              <dt className={eyebrow}>{t('setup.review.name')}</dt>
              <dd className="font-display text-2xl font-semibold">{tournament.name}</dd>
            </div>
          )}
          <div className={card}>
            <dt className={eyebrow}>{t('setup.review.players')}</dt>
            <dd className="font-clock text-4xl font-semibold tabular-nums">{config.data.players}</dd>
          </div>
          <div className={card}>
            <dt className={eyebrow}>{t('setup.review.stack')}</dt>
            <dd className="font-clock text-4xl font-semibold tabular-nums">
              {formatChips(config.data.startingStack)}
            </dd>
          </div>
        </dl>
      )}
      <p className="text-ink-muted">{t('ready.nextStep')}</p>
      {failed && <p role="alert">{t('setup.saveFailed')}</p>}
      <div className="flex flex-col gap-3">
        {onStart && (
          <button type="button" className={`${buttonPrimary} h-16 rounded-full text-xl`} onClick={onStart}>
            <Icon name="play" className="size-6" />
            {t('ready.startClock')}
          </button>
        )}
        {onStart && (
          <button type="button" className={buttonSecondary} onClick={() => void edit()}>
            <Icon name="edit" className="size-4" />
            {t('ready.editSetup')}
          </button>
        )}
        <Link to="/" className={buttonQuiet}>
          <Icon name="home" className="size-4" />
          {t('setup.home')}
        </Link>
      </div>
    </main>
  );
}

const READY_CHIPS = ['#c62828', '#f5f5f5', '#1e63c4'];

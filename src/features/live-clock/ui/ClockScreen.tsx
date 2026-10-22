import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useStore } from 'zustand';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { setupPath } from '@/features/tournament-setup/ui/paths';
import { ReadyScreen } from '@/features/tournament-setup/ui/ReadyScreen';
import { buttonSecondary } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { createClockStore, type ClockPlatform } from '../state/clock-store';
import { LiveClock } from './LiveClock';

// `/tournament/:id`: ready → start screen, active → live clock, finished → summary (M8 adds
// results). One store per mounted tournament owns loading, the tab lock and every write.

interface Props {
  tournamentId: string;
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
  platform: ClockPlatform;
}

export function ClockScreen({ tournamentId, repos, ctx, platform }: Props) {
  const t = useT();
  const [store] = useState(() => createClockStore({ tournamentId, repos, ctx, platform }));
  useEffect(() => store.getState().init(), [store]);
  const state = useStore(store);
  const { phase, tournament, schedule, config, role } = state;

  if (phase === 'loading') {
    return <p className="text-center text-ink-muted">{t('setup.loading')}</p>;
  }
  if (phase === 'missing' || !tournament) return <NotFound />;

  switch (tournament.status) {
    case 'draft':
      return <Navigate to={setupPath(tournament.id, 'review')} replace />;
    case 'ready':
      return (
        <>
          {role === 'viewer' && (
            <div role="status" className="mx-auto mb-4 flex max-w-xl flex-col items-center gap-2 text-center">
              <p>{t('tabs.viewerMode')}</p>
              <button type="button" className={buttonSecondary} onClick={state.takeControl}>
                {t('tabs.takeControl')}
              </button>
            </div>
          )}
          <ReadyScreen
            tournament={tournament}
            repos={repos}
            ctx={ctx}
            onStart={role === 'controller' ? () => void state.begin() : undefined}
          />
        </>
      );
    case 'active':
      if (!schedule || !tournament.clock) return <NotFound />;
      return (
        <LiveClock
          tournament={tournament}
          anchor={tournament.clock}
          schedule={schedule}
          config={config}
          state={state}
          actions={state}
          ctx={ctx}
          platform={platform}
        />
      );
    case 'completed':
    case 'cancelled':
      return (
        <main className="mx-auto flex max-w-xl flex-col gap-6 text-center">
          <h1 className="font-display text-4xl text-accent">
            {t(tournament.status === 'completed' ? 'clock.finished.title' : 'clock.cancelled.title')}
          </h1>
          {tournament.name && <p className="text-lg">{tournament.name}</p>}
          <p className="text-ink-muted">{t('clock.finished.resultsSoon')}</p>
          <Link to="/" className={buttonSecondary + ' inline-flex items-center justify-center'}>
            {t('setup.home')}
          </Link>
        </main>
      );
  }
}

function NotFound() {
  const t = useT();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4">
      <p role="alert">{t('setup.notFound')}</p>
      <Link to="/" className={buttonSecondary + ' text-center'}>
        {t('setup.home')}
      </Link>
    </main>
  );
}

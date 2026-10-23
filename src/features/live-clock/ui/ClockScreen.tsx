import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useStore } from 'zustand';
import { alertEnabled } from '@/core/alerts/alerts';
import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import type { Schedule } from '@/core/scheduling/schedule';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { ResultsScreen } from '@/features/results/ui/ResultsScreen';
import { setupPath } from '@/features/tournament-setup/ui/paths';
import { ReadyScreen } from '@/features/tournament-setup/ui/ReadyScreen';
import { buttonSecondary } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { createClockStore, type ClockPlatform, type ClockStore } from '../state/clock-store';
import { useAudioUnlock } from './alerts';
import { LiveClock } from './LiveClock';

// `/tournament/:id`: ready → start screen, active → live clock, finished → results. One store
// per mounted tournament owns loading, the tab lock and every write.

interface Props {
  tournamentId: string;
  repos: Repositories<Inventory>;
  ctx: ModuleContext;
  platform: ClockPlatform;
  /** Extra controller-only panel under the controls (the app adds "Show on a TV"). */
  controllerExtras?: ((tournament: Tournament, schedule: Schedule) => ReactNode) | undefined;
}

export function ClockScreen({ tournamentId, repos, ctx, platform, controllerExtras }: Props) {
  const t = useT();
  const [store] = useState(() => createClockStore({ tournamentId, repos, ctx, platform }));
  useEffect(() => store.getState().init(), [store]);
  const state = useStore(store);
  const { phase, tournament, schedule, config, role } = state;
  const audio = useAudioUnlock(platform.audio);
  useCompletionSound(state, platform);

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
          audio={audio}
          extras={controllerExtras?.(tournament, schedule)}
        />
      );
    case 'completed':
    case 'cancelled':
      return <ResultsScreen tournament={tournament} repos={repos} ctx={ctx} />;
  }
}

/** Sounds once when this tab ends the tournament, never on a later load (spec 03 §6.1). */
function useCompletionSound(
  { tournament, role, muted, alertPrefs }: Pick<ClockStore, 'tournament' | 'role' | 'muted' | 'alertPrefs'>,
  platform: ClockPlatform,
) {
  const status = tournament?.status;
  const previous = useRef(status);
  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (was !== 'active' || status !== 'completed' || role !== 'controller') return;
    if (!muted && alertEnabled(alertPrefs, 'complete')) platform.audio.play('complete');
  }, [status, role, muted, alertPrefs, platform]);
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

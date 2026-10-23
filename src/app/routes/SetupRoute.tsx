import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { browserClockPlatform } from '@/app/clock-platform';
import { useServices } from '@/app/services';
import type { ClockPlatform } from '@/features/live-clock/state/clock-store';
import { ClockScreen } from '@/features/live-clock/ui/ClockScreen';
import { SharePanel } from '@/features/screen-share/ui/SharePanel';
import { SetupWizard } from '@/features/tournament-setup/ui/SetupWizard';

export function SetupRoute() {
  const { id, step } = useParams();
  const { repos, ctx, photo } = useServices();
  if (!id) return <Navigate to="/" replace />;
  return <SetupWizard key={id} tournamentId={id} step={step} repos={repos} ctx={ctx} photo={photo} />;
}

export function TournamentRoute() {
  const { id } = useParams();
  const { repos, ctx, clockPlatform, screenShare } = useServices();
  const [platform] = useState((): ClockPlatform => {
    const base = clockPlatform ?? browserClockPlatform(repos.settings);
    if (!screenShare) return base;
    // Every save also goes to the TV, when this tournament is being shown on one (spec 08).
    return {
      ...base,
      onSaved: (tournament, schedule) => {
        base.onSaved?.(tournament, schedule);
        screenShare.push(tournament, schedule);
      },
    };
  });
  if (!id) return <Navigate to="/" replace />;
  return (
    <ClockScreen
      key={id}
      tournamentId={id}
      repos={repos}
      ctx={ctx}
      platform={platform}
      music={screenShare !== undefined}
      controllerExtras={
        screenShare
          ? (tournament, schedule) => (
              <SharePanel service={screenShare} tournament={tournament} schedule={schedule} />
            )
          : undefined
      }
    />
  );
}

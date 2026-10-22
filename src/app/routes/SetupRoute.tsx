import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { browserClockPlatform } from '@/app/clock-platform';
import { useServices } from '@/app/services';
import { ClockScreen } from '@/features/live-clock/ui/ClockScreen';
import { SetupWizard } from '@/features/tournament-setup/ui/SetupWizard';

export function SetupRoute() {
  const { id, step } = useParams();
  const { repos, ctx, photo } = useServices();
  if (!id) return <Navigate to="/" replace />;
  return <SetupWizard key={id} tournamentId={id} step={step} repos={repos} ctx={ctx} photo={photo} />;
}

export function TournamentRoute() {
  const { id } = useParams();
  const { repos, ctx, clockPlatform } = useServices();
  const [platform] = useState(() => clockPlatform ?? browserClockPlatform());
  if (!id) return <Navigate to="/" replace />;
  return <ClockScreen key={id} tournamentId={id} repos={repos} ctx={ctx} platform={platform} />;
}

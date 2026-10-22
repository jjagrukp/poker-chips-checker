import { Navigate, useParams } from 'react-router-dom';
import { useServices } from '@/app/services';
import { ReadyScreen } from '@/features/tournament-setup/ui/ReadyScreen';
import { SetupWizard } from '@/features/tournament-setup/ui/SetupWizard';

export function SetupRoute() {
  const { id, step } = useParams();
  const { repos, ctx } = useServices();
  if (!id) return <Navigate to="/" replace />;
  return <SetupWizard key={id} tournamentId={id} step={step} repos={repos} ctx={ctx} />;
}

export function TournamentRoute() {
  const { id } = useParams();
  const { repos, ctx } = useServices();
  if (!id) return <Navigate to="/" replace />;
  return <ReadyScreen key={id} tournamentId={id} repos={repos} ctx={ctx} />;
}

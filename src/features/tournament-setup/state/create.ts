import type { ModuleContext } from '@/core/modules/contract';
import type { Repositories } from '@/core/persistence/repositories';
import { transition } from '@/core/tournaments/lifecycle';
import type { Tournament } from '@/core/tournaments/tournament';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import { newWizard, toTournament } from './wizard';

/** Creates and saves a fresh draft; returns its id. */
export async function createDraft(
  repos: Repositories<Inventory>,
  ctx: ModuleContext,
): Promise<string> {
  const now = ctx.clock.now();
  const state = newWizard({ tournamentId: ctx.newId(), inventoryId: ctx.newId() }, now);
  const result = await repos.tournaments.commit({ tournament: toTournament(state, now) });
  if (!result.ok) throw new Error('createDraft: commit conflict');
  return state.tournament.id;
}

/** ready → draft so the wizard can change it again; the draft state is still on the record. */
export async function reopenSetup(
  repos: Repositories<Inventory>,
  ctx: ModuleContext,
  tournament: Tournament,
): Promise<void> {
  const { tournament: next, events } = transition(tournament, { action: 'edit' }, ctx.clock.now());
  const result = await repos.tournaments.commit({ tournament: next, events });
  if (!result.ok) throw new Error('reopenSetup: commit conflict');
}

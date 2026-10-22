import type { ModuleContext } from '@/core/modules/contract';
import { openAppTestStorage } from '@/infrastructure/testing/storage';
import { createDraft } from './create';
import { createWizardStore } from './store';
import { fromTournament, setName, setPlayers, setTarget } from './wizard';

const T0 = 1_700_000_000_000;

function context(): ModuleContext {
  let n = 0;
  return { clock: { now: () => T0 }, newId: () => `id-${++n}` };
}

async function load(repos: Awaited<ReturnType<typeof openAppTestStorage>>, id: string) {
  const record = await repos.tournaments.get(id);
  const loaded = record && fromTournament(record);
  if (loaded?.kind !== 'ok') throw new Error('draft did not load');
  return loaded.state;
}

describe('wizard store auto-save', () => {
  it('saves every change and survives a reload', async () => {
    const repos = await openAppTestStorage();
    const ctx = context();
    const id = await createDraft(repos, ctx);
    const store = createWizardStore(await load(repos, id), { repos, ctx });

    store.getState().update((s) => setName(s, 'Poker night'));
    store.getState().update((s) => setPlayers(s, 8));
    store.getState().update((s) => setTarget(s, 150, 'custom'));
    await store.getState().flush();
    expect(store.getState().saveStatus).toBe('saved');

    const reloaded = await load(repos, id);
    expect(reloaded.tournament.name).toBe('Poker night');
    expect(reloaded.config.players).toBe(8);
    expect(reloaded.tournament.participants.count).toBe(8);
    expect(reloaded.config.targetDurationMin).toBe(150);
    expect(reloaded.draft.durationMode).toBe('custom');
    expect(reloaded.draft.schedule).toEqual(store.getState().wizard.draft.schedule);
  });

  it('coalesces a burst of edits into few writes', async () => {
    const repos = await openAppTestStorage();
    const ctx = context();
    const id = await createDraft(repos, ctx);
    const commit = vi.spyOn(repos.tournaments, 'commit');
    const store = createWizardStore(await load(repos, id), { repos, ctx });
    for (let i = 0; i < 20; i++) store.getState().update((s) => setName(s, `Name ${i}`));
    await store.getState().flush();
    expect(commit.mock.calls.length).toBeLessThanOrEqual(2);
    expect((await load(repos, id)).tournament.name).toBe('Name 19');
  });

  it('reports a failed save', async () => {
    const repos = await openAppTestStorage();
    const ctx = context();
    const id = await createDraft(repos, ctx);
    const store = createWizardStore(await load(repos, id), { repos, ctx });
    vi.spyOn(repos.tournaments, 'commit').mockRejectedValue(new Error('disk full'));
    store.getState().update((s) => setName(s, 'x'));
    await store.getState().flush();
    expect(store.getState().saveStatus).toBe('error');
  });
});

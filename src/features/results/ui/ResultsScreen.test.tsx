import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/app/testing/render-app';
import type { Repositories } from '@/core/persistence/repositories';
import { MINUTE } from '@/core/time';
import { transition } from '@/core/tournaments/lifecycle';
import type { Tournament } from '@/core/tournaments/tournament';
import { chipSet } from '@/features/chip-inventory/domain/testing/fixtures';
import type { Inventory } from '@/features/chip-inventory/domain/inventory';
import {
  fakePlatform,
  holdemSchedule,
  readyTournament,
  settableClock,
  T0,
} from '@/features/live-clock/testing/fixtures';
import { openAppTestStorage } from '@/infrastructure/testing/storage';

/** Started at T0 and finished 95 minutes later, both logged as events. */
async function seedFinished(
  repos: Repositories<Inventory>,
  action: 'complete' | 'cancel' = 'complete',
  overrides: Partial<Tournament> = {},
) {
  const schedule = holdemSchedule();
  const ready = readyTournament({ inventoryId: 'inv-1', ...overrides });
  await repos.tournaments.commit({ tournament: ready, schedules: [schedule] });
  const started = transition(ready, { action: 'start', schedule }, T0);
  await repos.tournaments.commit(started);
  const ended = transition(started.tournament, { action, schedule }, T0 + 95 * MINUTE);
  await repos.tournaments.commit(ended);
  return ended.tournament;
}

async function open(options: { inventory?: boolean; action?: 'complete' | 'cancel' } = {}) {
  const repos = await openAppTestStorage();
  if (options.inventory ?? true) {
    await repos.inventories.put({
      ...chipSet([
        { colour: 'White', quantity: 100, value: 25 },
        { colour: 'Red', quantity: 100, value: 100 },
      ], 'inv-1').inventory,
      name: 'Home set',
    });
  }
  await seedFinished(repos, options.action);
  const clock = settableClock(T0 + 2 * 60 * MINUTE);
  const app = await renderApp('/tournament/t1', repos, {
    ctx: clock.ctx,
    clockPlatform: fakePlatform(clock.now),
  });
  return { ...app, repos };
}

describe('results screen', () => {
  it('records finishing positions and the actual duration', async () => {
    const { repos } = await open();
    await screen.findByRole('heading', { name: "That's a wrap." });
    const duration = screen.getByLabelText('How long it ran (minutes)');
    await waitFor(() => expect(duration).toHaveValue('95'));
    expect(screen.getAllByRole('textbox', { name: /^Name for \d+\w\w place$/ })).toHaveLength(6);

    fireEvent.change(screen.getByLabelText('Name for 1st place'), { target: { value: 'Sam' } });
    fireEvent.change(duration, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save results' }));
    expect(await screen.findByText('Enter whole minutes, up to 1440.')).toBeInTheDocument();

    fireEvent.change(duration, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save results' }));
    expect(await screen.findByText('Results saved.')).toBeInTheDocument();
    expect(screen.getByText(/^Winner: Sam\./)).toBeInTheDocument();
    const saved = await repos.tournaments.get('t1');
    expect(saved?.results?.actualDurationMs).toBe(100 * MINUTE);
    expect(saved?.results?.positions[0]).toEqual({ place: 1, name: 'Sam' });
  });

  it('saves the setup as a preset', async () => {
    const { repos } = await open();
    const name = await screen.findByLabelText('Preset name');
    expect(name).toHaveValue('Friday night');
    fireEvent.change(name, { target: { value: 'Friday six' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as preset' }));
    expect(await screen.findByText('Preset saved. Find it on the home screen.')).toBeInTheDocument();
    expect((await repos.presets.list()).map((p) => p.name)).toEqual(['Friday six']);
  });

  it('duplicates the tournament into a new draft', async () => {
    const { repos } = await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate tournament' }));
    await screen.findByRole('heading', { level: 1, name: 'Basics' });
    const drafts = (await repos.tournaments.list()).filter((x) => x.status === 'draft');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ name: 'Friday night (copy)', participants: { count: 6 } });
  });

  it('starts a new tournament with the same chips, or explains they are gone', async () => {
    const { repos } = await open();
    fireEvent.click(await screen.findByRole('button', { name: 'New tournament with the same chips' }));
    await screen.findByRole('heading', { level: 1, name: 'Basics' });
    const draft = (await repos.tournaments.list()).find((x) => x.status === 'draft');
    expect(draft?.setupDraft).toMatchObject({ inventoryId: 'inv-1', inventoryName: 'Home set' });
  });

  it('explains when the chip set has been deleted', async () => {
    await open({ inventory: false });
    fireEvent.click(await screen.findByRole('button', { name: 'New tournament with the same chips' }));
    expect(
      await screen.findByText('That chip set has been deleted. Start a new tournament instead.'),
    ).toBeInTheDocument();
  });

  it('offers reuse but no results form for a cancelled tournament', async () => {
    await open({ action: 'cancel' });
    await screen.findByRole('heading', { name: 'Tournament cancelled' });
    expect(screen.queryByRole('button', { name: 'Save results' })).not.toBeInTheDocument();
    const next = screen.getByRole('region', { name: 'Play again' });
    expect(within(next).getByRole('button', { name: 'Duplicate tournament' })).toBeEnabled();
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/app/testing/render-app';
import { PRESET_SCHEMA_VERSION, type Preset } from '@/core/persistence/records';
import { chipSet } from '@/features/chip-inventory/domain/testing/fixtures';
import { holdemConfig, holdemSchedule, readyTournament, T0 } from '@/features/live-clock/testing/fixtures';
import { openAppTestStorage } from '@/infrastructure/testing/storage';

function preset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'p1',
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: 'Big game',
    moduleId: 'texas-holdem',
    moduleVersion: '1',
    presetVersion: 1,
    config: holdemConfig({ players: 9, targetDurationMin: 240, structure: 'gentle' }),
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

async function seed() {
  const repos = await openAppTestStorage();
  const schedule = holdemSchedule();
  await repos.tournaments.commit({ tournament: readyTournament({ id: 'live', name: 'Running now', status: 'active' }), schedules: [schedule] });
  await repos.tournaments.commit({
    tournament: readyTournament({ id: 'done', name: 'Last week', status: 'completed', updatedAt: T0 + 1 }),
  });
  await repos.tournaments.commit({ tournament: readyTournament({ id: 'next', name: 'Next week' }) });
  await repos.presets.put(preset());
  await repos.presets.put(preset({ id: 'p2', name: 'Broken', moduleId: 'other-game' }));
  await repos.inventories.put({ ...chipSet([{ colour: 'Blue', quantity: 40 }], 'inv-1').inventory, name: 'Blue box' });
  await renderApp('/', repos);
  return repos;
}

const section = (name: string) => screen.getByRole('region', { name });

describe('home library', () => {
  it('puts the running tournament first and lists everything else', async () => {
    await seed();
    const resume = await screen.findByRole('link', { name: 'Resume Running now' });
    expect(resume).toHaveAttribute('href', '/tournament/live');
    const saved = section('Saved tournaments');
    expect(within(saved).getByRole('link', { name: 'Results: Last week' })).toHaveAttribute('href', '/tournament/done');
    expect(within(saved).getByRole('link', { name: 'Open: Next week' })).toBeInTheDocument();
    expect(within(saved).queryByText('Running now')).not.toBeInTheDocument();
    expect(within(section('Chip sets')).getByText('1 chip types')).toBeInTheDocument();
  });

  it('deletes a tournament only after confirming', async () => {
    const repos = await seed();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete: Last week' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await repos.tournaments.get('done')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Delete: Last week' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Last week')).not.toBeInTheDocument());
    expect(await repos.tournaments.get('done')).toBeUndefined();
  });

  it('deletes presets and chip sets', async () => {
    const repos = await seed();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete: Big game' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete: Blue box' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Chip sets' })).not.toBeInTheDocument());
    expect((await repos.presets.list()).map((p) => p.id)).toEqual(['p2']);
    expect(await repos.inventories.list()).toEqual([]);
  });

  it('starts a new tournament from a preset', async () => {
    const repos = await seed();
    fireEvent.click(await screen.findByRole('button', { name: 'Use preset: Big game' }));
    await screen.findByRole('heading', { level: 1, name: 'Basics' });
    expect(screen.getByLabelText('Players')).toHaveValue('9');
    const draft = (await repos.tournaments.list()).find((x) => x.status === 'draft');
    expect(draft?.config).toMatchObject({ players: 9, targetDurationMin: 240, structure: 'gentle' });
  });

  it('explains a preset it cannot use', async () => {
    await seed();
    fireEvent.click(await screen.findByRole('button', { name: 'Use preset: Broken' }));
    expect(
      await screen.findByText("This preset can't be used with this version of the app."),
    ).toBeInTheDocument();
  });

  it('starts a new tournament with a saved chip set', async () => {
    const repos = await seed();
    fireEvent.click(await screen.findByRole('button', { name: 'New tournament with these chips: Blue box' }));
    await screen.findByRole('heading', { level: 1, name: 'Basics' });
    const draft = (await repos.tournaments.list()).find((x) => x.status === 'draft');
    expect(draft?.setupDraft).toMatchObject({ inventoryId: 'inv-1', inventoryName: 'Blue box' });
  });
});

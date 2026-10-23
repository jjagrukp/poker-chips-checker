import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/app/testing/render-app';
import { createDraft } from '@/features/tournament-setup/state/create';
import { fakePlatform } from '@/features/live-clock/testing/fixtures';
import * as download from '@/shared/utilities/download';

// Settings (spec 01 §5 #8): every preference persists, and the data tools round-trip.

async function openSettings(options: Parameters<typeof renderApp>[2] = {}) {
  const app = await renderApp('/settings', undefined, {
    clockPlatform: fakePlatform(() => 0),
    ...options,
  });
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  return app;
}

describe('SettingsScreen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('switches the tone for the whole app and saves it', async () => {
    const { repos } = await openSettings();
    expect(screen.getByRole('radio', { name: 'Playful' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Plain' }));
    expect(screen.getByRole('radio', { name: 'Plain' })).toBeChecked();
    await waitFor(async () => expect((await repos.settings.get()).tone).toBe('neutral'));
  });

  it('saves sound and alert preferences without a close button', async () => {
    const { repos } = await openSettings();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sound on' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /flash/i }));
    await waitFor(async () => {
      const s = await repos.settings.get();
      expect(s.alertsMuted).toBe(true);
      expect(s.alerts?.flash).toBe(true);
    });
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('seeds new tournaments with the level-end default (spec 11)', async () => {
    const { repos, ctx } = await openSettings();
    const group = screen.getByRole('group', { name: 'When a level ends' });
    expect(within(group).getByRole('radio', { name: 'Wait for the host to start the next level' })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: 'Move on straight away, even mid-hand' }));
    await waitFor(async () => expect((await repos.settings.get()).levelEndDefault).toBe('auto'));
    const id = await createDraft(repos, ctx);
    expect((await repos.tournaments.get(id))?.settings.levelEndBehaviour).toBe('auto');
  });

  it('seeds new tournaments with the break-end default', async () => {
    const { repos, ctx } = await openSettings();
    fireEvent.click(screen.getByRole('radio', { name: 'Start the next level automatically' }));
    await waitFor(async () =>
      expect((await repos.settings.get()).breakEndDefault).toBe('auto'),
    );
    const id = await createDraft(repos, ctx);
    expect((await repos.tournaments.get(id))?.settings.breakEndBehaviour).toBe('auto');
  });

  it('exports a backup, deletes everything, and imports it back', async () => {
    let exported = '';
    vi.spyOn(download, 'downloadText').mockImplementation((_name, text) => {
      exported = text;
    });
    const { repos, ctx } = await openSettings();
    const id = await createDraft(repos, ctx);

    fireEvent.click(screen.getByRole('button', { name: 'Export backup' }));
    await waitFor(() => expect(exported).toContain(id));

    fireEvent.click(screen.getByRole('button', { name: 'Delete all data' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete all data' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(await screen.findByText(/All data deleted\./)).toBeInTheDocument();
    expect(await repos.tournaments.list()).toEqual([]);

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const file = new File([exported], 'backup.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Import backup'), { target: { files: [file] } });
    expect(await screen.findByText(/Backup imported\./)).toBeInTheDocument();
    expect((await repos.tournaments.get(id))?.id).toBe(id);
  });

  it('rejects a file that is not a backup and imports nothing', async () => {
    const { repos } = await openSettings();
    const file = new File(['{"hello":1}'], 'x.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Import backup'), { target: { files: [file] } });
    expect(await screen.findByText("That file isn't a backup from this app.")).toHaveAttribute(
      'role',
      'alert',
    );
    expect(await repos.tournaments.list()).toEqual([]);
  });

  it('refuses a file too big to be a backup without reading it', async () => {
    await openSettings();
    const file = new File(['{}'], 'huge.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: 21 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Import backup'), { target: { files: [file] } });
    expect(await screen.findByText(/too big to be a backup/)).toHaveAttribute('role', 'alert');
  });

  it('shows the known limitations', async () => {
    await openSettings();
    expect(screen.getByRole('heading', { name: 'About and limitations' })).toBeInTheDocument();
    expect(screen.getByText(/Alerts always show on screen as well/)).toBeInTheDocument();
    expect(screen.getByText(/a target, not a guarantee/)).toBeInTheDocument();
  });

  it('links to the standalone limitations page', async () => {
    await openSettings();
    fireEvent.click(screen.getByRole('link', { name: 'Read the full limitations page' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Known limitations' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Before game night' })).toBeInTheDocument();
    expect(screen.getByText(/Safari may delete data/)).toBeInTheDocument();
    expect(screen.getByText(/silent switch off/)).toBeInTheDocument();
  });
});

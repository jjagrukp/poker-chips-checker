import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/app/testing/render-app';

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));

async function startNew() {
  const app = await renderApp('/');
  fireEvent.click(await screen.findByRole('button', { name: 'New tournament' }));
  await screen.findByRole('heading', { level: 1, name: 'Basics' });
  return app;
}

function addChip(index: number, colour: string, quantity: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add chip type' }));
  const row = screen.getByRole('listitem', { name: `Chip type: Chip type ${index}` });
  fireEvent.change(within(row).getByLabelText('Colour'), { target: { value: colour } });
  const named = screen.getByRole('listitem', { name: `Chip type: ${colour}` });
  fireEvent.change(within(named).getByLabelText('How many'), { target: { value: quantity } });
  fireEvent.change(within(named).getByLabelText('Value in this tournament'), {
    target: { value },
  });
}

describe('setup wizard', () => {
  it('keeps answers when going back and after a reload', async () => {
    const { repos, unmount } = await startNew();
    fireEvent.change(screen.getByLabelText('Tournament name (optional)'), {
      target: { value: 'Friday' },
    });
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '8' } });
    next();
    await screen.findByRole('heading', { level: 1, name: 'Length' });
    fireEvent.click(screen.getByRole('radio', { name: '2h' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'Basics' });
    expect(screen.getByLabelText('Players')).toHaveValue('8');
    expect(screen.getByLabelText('Tournament name (optional)')).toHaveValue('Friday');

    const id = (await repos.tournaments.list())[0]?.id ?? '';
    await waitFor(async () => {
      const saved = await repos.tournaments.get(id);
      expect(saved?.name).toBe('Friday');
    });
    unmount();
    // Same storage, fresh mount: the draft resumes at the furthest step.
    await renderApp(`/setup/${id}`, repos);
    await screen.findByRole('heading', { level: 1, name: 'Length' });
    expect(screen.getByRole('radio', { name: '2h' })).toBeChecked();
  });

  it('blocks Next until the step is valid', async () => {
    await startNew();
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '11' } });
    expect(screen.getByText('Choose between 2 and 10 players.')).toBeInTheDocument();
    // The last valid count (6) is still saved, so Next stays enabled.
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    next();
    await screen.findByRole('heading', { level: 1, name: 'Length' });
    next();
    await screen.findByRole('heading', { level: 1, name: 'Chips' });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm inventory' })).toBeDisabled();
  });

  it('runs from chips to a ready tournament', async () => {
    const { repos } = await startNew();
    next();
    await screen.findByRole('heading', { level: 1, name: 'Length' });
    next();
    await screen.findByRole('heading', { level: 1, name: 'Chips' });

    addChip(1, 'White', '100', '25');
    addChip(2, 'Red', '100', '100');
    addChip(3, 'Green', '50', '500');
    addChip(4, 'Black', '50', '1000');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm inventory' }));
    await screen.findByText('Inventory confirmed and saved.');
    expect(await repos.inventories.list()).toHaveLength(1);

    next();
    await screen.findByRole('heading', { level: 1, name: 'Stack' });
    await screen.findByText(/^Starting stack: /, {}, { timeout: 5000 });
    expect(screen.getByText(/big blinds/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());

    next();
    await screen.findByRole('heading', { level: 1, name: 'Structure' });
    fireEvent.click(screen.getByRole('radio', { name: /^Turbo/ }));
    expect(screen.getAllByText('Estimated finish').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());

    next();
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(screen.getByText(/^Scheduled: /)).toBeInTheDocument();
    expect(screen.getByText('Chips used')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await screen.findByRole('heading', { level: 1, name: 'Ready to play' });
    const [saved] = await repos.tournaments.list();
    expect(saved?.status).toBe('ready');
    expect(saved?.scheduleId).toBeDefined();
    expect(saved && (await repos.schedules.get(saved.scheduleId ?? ''))).toBeDefined();
  });

  it('offers the nearest valid stacks when a custom stack is impossible', async () => {
    await startNew();
    next();
    await screen.findByRole('heading', { level: 1, name: 'Length' });
    next();
    await screen.findByRole('heading', { level: 1, name: 'Chips' });
    addChip(1, 'White', '300', '25');
    addChip(2, 'Red', '300', '100');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm inventory' }));
    await screen.findByText('Inventory confirmed and saved.');
    next();
    await screen.findByRole('heading', { level: 1, name: 'Stack' });
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Starting stack (total value per player)'), {
      target: { value: '6010' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check stack' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const options = screen.getAllByRole('button', { name: /^Use / });
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(3);
    const [first] = options;
    if (first) fireEvent.click(first);
    await screen.findByText(/^Starting stack: /);
  });
});

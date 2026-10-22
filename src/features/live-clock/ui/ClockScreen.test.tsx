import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/app/testing/render-app';
import { MINUTE, SECOND } from '@/core/time';
import { start } from '@/core/timer/commands';
import { applyClockCommand, transition } from '@/core/tournaments/lifecycle';
import type { Tournament } from '@/core/tournaments/tournament';
import type { WakeLockState } from '@/infrastructure/screen/wake-lock';
import type { TabRole } from '@/infrastructure/tab-lock/controller-lock';
import { openAppTestStorage } from '@/infrastructure/testing/storage';
import {
  fakePlatform,
  holdemSchedule,
  readyTournament,
  settableClock,
  T0,
} from '../testing/fixtures';

function activeFrom(at = T0): Tournament {
  const schedule = holdemSchedule();
  const begun = transition(readyTournament(), { action: 'start', schedule }, at).tournament;
  return applyClockCommand(begun, schedule, at, start).tournament;
}

async function open(
  seed: Tournament,
  options: {
    now?: number;
    role?: TabRole;
    wakeLock?: WakeLockState;
    monotonic?: () => number;
  } = {},
) {
  const repos = await openAppTestStorage();
  await repos.tournaments.commit({ tournament: seed, schedules: [holdemSchedule()] });
  const clock = settableClock(options.now ?? T0);
  const platform = fakePlatform(options.monotonic ?? clock.now, options.role, options.wakeLock);
  const app = await renderApp(`/tournament/${seed.id}`, repos, {
    ctx: clock.ctx,
    clockPlatform: platform,
  });
  return { ...app, clock, platform };
}

const timer = () => screen.getByRole('timer', { name: 'Time left' });
const button = (name: string) => screen.getByRole('button', { name });
const title = () => screen.getByRole('heading', { level: 1 });
const key = (k: string) => fireEvent.keyDown(window, { key: k });

describe('live clock screen', () => {
  it('starts from the ready screen and counts down', async () => {
    const { clock } = await open(readyTournament(), { wakeLock: 'unsupported' });
    fireEvent.click(await screen.findByRole('button', { name: 'Start the clock' }));
    await screen.findByRole('timer');
    expect(title()).toHaveTextContent('Level 1');
    expect(timer()).toHaveTextContent('10:00');
    expect(screen.getByText('25 / 50')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Keep this screen on in your device settings.')).toBeInTheDocument();

    clock.advance(61 * SECOND);
    await waitFor(() => expect(timer()).toHaveTextContent('08:59'));
    const details = screen.getByRole('region', { name: 'Tournament details' });
    expect(within(details).getByText('Level 2 · 50 / 100')).toBeInTheDocument();
    expect(within(details).getByText('18:59')).toBeInTheDocument();
    expect(within(details).getByText('200 BB')).toBeInTheDocument();
    expect(within(details).getByText('01:01')).toBeInTheDocument();
  });

  it('drives the clock from the keyboard, confirming before going back', async () => {
    const { platform } = await open(activeFrom());
    await screen.findByRole('timer');
    expect(platform.wakeLockRequests).toBeGreaterThan(0);

    key(' ');
    await screen.findByText('Paused');
    key(' ');
    await screen.findByText('Running');
    key('ArrowRight');
    await waitFor(() => expect(title()).toHaveTextContent('Level 2'));
    key('ArrowLeft');
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    key('ArrowLeft');
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(title()).toHaveTextContent('Level 1'));
  });

  it('runs an ad-hoc break and extends it', async () => {
    await open(activeFrom());
    await screen.findByRole('timer');
    key('b');
    await waitFor(() => expect(title()).toHaveTextContent('Break'));
    expect(screen.getByText('On break')).toBeInTheDocument();
    expect(timer()).toHaveTextContent('05:00');
    expect(screen.getByText('Then Level 1: 25 / 50, 10:00 left')).toBeInTheDocument();
    fireEvent.click(button('+5 min to break'));
    await waitFor(() => expect(timer()).toHaveTextContent('10:00'));
    fireEvent.click(button('End break'));
    await waitFor(() => expect(title()).toHaveTextContent('Level 1'));
  });

  it('shows what passed while the app was asleep', async () => {
    await open(activeFrom(), { now: T0 + 27 * MINUTE });
    expect(
      await screen.findByText(
        'While the app was napping, 2 levels and 1 break passed. Now: Level 3 100 / 200, 08:00 left.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Ante 25')).toBeInTheDocument();
    fireEvent.click(button('Dismiss'));
    expect(screen.queryByText(/While the app was napping/)).not.toBeInTheDocument();
  });

  it('recovers after a sleep but re-anchors when the clock goes backwards', async () => {
    // The monotonic clock stands still, as it does on some devices while asleep.
    const { clock } = await open(activeFrom(), { monotonic: () => 0 });
    await screen.findByRole('timer');
    clock.advance(12 * MINUTE);
    expect(
      await screen.findByText(
        'While the app was napping, 1 level passed. Now: Level 2 50 / 100, 08:00 left.',
      ),
    ).toBeInTheDocument();
    expect(timer()).toHaveTextContent('08:00');
    fireEvent.click(button('Dismiss'));

    clock.advance(-10 * MINUTE);
    expect(
      await screen.findByText("Your device's clock changed. The timer has been corrected."),
    ).toBeInTheDocument();
    expect(timer()).toHaveTextContent('08:00');
  });

  it('offers to add levels in overtime, with a preview first', async () => {
    await open(activeFrom(), { now: T0 + 40 * MINUTE });
    expect(await screen.findByText('The schedule has run out. Overtime 05:00')).toBeInTheDocument();
    expect(screen.getByText('Overtime')).toBeInTheDocument();
    fireEvent.click(button('Add levels'));
    const preview = screen.getByRole('region', { name: 'Add levels' });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(within(preview).getByRole('button', { name: 'Add these levels' }));
    await waitFor(() => expect(title()).toHaveTextContent('Level 4'));
    expect(screen.queryByText(/Overtime/)).not.toBeInTheDocument();
  });

  it('edits the schedule while running, locking past levels', async () => {
    await open(activeFrom(), { now: T0 + 12 * MINUTE });
    await screen.findByRole('timer');
    fireEvent.click(button('Edit schedule'));
    expect(screen.queryByRole('button', { name: 'Edit level 1' })).not.toBeInTheDocument();
    fireEvent.click(button('Edit level 2'));
    fireEvent.change(screen.getByLabelText('Level length (minutes)'), { target: { value: '2' } });
    fireEvent.click(button('Save level'));
    fireEvent.click(button('Apply changes'));
    expect(
      screen.getByText(
        'The current level has already run longer than that, so applying will end it now.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(button('Apply and end this level'));
    await waitFor(() => expect(title()).toHaveTextContent('Break'));
  });

  it('adjusts players and ends the tournament after confirming', async () => {
    await open(activeFrom());
    await screen.findByRole('timer');
    fireEvent.click(button('One player out'));
    await screen.findByText('5 of 6');
    fireEvent.click(button('End tournament'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End tournament' }));
    expect(await screen.findByRole('heading', { name: "That's a wrap." })).toBeInTheDocument();
  });

  it('is read-only in a viewer tab until it takes control', async () => {
    await open(activeFrom(), { role: 'viewer' });
    await screen.findByRole('timer');
    expect(
      screen.getByText("This tournament is being run in another tab. You're viewing it here."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'One player out' })).not.toBeInTheDocument();
    key(' ');
    expect(screen.queryByText('Paused')).not.toBeInTheDocument();
    fireEvent.click(button('Take control'));
    await screen.findByRole('button', { name: 'Pause' });
  });
});

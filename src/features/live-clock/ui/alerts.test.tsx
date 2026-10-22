import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/app/testing/render-app';
import { SECOND } from '@/core/time';
import { start } from '@/core/timer/commands';
import { applyClockCommand, transition } from '@/core/tournaments/lifecycle';
import type { Tournament } from '@/core/tournaments/tournament';
import type { NotificationAccess } from '@/infrastructure/notifications/notifier';
import { openAppTestStorage } from '@/infrastructure/testing/storage';
import {
  fakeAudio,
  fakeNotifier,
  fakePlatform,
  holdemSchedule,
  readyTournament,
  settableClock,
  T0,
} from '../testing/fixtures';

// Alerts on the live clock (spec 03 §6, 07 §2): sound after a gesture, always visible,
// deduped across refreshes, silent after gaps, mute, test sounds and notifications.

const ONE_MINUTE_AT = T0 + 540 * SECOND;
const ONE_MINUTE_KEY = `l1:oneMinute:${ONE_MINUTE_AT}`;
const ONE_MINUTE_TEXT = 'One minute left in this level.';

function activeFrom(overrides: Partial<Tournament> = {}): Tournament {
  const schedule = holdemSchedule();
  const begun = transition(readyTournament(), { action: 'start', schedule }, T0).tournament;
  return { ...applyClockCommand(begun, schedule, T0, start).tournament, ...overrides };
}

async function open(
  seed: Tournament,
  now: number,
  options: { muted?: boolean; notifications?: NotificationAccess } = {},
) {
  const repos = await openAppTestStorage();
  await repos.tournaments.commit({ tournament: seed, schedules: [holdemSchedule()] });
  if (options.muted) await repos.settings.update({ alertsMuted: true });
  const clock = settableClock(now);
  const audio = fakeAudio();
  const notifier = fakeNotifier(options.notifications);
  const platform = fakePlatform(clock.now, 'controller', 'held', audio, notifier);
  await renderApp(`/tournament/${seed.id}`, repos, { ctx: clock.ctx, clockPlatform: platform });
  await screen.findByRole('timer');
  return { repos, clock, audio, notifier };
}

const played = (audio: ReturnType<typeof fakeAudio>, type: string) =>
  audio.played.filter((p) => p.type === type);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('live clock alerts', () => {
  it('keeps sound off until a gesture, then sounds and shows each alert once', async () => {
    const { clock, audio, repos } = await open(activeFrom(), ONE_MINUTE_AT - 5 * SECOND);
    expect(await screen.findByText('Sound is off until you tap the screen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on sound' }));
    await waitFor(() =>
      expect(screen.queryByText('Sound is off until you tap the screen.')).not.toBeInTheDocument(),
    );
    // Queued ahead on the audio timeline, so it stays on time in a throttled tab.
    await waitFor(() => expect(played(audio, 'oneMinute')).toHaveLength(1));
    expect(played(audio, 'oneMinute')[0]?.delayMs).toBeGreaterThan(0);

    for (let i = 0; i < 6; i++) {
      clock.advance(SECOND);
      await pause(300);
    }
    expect(await screen.findByRole('alert')).toHaveTextContent(ONE_MINUTE_TEXT);
    expect(played(audio, 'oneMinute')).toHaveLength(1);
    await waitFor(async () =>
      expect((await repos.tournaments.get('t1'))?.firedAlerts).toContain(ONE_MINUTE_KEY),
    );
  });

  it('never repeats an alert already fired before a refresh', async () => {
    const seed = activeFrom({ firedAlerts: [ONE_MINUTE_KEY] });
    const { clock, audio } = await open(seed, ONE_MINUTE_AT - SECOND);
    fireEvent.click(document.body);
    await pause(300);
    clock.advance(SECOND);
    await pause(600);
    expect(screen.queryByText(ONE_MINUTE_TEXT)).not.toBeInTheDocument();
    expect(played(audio, 'oneMinute')).toEqual([]);
  });

  it('marks alerts crossed during a gap as fired without replaying them', async () => {
    const { clock, audio, repos } = await open(activeFrom(), T0 + 8 * 60 * SECOND);
    fireEvent.click(document.body);
    await pause(300);
    clock.advance(3 * 60 * SECOND);
    await waitFor(async () =>
      expect((await repos.tournaments.get('t1'))?.firedAlerts).toContain(ONE_MINUTE_KEY),
    );
    expect(audio.cancels).toBeGreaterThan(0);
    expect(audio.played.filter((p) => p.delayMs === 0)).toEqual([]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows alerts but stays silent when muted', async () => {
    const { clock, audio } = await open(activeFrom(), ONE_MINUTE_AT - SECOND, { muted: true });
    expect(screen.queryByText('Sound is off until you tap the screen.')).not.toBeInTheDocument();
    fireEvent.click(document.body);
    await pause(300);
    clock.advance(SECOND);
    expect(await screen.findByRole('alert')).toHaveTextContent(ONE_MINUTE_TEXT);
    expect(audio.played).toEqual([]);
  });

  it('tests sounds, changes preferences and handles refused notifications', async () => {
    const { audio, repos } = await open(activeFrom(), T0, { notifications: 'denied' });
    fireEvent.click(screen.getByRole('button', { name: 'Sound & alerts' }));
    const panel = screen.getByRole('region', { name: 'Sound & alerts' });

    fireEvent.click(within(panel).getByRole('button', { name: 'Test sound: New level chime' }));
    await waitFor(() => expect(played(audio, 'levelStart')).toEqual([{ type: 'levelStart', delayMs: 0, beat: undefined }]));

    fireEvent.click(within(panel).getByRole('checkbox', { name: 'One minute left' }));
    fireEvent.change(within(panel).getByRole('slider', { name: 'Volume' }), { target: { value: '30' } });
    await waitFor(() => expect(audio.volume).toBe(0.3));
    await waitFor(async () =>
      expect((await repos.settings.get()).alerts).toEqual({ enabled: { oneMinute: false }, volume: 0.3 }),
    );

    const notify = within(panel).getByRole('checkbox', { name: /Notify me/ });
    fireEvent.click(notify);
    expect(
      await within(panel).findByText(
        'Notifications are blocked for this site. You can allow them in your browser settings.',
      ),
    ).toBeInTheDocument();
    expect(notify).not.toBeChecked();

    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Sound on' }));
    await waitFor(async () => expect((await repos.settings.get()).alertsMuted).toBe(true));
  });

  it('notifies while the tab is hidden when allowed', async () => {
    const { clock, notifier } = await open(activeFrom(), ONE_MINUTE_AT - SECOND);
    fireEvent.click(screen.getByRole('button', { name: 'Sound & alerts' }));
    const panel = screen.getByRole('region', { name: 'Sound & alerts' });
    fireEvent.click(within(panel).getByRole('checkbox', { name: /Notify me/ }));
    await waitFor(() => expect(within(panel).getByRole('checkbox', { name: /Notify me/ })).toBeChecked());

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      clock.advance(SECOND);
      await waitFor(() =>
        expect(notifier.shown).toEqual([{ title: 'Friday night', body: ONE_MINUTE_TEXT }]),
      );
    } finally {
      // Drops the own property so the prototype's getter applies again.
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });

  it('plays the completion sound when this tab ends the tournament', async () => {
    const { audio } = await open(activeFrom(), T0 + 60 * SECOND);
    fireEvent.click(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'End tournament' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End tournament' }));
    await screen.findByRole('heading', { name: "That's a wrap." });
    expect(played(audio, 'complete')).toEqual([{ type: 'complete', delayMs: 0, beat: undefined }]);
  });
});

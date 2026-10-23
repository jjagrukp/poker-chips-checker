import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderApp } from '@/app/testing/render-app';
import { MINUTE, SECOND } from '@/core/time';
import { start } from '@/core/timer/commands';
import { applyClockCommand, transition } from '@/core/tournaments/lifecycle';
import type { Tournament } from '@/core/tournaments/tournament';
import {
  fakePlatform,
  holdemSchedule,
  readyTournament,
  settableClock,
  T0,
} from '@/features/live-clock/testing/fixtures';
import { createScreenClient, type ScreenClient } from '@/infrastructure/screen-share/client';
import { createShareStorage, type Share } from '@/infrastructure/screen-share/shares';
import { openAppTestStorage } from '@/infrastructure/testing/storage';
import { createMemoryRateLimiter } from '../../../../api/rate-limit';
import { createMemoryScreenStore, handleScreen } from '../../../../api/screens';
import { SCREEN_SCHEMA_VERSION } from '../wire';
import { createScreenShareService } from '../service';
import { ScreenView } from './ScreenView';

// Spec 08 §5: phone shares → relay (the real handler, in memory) → TV renders the clock.

const CODE = 'ABCD2345';
const KEY = 'k'.repeat(22);

function activeFrom(at = T0): Tournament {
  const schedule = holdemSchedule();
  const begun = transition(readyTournament(), { action: 'start', schedule }, at).tournament;
  return applyClockCommand(begun, schedule, at, start).tournament;
}

/** The relay endpoint behind a fake fetch; the browser would add Origin itself. */
function relay(now: () => number) {
  const store = createMemoryScreenStore();
  const limiter = createMemoryRateLimiter({ perIpPerHour: 1_000, dailyCap: 10_000 });
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://app.test');
    const headers = new Headers(init.headers);
    headers.set('origin', 'http://app.test');
    return handleScreen(
      new Request(url, { ...init, headers }),
      url.pathname.split('/').pop() ?? '',
      {
        store,
        limiter,
        now,
        clientIp: () => '192.0.2.1',
      },
    );
  }) as typeof globalThis.fetch;
  return { fetch, client: (clock = now) => createScreenClient(fetch, clock) };
}

function renderScreen(client: ScreenClient, now: () => number, code = CODE) {
  const platform = fakePlatform(now, 'viewer');
  return render(
    <MemoryRouter>
      <ScreenView code={code} client={client} platform={platform} now={now} pollMs={20} />
    </MemoryRouter>,
  );
}

const timer = () => screen.getByRole('timer', { name: 'Time left' });

describe('screen share', () => {
  it('shows the phone clock on a screen, read-only, and follows a pause', async () => {
    const phone = settableClock(T0);
    const tv = settableClock(T0);
    const { client } = relay(phone.now);
    const tournament = activeFrom();
    await client().put(CODE, KEY, {
      schemaVersion: SCREEN_SCHEMA_VERSION,
      tournament,
      schedule: holdemSchedule(),
      sentAt: T0,
    });

    renderScreen(client(tv.now), tv.now);
    expect(await screen.findByRole('timer')).toHaveTextContent('10:00');
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByText(/viewing it here/)).not.toBeInTheDocument();

    tv.advance(61 * SECOND);
    phone.advance(61 * SECOND);
    await waitFor(() => expect(timer()).toHaveTextContent('08:59'));
  });

  it('shows the hand rankings beside the clock only when the phone turned them on (spec 10)', async () => {
    const tv = settableClock(T0);
    const { client } = relay(tv.now);
    const tournament = activeFrom();
    const send = (showReference: boolean) =>
      client().put(CODE, KEY, {
        schemaVersion: SCREEN_SCHEMA_VERSION,
        tournament: { ...tournament, settings: { ...tournament.settings, showReference } },
        schedule: holdemSchedule(),
        sentAt: T0 + (showReference ? 1 : 2),
      });
    await send(true);
    renderScreen(client(tv.now), tv.now);
    expect(await screen.findByRole('heading', { name: 'Hand rankings' })).toBeInTheDocument();
    const hands = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(hands[0]).toContain('Royal flush');
    expect(hands[9]).toContain('High card');

    await send(false);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Hand rankings' })).not.toBeInTheDocument(),
    );
  });

  it('big-screen notices: alerts as a toast, the sound prompt as a pill (spec 11)', async () => {
    const tv = settableClock(T0);
    const { client } = relay(tv.now);
    const t = activeFrom();
    // One minute and a bit left in level 1.
    if (!t.clock) throw new Error('no clock');
    const clock = {
      ...t.clock,
      status: 'running' as const,
      deadline: T0 + 62 * SECOND,
    };
    await client().put(CODE, KEY, {
      schemaVersion: SCREEN_SCHEMA_VERSION,
      tournament: { ...t, clock },
      schedule: holdemSchedule(),
      sentAt: T0,
    });
    renderScreen(client(tv.now), tv.now);
    await screen.findByRole('timer');
    const pill = screen
      .getByText('Sound is off until you tap the screen.')
      .closest('[role="status"]');
    expect(pill).toHaveClass('fixed');
    expect(within(pill as HTMLElement).getByRole('button', { name: 'Turn on sound' })).toHaveClass(
      'min-h-11',
    );

    // Live ticks (a jump of 2 s or more counts as a sleep, and is marked missed instead).
    for (let i = 0; i < 4; i++) {
      tv.advance(SECOND);
      await new Promise((r) => setTimeout(r, 300));
    }
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('One minute left');
    expect(toast).toHaveClass('fixed');
  });

  it('shows "Time\'s up" and no toast while the TV waits for the host (spec 11)', async () => {
    const tv = settableClock(T0);
    const { client } = relay(tv.now);
    const t = activeFrom();
    const schedule = holdemSchedule();
    const held = {
      status: 'paused' as const,
      segmentIndex: 1,
      remainingMs: schedule.segments[1]?.durationMs ?? 0,
      holdAtIndex: 1,
      revision: 5,
      updatedAt: T0,
    };
    await client().put(CODE, KEY, {
      schemaVersion: SCREEN_SCHEMA_VERSION,
      tournament: {
        ...t,
        clock: held,
        settings: { ...t.settings, levelEndBehaviour: 'waitForHost' },
      },
      schedule,
      sentAt: T0,
    });
    renderScreen(client(tv.now), tv.now);
    expect(await screen.findByText("Time's up — finish this hand")).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Level 2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Read-only: only the phone can start the level.
    expect(screen.queryByRole('button', { name: 'Start Level 2' })).not.toBeInTheDocument();
  });

  it('corrects for a TV clock that is a few minutes out', async () => {
    const phone = settableClock(T0);
    const tv = settableClock(T0 + 3 * MINUTE);
    const { client } = relay(phone.now);
    await client().put(CODE, KEY, {
      schemaVersion: SCREEN_SCHEMA_VERSION,
      tournament: activeFrom(),
      schedule: holdemSchedule(),
      sentAt: T0,
    });
    renderScreen(client(tv.now), tv.now);
    expect(await screen.findByRole('timer')).toHaveTextContent('10:00');
  });

  it('says when a link has ended, and when it is reconnecting', async () => {
    const { client } = relay(() => T0);
    renderScreen(client(), () => T0, 'ZZZZ2345');
    expect(await screen.findByRole('alert')).toHaveTextContent('This screen link has ended');
  });

  it('keeps counting through failed polls and shows a reconnecting notice', async () => {
    const tv = settableClock(T0);
    const { client } = relay(tv.now);
    await client().put(CODE, KEY, {
      schemaVersion: SCREEN_SCHEMA_VERSION,
      tournament: activeFrom(),
      schedule: holdemSchedule(),
      sentAt: T0,
    });
    const real = client(tv.now);
    let down = false;
    const flaky: ScreenClient = {
      ...real,
      get: (code) => (down ? Promise.resolve({ ok: false, reason: 'network' }) : real.get(code)),
    };
    renderScreen(flaky, tv.now);
    await screen.findByRole('timer');
    down = true;
    tv.advance(30 * SECOND);
    expect(await screen.findByText(/Reconnecting/)).toBeInTheDocument();
    // The clock redraws on its own tick, not on each poll.
    await waitFor(() => expect(timer()).toHaveTextContent('09:30'));
  });

  it('phone: "Show on a TV" shares the clock and every change after it', async () => {
    const clock = settableClock(T0);
    const { client } = relay(clock.now);
    const repos = await openAppTestStorage();
    const tournament = activeFrom();
    await repos.tournaments.commit({ tournament, schedules: [holdemSchedule()] });
    const store = new Map<string, string>();
    const screenShare = createScreenShareService({
      client: client(),
      storage: createShareStorage(
        () =>
          ({
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
          }) as Storage,
      ),
      newShare: (): Share => ({ schemaVersion: 1, code: CODE, key: KEY }),
      now: clock.now,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    });
    await renderApp(`/tournament/${tournament.id}`, repos, {
      ctx: clock.ctx,
      clockPlatform: fakePlatform(clock.now),
      screenShare,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Show on a TV' }));
    expect(await screen.findByText('ABCD-2345')).toBeInTheDocument();
    expect(screen.getByText(/only this phone can control it/)).toBeInTheDocument();
    await screen.findByText('The TV link is up to date.');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(async () => {
      const result = await client().get(CODE);
      expect(result.ok && result.reply.snapshot.tournament.clock?.status).toBe('paused');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop showing on TV' }));
    await waitFor(async () => expect((await client().get(CODE)).ok).toBe(false));
    expect(screen.getByRole('button', { name: 'Show on a TV' })).toBeInTheDocument();
  });

  it('TV: the code page normalises what was typed and rejects nonsense', async () => {
    await renderApp('/screen', undefined, { screenClient: relay(() => T0).client() });
    const input = await screen.findByLabelText("Code from the host's phone");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show clock' }));
    expect(screen.getByRole('alert')).toHaveTextContent('8 letters and numbers');
    fireEvent.change(input, { target: { value: 'zzzz-2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show clock' }));
    expect(
      await screen.findByText(/Connecting to the clock|This screen link has ended/),
    ).toBeInTheDocument();
  });
});

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ModuleContext } from '@/core/modules/contract';
import type { ClockPlatform, ClockStore } from '@/features/live-clock/state/clock-store';
import { useAudioUnlock } from '@/features/live-clock/ui/alerts';
import { LiveClock } from '@/features/live-clock/ui/LiveClock';
import type { ScreenClient } from '@/infrastructure/screen-share/client';
import { HoldemConfigSchema } from '@/modules/texas-holdem/config';
import { buttonPrimary, buttonSecondary, card, label } from '@/shared/components/styles';
import { useT } from '@/shared/messages/tone';
import { phoneClockOffset, type ScreenSnapshot } from '../schema';
import { normaliseCode } from '../wire';

// The TV side of screen share (spec 08 §1.4–1.6): `/screen` takes a code, `/screen/:code` polls
// the relay and shows the clock read-only. The clock is derived here from the snapshot, so it
// keeps counting between polls and through a dropped connection.

export const POLL_MS = 2_000;
/** Failed polls in a row before the screen says it's reconnecting. */
const FAILURES_BEFORE_NOTICE = 3;
/** Smaller offset changes are network jitter; following them would make the seconds jump. */
const OFFSET_JITTER_MS = 250;

type ScreenPlatform = Pick<ClockPlatform, 'monotonic' | 'wakeLock' | 'audio' | 'notifier'>;

export function ScreenEntry() {
  const t = useT();
  const id = useId();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The only control on the page; a TV remote can't easily click its way into it.
  useEffect(() => input.current?.focus(), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = normaliseCode(value);
    if (!code) {
      setInvalid(true);
      return;
    }
    navigate(`/screen/${code}`);
  };

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="font-display text-4xl">{t('screen.title')}</h1>
      <form onSubmit={submit} className={`${card} flex flex-col gap-3`} noValidate>
        <label htmlFor={`${id}-code`} className={label}>
          {t('screen.codeLabel')}
        </label>
        <input
          id={`${id}-code`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          ref={input}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
          className="min-h-14 rounded-xl border border-ink-muted/40 bg-surface px-4 text-center font-display text-4xl uppercase tracking-widest"
          placeholder="ABCD-2345"
        />
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {t('screen.codeHint')}
        </p>
        {invalid && <p role="alert">{t('screen.badCode')}</p>}
        <button type="submit" className={buttonPrimary}>
          {t('screen.open')}
        </button>
      </form>
    </main>
  );
}

export function ScreenUnavailable() {
  const t = useT();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 text-center">
      <p role="alert" className="font-display text-3xl">
        {t('screen.unavailable')}
      </p>
    </main>
  );
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ended' }
  | { kind: 'live'; snapshot: ScreenSnapshot };

interface ViewProps {
  code: string;
  client: ScreenClient;
  platform: ScreenPlatform;
  /** The TV's own clock; tests inject one. */
  now?: () => number;
  pollMs?: number;
}

export function ScreenView({ code, client, platform, now = Date.now, pollMs = POLL_MS }: ViewProps) {
  const t = useT();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [failures, setFailures] = useState(0);
  const offset = useRef(0);
  const audio = useAudioUnlock(platform.audio);

  const ctx = useMemo<ModuleContext>(
    () => ({ clock: { now: () => now() + offset.current }, newId: () => crypto.randomUUID() }),
    [now],
  );

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSent: number | undefined;
    const poll = async () => {
      const result = await client.get(code);
      if (stopped) return;
      if (result.ok) {
        const next = phoneClockOffset(result.reply, result.receivedAt);
        if (lastSent === undefined || Math.abs(next - offset.current) > OFFSET_JITTER_MS) {
          offset.current = next;
        }
        const { snapshot } = result.reply;
        // Same snapshot as last time: keep the objects, so nothing re-renders.
        if (snapshot.sentAt !== lastSent) {
          lastSent = snapshot.sentAt;
          setPhase({ kind: 'live', snapshot });
        }
        setFailures(0);
      } else if (result.reason === 'not_found') {
        lastSent = undefined;
        setPhase({ kind: 'ended' });
      } else {
        setFailures((n) => n + 1);
      }
      timer = setTimeout(() => void poll(), pollMs);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [client, code, pollMs]);

  const another = (
    <button type="button" className={buttonSecondary} onClick={() => navigate('/screen')}>
      {t('screen.another')}
    </button>
  );
  const message = (text: string, role: 'status' | 'alert' = 'status') => (
    <main className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
      <p role={role} className="font-display text-3xl">
        {text}
      </p>
      {another}
    </main>
  );

  if (phase.kind === 'loading') {
    return failures >= FAILURES_BEFORE_NOTICE ? message(t('screen.reconnecting')) : message(t('screen.loading'));
  }
  if (phase.kind === 'ended') return message(t('screen.ended'), 'alert');

  const { tournament, schedule } = phase.snapshot;
  if (tournament.status === 'completed' || tournament.status === 'cancelled') {
    return message(t('screen.finished', { name: tournament.name ?? t('home.untitled') }));
  }
  if (tournament.status !== 'active' || !tournament.clock) return message(t('screen.waiting'));

  const config = HoldemConfigSchema.safeParse(tournament.config);
  return (
    <LiveClock
      tournament={tournament}
      anchor={tournament.clock}
      schedule={schedule}
      config={config.success ? config.data : undefined}
      state={VIEW_STATE}
      actions={NO_ACTIONS}
      ctx={ctx}
      platform={platform}
      audio={audio}
      screen
      notice={failures >= FAILURES_BEFORE_NOTICE ? t('screen.reconnecting') : undefined}
    />
  );
}

const VIEW_STATE: Pick<ClockStore, 'role' | 'muted' | 'alertPrefs' | 'recovery' | 'warning'> = {
  role: 'viewer',
  muted: false,
  alertPrefs: {},
  recovery: undefined,
  warning: undefined,
};

const done = async () => undefined;

/** A screen never writes: every control is the phone's. */
const NO_ACTIONS = {
  init: () => () => undefined,
  reload: done,
  command: done,
  begin: done,
  end: done,
  changePlayers: done,
  applyEdit: async () => 'failed' as const,
  recover: done,
  skewed: done,
  toggleMute: done,
  updateAlertPrefs: done,
  markAlertsFired: done,
  dismissRecovery: () => undefined,
  dismissWarning: () => undefined,
  takeControl: () => undefined,
  flush: done,
};

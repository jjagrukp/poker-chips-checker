import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { alertEnabled } from '@/core/alerts/alerts';
import type { PlannedAlert } from '@/core/alerts/plan';
import type { ModuleContext } from '@/core/modules/contract';
import type { Schedule, Segment } from '@/core/scheduling/schedule';
import { MINUTE, SECOND } from '@/core/time';
import type { ClockAnchor } from '@/core/timer/anchor';
import {
  endBreak,
  extendBreak,
  next,
  pause,
  previous,
  resume,
  start,
  startBreakNow,
  type ClockState,
  type CommandResult,
} from '@/core/timer/commands';
import { deriveClock, type ClockView } from '@/core/timer/derive-clock';
import { deriveOptions, type Tournament } from '@/core/tournaments/tournament';
import type { AudioState } from '@/infrastructure/audio/alert-audio';
import type { HoldemConfig } from '@/modules/texas-holdem/config';
import { extend, type EditResult } from '@/modules/texas-holdem/edits';
import { formatBlinds, formatChips, formatDurationMin } from '@/modules/texas-holdem/format';
import { levelData } from '@/modules/texas-holdem/generate';
import { MusicPanel } from '@/features/music/ui/MusicPanel';
import { MusicPlayer } from '@/features/music/ui/MusicPlayer';
import { Icon } from '@/shared/components/Icon';
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  buttonIcon,
  card,
  eyebrow,
  pill,
} from '@/shared/components/styles';
import { useT, type Translate } from '@/shared/messages/tone';
import {
  clockScreen,
  displayKey,
  formatCountdown,
  formatElapsed,
  levelRemaining,
} from '../domain/screen';
import type { ClockPlatform, ClockStore, Recovery } from '../state/clock-store';
import { useAlerts } from './alerts';
import { AlertSettings } from './AlertSettings';
import { useFullscreen, useRecoveryTriggers, useShortcuts, useTicker, useWakeLock } from './hooks';
import { HandRankings } from './HandRankings';
import { RunningEditor } from './RunningEditor';

// Live clock screen (spec 01 §6). Everything shown is derived from the stored anchor at
// `now`; buttons dispatch pure core commands through the store.

const EXTRA_BREAK_MS = 5 * MINUTE;
const DEFAULT_BREAK_MIN = 10;
const OVERTIME_LEVELS = 3;

type StateKind = 'idle' | 'running' | 'paused' | 'break' | 'awaitingHost' | 'overtime';

const STATE_COLOUR: Record<StateKind, string> = {
  idle: 'text-state-paused',
  running: 'text-state-level',
  paused: 'text-state-paused',
  break: 'text-state-break',
  awaitingHost: 'text-state-warning',
  overtime: 'text-state-overtime',
};

const STATE_BG: Record<StateKind, string> = {
  idle: 'bg-state-paused',
  running: 'bg-state-level',
  paused: 'bg-state-paused',
  break: 'bg-state-break',
  awaitingHost: 'bg-state-warning',
  overtime: 'bg-state-overtime',
};

/** How far through the current segment the clock is, 0–1. */
function segmentProgress(durationMs: number, remainingMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - remainingMs / durationMs));
}

interface Props {
  tournament: Tournament;
  anchor: ClockAnchor;
  schedule: Schedule;
  config: HoldemConfig | undefined;
  state: Pick<ClockStore, 'role' | 'muted' | 'alertPrefs' | 'recovery' | 'warning'>;
  actions: Omit<
    ClockStore,
    | 'phase'
    | 'tournament'
    | 'schedule'
    | 'config'
    | 'role'
    | 'muted'
    | 'alertPrefs'
    | 'recovery'
    | 'warning'
  >;
  ctx: ModuleContext;
  platform: Pick<ClockPlatform, 'monotonic' | 'wakeLock' | 'audio' | 'notifier'>;
  /** Unlocked on the first gesture by ClockScreen (browsers block audio until then). */
  audio: { state: AudioState; unlock: () => void };
  /** Controller-only panel under the controls. */
  extras?: ReactNode;
  /** The host can send music to a shared TV (spec 12): only where screen share is on. */
  music?: boolean;
  /**
   * Shared-screen display (spec 08): read-only, big layout, no home link or viewer banner, but
   * it keeps the screen awake and sounds the alerts, since the TV is the room's speaker.
   */
  screen?: boolean;
  /** A warning shown above the clock (a shared screen's "Reconnecting…"). */
  notice?: ReactNode;
}

export function LiveClock({
  tournament,
  anchor,
  schedule,
  config,
  state,
  actions,
  ctx,
  platform,
  audio,
  extras,
  music = false,
  screen = false,
  notice,
}: Props) {
  const t = useT();
  const controller = state.role === 'controller';
  /** This device plays the alerts: the controlling tab, or a shared screen. */
  const speaker = controller || screen;
  const { breakEndBehaviour, levelEndBehaviour } = tournament.settings;
  const options = useMemo(
    () => deriveOptions({ settings: { breakEndBehaviour, levelEndBehaviour } }),
    [breakEndBehaviour, levelEndBehaviour],
  );
  const derive = (at: number) => deriveClock(schedule, anchor, at, options);
  const { skewed, recover, command } = actions;
  const onSkew = useCallback(
    (skewMs: number) => {
      if (controller) void skewed(skewMs);
    },
    [controller, skewed],
  );
  const triggerRecover = useCallback(() => void recover(), [recover]);
  const { startedAt } = tournament;
  const now = useTicker({
    clock: ctx.clock,
    monotonic: platform.monotonic,
    // Elapsed time keeps counting while paused, so it is part of the key too.
    keyOf: (at) =>
      `${displayKey(derive(at))}|${
        startedAt === undefined ? '' : Math.floor((at - startedAt) / SECOND)
      }`,
    onSkew,
    onWake: triggerRecover,
    resetKey: `${schedule.id}:${anchor.revision}`,
  });
  useRecoveryTriggers(triggerRecover);

  const view = derive(now);
  const model = clockScreen(schedule, anchor, view, tournament, config);
  // A TV stays awake while paused too: it's on show the whole night.
  const wakeLock = useWakeLock(
    platform.wakeLock,
    screen || (controller && view.status === 'running'),
  );
  const fullscreen = useFullscreen();
  const [confirming, setConfirming] = useState<'previous' | 'end' | null>(null);
  const [editing, setEditing] = useState(false);
  const [extension, setExtension] = useState<EditResult | null>(null);
  const [extensionRefused, setExtensionRefused] = useState(false);
  const [alertSettings, setAlertSettings] = useState(false);
  const [musicPanel, setMusicPanel] = useState(false);
  const musicButton = useRef<HTMLButtonElement>(null);
  const alertsButton = useRef<HTMLButtonElement>(null);
  const alert = useAlerts({
    schedule,
    anchor,
    options,
    firedAlerts: tournament.firedAlerts,
    clock: ctx.clock,
    audio: platform.audio,
    audioState: audio.state,
    notifier: platform.notifier,
    prefs: state.alertPrefs,
    muted: state.muted,
    controller,
    sound: speaker,
    onFired: (keys) => void actions.markAlertsFired(keys),
    notify: (fired) => ({
      title: tournament.name ?? t('home.untitled'),
      body: alertText(t, fired, options.levelEndBehaviour === 'waitForHost'),
    }),
  });

  const index = view.segmentIndex;
  const overtime = view.overtimeMs > 0;
  const onBreak =
    view.inInterlude ||
    (model.segment.kind === 'break' && view.status !== 'idle' && view.status !== 'awaitingHost');
  const kind: StateKind = overtime
    ? 'overtime'
    : view.status === 'awaitingHost'
      ? 'awaitingHost'
      : view.status === 'idle' || view.status === 'paused'
        ? view.status
        : onBreak
          ? 'break'
          : 'running';
  const title = view.inInterlude ? t('clock.adhocBreak') : segmentLabel(t, model.segment, index);
  const canNext = !view.inInterlude && index + 1 < schedule.segments.length;
  const canPrevious = !view.inInterlude && index > 0;
  const breakMs = (config?.breaks?.durationMin ?? DEFAULT_BREAK_MIN) * MINUTE;

  const run = (cmd: (s: ClockState, at: number) => CommandResult) => void command(cmd);
  const pauseResume = () =>
    run(view.status === 'idle' ? start : view.status === 'running' ? pause : resume);
  const toggleBreak = () => {
    if (onBreak) run(endBreak);
    // Held before the scheduled break: start it, rather than stacking an ad-hoc one (spec 11).
    else if (view.status === 'awaitingHost' && model.segment.kind === 'break') run(resume);
    else if (view.status !== 'idle') run((s, at) => startBreakNow(s, at, breakMs));
  };

  useShortcuts(
    controller
      ? {
          pauseResume,
          next: canNext ? () => run(next) : undefined,
          previous: canPrevious ? () => setConfirming('previous') : undefined,
          breakToggle: toggleBreak,
          mute: () => void actions.toggleMute(),
          fullscreen: fullscreen.toggle,
        }
      : { fullscreen: fullscreen.toggle },
    // Off while a dialog or the editor has the keyboard (arrows on its buttons, typing).
    confirming === null && !editing && extension === null,
  );

  const nowLabel = `${title}${model.blinds ? ` ${formatBlinds(model.blinds.sb, model.blinds.bb)}` : ''}`;
  const tv = fullscreen.active || screen;
  // Held before the next segment (spec 11): after a level ran out the table may be mid-hand,
  // after a break players may still be away. Either way only the host starts the clock.
  const held = view.status === 'awaitingHost';
  const previousSegment = schedule.segments[index - 1];
  // Inferred, not stored: a level hold has the next segment at full length. (An ad-hoc break
  // taken while already held, that then also waits, reads as "Time's up" too: harmless.)
  const levelOver =
    held && previousSegment?.kind === 'level' && view.remainingMs === model.segment.durationMs;
  const startButton = useRef<HTMLButtonElement>(null);
  const dock = useRef<HTMLElement>(null);
  // The dock's play button goes away when the clock holds: keep keyboard focus on the action.
  useEffect(() => {
    if (!held) return;
    const active = document.activeElement;
    if (active === document.body || (active && dock.current?.contains(active))) {
      startButton.current?.focus();
    }
  }, [held]);
  const startLabel =
    model.segment.kind === 'break'
      ? t('clock.control.startBreak')
      : t('clock.control.startLevel', { label: title });
  const showReference = tournament.settings.showReference ?? false;
  const withReference = tv && showReference;
  const countdown = formatCountdown(view.remainingMs);
  // "1:00:00" has two more characters than "12:00": step the size down so it still fits.
  const long = countdown.length > 5;
  // An ad-hoc break has no fixed length to measure against.
  const progress = view.inInterlude
    ? undefined
    : segmentProgress(model.segment.durationMs, view.remainingMs);

  return (
    <main
      className={
        tv
          ? `fixed inset-0 z-50 flex flex-col gap-4 overflow-auto bg-surface bg-[radial-gradient(120%_70%_at_50%_-10%,#0f3d2e99_0%,transparent_60%)] p-4 sm:gap-6 sm:p-8 ${
              // Keep in step with the panel's w-[30%] and right-[2vw] below.
              withReference ? 'lg:pr-[calc(30%+4vw)]' : ''
            }`
          : 'mx-auto flex w-full max-w-5xl flex-col gap-4'
      }
    >
      <header className="flex min-h-11 items-center justify-between gap-3">
        {tv ? (
          <p className="truncate font-display text-xl font-semibold text-ink-muted sm:text-3xl">
            {tournament.name ?? t('home.untitled')}
          </p>
        ) : (
          <Link to="/" className={`${buttonQuiet} -ml-2`}>
            <Icon name="home" />
            {t('setup.home')}
          </Link>
        )}
        {!tv && tournament.name && (
          <p className="hidden min-w-0 truncate font-display text-lg font-semibold text-ink-muted sm:block">
            {tournament.name}
          </p>
        )}
        <p className={`${pill} ${STATE_COLOUR[kind]} ${tv ? 'sm:px-4 sm:py-1.5 sm:text-lg' : ''}`}>
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${STATE_BG[kind]} ${kind === 'running' ? 'motion-safe:animate-pulse' : ''}`}
          />
          <span>{t(`clock.state.${kind}`)}</span>
        </p>
      </header>

      {notice && <Banner tone="warning">{notice}</Banner>}
      {!controller && !screen && (
        <Banner tone="info">
          <span>{t('tabs.viewerMode')}</span>
          <button type="button" className={buttonSecondary} onClick={actions.takeControl}>
            {t('tabs.takeControl')}
          </button>
        </Banner>
      )}
      {state.recovery && alertEnabled(state.alertPrefs, 'recovery') && (
        <Banner tone="info" onDismiss={actions.dismissRecovery}>
          {recoveryText(t, state.recovery, nowLabel, formatCountdown(view.remainingMs))}
        </Banner>
      )}
      {state.warning && (
        <Banner tone="warning" onDismiss={actions.dismissWarning}>
          {t(`clock.warning.${state.warning}`)}
        </Banner>
      )}
      {speaker && !state.muted && audio.state === 'locked' && tv && (
        <div
          role="status"
          className="fixed bottom-[3vh] left-1/2 z-[64] flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface-raised/95 py-1.5 pr-1.5 pl-4 text-[min(2vh,1.4vw)] shadow-[var(--shadow-card)] backdrop-blur"
        >
          <Icon name="mute" className="size-[1.2em] text-ink-muted" />
          <span>{t('alerts.locked')}</span>
          <button
            type="button"
            className={`${buttonSecondary} min-h-11 rounded-full text-[1em]`}
            onClick={audio.unlock}
          >
            <Icon name="volume" className="size-[1.1em]" />
            {t('alerts.unlock')}
          </button>
        </div>
      )}
      {speaker && !state.muted && audio.state === 'locked' && !tv && (
        <Banner tone="info">
          <span className="flex items-center gap-2">
            <Icon name="mute" className="size-5 text-ink-muted" />
            {t('alerts.locked')}
          </span>
          <button type="button" className={buttonSecondary} onClick={audio.unlock}>
            <Icon name="volume" />
            {t('alerts.unlock')}
          </button>
        </Banner>
      )}
      {speaker && audio.state === 'unsupported' && (
        <p className="text-sm text-ink-muted">{t('alerts.unsupported')}</p>
      )}
      {/* While held, the "Time's up" headline already says it; a toast would cover it on a TV. */}
      {alert && !(tv && held) && (
        <div
          role="alert"
          className={
            tv
              ? 'fixed top-[3vh] left-1/2 z-[65] flex w-max max-w-[min(90vw,70rem)] -translate-x-1/2 items-center gap-[1.2vw] rounded-[2vh] border-2 border-state-warning/70 bg-surface-raised/95 px-[2.4vw] py-[1.6vh] font-display text-[min(4.2vh,2.8vw)] font-bold shadow-[0_2vh_6vh_-1vh_rgba(0,0,0,0.8)] backdrop-blur'
              : `${card} flex items-center gap-3 border-state-warning/60 text-lg font-semibold`
          }
        >
          <span
            className={`flex shrink-0 items-center justify-center rounded-full bg-state-warning/15 text-state-warning ${
              tv ? 'size-[1.6em]' : 'size-10'
            }`}
          >
            <Icon name="bell" className={tv ? 'size-[0.9em]' : 'size-6'} />
          </span>
          <span>{alertText(t, alert, options.levelEndBehaviour === 'waitForHost')}</span>
        </div>
      )}
      {alert && state.alertPrefs.flash && (
        <div
          key={alert.key}
          aria-hidden="true"
          data-testid="alert-flash"
          className="pointer-events-none fixed inset-0 z-[60] bg-state-warning opacity-0 motion-safe:animate-alert-flash motion-reduce:hidden"
        />
      )}
      {speaker && (wakeLock === 'unsupported' || wakeLock === 'denied') && (
        <p
          className={
            tv
              ? 'fixed bottom-[1.5vh] left-[2vw] z-[63] text-xs text-ink-muted'
              : 'text-sm text-ink-muted'
          }
        >
          {t('clock.wakeLock.unavailable')}
        </p>
      )}

      <section
        className={`relative flex flex-col items-center text-center ${
          // TV: the hero is a size container, so the countdown fits whatever space is left
          // (next to the hand rankings, under banners, on a 720p screen…). The floor stops it
          // collapsing when an editor or banners take the height; main scrolls instead.
          tv
            ? 'min-h-[max(42vh,15rem)] min-w-0 flex-1 justify-center gap-[2vh] [container-type:size]'
            : `${card} gap-3 py-6 sm:py-8`
        }`}
        aria-labelledby="clock-title"
      >
        {held && (
          <p
            className={`font-display font-bold text-state-warning ${
              tv ? 'text-[min(4.5cqw,8cqh)]' : 'text-2xl sm:text-3xl'
            }`}
          >
            {t(levelOver ? 'clock.timeUp' : 'clock.breakDone')}
          </p>
        )}
        {held && <span className={eyebrow}>{t('clock.upNext')}</span>}
        <h1
          id="clock-title"
          className={`font-display font-bold leading-tight ${
            tv ? 'text-[min(5cqw,9cqh)]' : 'text-[clamp(1.75rem,5vw,3.25rem)]'
          }`}
        >
          {title}
        </h1>
        <p
          role="timer"
          aria-label={t('clock.timeLeft')}
          className={`font-clock font-semibold tabular-nums leading-[0.85] tracking-tight ${STATE_COLOUR[kind]} ${
            tv
              ? long || held
                ? 'text-[min(20cqw,38cqh)]'
                : 'text-[min(27cqw,48cqh)]'
              : long
                ? 'text-[clamp(4rem,17vw,10rem)]'
                : 'text-[clamp(5.5rem,24vw,12rem)]'
          }`}
        >
          {countdown}
        </p>
        {progress !== undefined && !held && (
          <div
            aria-hidden="true"
            className={`h-2 w-full overflow-hidden rounded-full bg-white/10 ${tv ? 'max-w-5xl sm:h-3' : 'max-w-md'}`}
          >
            <div
              className={`h-full rounded-full ${STATE_BG[kind]} transition-[width] duration-1000 ease-linear`}
              style={{ width: `${Math.round(progress * 1000) / 10}%` }}
            />
          </div>
        )}
        {model.blinds && !view.inInterlude && (
          <div className="mt-1 flex flex-col items-center">
            <span className={eyebrow}>{t('clock.blinds')}</span>
            <p
              className={`font-clock font-semibold tabular-nums leading-none ${
                tv ? 'text-[min(10cqw,15cqh)]' : 'text-[clamp(2.75rem,10vw,5.5rem)]'
              }`}
            >
              {formatBlinds(model.blinds.sb, model.blinds.bb)}
            </p>
          </div>
        )}
        {model.blinds && !view.inInterlude && model.blinds.ante > 0 && (
          <p
            className={`font-clock font-medium text-ink-muted ${tv ? 'text-[min(3cqw,5cqh)]' : 'text-2xl'}`}
          >
            {t('clock.ante', { ante: formatChips(model.blinds.ante) })}
          </p>
        )}
        {view.inInterlude && model.blinds && (
          <p className="text-[clamp(1.25rem,3vw,2.5rem)] text-ink-muted">
            {t('clock.thenLevel', {
              label: segmentLabel(t, model.segment, index),
              blinds: formatBlinds(model.blinds.sb, model.blinds.bb),
              time: formatCountdown(levelRemaining(anchor, view)),
            })}
          </p>
        )}
        {controller && held && (
          <button
            ref={startButton}
            type="button"
            className={`${buttonPrimary} mt-2 h-16 w-full max-w-md rounded-full text-xl ring-4 ring-accent/25 sm:text-2xl`}
            onClick={() => run(resume)}
          >
            <Icon name="play" className="size-6" />
            {startLabel}
          </button>
        )}
        <p className="sr-only" aria-live="polite">
          {held
            ? `${t(levelOver ? 'clock.timeUp' : 'clock.breakDone')}. ${t('clock.upNext')}: ${nowLabel}`
            : nowLabel}
        </p>
      </section>

      {held && !levelOver && <Banner tone="warning">{t('clock.awaitingHost')}</Banner>}
      {overtime && (
        <Banner tone="warning">
          <span>{t('clock.overtime', { time: formatElapsed(view.overtimeMs) })}</span>
          {controller && config && (
            <span className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonSecondary}
                onClick={() => {
                  setExtensionRefused(false);
                  setExtension(extend(schedule, config, ctx, OVERTIME_LEVELS));
                }}
              >
                <Icon name="plus" />
                {t('clock.overtime.addLevels')}
              </button>
              <button type="button" className={buttonSecondary} onClick={() => setEditing(true)}>
                <Icon name="edit" />
                {t('clock.control.edit')}
              </button>
            </span>
          )}
        </Banner>
      )}
      {extension && (
        <ExtensionPreview
          result={extension}
          refused={extensionRefused}
          onCancel={() => setExtension(null)}
          onConfirm={async () => {
            const outcome = await actions.applyEdit(extension.schedule, {
              restartCurrent: false,
              detail: { operation: 'extend', levels: OVERTIME_LEVELS },
            });
            // 'failed' already shows the store's save warning; keep the preview to retry.
            if (outcome === 'applied') setExtension(null);
            else setExtensionRefused(outcome === 'pastChanged');
          }}
        />
      )}

      {confirming && (
        <Confirm
          text={t(confirming === 'previous' ? 'clock.confirm.previous' : 'clock.confirm.end')}
          yes={t(confirming === 'previous' ? 'clock.confirm.previousYes' : 'clock.confirm.endYes')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            if (confirming === 'previous') run(previous);
            else void actions.end();
          }}
        />
      )}

      {controller && (
        <section
          ref={dock}
          aria-label={t('clock.controls')}
          className="flex flex-col items-center gap-4"
        >
          <div className="flex items-center justify-center gap-3 sm:gap-5">
            <button
              type="button"
              className={`${buttonSecondary} size-14 rounded-full px-0 sm:w-auto sm:px-5`}
              disabled={!canPrevious}
              onClick={() => setConfirming('previous')}
            >
              <Icon name="previous" className="size-6" />
              <span className="sr-only sm:not-sr-only">{t('clock.control.previous')}</span>
            </button>
            {/* While held, the hero's "Start Level N" is the one big action (Space still works). */}
            {!held && (
              <button
                type="button"
                className={`${buttonPrimary} h-16 min-w-44 rounded-full px-8 text-xl`}
                onClick={pauseResume}
              >
                <Icon name={view.status === 'running' ? 'pause' : 'play'} className="size-6" />
                {t(
                  view.status === 'idle'
                    ? 'clock.control.start'
                    : view.status === 'running'
                      ? 'clock.control.pause'
                      : 'clock.control.resume',
                )}
              </button>
            )}
            <button
              type="button"
              className={`${buttonSecondary} size-14 rounded-full px-0 sm:w-auto sm:px-5`}
              disabled={!canNext}
              onClick={() => run(next)}
            >
              <span className="sr-only sm:not-sr-only">{t('clock.control.next')}</span>
              <Icon name="next" className="size-6" />
            </button>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {onBreak ? (
              <>
                <button type="button" className={buttonSecondary} onClick={() => run(endBreak)}>
                  <Icon name="play" className="size-4" />
                  {t('clock.control.endBreak')}
                </button>
                <button
                  type="button"
                  className={buttonSecondary}
                  onClick={() => run((s, at) => extendBreak(s, at, EXTRA_BREAK_MS))}
                >
                  <Icon name="plus" className="size-4" />
                  {t('clock.control.extendBreak')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={buttonSecondary}
                disabled={view.status === 'idle'}
                onClick={toggleBreak}
              >
                <Icon name="coffee" className="size-4" />
                {t('clock.control.breakNow')}
              </button>
            )}
            <button
              type="button"
              className={`${buttonSecondary} aria-pressed:border-state-warning/60 aria-pressed:text-state-warning`}
              aria-pressed={state.muted}
              onClick={() => void actions.toggleMute()}
            >
              <Icon name={state.muted ? 'mute' : 'volume'} className="size-4" />
              {t('clock.control.mute')}
            </button>
            <button
              type="button"
              className={buttonSecondary}
              ref={alertsButton}
              aria-expanded={alertSettings}
              onClick={() => setAlertSettings((open) => !open)}
            >
              <Icon name="bell" className="size-4" />
              {t('clock.control.alerts')}
            </button>
            <button
              type="button"
              className={`${buttonSecondary} aria-pressed:border-accent/60 aria-pressed:bg-accent/10 aria-pressed:text-accent-strong`}
              aria-pressed={showReference}
              onClick={() => void actions.setReference(!showReference)}
            >
              <Icon name="cards" className="size-4" />
              {t('clock.control.reference')}
            </button>
            {music && (
              <button
                type="button"
                className={buttonSecondary}
                ref={musicButton}
                aria-expanded={musicPanel}
                onClick={() => setMusicPanel((open) => !open)}
              >
                <Icon name="music" className="size-4" />
                {t('clock.control.music')}
              </button>
            )}
            <button type="button" className={buttonSecondary} onClick={fullscreen.toggle}>
              <Icon name={fullscreen.active ? 'shrink' : 'expand'} className="size-4" />
              {t(fullscreen.active ? 'clock.control.exitFullscreen' : 'clock.control.fullscreen')}
            </button>
            {config && (
              <button
                type="button"
                className={buttonSecondary}
                aria-expanded={editing}
                onClick={() => setEditing((e) => !e)}
              >
                <Icon name="edit" className="size-4" />
                {t('clock.control.edit')}
              </button>
            )}
            <button type="button" className={buttonQuiet} onClick={() => setConfirming('end')}>
              <Icon name="flag" className="size-4" />
              {t('clock.control.end')}
            </button>
          </div>
        </section>
      )}

      <Details
        t={t}
        tournament={tournament}
        model={model}
        view={view}
        now={now}
        controller={controller}
        tv={tv}
        reference={withReference}
        onPlayers={(delta) => void actions.changePlayers(delta)}
      />

      {!controller && !screen && (
        <div className="flex justify-center">
          <button type="button" className={buttonSecondary} onClick={fullscreen.toggle}>
            <Icon name={fullscreen.active ? 'shrink' : 'expand'} className="size-4" />
            {t(fullscreen.active ? 'clock.control.exitFullscreen' : 'clock.control.fullscreen')}
          </button>
        </div>
      )}
      {screen && !fullscreen.active && (
        <div className="flex justify-center">
          <button type="button" className={buttonQuiet} onClick={fullscreen.toggle}>
            <Icon name="expand" className="size-4" />
            {t('clock.control.fullscreen')}
          </button>
        </div>
      )}
      {controller && !tv && showReference && (
        <p className="text-center text-sm text-ink-muted">{t('clock.reference.hint')}</p>
      )}
      {controller && !tv && extras}
      {controller && !tv && (
        <p className="hidden text-center text-sm text-ink-muted sm:block">{t('clock.shortcuts')}</p>
      )}

      {controller && alertSettings && (
        <AlertSettings
          prefs={state.alertPrefs}
          muted={state.muted}
          audio={platform.audio}
          notifier={platform.notifier}
          onPrefs={(patch) => void actions.updateAlertPrefs(patch)}
          onToggleMute={() => void actions.toggleMute()}
          onClose={() => {
            setAlertSettings(false);
            alertsButton.current?.focus();
          }}
        />
      )}
      {controller && music && musicPanel && (
        <MusicPanel
          music={tournament.settings.music}
          onChange={(next) => void actions.setMusic(next)}
          onClose={() => {
            setMusicPanel(false);
            musicButton.current?.focus();
          }}
        />
      )}
      {controller && editing && config && (
        <RunningEditor
          // A schedule swapped underneath (e.g. levels added) invalidates any draft.
          key={schedule.id}
          schedule={schedule}
          config={config}
          ctx={ctx}
          currentIndex={index}
          levelRemainingMs={levelRemaining(anchor, view)}
          onApply={actions.applyEdit}
          onClose={() => setEditing(false)}
        />
      )}
      {screen && tournament.settings.music && (
        <MusicPlayer music={tournament.settings.music} alertKey={alert?.key} />
      )}
      {withReference && (
        <HandRankings className="fixed inset-y-[3vh] right-[2vw] hidden w-[30%] text-[min(2.2vh,1.1vw)] lg:flex" />
      )}
    </main>
  );
}

function segmentLabel(t: Translate, segment: Segment, index: number): string {
  return segment.kind === 'level'
    ? t('holdem.segment.level', { number: segment.levelNumber ?? index + 1 })
    : t('holdem.segment.break');
}

function alertText(t: Translate, alert: PlannedAlert, levelsWait = false): string {
  // These sound when a level runs out; if levels wait for the host, the blinds aren't up yet.
  if (levelsWait && (alert.type === 'levelStart' || alert.type === 'breakStart')) {
    return t('transition.timeUp');
  }
  switch (alert.type) {
    case 'levelStart':
      return t('transition.levelUp');
    case 'breakEnd':
      return t('transition.breakOver');
    default:
      return t(`alert.${alert.type}`);
  }
}

function recoveryText(t: Translate, recovery: Recovery, now: string, time: string): string {
  const parts = [
    recovery.levels === 1
      ? t('clock.recovered.level')
      : recovery.levels > 1
        ? t('clock.recovered.levels', { count: recovery.levels })
        : '',
    recovery.breaks === 1
      ? t('clock.recovered.break')
      : recovery.breaks > 1
        ? t('clock.recovered.breaks', { count: recovery.breaks })
        : '',
  ].filter(Boolean);
  if (parts.length === 0) return t('clock.recovered.breakEnded', { now, time });
  const passed =
    parts.length === 2 ? t('clock.recovered.and', { a: parts[0], b: parts[1] }) : parts[0];
  return t('clock.recovered', { passed, now, time });
}

interface DetailsProps {
  t: Translate;
  tournament: Tournament;
  model: ReturnType<typeof clockScreen>;
  view: ClockView;
  now: number;
  controller: boolean;
  /** Big-screen layout: one row of larger tiles. */
  tv: boolean;
  /** The hand rankings take the right of the screen, so tiles get a little smaller. */
  reference: boolean;
  onPlayers: (delta: number) => void;
}

function Details({
  t,
  tournament,
  model,
  view,
  now,
  controller,
  tv,
  reference,
  onPlayers,
}: DetailsProps) {
  const { count, remaining } = tournament.participants;
  const next = model.next;
  const onBreak = model.segment.kind === 'break' || view.inInterlude;
  return (
    <section aria-label={t('clock.details')}>
      <dl
        className={`grid gap-2 sm:gap-3 ${
          tv
            ? `grid-cols-2 md:grid-cols-5 ${reference ? '[&_dd]:text-[min(1.8vw,4vh)]' : '[&_dd]:text-[min(2.6vw,4.5vh)]'}`
            : 'grid-cols-2 md:grid-cols-5'
        }`}
      >
        <Item term={t('clock.next')} wide>
          {next
            ? `${segmentLabel(t, next.segment, view.segmentIndex + 1)}${
                next.blinds ? ` · ${formatBlinds(next.blinds.sb, next.blinds.bb)}` : ''
              }`
            : t('clock.next.none')}
        </Item>
        <Item term={t('clock.players')} wide>
          <span className="flex items-center justify-between gap-2">
            {controller && (
              <button
                type="button"
                className={buttonIcon}
                aria-label={t('clock.players.decrease')}
                disabled={remaining <= 1}
                onClick={() => onPlayers(-1)}
              >
                <Icon name="minus" />
              </button>
            )}
            <span className="whitespace-nowrap tabular-nums">
              {t('clock.players.value', { remaining, count })}
            </span>
            {controller && (
              <button
                type="button"
                className={buttonIcon}
                aria-label={t('clock.players.increase')}
                disabled={remaining >= count}
                onClick={() => onPlayers(1)}
              >
                <Icon name="plus" />
              </button>
            )}
          </span>
        </Item>
        {!onBreak && (
          <Item term={t('clock.untilBreak')}>
            {model.untilBreakMs === undefined
              ? t('clock.noBreak')
              : formatCountdown(model.untilBreakMs)}
          </Item>
        )}
        {model.averageStackBB !== undefined && (
          <Item term={t('clock.avgStack')}>
            {t('clock.avgStack.value', { bb: Math.round(model.averageStackBB * 10) / 10 })}
          </Item>
        )}
        {tournament.startedAt !== undefined && (
          <Item term={t('clock.elapsed')} wide>
            {formatElapsed(now - tournament.startedAt)}
          </Item>
        )}
      </dl>
    </section>
  );
}

function Item({ term, children, wide }: { term: string; children: ReactNode; wide?: boolean }) {
  // Phones give the wider values a full row; from md up (TV: five across) every tile is one cell.
  return (
    <div
      className={`flex flex-col justify-between gap-1 rounded-2xl border border-line bg-surface-raised/80 px-4 py-3 ${
        wide ? 'col-span-2 md:col-span-1' : ''
      }`}
    >
      <dt className={eyebrow}>{term}</dt>
      <dd className="font-clock text-2xl font-semibold tabular-nums leading-tight">{children}</dd>
    </div>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'info' | 'warning';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const t = useT();
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
        tone === 'warning'
          ? 'border-state-warning/40 bg-state-warning/10'
          : 'border-state-break/30 bg-state-break/10'
      }`}
    >
      {children}
      {onDismiss && (
        <button type="button" className={buttonQuiet} onClick={onDismiss}>
          {t('clock.dismiss')}
        </button>
      )}
    </div>
  );
}

function Confirm({
  text,
  yes,
  onConfirm,
  onCancel,
}: {
  text: string;
  yes: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    // Return focus to whatever opened the dialog (spec 01 §7); Escape cancels.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={id}
      className={`${card} flex flex-col gap-3`}
    >
      <p id={id}>{text}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} onClick={onConfirm}>
          {yes}
        </button>
        <button ref={cancel} type="button" className={buttonSecondary} onClick={onCancel}>
          {t('clock.confirm.cancel')}
        </button>
      </div>
    </div>
  );
}

function ExtensionPreview({
  result,
  refused,
  onConfirm,
  onCancel,
}: {
  result: EditResult;
  refused: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <section className={`${card} flex flex-col gap-3`} aria-label={t('clock.overtime.addLevels')}>
      <p>{t('clock.overtime.preview')}</p>
      <ul className="list-disc pl-6">
        {result.diff.added.map((segment) => {
          const data = levelData(segment);
          return (
            <li key={segment.id}>
              {t('clock.overtime.levelLine', {
                number: segment.levelNumber ?? '',
                blinds: data ? formatBlinds(data.sb, data.bb) : '',
                length: formatDurationMin(segment.durationMs / MINUTE),
              })}
            </li>
          );
        })}
      </ul>
      {refused && <p role="alert">{t('clock.edit.pastChanged')}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} onClick={() => void onConfirm()}>
          {t('clock.overtime.confirm')}
        </button>
        <button type="button" className={buttonSecondary} onClick={onCancel}>
          {t('clock.confirm.cancel')}
        </button>
      </div>
    </section>
  );
}

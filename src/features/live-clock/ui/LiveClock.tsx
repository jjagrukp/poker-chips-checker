import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
import type { Tournament } from '@/core/tournaments/tournament';
import type { HoldemConfig } from '@/modules/texas-holdem/config';
import { extend, type EditResult } from '@/modules/texas-holdem/edits';
import { formatBlinds, formatChips, formatDurationMin } from '@/modules/texas-holdem/format';
import { levelData } from '@/modules/texas-holdem/generate';
import { buttonPrimary, buttonQuiet, buttonSecondary, card } from '@/shared/components/styles';
import { useT, type Translate } from '@/shared/messages/tone';
import {
  clockScreen,
  displayKey,
  formatCountdown,
  formatElapsed,
  levelRemaining,
} from '../domain/screen';
import type { ClockPlatform, ClockStore, Recovery } from '../state/clock-store';
import {
  useFullscreen,
  useRecoveryTriggers,
  useShortcuts,
  useTicker,
  useWakeLock,
} from './hooks';
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

interface Props {
  tournament: Tournament;
  anchor: ClockAnchor;
  schedule: Schedule;
  config: HoldemConfig | undefined;
  state: Pick<ClockStore, 'role' | 'muted' | 'recovery' | 'warning'>;
  actions: Omit<ClockStore, 'phase' | 'tournament' | 'schedule' | 'config' | 'role' | 'muted' | 'recovery' | 'warning'>;
  ctx: ModuleContext;
  platform: ClockPlatform;
}

export function LiveClock({ tournament, anchor, schedule, config, state, actions, ctx, platform }: Props) {
  const t = useT();
  const controller = state.role === 'controller';
  const options = useMemo(
    () => ({ breakEndBehaviour: tournament.settings.breakEndBehaviour }),
    [tournament.settings.breakEndBehaviour],
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
  const wakeLock = useWakeLock(platform.wakeLock, controller && view.status === 'running');
  const fullscreen = useFullscreen();
  const [confirming, setConfirming] = useState<'previous' | 'end' | null>(null);
  const [editing, setEditing] = useState(false);
  const [extension, setExtension] = useState<EditResult | null>(null);
  const [extensionRefused, setExtensionRefused] = useState(false);

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
  const tv = fullscreen.active;

  return (
    <main
      className={
        tv
          ? 'fixed inset-0 z-50 flex flex-col gap-4 overflow-auto bg-surface p-4'
          : 'mx-auto flex max-w-4xl flex-col gap-4'
      }
    >
      {!tv && (
        <Link to="/" className={buttonQuiet + ' self-start'}>
          {t('setup.home')}
        </Link>
      )}
      {!controller && (
        <Banner tone="info">
          <span>{t('tabs.viewerMode')}</span>
          <button type="button" className={buttonSecondary} onClick={actions.takeControl}>
            {t('tabs.takeControl')}
          </button>
        </Banner>
      )}
      {state.recovery && (
        <Banner tone="info" onDismiss={actions.dismissRecovery}>
          {recoveryText(t, state.recovery, nowLabel, formatCountdown(view.remainingMs))}
        </Banner>
      )}
      {state.warning && (
        <Banner tone="warning" onDismiss={actions.dismissWarning}>
          {t(`clock.warning.${state.warning}`)}
        </Banner>
      )}
      {controller && (wakeLock === 'unsupported' || wakeLock === 'denied') && (
        <p className="text-sm text-ink-muted">{t('clock.wakeLock.unavailable')}</p>
      )}

      <section className="flex flex-col items-center gap-2 text-center" aria-labelledby="clock-title">
        <p className={`rounded-full bg-surface-raised px-3 py-1 text-sm font-semibold ${STATE_COLOUR[kind]}`}>
          {t(`clock.state.${kind}`)}
        </p>
        <h1 id="clock-title" className="font-display text-[clamp(2rem,6vw,5rem)] leading-tight">
          {title}
        </h1>
        <p
          role="timer"
          aria-label={t('clock.timeLeft')}
          className={`font-display tabular-nums leading-none ${STATE_COLOUR[kind]} ${
            tv ? 'text-[clamp(5rem,26vw,22rem)]' : 'text-[clamp(4rem,20vw,12rem)]'
          }`}
        >
          {formatCountdown(view.remainingMs)}
        </p>
        {model.blinds && !view.inInterlude && (
          <p className="font-display text-[clamp(2rem,8vw,6rem)] tabular-nums">
            {formatBlinds(model.blinds.sb, model.blinds.bb)}
          </p>
        )}
        {model.blinds && !view.inInterlude && model.blinds.ante > 0 && (
          <p className="text-[clamp(1.25rem,3vw,2.5rem)]">
            {t('clock.ante', { ante: formatChips(model.blinds.ante) })}
          </p>
        )}
        {view.inInterlude && model.blinds && (
          <p className="text-[clamp(1.25rem,3vw,2.5rem)]">
            {t('clock.thenLevel', {
              label: segmentLabel(t, model.segment, index),
              blinds: formatBlinds(model.blinds.sb, model.blinds.bb),
              time: formatCountdown(levelRemaining(anchor, view)),
            })}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {nowLabel}
        </p>
      </section>

      {view.status === 'awaitingHost' && <Banner tone="warning">{t('clock.awaitingHost')}</Banner>}
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
                {t('clock.overtime.addLevels')}
              </button>
              <button type="button" className={buttonSecondary} onClick={() => setEditing(true)}>
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

      <Details
        t={t}
        tournament={tournament}
        model={model}
        view={view}
        now={now}
        controller={controller}
        onPlayers={(delta) => void actions.changePlayers(delta)}
      />

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
        <section aria-label={t('clock.controls')} className="flex flex-wrap justify-center gap-2">
          <button type="button" className={buttonPrimary} onClick={pauseResume}>
            {t(
              view.status === 'idle'
                ? 'clock.control.start'
                : view.status === 'running'
                  ? 'clock.control.pause'
                  : 'clock.control.resume',
            )}
          </button>
          <button
            type="button"
            className={buttonSecondary}
            disabled={!canPrevious}
            onClick={() => setConfirming('previous')}
          >
            {t('clock.control.previous')}
          </button>
          <button type="button" className={buttonSecondary} disabled={!canNext} onClick={() => run(next)}>
            {t('clock.control.next')}
          </button>
          {onBreak ? (
            <>
              <button type="button" className={buttonSecondary} onClick={() => run(endBreak)}>
                {t('clock.control.endBreak')}
              </button>
              <button
                type="button"
                className={buttonSecondary}
                onClick={() => run((s, at) => extendBreak(s, at, EXTRA_BREAK_MS))}
              >
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
              {t('clock.control.breakNow')}
            </button>
          )}
          <button
            type="button"
            className={buttonSecondary}
            aria-pressed={state.muted}
            onClick={() => void actions.toggleMute()}
          >
            {t('clock.control.mute')}
          </button>
          <button type="button" className={buttonSecondary} onClick={fullscreen.toggle}>
            {t(tv ? 'clock.control.exitFullscreen' : 'clock.control.fullscreen')}
          </button>
          {config && (
            <button
              type="button"
              className={buttonSecondary}
              aria-expanded={editing}
              onClick={() => setEditing((e) => !e)}
            >
              {t('clock.control.edit')}
            </button>
          )}
          <button type="button" className={buttonQuiet} onClick={() => setConfirming('end')}>
            {t('clock.control.end')}
          </button>
        </section>
      )}
      {!controller && (
        <div className="flex justify-center">
          <button type="button" className={buttonSecondary} onClick={fullscreen.toggle}>
            {t(tv ? 'clock.control.exitFullscreen' : 'clock.control.fullscreen')}
          </button>
        </div>
      )}
      {controller && !tv && <p className="text-center text-sm text-ink-muted">{t('clock.shortcuts')}</p>}

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
    </main>
  );
}

function segmentLabel(t: Translate, segment: Segment, index: number): string {
  return segment.kind === 'level'
    ? t('holdem.segment.level', { number: segment.levelNumber ?? index + 1 })
    : t('holdem.segment.break');
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
  const passed = parts.length === 2 ? t('clock.recovered.and', { a: parts[0], b: parts[1] }) : parts[0];
  return t('clock.recovered', { passed, now, time });
}

interface DetailsProps {
  t: Translate;
  tournament: Tournament;
  model: ReturnType<typeof clockScreen>;
  view: ClockView;
  now: number;
  controller: boolean;
  onPlayers: (delta: number) => void;
}

function Details({ t, tournament, model, view, now, controller, onPlayers }: DetailsProps) {
  const { count, remaining } = tournament.participants;
  const next = model.next;
  const onBreak = model.segment.kind === 'break' || view.inInterlude;
  return (
    <section aria-label={t('clock.details')} className={card}>
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-lg sm:grid-cols-2">
      <Item term={t('clock.next')}>
        {next
          ? `${segmentLabel(t, next.segment, view.segmentIndex + 1)}${
              next.blinds ? ` · ${formatBlinds(next.blinds.sb, next.blinds.bb)}` : ''
            }`
          : t('clock.next.none')}
      </Item>
      {!onBreak && (
        <Item term={t('clock.untilBreak')}>
          {model.untilBreakMs === undefined ? t('clock.noBreak') : formatCountdown(model.untilBreakMs)}
        </Item>
      )}
      <Item term={t('clock.players')}>
        <span className="flex items-center gap-2">
          {controller && (
            <button
              type="button"
              className={buttonSecondary + ' min-w-11'}
              aria-label={t('clock.players.decrease')}
              disabled={remaining <= 1}
              onClick={() => onPlayers(-1)}
            >
              −
            </button>
          )}
          <span className="tabular-nums">{t('clock.players.value', { remaining, count })}</span>
          {controller && (
            <button
              type="button"
              className={buttonSecondary + ' min-w-11'}
              aria-label={t('clock.players.increase')}
              disabled={remaining >= count}
              onClick={() => onPlayers(1)}
            >
              +
            </button>
          )}
        </span>
      </Item>
      {model.averageStackBB !== undefined && (
        <Item term={t('clock.avgStack')}>
          {t('clock.avgStack.value', { bb: Math.round(model.averageStackBB * 10) / 10 })}
        </Item>
      )}
      {tournament.startedAt !== undefined && (
        <Item term={t('clock.elapsed')}>{formatElapsed(now - tournament.startedAt)}</Item>
      )}
    </dl>
    </section>
  );
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{term}</dt>
      <dd className="font-semibold">{children}</dd>
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
      className={`${card} flex flex-wrap items-center justify-between gap-3 border-l-4 ${
        tone === 'warning' ? 'border-state-warning' : 'border-state-break'
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

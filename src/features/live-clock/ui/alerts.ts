import { useCallback, useEffect, useRef, useState } from 'react';
import { alertEnabled, alertVolume, type AlertPrefs } from '@/core/alerts/alerts';
import {
  COUNTDOWN_BEATS,
  dueAlerts,
  LIVE_GAP_MS,
  LOOKAHEAD_MS,
  planAlerts,
  type PlannedAlert,
} from '@/core/alerts/plan';
import type { Schedule } from '@/core/scheduling/schedule';
import type { Clock } from '@/core/time';
import type { ClockAnchor, DeriveOptions } from '@/core/timer/anchor';
import type { AlertAudio, AudioState } from '@/infrastructure/audio/alert-audio';
import type { AlertNotifier } from '@/infrastructure/notifications/notifier';

// Alert engine glue (spec 03 §6.2). Planning is pure (core/alerts); this decides when to
// look, what to sound, show and notify, and keeps the audio timeline in step with the anchor.

const ALERT_TICK_MS = 250;
/** Fired keys are saved in batches so a countdown isn't ten writes (and viewer reloads). */
const SAVE_EVERY_MS = 2_000;
const SHOWN_FOR_MS = 15_000;

interface AlertsOptions {
  schedule: Schedule;
  anchor: ClockAnchor;
  options: DeriveOptions;
  /** Persisted keys; only the controller trusts them (viewers dedupe in memory). */
  firedAlerts: readonly string[] | undefined;
  clock: Clock;
  audio: AlertAudio;
  audioState: AudioState;
  notifier: AlertNotifier;
  prefs: AlertPrefs;
  muted: boolean;
  /** Persists fired keys and sends notifications. */
  controller: boolean;
  /** Plays sounds: the controller, or a shared screen (spec 08). */
  sound: boolean;
  onFired: (keys: string[]) => void;
  notify: (alert: PlannedAlert) => { title: string; body: string };
}

/** Visible alerts: the countdown shows once, at its first beat. */
const shows = (alert: PlannedAlert) =>
  alert.type !== 'countdown' || alert.beat === COUNTDOWN_BEATS;

/** Returns the alert to show on screen, if any; it clears itself after a while. */
export function useAlerts(o: AlertsOptions): PlannedAlert | undefined {
  const [shown, setShown] = useState<PlannedAlert>();
  const latest = useRef(o);
  latest.current = o;
  const fired = useRef(new Set<string>());
  const scheduled = useRef(new Set<string>());

  const soundOn = o.sound && !o.muted && o.audioState === 'ready';
  const timeline = `${o.schedule.id}|${o.anchor.revision}|${o.options.breakEndBehaviour}|${o.options.levelEndBehaviour ?? 'auto'}|${soundOn}|${JSON.stringify(o.prefs.enabled ?? {})}`;

  useEffect(() => {
    o.audio.setVolume(alertVolume(o.prefs));
  }, [o.audio, o.prefs]);

  // Anything queued on the audio timeline belongs to the old anchor (paused, edited, muted).
  useEffect(() => {
    const { audio } = latest.current;
    const queued = scheduled.current;
    return () => {
      audio.cancelAll();
      queued.clear();
    };
  }, [timeline]);

  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(undefined), SHOWN_FOR_MS);
    return () => clearTimeout(id);
  }, [shown]);

  useEffect(() => {
    let previous = latest.current.clock.now();
    let unsaved: string[] = [];
    let savedAt = previous;
    const save = () => {
      if (unsaved.length > 0 && latest.current.controller) latest.current.onFired(unsaved);
      unsaved = [];
    };
    // A woken device can flush the audio queue before the next tick sees the gap.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      latest.current.audio.cancelAll();
      scheduled.current.clear();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    // Keeps running while hidden (throttled), so notifications and dedupe still work.
    const id = setInterval(() => {
      const c = latest.current;
      const now = c.clock.now();
      const known = c.controller ? new Set([...fired.current, ...(c.firedAlerts ?? [])]) : fired.current;
      const due = dueAlerts(c.schedule, c.anchor, previous, now, c.options, known);
      if (now - previous >= LIVE_GAP_MS) {
        // After a sleep the audio clock is stale: never replay what it had queued.
        c.audio.cancelAll();
        scheduled.current.clear();
      }
      previous = now;

      const sound = c.sound && !c.muted && c.audio.state === 'ready';
      const enabled = due.live.filter((a) => alertEnabled(c.prefs, a.type));
      for (const alert of enabled) {
        if (sound && !scheduled.current.has(alert.key)) c.audio.play(alert.type, 0, alert.beat);
      }
      const visible = enabled.filter(shows);
      if (visible.length > 0) {
        setShown(visible[visible.length - 1]);
        if (c.controller && c.prefs.notifications && document.visibilityState === 'hidden') {
          for (const alert of visible) {
            const { title, body } = c.notify(alert);
            c.notifier.show(title, body, alert.key);
          }
        }
      }
      const newKeys = [...due.live, ...due.missed].map((a) => a.key);
      newKeys.forEach((key) => fired.current.add(key));
      unsaved.push(...newKeys);
      if (now - savedAt >= SAVE_EVERY_MS) {
        save();
        savedAt = now;
      }

      if (!sound) return;
      for (const alert of planAlerts(c.schedule, c.anchor, now, now + LOOKAHEAD_MS, c.options)) {
        if (!alertEnabled(c.prefs, alert.type) || known.has(alert.key)) continue;
        if (scheduled.current.has(alert.key)) continue;
        scheduled.current.add(alert.key);
        c.audio.play(alert.type, alert.at - now, alert.beat);
      }
    }, ALERT_TICK_MS);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      save();
    };
  }, []);

  return shown;
}

/** Any click or key press unlocks audio (browsers need a gesture); returns the audio state. */
export function useAudioUnlock(audio: AlertAudio): { state: AudioState; unlock: () => void } {
  const [state, setState] = useState<AudioState>(audio.state);
  const unlock = useCallback(() => {
    void audio.unlock().then(setState);
  }, [audio]);

  useEffect(() => {
    if (state !== 'locked') return;
    window.addEventListener('click', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('click', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, [state, unlock]);

  return { state, unlock };
}

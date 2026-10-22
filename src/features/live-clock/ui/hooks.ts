import { useCallback, useEffect, useRef, useState } from 'react';
import type { Clock, EpochMs } from '@/core/time';
import type { ScreenWakeLock, WakeLockState } from '@/infrastructure/screen/wake-lock';
import { classifyTick } from '../domain/screen';

// Browser glue for the live clock (spec 03 §3–5). Time math stays in core; these hooks only
// decide when to read the clock and which browser APIs to poke.

const TICK_MS = 250;

interface TickerOptions {
  clock: Clock;
  monotonic: () => number;
  /** Re-render only when this changes (the displayed second, segment or status). */
  keyOf: (now: EpochMs) => string;
  /** The device clock went backwards by more than 5 s: wall delta minus monotonic delta. */
  onSkew: (skewMs: number) => void;
  /** The wall clock jumped forward (usually the device slept): recover. */
  onWake: () => void;
  /** Changing it (e.g. a new anchor revision) re-reads the clock immediately. */
  resetKey: unknown;
}

export function useTicker({
  clock,
  monotonic,
  keyOf,
  onSkew,
  onWake,
  resetKey,
}: TickerOptions): EpochMs {
  const [now, setNow] = useState(() => clock.now());
  const latest = useRef({ keyOf, onSkew, onWake });
  latest.current = { keyOf, onSkew, onWake };

  useEffect(() => {
    setNow(clock.now());
  }, [clock, resetKey]);

  useEffect(() => {
    let lastWall = clock.now();
    let lastMono = monotonic();
    let lastKey = latest.current.keyOf(lastWall);
    // Hidden pages are throttled or frozen; recovery handles the gap, so start afresh.
    const rebase = () => {
      lastWall = clock.now();
      lastMono = monotonic();
    };
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const wall = clock.now();
      const mono = monotonic();
      const kind = classifyTick(wall - lastWall, mono - lastMono);
      if (kind === 'skew') latest.current.onSkew(wall - lastWall - (mono - lastMono));
      if (kind === 'wake') latest.current.onWake();
      lastWall = wall;
      lastMono = mono;
      const key = latest.current.keyOf(wall);
      if (key !== lastKey) {
        lastKey = key;
        setNow(wall);
      }
    }, TICK_MS);
    document.addEventListener('visibilitychange', rebase);
    window.addEventListener('pageshow', rebase);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', rebase);
      window.removeEventListener('pageshow', rebase);
    };
  }, [clock, monotonic]);

  return now;
}

/** Holds the screen awake while `active`; re-acquires when the page becomes visible again. */
export function useWakeLock(wakeLock: ScreenWakeLock, active: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>(wakeLock.supported ? 'off' : 'unsupported');

  useEffect(() => {
    if (!active) {
      wakeLock.release();
      setState(wakeLock.supported ? 'off' : 'unsupported');
      return;
    }
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      void wakeLock.request().then((s) => !cancelled && setState(s));
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      wakeLock.release();
    };
  }, [wakeLock, active]);

  return state;
}

/** Hidden → visible and back-forward restores take the same path as a cold load. */
export function useRecoveryTriggers(recover: () => void): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') recover();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [recover]);
}

/** Fullscreen API, falling back to a CSS full-window layout when it's missing or refused. */
export function useFullscreen(): { active: boolean; toggle: () => void } {
  const [native, setNative] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const onChange = () => setNative(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (fallback) {
      setFallback(false);
      return;
    }
    const root = document.documentElement;
    if (typeof root.requestFullscreen !== 'function') {
      setFallback(true);
      return;
    }
    root.requestFullscreen().catch(() => setFallback(true));
  }, [fallback]);

  return { active: native || fallback, toggle };
}

export interface Shortcuts {
  pauseResume?: (() => void) | undefined;
  next?: (() => void) | undefined;
  previous?: (() => void) | undefined;
  breakToggle?: (() => void) | undefined;
  mute?: (() => void) | undefined;
  fullscreen?: (() => void) | undefined;
}

/** Keyboard (spec 01 §6). Ignored while typing or with modifiers held. */
export function useShortcuts(shortcuts: Shortcuts, enabled: boolean): void {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      const s = latest.current;
      const action = {
        // Space on a focused button already presses it.
        ' ': tag === 'BUTTON' ? undefined : s.pauseResume,
        ArrowRight: s.next,
        ArrowLeft: s.previous,
        b: s.breakToggle,
        m: s.mute,
        f: s.fullscreen,
      }[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

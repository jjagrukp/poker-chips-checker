import { DEFAULT_VOLUME, type SoundAlertType } from '@/core/alerts/alerts';

// Synthesised alert tones (spec 03 §6.2, D8): oscillators + envelopes, one timbre per type.
// Browsers only let audio start after a user gesture, so the context is created on `unlock`.
// Sounds can be placed ahead on the audio timeline, which keeps time in throttled tabs.

export type AudioState = 'locked' | 'ready' | 'unsupported';

export interface AlertAudio {
  readonly state: AudioState;
  /** Creates or resumes the AudioContext. Call from a user gesture. */
  unlock(): Promise<AudioState>;
  setVolume(volume: number): void;
  /** Plays `delayMs` from now on the audio timeline. `beat` picks the countdown's last-beep tone. */
  play(type: SoundAlertType, delayMs?: number, beat?: number): void;
  /** Stops everything queued or sounding (pause, edits, mute). */
  cancelAll(): void;
}

interface Note {
  /** Seconds after the alert's start. */
  at: number;
  freq: number;
  length: number;
  wave: OscillatorType;
  gain: number;
}

const seq = (wave: OscillatorType, gain: number, length: number, step: number, freqs: number[]) =>
  freqs.map((freq, i): Note => ({ at: i * step, freq, length, wave, gain }));

const TONES: Record<SoundAlertType, (beat?: number) => Note[]> = {
  fiveMinutes: () => seq('sine', 0.5, 0.35, 0.3, [587, 784]),
  oneMinute: () => seq('triangle', 0.6, 0.25, 0.3, [880, 880, 880]),
  countdown: (beat) => seq('square', 0.2, beat === 1 ? 0.3 : 0.1, 0, [beat === 1 ? 1320 : 1000]),
  levelStart: () => seq('sine', 0.6, 0.6, 0.15, [523, 659, 784, 1047]),
  breakStart: () => seq('triangle', 0.5, 0.5, 0.2, [784, 659, 523]),
  breakEnding: () => seq('sawtooth', 0.2, 0.3, 0.35, [440, 440]),
  breakEnd: () => seq('square', 0.2, 0.3, 0.15, [440, 554, 659, 880]),
  complete: () => seq('sine', 0.6, 0.5, 0.18, [523, 659, 784, 1047, 784, 1047]),
};

type AudioContextCtor = new () => AudioContext;

function defaultCtor(): AudioContextCtor | undefined {
  const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext;
}

export function createAlertAudio(Ctor: AudioContextCtor | undefined = defaultCtor()): AlertAudio {
  let ctx: AudioContext | undefined;
  let master: GainNode | undefined;
  let volume = DEFAULT_VOLUME;
  const sounding = new Set<OscillatorNode>();

  const state = (): AudioState =>
    !Ctor ? 'unsupported' : ctx?.state === 'running' ? 'ready' : 'locked';

  return {
    get state() {
      return state();
    },

    async unlock() {
      if (!Ctor) return 'unsupported';
      try {
        if (!ctx) {
          ctx = new Ctor();
          master = ctx.createGain();
          master.gain.value = volume;
          master.connect(ctx.destination);
        }
        if (ctx.state !== 'running') await ctx.resume();
      } catch {
        // Still locked; the next gesture tries again.
      }
      return state();
    },

    setVolume(next) {
      volume = next;
      if (ctx && master) master.gain.setValueAtTime(next, ctx.currentTime);
    },

    play(type, delayMs = 0, beat) {
      if (!ctx || !master || ctx.state !== 'running') return;
      const startAt = ctx.currentTime + Math.max(0, delayMs) / 1000;
      for (const note of TONES[type](beat)) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const begin = startAt + note.at;
        const end = begin + note.length;
        osc.type = note.wave;
        osc.frequency.value = note.freq;
        env.gain.setValueAtTime(0, begin);
        env.gain.linearRampToValueAtTime(note.gain, begin + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(env).connect(master);
        osc.onended = () => {
          sounding.delete(osc);
          osc.disconnect();
        };
        sounding.add(osc);
        osc.start(begin);
        osc.stop(end + 0.02);
      }
    },

    cancelAll() {
      for (const osc of sounding) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // Already stopped.
        }
      }
      sounding.clear();
    },
  };
}

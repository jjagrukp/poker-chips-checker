import { createAlertAudio } from './alert-audio';

class FakeParam {
  value = 0;
  events: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['linear', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(['exp', v, t]);
  }
}

class FakeNode {
  gain = new FakeParam();
  connect(node: FakeNode) {
    return node;
  }
  disconnect() {}
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  startedAt: number | undefined;
  stoppedAt: number | undefined;
  onended: (() => void) | null = null;
  start(t: number) {
    this.startedAt = t;
  }
  stop(t = -1) {
    this.stoppedAt = t;
  }
}

function fakeContextClass(resumes = true) {
  const created: FakeContext[] = [];
  class FakeContext {
    state: AudioContextState = 'suspended';
    currentTime = 100;
    destination = new FakeNode();
    oscillators: FakeOscillator[] = [];
    constructor() {
      created.push(this);
    }
    createGain() {
      return new FakeNode();
    }
    createOscillator() {
      const osc = new FakeOscillator();
      this.oscillators.push(osc);
      return osc;
    }
    resume() {
      if (!resumes) return Promise.reject(new Error('not allowed'));
      this.state = 'running';
      return Promise.resolve();
    }
  }
  return { Ctor: FakeContext as unknown as new () => AudioContext, created };
}

describe('createAlertAudio', () => {
  it('is unsupported without Web Audio', async () => {
    const audio = createAlertAudio(undefined);
    expect(audio.state).toBe('unsupported');
    expect(await audio.unlock()).toBe('unsupported');
    audio.play('levelStart');
  });

  it('stays silent until unlocked by a gesture', async () => {
    const { Ctor, created } = fakeContextClass();
    const audio = createAlertAudio(Ctor);
    audio.play('levelStart');
    expect(audio.state).toBe('locked');
    expect(created).toHaveLength(0);
    expect(await audio.unlock()).toBe('ready');
    expect(await audio.unlock()).toBe('ready');
    expect(created).toHaveLength(1);
  });

  it('remains locked when the browser refuses to resume', async () => {
    const { Ctor } = fakeContextClass(false);
    const audio = createAlertAudio(Ctor);
    expect(await audio.unlock()).toBe('locked');
  });

  it('schedules notes ahead on the audio timeline and cancels them', async () => {
    const { Ctor, created } = fakeContextClass();
    const audio = createAlertAudio(Ctor);
    await audio.unlock();
    audio.setVolume(0.3);
    audio.play('breakStart', 5_000);
    const ctx = created[0];
    expect(ctx?.oscillators.map((o) => o.startedAt)).toEqual([105, 105.2, 105.4]);
    audio.play('countdown', 0, 1);
    expect(ctx?.oscillators.at(-1)?.frequency.value).toBe(1320);
    audio.cancelAll();
    expect(ctx?.oscillators.every((o) => o.stoppedAt === -1)).toBe(true);
  });
});

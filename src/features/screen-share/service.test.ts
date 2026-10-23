import type { Schedule } from '@/core/scheduling/schedule';
import type { Tournament } from '@/core/tournaments/tournament';
import type { PutResult, ScreenClient } from '@/infrastructure/screen-share/client';
import { createShareStorage, type Share } from '@/infrastructure/screen-share/shares';
import { createScreenShareService } from './service';

// Spec 08 §1.3: latest-wins pushes, backoff while offline, a fresh code when one is taken.

const tournament = (n: number) =>
  ({ id: 't1', name: `v${n}`, participants: { count: 2, remaining: 2 } }) as unknown as Tournament;
const schedule = { id: 's1' } as unknown as Schedule;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

function setup(results: PutResult[] = []) {
  const sent: { code: string; name: string }[] = [];
  const pending: ((r: PutResult) => void)[] = [];
  let manual = false;
  const client: ScreenClient = {
    put: (code, _key, snapshot) => {
      sent.push({ code, name: String(snapshot.tournament.name) });
      if (manual) return new Promise((resolve) => pending.push(resolve));
      return Promise.resolve(results.shift() ?? { ok: true });
    },
    get: vi.fn(),
    remove: vi.fn(async () => undefined),
  };
  const timers: { run: () => void; ms: number }[] = [];
  let n = 0;
  const codes = ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC', 'DDDDDDDD'];
  const storage = memoryStorage();
  const service = createScreenShareService({
    client,
    storage: createShareStorage(() => storage),
    newShare: (): Share => ({ schemaVersion: 1, code: codes[n++] ?? 'ZZZZZZZZ', key: 'k'.repeat(22) }),
    now: () => 123,
    setTimer: (run, ms) => timers.push({ run, ms }),
    clearTimer: vi.fn(),
  });
  return {
    service,
    client,
    sent,
    timers,
    holdPuts: () => (manual = true),
    resolvePut: (r: PutResult = { ok: true }) => pending.shift()?.(r),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('screen share service', () => {
  it('does nothing for a tournament that is not shared', async () => {
    const { service, sent } = setup();
    service.push(tournament(1), schedule);
    await settle();
    expect(sent).toEqual([]);
    expect(service.status('t1')).toBeUndefined();
  });

  it('starts a share, sends the state and reports live', async () => {
    const { service, sent } = setup();
    const share = service.start(tournament(1), schedule);
    expect(share.code).toBe('AAAAAAAA');
    await settle();
    expect(sent).toEqual([{ code: 'AAAAAAAA', name: 'v1' }]);
    expect(service.status('t1')).toBe('live');
    expect(service.current('t1')?.code).toBe('AAAAAAAA');
  });

  it('sends only the newest state after a slow push', async () => {
    const { service, sent, holdPuts, resolvePut } = setup();
    holdPuts();
    service.start(tournament(1), schedule);
    service.push(tournament(2), schedule);
    service.push(tournament(3), schedule);
    resolvePut();
    await settle();
    resolvePut();
    await settle();
    expect(sent.map((s) => s.name)).toEqual(['v1', 'v3']);
    expect(service.status('t1')).toBe('live');
  });

  it('retries while offline with growing waits, then recovers', async () => {
    const { service, sent, timers } = setup([
      { ok: false, reason: 'network' },
      { ok: false, reason: 'network' },
    ]);
    service.start(tournament(1), schedule);
    await settle();
    expect(service.status('t1')).toBe('offline');
    expect(timers.map((t) => t.ms)).toEqual([2_000]);
    timers[0]?.run();
    await settle();
    expect(timers.map((t) => t.ms)).toEqual([2_000, 4_000]);
    timers[1]?.run();
    await settle();
    expect(sent.map((s) => s.name)).toEqual(['v1', 'v1', 'v1']);
    expect(service.status('t1')).toBe('live');
  });

  it('takes a new code when the first is already in use', async () => {
    const { service, sent } = setup([{ ok: false, reason: 'taken' }]);
    service.start(tournament(1), schedule);
    await settle();
    expect(sent.map((s) => s.code)).toEqual(['AAAAAAAA', 'BBBBBBBB']);
    expect(service.current('t1')?.code).toBe('BBBBBBBB');
    expect(service.status('t1')).toBe('live');
  });

  it('stops: forgets the share and deletes it from the relay', async () => {
    const { service, client, sent } = setup();
    service.start(tournament(1), schedule);
    await settle();
    await service.stop('t1');
    expect(client.remove).toHaveBeenCalledWith('AAAAAAAA', 'k'.repeat(22));
    expect(service.current('t1')).toBeUndefined();
    service.push(tournament(2), schedule);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('sends only what a screen needs: no inventory, allocation, names or results', async () => {
    const { service, client } = setup();
    const put = vi.spyOn(client, 'put');
    const full = {
      id: 't1',
      name: 'Friday',
      participants: { count: 8, remaining: 6, names: ['Alex', 'Sam'] },
      setupDraft: { inventory: { rows: ['secret'] } },
      allocation: { stacks: [] },
      inventoryId: 'inv-1',
      results: { positions: [] },
      firedAlerts: ['k1'],
    } as unknown as Tournament;
    service.start(full, schedule);
    await settle();
    const sentTournament = put.mock.calls[0]?.[2].tournament as Record<string, unknown>;
    expect(sentTournament).toEqual({
      id: 't1',
      name: 'Friday',
      participants: { count: 8, remaining: 6 },
    });
  });

  it('marks a refused push as failed without retrying', async () => {
    const { service, timers } = setup([{ ok: false, reason: 'rejected' }]);
    service.start(tournament(1), schedule);
    await settle();
    expect(service.status('t1')).toBe('failed');
    expect(timers).toEqual([]);
  });

  it('deletes only after a push in flight has landed', async () => {
    const { service, client, holdPuts, resolvePut } = setup();
    holdPuts();
    service.start(tournament(1), schedule);
    const stopping = service.stop('t1');
    await settle();
    expect(client.remove).not.toHaveBeenCalled();
    resolvePut();
    await stopping;
    expect(client.remove).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers of changes', async () => {
    const { service } = setup();
    const listener = vi.fn();
    service.subscribe(listener);
    service.start(tournament(1), schedule);
    await settle();
    expect(listener).toHaveBeenCalled();
  });
});

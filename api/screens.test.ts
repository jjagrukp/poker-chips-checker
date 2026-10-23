// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMemoryRateLimiter } from './rate-limit';
import {
  createMemoryScreenStore,
  handleScreen,
  SCREEN_TTL_MS,
  type ScreenDeps,
} from './screens';
import { MAX_SNAPSHOT_BYTES } from '../src/features/screen-share/wire';

// Spec 08 §4: the relay keeps one snapshot per code, writable only with its key and origin.

const ORIGIN = 'https://app.example';
const CODE = 'ABCD2345';
const KEY = 'k'.repeat(22);
const OTHER_KEY = 'o'.repeat(22);

const snapshot = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  tournament: { id: 't1', status: 'active' },
  schedule: { id: 's1', segments: [] },
  sentAt: 1_000,
  ...over,
});

function setup(over: Partial<ScreenDeps> = {}) {
  let now = 50_000;
  const deps: ScreenDeps = {
    store: createMemoryScreenStore(),
    limiter: createMemoryRateLimiter({ perIpPerHour: 100, dailyCap: 1_000 }),
    now: () => now,
    clientIp: () => '203.0.113.9',
    ...over,
  };
  const call = (method: string, init: { key?: string; body?: unknown; origin?: string | null; code?: string } = {}) => {
    const headers = new Headers();
    if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
    if (init.key) headers.set('x-screen-key', init.key);
    const body =
      init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    return handleScreen(
      new Request(`${ORIGIN}/api/screens/${init.code ?? CODE}`, { method, headers, ...(body ? { body } : {}) }),
      init.code ?? CODE,
      deps,
    );
  };
  return { deps, call, advance: (ms: number) => (now += ms) };
}

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe('handleScreen', () => {
  it('claims a code, then serves the snapshot with both clocks', async () => {
    const { call } = setup();
    const put = await call('PUT', { key: KEY, body: snapshot() });
    expect(put.status).toBe(200);
    expect(await json(put)).toEqual({ receivedAt: 50_000 });

    const get = await call('GET', { origin: null });
    expect(get.status).toBe(200);
    expect(get.headers.get('cache-control')).toBe('no-store');
    expect(await json(get)).toEqual({ snapshot: snapshot(), receivedAt: 50_000, serverNow: 50_000 });
  });

  it('lets the same key update and refuses another key', async () => {
    const { call } = setup();
    await call('PUT', { key: KEY, body: snapshot() });
    expect((await call('PUT', { key: KEY, body: snapshot({ sentAt: 2_000 }) })).status).toBe(200);
    const taken = await call('PUT', { key: OTHER_KEY, body: snapshot({ sentAt: 9 }) });
    expect(taken.status).toBe(409);
    expect(await json(taken)).toEqual({ error: 'taken' });
    expect(((await json(await call('GET'))).snapshot as { sentAt: number }).sentAt).toBe(2_000);
  });

  it('expires a day after the last write, then the code is free again', async () => {
    const { call, advance } = setup();
    await call('PUT', { key: KEY, body: snapshot() });
    advance(SCREEN_TTL_MS);
    expect((await call('GET')).status).toBe(404);
    expect((await call('PUT', { key: OTHER_KEY, body: snapshot() })).status).toBe(200);
  });

  it('deletes only with the right key', async () => {
    const { call } = setup();
    await call('PUT', { key: KEY, body: snapshot() });
    expect((await call('DELETE', { key: OTHER_KEY })).status).toBe(204);
    expect((await call('GET')).status).toBe(200);
    expect((await call('DELETE', { key: KEY })).status).toBe(204);
    expect(await json(await call('GET'))).toEqual({ error: 'not_found' });
  });

  it('checks the code, key, origin and method', async () => {
    const { call } = setup();
    expect(await json(await call('GET', { code: 'abcd2345' }))).toEqual({ error: 'bad_code' });
    expect(await json(await call('GET', { code: 'ABCD0OIL' }))).toEqual({ error: 'bad_code' });
    expect((await call('PUT', { body: snapshot() })).status).toBe(401);
    expect((await call('PUT', { key: 'short', body: snapshot() })).status).toBe(401);
    expect((await call('PUT', { key: KEY, body: snapshot(), origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('PUT', { key: KEY, body: snapshot(), origin: null })).status).toBe(403);
    expect((await call('DELETE', { key: KEY, origin: null })).status).toBe(403);
    expect((await call('POST', { key: KEY, body: snapshot() })).status).toBe(405);
  });

  it('honours APP_ORIGIN for writes', async () => {
    const { call } = setup({ appOrigin: 'https://tv.example' });
    expect((await call('PUT', { key: KEY, body: snapshot() })).status).toBe(403);
    expect((await call('PUT', { key: KEY, body: snapshot(), origin: 'https://tv.example' })).status).toBe(200);
  });

  it('refuses bodies that are too big, not JSON or not a snapshot', async () => {
    const { call } = setup();
    const big = snapshot({ tournament: { id: 't1', pad: 'x'.repeat(MAX_SNAPSHOT_BYTES) } });
    expect(await json(await call('PUT', { key: KEY, body: big }))).toEqual({ error: 'too_large' });
    expect(await json(await call('PUT', { key: KEY, body: '{not json' }))).toEqual({ error: 'invalid' });
    expect(await json(await call('PUT', { key: KEY, body: snapshot({ schemaVersion: 2 }) }))).toEqual({
      error: 'invalid',
    });
    expect(await json(await call('PUT', { key: KEY, body: snapshot({ schedule: null }) }))).toEqual({
      error: 'invalid',
    });
    expect((await call('GET')).status).toBe(404);
  });

  it('rate-limits writes per IP', async () => {
    const { call } = setup({ limiter: createMemoryRateLimiter({ perIpPerHour: 2, dailyCap: 1_000 }) });
    expect((await call('PUT', { key: KEY, body: snapshot() })).status).toBe(200);
    expect((await call('PUT', { key: KEY, body: snapshot() })).status).toBe(200);
    expect(await json(await call('PUT', { key: KEY, body: snapshot() }))).toEqual({ error: 'rate_limited' });
    // Reads aren't counted.
    expect((await call('GET')).status).toBe(200);
  });
});

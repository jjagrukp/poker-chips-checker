// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyseOnCloudflare,
  configOnCloudflare,
  d1CounterStore,
  d1ScreenStore,
  screensOnCloudflare,
  notFoundOnCloudflare,
  withApiHeaders,
  type CloudflareEnv,
  type D1Database,
  type PagesContext,
} from './cloudflare';
import { createCounterRateLimiter, rateKeyIp } from './rate-limit';
import { headersFile } from './security-headers';

// D35: the Pages Functions adapter and the D1-backed limiter, run against real SQLite
// (node:sqlite) with the real migration. No network: the model API is stubbed.

const sqlite = await import('node:sqlite').catch(() => null);
const MIGRATION = ['0001_rate_counts.sql', '0002_screens.sql']
  .map((file) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  .join('\n');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ORIGIN = 'https://app.example';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3, 4]);

function database() {
  if (!sqlite) throw new Error('node:sqlite unavailable');
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(MIGRATION);
  const d1: D1Database = {
    prepare(query) {
      const statement = (values: unknown[]) => ({
        bind: (...next: unknown[]) => statement(next),
        first: async <T>() => (db.prepare(query).get(...(values as never[])) ?? null) as T | null,
        run: async () => db.prepare(query).run(...(values as never[])),
      });
      return statement([]);
    },
  };
  const keys = () =>
    (db.prepare('SELECT key FROM rate_counts').all() as { key: string }[]).map((r) => r.key);
  return { d1, keys };
}

function context(request: Request, env: CloudflareEnv): PagesContext {
  return { request, env, next: () => Promise.reject(new Error('unused')) };
}

function analyseRequest(ip: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/analyse-chips`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'image/jpeg', 'cf-connecting-ip': ip, ...headers },
    body: JPEG,
  });
}

const modelReply = () =>
  Response.json({
    content: [
      {
        type: 'tool_use',
        id: 't1',
        name: 'report_chips',
        input: { status: 'not_chips', chipTypes: [], imageIssues: [], message: null },
      },
    ],
    stop_reason: 'tool_use',
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.skipIf(!sqlite)('createCounterRateLimiter over D1', () => {
  const limits = { perIpPerHour: 10, dailyCap: 500 };

  it('lets exactly the per-IP limit through a parallel burst', async () => {
    const limiter = createCounterRateLimiter(d1CounterStore(database().d1), limits);
    const decisions = await Promise.all(
      Array.from({ length: 15 }, () => limiter.take('1.2.3.4', 5 * HOUR)),
    );
    expect(decisions.filter((d) => d === 'ok')).toHaveLength(10);
    expect(decisions.filter((d) => d === 'ip')).toHaveLength(5);
  });

  it('applies the daily cap across IPs and keeps limited IPs off it', async () => {
    const limiter = createCounterRateLimiter(d1CounterStore(database().d1), {
      perIpPerHour: 1,
      dailyCap: 3,
    });
    expect(await limiter.take('a', 0)).toBe('ok');
    expect(await limiter.take('a', 1)).toBe('ip');
    expect(await limiter.take('b', 2)).toBe('ok');
    expect(await limiter.take('c', 3)).toBe('ok');
    expect(await limiter.take('d', 4)).toBe('daily');
  });

  it('starts a new window each hour and prunes old counters on a new day', async () => {
    const { d1, keys } = database();
    const limiter = createCounterRateLimiter(d1CounterStore(d1), { perIpPerHour: 1, dailyCap: 9 });
    expect(await limiter.take('a', 0)).toBe('ok');
    expect(await limiter.take('a', HOUR)).toBe('ok');
    expect(keys()).toHaveLength(3);
    expect(await limiter.take('a', DAY)).toBe('ok');
    expect(keys()).toHaveLength(2);
  });

  it('stores IPs only as hashes', async () => {
    const { d1, keys } = database();
    await createCounterRateLimiter(d1CounterStore(d1), limits).take('203.0.113.9', 0);
    expect(keys().join()).not.toContain('203.0.113.9');
  });
});

describe('Cloudflare adapter', () => {
  const ENV: CloudflareEnv = {
    AI_PHOTO_ENABLED: 'true',
    ANTHROPIC_API_KEY: 'test-key',
    RATE_LIMIT_PER_IP_PER_HOUR: '1',
  };

  it('keeps AI off without the rate-limit database', async () => {
    const config = configOnCloudflare(context(new Request(`${ORIGIN}/api/config`), ENV));
    expect(await config.json()).toEqual({ aiPhotoEnabled: false });
    const response = await analyseOnCloudflare(context(analyseRequest('1.1.1.1'), ENV));
    expect(response.status).toBe(503);
  });

  it.skipIf(!sqlite)('limits by CF-Connecting-IP, not client-set headers', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(modelReply()));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = { ...ENV, RATE_LIMIT_DB: database().d1 };
    const config = configOnCloudflare(context(new Request(`${ORIGIN}/api/config`), env));
    expect(await config.json()).toEqual({ aiPhotoEnabled: true });

    const first = await analyseOnCloudflare(context(analyseRequest('1.1.1.1'), env));
    expect(first.status).toBe(200);
    const spoofed = analyseRequest('1.1.1.1', { 'x-forwarded-for': '9.9.9.9' });
    const second = await analyseOnCloudflare(context(spoofed, env));
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: 'rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"status":429'));
  });

  it('adds security headers to every Function response', async () => {
    const next = () => Promise.resolve(notFoundOnCloudflare());
    const response = await withApiHeaders({ ...context(new Request(ORIGIN), ENV), next });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('sends HSTS on hosted pages', () => {
    expect(headersFile()).toContain('Strict-Transport-Security: max-age=31536000');
  });
});

describe('rateKeyIp', () => {
  it('keeps IPv4 and reduces IPv6 to its /64', () => {
    expect(rateKeyIp('203.0.113.9')).toBe('203.0.113.9');
    expect(rateKeyIp('2001:db8:0a:0001:1:2:3:4')).toBe('2001:db8:a:1');
    expect(rateKeyIp('2001:DB8::1')).toBe('2001:db8:0:0');
    expect(rateKeyIp('2001:db8:1:2::')).toBe('2001:db8:1:2');
    expect(rateKeyIp('::1')).toBe('0:0:0:0');
  });
});

describe.skipIf(!sqlite)('d1ScreenStore (D42)', () => {
  const T = 1_000_000;

  it('claims a free code, lets the same key update, refuses another key', async () => {
    const store = d1ScreenStore(database().d1);
    expect(await store.put('ABCD2345', 'hash-a', '{"v":1}', T)).toBe(true);
    expect(await store.put('ABCD2345', 'hash-a', '{"v":2}', T + 1)).toBe(true);
    expect(await store.put('ABCD2345', 'hash-b', '{"v":3}', T + 2)).toBe(false);
    expect(await store.get('ABCD2345', T + 3)).toEqual({ body: '{"v":2}', receivedAt: T + 1 });
  });

  it('hides expired rows, lets a new key take them over and prunes them', async () => {
    const { d1 } = database();
    const store = d1ScreenStore(d1);
    await store.put('ABCD2345', 'hash-a', '{"v":1}', T);
    await store.put('WXYZ6789', 'hash-a', '{"v":1}', T);
    const later = T + DAY;
    expect(await store.get('ABCD2345', later)).toBeNull();
    expect(await store.put('ABCD2345', 'hash-b', '{"v":9}', later)).toBe(true);
    expect(await store.get('ABCD2345', later)).toEqual({ body: '{"v":9}', receivedAt: later });
    // The other expired row went in the same write.
    const count = await d1.prepare('SELECT COUNT(*) AS n FROM screens').first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('deletes only with the matching key hash', async () => {
    const store = d1ScreenStore(database().d1);
    await store.put('ABCD2345', 'hash-a', '{}', T);
    await store.delete('ABCD2345', 'hash-b');
    expect(await store.get('ABCD2345', T)).not.toBeNull();
    await store.delete('ABCD2345', 'hash-a');
    expect(await store.get('ABCD2345', T)).toBeNull();
  });

  it('serves the relay through Pages, and reports unavailable without the database', async () => {
    const env: CloudflareEnv = { RATE_LIMIT_DB: database().d1 };
    const put = new Request(`${ORIGIN}/api/screens/ABCD2345`, {
      method: 'PUT',
      headers: { origin: ORIGIN, 'x-screen-key': 'k'.repeat(22), 'cf-connecting-ip': '198.51.100.7' },
      body: JSON.stringify({
        schemaVersion: 1,
        tournament: { id: 't1' },
        schedule: { id: 's1' },
        sentAt: 1,
      }),
    });
    const params = { code: 'ABCD2345' };
    expect((await screensOnCloudflare({ ...context(put, env), params })).status).toBe(200);
    const get = new Request(`${ORIGIN}/api/screens/ABCD2345`);
    const reply = await screensOnCloudflare({ ...context(get, env), params });
    expect(((await reply.json()) as { snapshot: { sentAt: number } }).snapshot.sentAt).toBe(1);

    const off = await screensOnCloudflare({ ...context(get, {}), params });
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ error: 'unavailable' });
  });
});

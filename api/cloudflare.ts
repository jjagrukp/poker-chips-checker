import { handleAnalyseChips, rateLimitsFrom, type PhotoEnv } from './analyse-chips';
import { handleConfig } from './config';
import { createCounterRateLimiter, type CounterStore } from './rate-limit';
import { handleScreen, SCREEN_TTL_MS, SCREEN_WRITE_LIMITS, type ScreenStore } from './screens';
import { API_HEADERS } from './security-headers';

// Cloudflare Pages Functions host adapter (D35). `functions/api/*` re-export these. Only the
// slices of the Workers types used here are declared, so there's no types dependency.

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
}

export interface CloudflareEnv extends PhotoEnv {
  /** D1 database holding the rate-limit counters (`migrations/0001_rate_counts.sql`). */
  RATE_LIMIT_DB?: D1Database;
}

export interface PagesContext {
  request: Request;
  env: CloudflareEnv;
  /** Route params, e.g. `code` for `functions/api/screens/[code].ts`. */
  params?: Record<string, string | string[]>;
  next(): Promise<Response>;
}

export function d1CounterStore(db: D1Database): CounterStore {
  return {
    async increment(key, expiresAt) {
      const row = await db
        .prepare(
          'INSERT INTO rate_counts (key, count, expires_at) VALUES (?1, 1, ?2) ' +
            'ON CONFLICT (key) DO UPDATE SET count = count + 1 RETURNING count',
        )
        .bind(key, expiresAt)
        .first<{ count: number }>();
      if (!row) throw new Error('rate counter missing');
      return row.count;
    },
    async prune(now) {
      await db.prepare('DELETE FROM rate_counts WHERE expires_at <= ?1').bind(now).run();
    },
  };
}

/** Screen-share snapshots (D42, `migrations/0002_screens.sql`). Expired rows go on each write. */
export function d1ScreenStore(db: D1Database): ScreenStore {
  return {
    async get(code, now) {
      const row = await db
        .prepare('SELECT body, received_at FROM screens WHERE code = ?1 AND expires_at > ?2')
        .bind(code, now)
        .first<{ body: string; received_at: number }>();
      return row ? { body: row.body, receivedAt: row.received_at } : null;
    },
    async put(code, keyHash, body, now) {
      // One statement: claims a free or expired code, or updates our own; another key's row
      // fails the WHERE, so nothing is returned.
      const row = await db
        .prepare(
          'INSERT INTO screens (code, key_hash, body, received_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5) ' +
            'ON CONFLICT (code) DO UPDATE SET key_hash = excluded.key_hash, body = excluded.body, ' +
            'received_at = excluded.received_at, expires_at = excluded.expires_at ' +
            'WHERE screens.key_hash = excluded.key_hash OR screens.expires_at <= ?4 RETURNING code',
        )
        .bind(code, keyHash, body, now, now + SCREEN_TTL_MS)
        .first<{ code: string }>();
      await db.prepare('DELETE FROM screens WHERE expires_at <= ?1').bind(now).run();
      return row !== null;
    },
    async delete(code, keyHash) {
      await db
        .prepare('DELETE FROM screens WHERE code = ?1 AND key_hash = ?2')
        .bind(code, keyHash)
        .run();
    },
  };
}

/** Write counters share `rate_counts`, under their own prefix. */
function prefixed(store: CounterStore, prefix: string): CounterStore {
  return {
    increment: (key, expiresAt) => store.increment(`${prefix}${key}`, expiresAt),
    prune: (now) => store.prune(now),
  };
}

export function screensOnCloudflare({ request, env, params }: PagesContext): Promise<Response> {
  const db = env.RATE_LIMIT_DB;
  if (!db) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      }),
    );
  }
  const code = params?.code;
  return handleScreen(request, typeof code === 'string' ? code : '', {
    store: d1ScreenStore(db),
    limiter: createCounterRateLimiter(prefixed(d1CounterStore(db), 'screen:'), SCREEN_WRITE_LIMITS),
    now: () => Date.now(),
    clientIp: (r) => r.headers.get('cf-connecting-ip') ?? 'unknown',
    appOrigin: env.APP_ORIGIN,
  });
}

/** Without the counter database the cost guard can't hold across instances, so AI stays off. */
function photoEnv(env: CloudflareEnv): PhotoEnv {
  return env.RATE_LIMIT_DB ? env : { ...env, AI_PHOTO_ENABLED: 'false' };
}

export function analyseOnCloudflare({ request, env }: PagesContext): Promise<Response> {
  const db = env.RATE_LIMIT_DB;
  return handleAnalyseChips(request, photoEnv(env), {
    // Workers reject `fetch` called with another `this`, so don't pass it bare.
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    // Unused when there's no database: the handler refuses as disabled first.
    limiter: db
      ? createCounterRateLimiter(d1CounterStore(db), rateLimitsFrom(env))
      : { take: () => 'daily' },
    // Set by Cloudflare's edge from the connection; a client can't override it.
    clientIp: (r) => r.headers.get('cf-connecting-ip') ?? 'unknown',
    log: (entry) => console.log(`analyse-chips ${JSON.stringify(entry)}`),
  });
}

export function configOnCloudflare({ request, env }: PagesContext): Response {
  return handleConfig(request, photoEnv(env));
}

export function notFoundOnCloudflare(): Response {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** `/api/*` middleware: security headers on every Function response. */
export async function withApiHeaders({ next }: PagesContext): Promise<Response> {
  const response = await next();
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(API_HEADERS)) out.headers.set(name, value);
  return out;
}

import { handleAnalyseChips, rateLimitsFrom, type PhotoEnv } from './analyse-chips';
import { handleConfig } from './config';
import { createCounterRateLimiter, type CounterStore } from './rate-limit';
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

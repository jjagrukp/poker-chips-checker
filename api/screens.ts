import {
  CodeSchema,
  KeySchema,
  MAX_SNAPSHOT_BYTES,
  ScreenEnvelopeSchema,
  type ScreenErrorCode,
} from '../src/features/screen-share/wire';
import type { RateLimiter, RateLimits } from './rate-limit';

// /api/screens/:code (spec 08 §4, D42): the screen-share relay. GET is read-only and open;
// PUT/DELETE need the share's write key (stored hashed) and the app's origin. Only the latest
// snapshot is kept, and it expires a day after the last write.

export const SCREEN_TTL_MS = 24 * 60 * 60 * 1000;
export const SCREEN_WRITE_LIMITS: RateLimits = { perIpPerHour: 1200, dailyCap: 100_000 };

export interface ScreenRecord {
  /** The stored snapshot JSON, already validated. */
  body: string;
  receivedAt: number;
}

export interface ScreenStore {
  /** The live record, or null when missing or expired. */
  get(code: string, now: number): Promise<ScreenRecord | null>;
  /** Writes when the code is free, expired or held by `keyHash`; false when another key holds it. */
  put(code: string, keyHash: string, body: string, now: number): Promise<boolean>;
  delete(code: string, keyHash: string): Promise<void>;
}

export interface ScreenDeps {
  store: ScreenStore;
  /** Write limiter (PUT/DELETE). */
  limiter: RateLimiter;
  now: () => number;
  clientIp: (request: Request) => string;
  /** The app's origin for the write check; defaults to the request's own origin. */
  appOrigin?: string | undefined;
}

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

const fail = (status: number, error: ScreenErrorCode) =>
  new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleScreen(
  request: Request,
  code: string,
  deps: ScreenDeps,
): Promise<Response> {
  if (!CodeSchema.safeParse(code).success) return fail(400, 'bad_code');
  const now = deps.now();

  if (request.method === 'GET') {
    const record = await deps.store.get(code, now);
    if (!record) return fail(404, 'not_found');
    // The body was validated on the way in; splice it rather than parse it again.
    return new Response(
      `{"snapshot":${record.body},"receivedAt":${record.receivedAt},"serverNow":${now}}`,
      { headers: JSON_HEADERS },
    );
  }
  if (request.method !== 'PUT' && request.method !== 'DELETE') return fail(405, 'method');

  const allowed = deps.appOrigin || new URL(request.url).origin;
  if (request.headers.get('origin') !== allowed) return fail(403, 'origin');
  const key = request.headers.get('x-screen-key') ?? '';
  if (!KeySchema.safeParse(key).success) return fail(401, 'bad_key');
  if ((await deps.limiter.take(deps.clientIp(request), now)) !== 'ok') {
    return fail(429, 'rate_limited');
  }
  const keyHash = await hashKey(key);

  if (request.method === 'DELETE') {
    await deps.store.delete(code, keyHash);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  if (Number(request.headers.get('content-length') ?? 0) > MAX_SNAPSHOT_BYTES) {
    return fail(413, 'too_large');
  }
  const bytes = await readCapped(request, MAX_SNAPSHOT_BYTES);
  if (!bytes) return fail(413, 'too_large');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail(400, 'invalid');
  }
  // The envelope and size are checked here; the TV parses the records fully before use.
  const parsed = ScreenEnvelopeSchema.safeParse(json);
  if (!parsed.success) return fail(400, 'invalid');
  const stored = await deps.store.put(code, keyHash, JSON.stringify(parsed.data), now);
  if (!stored) return fail(409, 'taken');
  return new Response(JSON.stringify({ receivedAt: now }), { headers: JSON_HEADERS });
}

/** The body, or null once it passes `max` (a chunked upload has no length to check first). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Dev/preview and tests: one process, so a Map is enough. */
export function createMemoryScreenStore(): ScreenStore {
  const rows = new Map<string, ScreenRecord & { keyHash: string; expiresAt: number }>();
  return {
    async get(code, now) {
      const row = rows.get(code);
      return row && row.expiresAt > now ? { body: row.body, receivedAt: row.receivedAt } : null;
    },
    async put(code, keyHash, body, now) {
      const row = rows.get(code);
      if (row && row.expiresAt > now && row.keyHash !== keyHash) return false;
      rows.set(code, { keyHash, body, receivedAt: now, expiresAt: now + SCREEN_TTL_MS });
      for (const [other, r] of rows) if (r.expiresAt <= now) rows.delete(other);
      return true;
    },
    async delete(code, keyHash) {
      if (rows.get(code)?.keyHash === keyHash) rows.delete(code);
    },
  };
}

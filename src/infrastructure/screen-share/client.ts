import { ScreenReplySchema, type ScreenReply, type ScreenSnapshot } from '@/features/screen-share/schema';
import { ScreenErrorSchema } from '@/features/screen-share/wire';

// Browser client for /api/screens/:code (spec 08 §4). Every reply is Zod-parsed; anything
// unexpected becomes a reason the caller can act on, never an exception.

export type PutResult = { ok: true } | { ok: false; reason: 'taken' | 'network' | 'rejected' };
export type GetResult =
  | { ok: true; reply: ScreenReply; receivedAt: number }
  | { ok: false; reason: 'not_found' | 'network' | 'invalid' };

export interface ScreenClient {
  put(code: string, key: string, snapshot: ScreenSnapshot): Promise<PutResult>;
  get(code: string): Promise<GetResult>;
  remove(code: string, key: string): Promise<void>;
}

const url = (code: string) => `/api/screens/${encodeURIComponent(code)}`;

async function errorOf(response: Response) {
  const parsed = ScreenErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error : undefined;
}

export function createScreenClient(
  fetch: typeof globalThis.fetch,
  now: () => number = () => Date.now(),
): ScreenClient {
  return {
    async put(code, key, snapshot) {
      try {
        const response = await fetch(url(code), {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-screen-key': key },
          body: JSON.stringify(snapshot),
        });
        if (response.ok) return { ok: true };
        const error = await errorOf(response);
        if (error === 'taken') return { ok: false, reason: 'taken' };
        // Rate limits and outages pass; a bad request won't fix itself on retry.
        const transient = response.status === 429 || response.status >= 500;
        return { ok: false, reason: transient ? 'network' : 'rejected' };
      } catch {
        return { ok: false, reason: 'network' };
      }
    },

    async get(code) {
      try {
        const response = await fetch(url(code), { cache: 'no-store' });
        const receivedAt = now();
        if (response.status === 404) return { ok: false, reason: 'not_found' };
        if (!response.ok) return { ok: false, reason: 'network' };
        const parsed = ScreenReplySchema.safeParse(await response.json().catch(() => null));
        return parsed.success
          ? { ok: true, reply: parsed.data, receivedAt }
          : { ok: false, reason: 'invalid' };
      } catch {
        return { ok: false, reason: 'network' };
      }
    },

    async remove(code, key) {
      try {
        await fetch(url(code), { method: 'DELETE', headers: { 'x-screen-key': key } });
      } catch {
        // The snapshot expires on its own a day after the last write.
      }
    },
  };
}

// Abuse/cost guard (spec 06 §2): a per-IP hourly limit plus a global daily cap. The limiter is
// an interface so a host-provided durable store (e.g. Cloudflare KV / Durable Object) can
// replace the in-memory one at deploy time (D30); in memory, limits are per instance.

export type RateDecision = 'ok' | 'ip' | 'daily';

export interface RateLimiter {
  /** Counts one request for `ip` at `now` (epoch ms) unless a limit is already reached. */
  take(ip: string, now: number): RateDecision;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_TRACKED_IPS = 10_000;

export function createMemoryRateLimiter(limits: {
  perIpPerHour: number;
  dailyCap: number;
}): RateLimiter {
  const perIp = new Map<string, { windowStart: number; count: number }>();
  let day = { start: 0, count: 0 };

  return {
    take(ip, now) {
      const dayStart = now - (now % DAY_MS);
      if (day.start !== dayStart) day = { start: dayStart, count: 0 };
      if (day.count >= limits.dailyCap) return 'daily';

      let entry = perIp.get(ip);
      if (!entry || now - entry.windowStart >= HOUR_MS) {
        if (!entry && perIp.size >= MAX_TRACKED_IPS) {
          for (const [key, value] of perIp) {
            if (now - value.windowStart >= HOUR_MS) perIp.delete(key);
          }
          // Still full: fail closed rather than grow without bound.
          if (perIp.size >= MAX_TRACKED_IPS) return 'daily';
        }
        entry = { windowStart: now, count: 0 };
        perIp.set(ip, entry);
      }
      if (entry.count >= limits.perIpPerHour) return 'ip';

      entry.count += 1;
      day.count += 1;
      return 'ok';
    },
  };
}

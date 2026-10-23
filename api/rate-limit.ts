// Abuse/cost guard (spec 06 §2): a per-IP hourly limit plus a global daily cap. The limiter is
// an interface so a host-provided durable store can replace the in-memory one at deploy time
// (D30, D35): in memory, limits are per instance; the counter limiter shares them across instances.

export type RateDecision = 'ok' | 'ip' | 'daily';

export interface RateLimiter {
  /** Counts one request for `ip` at `now` (epoch ms) unless a limit is already reached. */
  take(ip: string, now: number): RateDecision | Promise<RateDecision>;
}

export interface RateLimits {
  perIpPerHour: number;
  dailyCap: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_TRACKED_IPS = 10_000;

export function createMemoryRateLimiter(limits: RateLimits): RateLimiter {
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

/** Atomic counters that expire; the durable store behind the deployed limiter. */
export interface CounterStore {
  /** Adds one to `key` (created at 1, expiring at `expiresAt`) and returns the new count. */
  increment(key: string, expiresAt: number): Promise<number>;
  /** Removes counters that expired at or before `now`. */
  prune(now: number): Promise<void>;
}

/**
 * Fixed hourly/daily windows over a shared counter store. Each increment is atomic, so a burst
 * of parallel requests can't overshoot. An IP over its limit doesn't use up the daily cap; a
 * request refused by the daily cap still counts against its IP. IPs are stored hashed; IPv6
 * counts per /64, since one client can hold a whole /64. Fixed windows let an IP reach twice
 * its limit across an hour boundary: accepted, the daily cap still bounds the cost.
 */
export function createCounterRateLimiter(store: CounterStore, limits: RateLimits): RateLimiter {
  return {
    async take(ip, now) {
      const hour = Math.floor(now / HOUR_MS);
      const day = Math.floor(now / DAY_MS);
      const ipCount = await store.increment(`ip:${await hashIp(ip)}:${hour}`, (hour + 1) * HOUR_MS);
      if (ipCount > limits.perIpPerHour) return 'ip';
      const dayCount = await store.increment(`day:${day}`, (day + 1) * DAY_MS);
      // The first request of a day clears yesterday's counters.
      if (dayCount === 1) await store.prune(now);
      return dayCount > limits.dailyCap ? 'daily' : 'ok';
    },
  };
}

/** An IPv6 address's /64 prefix (first four groups, `::` expanded); IPv4 unchanged. */
export function rateKeyIp(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':');
}

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rateKeyIp(ip)));
  return Array.from(new Uint8Array(digest).subarray(0, 16), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

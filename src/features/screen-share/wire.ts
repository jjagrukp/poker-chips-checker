import { z } from 'zod';

// Screen-share wire format (spec 08, D42), shared with the relay endpoint. Zod only: the
// Functions and Vite-config bundles don't resolve the `@/` alias, so nothing here may import it.
// The TV parses snapshots fully (schema.ts); the relay checks the envelope and size.

export const SCREEN_SCHEMA_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 64 * 1024;
/** Crockford-style: no 0/O/1/I/L/U, so a code read off a phone types cleanly on a TV remote. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;
export const CodeSchema = z.string().regex(new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`));
/** 128-bit write key, base64url. */
export const KeySchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

export const ScreenEnvelopeSchema = z.object({
  schemaVersion: z.literal(SCREEN_SCHEMA_VERSION),
  tournament: z.object({ id: z.string().min(1) }).passthrough(),
  schedule: z.object({ id: z.string().min(1) }).passthrough(),
  /** The phone's clock when it sent this (spec 08 §3). */
  sentAt: z.number().int().nonnegative(),
});

export const SCREEN_ERROR_CODES = [
  'not_found',
  'method',
  'origin',
  'bad_code',
  'bad_key',
  'too_large',
  'invalid',
  'taken',
  'rate_limited',
  'unavailable',
] as const;
export type ScreenErrorCode = (typeof SCREEN_ERROR_CODES)[number];
export const ScreenErrorSchema = z.object({ error: z.enum(SCREEN_ERROR_CODES) });
export const PutReplySchema = z.object({ receivedAt: z.number().int().nonnegative() });

/** Normalises what someone typed ("abcd-efgh", spaces) to a code, if it can be one. */
export function normaliseCode(input: string): string | undefined {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return CodeSchema.safeParse(code).success ? code : undefined;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

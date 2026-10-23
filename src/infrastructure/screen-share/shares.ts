import { z } from 'zod';
import { CODE_ALPHABET, CODE_LENGTH, CodeSchema, KeySchema } from '@/features/screen-share/wire';

// The phone's screen shares (spec 08 §1, D42): code + write key per tournament, in localStorage.
// Parsed with Zod on read; storage that throws (private mode, blocked) acts as empty.

const SHARE_SCHEMA_VERSION = 1;
const PREFIX = 'screen-share:';

export const ShareSchema = z.object({
  schemaVersion: z.literal(SHARE_SCHEMA_VERSION),
  code: CodeSchema,
  key: KeySchema,
});
export type Share = z.infer<typeof ShareSchema>;

export interface ShareStorage {
  get(tournamentId: string): Share | undefined;
  set(tournamentId: string, share: Share): void;
  remove(tournamentId: string): void;
}

export function createShareStorage(storage: () => Storage = () => localStorage): ShareStorage {
  return {
    get(tournamentId) {
      try {
        const raw = storage().getItem(PREFIX + tournamentId);
        if (raw === null) return undefined;
        const parsed = ShareSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    set(tournamentId, share) {
      try {
        storage().setItem(PREFIX + tournamentId, JSON.stringify(share));
      } catch {
        // Sharing still works for this session; a reload just loses the link.
      }
    },
    remove(tournamentId) {
      try {
        storage().removeItem(PREFIX + tournamentId);
      } catch {
        // Nothing to do.
      }
    },
  };
}

/** A fresh code (unbiased: bytes past the last whole alphabet multiple are redrawn) and key. */
export function newShare(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): Share {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of random(new Uint8Array(16))) {
      if (byte < limit && code.length < CODE_LENGTH) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }
  const keyBytes = random(new Uint8Array(16));
  const key = btoa(String.fromCharCode(...keyBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { schemaVersion: SHARE_SCHEMA_VERSION, code, key };
}

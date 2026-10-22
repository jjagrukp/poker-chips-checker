import type { z } from 'zod';

// Lazy record migration (spec 02 §7.3): `vN → vN+1` steps run on read; the caller writes the
// migrated record back. Pure: no storage access here.

export type RawRecord = Record<string, unknown>;

/** `steps[n]` upgrades a version-n record to version n+1. */
export type MigrationSteps = Readonly<Record<number, (record: RawRecord) => RawRecord>>;

/** Everything storage needs to know about one persisted record type. */
export interface RecordType<T> {
  name: string;
  version: number;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  migrations: MigrationSteps;
}

export type MigrationResult<T> =
  { ok: true; value: T; migrated: boolean } | { ok: false; error: string };

export function migrateRecord<T>(type: RecordType<T>, raw: unknown): MigrationResult<T> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `${type.name}: record is not an object` };
  }
  let record = raw as RawRecord;
  const from = record.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    return { ok: false, error: `${type.name}: missing or invalid schemaVersion` };
  }
  if (from > type.version) {
    return {
      ok: false,
      error: `${type.name}: schemaVersion ${from} is newer than ${type.version}`,
    };
  }
  for (let v = from; v < type.version; v++) {
    const step = type.migrations[v];
    if (!step) return { ok: false, error: `${type.name}: no migration from v${v}` };
    try {
      record = { ...step(record), schemaVersion: v + 1 };
    } catch (e) {
      return { ok: false, error: `${type.name}: migration from v${v} failed: ${String(e)}` };
    }
  }
  const parsed = type.schema.safeParse(record);
  if (!parsed.success) {
    return { ok: false, error: `${type.name}: ${parsed.error.issues.map(formatIssue).join('; ')}` };
  }
  return { ok: true, value: parsed.data, migrated: from !== type.version };
}

function formatIssue(issue: z.ZodIssue): string {
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

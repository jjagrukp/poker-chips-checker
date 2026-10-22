import { z } from 'zod';
import { migrateRecord, type RecordType } from './migrations';

const V3 = z.object({ id: z.string(), schemaVersion: z.literal(3), fullName: z.string() });

const person: RecordType<z.infer<typeof V3>> = {
  name: 'person',
  version: 3,
  schema: V3,
  migrations: {
    1: ({ first, ...rest }) => ({ ...rest, given: first }),
    2: ({ given, ...rest }) => ({ ...rest, fullName: String(given) }),
  },
};

describe('migrateRecord', () => {
  it('runs every step from the stored version and parses the result', () => {
    expect(migrateRecord(person, { id: 'p', schemaVersion: 1, first: 'Ana' })).toEqual({
      ok: true,
      migrated: true,
      value: { id: 'p', schemaVersion: 3, fullName: 'Ana' },
    });
  });

  it('parses a current record without migrating', () => {
    const current = { id: 'p', schemaVersion: 3, fullName: 'Ana' };
    expect(migrateRecord(person, current)).toEqual({ ok: true, migrated: false, value: current });
  });

  it.each([
    ['not an object', null, /not an object/],
    ['an array', [], /not an object/],
    ['missing version', { id: 'p' }, /invalid schemaVersion/],
    ['fractional version', { id: 'p', schemaVersion: 1.5 }, /invalid schemaVersion/],
    ['future version', { id: 'p', schemaVersion: 4 }, /newer than 3/],
    ['schema failure', { id: 'p', schemaVersion: 3 }, /fullName/],
  ])('fails for %s', (_, raw, error) => {
    const result = migrateRecord(person, raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(error);
  });

  it('fails when a step is missing or throws', () => {
    const { 2: step2 } = person.migrations;
    const gappy = { ...person, migrations: step2 ? { 2: step2 } : {} };
    expect(migrateRecord(gappy, { id: 'p', schemaVersion: 1 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no migration from v1/),
    });
    const throwing = {
      ...person,
      migrations: {
        ...person.migrations,
        1: () => {
          throw new Error('boom');
        },
      },
    };
    expect(migrateRecord(throwing, { id: 'p', schemaVersion: 1 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/boom/),
    });
  });
});

import { z } from 'zod';
import { basic } from '@/core/testing/schedules';
import { emptyReport, isValid, mergeReports } from '@/core/validation/report';
import type { GameModule } from './contract';
import { createModuleRegistry, ModuleRegistrationError, UnknownModule } from './registry';

const fake = (overrides: Partial<GameModule> = {}): GameModule => ({
  id: 'fake',
  version: '1.0.0',
  displayName: 'Fake',
  description: '',
  formats: ['freezeout'],
  playerRange: { min: 2, max: 10 },
  configSchema: z.unknown(),
  defaults: () => ({}),
  validateConfig: emptyReport,
  generateSchedule: () => ({ schedule: basic, report: emptyReport() }),
  validateSchedule: emptyReport,
  ...overrides,
});

describe('module registry', () => {
  it('registers, gets and lists modules', () => {
    const a = fake({ id: 'a' });
    const b = fake({ id: 'b' });
    const registry = createModuleRegistry([a, b]);
    expect(registry.get('a')).toBe(a);
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.require('b')).toBe(b);
    expect(registry.list()).toEqual([a, b]);
    expect(() => registry.require('nope')).toThrow(UnknownModule);
  });

  it.each([
    ['duplicate ids', [fake(), fake()]],
    ['empty id', [fake({ id: ' ' })]],
    ['empty version', [fake({ version: '' })]],
    ['min above max', [fake({ playerRange: { min: 5, max: 2 } })]],
    ['zero players', [fake({ playerRange: { min: 0, max: 2 } })]],
    ['fractional range', [fake({ playerRange: { min: 2, max: 2.5 } })]],
  ])('rejects %s', (_, modules) => {
    expect(() => createModuleRegistry(modules)).toThrow(ModuleRegistrationError);
  });
});

describe('validation reports', () => {
  it('merges and judges validity by errors only', () => {
    const w = { errors: [], warnings: [{ code: 'w', messageKey: 'k' }] };
    const e = { errors: [{ code: 'e', messageKey: 'k' }], warnings: [] };
    expect(isValid(mergeReports(emptyReport(), w))).toBe(true);
    expect(mergeReports(w, e)).toEqual({ errors: e.errors, warnings: w.warnings });
    expect(isValid(mergeReports(w, e))).toBe(false);
  });
});

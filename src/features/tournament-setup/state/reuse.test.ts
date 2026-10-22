import type { ModuleContext } from '@/core/modules/contract';
import { PresetSchema } from '@/core/persistence/records';
import type { Tournament } from '@/core/tournaments/tournament';
import { chipSet } from '@/features/chip-inventory/domain/testing/fixtures';
import { insertBreak } from '@/modules/texas-holdem/edits';
import { applyPreset, duplicateOf, presetConfig, presetFromTournament } from './reuse';
import {
  confirmInventory,
  ensureSchedule,
  newWizard,
  setCustom,
  setEditedSchedule,
  setName,
  setPlayers,
  setStructure,
  setTarget,
  toTournament,
  type WizardState,
} from './wizard';

const T0 = 1_700_000_000_000;

function context(prefix = 'id'): ModuleContext {
  let n = 0;
  return { clock: { now: () => T0 }, newId: () => `${prefix}-${++n}` };
}

const fresh = (id = 't-new') => newWizard({ tournamentId: id, inventoryId: 'inv-new' }, T0);

/** A configured source: 8 players, 2 h, Turbo, chips confirmed. */
function source(): WizardState {
  const { inventory, assignment } = chipSet(
    [
      { colour: 'White', quantity: 100, value: 25 },
      { colour: 'Red', quantity: 100, value: 100 },
    ],
    'inv-1',
  );
  let state = setName(fresh('t-1'), 'Friday');
  state = setPlayers(state, 8);
  state = setTarget(state, 120, 'preset');
  state = setStructure(state, 'turbo');
  return confirmInventory(state, inventory, assignment);
}

const record = (state: WizardState): Tournament => toTournament(state, T0);

describe('presets', () => {
  it('saves a tournament config as a valid preset record', () => {
    const preset = presetFromTournament(record(source()), 'Quick Friday', { id: 'p1' }, T0);
    expect(PresetSchema.parse(preset)).toMatchObject({ id: 'p1', name: 'Quick Friday', moduleId: 'texas-holdem', presetVersion: 1 });
    expect(presetFromTournament({ ...record(source()), config: { nope: 1 } }, 'x', { id: 'p2' }, T0)).toBeUndefined();
  });

  it('applies players, duration and structure but keeps the new chips', () => {
    const preset = presetFromTournament(record(source()), 'Quick', { id: 'p1' }, T0);
    const config = preset && presetConfig(preset);
    if (!config) throw new Error('expected a usable preset');
    const applied = applyPreset(fresh(), config);
    expect(applied.config).toMatchObject({ players: 8, targetDurationMin: 120, structure: 'turbo' });
    expect(applied.config.denominations).toEqual(fresh().config.denominations);
    expect(applied.draft.durationMode).toBe('preset');
    expect(presetConfig({ ...preset, moduleId: 'other' })).toBeUndefined();
  });

  it('keeps custom blinds and an off-list duration', () => {
    let state = setTarget(fresh(), 150, 'custom');
    state = setCustom(state, { levelDurationMin: 17 });
    const applied = applyPreset(fresh(), state.config);
    expect(applied.config).toMatchObject({ structure: 'custom', levelDurationMin: 17, targetDurationMin: 150 });
    expect(applied.draft.durationMode).toBe('custom');
  });
});

describe('duplicateOf', () => {
  it('copies the whole setup under the new id with a new name', () => {
    const src = source();
    const copy = duplicateOf(fresh(), record(src), 'Friday (copy)', context());
    expect(copy.tournament).toMatchObject({ id: 't-new', name: 'Friday (copy)', status: 'draft' });
    expect(copy.config).toEqual(src.config);
    expect(copy.draft.confirmed).toEqual(src.draft.confirmed);
    expect(copy.draft.schedule).toBeNull();
  });

  it('keeps per-level edits on a renumbered schedule', () => {
    const ctx = context();
    let src = ensureSchedule(source(), ctx);
    const schedule = src.draft.schedule;
    if (!schedule) throw new Error('expected a schedule');
    src = setEditedSchedule(src, insertBreak(schedule, src.config, ctx, 1, 10).schedule);
    const copy = duplicateOf(fresh(), record(src), undefined, context('copy'));
    const copied = copy.draft.schedule;
    expect(copy.draft.scheduleEdited).toBe(true);
    expect(copied?.segments.map((s) => s.durationMs)).toEqual(src.draft.schedule?.segments.map((s) => s.durationMs));
    const original = new Set([src.draft.schedule?.id, ...(src.draft.schedule?.segments.map((s) => s.id) ?? [])]);
    expect([copied?.id, ...(copied?.segments.map((s) => s.id) ?? [])].some((id) => original.has(id))).toBe(false);
    expect(copy.tournament.name).toBeUndefined();
  });

  it('falls back to the config without a setup draft, and ignores other games', () => {
    const src = { ...record(source()), setupDraft: undefined };
    expect(duplicateOf(fresh(), src, undefined, context()).config.players).toBe(8);
    const other = { ...src, moduleId: 'other' };
    expect(duplicateOf(fresh(), other, 'x', context())).toEqual(fresh());
  });
});

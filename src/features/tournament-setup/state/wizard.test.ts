import type { ModuleContext } from '@/core/modules/contract';
import { TournamentSchema } from '@/core/tournaments/tournament';
import { recommendStack } from '@/features/chip-inventory/domain/recommend';
import { chipSet } from '@/features/chip-inventory/domain/testing/fixtures';
import { newRow, rowsFromInventory, toInventory } from '@/features/chip-inventory/ui/rows';
import { insertBreak } from '@/modules/texas-holdem/edits';
import {
  acceptAllocation,
  allocationReport,
  confirmInventory,
  ensureSchedule,
  fromTournament,
  markReady,
  newWizard,
  setBreakEnd,
  setCustom,
  setEditedSchedule,
  setName,
  setPlayers,
  setRows,
  setStructure,
  setTarget,
  stepComplete,
  STEPS,
  targetDepthBB,
  toTournament,
  type WizardState,
} from './wizard';

const T0 = 1_700_000_000_000;

function context(): ModuleContext {
  let n = 0;
  return { clock: { now: () => T0 }, newId: () => `id-${++n}` };
}

const homeSet = () =>
  chipSet(
    [
      { colour: 'White', quantity: 100, value: 25 },
      { colour: 'Red', quantity: 100, value: 100 },
      { colour: 'Green', quantity: 50, value: 500 },
      { colour: 'Black', quantity: 50, value: 1000 },
    ],
    'inv-1',
  );

function confirmed(state: WizardState): WizardState {
  const { inventory, assignment } = homeSet();
  return confirmInventory(state, inventory, assignment);
}

function withStack(state: WizardState): WizardState {
  const c = state.draft.confirmed;
  if (!c) throw new Error('confirm first');
  const outcome = recommendStack({
    ...c,
    players: state.config.players,
    startingDepthBB: targetDepthBB(state.config),
  });
  if (outcome.kind !== 'ok') throw new Error(`no stack: ${outcome.kind}`);
  return acceptAllocation(state, outcome.result);
}

describe('wizard state', () => {
  const fresh = () => newWizard({ tournamentId: 't-1', inventoryId: 'inv-1' }, T0);

  it('round-trips through the tournament record and its schema', () => {
    const ctx = context();
    const state = ensureSchedule(setName(fresh(), 'Friday'), ctx);
    const record = TournamentSchema.parse(toTournament(state, T0 + 1));
    const loaded = fromTournament(record);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.state.config).toEqual(state.config);
    expect(loaded.state.draft).toEqual(state.draft);
    expect(loaded.state.tournament.name).toBe('Friday');
  });

  it('reports an unreadable draft instead of throwing', () => {
    const record = { ...toTournament(fresh(), T0), setupDraft: { version: 99 } };
    expect(fromTournament(record).kind).toBe('unreadable');
  });

  it('changing players re-derives the preset and drops the split and schedule', () => {
    const ctx = context();
    const ready = ensureSchedule(withStack(confirmed(fresh())), ctx);
    expect(ready.draft.allocation).not.toBeNull();
    const changed = setPlayers(ready, 9);
    expect(changed.config.players).toBe(9);
    expect(changed.draft.allocation).toBeNull();
    expect(changed.draft.schedule).toBeNull();
    expect(stepComplete(changed, 'stack', ctx)).toBe(false);
  });

  it('keeps every earlier answer when only the target changes', () => {
    const state = setTarget(setName(confirmed(fresh()), 'Kept'), 120, 'preset');
    expect(state.tournament.name).toBe('Kept');
    expect(state.draft.confirmed).not.toBeNull();
    expect(state.config.targetDurationMin).toBe(120);
  });

  it('row edits un-confirm the inventory', () => {
    const state = setRows(confirmed(fresh()), [newRow('x')]);
    expect(state.draft.confirmed).toBeNull();
    expect(state.draft.allocation).toBeNull();
  });

  it('uses only the chip values actually handed out as denominations', () => {
    const state = withStack(confirmed(fresh()));
    const c = state.draft.confirmed;
    const allocation = state.draft.allocation;
    if (!c || !allocation) throw new Error('missing');
    const handedOut = Object.entries(allocation.perPlayer).flatMap(([id, n]) => {
      const value = c.assignment.values[id];
      return n > 0 && typeof value === 'number' ? [value] : [];
    });
    expect(state.config.denominations).toEqual([...new Set(handedOut)].sort((a, b) => a - b));
    expect(state.config.startingStack).toBe(allocation.stackValue);
    expect(allocationReport(state)?.errors).toEqual([]);
  });

  it('advanced edits switch to custom; break-end changes keep level edits', () => {
    const ctx = context();
    const base = ensureSchedule(withStack(confirmed(fresh())), ctx);
    const custom = setCustom(base, { levelDurationMin: 17 });
    expect(custom.config.structure).toBe('custom');
    expect(custom.config.levelDurationMin).toBe(17);

    const schedule = base.draft.schedule;
    if (!schedule) throw new Error('no schedule');
    const edited = setEditedSchedule(
      base,
      insertBreak(schedule, base.config, ctx, 0, 5).schedule,
    );
    const kept = setBreakEnd(edited, 'auto');
    expect(kept.draft.schedule).toBe(edited.draft.schedule);
    expect(kept.draft.scheduleEdited).toBe(true);
    expect(setStructure(kept, 'turbo').draft.schedule).toBeNull();
  });

  it('goes draft → ready once every step is complete', () => {
    const ctx = context();
    let state = ensureSchedule(withStack(confirmed(fresh())), ctx);
    for (const step of STEPS) expect(stepComplete(state, step, ctx)).toBe(true);
    state = { ...state, draft: { ...state.draft, furthestStep: STEPS.length - 1 } };
    const change = markReady(state, ctx);
    expect(change.tournament.status).toBe('ready');
    expect(change.tournament.scheduleId).toBe(change.schedules[0]?.id);
    expect(change.tournament.inventoryId).toBe('inv-1');
    expect(change.events).toHaveLength(1);
    expect(TournamentSchema.safeParse(change.tournament).success).toBe(true);
  });

  it('refuses to mark ready without a stack', () => {
    const ctx = context();
    const state = ensureSchedule(confirmed(fresh()), ctx);
    expect(stepComplete(state, 'review', ctx)).toBe(false);
    expect(() => markReady(state, ctx)).toThrow();
  });
});

describe('inventory rows', () => {
  it('turn typed text into domain records, keeping half-typed values invalid', () => {
    const rows = rowsFromInventory(homeSet().inventory).map((r, i) =>
      i === 0 ? { ...r, quantityText: '1o', valueText: '25' } : { ...r, valueText: '100' },
    );
    const { inventory, assignment } = toInventory(rows, { id: 'inv-1', name: 'Set', updatedAt: T0 });
    expect(Number.isNaN(inventory.chipTypes[0]?.quantity)).toBe(true);
    expect(assignment.values[rows[0]?.id ?? '']).toBe(25);
  });
});

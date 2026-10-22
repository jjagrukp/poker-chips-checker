import type { ModuleContext } from '@/core/modules/contract';
import { PRESET_SCHEMA_VERSION, type Preset } from '@/core/persistence/records';
import type { Schedule } from '@/core/scheduling/schedule';
import type { EpochMs } from '@/core/time';
import type { Tournament } from '@/core/tournaments/tournament';
import { HoldemConfigSchema, type HoldemConfig } from '@/modules/texas-holdem/config';
import { texasHoldemModule } from '@/modules/texas-holdem/module';
import { applyStructure } from '@/modules/texas-holdem/structure';
import { DURATION_PRESETS_MIN, SetupDraftSchema, type WizardState } from './wizard';

// Reuse (spec 02 §6, D28): presets carry the structure, not the chips; a duplicate copies the
// whole setup with fresh ids. Pure: each takes a fresh wizard state and returns the seeded one.

/** The parts of a config a preset carries; stack and chips come from the new inventory. */
type PresetFields = Pick<
  HoldemConfig,
  | 'players'
  | 'targetDurationMin'
  | 'structure'
  | 'levelDurationMin'
  | 'startingBlinds'
  | 'growth'
  | 'ante'
  | 'breaks'
  | 'breakEndBehaviour'
>;

export function presetFromTournament(
  t: Tournament,
  name: string,
  ids: { id: string },
  now: EpochMs,
): Preset | undefined {
  const config = HoldemConfigSchema.safeParse(t.config);
  if (t.moduleId !== texasHoldemModule.id || !config.success) return undefined;
  return {
    id: ids.id,
    schemaVersion: PRESET_SCHEMA_VERSION,
    name,
    moduleId: t.moduleId,
    moduleVersion: t.moduleVersion,
    presetVersion: 1,
    config: config.data,
    createdAt: now,
    updatedAt: now,
  };
}

/** The preset's config when this app can use it. */
export function presetConfig(preset: Preset): HoldemConfig | undefined {
  if (preset.moduleId !== texasHoldemModule.id) return undefined;
  const config = HoldemConfigSchema.safeParse(preset.config);
  return config.success ? config.data : undefined;
}

export function applyPreset(state: WizardState, preset: HoldemConfig): WizardState {
  const fields: PresetFields = {
    players: preset.players,
    targetDurationMin: preset.targetDurationMin,
    structure: preset.structure,
    levelDurationMin: preset.levelDurationMin,
    startingBlinds: preset.startingBlinds,
    growth: preset.growth,
    ante: preset.ante,
    breaks: preset.breaks,
    breakEndBehaviour: preset.breakEndBehaviour,
  };
  const known = (DURATION_PRESETS_MIN as readonly number[]).includes(preset.targetDurationMin);
  return {
    ...state,
    config: applyStructure({ ...state.config, ...fields }),
    draft: { ...state.draft, durationMode: known ? 'preset' : 'custom' },
  };
}

/**
 * Copies a tournament's setup into a fresh draft: same config, chips, stack and schedule
 * edits. The schedule gets new ids so the two tournaments never share a snapshot.
 */
export function duplicateOf(
  state: WizardState,
  source: Tournament,
  name: string | undefined,
  ctx: ModuleContext,
): WizardState {
  const config = HoldemConfigSchema.safeParse(source.config);
  if (source.moduleId !== texasHoldemModule.id || !config.success) return state;
  const draft = SetupDraftSchema.safeParse(source.setupDraft);
  const tournament = name === undefined ? state.tournament : { ...state.tournament, name };
  const base: WizardState = { ...state, tournament, config: config.data };
  if (!draft.success) return applyPreset(base, config.data);
  const schedule = draft.data.schedule && draft.data.scheduleEdited
    ? renumber(draft.data.schedule, ctx)
    : null;
  return {
    ...base,
    draft: { ...draft.data, schedule, scheduleEdited: schedule !== null },
  };
}

function renumber(schedule: Schedule, ctx: ModuleContext): Schedule {
  return {
    ...schedule,
    id: ctx.newId(),
    createdAt: ctx.clock.now(),
    segments: schedule.segments.map((segment) => ({ ...segment, id: ctx.newId() })),
  };
}

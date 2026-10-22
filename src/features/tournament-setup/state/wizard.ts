import { z } from 'zod';
import type { EventDraft } from '@/core/events/events';
import type { ModuleContext } from '@/core/modules/contract';
import { ScheduleSchema, type Schedule } from '@/core/scheduling/schedule';
import type { EpochMs } from '@/core/time';
import { transition } from '@/core/tournaments/lifecycle';
import { TOURNAMENT_SCHEMA_VERSION, type Tournament } from '@/core/tournaments/tournament';
import type { Issue, ValidationReport } from '@/core/validation/report';
import type { AllocationResult } from '@/features/chip-inventory/domain/allocate';
import {
  DenominationAssignmentSchema,
  InventorySchema,
  type DenominationAssignment,
  type Inventory,
} from '@/features/chip-inventory/domain/inventory';
import {
  AllocationResultSchema,
  type StoredAllocation,
} from '@/features/chip-inventory/domain/stored-allocation';
import { validateAllocation } from '@/features/chip-inventory/domain/validate-allocation';
import { HoldemConfigSchema, type HoldemConfig } from '@/modules/texas-holdem/config';
import { texasHoldemModule } from '@/modules/texas-holdem/module';
import { PRESETS, type Structure } from '@/modules/texas-holdem/presets';
import { applyStructure, defaultConfig } from '@/modules/texas-holdem/structure';
import { ChipRowSchema, rowsFromInventory, type ChipRow } from '@/features/chip-inventory/ui/rows';

// Setup-wizard state (spec 01 §5). Pure: every action returns a new state, and the store
// persists the result after each change. The draft lives on the tournament record (D23).

export const STEPS = ['basics', 'duration', 'chips', 'stack', 'structure', 'review'] as const;
export type StepId = (typeof STEPS)[number];

export const DURATION_PRESETS_MIN = [60, 120, 180, 240] as const;
export const CUSTOM_DURATION_MIN = { min: 30, max: 600 } as const;
export const DEFAULT_PLAYERS = 6;
export const DEFAULT_TARGET_MIN = 180;
export const DEFAULT_INVENTORY_NAME = 'My chips';

export const SETUP_DRAFT_VERSION = 1;

export const SetupDraftSchema = z.object({
  version: z.literal(SETUP_DRAFT_VERSION),
  furthestStep: z
    .number()
    .int()
    .min(0)
    .max(STEPS.length - 1),
  durationMode: z.enum(['preset', 'custom']),
  inventoryId: z.string().min(1),
  inventoryName: z.string(),
  rows: z.array(ChipRowSchema),
  /** Set by "Confirm inventory"; cleared by any row edit. */
  confirmed: z.object({ inventory: InventorySchema, assignment: DenominationAssignmentSchema }).nullable(),
  stackMode: z.enum(['recommended', 'custom']),
  allocation: AllocationResultSchema.nullable(),
  /** Regenerated whenever the config changes; kept as-is once edited level by level. */
  schedule: ScheduleSchema.nullable(),
  scheduleEdited: z.boolean(),
});
export type SetupDraft = z.infer<typeof SetupDraftSchema>;

export interface WizardState {
  tournament: Tournament;
  config: HoldemConfig;
  draft: SetupDraft;
}

export function newWizard(ids: { tournamentId: string; inventoryId: string }, now: EpochMs): WizardState {
  const config = defaultConfig({ players: DEFAULT_PLAYERS, targetDurationMin: DEFAULT_TARGET_MIN });
  return {
    tournament: {
      id: ids.tournamentId,
      schemaVersion: TOURNAMENT_SCHEMA_VERSION,
      moduleId: texasHoldemModule.id,
      moduleVersion: texasHoldemModule.version,
      status: 'draft',
      config,
      allocation: undefined,
      participants: { count: config.players, remaining: config.players },
      settings: { breakEndBehaviour: config.breakEndBehaviour },
      createdAt: now,
      updatedAt: now,
    },
    config,
    draft: {
      version: SETUP_DRAFT_VERSION,
      furthestStep: 0,
      durationMode: 'preset',
      inventoryId: ids.inventoryId,
      inventoryName: DEFAULT_INVENTORY_NAME,
      rows: [],
      confirmed: null,
      stackMode: 'recommended',
      allocation: null,
      schedule: null,
      scheduleEdited: false,
    },
  };
}

export type LoadResult =
  | { kind: 'ok'; state: WizardState }
  | { kind: 'unreadable' }
  | { kind: 'notDraft'; tournament: Tournament };

export function fromTournament(t: Tournament): LoadResult {
  if (t.status !== 'draft') return { kind: 'notDraft', tournament: t };
  if (t.moduleId !== texasHoldemModule.id) return { kind: 'unreadable' };
  const config = HoldemConfigSchema.safeParse(t.config);
  const draft = SetupDraftSchema.safeParse(t.setupDraft);
  if (!config.success || !draft.success) return { kind: 'unreadable' };
  return { kind: 'ok', state: { tournament: t, config: config.data, draft: draft.data } };
}

export function toTournament(state: WizardState, now: EpochMs): Tournament {
  const { tournament, config, draft } = state;
  return {
    ...tournament,
    config,
    setupDraft: draft,
    participants: { count: config.players, remaining: config.players },
    settings: { ...tournament.settings, breakEndBehaviour: config.breakEndBehaviour },
    updatedAt: now,
  };
}

// --- actions -------------------------------------------------------------------------------

type Draft = SetupDraft;

/** Re-derives preset fields and drops the generated schedule. */
function withConfig(state: WizardState, config: HoldemConfig, draft: Partial<Draft> = {}): WizardState {
  return {
    ...state,
    config: applyStructure(config),
    draft: { ...state.draft, ...draft, schedule: null, scheduleEdited: false },
  };
}

export function reachStep(state: WizardState, index: number): WizardState {
  if (index <= state.draft.furthestStep) return state;
  return { ...state, draft: { ...state.draft, furthestStep: index } };
}

function without(t: Tournament, key: 'name' | 'plannedStartAt'): Tournament {
  const copy = { ...t };
  if (key === 'name') delete copy.name;
  else delete copy.plannedStartAt;
  return copy;
}

export function setName(state: WizardState, name: string): WizardState {
  const rest = without(state.tournament, 'name');
  return { ...state, tournament: name.trim() ? { ...rest, name } : rest };
}

export function setPlannedStart(state: WizardState, at: EpochMs | undefined): WizardState {
  const rest = without(state.tournament, 'plannedStartAt');
  return { ...state, tournament: at === undefined ? rest : { ...rest, plannedStartAt: at } };
}

/** A new player count invalidates the chip split. */
export function setPlayers(state: WizardState, players: number): WizardState {
  if (players === state.config.players) return state;
  return withConfig(state, { ...state.config, players }, { allocation: null });
}

export function setTarget(
  state: WizardState,
  minutes: number,
  mode: Draft['durationMode'],
): WizardState {
  if (minutes === state.config.targetDurationMin) {
    return { ...state, draft: { ...state.draft, durationMode: mode } };
  }
  return withConfig(state, { ...state.config, targetDurationMin: minutes }, { durationMode: mode });
}

/** Any row edit un-confirms the inventory and drops the chip split. */
export function setRows(state: WizardState, rows: ChipRow[]): WizardState {
  return { ...state, draft: { ...state.draft, rows, confirmed: null, allocation: null } };
}

export function setInventoryName(state: WizardState, name: string): WizardState {
  return { ...state, draft: { ...state.draft, inventoryName: name, confirmed: null, allocation: null } };
}

export function loadInventory(state: WizardState, inventory: Inventory): WizardState {
  return {
    ...state,
    draft: {
      ...state.draft,
      inventoryId: inventory.id,
      inventoryName: inventory.name,
      rows: rowsFromInventory(inventory),
      confirmed: null,
      allocation: null,
    },
  };
}

function ascendingValues(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function withDenominations(config: HoldemConfig, values: number[]): HoldemConfig {
  const [smallest] = values;
  return smallest === undefined
    ? config
    : { ...config, denominations: values, smallestDenomination: smallest };
}

/** The caller has validated and saved the inventory. */
export function confirmInventory(
  state: WizardState,
  inventory: Inventory,
  assignment: DenominationAssignment,
): WizardState {
  const values = ascendingValues(
    Object.values(assignment.values).filter((v): v is number => v !== null),
  );
  const next = withConfig(state, withDenominations(state.config, values), {
    confirmed: { inventory, assignment },
    allocation: null,
  });
  return { ...next, tournament: { ...next.tournament, inventoryId: inventory.id } };
}

export function setStackMode(state: WizardState, mode: Draft['stackMode']): WizardState {
  if (mode === state.draft.stackMode) return state;
  return { ...state, draft: { ...state.draft, stackMode: mode, allocation: null } };
}

/**
 * Accepts a chip split that passed `validateAllocation`. The ladder uses only the values
 * actually handed out (D24), so the first small blind is always payable.
 */
export function acceptAllocation(state: WizardState, result: AllocationResult): WizardState {
  const assignment = state.draft.confirmed?.assignment;
  if (!assignment) return state;
  const values = ascendingValues(
    Object.entries(result.perPlayer).flatMap(([id, count]) => {
      const value = assignment.values[id];
      return count > 0 && typeof value === 'number' ? [value] : [];
    }),
  );
  const config = withDenominations({ ...state.config, startingStack: result.stackValue }, values);
  return withConfig(state, config, { allocation: result });
}

export function setStructure(state: WizardState, structure: Structure): WizardState {
  if (structure === state.config.structure) return state;
  return withConfig(state, { ...state.config, structure });
}

export type CustomPatch = Partial<
  Pick<HoldemConfig, 'startingBlinds' | 'levelDurationMin' | 'growth' | 'ante' | 'breaks'>
>;

/** Advanced-panel edits switch the structure to custom. */
export function setCustom(state: WizardState, patch: CustomPatch): WizardState {
  return withConfig(state, { ...state.config, ...patch, structure: 'custom' });
}

/** Doesn't change the schedule, so level edits survive. */
export function setBreakEnd(
  state: WizardState,
  behaviour: HoldemConfig['breakEndBehaviour'],
): WizardState {
  return { ...state, config: { ...state.config, breakEndBehaviour: behaviour } };
}

export function setEditedSchedule(state: WizardState, schedule: Schedule): WizardState {
  return { ...state, draft: { ...state.draft, schedule, scheduleEdited: true } };
}

export function resetSchedule(state: WizardState): WizardState {
  return { ...state, draft: { ...state.draft, schedule: null, scheduleEdited: false } };
}

/** Fills in the generated schedule when the config changed. */
export function ensureSchedule(state: WizardState, ctx: ModuleContext): WizardState {
  if (state.draft.schedule) return state;
  const { schedule } = texasHoldemModule.generateSchedule(state.config, ctx);
  return { ...state, draft: { ...state.draft, schedule } };
}

// --- checks --------------------------------------------------------------------------------

export function playersValid(n: number): boolean {
  const { min, max } = texasHoldemModule.playerRange;
  return Number.isInteger(n) && n >= min && n <= max;
}

export function durationValid(n: number): boolean {
  return Number.isInteger(n) && n >= CUSTOM_DURATION_MIN.min && n <= CUSTOM_DURATION_MIN.max;
}

/** Starting depth the stack search aims for: the structure's preset, or the custom blinds. */
export function targetDepthBB(config: HoldemConfig): number {
  if (config.structure !== 'custom') return PRESETS[config.structure].depth;
  return Math.max(1, Math.round(config.startingStack / config.startingBlinds.bb));
}

/** Independent re-check of the stored split against the current players, chips and blinds. */
export function allocationReport(state: WizardState): ValidationReport | null {
  const { confirmed, allocation } = state.draft;
  if (!confirmed || !allocation) return null;
  return validateAllocation(allocation, confirmed.inventory, state.config.players, confirmed.assignment, {
    targetStack: state.config.startingStack,
    firstSB: state.config.startingBlinds.sb,
  });
}

export interface Review {
  schedule: Schedule | null;
  config: ValidationReport;
  scheduleReport: ValidationReport;
  allocation: ValidationReport;
  /** Allocation quality warnings (e.g. few small chips). */
  allocationWarnings: Issue[];
}

export function review(state: WizardState, ctx: ModuleContext): Review {
  const schedule = state.draft.schedule;
  const allocation = allocationReport(state) ?? {
    errors: [{ code: 'noAllocation', messageKey: 'setup.review.error.noStack' }],
    warnings: [],
  };
  return {
    schedule,
    config: texasHoldemModule.validateConfig(state.config, ctx),
    scheduleReport: schedule
      ? texasHoldemModule.validateSchedule(schedule, state.config, ctx)
      : { errors: [{ code: 'noSchedule', messageKey: 'holdem.schedule.error.noLevels' }], warnings: [] },
    allocation,
    allocationWarnings: state.draft.allocation?.issues ?? [],
  };
}

export function stepComplete(state: WizardState, step: StepId, ctx: ModuleContext): boolean {
  switch (step) {
    case 'basics':
      return playersValid(state.config.players);
    case 'duration':
      return durationValid(state.config.targetDurationMin);
    case 'chips':
      return state.draft.confirmed !== null;
    case 'stack': {
      const report = allocationReport(state);
      return report !== null && report.errors.length === 0;
    }
    case 'structure': {
      const r = review(state, ctx);
      return r.config.errors.length === 0 && r.scheduleReport.errors.length === 0;
    }
    case 'review':
      return STEPS.every((s) => s === 'review' || stepComplete(state, s, ctx));
  }
}

export interface ReadyChange {
  tournament: Tournament;
  schedules: Schedule[];
  events: EventDraft[];
}

/** draft → ready (spec 02 §5). Throws `InvalidTransition` if anything still blocks. */
export function markReady(state: WizardState, ctx: ModuleContext): ReadyChange {
  const now = ctx.clock.now();
  const r = review(state, ctx);
  const { confirmed, allocation } = state.draft;
  if (!r.schedule || !confirmed || !allocation) {
    throw new Error('markReady: setup is incomplete');
  }
  const stored: StoredAllocation = { assignment: confirmed.assignment, result: allocation };
  const base: Tournament = {
    ...toTournament(state, now),
    scheduleId: r.schedule.id,
    inventoryId: confirmed.inventory.id,
    allocation: stored,
  };
  const { tournament, events } = transition(
    base,
    {
      action: 'markReady',
      readiness: {
        schedule: r.schedule,
        config: r.config,
        scheduleReport: r.scheduleReport,
        allocation: r.allocation,
      },
    },
    now,
  );
  return { tournament, schedules: [r.schedule], events };
}


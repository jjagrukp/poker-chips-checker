// Tunable constants for the Hold'em module (spec 04 §2–4). Tests pin them; any change bumps
// PRESET_VERSION. Saved schedules store their blinds, so changing these never alters them.

export const HOLDEM_MODULE_ID = 'texas-holdem';
export const HOLDEM_MODULE_VERSION = '1.0.0';
export const PRESET_VERSION = 'holdem-presets-1;ladderRules-1';
export const GENERATOR_VERSION = 'holdem-generator-1';

export type PresetStructure = 'gentle' | 'standard' | 'turbo';
export type Structure = PresetStructure | 'custom';

export interface AnteRule {
  mode: 'none' | 'bigBlind' | 'traditional';
  startLevel: number;
}

export interface Preset {
  /** Starting stack ÷ BB. */
  depth: number;
  growth: number;
  minLevelMin: number;
  maxLevelMin: number;
  ante: AnteRule;
  breaks: { everyMin: number; durationMin: number };
}

export type PresetTable = Readonly<Record<PresetStructure, Preset>>;

export const PRESETS: PresetTable = {
  gentle: {
    depth: 150,
    growth: 0.25,
    minLevelMin: 15,
    maxLevelMin: 40,
    ante: { mode: 'none', startLevel: 1 },
    breaks: { everyMin: 60, durationMin: 10 },
  },
  standard: {
    depth: 100,
    growth: 0.33,
    minLevelMin: 12,
    maxLevelMin: 30,
    ante: { mode: 'bigBlind', startLevel: 5 },
    breaks: { everyMin: 60, durationMin: 10 },
  },
  turbo: {
    depth: 60,
    growth: 0.5,
    minLevelMin: 8,
    maxLevelMin: 20,
    ante: { mode: 'bigBlind', startLevel: 4 },
    breaks: { everyMin: 60, durationMin: 5 },
  },
};

/** Estimated finish when BB ≥ total chips ÷ FINISH_FACTOR (heads-up, ~10 BB each). */
export const FINISH_FACTOR = 20;
export const LEVEL_LENGTHS_MIN = [8, 10, 12, 15, 20, 25, 30, 40] as const;
/** Bounds for custom structures: the full snapping range. */
export const CUSTOM_LEVEL_BOUNDS = { minLevelMin: 8, maxLevelMin: 40 } as const;
/** "Nice" BB mantissas, × 10ⁿ. */
export const NICE_MANTISSAS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8] as const;
/** Once BB ≥ this × smallest chip, SB must also be a multiple of the next chip up. */
export const CLUTTER_FACTOR = 40;
export const MIN_BUFFER_LEVELS = 4;
export const BUFFER_RATIO = 0.5;
/** Preset tournaments this short get no breaks. */
export const NO_BREAKS_MAX_TARGET_MIN = 75;
export const TRADITIONAL_ANTE_RATIO = 0.125;
/** Clamp warning only when the needed length is this far outside the preset bounds. */
export const CLAMP_TOLERANCE = 0.1;
export const MAX_DURATION_ITERATIONS = 20;
/** Safety cap on generated ladders. */
export const MAX_LEVELS = 100;

export const DEFAULT_STARTING_STACK = 10_000;
export const DEFAULT_DENOMINATIONS = [25, 100, 500, 1000] as const;

export function levelBounds(structure: Structure, presets: PresetTable = PRESETS) {
  if (structure === 'custom') return CUSTOM_LEVEL_BOUNDS;
  const { minLevelMin, maxLevelMin } = presets[structure];
  return { minLevelMin, maxLevelMin };
}

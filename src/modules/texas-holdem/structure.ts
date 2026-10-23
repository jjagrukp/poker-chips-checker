import type { HoldemConfig } from './config';
import { finishBigBlind, ladderToFinish, planDuration } from './duration';
import { ladderRules, startingBigBlind } from './ladder';
import {
  DEFAULT_DENOMINATIONS,
  DEFAULT_STARTING_STACK,
  levelBounds,
  NO_BREAKS_MAX_TARGET_MIN,
  PRESET_VERSION,
  PRESETS,
  type PresetTable,
} from './presets';

// Derives a preset's fields (blinds, growth, antes, breaks, level length) from players, stack,
// target and chips. Custom configs pass through untouched.

export function applyStructure(config: HoldemConfig, presets: PresetTable = PRESETS): HoldemConfig {
  if (config.structure === 'custom') return config;
  const preset = presets[config.structure];
  const rules = ladderRules(config.denominations);
  const bb = startingBigBlind(config.startingStack, preset.depth, rules);
  const breaks = config.targetDurationMin <= NO_BREAKS_MAX_TARGET_MIN ? null : { ...preset.breaks };
  const ladder = ladderToFinish(
    bb,
    preset.growth,
    rules,
    finishBigBlind(config.players, config.startingStack),
  );
  const plan = planDuration({
    targetDurationMin: config.targetDurationMin,
    levelsToFinish: ladder.length,
    breaks,
    bounds: levelBounds(config.structure, presets),
  });
  return {
    ...config,
    levelDurationMin: plan.levelDurationMin,
    startingBlinds: { sb: bb / 2, bb },
    growth: preset.growth,
    ante: { mode: preset.ante.mode, startLevel: preset.ante.startLevel },
    breaks,
    presetVersion: PRESET_VERSION,
  };
}

export function defaultConfig(
  input: { players: number; targetDurationMin: number },
  presets: PresetTable = PRESETS,
): HoldemConfig {
  return applyStructure(
    {
      players: input.players,
      targetDurationMin: input.targetDurationMin,
      startingStack: DEFAULT_STARTING_STACK,
      structure: 'standard',
      levelDurationMin: 20,
      startingBlinds: { sb: 50, bb: 100 },
      growth: presets.standard.growth,
      ante: { mode: 'none', startLevel: 1 },
      breaks: null,
      breakEndBehaviour: 'waitForHost',
      levelEndBehaviour: 'waitForHost',
      smallestDenomination: DEFAULT_DENOMINATIONS[0],
      denominations: [...DEFAULT_DENOMINATIONS],
      presetVersion: PRESET_VERSION,
    },
    presets,
  );
}

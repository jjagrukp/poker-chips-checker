import type { GameModule } from '@/core/modules/contract';
import { t } from '@/shared/messages';
import { HoldemConfigSchema, type HoldemConfig } from './config';
import { regenerateFrom } from './edits';
import { buildSchedule } from './generate';
import { HOLDEM_MODULE_ID, HOLDEM_MODULE_VERSION } from './presets';
import { defaultConfig } from './structure';
import { validateConfig, validateSchedule } from './validate';

// Texas Hold'em freezeout module (spec 04). Registered at the composition root in M5.

export const texasHoldemModule: GameModule<HoldemConfig> = {
  id: HOLDEM_MODULE_ID,
  version: HOLDEM_MODULE_VERSION,
  displayName: t('holdem.module.name', 'neutral'),
  description: t('holdem.module.description', 'neutral'),
  formats: ['freezeout'],
  playerRange: { min: 2, max: 10 },
  configSchema: HoldemConfigSchema,
  defaults: (input) => defaultConfig(input),
  validateConfig: (config) => validateConfig(config),
  generateSchedule: (config, ctx) => {
    const schedule = buildSchedule(config, ctx);
    return { schedule, report: validateSchedule(schedule, config) };
  },
  validateSchedule: (schedule, config) => validateSchedule(schedule, config),
  regenerateFrom: (schedule, fromIndex, config, ctx) =>
    regenerateFrom(schedule, config, ctx, fromIndex).schedule,
};

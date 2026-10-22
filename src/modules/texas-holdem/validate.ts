import type { Schedule } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import { emptyReport, type Issue, type ValidationReport } from '@/core/validation/report';
import type { MessageKey } from '@/shared/messages';
import type { HoldemConfig } from './config';
import { finishBigBlind, ladderToFinish, planDuration } from './duration';
import { formatChips, formatDurationMin } from './format';
import { levelData, markFinish, summarise } from './generate';
import { isPayableAmount, ladderRules } from './ladder';
import { levelBounds, PRESETS, type PresetTable } from './presets';

// Config and schedule validation (spec 04 §3, §5). Errors block; warnings inform.

export const MIN_DEPTH_BB = 10;
export const LOW_DEPTH_BB = 30;
export const HIGH_DEPTH_BB = 300;
export const FINISH_TOLERANCE = 0.2;

function issue(
  code: string,
  messageKey: MessageKey,
  params?: Record<string, unknown>,
  path?: string,
): Issue {
  return { code, messageKey, ...(params ? { params } : {}), ...(path ? { path } : {}) };
}

/** Clamp warning when a preset can't fit the target without leaving its level-length bounds. */
export function durationWarnings(config: HoldemConfig, presets: PresetTable = PRESETS): Issue[] {
  if (config.structure === 'custom') return [];
  const bb = config.startingBlinds.bb;
  const ladder = ladderToFinish(
    bb,
    config.growth,
    ladderRules(config.denominations),
    finishBigBlind(config.players, config.startingStack),
  );
  const plan = planDuration({
    targetDurationMin: config.targetDurationMin,
    levelsToFinish: ladder.length,
    breaks: config.breaks,
    bounds: levelBounds(config.structure, presets),
  });
  if (plan.clamp === 'none') return [];
  const params = {
    target: formatDurationMin(config.targetDurationMin),
    depth: Math.round(config.startingStack / bb),
    needed: Math.round(plan.neededMin),
  };
  return plan.clamp === 'tooLong'
    ? [issue('levelsTooLong', 'holdem.config.warning.levelsTooLong', params, 'levelDurationMin')]
    : [issue('levelsTooShort', 'holdem.config.warning.levelsTooShort', params, 'levelDurationMin')];
}

export function validateConfig(
  config: HoldemConfig,
  presets: PresetTable = PRESETS,
): ValidationReport {
  const report = emptyReport();
  const { sb, bb } = config.startingBlinds;
  if (bb !== 2 * sb) {
    report.errors.push(
      issue('blindRatio', 'holdem.config.error.blindRatio', undefined, 'startingBlinds'),
    );
  }
  if (!isPayableAmount(sb, config.smallestDenomination)) {
    report.errors.push(
      issue(
        'sbNotPayable',
        'holdem.config.error.sbNotPayable',
        { sb: formatChips(sb), chip: formatChips(config.smallestDenomination) },
        'startingBlinds.sb',
      ),
    );
  }
  const depth = config.startingStack / bb;
  if (depth < MIN_DEPTH_BB) {
    report.errors.push(
      issue(
        'stackTooShallow',
        'holdem.config.error.stackTooShallow',
        { depth: Math.floor(depth * 10) / 10 },
        'startingStack',
      ),
    );
  }
  report.warnings.push(...durationWarnings(config, presets));
  return report;
}

export function validateSchedule(
  schedule: Schedule,
  config: HoldemConfig,
  presets: PresetTable = PRESETS,
): ValidationReport {
  const report = emptyReport();
  const { segments } = schedule;
  const chip = config.smallestDenomination;
  const bounds = levelBounds(config.structure, presets);

  if (!segments.some((s) => s.kind === 'level')) {
    report.errors.push(issue('noLevels', 'holdem.schedule.error.noLevels'));
    return report;
  }
  if (segments.some((s) => s.durationMs <= 0)) {
    report.errors.push(issue('nonPositiveDuration', 'holdem.schedule.error.nonPositiveDuration'));
  }

  let prevBB: number | undefined;
  let firstBB: number | undefined;
  let level = 0;
  const flaggedLengths = new Set<number>();
  segments.forEach((s, i) => {
    if (s.kind !== 'level') return;
    level = s.levelNumber ?? level + 1;
    const path = `segments.${i}`;
    const data = levelData(s);
    if (!data) {
      report.errors.push(
        issue('invalidLevelData', 'holdem.schedule.error.invalidLevelData', { level }, path),
      );
      return;
    }
    const { sb, bb, ante } = data;
    if (sb <= 0 || bb <= 0) {
      report.errors.push(
        issue('nonPositiveBlinds', 'holdem.schedule.error.nonPositiveBlinds', { level }, path),
      );
      return;
    }
    firstBB ??= bb;
    if (!isPayableAmount(sb, chip)) {
      report.errors.push(
        issue(
          'sbNotPayable',
          'holdem.schedule.error.sbNotPayable',
          { level, sb: formatChips(sb), chip: formatChips(chip) },
          path,
        ),
      );
    }
    if (bb !== 2 * sb) {
      report.warnings.push(
        issue('blindRatio', 'holdem.schedule.warning.blindRatio', { level }, path),
      );
    }
    if (prevBB !== undefined && bb <= prevBB) {
      report.errors.push(
        issue('blindsNotIncreasing', 'holdem.schedule.error.blindsNotIncreasing', { level }, path),
      );
    } else if (prevBB !== undefined && bb > 2 * prevBB) {
      report.warnings.push(
        issue('growthJump', 'holdem.schedule.warning.growthJump', { level }, path),
      );
    }
    if (ante !== 0 && !isPayableAmount(ante, chip)) {
      report.errors.push(
        issue(
          'anteNotPayable',
          'holdem.schedule.error.anteNotPayable',
          { level, ante: formatChips(ante), chip: formatChips(chip) },
          path,
        ),
      );
    }
    if (ante > bb) {
      report.warnings.push(
        issue('anteAboveBB', 'holdem.schedule.warning.anteAboveBB', { level }, path),
      );
    }
    const minutes = s.durationMs / MINUTE;
    if (
      (minutes < bounds.minLevelMin || minutes > bounds.maxLevelMin) &&
      !flaggedLengths.has(minutes)
    ) {
      flaggedLengths.add(minutes);
      report.warnings.push(
        issue(
          'levelLength',
          'holdem.schedule.warning.levelLength',
          {
            level,
            minutes: Math.round(minutes * 10) / 10,
            min: bounds.minLevelMin,
            max: bounds.maxLevelMin,
          },
          path,
        ),
      );
    }
    prevBB = bb;
  });

  if (firstBB !== undefined) {
    const depth = config.startingStack / firstBB;
    const shown = Math.floor(depth * 10) / 10;
    if (depth < MIN_DEPTH_BB) {
      report.errors.push(
        issue('stackTooShallow', 'holdem.schedule.error.stackTooShallow', { depth: shown }),
      );
    } else if (depth < LOW_DEPTH_BB) {
      report.warnings.push(issue('depthLow', 'holdem.schedule.warning.depthLow', { depth: shown }));
    } else if (depth > HIGH_DEPTH_BB) {
      report.warnings.push(
        issue('depthHigh', 'holdem.schedule.warning.depthHigh', { depth: shown }),
      );
    }
  }

  // Recomputed from the config so stale or missing finish flags can't mislead.
  const { toFinishMin } = summarise(markFinish(segments, config));
  if (toFinishMin === undefined) {
    report.warnings.push(issue('noFinish', 'holdem.schedule.warning.noFinish'));
  } else if (
    Math.abs(toFinishMin - config.targetDurationMin) >
    FINISH_TOLERANCE * config.targetDurationMin
  ) {
    report.warnings.push(
      issue('finishOffTarget', 'holdem.schedule.warning.finishOffTarget', {
        scheduled: formatDurationMin(toFinishMin),
        target: formatDurationMin(config.targetDurationMin),
      }),
    );
  }
  return report;
}

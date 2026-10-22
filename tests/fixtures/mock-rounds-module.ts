import { z } from 'zod';
import type { GameModule, ModuleContext } from '@/core/modules/contract';
import { SCHEDULE_SCHEMA_VERSION, type Schedule, type Segment } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';
import { emptyReport, type Issue, type ValidationReport } from '@/core/validation/report';

// Extensibility test (spec 02 §4): timed rounds, points per round, no blinds. Proves the core
// carries a game it knows nothing about. Never shown in the UI; message keys are not catalogued.

export const MockRoundsConfigSchema = z.object({
  rounds: z.number().int().positive(),
  roundMinutes: z.number().int().positive(),
  pointsPerRound: z.number().int().positive(),
  breakEveryRounds: z.number().int().positive().optional(),
  breakMinutes: z.number().int().positive(),
});
export type MockRoundsConfig = z.infer<typeof MockRoundsConfigSchema>;

const issue = (code: string, path?: string): Issue => ({
  code,
  messageKey: `mock.${code}`,
  ...(path ? { path } : {}),
});

function validateConfig(config: MockRoundsConfig): ValidationReport {
  const report = emptyReport();
  if (config.rounds > 50) report.errors.push(issue('tooManyRounds', 'rounds'));
  if (config.roundMinutes < 5) report.warnings.push(issue('shortRounds', 'roundMinutes'));
  return report;
}

function generateSchedule(config: MockRoundsConfig, ctx: ModuleContext) {
  const segments: Segment[] = [];
  for (let round = 1; round <= config.rounds; round += 1) {
    segments.push({
      id: `round-${round}`,
      kind: 'level',
      durationMs: config.roundMinutes * MINUTE,
      levelNumber: round,
      display: {
        title: `Round ${round}`,
        lines: [{ label: 'Points', value: String(round * config.pointsPerRound) }],
      },
      data: { points: round * config.pointsPerRound },
    });
    const every = config.breakEveryRounds;
    if (every && round % every === 0 && round < config.rounds) {
      segments.push({
        id: `break-after-${round}`,
        kind: 'break',
        durationMs: config.breakMinutes * MINUTE,
        display: { title: 'Break', lines: [] },
        data: null,
      });
    }
  }
  const schedule: Schedule = {
    id: ctx.newId(),
    moduleId: mockRoundsModule.id,
    moduleVersion: mockRoundsModule.version,
    generatorVersion: 'mock-1',
    segments,
    createdAt: ctx.clock.now(),
    schemaVersion: SCHEDULE_SCHEMA_VERSION,
  };
  return { schedule, report: validateConfig(config) };
}

function validateSchedule(schedule: Schedule): ValidationReport {
  const report = emptyReport();
  if (schedule.segments.at(-1)?.kind === 'break') report.errors.push(issue('endsOnBreak'));
  return report;
}

export const mockRoundsModule: GameModule<MockRoundsConfig> = {
  id: 'mock-rounds',
  version: '1.0.0',
  displayName: 'Mock rounds',
  description: 'Timed rounds with points; test fixture only.',
  formats: ['freezeout'],
  playerRange: { min: 2, max: 20 },
  configSchema: MockRoundsConfigSchema,
  defaults: ({ targetDurationMin }) => ({
    rounds: Math.max(1, Math.round(targetDurationMin / 15)),
    roundMinutes: 15,
    pointsPerRound: 10,
    breakEveryRounds: 4,
    breakMinutes: 10,
  }),
  validateConfig,
  generateSchedule,
  validateSchedule,
};

// Test-only helpers for core unit tests (excluded from coverage).
import { SCHEDULE_SCHEMA_VERSION, type Schedule, type Segment } from '@/core/scheduling/schedule';
import { MINUTE } from '@/core/time';

export const T0 = 1_700_000_000_000;

export function segment(id: string, kind: Segment['kind'], minutes: number): Segment {
  return { id, kind, durationMs: minutes * MINUTE, display: { title: id, lines: [] }, data: null };
}

export function schedule(segments: Segment[], id = 'sched-1'): Schedule {
  return {
    id,
    moduleId: 'test',
    moduleVersion: '1',
    generatorVersion: '1',
    segments,
    createdAt: T0,
    schemaVersion: SCHEDULE_SCHEMA_VERSION,
  };
}

/** l1 10m · l2 10m · b1 5m · l3 10m */
export const basic = schedule([
  segment('l1', 'level', 10),
  segment('l2', 'level', 10),
  segment('b1', 'break', 5),
  segment('l3', 'level', 10),
]);

import { z } from 'zod';
import { IssueSchema } from '@/core/validation/report';
import { DenominationAssignmentSchema } from './inventory';

// What a tournament keeps of its chip split (`Tournament.allocation`, opaque to core): the
// per-tournament values plus the accepted AllocationResult. Parsed on every read.

const count = z.number().int().nonnegative();

export const AllocationResultSchema = z.object({
  perPlayer: z.record(count),
  stackValue: z.number().int().positive(),
  chipsPerPlayer: z.number().int().positive(),
  consumed: z.record(count),
  remaining: z.record(z.number().int()),
  score: z.number(),
  issues: z.array(IssueSchema),
  weightsVersion: z.number().int(),
});

export const StoredAllocationSchema = z.object({
  assignment: DenominationAssignmentSchema,
  result: AllocationResultSchema,
});
export type StoredAllocation = z.infer<typeof StoredAllocationSchema>;

import { z } from 'zod';

// Lifecycle status is separate from clock status and segment kind (D5).
export const TournamentStatusSchema = z.enum([
  'draft',
  'ready',
  'active',
  'completed',
  'cancelled',
]);
export type TournamentStatus = z.infer<typeof TournamentStatusSchema>;

export const LifecycleActionSchema = z.enum(['markReady', 'edit', 'start', 'complete', 'cancel']);
export type LifecycleAction = z.infer<typeof LifecycleActionSchema>;

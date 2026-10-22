import type { MessageKey } from '@/shared/messages';
import type { StepId } from '../state/wizard';

export const setupPath = (id: string, step: StepId) => `/setup/${id}/${step}`;
/** Opens the furthest step reached. */
export const resumePath = (id: string) => `/setup/${id}`;
export const tournamentPath = (id: string) => `/tournament/${id}`;

export const STEP_LABELS: Record<StepId, MessageKey> = {
  basics: 'setup.step.basics',
  duration: 'setup.step.duration',
  chips: 'setup.step.chips',
  stack: 'setup.step.stack',
  structure: 'setup.step.structure',
  review: 'setup.step.review',
};

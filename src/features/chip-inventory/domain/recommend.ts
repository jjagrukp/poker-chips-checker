import type { Issue } from '@/core/validation/report';
import {
  allocate,
  allocationInputErrors,
  searchChips,
  smallestRule,
  type AllocationRequest,
  type AllocationResult,
} from './allocate';
import { feasibleStacks } from './feasibility';

// Recommend mode (spec 05 §4): try "nice" stacks scaled to the denominations, keep the best
// score whose starting depth fits, and explain the pick in one line.

export const NICE_STACKS = [
  1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 50000,
] as const;
/** Tried in order: unscaled first, then progressively smaller or larger chip sets. */
const SCALES = [1, 0.1, 10, 0.01, 100, 0.001, 1000];
/** Acceptable starting depth in big blinds when the first big blind is known (D19). */
export const DEFAULT_DEPTH_RANGE = { min: 50, max: 200 } as const;

export interface RecommendRequest extends Omit<AllocationRequest, 'targetStack'> {
  /** Defaults to 2 × firstSB when only the small blind is known. */
  firstBB?: number;
  depthRange?: { min: number; max: number };
}

export type RecommendOutcome =
  | { kind: 'ok'; stack: number; result: AllocationResult; explanation: Issue; truncated: boolean }
  | { kind: 'impossible'; reason: Issue }
  | { kind: 'invalid'; errors: Issue[] };

export function recommendStack(req: RecommendRequest): RecommendOutcome {
  const errors = allocationInputErrors(req);
  if (req.firstBB !== undefined && !(Number.isInteger(req.firstBB) && req.firstBB > 0)) {
    errors.push({ code: 'invalidBlinds', messageKey: 'allocation.error.invalidBlinds' });
  }
  if (errors.length > 0) return { kind: 'invalid', errors };

  const chips = searchChips(req.inventory, req.assignment, req.players);
  const capacity = chips.reduce((sum, c) => sum + c.cap * c.value, 0);
  const bigBlind = req.firstBB ?? (req.firstSB !== undefined ? req.firstSB * 2 : undefined);
  // A known big blind implies the small blind when it halves cleanly.
  const firstSB =
    req.firstSB ??
    (req.firstBB !== undefined && req.firstBB % 2 === 0 ? req.firstBB / 2 : undefined);
  const base = firstSB !== undefined ? { ...req, firstSB } : req;
  const depth = req.depthRange ?? DEFAULT_DEPTH_RANGE;
  const rule = smallestRule(base);

  let best: { stack: number; result: AllocationResult } | null = null;
  let truncated = false;
  // The first scale with any valid stack wins (D19), so a 1/5/25 set gets 1000–50000 rather
  // than a tiny stack that happens to tie on score.
  for (const scale of SCALES) {
    const candidates = NICE_STACKS.map((n) => Math.round(n * scale * 1000) / 1000)
      .filter((s) => Number.isInteger(s) && s > 0 && s <= capacity)
      .filter(
        (s) => bigBlind === undefined || (s / bigBlind >= depth.min && s / bigBlind <= depth.max),
      );
    // Unknown feasibility (table too big) keeps every candidate; the search decides.
    const feasible = feasibleStacks(chips, Math.max(0, ...candidates), rule);
    for (const stack of feasible ? candidates.filter(feasible) : candidates) {
      const outcome = allocate({ ...base, targetStack: stack });
      if (outcome.kind !== 'invalid') truncated ||= outcome.truncated;
      if (outcome.kind !== 'ok') continue;
      // Ascending candidates: ties keep the smaller stack.
      if (!best || outcome.result.score < best.result.score)
        best = { stack, result: outcome.result };
    }
    if (best) break;
  }
  if (!best) {
    return {
      kind: 'impossible',
      reason: { code: 'noRecommendation', messageKey: 'allocation.recommend.none' },
    };
  }
  const { stack, result } = best;
  const denominations = new Set(
    chips.filter((c) => (result.perPlayer[c.id] ?? 0) > 0).map((c) => c.value),
  ).size;
  return {
    kind: 'ok',
    stack,
    result,
    truncated,
    explanation: {
      code: 'recommended',
      messageKey: 'allocation.recommend.explanation',
      params: { stack, chips: result.chipsPerPlayer, denominations },
    },
  };
}

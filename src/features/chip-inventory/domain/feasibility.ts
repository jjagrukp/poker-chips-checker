// Exact feasibility of per-player stacks (bounded knapsack over sums). Used to suggest the
// nearest feasible stacks and to tell "impossible" apart from "search hit its node limit".
// Not part of the search, so it can't hide a search bug; the validator re-checks results.
import { SEARCH_LIMITS } from './allocation-weights';

export interface FeasibilityChip {
  value: number;
  cap: number;
}

/** Whether the smallest denomination of a stack is acceptable for that stack value. */
export type SmallestRule = (smallestValue: number, stack: number) => boolean;

export function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Returns `isFeasible(stack)` for stacks up to `maxStack`: some per-player count vector
 * within caps sums to `stack` and its smallest used value passes `rule`.
 * `chips` must be sorted by value descending. Returns null (answer unknown) when the table
 * would exceed `SEARCH_LIMITS.maxFeasibilityCells`, so huge values can't exhaust memory.
 */
export function feasibleStacks(
  chips: readonly FeasibilityChip[],
  maxStack: number,
  rule: SmallestRule,
): ((stack: number) => boolean) | null {
  const live = chips.filter((c) => c.cap > 0);
  const step = live.reduce((g, c) => gcd(g, c.value), 0);
  if (step === 0) return () => false;
  const limit = Math.min(
    maxStack,
    live.reduce((sum, c) => sum + c.cap * c.value, 0),
  );
  const size = Math.floor(limit / step) + 1;
  if (size > SEARCH_LIMITS.maxFeasibilityCells) return null;
  const any = new Uint8Array(size);
  const ok = new Uint8Array(size);
  const reach = new Uint16Array(size);
  any[0] = 1;
  // Descending values: each type processed becomes the smallest value of any combination
  // that uses it, so the rule is decided the moment a type is added.
  for (const chip of live) {
    const u = chip.value / step;
    // reach[s] = fewest chips of this type (≥ 1) that reach s from a sum reachable before it.
    for (let s = 0; s < size; s++) {
      if (s < u) reach[s] = 0;
      else if (any[s - u]) reach[s] = 1;
      else {
        const prev = reach[s - u] ?? 0;
        reach[s] = prev > 0 && prev < chip.cap ? prev + 1 : 0;
      }
    }
    for (let s = 1; s < size; s++) {
      if ((reach[s] ?? 0) > 0) {
        any[s] = 1;
        if (!ok[s] && rule(chip.value, s * step)) ok[s] = 1;
      }
    }
  }
  return (stack) =>
    Number.isInteger(stack) && stack > 0 && stack <= limit && stack % step === 0
      ? ok[stack / step] === 1
      : false;
}

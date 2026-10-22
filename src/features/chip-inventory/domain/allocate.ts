import type { Issue } from '@/core/validation/report';
import { ALLOCATION_WEIGHTS_VERSION, SEARCH_LIMITS } from './allocation-weights';
import { feasibleStacks, gcd, type SmallestRule } from './feasibility';
import {
  usedChips,
  validateInventory,
  type ChipTypeId,
  type DenominationAssignment,
  type Inventory,
} from './inventory';
import { allocationWarnings, lexLess, scoreBreakdown, type ScoredChip } from './score';

// Starting-stack allocation (spec 05 §4): depth-first search over used chip types, values
// descending, with remaining-value and divisibility pruning.

export const DEFAULT_STARTING_DEPTH_BB = 100;

export interface AllocationRequest {
  inventory: Inventory;
  assignment: DenominationAssignment;
  players: number;
  targetStack: number;
  /** Known first small blind: the smallest allocated value must divide it. */
  firstSB?: number;
  /**
   * Used when `firstSB` is unknown: the first big blind is taken as `targetStack / depth`,
   * and the smallest allocated value must be at most half of it (D19).
   */
  startingDepthBB?: number;
}

export interface AllocationResult {
  perPlayer: Record<ChipTypeId, number>;
  stackValue: number;
  chipsPerPlayer: number;
  consumed: Record<ChipTypeId, number>;
  remaining: Record<ChipTypeId, number>;
  score: number;
  issues: Issue[];
  weightsVersion: number;
}

export type AllocationOutcome =
  | { kind: 'ok'; result: AllocationResult; truncated: boolean }
  | { kind: 'impossible'; reason: Issue; nearest: number[]; truncated: boolean }
  | { kind: 'invalid'; errors: Issue[] };

interface SearchChip extends ScoredChip {
  quantity: number;
  /** floor(quantity / players), before the search cap. */
  maxPerPlayer: number;
}

export function smallestRule(
  req: Pick<AllocationRequest, 'firstSB' | 'startingDepthBB'>,
): SmallestRule {
  const { firstSB } = req;
  if (firstSB !== undefined) return (smallest) => firstSB % smallest === 0;
  const depth = req.startingDepthBB ?? DEFAULT_STARTING_DEPTH_BB;
  return (smallest, stack) => smallest * 2 * depth <= stack;
}

/** Input checks shared by allocate and recommend. */
export function allocationInputErrors(
  req: Omit<AllocationRequest, 'targetStack'> & { targetStack?: number },
): Issue[] {
  const errors = [...validateInventory(req.inventory, req.assignment).errors];
  const positiveInt = (n: number | undefined) => n === undefined || (Number.isInteger(n) && n > 0);
  if (!Number.isInteger(req.players) || req.players < 2) {
    errors.push({ code: 'invalidPlayers', messageKey: 'allocation.error.invalidPlayers' });
  }
  if (!positiveInt(req.targetStack)) {
    errors.push({ code: 'invalidStack', messageKey: 'allocation.error.invalidStack' });
  }
  if (!positiveInt(req.firstSB) || !positiveInt(req.startingDepthBB)) {
    errors.push({ code: 'invalidBlinds', messageKey: 'allocation.error.invalidBlinds' });
  }
  return errors;
}

export function searchChips(
  inventory: Inventory,
  assignment: DenominationAssignment,
  players: number,
): SearchChip[] {
  return usedChips(inventory, assignment)
    .map((c) => {
      const maxPerPlayer = Math.floor(c.quantity / players);
      return { ...c, maxPerPlayer, cap: Math.min(maxPerPlayer, SEARCH_LIMITS.maxPerType) };
    })
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function allocate(req: AllocationRequest): AllocationOutcome {
  const errors = allocationInputErrors(req);
  if (errors.length > 0) return { kind: 'invalid', errors };

  const chips = searchChips(req.inventory, req.assignment, req.players);
  const rule = smallestRule(req);
  const found = search(chips, req.targetStack, rule);
  if (found.best) {
    return {
      kind: 'ok',
      result: buildResult(chips, found.best, req.players),
      truncated: found.truncated,
    };
  }

  const window = Math.floor(req.targetStack * SEARCH_LIMITS.nearestWindow);
  const capacity = chips.reduce((sum, c) => sum + c.cap * c.value, 0);
  // Below the window there's nothing feasible to suggest: skip the table.
  const feasible =
    capacity >= req.targetStack - window
      ? feasibleStacks(chips, req.targetStack + window, rule)
      : null;
  const reason =
    found.truncated && feasible?.(req.targetStack)
      ? { code: 'searchLimit', messageKey: 'allocation.impossible.searchLimit' }
      : impossibleReason(chips, req, rule);
  return {
    kind: 'impossible',
    reason,
    nearest: feasible ? nearestStacks(chips, req.targetStack, window, feasible) : [],
    truncated: found.truncated,
  };
}

interface SearchOutcome {
  best: number[] | null;
  truncated: boolean;
}

function search(chips: readonly SearchChip[], target: number, rule: SmallestRule): SearchOutcome {
  const n = chips.length;
  // suffixMax[i]: most value types i.. can add; suffixGcd[i]: every reachable sum is a multiple.
  const suffixMax = new Array<number>(n + 1).fill(0);
  const suffixGcd = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const chip = chips[i];
    const nextMax = suffixMax[i + 1] ?? 0;
    const nextGcd = suffixGcd[i + 1] ?? 0;
    if (!chip) continue;
    suffixMax[i] = nextMax + chip.cap * chip.value;
    suffixGcd[i] = chip.cap > 0 ? gcd(nextGcd, chip.value) : nextGcd;
  }

  const counts = new Array<number>(n).fill(0);
  let best: number[] | null = null;
  let bestScore = Infinity;
  let nodes = 0;
  let truncated = false;

  const leaf = () => {
    let smallest = 0;
    for (let i = n - 1; i >= 0; i--) {
      const chip = chips[i];
      if (chip && (counts[i] ?? 0) > 0) {
        smallest = chip.value;
        break;
      }
    }
    if (smallest === 0 || !rule(smallest, target)) return;
    const { score } = scoreBreakdown(chips, counts);
    if (score < bestScore || (score === bestScore && best !== null && lexLess(counts, best))) {
      bestScore = score;
      best = [...counts];
    }
  };

  const visit = (i: number, remaining: number): void => {
    if (truncated) return;
    if (++nodes > SEARCH_LIMITS.maxNodes) {
      truncated = true;
      return;
    }
    if (remaining === 0) {
      leaf();
      return;
    }
    const step = suffixGcd[i] ?? 0;
    const chip = chips[i];
    if (!chip || step === 0 || remaining > (suffixMax[i] ?? 0) || remaining % step !== 0) return;
    if (i === n - 1) {
      counts[i] = remaining / chip.value;
      leaf();
      counts[i] = 0;
      return;
    }
    const most = Math.min(chip.cap, Math.floor(remaining / chip.value));
    for (let c = 0; c <= most; c++) {
      counts[i] = c;
      visit(i + 1, remaining - c * chip.value);
    }
    counts[i] = 0;
  };

  visit(0, target);
  // Cast: TS doesn't see the closure assignment and would narrow `best` to null here.
  return { best: best as number[] | null, truncated };
}

function buildResult(
  chips: readonly SearchChip[],
  counts: readonly number[],
  players: number,
): AllocationResult {
  const perPlayer: Record<ChipTypeId, number> = {};
  const consumed: Record<ChipTypeId, number> = {};
  const remaining: Record<ChipTypeId, number> = {};
  let stackValue = 0;
  chips.forEach((chip, i) => {
    const count = counts[i] ?? 0;
    perPlayer[chip.id] = count;
    consumed[chip.id] = count * players;
    remaining[chip.id] = chip.quantity - count * players;
    stackValue += count * chip.value;
  });
  const breakdown = scoreBreakdown(chips, counts);
  return {
    perPlayer,
    stackValue,
    chipsPerPlayer: breakdown.chipsPerPlayer,
    consumed,
    remaining,
    score: breakdown.score,
    issues: allocationWarnings(chips, breakdown),
    weightsVersion: ALLOCATION_WEIGHTS_VERSION,
  };
}

/** The single most useful explanation of why no exact stack exists. */
function impossibleReason(
  chips: readonly SearchChip[],
  req: AllocationRequest,
  rule: SmallestRule,
): Issue {
  const live = chips.filter((c) => c.cap > 0);
  const [highest] = live;
  if (!highest) {
    return {
      code: 'notEnoughChips',
      messageKey: 'allocation.impossible.noChipsEach',
      params: { players: req.players },
    };
  }
  const capacity = live.reduce((sum, c) => sum + c.cap * c.value, 0);
  if (capacity < req.targetStack) {
    // Name the highest-value type held back by its quantity (even to 0 each): it costs the
    // most stack value. If none is, the per-type search cap is what binds.
    const binding = chips.find((c) => c.maxPerPlayer < SEARCH_LIMITS.maxPerType);
    return binding
      ? {
          code: 'notEnoughChips',
          messageKey: 'allocation.impossible.capped',
          params: {
            colour: binding.colour,
            quantity: binding.quantity,
            players: req.players,
            cap: binding.maxPerPlayer,
            maxStack: capacity,
          },
        }
      : {
          code: 'notEnoughChips',
          messageKey: 'allocation.impossible.tooBig',
          params: { max: SEARCH_LIMITS.maxPerType, maxStack: capacity },
        };
  }
  if (!live.some((c) => rule(c.value, req.targetStack))) {
    const smallest = live.at(-1) ?? highest;
    return req.firstSB !== undefined
      ? {
          code: 'smallestTooBig',
          messageKey: 'allocation.impossible.smallBlind',
          params: { colour: smallest.colour, value: smallest.value, firstSB: req.firstSB },
        }
      : {
          code: 'smallestTooBig',
          messageKey: 'allocation.impossible.stackTooSmall',
          params: { colour: smallest.colour, value: smallest.value },
        };
  }
  const step = live.reduce((g, c) => gcd(g, c.value), 0);
  if (req.targetStack % step !== 0) {
    return {
      code: 'notDivisible',
      messageKey: 'allocation.impossible.notDivisible',
      params: { stack: req.targetStack, step },
    };
  }
  return { code: 'noCombination', messageKey: 'allocation.impossible.noCombination' };
}

const ROUNDNESS = [10000, 5000, 1000, 500, 100, 50, 25, 10, 5, 1];

function roundness(n: number): number {
  return ROUNDNESS.find((r) => n % r === 0) ?? 0;
}

/**
 * Up to 3 feasible stacks within the window, rounder first, then nearer, then smaller.
 * Candidates step by the gcd of the values, so an off-grid target still gets suggestions (D19).
 */
function nearestStacks(
  chips: readonly SearchChip[],
  target: number,
  window: number,
  feasible: (stack: number) => boolean,
): number[] {
  const step = chips.filter((c) => c.cap > 0).reduce((g, c) => gcd(g, c.value), 0);
  if (step === 0) return [];
  const candidates: number[] = [];
  const first = Math.max(step, Math.ceil((target - window) / step) * step);
  for (let s = first; s <= target + window; s += step) {
    if (s !== target && feasible(s)) candidates.push(s);
  }
  return candidates
    .sort(
      (a, b) => roundness(b) - roundness(a) || Math.abs(a - target) - Math.abs(b - target) || a - b,
    )
    .slice(0, SEARCH_LIMITS.nearestCount);
}

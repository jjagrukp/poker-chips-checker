// Allocation score weights (spec 05 §4). Lower score is better. Bump the version whenever a
// weight or band changes, so stored allocations can say which rules produced them.

export const ALLOCATION_WEIGHTS_VERSION = 1;

export const ALLOCATION_WEIGHTS = {
  /** Comfortable physical chips per player. */
  chipBand: { min: 20, max: 40 },
  perChipOutsideBand: 2,
  /** Minimum chips of the smallest denomination each player should get. */
  minSmallestChips: 8,
  perMissingSmallestChip: 10,
  /** Fewer denominations than this (when that many are available) costs `fewDenominations`. */
  minDenominations: 3,
  fewDenominations: 15,
  /** Higher denomination has more chips than a lower one. */
  perPyramidInversion: 3,
  /** One chip type is more than this share of a player's chips. */
  dominantShare: 0.5,
  dominantType: 10,
} as const;

export const SEARCH_LIMITS = {
  /** Per-type, per-player chip cap during search. */
  maxPerType: 80,
  /** Search stops and returns its best so far after this many nodes. */
  maxNodes: 200_000,
  /** Nearest-stack suggestions stay within this fraction of the target. */
  nearestWindow: 0.25,
  nearestCount: 3,
  /** Largest exact-feasibility table (sums ÷ gcd); bigger ones are skipped, not built. */
  maxFeasibilityCells: 1_000_000,
} as const;

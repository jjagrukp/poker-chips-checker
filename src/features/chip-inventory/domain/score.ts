import type { Issue } from '@/core/validation/report';
import { ALLOCATION_WEIGHTS as W } from './allocation-weights';

// Allocation score (spec 05 §4). Lower is better. Works on chips sorted by value descending.

export interface ScoredChip {
  id: string;
  colour: string;
  value: number;
  /** Per-player cap; a chip with cap 0 isn't "available". */
  cap: number;
}

export interface ScoreBreakdown {
  score: number;
  chipsPerPlayer: number;
  /** Chips per player of the smallest allocated denomination (all types with that value). */
  smallestCount: number;
  smallestValue: number;
  denominationsUsed: number;
  denominationsAvailable: number;
  inversions: number;
  /** Index of a chip type above the dominant share, or -1. */
  dominant: number;
}

export function scoreBreakdown(
  chips: readonly ScoredChip[],
  counts: readonly number[],
): ScoreBreakdown {
  let chipsPerPlayer = 0;
  for (const c of counts) chipsPerPlayer += c;

  // Per distinct value, descending: chips allocated with that value.
  const byValue: { value: number; count: number }[] = [];
  const available = new Set<number>();
  chips.forEach((chip, i) => {
    if (chip.cap > 0) available.add(chip.value);
    const count = counts[i] ?? 0;
    if (count === 0) return;
    const last = byValue[byValue.length - 1];
    if (last?.value === chip.value) last.count += count;
    else byValue.push({ value: chip.value, count });
  });

  const smallest = byValue[byValue.length - 1];
  let inversions = 0;
  byValue.forEach((low, lo) => {
    for (const high of byValue.slice(0, lo)) if (low.count < high.count) inversions++;
  });
  const dominant = counts.findIndex((c) => c > chipsPerPlayer * W.dominantShare);

  const band = W.chipBand;
  const outside = Math.max(0, band.min - chipsPerPlayer) + Math.max(0, chipsPerPlayer - band.max);
  const smallestCount = smallest?.count ?? 0;
  const fewDenominations =
    byValue.length < W.minDenominations && available.size >= W.minDenominations;
  const score =
    outside * W.perChipOutsideBand +
    Math.max(0, W.minSmallestChips - smallestCount) * W.perMissingSmallestChip +
    (fewDenominations ? W.fewDenominations : 0) +
    inversions * W.perPyramidInversion +
    (dominant >= 0 ? W.dominantType : 0);

  return {
    score,
    chipsPerPlayer,
    smallestCount,
    smallestValue: smallest?.value ?? 0,
    denominationsUsed: byValue.length,
    denominationsAvailable: available.size,
    inversions,
    dominant,
  };
}

/** Human-facing warnings for a chosen allocation (catalogue keys under `allocation.warning`). */
export function allocationWarnings(chips: readonly ScoredChip[], b: ScoreBreakdown): Issue[] {
  const issues: Issue[] = [];
  const band = W.chipBand;
  if (b.chipsPerPlayer < band.min) {
    issues.push({
      code: 'fewChips',
      messageKey: 'allocation.warning.fewChips',
      params: { count: b.chipsPerPlayer, min: band.min },
    });
  } else if (b.chipsPerPlayer > band.max) {
    issues.push({
      code: 'manyChips',
      messageKey: 'allocation.warning.manyChips',
      params: { count: b.chipsPerPlayer, max: band.max },
    });
  }
  if (b.smallestCount < W.minSmallestChips) {
    issues.push({
      code: 'fewSmallChips',
      messageKey: 'allocation.warning.fewSmallChips',
      params: { count: b.smallestCount, value: b.smallestValue },
    });
  }
  if (b.denominationsUsed < W.minDenominations && b.denominationsAvailable >= W.minDenominations) {
    issues.push({
      code: 'fewDenominations',
      messageKey: 'allocation.warning.fewDenominations',
      params: { count: b.denominationsUsed },
    });
  }
  if (b.inversions > 0) {
    issues.push({ code: 'notPyramid', messageKey: 'allocation.warning.notPyramid' });
  }
  if (b.dominant >= 0) {
    issues.push({
      code: 'dominantType',
      messageKey: 'allocation.warning.dominantType',
      params: { colour: chips[b.dominant]?.colour ?? '' },
    });
  }
  return issues;
}

/** Deterministic tie-break: lexicographically smaller count vector (values descending) wins. */
export function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

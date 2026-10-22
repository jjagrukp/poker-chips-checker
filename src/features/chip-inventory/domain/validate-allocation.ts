import type { Issue, ValidationReport } from '@/core/validation/report';
import type { DenominationAssignment, Inventory } from './inventory';

// Independent re-check of every hard allocation constraint (spec 05 §4). Deliberately shares
// no code with the search: the UI only accepts results this validator passes.

export interface AllocationRules {
  /** Expected stack value, when the caller asked for one. */
  targetStack?: number | undefined;
  firstSB?: number | undefined;
  /** With no firstSB, the smallest value must be ≤ stack / (2 × depth). */
  startingDepthBB?: number | undefined;
}

interface CheckedAllocation {
  perPlayer: Record<string, number>;
  stackValue: number;
  chipsPerPlayer: number;
  consumed: Record<string, number>;
  remaining: Record<string, number>;
}

export function validateAllocation(
  result: CheckedAllocation,
  inventory: Inventory,
  players: number,
  assignment: DenominationAssignment,
  rules: AllocationRules,
): ValidationReport {
  const errors: Issue[] = [];
  const reject = (code: string, path?: string) =>
    errors.push({ code, messageKey: 'allocation.error.rejected', ...(path ? { path } : {}) });

  if (!Number.isInteger(players) || players < 2) reject('players');
  if (assignment.inventoryId !== inventory.id) reject('inventoryMismatch');

  let value = 0;
  let chips = 0;
  let smallest = Infinity;
  for (const [id, count] of Object.entries(result.perPlayer)) {
    const chip = inventory.chipTypes.find((c) => c.id === id);
    const denomination = assignment.values[id];
    if (!chip) {
      reject('unknownChip', id);
      continue;
    }
    if (!Number.isInteger(count) || count < 0) {
      reject('count', id);
      continue;
    }
    if (result.consumed[id] !== count * players) reject('consumed', id);
    if (result.remaining[id] !== chip.quantity - count * players) reject('remaining', id);
    if (count === 0) continue;
    if (typeof denomination !== 'number' || !Number.isInteger(denomination) || denomination <= 0) {
      reject('unusedChip', id);
      continue;
    }
    if (count * players > chip.quantity) reject('exceedsInventory', id);
    value += count * denomination;
    chips += count;
    smallest = Math.min(smallest, denomination);
  }

  if (chips === 0) reject('empty');
  if (value !== result.stackValue) reject('stackValue');
  if (chips !== result.chipsPerPlayer) reject('chipsPerPlayer');
  if (rules.targetStack !== undefined && value !== rules.targetStack) reject('targetStack');
  if (Number.isFinite(smallest)) {
    if (rules.firstSB !== undefined) {
      if (rules.firstSB % smallest !== 0) reject('smallBlind');
    } else if (rules.startingDepthBB !== undefined) {
      if (smallest * 2 * rules.startingDepthBB > value) reject('smallBlind');
    } else {
      reject('noBlindRule');
    }
  }
  return { errors, warnings: [] };
}

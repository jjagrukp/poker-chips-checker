import type { ChipTypeId, DenominationAssignment, Inventory } from './inventory';

// Denomination suggestion (spec 05 §3). Shown as a suggestion; the user confirms.

export const STANDARD_SETS: readonly (readonly number[])[] = [
  [1, 5, 25, 100, 500],
  [25, 100, 500, 1000, 5000],
  [5, 25, 100, 500, 1000],
  [25, 50, 100, 500, 1000],
];

/** Used when no standard set has enough values (more than five chip types to value). */
export const EXTENDED_SET: readonly number[] = [
  1, 5, 25, 100, 500, 1000, 5000, 10000, 25000, 50000, 100000, 250000,
];

export interface DenominationSuggestion {
  assignment: DenominationAssignment;
  /** Index into STANDARD_SETS, or null when EXTENDED_SET was used. */
  standardSet: number | null;
}

/**
 * Proposes values for `usedIds` (default: every chip type with chips). Printed values win;
 * the rest get the chosen set's values (minus printed ones) ascending, most numerous chip
 * type first. Types not in `usedIds` are marked unused (null).
 */
export function suggestDenominations(
  inventory: Inventory,
  usedIds?: readonly ChipTypeId[],
): DenominationSuggestion {
  const used = new Set(
    usedIds ?? inventory.chipTypes.filter((c) => c.quantity > 0).map((c) => c.id),
  );
  const chips = inventory.chipTypes.filter((c) => used.has(c.id));
  const printed = new Set(chips.flatMap((c) => (c.printedValue ? [c.printedValue] : [])));
  // Stable sort keeps inventory order for equal quantities.
  const toValue = chips.filter((c) => !c.printedValue).sort((a, b) => b.quantity - a.quantity);

  const pool = (set: readonly number[]) => set.filter((v) => !printed.has(v));
  const index = STANDARD_SETS.findIndex((s) => pool(s).length >= toValue.length);
  const standard = STANDARD_SETS[index];
  const standardSet = standard ? index : null;
  let values = pool(standard ?? EXTENDED_SET);
  // Past the extended set, keep going in ×10 steps so every type still gets a value.
  while (values.length < toValue.length) {
    let next = (values.at(-1) ?? EXTENDED_SET.at(-1) ?? 1) * 10;
    while (printed.has(next)) next *= 10;
    values = [...values, next];
  }

  const result: Record<ChipTypeId, number | null> = {};
  for (const chip of inventory.chipTypes)
    result[chip.id] = used.has(chip.id) ? (chip.printedValue ?? null) : null;
  toValue.forEach((chip, i) => {
    result[chip.id] = values[i] ?? null;
  });
  return { assignment: { inventoryId: inventory.id, values: result }, standardSet };
}

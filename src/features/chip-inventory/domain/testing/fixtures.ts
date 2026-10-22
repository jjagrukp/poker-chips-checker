// Test-only builders for chip-inventory domain tests.
import type { ChipType, DenominationAssignment, Inventory } from '../inventory';

export interface ChipSpec {
  colour: string;
  quantity: number;
  /** Assigned value; null = not used. Omit to leave unassigned. */
  value?: number | null;
  printedValue?: number;
  id?: string;
}

export function chipSet(
  specs: readonly ChipSpec[],
  id = 'inv',
): { inventory: Inventory; assignment: DenominationAssignment } {
  const chipTypes: ChipType[] = specs.map((s, i) => ({
    id: s.id ?? `c${i}`,
    colour: s.colour,
    swatch: '#808080',
    quantity: s.quantity,
    confirmed: true,
    ...(s.printedValue !== undefined ? { printedValue: s.printedValue } : {}),
  }));
  const values: DenominationAssignment['values'] = {};
  chipTypes.forEach((chip, i) => {
    const value = specs[i]?.value;
    if (value !== undefined) values[chip.id] = value;
  });
  return {
    inventory: { id, schemaVersion: 1, name: 'Test set', chipTypes, updatedAt: 0 },
    assignment: { inventoryId: id, values },
  };
}

/** The "classic 300" set from spec 05 §5, valued 1/5/25/100/500. */
export function classic300() {
  return chipSet([
    { colour: 'White', quantity: 100, value: 1 },
    { colour: 'Red', quantity: 50, value: 5 },
    { colour: 'Green', quantity: 50, value: 25 },
    { colour: 'Blue', quantity: 50, value: 100 },
    { colour: 'Black', quantity: 50, value: 500 },
  ]);
}

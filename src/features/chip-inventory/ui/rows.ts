import { z } from 'zod';
import type { ValidationReport } from '@/core/validation/report';
import { suggestDenominations } from '@/features/chip-inventory/domain/denominations';
import { swatchFor, UNKNOWN_SWATCH } from '@/features/chip-inventory/photo/to-rows';
import {
  INVENTORY_SCHEMA_VERSION,
  validateInventory,
  type ChipType,
  type DenominationAssignment,
  type Inventory,
} from '@/features/chip-inventory/domain/inventory';

// Editable inventory rows (spec 05 §2). Quantity and value stay as typed text so a half-typed
// row never breaks the saved draft; `toInventory` turns them into domain records to validate.

export const ChipRowSchema = z.object({
  id: z.string().min(1),
  colour: z.string(),
  swatch: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().optional(),
  quantityText: z.string(),
  valueText: z.string(),
  used: z.boolean(),
  confirmed: z.boolean(),
  printedValue: z.number().int().positive().optional(),
  notes: z.string().optional(),
  /** Quantity was estimated from a photo: show "check this" until the host edits or confirms it. */
  checkCount: z.boolean().optional(),
  /** The swatch was chosen (picker or a saved set), so typing the colour name leaves it alone. */
  swatchPicked: z.boolean().optional(),
});
export type ChipRow = z.infer<typeof ChipRowSchema>;

const WHOLE = /^\d+$/;

function parseWhole(text: string): number {
  const trimmed = text.trim();
  return WHOLE.test(trimmed) ? Number(trimmed) : NaN;
}

/** A new row's swatch, until a colour name or the picker changes it. */
export const DEFAULT_SWATCH = '#ffffff';

/**
 * Typing a colour name: an unpicked swatch follows it ("Red" → red). Names it doesn't know
 * ("Re", "Bluee") keep the last swatch, so a half-typed word never flashes grey.
 */
export function colourChange(row: ChipRow, colour: string): Partial<ChipRow> {
  const derived = swatchFor(colour);
  if (row.swatchPicked || derived === UNKNOWN_SWATCH) return { colour };
  return { colour, swatch: derived };
}

export function newRow(id: string): ChipRow {
  return {
    id,
    colour: '',
    swatch: DEFAULT_SWATCH,
    quantityText: '',
    valueText: '',
    used: true,
    confirmed: true,
  };
}

/** Rows from a saved inventory; values are per tournament, so only printed values carry over. */
export function rowsFromInventory(inventory: Inventory): ChipRow[] {
  return inventory.chipTypes.map((chip) => ({
    id: chip.id,
    colour: chip.colour,
    swatch: chip.swatch,
    swatchPicked: true,
    ...(chip.description !== undefined ? { description: chip.description } : {}),
    quantityText: String(chip.quantity),
    valueText: chip.printedValue !== undefined ? String(chip.printedValue) : '',
    used: chip.quantity > 0,
    confirmed: chip.confirmed,
    ...(chip.printedValue !== undefined ? { printedValue: chip.printedValue } : {}),
    ...(chip.notes !== undefined ? { notes: chip.notes } : {}),
  }));
}

export interface InventoryDraft {
  inventory: Inventory;
  assignment: DenominationAssignment;
}

/** Unparseable quantities/values become NaN so `validateInventory` reports them. */
export function toInventory(
  rows: readonly ChipRow[],
  meta: { id: string; name: string; updatedAt: number },
): InventoryDraft {
  const values: Record<string, number | null> = {};
  const chipTypes: ChipType[] = rows.map((row) => {
    if (!row.used) values[row.id] = null;
    else if (row.valueText.trim() !== '') values[row.id] = parseWhole(row.valueText);
    return {
      id: row.id,
      colour: row.colour.trim(),
      swatch: row.swatch,
      ...(row.description?.trim() ? { description: row.description.trim() } : {}),
      quantity: parseWhole(row.quantityText),
      ...(row.printedValue !== undefined ? { printedValue: row.printedValue } : {}),
      ...(row.notes !== undefined ? { notes: row.notes } : {}),
      confirmed: row.confirmed,
    };
  });
  return {
    inventory: {
      id: meta.id,
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      name: meta.name,
      chipTypes,
      updatedAt: meta.updatedAt,
    },
    assignment: { inventoryId: meta.id, values },
  };
}

export function rowsReport(draft: InventoryDraft): ValidationReport {
  return validateInventory(draft.inventory, draft.assignment);
}

/** Applies the standard-set suggestion (spec 05 §3) to every used row. */
export function suggestRowValues(
  rows: readonly ChipRow[],
  meta: { id: string; name: string; updatedAt: number },
): ChipRow[] {
  const { inventory } = toInventory(rows, meta);
  // Unparseable quantities sort as 0 so the suggestion still runs.
  const sortable = {
    ...inventory,
    chipTypes: inventory.chipTypes.map((c) => ({
      ...c,
      quantity: Number.isFinite(c.quantity) ? c.quantity : 0,
    })),
  };
  const usedIds = rows.filter((r) => r.used).map((r) => r.id);
  const { assignment } = suggestDenominations(sortable, usedIds);
  return rows.map((row) => {
    const value = assignment.values[row.id];
    return row.used && value != null ? { ...row, valueText: String(value) } : row;
  });
}

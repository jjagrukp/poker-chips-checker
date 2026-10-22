import { z } from 'zod';
import type { RecordType } from '@/core/persistence/migrations';
import type { Issue, ValidationReport } from '@/core/validation/report';

// Game-agnostic chip inventory (spec 05 §1). Physical chips are reusable across tournaments;
// values live in a per-tournament DenominationAssignment and never mutate the inventory.

export const INVENTORY_SCHEMA_VERSION = 1;
export const MAX_CHIP_TYPES = 12;

const positiveInt = z.number().int().positive();

export const ChipTypeSchema = z.object({
  id: z.string().min(1),
  colour: z.string(),
  /** Hex swatch for the UI; never the only identifier. */
  swatch: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().optional(),
  quantity: z.number().int().min(0),
  printedValue: positiveInt.optional(),
  notes: z.string().optional(),
  confirmed: z.boolean(),
});
export type ChipType = z.infer<typeof ChipTypeSchema>;
export type ChipTypeId = ChipType['id'];

// The type limit is a validation error (validateInventory), not a schema rule, so an
// oversized inventory still loads and can be edited instead of being quarantined.
export const InventorySchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal(INVENTORY_SCHEMA_VERSION),
    name: z.string(),
    chipTypes: z.array(ChipTypeSchema),
    updatedAt: z.number().int(),
  })
  .superRefine((inventory, ctx) => {
    const seen = new Set<string>();
    inventory.chipTypes.forEach((chip, i) => {
      if (seen.has(chip.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chipTypes', i, 'id'],
          message: 'duplicate chip type id',
        });
      }
      seen.add(chip.id);
    });
  });
export type Inventory = z.infer<typeof InventorySchema>;

export const inventoryRecord: RecordType<Inventory> = {
  name: 'inventory',
  version: INVENTORY_SCHEMA_VERSION,
  schema: InventorySchema,
  migrations: {},
};

/** Per-tournament values; `null` = chip type not used. Missing key = unassigned. */
export const DenominationAssignmentSchema = z.object({
  inventoryId: z.string().min(1),
  values: z.record(positiveInt.nullable()),
});
export type DenominationAssignment = z.infer<typeof DenominationAssignmentSchema>;

/** A chip type in play: has a positive value in the assignment. */
export interface UsedChip {
  id: ChipTypeId;
  colour: string;
  value: number;
  quantity: number;
}

/** Used chip types in inventory order. */
export function usedChips(inventory: Inventory, assignment: DenominationAssignment): UsedChip[] {
  return inventory.chipTypes.flatMap((chip) => {
    const value = assignment.values[chip.id];
    return value == null
      ? []
      : [{ id: chip.id, colour: chip.colour, value, quantity: chip.quantity }];
  });
}

/** Spec 05 §2 + §4 input rules. Errors block allocation and confirming the inventory. */
export function validateInventory(
  inventory: Inventory,
  assignment?: DenominationAssignment,
): ValidationReport {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (inventory.chipTypes.length > MAX_CHIP_TYPES) {
    errors.push({
      code: 'tooManyChipTypes',
      messageKey: 'chips.error.tooManyChipTypes',
      params: { max: MAX_CHIP_TYPES, count: inventory.chipTypes.length },
    });
  }
  inventory.chipTypes.forEach((chip, i) => {
    if (!Number.isInteger(chip.quantity) || chip.quantity < 0) {
      errors.push({
        code: 'invalidQuantity',
        messageKey: 'chips.error.invalidQuantity',
        params: { colour: chip.colour },
        path: `chipTypes.${i}.quantity`,
      });
    }
    if (!chip.confirmed) {
      errors.push({
        code: 'unconfirmed',
        messageKey: 'chips.error.unconfirmed',
        params: { colour: chip.colour },
        path: `chipTypes.${i}.confirmed`,
      });
    }
  });
  if (assignment) {
    const ids = new Set(inventory.chipTypes.map((c) => c.id));
    for (const [id, value] of Object.entries(assignment.values)) {
      if (!ids.has(id)) {
        errors.push({
          code: 'unknownChipType',
          messageKey: 'chips.error.unknownChipType',
          path: `values.${id}`,
        });
      } else if (value !== null && (!Number.isInteger(value) || value <= 0)) {
        errors.push({
          code: 'invalidValue',
          messageKey: 'chips.error.invalidValue',
          path: `values.${id}`,
        });
      }
    }
    inventory.chipTypes.forEach((chip) => {
      if (!(chip.id in assignment.values)) {
        errors.push({
          code: 'unassigned',
          messageKey: 'chips.error.unassigned',
          params: { colour: chip.colour },
          path: `values.${chip.id}`,
        });
      }
    });
    if (usedChips(inventory, assignment).length === 0) {
      errors.push({ code: 'noChipsUsed', messageKey: 'chips.error.noChipsUsed' });
    }
  }
  return { errors, warnings };
}

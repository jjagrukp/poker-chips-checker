import { migrateRecord } from '@/core/persistence/migrations';
import { InventorySchema, inventoryRecord, usedChips, validateInventory } from './inventory';
import { chipSet } from './testing/fixtures';

describe('inventory schema', () => {
  it('parses a valid inventory through the record type', () => {
    const { inventory } = chipSet([{ colour: 'White', quantity: 100 }]);
    expect(migrateRecord(inventoryRecord, inventory)).toEqual({
      ok: true,
      value: inventory,
      migrated: false,
    });
  });

  it('rejects duplicate ids, negative or fractional quantities and bad swatches', () => {
    const { inventory } = chipSet([
      { colour: 'White', quantity: 100, id: 'a' },
      { colour: 'Red', quantity: 50, id: 'a' },
    ]);
    expect(InventorySchema.safeParse(inventory).success).toBe(false);
    const [chip] = inventory.chipTypes;
    const withChip = (patch: object) => ({ ...inventory, chipTypes: [{ ...chip, ...patch }] });
    expect(InventorySchema.safeParse(withChip({ quantity: -1 })).success).toBe(false);
    expect(InventorySchema.safeParse(withChip({ quantity: 1.5 })).success).toBe(false);
    expect(InventorySchema.safeParse(withChip({ swatch: 'red' })).success).toBe(false);
    expect(InventorySchema.safeParse(withChip({})).success).toBe(true);
  });
});

describe('validateInventory', () => {
  it('passes a confirmed, fully assigned set', () => {
    const { inventory, assignment } = chipSet([
      { colour: 'White', quantity: 100, value: 25 },
      { colour: 'Red', quantity: 0, value: null },
    ]);
    expect(validateInventory(inventory, assignment).errors).toEqual([]);
    expect(usedChips(inventory, assignment)).toEqual([
      { id: 'c0', colour: 'White', value: 25, quantity: 100 },
    ]);
  });

  it('reports unconfirmed rows, unassigned types, unknown ids and nothing used', () => {
    const { inventory, assignment } = chipSet([
      { colour: 'White', quantity: 100, value: null },
      { colour: 'Red', quantity: 50 },
    ]);
    inventory.chipTypes = inventory.chipTypes.map((c, i) =>
      i === 0 ? { ...c, confirmed: false } : c,
    );
    assignment.values.ghost = 5;
    const codes = validateInventory(inventory, assignment).errors.map((e) => e.code);
    expect(codes).toEqual(['unconfirmed', 'unknownChipType', 'unassigned', 'noChipsUsed']);
  });

  it('reports non-integer values', () => {
    const { inventory, assignment } = chipSet([{ colour: 'White', quantity: 100, value: 2.5 }]);
    expect(validateInventory(inventory, assignment).errors.map((e) => e.code)).toEqual([
      'invalidValue',
    ]);
  });
});

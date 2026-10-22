import { EXTENDED_SET, suggestDenominations } from './denominations';
import { chipSet } from './testing/fixtures';

describe('suggestDenominations', () => {
  it('gives the most numerous chips the lowest values from the first standard set', () => {
    const { inventory } = chipSet([
      { colour: 'Black', quantity: 25 },
      { colour: 'White', quantity: 100 },
      { colour: 'Red', quantity: 50 },
    ]);
    const { assignment, standardSet } = suggestDenominations(inventory);
    expect(standardSet).toBe(0);
    expect(assignment).toEqual({ inventoryId: 'inv', values: { c0: 25, c1: 1, c2: 5 } });
  });

  it('keeps inventory order for equal quantities', () => {
    const { inventory } = chipSet([
      { colour: 'Red', quantity: 50 },
      { colour: 'Green', quantity: 50 },
      { colour: 'Blue', quantity: 50 },
    ]);
    expect(suggestDenominations(inventory).assignment.values).toEqual({ c0: 1, c1: 5, c2: 25 });
  });

  it('lets printed values override and skips them in the pool', () => {
    const { inventory } = chipSet([
      { colour: 'White', quantity: 100 },
      { colour: 'Red', quantity: 80, printedValue: 5 },
      { colour: 'Green', quantity: 50 },
    ]);
    expect(suggestDenominations(inventory).assignment.values).toEqual({ c0: 1, c1: 5, c2: 25 });
  });

  it('marks empty and excluded types as not used', () => {
    const { inventory } = chipSet([
      { colour: 'White', quantity: 100 },
      { colour: 'Red', quantity: 0 },
      { colour: 'Green', quantity: 50 },
    ]);
    expect(suggestDenominations(inventory).assignment.values).toEqual({ c0: 1, c1: null, c2: 5 });
    expect(suggestDenominations(inventory, ['c2']).assignment.values).toEqual({
      c0: null,
      c1: null,
      c2: 1,
    });
  });

  it('falls back to the extended set beyond five types', () => {
    const { inventory } = chipSet(
      Array.from({ length: 7 }, (_, i) => ({ colour: `C${i}`, quantity: 100 - i })),
    );
    const { assignment, standardSet } = suggestDenominations(inventory);
    expect(standardSet).toBeNull();
    expect(Object.values(assignment.values)).toEqual(EXTENDED_SET.slice(0, 7));
  });

  it('never duplicates a printed value when extending', () => {
    const printed = [...EXTENDED_SET, 50, 2_500_000];
    const { inventory } = chipSet([
      ...printed.map((p, i) => ({ colour: `P${i}`, quantity: 10, printedValue: p })),
      { colour: 'Blank', quantity: 5 },
    ]);
    // Every standard and extended value is printed, and so is the next ×10 step.
    expect(suggestDenominations(inventory).assignment.values.c14).toBe(25_000_000);
  });

  it('values every type even past the extended set', () => {
    const { inventory } = chipSet(
      Array.from({ length: 13 }, (_, i) => ({ colour: `C${i}`, quantity: 100 - i })),
    );
    const values = Object.values(suggestDenominations(inventory).assignment.values);
    expect(values).toHaveLength(13);
    expect(values[12]).toBe(2_500_000);
  });
});

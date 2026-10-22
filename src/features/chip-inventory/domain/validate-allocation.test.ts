import { chipSet } from './testing/fixtures';
import { validateAllocation } from './validate-allocation';

const { inventory, assignment } = chipSet([
  { colour: 'White', quantity: 100, value: 25 },
  { colour: 'Red', quantity: 100, value: 100 },
  { colour: 'Green', quantity: 50, value: 500 },
  { colour: 'Spare', quantity: 50, value: null },
]);

const valid = () => ({
  perPlayer: { c0: 16, c1: 16, c2: 6 } as Record<string, number>,
  stackValue: 5000,
  chipsPerPlayer: 38,
  consumed: { c0: 64, c1: 64, c2: 24 } as Record<string, number>,
  remaining: { c0: 36, c1: 36, c2: 26 } as Record<string, number>,
});

const codes = (result: ReturnType<typeof valid>, rules = { targetStack: 5000, firstSB: 25 }) =>
  validateAllocation(result, inventory, 4, assignment, rules).errors.map((e) => e.code);

describe('validateAllocation', () => {
  it('accepts a correct allocation', () => {
    expect(codes(valid())).toEqual([]);
  });

  it('rejects more chips than the inventory holds', () => {
    const r = valid();
    r.perPlayer.c2 = 13;
    r.consumed.c2 = 52;
    r.remaining.c2 = -2;
    r.stackValue = 8500;
    r.chipsPerPlayer = 45;
    expect(codes(r, { targetStack: 8500, firstSB: 25 })).toEqual(['exceedsInventory']);
  });

  it('rejects wrong totals, target mismatches and inconsistent bookkeeping', () => {
    const r = valid();
    r.stackValue = 5100;
    r.chipsPerPlayer = 37;
    r.consumed.c0 = 60;
    r.remaining.c1 = 0;
    expect(codes(r)).toEqual(['consumed', 'remaining', 'stackValue', 'chipsPerPlayer']);
    expect(codes(valid(), { targetStack: 4000, firstSB: 25 })).toEqual(['targetStack']);
  });

  it('rejects unused, unknown and fractional chips', () => {
    const r = valid();
    r.perPlayer.c3 = 1;
    r.consumed.c3 = 4;
    r.remaining.c3 = 46;
    r.perPlayer.ghost = 1;
    r.perPlayer.c0 = 15.5;
    // Dropping the whites also breaks the totals and leaves Red (100) as the smallest chip.
    expect(codes(r)).toEqual([
      'count',
      'unusedChip',
      'unknownChip',
      'stackValue',
      'chipsPerPlayer',
      'targetStack',
      'smallBlind',
    ]);
  });

  it('enforces the small-blind rule both ways', () => {
    expect(codes(valid(), { targetStack: 5000, firstSB: 10 })).toEqual(['smallBlind']);
    const depth = (startingDepthBB: number) =>
      validateAllocation(valid(), inventory, 4, assignment, { startingDepthBB }).errors.map(
        (e) => e.code,
      );
    expect(depth(100)).toEqual([]);
    expect(depth(101)).toEqual(['smallBlind']);
  });

  it('requires a small-blind rule and at least 2 players', () => {
    expect(
      validateAllocation(valid(), inventory, 4, assignment, {}).errors.map((e) => e.code),
    ).toEqual(['noBlindRule']);
    expect(
      validateAllocation(valid(), inventory, 1, assignment, { firstSB: 25 }).errors.map(
        (e) => e.code,
      ),
    ).toContain('players');
  });

  it('rejects an empty stack and a mismatched inventory', () => {
    const empty = { perPlayer: {}, stackValue: 0, chipsPerPlayer: 0, consumed: {}, remaining: {} };
    expect(
      validateAllocation(empty, inventory, 4, assignment, { firstSB: 25 }).errors.map(
        (e) => e.code,
      ),
    ).toEqual(['empty']);
    const other = { ...assignment, inventoryId: 'other' };
    expect(
      validateAllocation(valid(), inventory, 4, other, { firstSB: 25 }).errors.map((e) => e.code),
    ).toEqual(['inventoryMismatch']);
  });
});

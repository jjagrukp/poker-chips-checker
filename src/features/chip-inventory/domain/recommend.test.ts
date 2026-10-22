import { NICE_STACKS, recommendStack } from './recommend';
import { chipSet, classic300 } from './testing/fixtures';
import { validateAllocation } from './validate-allocation';

describe('recommendStack', () => {
  it.each([2, 4, 6, 8, 10])(
    'recommends a validated stack from the nice set for %i players',
    (players) => {
      const set = classic300();
      const outcome = recommendStack({ ...set, players });
      if (outcome.kind !== 'ok') throw new Error(JSON.stringify(outcome));
      expect(NICE_STACKS as readonly number[]).toContain(outcome.stack);
      const report = validateAllocation(outcome.result, set.inventory, players, set.assignment, {
        targetStack: outcome.stack,
        startingDepthBB: 100,
      });
      expect(report.errors).toEqual([]);
      expect(outcome.explanation).toMatchObject({
        messageKey: 'allocation.recommend.explanation',
        params: { stack: outcome.stack, chips: outcome.result.chipsPerPlayer },
      });
    },
  );

  it('keeps the starting depth within range when the big blind is known', () => {
    const set = classic300();
    const outcome = recommendStack({ ...set, players: 4, firstSB: 25, firstBB: 50 });
    if (outcome.kind !== 'ok') throw new Error(JSON.stringify(outcome));
    expect(outcome.stack / 50).toBeGreaterThanOrEqual(50);
    expect(outcome.stack / 50).toBeLessThanOrEqual(200);
    const report = validateAllocation(outcome.result, set.inventory, 4, set.assignment, {
      targetStack: outcome.stack,
      firstSB: 25,
    });
    expect(report.errors).toEqual([]);
  });

  it('derives the small blind from a known big blind', () => {
    const set = chipSet([
      { colour: 'Green', quantity: 200, value: 25 },
      { colour: 'Black', quantity: 200, value: 100 },
    ]);
    // firstBB 40 → SB 20, which no chip divides.
    expect(recommendStack({ ...set, players: 4, firstBB: 40 })).toMatchObject({
      kind: 'impossible',
    });
    expect(recommendStack({ ...set, players: 4, firstBB: 50 })).toMatchObject({ kind: 'ok' });
  });

  it('scales candidates down for low-value sets', () => {
    const set = chipSet([
      { colour: 'White', quantity: 200, value: 1 },
      { colour: 'Red', quantity: 100, value: 5 },
    ]);
    const outcome = recommendStack({ ...set, players: 4, startingDepthBB: 20 });
    if (outcome.kind !== 'ok') throw new Error(JSON.stringify(outcome));
    expect(outcome.stack).toBeLessThanOrEqual(50 + 25 * 5);
  });

  it('is impossible when no player can get a chip', () => {
    const set = chipSet([{ colour: 'White', quantity: 3, value: 25 }]);
    expect(recommendStack({ ...set, players: 4 })).toMatchObject({
      kind: 'impossible',
      reason: { messageKey: 'allocation.recommend.none' },
    });
  });

  it('rejects invalid blinds', () => {
    expect(recommendStack({ ...classic300(), players: 4, firstBB: 0 })).toMatchObject({
      kind: 'invalid',
    });
  });
});

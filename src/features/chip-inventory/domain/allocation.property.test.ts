import fc from 'fast-check';
import { allocate, searchChips, smallestRule, type AllocationRequest } from './allocate';
import { feasibleStacks } from './feasibility';
import { lexLess, scoreBreakdown } from './score';
import { chipSet } from './testing/fixtures';
import { validateAllocation } from './validate-allocation';

const VALUES = [1, 5, 10, 25, 50, 100, 500, 1000];

function requestArb(maxTypes: number, maxQuantity: number): fc.Arbitrary<AllocationRequest> {
  return fc
    .record({
      chips: fc.array(
        fc.record({
          quantity: fc.integer({ min: 0, max: maxQuantity }),
          value: fc.constantFrom(...VALUES),
        }),
        { minLength: 1, maxLength: maxTypes },
      ),
      players: fc.integer({ min: 2, max: 10 }),
      stackSteps: fc.integer({ min: 1, max: 400 }),
      firstSB: fc.option(fc.constantFrom(1, 5, 10, 25, 50, 100), { nil: undefined }),
    })
    .map(({ chips, players, stackSteps, firstSB }) => ({
      ...chipSet(chips.map((c, i) => ({ colour: `C${i}`, ...c }))),
      players,
      targetStack: stackSteps * 25,
      ...(firstSB !== undefined ? { firstSB } : {}),
    }));
}

const rulesOf = (req: AllocationRequest) => ({
  targetStack: req.targetStack,
  firstSB: req.firstSB,
  startingDepthBB: req.firstSB === undefined ? 100 : undefined,
});

describe('allocation properties', () => {
  it('results are exact, equal per player, within inventory and pass the validator', () => {
    fc.assert(
      fc.property(requestArb(5, 300), (req) => {
        const outcome = allocate(req);
        expect(outcome.kind).not.toBe('invalid');
        if (outcome.kind !== 'ok') return;
        const { result } = outcome;
        expect(
          validateAllocation(result, req.inventory, req.players, req.assignment, rulesOf(req))
            .errors,
        ).toEqual([]);
        for (const chip of req.inventory.chipTypes) {
          expect((result.perPlayer[chip.id] ?? 0) * req.players).toBeLessThanOrEqual(chip.quantity);
        }
        expect(result.stackValue).toBe(req.targetStack);
      }),
      { numRuns: 150 },
    );
  });

  it('the search agrees with exact feasibility whenever it finishes', () => {
    fc.assert(
      fc.property(requestArb(4, 200), (req) => {
        const outcome = allocate(req);
        if (outcome.kind === 'invalid' || outcome.truncated) return;
        const chips = searchChips(req.inventory, req.assignment, req.players);
        const feasible = feasibleStacks(chips, req.targetStack, smallestRule(req));
        if (!feasible) return;
        expect(outcome.kind === 'ok').toBe(feasible(req.targetStack));
        if (outcome.kind === 'impossible') {
          for (const stack of outcome.nearest) {
            const near = { ...req, targetStack: stack };
            const nearOutcome = allocate(near);
            if (
              nearOutcome.kind === 'ok' ||
              (nearOutcome.kind === 'impossible' && !nearOutcome.truncated)
            )
              expect(nearOutcome.kind).toBe('ok');
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('picks the best-scoring vector on small inventories (brute force)', () => {
    fc.assert(
      fc.property(requestArb(3, 60), (req) => {
        const outcome = allocate(req);
        if (outcome.kind === 'invalid' || outcome.truncated) return;
        const chips = searchChips(req.inventory, req.assignment, req.players);
        const rule = smallestRule(req);
        let best: { score: number; counts: number[] } | null = null;
        const counts = chips.map(() => 0);
        const walk = (i: number) => {
          if (i === chips.length) {
            const value = counts.reduce((sum, c, j) => sum + c * (chips[j]?.value ?? 0), 0);
            let last = counts.length - 1;
            while (last >= 0 && counts[last] === 0) last--;
            const smallest = chips[last];
            if (value !== req.targetStack || !smallest || !rule(smallest.value, value)) return;
            const { score } = scoreBreakdown(chips, counts);
            if (
              !best ||
              score < best.score ||
              (score === best.score && lexLess(counts, best.counts))
            ) {
              best = { score, counts: [...counts] };
            }
            return;
          }
          for (let c = 0; c <= (chips[i]?.cap ?? 0); c++) {
            counts[i] = c;
            walk(i + 1);
          }
          counts[i] = 0;
        };
        walk(0);
        const found = best as { score: number; counts: number[] } | null;
        if (!found) {
          expect(outcome.kind).toBe('impossible');
          return;
        }
        if (outcome.kind !== 'ok') throw new Error('search missed a feasible stack');
        expect(chips.map((c) => outcome.result.perPlayer[c.id])).toEqual(found.counts);
        expect(outcome.result.score).toBe(found.score);
      }),
      { numRuns: 150 },
    );
  });

  it('is stable across runs and inventory order', () => {
    fc.assert(
      fc.property(requestArb(5, 300), fc.integer(), (req, seed) => {
        const first = allocate(req);
        expect(allocate(req)).toEqual(first);
        const shuffled = [...req.inventory.chipTypes].sort(
          (a, b) => ((a.id.charCodeAt(1) * 31 + seed) % 7) - ((b.id.charCodeAt(1) * 31 + seed) % 7),
        );
        const reordered = allocate({
          ...req,
          inventory: { ...req.inventory, chipTypes: shuffled },
        });
        if (first.kind === 'ok' && reordered.kind === 'ok') {
          expect(reordered.result.perPlayer).toEqual(first.result.perPlayer);
        } else {
          expect(reordered.kind).toBe(first.kind);
        }
      }),
      { numRuns: 100 },
    );
  });
});

import { allocate, type AllocationOutcome, type AllocationRequest } from './allocate';
import { chipSet, classic300 } from './testing/fixtures';
import { validateAllocation } from './validate-allocation';

function expectValid(req: AllocationRequest, outcome: AllocationOutcome) {
  if (outcome.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(outcome)}`);
  const report = validateAllocation(outcome.result, req.inventory, req.players, req.assignment, {
    targetStack: req.targetStack,
    firstSB: req.firstSB,
    startingDepthBB: req.firstSB === undefined ? (req.startingDepthBB ?? 100) : undefined,
  });
  expect(report.errors).toEqual([]);
  return outcome.result;
}

describe('allocate', () => {
  it('finds the hand-verified 4-player 5000 stack', () => {
    const set = chipSet([
      { colour: 'White', quantity: 100, value: 25 },
      { colour: 'Red', quantity: 100, value: 100 },
      { colour: 'Green', quantity: 50, value: 500 },
    ]);
    const req = { ...set, players: 4, targetStack: 5000, firstSB: 25 };
    const result = expectValid(req, allocate(req));
    // Hand-checked: score 0 needs 20–40 chips, ≥ 8 whites and white ≥ red ≥ green. The
    // score-0 vectors (green, red, white) are [6,16,16], [7,11,16], [7,12,12], [8,8,8];
    // the lexicographic tie-break picks [6,16,16]: 3000 + 1600 + 400 = 5000.
    expect(result.perPlayer).toEqual({ c0: 16, c1: 16, c2: 6 });
    expect(result.score).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.consumed).toEqual({ c0: 64, c1: 64, c2: 24 });
    expect(result.remaining).toEqual({ c0: 36, c1: 36, c2: 26 });
  });

  it('accepts the spec example 20/20/5 as a valid (if worse) allocation', () => {
    const { inventory, assignment } = chipSet([
      { colour: 'White', quantity: 100, value: 25 },
      { colour: 'Red', quantity: 100, value: 100 },
      { colour: 'Green', quantity: 50, value: 500 },
    ]);
    const result = {
      perPlayer: { c0: 20, c1: 20, c2: 5 },
      stackValue: 5000,
      chipsPerPlayer: 45,
      consumed: { c0: 80, c1: 80, c2: 20 },
      remaining: { c0: 20, c1: 20, c2: 30 },
    };
    expect(
      validateAllocation(result, inventory, 4, assignment, { targetStack: 5000, firstSB: 25 })
        .errors,
    ).toEqual([]);
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'classic 300 set: %i players get a valid 1500 or an explained failure',
    (players) => {
      const req = { ...classic300(), players, targetStack: 1500, firstSB: 5 };
      const outcome = allocate(req);
      if (outcome.kind === 'ok') expectValid(req, outcome);
      else {
        expect(outcome.kind).toBe('impossible');
        for (const stack of outcome.kind === 'impossible' ? outcome.nearest : []) {
          expectValid({ ...req, targetStack: stack }, allocate({ ...req, targetStack: stack }));
        }
      }
    },
  );

  it('explains a starved inventory by naming the capped chip', () => {
    const set = chipSet([
      { colour: 'White', quantity: 100, value: 25 },
      { colour: 'Red', quantity: 100, value: 100 },
      { colour: 'Black', quantity: 20, value: 500 },
    ]);
    const outcome = allocate({ ...set, players: 9, targetStack: 10000, firstSB: 25 });
    expect(outcome).toMatchObject({
      kind: 'impossible',
      reason: {
        messageKey: 'allocation.impossible.capped',
        params: { colour: 'Black', quantity: 20, players: 9, cap: 2, maxStack: 2375 },
      },
      nearest: [],
    });
  });

  it('names a chip type that can give each player nothing', () => {
    const set = chipSet([
      { colour: 'White', quantity: 200, value: 25 },
      { colour: 'Black', quantity: 8, value: 500 },
    ]);
    const outcome = allocate({ ...set, players: 9, targetStack: 10000, firstSB: 25 });
    expect(outcome).toMatchObject({
      kind: 'impossible',
      reason: { params: { colour: 'Black', quantity: 8, players: 9, cap: 0 } },
    });
  });

  it('blames the per-type search cap when no quantity binds', () => {
    const set = chipSet([{ colour: 'White', quantity: 400, value: 25 }]);
    const outcome = allocate({ ...set, players: 4, targetStack: 3000, firstSB: 25 });
    expect(outcome).toMatchObject({
      kind: 'impossible',
      reason: { messageKey: 'allocation.impossible.tooBig', params: { max: 80, maxStack: 2000 } },
    });
  });

  it('answers a huge target quickly without building a feasibility table', () => {
    const outcome = allocate({
      ...classic300(),
      players: 4,
      targetStack: 5_000_000_000,
      firstSB: 5,
    });
    expect(outcome).toMatchObject({
      kind: 'impossible',
      reason: { code: 'notEnoughChips' },
      nearest: [],
    });
  });

  it('reports no combination when every quick check passes', () => {
    const set = chipSet([
      { colour: 'Green', quantity: 8, value: 25 },
      { colour: 'Black', quantity: 4, value: 100 },
    ]);
    // Per player: up to 2 greens and 1 black → 25, 50, 100, 125, 150; never 75.
    const outcome = allocate({ ...set, players: 4, targetStack: 75, firstSB: 25 });
    expect(outcome).toMatchObject({
      kind: 'impossible',
      reason: { code: 'noCombination' },
      // ±25 % of 75 holds no other multiple of 25.
      nearest: [],
    });
  });

  it('handles a single colour', () => {
    const req = {
      ...chipSet([{ colour: 'White', quantity: 200, value: 25 }]),
      players: 4,
      targetStack: 1000,
      firstSB: 25,
    };
    const result = expectValid(req, allocate(req));
    expect(result.perPlayer).toEqual({ c0: 40 });
    expect(result.issues.map((i) => i.code)).toEqual(['dominantType']);
  });

  it('keeps duplicate colours with different values apart', () => {
    const set = chipSet([
      { colour: 'Red', quantity: 100, value: 5 },
      { colour: 'Red', quantity: 100, value: 100 },
      { colour: 'Blue', quantity: 100, value: 25 },
    ]);
    const req = { ...set, players: 5, targetStack: 1000, firstSB: 5 };
    const result = expectValid(req, allocate(req));
    expect(Object.keys(result.perPlayer).sort()).toEqual(['c0', 'c1', 'c2']);
  });

  it('accepts 12 chip types and rejects 13', () => {
    const values = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000];
    const specs = values.map((value, i) => ({ colour: `Colour ${i}`, quantity: 40, value }));
    const twelve = { ...chipSet(specs.slice(0, 12)), players: 4, targetStack: 5000, firstSB: 5 };
    const outcome = allocate(twelve);
    if (outcome.kind === 'ok') expectValid(twelve, outcome);
    else expect(outcome.kind).toBe('impossible');

    const thirteen = allocate({ ...chipSet(specs), players: 4, targetStack: 5000, firstSB: 5 });
    expect(thirteen).toMatchObject({ kind: 'invalid', errors: [{ code: 'tooManyChipTypes' }] });
  });

  it('never allocates a used chip type with zero quantity', () => {
    const set = chipSet([
      { colour: 'White', quantity: 0, value: 1 },
      { colour: 'Red', quantity: 100, value: 5 },
      { colour: 'Green', quantity: 100, value: 25 },
    ]);
    const req = { ...set, players: 4, targetStack: 500, firstSB: 5 };
    const result = expectValid(req, allocate(req));
    expect(result.perPlayer.c0).toBe(0);
  });

  it('fails when the smallest chip does not divide the first small blind', () => {
    const set = chipSet([
      { colour: 'Green', quantity: 100, value: 25 },
      { colour: 'Black', quantity: 100, value: 100 },
    ]);
    const outcome = allocate({ ...set, players: 4, targetStack: 1000, firstSB: 10 });
    expect(outcome).toMatchObject({
      kind: 'impossible',
      reason: { code: 'smallestTooBig', params: { value: 25, firstSB: 10 } },
    });
  });

  it('uses the starting depth when the small blind is unknown', () => {
    const set = chipSet([{ colour: 'Black', quantity: 400, value: 100 }]);
    // 100 × 2 × 100 BB = 20000 > 4000, so a 100 chip is too big for this stack.
    const outcome = allocate({ ...set, players: 4, targetStack: 4000 });
    expect(outcome).toMatchObject({
      kind: 'impossible',
      reason: { messageKey: 'allocation.impossible.stackTooSmall' },
    });
    const shallow = { ...set, players: 4, targetStack: 4000, startingDepthBB: 20 };
    expectValid(shallow, allocate(shallow));
  });

  it('explains indivisible stacks and suggests nearby round ones', () => {
    const set = chipSet([
      { colour: 'Green', quantity: 200, value: 25 },
      { colour: 'Black', quantity: 200, value: 100 },
    ]);
    const req = { ...set, players: 4, targetStack: 1010, firstSB: 25 };
    const outcome = allocate(req);
    expect(outcome).toMatchObject({
      kind: 'impossible',
      reason: { code: 'notDivisible', params: { stack: 1010, step: 25 } },
    });
    if (outcome.kind !== 'impossible') return;
    expect(outcome.nearest[0]).toBe(1000);
    expect(outcome.nearest.length).toBeLessThanOrEqual(3);
    for (const stack of outcome.nearest) {
      expect(Math.abs(stack - 1010)).toBeLessThanOrEqual(1010 * 0.25);
      expectValid({ ...req, targetStack: stack }, allocate({ ...req, targetStack: stack }));
    }
  });

  it('rejects invalid input', () => {
    const set = classic300();
    expect(allocate({ ...set, players: 1, targetStack: 1000, firstSB: 5 })).toMatchObject({
      kind: 'invalid',
      errors: [{ code: 'invalidPlayers' }],
    });
    expect(allocate({ ...set, players: 4, targetStack: 10.5, firstSB: 5 })).toMatchObject({
      kind: 'invalid',
      errors: [{ code: 'invalidStack' }],
    });
  });

  it('stops at the node limit and reports it', () => {
    const values = [1, 2, 3, 5, 7, 10, 11, 13, 17, 19, 23, 29];
    const set = chipSet(values.map((value, i) => ({ colour: `C${i}`, quantity: 320, value })));
    const req = { ...set, players: 4, targetStack: 2000, firstSB: 1 };
    const outcome = allocate(req);
    expect(outcome.kind === 'ok' || outcome.kind === 'impossible').toBe(true);
    if (outcome.kind === 'invalid') return;
    expect(outcome.truncated).toBe(true);
    if (outcome.kind === 'ok') expectValid(req, outcome);
    else expect(outcome.reason.code).toBe('searchLimit');
  });
});

import {
  anteFor,
  bbStep,
  continueLadder,
  isPayableBB,
  ladderRules,
  niceValues,
  snapNextBB,
  startingBigBlind,
} from './ladder';

const R = ladderRules([25, 100, 500, 1000]);

describe('niceValues', () => {
  it('lists integer nice values in range', () => {
    expect(niceValues(1, 100)).toEqual([
      1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100,
    ]);
    expect(niceValues(900, 3000)).toEqual([1000, 1500, 2000, 2500, 3000]);
    expect(niceValues(5, 1)).toEqual([]);
  });
});

describe('payability', () => {
  it('needs SB to be a multiple of the smallest chip', () => {
    expect(bbStep(500, R)).toBe(50);
    expect(isPayableBB(150, R)).toBe(true);
    expect(isPayableBB(125, R)).toBe(false);
  });

  it('applies the chip-clutter rule from 40 × smallest chip', () => {
    expect(bbStep(999, R)).toBe(50);
    expect(bbStep(1000, R)).toBe(200);
    expect(isPayableBB(1500, R)).toBe(false);
    expect(bbStep(400, ladderRules([10, 25]))).toBe(100); // lcm(10, 25) = 50
    expect(bbStep(10_000, ladderRules([25]))).toBe(50); // no next chip
  });
});

describe('snapNextBB', () => {
  it.each([
    // prev, ideal, rules, expected
    [100, 133, R, 150],
    [150, 199.5, R, 200],
    [200, 266, R, 250],
    [800, 1064, R, 1000],
    [1000, 1330, R, 1400], // no payable nice value nearby → multiple of the step
    [100, 100, R, 150], // snapping would repeat → next value up
    [2, 2.66, ladderRules([1]), 4],
    [100, 133, ladderRules([5, 25]), 150],
    [200, 266, ladderRules([5, 25]), 250],
    [20_000, 26_600, R, 25_000],
  ])('%d → ideal %d snaps to %d', (prev, ideal, rules, expected) => {
    expect(snapNextBB(prev, ideal, rules)).toBe(expected);
  });

  it('continues a strictly increasing, payable ladder', () => {
    const ladder = continueLadder(100, 0.33, R, 30);
    ladder.reduce((prev, bb) => {
      expect(bb).toBeGreaterThan(prev);
      expect(isPayableBB(bb, R)).toBe(true);
      return bb;
    }, 100);
  });
});

describe('startingBigBlind', () => {
  it.each([
    [10_000, 100, R, 100],
    [10_000, 150, R, 50],
    [10_000, 60, R, 150],
    [1_000, 100, R, 50], // never below 2 × smallest chip
    [10_000, 100, ladderRules([7]), 98], // no nice multiple of 14 → step multiple
  ])('stack %d at %d BB deep → %d', (stack, depth, rules, expected) => {
    expect(startingBigBlind(stack, depth, rules)).toBe(expected);
  });
});

describe('anteFor', () => {
  it('follows the ante mode and start level', () => {
    expect(anteFor(9, 400, { mode: 'none', startLevel: 1 }, 25)).toBe(0);
    expect(anteFor(4, 400, { mode: 'bigBlind', startLevel: 5 }, 25)).toBe(0);
    expect(anteFor(5, 400, { mode: 'bigBlind', startLevel: 5 }, 25)).toBe(400);
    expect(anteFor(1, 1000, { mode: 'traditional', startLevel: 1 }, 25)).toBe(125);
    expect(anteFor(1, 1000, { mode: 'traditional', startLevel: 1, ratio: 0.1 }, 25)).toBe(100);
    expect(anteFor(1, 100, { mode: 'traditional', startLevel: 1 }, 25)).toBe(25); // never below a chip
  });
});

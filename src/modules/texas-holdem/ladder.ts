import type { HoldemConfig } from './config';
import { CLUTTER_FACTOR, NICE_MANTISSAS, TRADITIONAL_ANTE_RATIO } from './presets';

// Blind ladder (spec 04 §4). BB = 2 × SB, so a BB is payable when SB is a multiple of the
// smallest chip, and (chip-clutter rule) of the next chip up once BB ≥ 40 × smallest.

export interface LadderRules {
  smallest: number;
  /** Next denomination up, if the set has one. */
  next?: number;
}

/** Nearest nice candidates must be within this ratio of the ideal BB, else fall back to multiples. */
const NICE_WINDOW = 1.5;

export function ladderRules(denominations: readonly number[]): LadderRules {
  const [smallest = 1, next] = denominations;
  return next === undefined ? { smallest } : { smallest, next };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** The value a BB must be a multiple of. */
export function bbStep(bb: number, rules: LadderRules): number {
  const { smallest, next } = rules;
  if (next !== undefined && bb >= CLUTTER_FACTOR * smallest) {
    return 2 * ((smallest * next) / gcd(smallest, next));
  }
  return 2 * smallest;
}

export function isPayableBB(bb: number, rules: LadderRules): boolean {
  return Number.isInteger(bb) && bb > 0 && bb % bbStep(bb, rules) === 0;
}

export function isPayableAmount(amount: number, smallest: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount % smallest === 0;
}

/** Integer values of {1, 1.5, 2, 2.5, 3, 4, 5, 6, 8} × 10ⁿ in [lo, hi], ascending. */
export function niceValues(lo: number, hi: number): number[] {
  const out: number[] = [];
  if (hi < 1 || hi < lo) return out;
  const first = Math.floor(Math.log10(Math.max(lo, 1)));
  const last = Math.ceil(Math.log10(hi));
  for (let e = first; e <= last; e += 1) {
    for (const m of NICE_MANTISSAS) {
      const v = Math.round(m * 10 ** e);
      if (Math.abs(v - m * 10 ** e) < 1e-9 && v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}

/** Next BB after `prev`, snapped from `ideal`; always > prev and payable. */
export function snapNextBB(prev: number, ideal: number, rules: LadderRules): number {
  const target = Math.max(ideal, prev);
  const candidates = niceValues(
    Math.max(Math.floor(prev) + 1, target / NICE_WINDOW),
    target * NICE_WINDOW,
  ).filter((v) => v > prev && isPayableBB(v, rules));
  let best: number | undefined;
  for (const v of candidates) {
    if (best === undefined || Math.abs(Math.log(v / target)) < Math.abs(Math.log(best / target))) {
      best = v;
    }
  }
  if (best !== undefined) return best;

  // No nice value fits these chips: nearest multiple of the payable step instead.
  const step = 2 * rules.smallest;
  let v = Math.max(step, Math.round(target / step) * step);
  while (v <= prev || !isPayableBB(v, rules)) v += step;
  return v;
}

/** `count` BBs continuing after `prev` at `growth` per level. */
export function continueLadder(
  prev: number,
  growth: number,
  rules: LadderRules,
  count: number,
): number[] {
  const out: number[] = [];
  let bb = prev;
  for (let i = 0; i < count; i += 1) {
    bb = snapNextBB(bb, bb * (1 + growth), rules);
    out.push(bb);
  }
  return out;
}

/** Starting BB = stack ÷ depth snapped down to a payable value (never below 2 × smallest chip). */
export function startingBigBlind(stack: number, depth: number, rules: LadderRules): number {
  const target = stack / depth;
  const step = 2 * rules.smallest;
  if (target < step) return step;
  const nice = niceValues(step, target)
    .filter((v) => isPayableBB(v, rules))
    .at(-1);
  if (nice !== undefined && nice >= target / NICE_WINDOW) return nice;
  let v = Math.floor(target / step) * step;
  while (v > step && !isPayableBB(v, rules)) v -= step;
  return v;
}

export function anteFor(
  levelNumber: number,
  bb: number,
  ante: HoldemConfig['ante'],
  smallest: number,
): number {
  if (ante.mode === 'none' || levelNumber < ante.startLevel) return 0;
  if (ante.mode === 'bigBlind') return bb;
  const raw = bb * (ante.ratio ?? TRADITIONAL_ANTE_RATIO);
  return Math.max(smallest, Math.round(raw / smallest) * smallest);
}

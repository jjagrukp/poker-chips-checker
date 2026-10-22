# 04 — Texas Hold'em module

All logic deterministic, pure, versioned. Numbers below are tunable constants in
`texas-holdem/presets.ts` (with `presetVersion`); tests pin them.

## 1. Config
```ts
interface HoldemConfig {
  players: number;                      // 2–10
  targetDurationMin: number;            // includes breaks
  startingStack: number;
  structure: 'gentle' | 'standard' | 'turbo' | 'custom';
  levelDurationMin: number;             // derived for presets, editable in custom
  startingBlinds: { sb: number; bb: number };
  growth: number;                       // target per-level BB growth, e.g. 0.33
  ante: { mode: 'none' | 'bigBlind' | 'traditional'; startLevel: number; ratio?: number };
  breaks: { everyMin: number; durationMin: number } | null;
  breakEndBehaviour: 'auto' | 'waitForHost';
  smallestDenomination: number;         // from confirmed chip assignment
  presetVersion: string;
}
```
Segment `data` for levels: `{ sb, bb, ante }`.

## 2. Presets (v1 defaults)
| | Gentle | Standard | Turbo |
|---|---|---|---|
| Starting depth (stack ÷ BB) | 150 | 100 | 60 |
| Growth per level | 0.25 | 0.33 | 0.50 |
| Min / max level length | 15 / 40 min | 12 / 30 min | 8 / 20 min |
| Ante | none | BB ante from level 5 | BB ante from level 4 |
| Breaks | 10 min every ~60 min of play | same | 5 min every ~60 min |

## 3. Duration model (freezeout estimate)
- Total chips `T = players × startingStack`.
- Estimated finish when `BB ≥ T / F`, `F = 20` (heads-up with roughly 10 BB each).
  Mark that level `estimatedFinish: true`.
- Levels to finish `L = ceil(ln(BBend/BBstart) / ln(1 + growth)) + 1`.
- Playing time `P = target − breaks(P)`; solve iteratively (breaks depend on P).
- Level length = `P / L`, snapped to {8,10,12,15,20,25,30,40}. If it falls outside the
  preset's min/max, clamp and return a warning suggesting a different stack or structure
  (e.g. "4 hours with 60 BB stacks would need 45-minute levels — try Gentle or a bigger stack").
- Append buffer levels after the estimated finish: `max(4, ceil(0.5 × L))`, so overtime is rare.
- Show "Scheduled: 3h 10m to estimated finish (target 3h)" — never "ends at 10:30".

## 4. Blind ladder
- `BB = 2 × SB` (configurable ratio not needed in v1).
- SB must be a positive multiple of the smallest denomination in play.
- Ideal BB per level = previous × (1 + growth); snap to the nearest value from the "nice"
  set {1, 1.5, 2, 2.5, 3, 4, 5, 6, 8} × 10ⁿ that keeps SB a multiple of the smallest denomination.
- Strictly increasing; if snapping would repeat a value, take the next nice value up.
- Chip-clutter rule: once BB ≥ 40 × smallest denomination, SB must also be a multiple of
  the next denomination up (prepares future colour-ups). Flag `ladderRules` in presetVersion.
- Starting blinds default to `startingStack ÷ depth`, snapped down; must satisfy the SB rule.
- Antes: `bigBlind` mode → ante = BB (posted by BB player); `traditional` → ante ≈ 10–12.5 %
  of BB snapped to a payable value. Ante never below the smallest denomination.
- Breaks placed at the first level boundary after each `everyMin` of play; never after the
  last buffer level; none if target ≤ 75 min unless custom.

## 5. Schedule validation
Errors: non-positive durations or blinds; SB not payable; non-increasing blinds; starting
stack < 10 BB; zero levels. Warnings: level length outside preset bounds; growth jump
> 2× in one level; starting depth < 30 BB or > 300 BB; scheduled-to-finish deviates from
target by > 20 %; ante larger than BB.

## 6. Edit operations (pure, with preview diff)
`setLevel(index, {sb,bb,ante,durationMin})`, `setAllLevelDurations(min, fromIndex)`,
`insertBreak(afterIndex, min)`, `removeBreak(index)`, `regenerateFrom(index)` (keeps earlier
segments, rebuilds later ones from current config), `extend(nLevels)` (for overtime).
Each returns `{ schedule, report, diff }`. Running-tournament rules in 03 §7.

## 7. Live extras
Average stack = `T / remainingPlayers`; show as chips and as BB at the current level.
Players remaining is set by the host (+/−), floor 1; reaching 1 prompts "Finish tournament?".

## 8. Required tests
Each preset × player counts {2, 6, 10} × durations {60, 120, 180, 240} produces a valid
schedule (property test). Ladder snapping table tests. Iterative break solve converges.
Overtime extension continues the progression. Saved schedule never changes when presets change.

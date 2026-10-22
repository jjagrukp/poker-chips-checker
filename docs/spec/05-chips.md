# 05 — Chip inventory and allocation

Game-agnostic domain in `features/chip-inventory/domain/`. No poker imports.

## 1. Model
```ts
interface ChipType {            // physical, reusable
  id: string; colour: string;   // display name, e.g. "Red"
  swatch: string;               // hex for UI swatch (picker), never the only identifier
  description?: string;         // "white edge spots"
  quantity: number;             // integer ≥ 0
  printedValue?: number;        // if the chip has a value printed on it
  referenceImage?: Blob;        // optional, user-chosen crop, stored locally only
  notes?: string; confirmed: boolean;
}
interface Inventory { id; schemaVersion; name; chipTypes: ChipType[]; updatedAt }
interface DenominationAssignment {         // per tournament, never mutates the inventory
  inventoryId: string; values: Record<ChipTypeId, number | null>; // null = not used
}
interface AllocationResult {
  perPlayer: Record<ChipTypeId, number>; stackValue: number; chipsPerPlayer: number;
  consumed: Record<ChipTypeId, number>; remaining: Record<ChipTypeId, number>;
  score: number; issues: Issue[];  // warnings like "only 6 low chips each"
}
```
Two chip types may share a colour (different designs). Two types may share a value.

## 2. Inventory review screen (shared by manual + AI routes)
Rows: swatch, colour name, description, quantity (stepper + numeric), value (per tournament),
used toggle, delete. Add row. A row is valid when quantity is an integer ≥ 0 and, if used,
has a positive integer value. "Confirm inventory" is disabled until every row is confirmed
(AI rows start unconfirmed and are visually marked). Saving creates/updates a reusable inventory.

## 3. Denomination suggestion
If values are unassigned, propose one of the standard sets, choosing the first whose size
fits the number of used types: [1,5,25,100,500], [25,100,500,1000,5000],
[5,25,100,500,1000], [25,50,100,500,1000]. Assign ascending values to types in descending
quantity order (most numerous = lowest value); `printedValue` overrides. Shown as a
suggestion; user confirms.

## 4. Allocation
Inputs: used chip types with values, `players`, target stack `S` (or "recommend"),
`firstSB`, `firstBB` (may be unknown in recommend mode → use `S / depth`).

Hard constraints:
1. `perPlayer[i] ≤ floor(quantity[i] / players)`.
2. Every player identical; `Σ perPlayer[i] × value[i] = S` exactly.
3. The smallest allocated denomination divides `firstSB`.

Search: depth-first over types sorted by value descending, with remaining-value pruning;
cap per-type count at `min(maxPerPlayer, 80)`; abort and return best-so-far after 200k
nodes (report it). Inventory ≤ 12 types (validation error above that).

Score (lower is better; weights in `allocation-weights.ts`, versioned):
- Physical chips per player outside 20–40: +2 per chip outside the band.
- Fewer than 8 chips of the smallest denomination: +10 per missing chip.
- Lowest denomination > firstSB: hard fail (constraint 3).
- Fewer than 3 denominations used (when ≥ 3 available): +15.
- "Pyramid" preference: more low chips than high chips by count; +3 per inversion.
- Any single type > 50 % of the chips per player: +10.
- Deterministic tie-break: lexicographic on the count vector (values descending).

No exact solution: return `impossible` with the binding reason (e.g. "Black chips: 50 for 9
players caps each player at 5") and up to 3 nearest feasible stacks (search `S ± k × smallest`
within ±25 %, prefer round numbers).

Recommend mode: evaluate candidate stacks from the nice set
{1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 50000}
scaled to the denominations; pick the best score whose starting depth fits the structure.
Explain the pick in one line.

Independent validator `validateAllocation(result, inventory, players)` re-checks every hard
constraint without sharing code with the search. The UI only accepts validated results.

## 5. Fixtures (assert validity, not specific vectors, unless hand-verified)
- Hand-verified: 4 players; white×100 @25, red×100 @100, green×50 @500; S = 5000.
  A valid allocation exists (e.g. 20 white, 20 red, 5 green = 45 chips).
- Classic 300 set: white 100, red 50, green 50, blue 50, black 50 for 2–10 players.
- Starved: 9 players, black×20 → explains the cap.
- Single colour, duplicate colours with different values, 12 types, zero quantities.
Property tests (fast-check): result never exceeds inventory, all stacks equal and exact,
validator agrees with search, output stable across runs.

## 6. Future colour-ups
Don't hard-code "chips in play" as fixed: allocation and Hold'em reference denominations via
the assignment, so a later colour-up step can remove a denomination mid-tournament.

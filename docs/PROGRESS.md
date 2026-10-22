# Progress

## Current state
Active milestone: M5
Status: not started
Last completed: M4
Open issues / follow-ups:
- Cross-layer imports must use the `@/` alias (see D10); boundary rules also ban dynamic import().
- complete/cancel leave the clock anchor as-is; freeze it (needs normalise with schedule) in M6/M8.
- `segment_started` isn't logged when a paused `next`/`previous` segment is later resumed (M6/M8 if actual duration needs it).
- Save every step via `repos.tournaments.commit({tournament, schedules?, events?, expectedClockRevision?})` (D16); pass the new snapshot from `applyScheduleEdit` in `schedules`.
- Composition root (M5) must pass `inventoryRecord` from chip-inventory/domain to `createRepositories`/`importBackup` (D15), and register `texasHoldemModule` (src/modules/texas-holdem/module.ts).
- UI must only accept allocations that pass `validateAllocation` (always pass `firstSB` or `startingDepthBB`); show `allocation.warning.searchTruncated` when `truncated`. Render issues with `t(key, tone, params)`.
- `recommendStack` can run many searches (≤ 200k nodes each); if slow on phones, move it to a worker in M5.
- M5 wizard: set `denominations`/`smallestDenomination` from the confirmed chip assignment, then `applyStructure(config)` on every players/stack/target/structure change (custom passes through). Show "Scheduled: … (target …)" via `holdem.summary.scheduled` + `summarise()`.
- Hold'em display text: `h`/`m` units (format.ts) and the " / " blinds separator aren't in the catalogue yet; move them when the UI renders them (M5).
- Running edits (M6): core `editSchedule` only checks ids of past/current segments, so `setLevel`/`setAllLevelDurations` on past indexes would pass; compare content or pass a locked-through index.
- Optional: validator warning when an edited level breaks the chip-clutter rule; clamp-warning copy suggests Gentle/Turbo even when already on it.
- `ChipType.referenceImage` deferred to M9 (D20).
- No UI yet for quarantine/durability notices, persist() result, backup or viewer mode (strings are in the catalogue): wire up in M6/M8/M10. `openDatabase` closes on `blocking`; reload notice in M10.

## Completed milestones
(one line each: `M<n> — <date> — <commit> — <one-line summary>`)
M0 — 2026-10-22 — "M0: scaffold…" — Vite/React/TS strict scaffold, ESLint boundaries, brand, theme tokens, messages, Home, unit + e2e smoke
M1 — 2026-10-22 — "M1: generic core…" — core types/schemas, module registry, lifecycle, derived clock + commands, events, mock rounds module; timer branch coverage ≥ 95%
M2 — 2026-10-22 — "M2: persistence…" — repo interfaces + IndexedDB impl, lazy migrations, quarantine, atomic per-tournament commits, JSON backup, persist(), Web Locks controller + BroadcastChannel
M3 — 2026-10-22 — "M3: chips & allocation" — inventory model + record, denomination suggestion, DFS allocation with scoring, impossible reasons + nearest stacks, recommend mode, independent validator, fast-check properties
M4 — 2026-10-22 — "M4: Hold'em module" — config + presets, blind ladder (nice values, payability, chip-clutter), duration model with break solve, generator, validator, pure edits with diff, property tests

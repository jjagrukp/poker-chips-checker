# Progress

## Current state
Active milestone: M4
Status: not started
Last completed: M3
Open issues / follow-ups:
- Cross-layer imports must use the `@/` alias (see D10); boundary rules also ban dynamic import().
- complete/cancel leave the clock anchor as-is; freeze it (needs normalise with schedule) in M6/M8.
- `segment_started` isn't logged when a paused `next`/`previous` segment is later resumed (M6/M8 if actual duration needs it).
- Save every step via `repos.tournaments.commit({tournament, schedules?, events?, expectedClockRevision?})` (D16); pass the new snapshot from `applyScheduleEdit` in `schedules`.
- Composition root (M5) must pass `inventoryRecord` from chip-inventory/domain to `createRepositories`/`importBackup` (D15).
- UI must only accept allocations that pass `validateAllocation` (always pass `firstSB` or `startingDepthBB`); show `allocation.warning.searchTruncated` when `truncated`. Render issues with `t(key, tone, params)`.
- `recommendStack` can run many searches (≤ 200k nodes each); if slow on phones, move it to a worker in M5.
- `ChipType.referenceImage` deferred to M9 (D20).
- No UI yet for quarantine/durability notices, persist() result, backup or viewer mode (strings are in the catalogue): wire up in M6/M8/M10. `openDatabase` closes on `blocking`; reload notice in M10.

## Completed milestones
(one line each: `M<n> — <date> — <commit> — <one-line summary>`)
M0 — 2026-10-22 — "M0: scaffold…" — Vite/React/TS strict scaffold, ESLint boundaries, brand, theme tokens, messages, Home, unit + e2e smoke
M1 — 2026-10-22 — "M1: generic core…" — core types/schemas, module registry, lifecycle, derived clock + commands, events, mock rounds module; timer branch coverage ≥ 95%
M2 — 2026-10-22 — "M2: persistence…" — repo interfaces + IndexedDB impl, lazy migrations, quarantine, atomic per-tournament commits, JSON backup, persist(), Web Locks controller + BroadcastChannel
M3 — 2026-10-22 — "M3: chips & allocation" — inventory model + record, denomination suggestion, DFS allocation with scoring, impossible reasons + nearest stacks, recommend mode, independent validator, fast-check properties

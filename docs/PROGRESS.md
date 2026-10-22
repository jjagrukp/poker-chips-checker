# Progress

## Current state
Active milestone: M3
Status: not started
Last completed: M2
Open issues / follow-ups:
- Cross-layer imports must use the `@/` alias (see D10); boundary rules also ban dynamic import().
- complete/cancel leave the clock anchor as-is; freeze it (needs normalise with schedule) in M6/M8.
- `segment_started` isn't logged when a paused `next`/`previous` segment is later resumed (M6/M8 if actual duration needs it).
- Save every step via `repos.tournaments.commit({tournament, schedules?, events?, expectedClockRevision?})` (D16); pass the new snapshot from `applyScheduleEdit` in `schedules`.
- M3 must define the inventory `RecordType` in chip-inventory/domain and pass it to `createRepositories`/`importBackup` from the composition root (D15); tests use `testInventoryRecord`.
- No UI yet for quarantine/durability notices, persist() result, backup or viewer mode (strings are in the catalogue): wire up in M6/M8/M10. `openDatabase` closes on `blocking`; reload notice in M10.

## Completed milestones
(one line each: `M<n> — <date> — <commit> — <one-line summary>`)
M0 — 2026-10-22 — "M0: scaffold…" — Vite/React/TS strict scaffold, ESLint boundaries, brand, theme tokens, messages, Home, unit + e2e smoke
M1 — 2026-10-22 — "M1: generic core…" — core types/schemas, module registry, lifecycle, derived clock + commands, events, mock rounds module; timer branch coverage ≥ 95%
M2 — 2026-10-22 — "M2: persistence…" — repo interfaces + IndexedDB impl, lazy migrations, quarantine, atomic per-tournament commits, JSON backup, persist(), Web Locks controller + BroadcastChannel

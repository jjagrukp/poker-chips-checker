# Progress

## Current state
Active milestone: M2
Status: not started
Last completed: M1
Open issues / follow-ups:
- Cross-layer imports must use the `@/` alias (see D10); boundary rules also ban dynamic import().
- complete/cancel leave the clock anchor as-is; freeze it (needs normalise with schedule) in M6/M8.
- `segment_started` isn't logged when a paused `next`/`previous` segment is later resumed (M6/M8 if actual duration needs it).
- Persist schedule snapshots via `applyScheduleEdit` (sets `scheduleId`); M2 must store the new snapshot alongside.

## Completed milestones
(one line each: `M<n> — <date> — <commit> — <one-line summary>`)
M0 — 2026-10-22 — "M0: scaffold…" — Vite/React/TS strict scaffold, ESLint boundaries, brand, theme tokens, messages, Home, unit + e2e smoke
M1 — 2026-10-22 — "M1: generic core…" — core types/schemas, module registry, lifecycle, derived clock + commands, events, mock rounds module; timer branch coverage ≥ 95%

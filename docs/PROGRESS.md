# Progress

## Current state
Active milestone: M6
Status: not started
Last completed: M5
Open issues / follow-ups:
- Cross-layer imports must use the `@/` alias (see D10); boundary rules also ban dynamic import().
- complete/cancel leave the clock anchor as-is; freeze it (needs normalise with schedule) in M6/M8.
- `segment_started` isn't logged when a paused `next`/`previous` segment is later resumed (M6/M8 if actual duration needs it).
- Save every step via `repos.tournaments.commit({tournament, schedules?, events?, expectedClockRevision?})` (D16).
- M6 entry point: `/tournament/:id` renders `ReadyScreen` (features/tournament-setup/ui); replace with the clock for
  ready/active (it shows "ready" copy for every non-draft status). Lifecycle `start` needs the saved schedule
  (`tournament.scheduleId`); `tournament.allocation` is a `StoredAllocation` (parse it); `plannedStartAt` is set in step 1.
- Services: `useServices()` (src/app/services.ts) gives repos + ModuleContext; tone via `useT()` (shared/messages/tone).
  Component tests use `renderApp()` (src/app/testing) — plain MemoryRouter, since data routers break under jsdom.
- Running edits (M6): core `editSchedule` only checks ids of past/current segments, so `setLevel`/`setAllLevelDurations`
  on past indexes would pass; compare content or pass a locked-through index. ScheduleTable has an `editor` prop to reuse.
- Optional: validator warning when an edited level breaks the chip-clutter rule; clamp-warning copy suggests Gentle/Turbo even when already on it.
- `ChipType.referenceImage` deferred to M9 (D20); photo route plugs into ChipsStep + InventoryReview (rows start unconfirmed).
- No UI yet for quarantine/durability notices, persist() result, backup, settings or viewer mode (strings are in the
  catalogue): wire up in M6/M8/M10. `openDatabase` closes on `blocking`; reload notice in M10.
- `recommendStack` runs on the main thread (fine in tests); move to a worker if slow on phones.
- Most new setup copy is plain (tone-neutral); add playful variants where it helps (M10 copy pass).

## Completed milestones
(one line each: `M<n> — <date> — <commit> — <one-line summary>`)
M0 — 2026-10-22 — "M0: scaffold…" — Vite/React/TS strict scaffold, ESLint boundaries, brand, theme tokens, messages, Home, unit + e2e smoke
M1 — 2026-10-22 — "M1: generic core…" — core types/schemas, module registry, lifecycle, derived clock + commands, events, mock rounds module; timer branch coverage ≥ 95%
M2 — 2026-10-22 — "M2: persistence…" — repo interfaces + IndexedDB impl, lazy migrations, quarantine, atomic per-tournament commits, JSON backup, persist(), Web Locks controller + BroadcastChannel
M3 — 2026-10-22 — "M3: chips & allocation" — inventory model + record, denomination suggestion, DFS allocation with scoring, impossible reasons + nearest stacks, recommend mode, independent validator, fast-check properties
M4 — 2026-10-22 — "M4: Hold'em module" — config + presets, blind ladder (nice values, payability, chip-clutter), duration model with break solve, generator, validator, pure edits with diff, property tests
M5 — 2026-10-22 — "M5: setup wizard…" — six-step wizard with draft auto-save + resume, inventory review, recommended/custom stack with nearest alternatives, structure presets + advanced + per-level edits, review → ready, e2e

# Progress

## Current state
Active milestone: M10
Status: not started
Last completed: M9
Open issues / follow-ups:
- Cross-layer imports must use the `@/` alias (see D10); boundary rules also ban dynamic import().
- Save every step via `repos.tournaments.commit({tournament, schedules?, events?, expectedClockRevision?})` (D16).
- Live clock (D26) + alerts (D27): `ClockPlatform` now also carries `audio` + `notifier` (fakes in live-clock/testing).
  Alert prefs UI is the "Sound & alerts" panel (`AlertSettings`) — reuse it in the M10 Settings screen.
- Alerts: background tabs under Chrome's 1-min throttling mark alerts missed (no sound/notification); consider
  notifying for bounded gaps while hidden. With waitForHost, no chime when the host resumes (only breakEnd at deadline).
- Alerts a11y: alert banner mounts with text (role=alert) — consider a persistent live region; Sound & alerts panel
  doesn't move/return focus. Missing tests: queued-audio cancel on pause, viewer silence, take-control dedupe.
- Ad-hoc break start has no alert (host pressed it). Overtime has no alert at schedule end. No e2e for alerts yet (M10).
- `segment_started` isn't logged when a paused `next`/`previous` segment is later resumed.
- Results (D28): ResultsScreen saves via `repos.tournaments.commit` directly (no store/broadcast; last write wins
  across tabs). Duplicate keeps the source's confirmed inventory snapshot even if that chip set changed since.
  Library: focus isn't returned after Cancel/Delete. No inventory edit screen yet (spec 01 §5 #3) — M10 if needed.
- e2e live-clock spec is skipped on WebKit (navigation hangs under `page.clock` after fastForward): revisit in M10.
- Overtime "Add levels" adds 3 levels; level count isn't configurable yet.
- Optional: validator warning when an edited level breaks the chip-clutter rule; clamp-warning copy suggests Gentle/Turbo even when already on it.
- AI photo (D29, D30): `api/*` handlers have no host entry point yet — M11 adds the adapter (Cloudflare Pages
  Function) that supplies `fetch`, a durable `RateLimiter` (in-memory is per instance) and a trusted `clientIp`.
  Privacy notes are inline (`<details>`); link the M11 known-limitations/privacy page. PhotoImport a11y (M10): focus
  isn't moved when the picker swaps to the busy state/back. "Try another photo" appends a second set of unconfirmed
  rows (doesn't replace the first). Real-model prompt/quality untested (no API calls in CI) — check in M11 test night.
- No UI yet for quarantine/durability notices, persist() result, backup, settings (strings are in the
  catalogue): wire up in M10. `openDatabase` closes on `blocking`; reload notice in M10.
- `recommendStack` runs on the main thread (fine in tests); move to a worker if slow on phones.
- Most new copy is plain (tone-neutral); add playful variants where it helps (M10 copy pass).
- `catalogue.ts` isn't Prettier-clean at HEAD (pre-existing); a format pass would reflow ~12 unrelated strings.

## Completed milestones
(one line each: `M<n> — <date> — <commit> — <one-line summary>`)
M0 — 2026-10-22 — "M0: scaffold…" — Vite/React/TS strict scaffold, ESLint boundaries, brand, theme tokens, messages, Home, unit + e2e smoke
M1 — 2026-10-22 — "M1: generic core…" — core types/schemas, module registry, lifecycle, derived clock + commands, events, mock rounds module; timer branch coverage ≥ 95%
M2 — 2026-10-22 — "M2: persistence…" — repo interfaces + IndexedDB impl, lazy migrations, quarantine, atomic per-tournament commits, JSON backup, persist(), Web Locks controller + BroadcastChannel
M3 — 2026-10-22 — "M3: chips & allocation" — inventory model + record, denomination suggestion, DFS allocation with scoring, impossible reasons + nearest stacks, recommend mode, independent validator, fast-check properties
M4 — 2026-10-22 — "M4: Hold'em module" — config + presets, blind ladder (nice values, payability, chip-clutter), duration model with break solve, generator, validator, pure edits with diff, property tests
M5 — 2026-10-22 — "M5: setup wizard…" — six-step wizard with draft auto-save + resume, inventory review, recommended/custom stack with nearest alternatives, structure presets + advanced + per-level edits, review → ready, e2e
M6 — 2026-10-22 — "M6: live clock" — clock screen + controls/keyboard, recovery summary, overtime add-levels preview, ad-hoc breaks, running edits (past locked), wake lock, fullscreen, viewer tabs, players + avg stack
M7 — 2026-10-22 — "M7: audio & alerts" — pure alert planner (live vs gap, keyed dedupe), Web Audio synth with 15 s look-ahead, Sound & alerts panel (toggles, volume, test, flash, notifications), visual banners, completion sound
M8 — 2026-10-23 — "M8: results & presets" — results screen (positions, editable actual duration), save as preset, duplicate, new tournament with same chips, Home library (resume, results, presets, chip sets, delete with confirm)
M9 — 2026-10-23 — "M9: AI chip photo" — Web Fetch endpoint (size/magic-byte/origin checks, per-IP + daily cap, strict tool + Zod, 25 s + one retry), /api/config flag, client downscale + EXIF strip, photo panel → unconfirmed review rows, manual fallback on every failure

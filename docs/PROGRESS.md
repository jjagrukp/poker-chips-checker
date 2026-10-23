# Progress

## Current state
Active milestone: M11
Status: code complete, committed. Left for the host (needs their Cloudflare account): run docs/DEPLOY.md
(D1 create + id into wrangler.toml, migrations, secret, deploy), `npm run check:api -- <url>`, then docs/TEST-NIGHT.md.
Last completed: M10
Open issues / follow-ups:
- Cross-layer imports must use the `@/` alias (see D10); boundary rules also ban dynamic import().
- Save every step via `repos.tournaments.commit({tournament, schedules?, events?, expectedClockRevision?})` (D16).
- AI photo: provider switchable (D34); compare Claude vs Gemini and real-model quality on test night.
- Rate limiter (D35): IP hash is unsalted (rows live ≤ 1 day; consider an HMAC secret); a D1 fault reports as
  `upstream`; check-api doesn't test missing/null Origin; placeholder `database_id` fails deploy until replaced.
- Alerts: background tabs under Chrome's 1-min throttling mark alerts missed; no chime on waitForHost resume;
  ad-hoc break start and overtime have no alert. Banner is role=alert on mount (no persistent live region).
- Tab locks release on `pagehide` (WebKit held navigations); a back/forward-cache restore reloads the page.
- `segment_started` isn't logged when a paused `next`/`previous` segment is later resumed.
- Results save directly via `repos.tournaments.commit` (last write wins across tabs). No dedicated inventory edit
  screen: chip sets are edited by reusing them in the wizard (confirm updates the same id, D25).
- Overtime "Add levels" adds 3 levels (not configurable). `recommendStack` runs on the main thread.
- Not Prettier-clean at HEAD (pre-existing): catalogue.ts, analyse-chips(.test).ts, vision-providers.ts,
  SettingsScreen(.test).tsx, StorageNotices.tsx, tests/e2e/acceptance.spec.ts.

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
M10 — 2026-10-23 — "M10: hardening" — PWA offline shell, Settings (tone, alerts, break-end default, backup/import/delete all, storage status, limitations), durability/quarantine/update notices, CSP headers, focus fixes, e2e acceptance matrix on Chromium + WebKit
M11 — 2026-10-23 — "M11: deploy" — Cloudflare Pages adapter (D1 atomic rate limiter, CF-Connecting-IP, /api headers + HSTS, JSON 404), wrangler.toml + migration, bundle-secret check, live API/burst check, /limitations page, DEPLOY + TEST-NIGHT docs (host still to deploy)

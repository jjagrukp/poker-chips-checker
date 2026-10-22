# Roadmap

Each milestone lists the spec files to read. Read nothing else from `docs/spec/` unless blocked.
Persistence moved earlier than the original plan because timer recovery depends on it.

| # | Milestone | Read | Exit criteria |
|---|-----------|------|---------------|
| M0 | Scaffold | 01, 02 §1–3 | Vite/React/TS strict app runs; ESLint (incl. import boundary rule), Prettier, Vitest, Playwright configured; brand config + theme tokens + message catalogue (playful/neutral); Home screen with placeholder title/logo; one passing unit test and one passing e2e smoke test. |
| M1 | Generic core | 02, 03 §1–4 | Core types, module registry, lifecycle service with transition table, pure `deriveClock` + clock commands, event log types, `Clock` interface. Mock rounds/points module (tests only) registers, validates, generates a schedule and runs through `deriveClock`. ≥ 95% branch coverage on `src/core/timer`. |
| M2 | Persistence | 02 §7 | Repository interfaces + IndexedDB implementation, schema versioning + migration runner, corrupted-record quarantine, JSON export/import, `navigator.storage.persist()` request, multi-tab controller lock. Mock-module tournament round-trips through storage. |
| M3 | Chips & allocation | 05 | Inventory model, denomination assignment, denomination suggestion, allocation engine, recommended-stack search, independent validator, property tests (fast-check). |
| M4 | Hold'em module | 04 | Config + validation, duration model, blind ladder, antes, breaks, schedule generator (versioned presets), schedule validator, pure schedule-edit operations with preview. |
| M5 | Setup wizard | 01 §5, 04 §2, 05 §2 | Wizard steps 1–6 with manual inventory, draft auto-save, back-navigation without data loss, review screen with warnings. Tournament reaches `ready`. |
| M6 | Live clock | 03, 01 §6 | Clock screen + controls, recovery with catch-up summary, overtime handling, ad-hoc breaks, break-end behaviour, wake lock, fullscreen, read-only viewer tabs, players-remaining + average stack. |
| M7 | Audio & alerts | 03 §6 | Web Audio synthesised alerts, pre-scheduled countdown, alert preferences, test sound, dedupe, visual equivalents, optional notifications. |
| M8 | Results & presets | 02 §6, 01 §5 | Completion flow, finishing positions, actual duration, presets, duplicate tournament, reuse inventory, delete tournament/inventory. |
| M9 | AI chip photo | 06 | Serverless endpoint, client downscale/EXIF strip, schema validation, review UI merging into the normal inventory screen, all failure paths fall back to manual entry, feature flag hides AI when disabled. |
| M10 | Hardening | 07 | PWA offline shell, full e2e matrix, axe checks, responsive review, security/privacy review, all acceptance criteria in 07 §3 green. |
| M11 | Deploy | 06 §5, 07 §4 | Hosted, env vars set, rate limits verified, known-limitations page, real poker-night test checklist written. |

Recommended model per milestone (main session): Opus for M1, M3, M4, M6 (design-heavy,
use plan mode first); Sonnet for everything else.

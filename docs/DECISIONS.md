# Decisions (ADR-lite)

Format: `D<n> — <title>` · Decision · Why · Revisit if. Keep each ≤ 5 lines.

D1 — Frontend stack
Vite + React 18 + TypeScript strict, Tailwind v4, React Router, Zustand for UI state only.
Why: fast, well-known, small. Domain logic is framework-free so the UI layer is swappable.

D2 — Validation
Zod for persisted records, AI responses, module configs and import files.
Why: one library for runtime validation + inferred types.

D3 — Storage
IndexedDB via `idb` (tiny wrapper). Settings also in IndexedDB (one store) — no localStorage,
so there's a single persistence path to test.

D4 — Timer model
Derived timer: persisted `ClockAnchor` + schedule → `deriveClock(now)`. No tick counting.
Not full event sourcing: the anchor is the source of truth; events are an audit log.

D5 — Lifecycle vs clock status
Lifecycle (`draft|ready|active|completed|cancelled`) is separate from clock status
(`running|paused`) and segment kind (`level|break`). The original spec's `paused`/`break`
lifecycle states made "paused during a break" unrepresentable.

D6 — AI provider
Anthropic Messages API with a vision-capable model, model ID from env `CHIP_VISION_MODEL`
(default to the current Haiku-class model for cost). Forced tool-use for structured output.

D7 — Hosting
Static site + one function written as a standard Web Fetch handler (`(Request) => Response`)
so it runs on Cloudflare Pages Functions, Vercel or Netlify. Default target: Cloudflare Pages.

D8 — Audio
Synthesise alert tones with Web Audio (oscillators/envelopes). No audio files to license or ship.

D9 — Testing
Vitest + fast-check (property tests for allocation/schedules), Playwright with `page.clock`
for time travel, @axe-core/playwright for accessibility. Browsers: Chromium + WebKit
(mobile Safari emulation). Firefox added in M10 only if time allows.

D10 — Tooling and import boundaries
ESLint flat config: typescript-eslint strict, react-hooks, react-refresh, jsx-a11y, prettier.
Boundaries use `no-restricted-imports`: cross-layer imports must use `@/` (relative `../` out of a
layer banned per depth; non-normalised/root paths and dynamic import banned); forbidden `@/`
targets banned. Core also bans ambient time/timers. Component tests: Testing Library + jsdom.
Why: no resolver plugin needed; relative paths are ambiguous (core/modules vs src/modules).

D11 — Coverage tooling
`@vitest/coverage-v8` (pinned to the Vitest version) for the M1 ≥ 95% branch gate on
`src/core/timer` (`npm run test:coverage`). Why: zero-config with Vitest; no Istanbul build step.

D12 — Test-only modules outside src
`tests/fixtures` + `tests/integration` compile under `tsconfig.app.json` (need `@/`), and Vitest
includes `tests/integration/**/*.test.ts`. Core unit-test helpers live in `src/core/testing/`
(coverage-excluded). Why: fixtures must never ship, but must type-check against core.

D13 — Clock model details (refines 03)
`awaitingHost` is a paused anchor with `holdAtIndex === segmentIndex`. Clock went backwards
> 5 s → `deriveClock` freezes at `updatedAt` and sets `clockWentBackwards`. Lifecycle `start`
creates an idle anchor; the clock `start` command runs it. `endBreak` always resumes play.
Pausing in overtime drops the overtime count. Completion is a `lifecycle_transition` event.

D14 — Opaque cross-layer types in core
`Tournament.allocation` and `GameModule.allocate` inventory/result are `unknown` in core because
their types live in chip-inventory/domain, which core may not import. Modules narrow them.

D15 — Persistence shape (refines 02 §7)
`RecordType<T>` (name, version, schema, migrations) per record; `migrateRecord` is pure, the IDB
layer writes migrated records back and quarantines failures in the same transaction. Inventory's
RecordType is injected by the composition root (core can't see chip-inventory). DB name fixed
(`tournament-platform`), not branded. `fake-indexeddb` (dev) for repo tests. Why: core stays pure.
Write-back stores the parsed value, so Zod strips unknown keys: migrations must map every field.

D16 — Atomic tournament writes
`TournamentRepo.commit({tournament, schedules?, events?, expectedClockRevision?})` writes all in one
transaction, serialised per tournament id (keyed promise queue); event `seq` assigned in that tx.
`expectedClockRevision` is the no-Web-Locks fallback guard; mismatch → `{ok:false, conflict}`.
Any failure aborts the tx. `seq` orders events per tournament; it may be reused after quarantine.

D17 — Backup import rules
All-or-nothing (any invalid record or write error imports nothing). Id clash → new id with
references (scheduleId, inventoryId, schedule_edited ids, event tournamentId) remapped. Settings
are a singleton: existing settings win. Export collects schedules referenced by tournaments/events.

D18 — Tab roles
Viewers queue on the Web Lock and become controller automatically when it's released; "Take
control" uses `steal`. BroadcastChannel messages carry no data — viewers re-read from IndexedDB.

D19 — Allocation details (refines 05 §3–4)
Unknown firstSB: smallest allocated value ≤ stack / (2 × depth), depth default 100 BB. Recommend:
nice set tried per scale (×1, ×0.1, ×10, …), first scale with a valid stack wins; ties → smaller stack;
known BB must give 50–200 BB. Nearest stacks step by the values' gcd, not the smallest chip, and use an
exact knapsack check (also tells "impossible" from "node limit"). >5 types to value → extended set.

D20 — Chip reference images deferred
`ChipType.referenceImage` (Blob) is left out until M9: Blobs don't survive the JSON backup and would make
all-or-nothing import fail. M9 decides storage (separate store or data URL) with a migration.

D21 — Hold'em config carries denominations
`HoldemConfig.denominations` (strictly increasing, first = `smallestDenomination`) added to spec 04 §1
so the chip-clutter rule knows the next chip up (SB multiple of lcm(smallest, next) once BB ≥ 40 ×
smallest). No config `schemaVersion`: the tournament record is versioned; `migrateConfig` uses moduleVersion.

D22 — Hold'em ladder and duration details (refines 04 §3–4)
Levels-to-finish = length of the snapped ladder to BB ≥ T/20 (not the log formula), so plan and schedule
agree. Nice BB must be within ×1.5 of ideal, else nearest payable multiple. Breaks: after a level once
play since the last break ≥ everyMin. Clamp warning only if needed length is >10 % outside bounds.
Edits get a new schedule id; segment ids are `ctx.newId()`; `extend` adds no breaks.

D23 — Setup wizard state and routes
Wizard state lives on the draft tournament: `Tournament.setupDraft` (opaque `unknown` in core, parsed by
`SetupDraftSchema` in features/tournament-setup) plus optional `plannedStartAt`; additive optional fields, so no
schemaVersion bump. Per-wizard Zustand vanilla store saves after every change (serialised, coalesced). Routes:
`/setup/:id/:step`, `/tournament/:id`. Hold'em-specific steps live in the feature (only module); revisit with a 2nd game.

D24 — Ladder denominations come from the chips handed out
After a stack is accepted, `denominations` = values with perPlayer > 0 (before that: the confirmed assignment), so the
first SB is payable with chips actually in play and `validateAllocation({firstSB})` agrees. Stack search aims at the
structure's preset depth (custom: stack ÷ BB). Players/inventory changes clear the stack; a later structure change
keeps it (re-checked against the new first SB) rather than sending the host back to step 4.

D25 — Inventory rows as text
Review rows keep quantity/value as typed text (`ChipRow`, chip-inventory/ui) so a half-typed row never corrupts the
saved draft; `toInventory` maps bad text to NaN for `validateInventory`. Confirming writes the reusable inventory
(same id when picked from a saved set, so it updates it). Components use Testing Library `fireEvent` (no user-event dep).

D26 — Live clock wiring
One Zustand vanilla store per mounted tournament (`features/live-clock`) owns loading, the tab lock and a serial
write queue; every write commits with `expectedClockRevision`, conflicts reload. Browser APIs (lock, channel,
`performance.now`, wake lock) come in as a `ClockPlatform` from the composition root, so tests inject fakes. Ticker:
250 ms interval, re-renders on `displayKey` change. Some browsers stop `performance.now` during sleep, so a forward
wall-clock jump is treated as a wake (→ recovery) and only a backward jump re-anchors (core `reanchor`); a forward
manual clock change mid-session is trusted, like the closed-app limitation. Complete/cancel freeze the anchor.
Mute is `Settings.alertsMuted` (optional, no version bump) until M7's alert preferences.

## Open questions (resolve when reached, record answer above)
- Q1: Abuse protection for the AI endpoint beyond IP rate limiting — add Cloudflare
  Turnstile? (Decide in M9; default: rate limit + daily global cap only.)
- Q2: Product name/logo (out of scope for engineering; brand config stays swappable).

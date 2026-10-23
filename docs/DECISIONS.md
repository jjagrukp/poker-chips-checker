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

D27 — Alert engine details (refines 03 §6)
Keys are `${segmentId}:${type}:${at}` so a restarted level / extended break alerts again but a refresh doesn't;
plans start at `max(prevTick, anchor.updatedAt)` (no alert on resume). Every enabled sound ≤ 15 s ahead is queued on
the AudioContext (cancelled on revision/mute/pref change or a ≥ 2 s gap). Only the controller sounds, notifies and
persists `Tournament.firedAlerts` (pruned after 10 min); viewers show banners with in-memory dedupe. Prefs live in
`Settings.alerts` (additive, no version bump); mute stays `alertsMuted`. Complete sounds only when this tab ends it.

D28 — Results and reuse (refines 02 §6)
Actual duration = start → complete/cancel transition events (wall time, pauses included; falls back to
startedAt/endedAt), host-editable in whole minutes. Positions list every place 1…count, names optional. A preset
stores the full HoldemConfig but applying it copies only players/duration/structure fields; stack and chips come
from the new inventory. Duplicate copies config + setupDraft (edited schedules renumbered, else regenerated).

D29 — No chip reference images (closes D20)
The photo is never stored (spec 06 §1), so `ChipType.referenceImage` is dropped rather than added: no Blob store,
no migration, and backups stay pure JSON. Photo proposals become unconfirmed `ChipRow`s; `ChipRow.checkCount`
(optional, no version bump) flags an AI-estimated count until the host edits it or marks the row as right.
After the canvas re-encode the client also strips APP1/APP13/COM segments: Safari's encoder writes its own EXIF.

D30 — AI endpoint details (refines 06 §2, D6; resolves Q1)
Raw `fetch` to the Messages API (no SDK dependency; the handler stays a plain Web Fetch function). Structured output
via a `strict: true` tool with `tool_choice: auto` + a system instruction, not forced tool use: current Opus/Sonnet
models reject forced `tool_choice`, and `CHIP_VISION_MODEL` may name any model. Default model `claude-haiku-5-5`.
Q1: no Turnstile; per-IP hourly limit + global daily cap behind a `RateLimiter` interface. The in-memory one is
per instance, so M11 swaps in a durable store (e.g. KV). A Vite plugin serves `/api/*` in dev/preview.

D31 — PWA offline shell
`vite-plugin-pwa` 1.3.0 (dev dep; generateSW/Workbox): precaches the build, SPA fallback to index.html, `/api/*` never
cached, so AI needs the network. `registerType: 'prompt'`: a new version shows a "Reload" banner and never reloads by itself
mid-clock. PNG icons rendered from logo.svg (192/512/maskable/apple-touch). Install button only where `beforeinstallprompt`
exists; iOS gets the Share → Add to Home Screen hint. A DB `blocking` event closes the connection and shows a reload alert.

D32 — Settings and data tools
Settings is a feature screen (`/settings`); the app passes a `DataTools` object (export/import/quarantine export/delete all)
built in the composition root, so the UI never sees the database. "Delete all data" clears every store but `meta` in one tx.
`Settings.breakEndDefault` (additive, no version bump) seeds new drafts; presets/duplicates keep their own behaviour. The
Settings "About and limitations" list is the in-app limitations text; M11 links/extends it.

D33 — Security headers
One source (`api/security-headers.ts`) for a strict CSP (`'self'` only; images also blob:/data:), nosniff, no-referrer,
Permissions-Policy and COOP. The build emits Cloudflare Pages `_headers`; `vite preview` sends the same, so e2e runs under it.
`_headers` doesn't cover Function responses: the M11 host adapter adds nosniff/no-referrer to `/api/*` (and HSTS).

D34 — Switchable vision provider (refines D6, D30)
`AI_PROVIDER=gemini|anthropic` (default anthropic; unknown → feature off). `api/vision-providers.ts` only shapes the request
and extracts the analysis; checks, retry, deadline and Zod stay in the handler. Gemini: raw `generateContent` (no SDK), key
in `x-goog-api-key` (never the URL), `responseJsonSchema` = the same report schema, only `finishReason: STOP` accepted.
Default `gemini-3.8-flash`. Needs a paid key: free-tier data may be used by Google, which breaks the "never stored" promise.

D35 — Cloudflare Pages host adapter (closes D30's M11 item)
`functions/api/*` re-export `api/cloudflare.ts`. Client IP = `CF-Connecting-IP` (set by the edge). Durable limiter = D1
(strongly consistent; KV is eventually consistent and 1 write/s per key, so a burst would overshoot): atomic
`INSERT … ON CONFLICT … RETURNING` counters in fixed hour/day windows, IPs SHA-256 hashed, pruned on each new day. No
`RATE_LIMIT_DB` binding → AI reported off. `_middleware` adds nosniff/no-referrer/CSP/HSTS to `/api/*`; `_headers` adds
HSTS (no includeSubDomains). Wrangler runs via `npx` (not a dependency). `postbuild` greps `dist` for keys.

D36 — Gemini thinking level low (refines D34)
Real photos hit the 25 s budget (504 timeout) with Gemini's default thinking. The request sets
`generationConfig.thinkingConfig.thinkingLevel = "low"` (`minimal` isn't supported on every model). Chip
identification needs little reasoning; the 25 s budget stays.

D37 — Photo counting from side-on stacks (refines spec 06 §1.7, §3)
The old "one stack per colour, top-down" tip hid every chip but the top one, so counts were always null.
Tip now asks for side-on stacks or flat, non-overlapping chips; the prompt counts edges per stack and sets
confidence (high = each chip counted clearly, medium = edges counted, may be off by a few). Prefill rule
unchanged: high/medium only, always flagged "check count".

D38 — Photo input without `capture` (refines spec 06 §1.2)
`capture="environment"` made iOS open the camera only, so saved photos couldn't be chosen. Plain
`accept="image/*"` gives the OS menu (library, camera, files) on iOS and Android.

D39 — Photo timeouts 45 s server / 55 s client (supersedes the 25 s / 30 s in spec 06 and D36)
With D37's edge counting, Gemini Flash hit the 25 s budget again (504 at 25 025 ms). Server budget is now
45 s (retry still inside it); client waits 55 s so the server's JSON timeout reply wins. Pages Functions
have no wall-clock limit while awaiting the model. Cost: a slow failure is billed for longer.

D40 — One row per chip type from a photo (refines spec 06 §1.6)
Models listed each stack as its own type ("Second blue stack"). The prompt now asks for one entry per
type with the total count, and the client also combines proposals with the same colour, extra colours,
pattern and printed value: counts summed (null if any is null), lowest confidence kept, notes joined.
Different patterns or values stay separate, so lookalike types aren't merged.

D41 — Whole-set photos (refines spec 06 §1, §3)
Real photos are often a full case: one type in several rows/slots plus loose sample chips, next to a
dealer button, cards and dice. The prompt totals a type across all places, carries a printed value from
any chip to its type, and ignores buttons/markers/cards/dice. The photo panel says so up top, and shows a
decorative spinner (aria-hidden; the status text stays the announcement) while preparing and analysing.

D42 — Screen share relay (spec 08; host-approved exception to "no cloud DB")
Phone and TV are different devices, so they need a server in the middle (WebRTC still needs signalling
and fails behind many NATs). Opt-in only: the phone pushes its latest snapshot to `/api/screens/:code`
(D1 `screens`, 24 h expiry, write key stored hashed); the TV polls every 2 s and derives the clock itself,
so a sleeping phone doesn't stop it. Phone stays source of truth. 8-char code (~40 bits) typed on a TV
remote; no QR (would be a new dependency, and TVs can't scan). Share keys live in localStorage.

D43 — Visual design system (spec 09)
New dependencies: @fontsource-variable/bricolage-grotesque, @fontsource-variable/manrope,
@fontsource/barlow-condensed (OFL, self-hosted woff2 bundled by Vite: offline-safe, no third-party
requests, CSP unchanged). Icons are hand-written inline SVG (no icon library). Restyle keeps every
accessible name and role, so existing tests stay the contract.

## Open questions (resolve when reached, record answer above)
- Q1: resolved in D30.
- Q2: Product name/logo (out of scope for engineering; brand config stays swappable).

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

## Open questions (resolve when reached, record answer above)
- Q1: Abuse protection for the AI endpoint beyond IP rate limiting — add Cloudflare
  Turnstile? (Decide in M9; default: rate limit + daily global cap only.)
- Q2: Product name/logo (out of scope for engineering; brand config stays swappable).

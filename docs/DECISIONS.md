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

## Open questions (resolve when reached, record answer above)
- Q1: Abuse protection for the AI endpoint beyond IP rate limiting — add Cloudflare
  Turnstile? (Decide in M9; default: rate limit + daily global cap only.)
- Q2: Product name/logo (out of scope for engineering; brand config stays swappable).

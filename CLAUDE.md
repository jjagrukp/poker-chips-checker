# CLAUDE.md — Tournament Platform

Local-first web app for running home Texas Hold'em freezeout tournaments, built on a
game-agnostic core. Product name is UNDECIDED: all branding comes from `src/app/configuration/brand.ts`.

## How to work in this repo (read this every session)

1. Read `docs/PROGRESS.md` first. It says which milestone is active and what's left.
2. Read ONLY the spec files listed for the active milestone in `docs/ROADMAP.md`.
   Do not read the whole `docs/spec/` folder. Do not re-read files already in context.
3. Check `docs/DECISIONS.md` before making an architectural choice. If a choice isn't
   covered, make the simplest reasonable one, record it there (3–5 lines), and continue.
   Only stop and ask if the choice is expensive to reverse.
4. Implement only the active milestone's scope.

## Token discipline (mandatory)

- Never run test/lint/typecheck/e2e commands yourself in the main thread. Delegate to the
  `test-runner` subagent and tell it exactly what to run (e.g. "unit tests for
  src/core/timer only"). It returns a short pass/fail summary.
- During development ask for targeted runs (one folder / one file). Full suite only at
  milestone end.
- Use the built-in Explore agent or Grep/Glob for finding code; don't open large files
  speculatively. Use line ranges when viewing long files.
- Use the `code-reviewer` subagent ONCE per milestone, at the end, not per file.
- Keep `docs/PROGRESS.md` short: overwrite the "Current state" section; don't write a diary.
- Don't paste large code blocks into chat explanations. Summaries ≤ 10 lines.

## Stack (see DECISIONS.md for rationale)

Vite + React 18 + TypeScript (strict) · Tailwind CSS v4 with CSS-variable theme tokens ·
Zustand (UI state only) · React Router · Zod (all boundaries) · idb (IndexedDB) ·
vite-plugin-pwa · Vitest + fast-check · Playwright + @axe-core/playwright ·
one serverless function (Web Fetch API handler) for AI photo analysis.

## Hard rules

- `src/core/**` and `src/features/chip-inventory/domain/**` must never import from
  `src/modules/**`. Enforced by ESLint `no-restricted-imports`; never disable it.
- Domain logic is pure TypeScript with an injected `Clock` (`now(): number`). No
  `Date.now()` or `setTimeout` inside `src/core` domain functions.
- The timer is derived, never decremented: `deriveClock(schedule, anchor, now)`.
- Every persisted record has `schemaVersion` and is parsed with Zod on read.
- AI output is untrusted input: validate with Zod server-side and client-side.
- No accounts, no auth, no cloud DB, no chatbot, no new dependencies without a
  DECISIONS.md entry.
- Australian English in UI copy. All user-facing strings live in the message catalogue
  (`src/shared/messages/`), with `playful` and `neutral` variants.
- Never claim tests passed unless `test-runner` reported it in this session.

## Commands

- `npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint`
- `npm run test` (Vitest) · `npm run test:e2e` (Playwright)

## Milestone done =

Scope implemented · tests added · `test-runner` full run green · `code-reviewer` blockers
fixed · PROGRESS.md updated · commit with message `M<n>: <summary>`. Then tell the user to
run `/clear` before the next milestone.

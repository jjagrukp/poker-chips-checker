# 07 — Testing, acceptance, release

## 1. Strategy
- Unit (Vitest, colocated): all pure domain code. Inject `Clock`; use explicit epoch values,
  not fake timers, for `deriveClock` and alert planning.
- Property (fast-check): allocation, ladder, schedule generation, `deriveClock`
  (invariant: deriving at t2 from an anchor equals deriving at t1 then normalising then t2).
- Integration (Vitest + fake-indexeddb): repositories, migrations, quarantine, export/import,
  wizard-to-ready flow at the service layer, recovery scenarios.
- E2E (Playwright, Chromium + WebKit mobile): use `page.clock` to jump time; axe scan on
  every screen; reporter `line`.
- Coverage targets: core/timer and allocation ≥ 95 % branches; overall ≥ 80 % lines.

## 2. Required scenarios
Lifecycle transitions + invalid transitions · module registration · mock rounds/points
module end-to-end (generate → run → persist → recover) · allocation edge cases (05 §5) ·
each preset/players/duration combo (04 §8) · pause/resume · refresh mid-level · several
levels expire while closed · expiry across a scheduled break with `auto` and `waitForHost` ·
interlude expires while closed · paused stays paused · schedule exhausted → overtime →
extend · clock skew forward/backward · alert dedupe after refresh · no missed-sound replay ·
audio blocked until gesture · notification permission denied · corrupted record quarantined ·
older schema migrated · export→wipe→import round-trip · two tabs (controller + viewer) ·
AI disabled hides photo route · AI failure falls back to manual.

## 3. MVP acceptance criteria (all must be demonstrable)
1. Open without an account; create a Hold'em freezeout in ≤ 2 minutes with manual chips.
2. Upload a chip photo, review the proposal, correct and confirm it.
3. Equal, exact, inventory-respecting stacks — or a clear explanation with alternatives.
4. Generated schedule shows breaks, estimated finish and target-vs-scheduled duration.
5. Clock drift ≤ 1 s versus wall time over 60 minutes in a foreground tab.
6. Refresh restores the exact remaining time (±1 s) and state.
7. After 3 levels pass while closed, reopening shows the correct level and a summary, with
   no replayed sounds.
8. A paused tournament reopens paused.
9. Overtime never invents levels; host can extend.
10. Alerts audible after first interaction and always visible; mute works.
11. Results saved; preset and inventory reusable for a new tournament.
12. Works on a phone (375 px) and a TV/fullscreen layout; axe reports no serious/critical issues.
13. Fully usable with AI disabled; offline after first load (except AI).
14. Mock non-poker module passes the core suite with no Hold'em imports (lint + test proof).

## 4. Release checklist (M11)
Env vars set; rate limits verified with a burst test; CORS checked; no secrets in client
bundle (grep build output); limitations page live (local storage, Safari eviction, wake lock,
iOS silent switch, notifications, clock changes, "target not guarantee"); real game-night
run: 6+ players, 2+ hours, one deliberate phone sleep, one refresh, one mid-game edit.

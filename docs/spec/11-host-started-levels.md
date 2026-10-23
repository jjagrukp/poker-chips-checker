# 11 — Host-started levels and big-screen notices

M15 (D45).

## 1. Level end waits for the host
- New setting "When a level ends": wait for the host (default) or start the next level
  automatically. Mirrors "When a break ends": Hold'em config `levelEndBehaviour` (optional; new
  drafts default to wait), copied to `Tournament.settings.levelEndBehaviour` (absent on older
  tournaments = auto), app default `Settings.levelEndDefault`,
  shown in setup → Structure → Advanced and Settings → New tournaments.
- Core: `DeriveOptions.levelEndBehaviour`. When a level's time runs out (live or during catch-up)
  the anchor holds at the next segment (level or scheduled break) with its full length:
  `status: paused, holdAtIndex = next` → view `awaitingHost`. Alerts stop being planned past that
  point; the existing level-end sound (levelStart / breakStart) still plays at 0:00.
- Options come from one helper, `deriveOptions(tournament)`, used by lifecycle, the clock store
  and the UI, so every place derives the same clock.

## 2. "Start the next level" UI
- While held after a level: hero shows "Time's up" over the next segment's title and blinds, the
  countdown greys to its full length, and the primary control becomes a large brass
  "Start Level N" / "Start the break" (it's `resume`). Very visible: full-width on phones.
- Big screens show a prominent notice: "Time's up. Finish this hand; Level N starts next."
- Alert text at 0:00 says the same instead of "The blinds are going up".

## 3. Notices on big screens
TV/fullscreen: transient alerts (1 minute left, level up…) appear as a large toast over the top of
the screen instead of pushing the layout; "Sound is off" becomes a small pill at the bottom;
"Keep this screen on" is a small corner note. Phones keep the in-flow banners.

## 4. Tests
derive-clock + plan: hold at level end live and in catch-up, level → break, auto unchanged;
resume starts the held segment; store/UI: big start button, labels; TV toast/pill rendering;
e2e: level runs out → held at 00:00 → "Start Level 2" → running.

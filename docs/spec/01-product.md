# 01 — Product, scope, brand and UX

## 1. Vision
A polished, local-first web app that makes running a home poker tournament effortless:
set up in minutes, run a reliable clock on a phone/laptop/TV, survive refreshes and sleep,
and reuse the same chips and settings next time. V1 = Texas Hold'em **freezeout** only,
on a core that can host other games later without a rewrite.

The app manages structure and timing. It never deals cards, hosts online play, or handles money.

## 2. Principles
- Correct deterministic calculations over AI guesses. AI is only used to *propose* a chip inventory.
- Local-first, no accounts. Fully usable offline after first load (except the AI photo step).
- Helpful defaults, full user control, explicit validation (never silently accept invalid config).
- Humour never obscures blinds, countdown, errors or controls.

## 3. Scope
In V1: setup wizard, manual + AI-assisted chip inventory, allocation, blind schedule
generation and editing, live clock with recovery, alerts, results, presets, local
persistence, JSON export/import, PWA install.

Out of V1: chatbot / natural-language config, online play, card recognition, rebuys,
add-ons, payouts, accounts, cloud sync, multiplayer control, module marketplace, any
betting or money features, voice announcements (future), chip colour-ups (architecture must allow).

## 4. Brand
- Name undecided. `src/app/configuration/brand.ts` holds `appName` (temporary neutral
  title "Tournament Clock"), `tagline`, `logo` asset path, `themeId`. No name strings
  anywhere else.
- Personality: playful, funny, colourful, approachable — not casino-serious, not childish.
- Visual: bold display type for the clock, bright accents on accessible backgrounds,
  distinct visual treatment for `level`, `warning` (last minute), `break`, `paused`,
  `overtime`, `completed`. Each state must differ by text/icon too, not colour alone.
- Message catalogue `src/shared/messages/`: every user-facing string has a key; transition
  and celebration messages have `playful` and `neutral` variants; setting `tone` picks one.
  Errors, warnings and controls are always plain (no jokes). Seed playful examples:
  - "The chips have been counted. Trust issues remain."
  - "The blinds are going up. Your excuses aren't helping."
  - "Bathroom break over. Financial decisions resume."
  - "We have a winner. Everyone else has a story."
- Respect `prefers-reduced-motion`: replace animations with instant state changes.

## 5. Screens
1. **Home** — resume active tournament (prominent), new tournament, saved tournaments,
   inventories, presets, settings. Shows local-storage notice once (see 02 §7.6).
2. **Setup wizard** (form controls, not chat). Draft auto-saved after every step.
   - Step 1 Basics: name (optional), game (Texas Hold'em, only option), format (freezeout,
     only option), players (module range, Hold'em 2–10), optional planned start time
     (informational countdown on the clock screen; never auto-starts).
   - Step 2 Duration: 1h / 2h / 3h / 4h / custom (30–600 min). Copy: "This is a target,
     not a guarantee. Freezeouts end when someone has all the chips." Duration includes breaks.
   - Step 3 Chips: choose saved inventory, enter manually, or upload a photo (AI, if
     enabled). All routes end on the same editable inventory review (05 §2).
   - Step 4 Stack: recommended (default) or custom; depth preset shown as "≈ N big blinds".
     Impossible values are blocked with the reason and up to 3 nearest valid alternatives.
   - Step 5 Structure: Gentle / Standard / Turbo / Custom. Advanced panel: starting blinds,
     level length, growth, antes, breaks, break-end behaviour, per-level editing.
   - Step 6 Review: players, stack, per-player chip breakdown (with chip colour swatches
     + names), inventory used/unused, full schedule with breaks and the
     "estimated finish" marker, target vs scheduled duration, warnings, **Start** button.
   Order note: chips come before stack/structure because the stack and blinds depend on
   denominations. The wizard can jump back to any step without losing data.
3. **Inventory** — list/edit reusable inventories.
4. **AI photo review** — part of step 3 (06 §4).
5. **Schedule preview/editor** — used in step 6 and during a live tournament.
6. **Live clock** (03).
7. **Results** (02 §6).
8. **Settings** — tone, sound, per-alert toggles, volume, notifications, break-end
   behaviour default, export/import, delete data, storage status, about/limitations.

## 6. Live clock layout
Primary: level label, giant remaining time, SB/BB, ante (if any). Secondary: next level,
time to next break, players remaining (+/- buttons) and average stack in BB, elapsed time
(optional), state badge. Fullscreen/TV layout drops chrome, scales type with viewport
(`clamp()`), readable at 5 m. Controls: start, pause/resume, next level, previous level
(confirm), start break now, end break, +5 min to break, mute, fullscreen, edit schedule,
end tournament (confirm). Keyboard: Space pause/resume, →/← next/prev, B break, M mute, F fullscreen.

## 7. Accessibility
WCAG 2.2 AA. Keyboard reachable, visible focus, labelled controls, contrast ≥ 4.5:1 (clock
digits ≥ 3:1 large text minimum but aim higher), `aria-live="polite"` region announcing level
changes and warnings (not every second), every audio alert has a visual equivalent, no
information by colour or sound alone, touch targets ≥ 44px.

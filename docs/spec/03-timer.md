# 03 — Live clock, recovery, alerts

## 1. Model
The clock is never decremented. Persist a small anchor; derive everything else.

```ts
interface ClockAnchor {
  status: 'idle' | 'running' | 'paused';
  segmentIndex: number;
  deadline?: EpochMs;          // running: when current segment ends
  remainingMs?: Ms;            // paused/idle: time left in current segment
  interlude?: Interlude;       // ad-hoc break outside the schedule
  holdAtIndex?: number;        // set when breakEndBehaviour = 'waitForHost' stops catch-up
  revision: number;            // increments on every write
  updatedAt: EpochMs;
}
interface Interlude { deadline?: EpochMs; remainingMs?: Ms; resumeLevelRemainingMs: Ms }

function deriveClock(schedule: Schedule, anchor: ClockAnchor, now: EpochMs,
                     opts: { breakEndBehaviour: 'auto' | 'waitForHost' }): ClockView
interface ClockView {
  segmentIndex: number; remainingMs: Ms;
  status: 'idle' | 'running' | 'paused' | 'awaitingHost';
  inInterlude: boolean;
  overtimeMs: number;          // > 0 when the schedule is exhausted
  passedSegmentIds: string[];  // segments that ended between anchor.updatedAt and now
}
```
`deriveClock` is pure and is used both every UI tick and on recovery — there is no separate
recovery algorithm. Commands (`start`, `pause`, `resume`, `next`, `previous`, `startBreakNow`,
`endBreak`, `extendBreak`, `editSchedule`) are pure functions `(state, now) → { anchor, events }`
that first call `deriveClock` to normalise, then apply the change.

## 2. Catch-up rules (running)
- While `now ≥ deadline` and not on the last segment: advance index, `deadline += next.durationMs`.
- Break segments are part of the schedule, so scheduled breaks catch up uniformly.
- If `breakEndBehaviour = 'waitForHost'` and a break segment ends: stop at the next level with
  status `awaitingHost` and that level's full duration remaining (host presses Resume).
- Last segment expired → **overtime**: stay on the last level, `remainingMs = 0`,
  `overtimeMs = now − deadline`, show an overtime banner (counts up) with actions
  "Add levels" (module `regenerateFrom` extends the progression; preview first) and
  "Edit schedule". Never invent levels silently.
- Interlude (ad-hoc break): level is effectively paused at `resumeLevelRemainingMs`; when the
  interlude deadline passes, apply `breakEndBehaviour` (auto-resume level vs await host).

## 3. Paused, idle, clock skew
- `paused`/`idle` anchors never change on recovery. A paused tournament stays paused.
- In-session ticking: `setInterval(250ms)` computing from `Date.now()`, re-render only when
  the displayed second changes. Compare wall-clock delta with `performance.now()` delta each
  tick; if they diverge by > 5 s, the device clock changed: re-anchor using the monotonic
  delta, record a `clock_skew` event, show a dismissible warning.
- Across sessions: if `now < anchor.updatedAt − 5 s` (clock went backwards), do not
  regress; keep state, set status `paused`, warn the host.
- Documented limitation: if the device clock is changed while the app is closed, recovery
  trusts the new clock.

## 4. Recovery UX
On load/visibility regain, if `passedSegmentIds.length > 0`: persist the normalised anchor,
append one `recovered` event (count, from/to segment, gap ms), and show a summary banner:
"While the app was asleep, 2 levels passed. Now: Level 7 — 300/600, 08:42 left." Play no
missed sounds; only alerts whose threshold is still in the future can fire. Hidden→visible
(`visibilitychange`, `pageshow`) triggers the same path as a cold load.

## 5. Keeping the screen awake
Request the Screen Wake Lock (`navigator.wakeLock.request('screen')`) while a tournament is
running on the controller tab; re-acquire on `visibilitychange`. Show an indicator if
unsupported/denied ("Keep this screen on in your device settings"). Fullscreen via the
Fullscreen API with a CSS fallback layout.

## 6. Alerts
### 6.1 Defaults (all toggleable)
5 min left (off by default) · 1 min left · last 10 s beeps · new level chime · break start ·
break ending (1 min) · break end · tournament complete · recovery (visual only).

### 6.2 Engine
- `alerts/plan.ts` (pure): given ClockView + segment, return upcoming alerts with absolute times
  and keys `${segmentId}:${alertType}`.
- Fired keys stored per tournament (persisted) → no repeats after refresh.
- An alert fires only if its time is crossed during live ticking (previous tick < t ≤ current
  tick and gap < 2 s). Thresholds crossed during a sleep/catch-up gap are marked fired silently.
- Audio: Web Audio synthesised tones, one distinct timbre per type. `AudioContext` created/
  resumed on the first user gesture (Start, Test sound, unmute). When a segment end is within
  15 s, pre-schedule the 10-second beeps and the transition chime on the `AudioContext`
  timeline so they stay on time even if JS timers are throttled in a background tab; cancel
  if paused or edited.
- Volume slider (gain node), mute toggle, test-sound button per alert type.
- Visual equivalents: banner + state colour + icon + `aria-live` text for every alert;
  optional screen flash (disabled under reduced motion).
- Browser notifications: opt-in in Settings, only when the tab is hidden, never required.
  Document that they're unreliable when the device sleeps.
- iOS note for the limitations page: the hardware silent switch can mute web audio.

## 7. Schedule edits while running
Edits go through module operations with preview. Rules: the current segment keeps its
elapsed time unless the host explicitly chooses "restart this level"; changing the current
level's duration recomputes the deadline from elapsed time (if new duration < elapsed, the
level ends now — confirm first); edits never touch past segments. Every edit appends an
event with before/after.

## 8. Events
`{ id, tournamentId, seq, at, type, payload }` — types include lifecycle transitions, clock
commands, `segment_started` (logged lazily when derived), `recovered`, `clock_skew`,
`schedule_edited`, `participants_changed`, `completed`. Used for results (actual duration)
and debugging, not for rebuilding state.

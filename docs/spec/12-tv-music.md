# 12 — Music on the shared TV

Background music for the table, played by the shared TV (spec 08) under the clock. Host-driven
from the phone; the TV is the room's speaker.

## 1. Host (live clock, controller, only where screen share is on)
- "Music" control in the dock opens a panel: paste a YouTube link (watch, youtu.be, shorts, live,
  music.youtube.com, playlist, or a bare 11-char id). Only the video/playlist ids are kept.
- Play/Pause, Next song (playlist) or Start again (song), Shuffle (playlist), Volume 0–100
  (saved after the slider settles), Stop music. Nothing plays on the phone.
- Stored as `tournament.settings.music` (D46) so it reaches the TV via the normal commit → snapshot
  path (≤ 2 s poll delay).

## 2. TV (`/screen/:code`)
- When `settings.music` is set, a visible 200 × 200 privacy-enhanced YouTube player
  (youtube-nocookie.com) sits bottom-left. YouTube's terms need the player on screen.
- Follows play/pause, volume, shuffle; "Next" is a counter (`skips`) and the TV skips when it rises.
  A single song repeats; a playlist loops. A playlist entry that won't embed is skipped.
- Ducks to 25 % volume for 6 s whenever an alert shows on the TV (a countdown ducks at its first beat).
- A playlist where 5 entries in a row won't embed stops with the "can't be played" note.
- If the TV's browser blocks autoplay (still not playing 5 s after it should), it shows
  "Start music"; one press on the TV starts it. Unplayable video / YouTube unreachable show a note.

## 3. Out of scope
Search, queue editing, other services, music on the host device or viewer tabs.

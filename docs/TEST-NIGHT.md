# Real poker-night test (spec 07 §4)

Run on the deployed site with a real game: 6+ players, 2+ hours. Note the device, OS and browser
used for the clock and for each viewer. Tick each box, and write down anything that surprised anyone.

## Before

- [ ] `npm run check:api` passed against the live URL earlier in the day (not within the hour before).
- [ ] Clock device: opened the site once online; on iPhone/iPad added to Home Screen.
- [ ] Clock device plugged in, auto-lock set as long as it goes, volume up, silent switch off.
- [ ] Settings → test sound plays. Notifications allowed (optional).
- [ ] `/limitations` read by the host.

## Setup

- [ ] Chips from a photo with **Claude** (`AI_PROVIDER=anthropic`): note counts proposed vs actual,
      colours right or wrong, time taken.
- [ ] Same chips, same photo setting, with **Gemini** (`AI_PROVIDER=gemini`, redeploy): same notes.
      Keep the provider that did better, or record the trade-off in DECISIONS.md (D34).
- [ ] One deliberately bad photo (blurry or not chips): the app explains and manual entry works.
- [ ] Wizard finished with the recommended stack; review warnings made sense.

## During (2+ hours)

- [ ] Level changes and breaks chimed and showed on screen; nobody missed a level.
- [ ] **Phone sleep**: let the clock device lock for 2+ minutes mid-level, then unlock. Time left
      was right, and the catch-up summary was correct.
- [ ] **Refresh**: reload the clock tab mid-level. The clock carried on from the right time.
- [ ] **Mid-game edit**: change an upcoming level (e.g. lengthen it). Past levels stayed locked and
      the change showed straight away.
- [ ] A second tab on the host's device opened the tournament as a viewer and stayed in sync.
- [ ] "Show on a TV": the TV opened `/screen/<code>`, stayed in sync through pause, next level and a
      break, and kept counting with the phone screen off.
- [ ] Players-remaining and average stack updated as people busted.
- [ ] Ran offline for a while (flight mode on the clock device): clock and alerts carried on.

## After

- [ ] Results saved: finishing positions and actual duration right.
- [ ] Saved as a preset; Home shows the tournament and preset.
- [ ] Export a backup; it imports on another browser.
- [ ] Actual length vs the target. Was the blind structure too fast or too slow?

## Findings

Write each problem as: what happened · device/browser · could it be repeated. Fix blockers before
calling the MVP done; everything else goes into PROGRESS.md as a follow-up.

# 10 — Hand rankings beside the clock

M14 (D44). A reference panel for new players, on the big screen only.

## 1. Behaviour
- Live clock controls get a "Hand rankings" toggle (controller only, `aria-pressed`). It is stored
  per tournament in `Tournament.settings.showReference` (generic name: a module's reference panel),
  so it commits like any change, reaches viewer tabs, and goes to a shared TV in the snapshot.
- Shown only in big-screen layouts (fullscreen, or `/screen/:code`) at ≥ 1024 px wide: a panel to
  the right of the clock (about 30 % width). The countdown sizes from its own container, so it
  shrinks to fit. On the phone's normal view a one-line hint says where it appears.
- Hold'em content (modules/texas-holdem/hand-rankings.ts): the ten hands, best first, each with an
  example of five cards; cards that don't make the hand (kickers) are dimmed. Names come from the
  message catalogue. Cards are decorative (`aria-hidden`); the list reads as "1. Royal flush"…

## 2. Tests
Store commit + onSaved for the toggle; panel shows on a shared screen when on and not when off;
toggle button state; e2e: phone toggles, TV shows "Hand rankings".

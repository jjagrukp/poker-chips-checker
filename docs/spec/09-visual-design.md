# 09 — Visual design ("Midnight card room")

M13 restyle (D43). Same flows, labels and roles; new look. Dark only.

## 1. Direction
A late-night home game under one warm lamp: near-black navy room, a soft felt-green glow
behind the action, brass/gold for the things you press, real-looking chips wherever chips appear.
Calm and legible from across a table; big numbers do the talking.

## 2. Foundations (src/index.css tokens, src/shared/components/styles.ts)
- Type: display `Bricolage Grotesque` (headings), body `Manrope`, clock/numbers `Barlow Condensed`
  (tabular). Self-hosted via @fontsource (works offline, CSP `font-src 'self'`).
- Colour: surface `#0b0d17`, raised `#151a2b`, high `#1e2540`, hairline `#ffffff1a` (field and icon-button edges `ink-muted/40`, WCAG 1.4.11), ink `#f4f1ea`,
  muted `#a9adc4`, accent (brass) `#f2c14e` on `#1a1406`, felt `#0f3d2e`, danger `#ff6b6b`,
  focus `#8ab4ff`. Clock states keep their hues (warning moves to amber `#ffb020` so it isn't brass).
  Every text pair ≥ 4.5:1; state colour always has a label.
- Shape: cards `rounded-3xl`, hairline border, soft shadow; buttons `rounded-2xl`, ≥ 44 px; pills.
- Background: fixed radial felt glow at the top plus a faint vignette; no images.
- Motion: 150–250 ms ease-out on press/hover/expand; nothing moves under reduced motion.

## 3. Shared pieces
- `Icon` — inline SVG set (play, pause, prev, next, break, volume, mute, bell, expand, tv, edit,
  flag, home, plus, minus, settings, camera, check, chevron). `aria-hidden`; text stays the label.
- `Chip` — SVG poker chip from a colour (edge inserts, inner ring, optional value). Used in the
  inventory rows, stack/breakdown, chip-set cards, logo.
- `PageHeader`, `StatTile`, `Pill` (status), `Section`.

## 4. Screens (in build order)
1. Live clock + TV screen: top bar (home, name, state pill), hero (level, huge countdown that
   steps down for h:mm:ss, level progress bar, blinds + ante), control dock (prev · big
   play/pause · next) + secondary pill row right under the hero so the host's thumb finds it,
   then stat tiles (next, players ±, next break, average stack, elapsed; one row from md up).
   TV/screen share: full-bleed, sizes in vw/vh so a 1080p screen never scrolls, no controls.
2. Home / library / ready / results: brand hero, tournament cards with status pills, chip-set
   cards with a chip fan, compact storage notice.
3. Setup wizard: progress stepper (Step n of 6 + bar), sticky Back/Next on phones (safe-area
   padded), chip rows with a live chip preview whose swatch follows the colour name until picked
   (`swatchPicked`; saved sets count as picked), schedule table with ante/start columns hidden on
   phones (scrolls rather than clips), structure options as option cards.
4. Settings, share panel, photo panel, notices: same components.

## 5. Done when
All screens restyled; existing unit/e2e/axe tests green with unchanged labels; 375 px has no
horizontal scroll (the schedule table currently overflows); before/after screenshots reviewed.

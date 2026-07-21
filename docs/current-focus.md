# Current Focus

_Keep this short. Update it whenever the active thread of work changes —
this is the first thing to read at the start of a new session._

Active area:
- **Customizable nameplate** (build `b78`, working tree, not yet confirmed
  on-device). Expanded the bare name/pronouns plate into a fully styleable
  badge. New **Nameplate style** card in the Badge tab: Position (top/middle/
  bottom), Font (7 curated system stacks), Size (60–160%), Text + Accent
  colours, Panel style (frosted/outline/none), Text case (UPPER/as-typed),
  accent-underline toggle, and **Auto-hide** (fades the plate out during
  reactions so it never covers the face). Also added an optional **Tagline**
  third line. Surfaces: `index.html` (attr/var-driven CSS + the new card +
  `#plate-tagline`), `ui.js` (`PLATE_FONTS`, `applyPlate()`, `updatePlate()`,
  refs + listeners), `core.js` (10 new `settings` keys, all defaulting to the
  prior look), `main.js` (`updatePlate()` in the loop). See
  [ui.md § Nameplate style](ui.md). Verified: all four changed JS files parse
  in module mode; browser runtime check confirmed every control drives the
  right `data-*`/CSS-var/computed-style and persists to localStorage. Pixel
  screenshot blocked by the WebGL rAF loop (known sandbox limit) — visual feel
  is an on-device check.
- **Lively backdrop** (build `b77`, working tree, not yet confirmed on-device).
  Replaced the inert static-gradient background with a CSS `#backdrop` layer
  that (1) offers **selectable styles**, (2) slides opposite the camera swing
  during tilt parallax for a depth cue, and (3) can colour-match the active
  lighting Look. `b76` added the system + orbs; `b77` added the style selector
  (orbs / starfield / aurora / plain). Surfaces:
  - `index.html` — `#backdrop[data-style]` with orbs/stars/aurora layers, their
    CSS, `--orb-a/-b/-c` + `--px/--py` vars, and the Background card's **Style**
    selector + **Match lighting** toggle.
  - `light.js` — each Look gained a `bg` block; `lookBackground()` export.
  - `ui.js` — `applyBackground()` writes the colour vars (Look-matched when
    `settings.bgAuto`, else manual pickers); `applyBgStyle()` swaps the layer;
    `buildStarfield()` generates the box-shadow star fields once.
  - `camera.js` — `updateBackdrop()` writes `--px/--py` from parallax each frame.
  - `config.js` — `BG_PARALLAX_PX`; `bgAuto`/`bgStyle` defaults in `core.js`.
  Verified per build: all changed files parse in module mode; preview runtime
  check confirmed the colour vars populate from the Look and every style layer
  shows/hides correctly (starfield generates 70/45/24 dots across 3 depths).
  WebGL rAF loop blocks pixel screenshots in the sandbox — visual feel is an
  on-device check. Awaiting on-device confirmation of the `b77` stamp + feel.

Tunable-by-feel knobs for the next round (user tunes, Claude bakes):
- `CONFIG.BG_PARALLAX_PX` (default 34) — how far the backdrop slides on tilt;
  0 = static. Sign of the slide is set in `camera.js:updateBackdrop`.
- Per-style: orb sizes/positions + `drift1/2/3`; aurora bands + `aur1/2/3`;
  star counts/colours in `ui.js:buildStarfield` + depth/twinkle in the
  `.sl1/2/3` rules. Colours per Look live in each Look's `bg` in `light.js`.
- Deferred: **Tier-1 3D background** (equirectangular HDRI/360 skybox as
  `scene.background`, pairing with parallax + env lighting) — discussed and
  wanted; parked because in-game VRChat 360 capture looks deprecated, so start
  from a CC0 HDRI (Poly Haven) instead. Also idea #4 (multi-layer bokeh at
  different depths) still on the back burner.

Recently completed (per commit history):
- Lighting / shading "Look" system (confirmed live, build `b75`)
- Animation debug system
- Knee articulation

Next priorities:
1. Confirm the backdrop on-device (drift feel, parallax depth, Look-matched
   colours across all four Looks + manual mode) and commit once confirmed.
2. Resume normal animation-tuning cadence via the Animation Tuner as new
   gesture/reaction requests come in.

---

_This file only tracks the **active** thread. For durable subsystem
knowledge, see the other files in `docs/`._

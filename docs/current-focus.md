# Current Focus

_Keep this short. Update it whenever the active thread of work changes —
this is the first thing to read at the start of a new session._

Active area:
- **Tuner visual body-region picker — v2, chips** (build `b83`, working tree,
  not yet confirmed on-device). **v1 (SVG stick-figure, `b82`) was tried,
  pushed, and rejected on-device** — user felt it didn't visually match the
  rest of the app. Because it was built removable, the swap was clean: deleted
  the whole `#tn-diagram` SVG/`<style>` block and replaced it with a plain row
  of filter **chips** reusing the app's own `.chip`/`.is-on` classes (same ones
  the test bar already uses) — All + 9 regions (head/torso, L/R arm, L/R hand,
  L/R leg, ears, tail). Same underlying mechanism as v1: clicking a chip sets
  `activeGroup`, narrowing the same dropdown via `buildBones()`; region chips
  `disabled` when the loaded avatar has nothing there. Renamed
  `updateDiagramState()`→`updateRegionState()` accordingly. No collapse toggle
  this time (a compact button row didn't need one, unlike the diagram). See
  [ui.md § Visual body-region picker](ui.md) for the updated removal
  instructions. Verified: `ui.js` parses; toggle/All-clear semantics
  harness-tested; live DOM check confirmed 10 chips render, "All" is
  on by default, all 9 region chips correctly `disabled` with no avatar
  loaded, no console errors. Pixel screenshot of the panel still times out in
  this sandbox (WebGL rAF loop blocks capture regardless of 2D content, a
  known limitation, confirmed unrelated to this specific change) — whether the
  chips *look* right (spacing, wrap, matching the test bar visually) is the
  on-device check this round.

- **Keyframe clips — Path B, Phase 1** (build `b81`, working tree, not yet
  confirmed on-device). Greenlit the hybrid pose-to-pose system: sparse
  keyframes + Catmull-Rom interpolation + idle underlay. Built the clip data
  model, the interpolation player (`catmull`/`interpChannel`/`sampleClip`), a
  `clips` layer in the frame loop (over idle, after reactions), and
  capture-and-play authoring in the Tuner ("Keyframes (clip)" section) with
  save/load to `localStorage['cb.clips']`. **No visual timeline yet** — that's
  Phase 2. Interpolation math harness-verified (endpoints, exact keys, smooth
  in-betweens, absent-channel=0, face clamp, end clamp); app boots clean. See
  [animation.md § Keyframe clips](animation.md). **The open question Phase 1
  exists to answer:** does sparse-key + spline + idle-underlay actually feel
  smooth/alive on-device? That's the next check before investing in Phase 2's
  timeline UI. Files: `anim.js` (clips engine + `nodeAddOffset` refactor),
  `main.js` (`clips.update`), `ui.js` (Keyframes panel), `config.js` (stamp).

- **Idle arm/elbow liveliness** (build `b79`, working tree, not yet confirmed
  on-device). User reported the idle arms read as stiff — the elbows had a flex
  sine but it was slow/small enough (~±0.13 at a ~15s period) to look static.
  Coupled the elbow open/close to the **breathing** phase so they visibly work
  each breath, scaled by a new `CONFIG.ELBOW_FLEX` (0.22, tunable by feel). Left
  `ELBOW_BEND` (the resting angle) untouched on purpose — it's the shared base
  the gestures and the tuned fluster cover pose layer on, so changing it would
  perturb them. Motion-only fix in `anim.js` idle + `config.js`. **Still open:**
  the user also wants the *default* arm/hand resting position adjusted, but gave
  no target. **Resolved:** wired idle into the Animation Tuner (`b80`) — new
  **Base → idle** picker target freezes the resting pose (`idle._hold`) so it
  can be dialed live like any gesture. User will tune the resting arm/hand
  position by eye and hand back deltas (bake **raw**, no `*e`, since idle has no
  envelope). Awaiting on-device tuning + the elbow-motion feel check.

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

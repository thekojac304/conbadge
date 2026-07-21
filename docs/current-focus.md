# Current Focus

_Keep this short. Update it whenever the active thread of work changes —
this is the first thing to read at the start of a new session._

Active area:
- **Lively backdrop** (build `b76`, working tree, not yet confirmed on-device).
  Replaced the inert static-gradient background with a CSS backdrop layer:
  three soft blurred orbs that (1) slowly drift on their own keyframes, (2)
  slide opposite the camera swing during tilt parallax for a depth cue, and
  (3) can colour-match the active lighting Look. New surfaces:
  - `index.html` — `#bg-orbs` markup, orb/drift CSS, `--orb-a/-b/-c` + `--px/--py`
    vars, and a **Match lighting** toggle in the Background card.
  - `light.js` — each Look gained a `bg` block; new `lookBackground()` export.
  - `ui.js` — `applyBackground()` is the single writer of the backdrop CSS vars
    (Look-matched when `settings.bgAuto`, else manual pickers).
  - `camera.js` — `updateBackdrop()` writes `--px/--py` from parallax each frame.
  - `config.js` — `BG_PARALLAX_PX` (backdrop slide amplitude); `bgAuto` default
    in `core.js`.
  Verified: all 5 changed files parse in module mode; runtime check in the
  preview confirmed `applyBackground()` populates the Look palette and all three
  orbs render + animate. Awaiting on-device confirmation of the build stamp
  and the tilt/drift feel.

Tunable-by-feel knobs for the next round (user tunes, Claude bakes):
- `CONFIG.BG_PARALLAX_PX` (default 34) — how far the backdrop slides on tilt;
  0 = static. Sign of the slide is set in `camera.js:updateBackdrop`.
- Orb colours per Look live in each Look's `bg.orbs` in `light.js`.
- Drift speed/throw = the `drift1/2/3` keyframes + orb sizes/positions in
  `index.html`. Deferred idea #4 (multi-layer particles/bokeh at different
  depth multipliers) is explicitly on the back burner.

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

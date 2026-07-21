# UI

Covers `ui.js` (settings sheet, modes, test bar, Animation Tuner, blendshape
browser) and the touch-input layer in `input.js`.

## Current implementation

### Modes

- **Setup mode** — gear + fullscreen buttons visible; long-press (550ms)
  opens the settings sheet.
- **Play mode** — no chrome at all, just the avatar and touch reactions.
  Exit is a 1.5s hold on the top-left corner (`CORNER_MS`/`CORNER_PX`), or a
  quick tap in the corner to reveal a real exit button for 4s. Deliberately
  two-step and non-obvious — discoverable by the wearer, not by a stranger
  poking the badge at a con.

### Settings sheet (`ui.js`, tabs)

Nameplate name/pronouns + visibility toggle, background gradient (2 color
pickers + 6 presets), Lighting card (see [lighting.md](lighting.md)),
battery saver toggle, motion sensors + tilt-parallax toggles, keep-awake
toggle, particle toggle, tail curl/lift sliders, camera height slider,
camera lock, save-default-view, auto-return timeout, blendshape browser.

### Blendshape browser

Lists every morph name found on the avatar (`S.allMorphNames`, captured
pre-pruning in `avatar.js`). Search-filterable; active morphs sort first.
Each row is collapsed by default — a slider is only instantiated when a row
is opened, since 400+ simultaneous range inputs would be sluggish. Setting a
weight > 0 persists to `settings.morphs` and triggers a **debounced (700ms)
full VRM remount** from the cached buffer, because morph pruning happens at
load time (see [performance.md](performance.md)) — enabling a previously
pruned morph requires re-running `setupMorphs()`.

### Test bar (clapperboard icon, setup mode only)

Fires any gesture or reaction on demand, skipping the random idle timer and
the fade-in — essential for verifying an animation change without waiting
8–20s for it to come up naturally.

### Animation Tuner (`⚙ Tuner` chip in the test bar)

The live-tuning surface described in [animation.md](animation.md). UI
specifics:

- Bone dropdown is built from the *loaded* rig, grouped (Body/head, Left/
  Right arm, Left/Right hand — fingers, Left/Right leg, Ears/tail) and
  filterable by a text box.
- Four sliders per bone: X/Y/Z Euler + Twist (axial roll), range ±1.8 rad.
- Face/expression sliders are built from `rig.morphs` (whatever semantic
  morphs this avatar actually has).
- **Mirror L→R / R→L buttons**: copies every override on one side to the
  other, negating Y, Z, and twist (X carries over unchanged) — the correct
  transform across the sagittal plane on this rig's bone convention.
- **Copy deltas** copies the generated `pose.add()`/`pose.twist()`/
  `setExpr()` lines to the clipboard, ready to paste into `anim.js`.
- Selecting a new animation calls `tunerHold()`, which freezes it at 50% of
  its duration (past the ease-in, sitting at full pose) with internal time
  paused.

### Touch input (`input.js`)

- **Tap** → raycast the avatar mesh, snap to the *nearest* `TOUCH_ZONES`
  anchor (by 3D distance to the hit point, not by mesh region) → fire the
  zone's reaction. Anchors also act as "catchers": adding a thigh/forearm
  anchor stops those taps being stolen by a nearby groin/chest zone.
  `CONFIG.ZONE_DEBUG` draws a colored dot at every anchor for tuning by eye.
- **Drag on the avatar** → petting (accumulates energy from finger travel
  distance); suspends `OrbitControls` for the duration so petting and
  orbiting can't fight over the same gesture.
- **Drag on the background** → camera orbit (native `OrbitControls`).
- **Long-press** → open settings (setup mode) or arm the corner-exit timer
  (play mode).
- **Two-finger drag** → vertical-only pan (camera height), clamped by
  `clampCameraTarget()`.
- **Swipe trail** — a 2D canvas overlay (not in the 3D scene) drawn while
  petting, tapering and fading per-segment since a single canvas path can't
  carry varying width/alpha along its length.

## Design philosophy

**The user does not need to know animation.** The Tuner's entire purpose is
translating "too fast" / "ears should pin back" into baked code deltas
without the user touching a bone name or a radian value directly — mapping
intent to knobs is Claude's job (see [animation.md](animation.md) and
CLAUDE.md's Animation Tuner pattern).

**Play mode exit is intentionally awkward.** This is a UX decision, not an
oversight: a badge worn on a lanyard at a convention will be poked by
strangers, and the exit needs to survive that without being one accidental
tap away.

## Important decisions

- Camera height slider and two-finger pan write the *same* `camOffsetY`
  value and stay in sync via `S.camHeightSync` — introduced because they
  used to drift apart.
- Camera lock disables `OrbitControls` but leaves tap reactions working,
  since taps are handled by this project's own pointer code, not
  `OrbitControls`.
- Morph slider changes are debounced (700ms) before remounting, not applied
  live — a full VRM remount is expensive enough that dragging a slider needs
  the debounce to stay smooth.

## Known limitations

- Enabling a custom blendshape always costs a full VRM remount (geometry
  morph-attribute rebuild) — there's no cheap path to "un-prune" a single
  morph target.
- The Tuner panel is unstyled inline CSS injected via `innerHTML`, separate
  from the main settings sheet's stylesheet — consistent internally but not
  reusing the app's design tokens.

## Future ideas

- None currently tracked.

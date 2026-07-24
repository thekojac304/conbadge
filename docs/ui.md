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

Nameplate identity (name / pronouns / tagline + visibility toggle) and a
**Nameplate style** card (see below), background card (**Match lighting**
toggle + 2 color pickers + 6 presets), Lighting card (see
[lighting.md](lighting.md)), battery saver toggle, motion sensors +
tilt-parallax toggles, keep-awake toggle, particle toggle, tail curl/lift
sliders, camera height slider, camera lock, save-default-view, auto-return
timeout, blendshape browser.

### Nameplate style (`applyPlate()` / `updatePlate()`)

All nameplate visuals are driven through **data-attributes + CSS custom
properties on `#nameplate`** — the same var-driven pattern as the backdrop, so
settings mirror straight into the DOM with no per-material work. `applyPlate()`
in `ui.js` is the single writer; the CSS lives in `index.html`. Controls:

- **Position** (`settings.platePos`: top / middle / bottom) → `data-pos`; the
  CSS pins the plate and swaps the centring transform (middle uses
  `translate(-50%,-50%)`).
- **Font** (`settings.plateFont`) → `--plate-face`. Curated **system** stacks
  only (`PLATE_FONTS` in `ui.js`: condensed / sans / rounded / serif / slab /
  mono / impact) — no web-font fetch, so it renders offline; exact glyphs vary
  by OS. Bundling real display fonts is a possible future step.
- **Size** (`settings.plateSize`, 60–160%) → `--plate-scale`, a multiplier on
  the existing responsive `clamp()` so name + pronouns + tagline scale together
  and still adapt to screen width.
- **Colors** — text (`plateColor`) → `--plate-color`, accent (`plateAccent`) →
  `--plate-accent`. Deliberately **separate** from the global `--accent` (which
  paints the whole settings UI) so recolouring the badge doesn't repaint chrome.
- **Panel** (`settings.platePanel`: frosted / outline / none) → `data-panel-style`.
- **Text case** (`settings.plateCase`: upper / normal) → `--plate-case`
  (`uppercase` / `none`).
- **Accent underline** (`settings.plateUnderline`) → `data-underline`; forced
  off when the name is empty so an orphan bar never shows.
- **Auto-hide** (`settings.plateAutoHide`) — `updatePlate()` (called from the
  frame loop in `main.js`) toggles a `.dim` class that fades the plate out via
  CSS opacity transition while `reactions.active || petting.active`, so the
  plate never covers the face mid-reaction. No-op unless enabled.

The **tagline** is an optional third line (con-useful: role / "ask about my
art" / table #); `#plate-tagline:empty` hides it when blank. All keys default
to the prior look, so existing users see no change until they tune.

### Backdrop style + colour (`applyBgStyle()` / `applyBackground()`)

The Background card has a **Style** selector (`settings.bgStyle`: orbs /
starfield / aurora / plain) that swaps which decorative layer `#backdrop`
shows — see [rendering.md](rendering.md) for the CSS layers. Style and colour
are **independent**: any style renders in any palette.

Colour (gradient + orb/star/aurora tints) is driven through CSS custom
properties on `:root`, so the manual pickers, the 6 presets, and the
Look-matched palette all write the *same* knobs (`--bg-a/-b`, `--orb-a/-b/-c`).
`applyBackground()` is the single writer and picks the source:

- **Match lighting on** (`settings.bgAuto`, default) — colours come from the
  active Look's `bg` block (`lookBackground()` in `light.js`); switching Look
  or toggling Lighting off re-tints the backdrop live. The manual pickers grey
  out (like the Lighting sliders do when Lighting is off).
- **Match lighting off** — manual `settings.bgA/bgB` gradient with the default
  orb tints; the pickers/presets become active again.

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
- **Auto-fade while adjusting** (`.tn-dim`): the whole Tuner UI (panel + the
  `#kf-bar`) fades to `opacity:.16` while a slider is being dragged, while
  scrubbing the timeline, or while a clip plays — so the avatar is visible
  through it during by-eye tuning — and snaps back on release/pause. Driven by
  two flags OR'd together (`dimDrag` from slider/scrub pointerdown cleared on a
  window `pointerup`; `dimPlay` set/cleared in the playhead rAF tick).
  Pointer-events stay on so the control can still be released and Stop hit.

#### Keyframe timeline (Phase 2, `#kf-track`)

The visual editor for the `clips` player (see
[animation.md § Keyframe clips](animation.md)). It lives in a **separate
bottom-docked bar (`#kf-bar`)**, NOT in the scrolling slider panel — so you can
pose (sliders, right panel) and capture/scrub/play (always-visible bar) without
scrolling between them, which was the whole point. The bar is a sibling fixed
element created next to `#anim-tuner`; **every keyframe element keeps the same
id**, so the handlers are container-agnostic and were unchanged by the move.
Opening the Tuner shows the bar and hides the app's test-bar chips to free the
bottom edge; closing restores the test bar. The slider panel's `bottom` is
capped (`calc(158px + safe-area)`) so the two fixed overlays never overlap (the
bar is `max-height:132px` at `bottom:max(10px, safe-area)`). A horizontal track
shows one diamond **marker** per keyframe positioned by its time (`left% =
t/dur`), plus a pink **playhead** line and a duration label (`dur` = last key's
time).

- **Capture** snapshots the current Tuner pose at the `t` field, drops a marker,
  and selects it (`t` auto-advances 0.5 for the next).
- **Track pointer handling** (one `pointerdown` on `#kf-track`, `touch-action:
  none` so a drag doesn't scroll the panel): pointerdown on a **marker** selects
  it and drag retimes it (re-sorts live); pointerdown on **empty track** starts
  a **scrub** — releases the Tuner hold and `clips.scrub()`s the edit clip at the
  time under the finger, so dragging previews the interpolated motion frame by
  frame. Selection is tracked **by object reference** (`selKey`), so it survives
  the re-sort that dragging/capture triggers.
- **Selected-key row** (shown only when a marker is selected): **Edit pose**
  (`clips.stop()` → re-hold base → load the key's `ov`/`face` into
  `tuner.overrides`/`tuner.face` so the sliders drive it) → adjust → **Update**
  (snapshot current pose back into the key) → **Dup** (clone at the midpoint to
  the next key) / **Del**.
- **Play** toggles play/pause; a `requestAnimationFrame` loop (`tickTimeline`)
  moves the playhead and syncs the button label while `clips.playing`. **Stop**
  ends playback and re-holds the base for posing. Non-loop playback auto-pauses
  at the end (playhead parked) rather than stopping outright.
- **Removability:** deep-copied via `cloneKey()` on save/load/dup so no keyframe
  ever shares a channel array (a shared array would corrupt keys when one is
  edited — the specific bug the harness checks for).

#### Visual body-region picker (removable)

A row of filter chips (`#tn-regions`) sits above the bone dropdown/filter: All
+ 9 regions (head/torso, L/R arm, L/R hand, L/R leg, ears, tail). Clicking one
sets a local `activeGroup` that **narrows the same dropdown** to that region's
bones — it holds no state of its own and duplicates none of the existing
selection logic (`cur()`, `syncSliders()`, capture/playback all work
identically regardless of whether the chips exist). Chips reuse the app's own
`.chip`/`.is-on` classes (the same ones the test bar uses), specifically so
this reads as a native part of the UI rather than a one-off visual style — an
**earlier SVG stick-figure version was tried and rejected** for not matching
the rest of the app; chips replaced it directly. Region chips `disabled` when
the *loaded* avatar has nothing there (`regionHasBones()` checks
`rig.bones`/`rig.ears`/`rig.tail`), since fingers/ears/tail vary per rig; "All"
is always enabled. Clicking the active chip again (or "All") clears
`activeGroup` and restores the full list.

- **Configure:** chip labels/order are the `#tn-regions` buttons in the `html`
  string; sizing override in the adjacent `<style>` (`#anim-tuner .chip{...}`).
- **Disable:** no runtime toggle currently (unlike the earlier SVG version) —
  since it's one compact row rather than a diagram, there wasn't a strong case
  for a collapse control. Add a `<details>` wrapper back if that's wanted.
- **Remove entirely:** every line is bracketed with `REMOVABLE (picker)`
  comments — delete the `#tn-regions` block + its adjacent `<style>`, the
  `let activeGroup` declaration, the one `if (activeGroup …) continue;` line
  inside `buildBones()` plus the `earExtras`/`tailExtras` split (revert to the
  single combined "Ears / tail" `extras` array it replaced), the
  `regionHasBones()`/`updateRegionState()` functions, and the
  `el('tn-regions')?...` click listener. Nothing outside those marked spans
  references the picker.

Added because the flat ~50-bone list (head/torso/arms/hands/**30 finger
joints**/legs/ears/tail) got clunky to search even with the text filter.
A 2D region picker (over 3D-tap-on-the-avatar) sidesteps occlusion (far-arm
elbow, tail, ears not all visible from one angle) and small-target precision
on a phone; a flat DOM panel — unlike the WebGL avatar canvas — can also be
inspected directly in a sandboxed dev environment (screenshotting the panel
itself hit an unrelated sandbox limitation — the WebGL render loop blocks
pixel capture regardless of what 2D content is on screen — so this was
verified via live DOM/JS inspection instead).

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

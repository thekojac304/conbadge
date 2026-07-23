# Animation

## Current implementation

All motion is **procedural** — computed every frame from sines, envelopes,
and IK solves. There are no keyframe clips or animation curves anywhere in
the codebase.

### The pose pipeline (per frame, in `main.js`'s `loop()`)

```
pose.clear()
idle.update(dt)        // breathing, blinking, gaze, knee bounce, tilt-lean
petting.update(dt)     // sustained petting response
gestures.update(dt)    // one random idle gesture at a time, crossfaded
reactions.update(dt)   // touch-triggered reaction, if active
pose.apply()           // writes accumulated humanoid bone offsets (pre S.vrm.update)
applyHipsDrop()         // position-only hip sink from the bounce
S.vrm.update(dt)        // three-vrm: normalized bones → raw bones, springs
flushExpr(dt)            // writes morph-target influences (after update)
applyTailPose(idle.t)    // tail curl/lift/sway (post-spring, so it overrides)
applyEarPose(idle.t)     // ear twitches (post-spring)
decayImpulses(dt)        // gesture-driven impulses (tail/ear/hips) decay each frame
```

**`PoseAccumulator`** (`pose.js`) is the core mechanism: every managed bone
starts each frame at its captured rest quaternion, and every animation layer
(idle, gesture, reaction) *adds* a weighted Euler offset via `pose.add(bone,
x, y, z, w)`. Because everything starts from rest and sums, nothing drifts
and nothing T-poses — a layer contributing 0 is invisible. `pose.twist(bone,
x, w)` is a separate axial-roll channel applied *after* the Euler offset, in
the bone's own frame (see Conventions in [CLAUDE.md](../CLAUDE.md)).

### Layers

- **Idle** (`anim.js` `idle` object) — always running. Breathing (layered
  sines at different frequencies so nothing loops visibly), blinking,
  wandering gaze (saccades to a new point every 1–3s), knee bounce + hip
  sink, periodic micro-expressions (`browUp`/`smileEyes`/`smileBig`/`glance`/
  `squintThink`), and tilt-lean response to device orientation.
- **Gestures** (`GESTURES` map, `gestures` object) — one fires randomly every
  8–20s, each an authored function of `(t, duration)` that writes to `pose`.
  Crossfaded in/out via an envelope; `gestures.gain` fades the whole layer to
  0 instantly when a touch reaction fires, so gestures never fight reactions.
  16 gestures exist: `wave`, `stretch`, `footShuffle`, `lookAround`,
  `headTilt`, `scratchHead`, `shake`, `weightShift`, `sniff`, `tailSwish`,
  `pawLift`, `toeTap`, `heelRaise`, `legStretch`, `blep`, `earFlick`.
- **Reactions** (`reactions` object) — touch-triggered, one-shot, replaces
  whatever's active. Kinds: `happy`, `blush`, `giggle`, `bellyRub`,
  `fluster`, `dizzy`, `boop`, `wave` (left/right). Wired from `input.js`'s
  `reactAt()` via `TOUCH_ZONES` in `config.js`.
- **Tail / ears** (`applyTailPose`, `applyEarPose`) — run *after*
  `S.vrm.update()` so they override any spring-bone simulation (this VRM has
  0 spring bones, but the ordering is defensive). Tail motion is a per-joint
  phase-lagged wave (`TAIL_LAG`) so it whips rather than moving as one rigid
  plank; wag amplitude free-runs off `wagPhase`, not off reaction time,
  because petting has no reaction and needs the tail to keep wagging.
- **Petting** (`petting` object) — a sustained energy value that builds while
  dragging across the avatar and decays when you stop, rather than a
  one-shot reaction. Drives face softening, a slight lean-into-the-hand pose,
  and heart particles.
- **Particles** (`particles` object) — fixed sprite pool (28), no
  per-frame allocation. Hearts while petting, sparkles on a boop.

### Arm IK (`armReach` in `pose.js`)

Two-bone IK using measured bone lengths (`rig.armL1`/`armL2`, captured at
avatar load in `avatar.js`). Solves shoulder yaw + elbow angle to place the
**wrist** at a world-space target. Used by `scratchHead` so the paw lands
beside the ear on any avatar's proportions, instead of a hardcoded angle that
only fits one rig. `armBase(side, w)` neutralizes the idle resting pose first
so the IK's absolute angles aren't fighting `ARM_FORWARD`/`ELBOW_BEND`.

### The Animation Tuner (`ui.js`, wired through `anim.js`'s `tuner` object)

Live-tuning surface, test-bar `⚙ Tuner` chip. Holds any gesture or reaction
frozen at its peak (envelope forced to 1, internal time paused) and exposes
per-bone X/Y/Z + twist sliders, plus face-morph sliders, built dynamically
from the *loaded* rig (so fingers/toes/jaw are posable when present).
Overrides are **additive** on top of the animation's own authored pose, and
the panel prints them back as `pose.add(...)`/`pose.twist(...)`/`setExpr(...)`
lines ready to paste into the gesture/reaction source. Ear/tail overrides use
synthetic keys (`ear0`, `tail0`, …) applied via `tunerAddTo()` since they
aren't humanoid bones.

The picker also has a **Base → idle** target so the always-on resting pose can
be tuned. Selecting it sets `idle._hold` (freezes `idle.t`, so every pose sine
— arms/breathing/knees/tail — sits static while blink/gaze keep ticking off
`dt`); arm-wobble damping is deliberately skipped for `kind==='idle'` so the
*true* resting pose is on show. **Idle has no envelope, so its deltas bake raw**
(adjust the idle base offsets / `CONFIG` constants), not `value*e` like the
gestures/reactions — the readout header flags this.

### Keyframe clips — Path B, Phase 1 (`clips` in `anim.js`)

The first slice of the opt-in keyframe system (see Design philosophy). A **clip**
is `{ name, dur, loop, keys:[ {t, ov:{bone:[x,y,z,tw]}, face:{morph:w}} ] }` —
each key is a snapshot of the Tuner's additive overrides + face weights at a
time. Authored and played **over idle** (so breathing/blink/idle life run
underneath for free), layered like a gesture.

- **Interpolation:** every channel present in *any* key interpolates across all
  keys (absent in a key counts as 0 there), **Catmull-Rom** through the keys so
  a handful of poses *flows* rather than stopping at each one. `catmull()` /
  `interpChannel()` / `sampleClip()`. Face results clamp to [0,1] (splines
  overshoot); bones are left to overshoot on purpose (that's follow-through).
- **Playback:** `clips.update(dt)` (in `main.js`'s loop, after reactions) samples
  the clip into `clips.cur`, applies bones via `pose.add`/`pose.twist` and face
  via `setExpr`; ears/tail are read from `clips.cur.ov` in `applyEar/TailPose`
  (shared `nodeAddOffset()`, same path the Tuner uses).
- **Authoring (Phase 2, visual timeline):** Tuner panel "Keyframes (clip)"
  section — see [ui.md § Keyframe timeline](ui.md) for the interaction detail.
  Pose with the sliders, set `t`, **Capture**; markers appear on a timeline
  track. Tap a marker to **select** it, drag it to **retime**, or drag empty
  track to **scrub-preview** any moment. Selected-key actions: **Edit pose**
  (loads that key back into the sliders), **Update** (writes the current pose
  back into the key), **Dup**, **Del**. **Play/Pause** with an animated
  playhead; **Stop** returns to posing. **Save/Load/Del** persist to
  `localStorage['cb.clips']`.
- **Player states (`clips` in `anim.js`):** `play` (advance `t`), `scrub`/
  `pause` (hold `t`, keep applying the sample — this is what the scrub/preview
  path uses), `resume`, `stop`. Non-loop playback auto-pauses at `dur` (playhead
  parks at the end) rather than tearing down, so the UI can reflect the state.
  A `requestAnimationFrame` loop in `ui.js` moves the playhead + syncs the
  Play/Pause label while `clips.playing`.
- **Not yet (Phase 3):** procedural secondary-motion enrichment, touch-zone
  binding / built-in override (the "bridge"), export/bake-to-source. Clips
  still only play from the Tuner; nothing fires them in normal use yet, and a
  saved clip lives only in that browser's `localStorage`.

## Design philosophy

Animations stay **procedural (code)** by deliberate, standing decision — not
because keyframes weren't considered. See
[CLAUDE.md § Animation authoring / tuning workflow](../CLAUDE.md) for the
full agreement. Summary:

- **Path A — procedural + exposed parameters (default).** Claude writes the
  animation in code, then exposes its values as Tuner knobs. The user tunes
  by eye and hands back deltas; Claude bakes them into the source
  (`value*e` alongside existing envelope-scaled offsets). The user does not
  need to know animation — mapping intent to knobs is Claude's job.
- **Path B — keyframe clips (opt-in, not built).** Reserved for a *new*
  freehand animation that parameters genuinely can't express. Would be a
  parallel, additive, per-animation clip system — existing procedural
  animations would stay untouched. Kept in back pocket; not implemented.

Two eases are used deliberately asymmetrically in `envelope()`: `easeOut`
for the attack (fast start, gentle arrival — a real limb accelerates
immediately under muscle) and `easeInOut` for the release (unchanged,
because settling to idle doesn't have the same "catching up" problem).

## Important decisions

- **`armBase()` before any gesture that specifies absolute angles.** Without
  it, a gesture inherits `ARM_FORWARD`/`ELBOW_BEND` from the idle rest pose,
  which composes with the gesture's own Z fold into a twisted result.
- **Twist is a separate channel from the Euler offset.** Summing an X roll
  into the XYZ Euler swings the limb out of plane instead of rolling it;
  `pose.twist()` applies afterward, in the bone's own frame, weighted
  ~30/70 toward the wrist (twisting a forearm at its root pinches the mesh).
- **Bone rotation signs mirror by side.** Raising an arm subtracts on the
  left, adds on the right (`m = side==='left' ? -1 : 1`). Getting it backward
  swings the limb through the body. See CLAUDE.md Conventions. For a *lowered*
  arm the axes compose oddly (a large `ARM_DOWN` Z term dominates) — tune
  hand depth at the elbow fold, not the shoulder.
- **Tail wag axis is `'auto'` by default, never `'y'`.** On this rig (and
  most VRM tails) Y runs *along* the bone, so rotating there twists the tail
  on its own axis — computed but visually inert. `'auto'` picks whichever
  bending axis the curl isn't using.
- **`flusterDebug` object.** Every offset in the fluster (groin-cover)
  reaction reads from a dedicated tunable object rather than inline
  constants, because that pose was iterated on heavily via the Tuner and the
  forward-hunch mechanism (curling spine+chest forward about the hip base,
  not sideways arm splay) was non-obvious to arrive at.

## Known limitations

- Motion-dominant gestures (wave, shuffle, shake, tail-swish) are only
  partially capturable by the Tuner's static end-pose — timing, stagger, and
  follow-through don't show up in a frozen peak. Pose-dominant reactions
  (fluster, bellyRub) are ~90% captured this way; motion-dominant ones are
  the eventual case for Path B.
- `gestures.update()` temporarily monkey-patches `pose.add`/`pose.twist` to
  scale by `gestures.gain` — this works but means the gesture functions
  themselves are unaware of the fade; a bug in the wrapper would silently
  affect every gesture at once.
- No two gestures can play simultaneously (by design — `gestures.cur` is a
  single slot), so gesture variety at any instant is capped at one plus
  always-on idle plus at most one reaction.

## Future ideas

- Path B keyframe-clip system, if a freehand animation ever needs it (see
  Design philosophy above).
- Consider splitting `GESTURES` tuning constants out of inline magic numbers
  into `config.js` for the gestures that get iterated on most, following the
  `flusterDebug` precedent — only worth it for gestures that turn out to need
  repeated live tuning.

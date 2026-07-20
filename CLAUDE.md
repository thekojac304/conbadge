# Con Badge — CLAUDE.md

**Live:** https://thekojac304.github.io/conbadge/ · **Repo:** `thekojac304/conbadge`

## What it is

A wearable digital con badge. Loads a `.vrm` avatar (VRChat export or VRoid) on
a phone worn on a lanyard. Fully procedural animation — no animation clips.
Everything runs client-side; the avatar never leaves the device.

Primary avatar: **KOJAC**, a red/white/blue fox-husky. VRM 0.x, ~409 morph
targets, 3 meshes, tail 6 bones, ears 4 bones, 0 spring bones.

## Workflow

Plain ES modules; no build step. Files are uploaded to GitHub via the web UI,
so **files sit at the repo root — there is no `js/` subfolder.** A `js/`
subfolder caused GitHub's uploader to flatten paths and 404.

Each iteration:
1. Bump `CONFIG.BUILD` in `config.js` (e.g. `b34` → `b35`)
2. Hand over only the changed files
3. User uploads them (same filename replaces)
4. User confirms the new stamp in the on-screen load readout

The service worker is network-first for the app, so a normal reload picks up
changes — no cache-clearing needed.

### Verification before handing over files

- **Module-mode parse**: copy each changed file to `.mjs` and `node --check`.
  Plain `node --check file.js` parses as a *script* and misses ESM-only errors.
- **Runtime harness**: stub THREE + DOM, import `main.js`, execute several
  frames, call every gesture. Catches undefined references static analysis
  can't.
- **Cross-module leak check**: strip comments/strings, confirm no module uses
  an identifier owned by another module without importing it.
- **Confirm the bumped stamp is actually in the emitted file** before handing
  it over.

Keep verification proportionate — the structure is stable, so parse + harness
is usually enough. Don't echo large file sections back into the chat.

## Architecture

three.js `0.169.0` and `@pixiv/three-vrm` `3.4.0` load from a CDN via an
import map in `index.html`.

| File | Role |
|---|---|
| `config.js` | All tuning constants + `TOUCH_ZONES` |
| `core.js` | Renderer/scene/camera, `rig`, `S`, `settings`, storage, sensors, `hooks` |
| `pose.js` | `PoseAccumulator`, expression driver, arm IK, `anchorWorld` |
| `camera.js` | Framing, saved views, pan clamp, parallax, `renderScene`, `skeletonBox` |
| `anim.js` | Idle, gestures, tail/ears, particles, petting, reactions, `applyHipsDrop` |
| `avatar.js` | VRM load, mesh repair, morph pruning, rig measurement |
| `input.js` | Taps, petting drags, swipe trail, long-press, play-mode escape |
| `ui.js` | Settings sheet, modes, test bar, blendshape browser |
| `main.js` | Frame loop + boot |

**Dependencies flow one way, no cycles:** `config` → `core` → `pose` →
`camera` → `anim` → `avatar`/`input` → `ui` → `main`.

Three deliberate structural choices, each breaking a would-be cycle:
- **`S` object in `core.js`** holds cross-module mutable state (`vrm`,
  `hipsDrop`, `frameScale`, `lastInteract`, …). ES modules can't reassign an
  imported binding, so anything that changes lives on `S`.
- **`hooks` object in `core.js`** lets low-level code call up: `onAvatarLoaded`,
  `openSettings`, `closeSettings`, `setMode`, `onShake`.
- **`skeletonBox` lives in `camera.js`**, not `avatar.js`, so `camera` never
  has to import `avatar`.

## Conventions that matter

**Bone rotation signs.** Normalised VRM bones are world-aligned. Raising an
arm *subtracts* on the left and *adds* on the right
(`m = side==='left' ? -1 : 1`). Getting this backwards swings the limb through
the body.

**`armBase(side, w)`** neutralises the idle resting arm pose so a gesture can
use *absolute* angles. Without it, gestures inherit `ARM_FORWARD` and
`ELBOW_BEND` on Y, which combine with a Z elbow fold into a twisted composite
rotation.

**`pose.twist(bone, x)`** is a separate axial-roll channel applied *after* the
euler offset, in the bone's own frame. Summing an X roll into the XYZ euler
does not twist the limb — it swings it out of plane. Weight twists ~30/70
toward the wrist; twisting a forearm at its root pinches the mesh.

**`armReach(side, target, w)`** is two-bone IK using measured bone lengths.
Prefer it over hand-tuned angles for anything that must touch the body —
hardcoded angles only fit one set of proportions. The IK places the **wrist**,
so subtract a paw-length holdoff.

**Proportional offsets.** Touch zones and gesture targets are expressed as
fractions of `rig.touchScale` (hips→head span) and projected along
`rig.forward` / lateral axes. Absolute metre offsets land badly across avatars
of different scale.

**Mobile GPU limits.** Meshes with hundreds of morph targets silently fail to
render on mobile GPUs. `setupMorphs()` must keep only name-matched morphs
(capped) and prune the rest.

**Renderer sizing.** Always use `renderer.setSize(w,h)` (not `false` as the
third arg) plus CSS `#view{width:100%;height:100%}`.

**VRM bind pose.** VRMs bind in T-pose; the idle animation must apply an
always-on resting pose.

**Spring bones.** This VRM has none — tail/ear motion is procedural, with a
phase lag per joint so motion travels down the chain as a wave.

**Loose meshes.** Some VRM conversions leave rigid props unskinned and
unparented; `attachLooseMeshes()` re-parents them to the nearest bone. This
only fixes rigid props — a deforming garment needs re-weighting in the export.

## Debugging aids in place

- **Test bar** (clapperboard icon): fires any gesture or reaction on demand,
  skipping the fade-in.
- **On-screen error handler** in `index.html`: prints uncaught errors and
  rejections into the diagnostic box with file and line — essential since the
  user is usually on a phone with no DevTools.
- **`ZONE_DEBUG`**: colour-coded dots at every touch anchor.
- **`SOLID_DEBUG`**: flat-shades meshes to separate geometry from material
  issues.
- **Load readout**: VRM version, build stamp, mesh list classification, morph
  counts, matched expressions, tail/ear/spring counts.

## Cost management

Long threads get expensive: every turn re-reads the whole history, and this
project generates lots of screenshots and code dumps. Prefer cropped images or
pasted error text, batch related requests, and start a fresh conversation when
a thread gets long.

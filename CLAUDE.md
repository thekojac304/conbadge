# Con Badge — CLAUDE.md

**Live:** https://thekojac304.github.io/conbadge/ · **Repo:** `thekojac304/conbadge`

## What it is

A wearable digital con badge. Loads a `.vrm` avatar (VRChat export or VRoid) on
a phone worn on a lanyard. Fully procedural animation — no animation clips.
Everything runs client-side; the avatar never leaves the device.

Primary avatar: **KOJAC**, a red/white/blue fox-husky. VRM 0.x, ~409 morph
targets, 3 meshes, tail 6 bones, ears 4 bones, 0 spring bones.

## Documentation (`/docs`)

`/docs` is persistent memory **between Claude Code sessions** — each new
session starts cold, so `/docs` (not scrollback) is the source of truth for
subsystem design, decisions, and limitations. Read it at the start of a
session before diving in; start with
[docs/current-focus.md](docs/current-focus.md) for what's active right now.

| File | Covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Module structure, dependency flow, `S`/`hooks`/`rig` |
| [docs/animation.md](docs/animation.md) | Pose pipeline, idle/gestures/reactions, Tuner, Path A/B |
| [docs/rendering.md](docs/rendering.md) | VRM load, mesh repair, morph pruning, camera framing/IK |
| [docs/lighting.md](docs/lighting.md) | The "Look" lighting/shading system |
| [docs/ui.md](docs/ui.md) | Settings sheet, modes, test bar, Tuner UI, touch input |
| [docs/performance.md](docs/performance.md) | Mobile GPU limits, morph capping, battery saver |
| [docs/workflow.md](docs/workflow.md) | Upload loop, build stamp, verification steps |
| [docs/current-focus.md](docs/current-focus.md) | **Session handoff** — what's active right now |

**Keeping it current is part of the normal workflow, not a separate task.**
Whenever a change touches architecture, a subsystem's behavior, or
introduces a standing decision (a tuning convention, a deliberate tradeoff,
a "why we didn't do X"), update the relevant `docs/*.md` file(s) in the
*same* handover as the code change — don't let docs drift out of sync with
what's actually shipped. Always update
[docs/current-focus.md](docs/current-focus.md) as work moves between areas,
even on turns that don't touch other docs. A doc update doesn't need its own
round-trip: fold it into the same message as the code change.

## Workflow

Plain ES modules; no build step. **Files sit at the repo root — there is no
`js/` subfolder.** (Originally required because GitHub's web uploader
flattened subfolder paths and 404'd; kept even now that changes go through
git, since restructuring isn't worth the churn.)

Claude Code has direct git access to this working copy and pushes to `origin
main` after each iteration — **always asking for confirmation before
pushing**, per standing repo policy, never pushing silently. GitHub Pages is
configured to deploy from `main` directly (no Actions workflow), so a
confirmed push goes live in ~30–60s with no separate publish step.

Each iteration:
1. Bump `CONFIG.BUILD` in `config.js` (e.g. `b34` → `b35`)
2. Verify the change (see below)
3. Claude commits and asks before pushing; user confirms
4. User confirms the new stamp in the on-screen load readout on their phone

The service worker is network-first for the app, so a normal reload picks up
changes — no cache-clearing needed.

### Animation authoring / tuning workflow (agreed)

Animations stay **procedural (code)** — this is the default and is not to be
converted to keyframes wholesale (that would risk degrading the existing feel;
the user is rightly cautious about it). Two paths, chosen deliberately:

- **Path A — procedural + exposed parameters (default, low-risk).** Claude
  writes the animation in code, then exposes its meaningful values (pose deltas,
  timing, amplitudes) so the user can fine-tune them live. This is the
  `flusterDebug` pattern generalized, and the **Animation Tuner** (in `ui.js`,
  test-bar `⚙ Tuner`) is the live surface: it holds any gesture/reaction frozen
  at its peak and adds per-bone X/Y/Z/twist offsets, face-morph weights, and
  ear/tail offsets, printing them back as `pose.add`/`pose.twist`/`setExpr`
  deltas. The user tunes by eye ("too fast", "ears should pin back") and hands
  back values or deltas; Claude bakes them in. **The user does not need to know
  animation** — mapping their intent to knobs is Claude's job. Tuner deltas are
  ADDITIVE on the animation's own pose, scaled by the envelope `e`, so bake them
  as `value*e` alongside the existing offsets.
- **Path B — keyframe clips (ultra-custom, opt-in, later).** Only for a *new*
  freehand animation that parameters can't express. Would be a parallel,
  additive data-driven clip system (keyframes + a shared player that also does
  editor preview) — existing procedural animations stay untouched. Not built;
  keep in back pocket. If a keyframe clip ever feels stiff it is simply
  discarded — nothing existing is at risk because clips are per-animation and
  additive.

When the user reports a pose as tuner deltas, ask (or accept) a one-line note on
*feel* (speed, which parts lead, ear/tail reaction) — a static end-pose does not
encode timing, stagger, anticipation, or follow-through. Pose-dominant
animations are ~90% captured by the end pose; motion-dominant ones (wave,
shuffle, shake, tail-swish) are not, and are the case Path B eventually serves.

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
| `light.js` | Lighting/shading "Look" system: light rig, tone mapping, MToon treatment |
| `pose.js` | `PoseAccumulator`, expression driver, arm IK, `anchorWorld` |
| `camera.js` | Framing, saved views, pan clamp, parallax, `renderScene`, `skeletonBox` |
| `anim.js` | Idle, gestures, tail/ears, particles, petting, reactions, `applyHipsDrop` |
| `avatar.js` | VRM load, mesh repair, morph pruning, rig measurement |
| `input.js` | Taps, petting drags, swipe trail, long-press, play-mode escape |
| `ui.js` | Settings sheet, modes, test bar, blendshape browser |
| `main.js` | Frame loop + boot |

**Dependencies flow one way, no cycles:** `config` → `core` → `light`/`pose` →
`camera` → `anim` → `avatar`/`input` → `ui` → `main`. `light` imports only
`config` + `core` (like `pose`); `avatar`, `ui` and `main` import into it.

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

## Lighting / shading "Look" system (`light.js`)

Self-contained and removable. Owns the scene lights, renderer tone mapping, and a
per-material MToon treatment. A **Look** (Studio/Warm/Cool/Anime Pop) bundles a
light rig, exposure, and MToon params (cool shadow tint, toony terminator,
parametric fresnel rim, outline); the internal `flat` Look = the original
baseline, used only when lighting is switched off. MToon avatars get the full
treatment; MeshStandard avatars are carried by the rig + tone mapping alone. The
load readout prints `look <name> · MToon n/Std n`.

**User controls** live in Settings → Appearance: a master **Lighting** on/off
switch (`settings.lightOn`), the **Look** style selector (`settings.look`), and
**Brightness** (`settings.lightIntensity`) + **Rim light** (`settings.rimIntensity`)
sliders. Brightness scales the whole rig; Rim adds a multiplier on the rim light
alone. The two sliders only re-run `applyLightRig()` (cheap); the toggle and Look
also re-run `applyLook()` to re-treat materials. When the switch is off the style
selector and sliders grey out.

- **Configure:** edit the `LOOKS` presets in `light.js`; defaults via
  `CONFIG.LIGHTING_DEFAULT`. Slider ranges are in `index.html` (Brightness 40–180%,
  Rim 0–200%); code clamps gains to [0, 2].
- **Disable:** flip the Lighting switch off, or set `CONFIG.LIGHTING=false` to
  hard-disable. Both fall back to `flat`, which restores captured original material
  values — a true no-op.
- **Remove:** delete `light.js`; drop its imports/calls in `main.js`, `avatar.js`,
  `ui.js`; remove the Lighting card (`tg-light` / `sel-look` / `light-int` /
  `rim-int`) in `index.html`; paste the three baseline lights (see `BASE` in
  `light.js`) back into `core.js`.

Outlines are only tuned when the avatar already ships one (`outlineWidthMode>0`);
the system never force-enables the outline pass (unreliable at runtime).

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

# Con Badge — CLAUDE.md

**Live:** https://thekojac304.github.io/conbadge/ · **Repo:** `thekojac304/conbadge`

## What it is

A wearable digital con badge. Loads a `.vrm` avatar (VRChat export or VRoid) on
a phone worn on a lanyard. Fully procedural animation — no animation clips.
Everything runs client-side; the avatar never leaves the device.

Primary avatar: **KOJAC**, a red/white/blue fox-husky. VRM 0.x, ~409 morph
targets, 3 meshes, tail 6 bones, ears 4 bones, 0 spring bones.

## Documentation — start here every session

`/docs` is persistent memory **between Claude Code sessions**; each session
starts cold, so `/docs` (not scrollback) is the source of truth. Recommended
startup sequence:

1. Read this file (`CLAUDE.md`).
2. Read [docs/index.md](docs/index.md) — the file map and what each doc covers.
3. Read [docs/current-focus.md](docs/current-focus.md) — what's active right now.
4. Read **only** the subsystem doc(s) relevant to the current task (see the
   table in `docs/index.md`). Don't read the whole folder by default.

**Documentation is part of a feature's definition of done.** When a change
meaningfully touches architecture, behavior, workflow, or a subsystem,
update the relevant docs in the same handover as the code — see
[docs/workflow.md § Documentation maintenance](docs/workflow.md) for the
exact rule: what triggers an update, what doesn't (formatting, refactors,
renames, numeric tuning, minor fixes), and how `current-focus.md` should be
pruned as work resolves rather than left to accumulate.

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

See [docs/workflow.md § Verification before handing over files](docs/workflow.md)
for the full checklist (module-mode parse, runtime harness, cross-module
leak check). Keep it proportionate to the change size; always confirm the
bumped `CONFIG.BUILD` stamp is actually in the emitted file before handing
off. Don't echo large file sections back into the chat.

## Architecture

Plain ES modules, dependency flow one-way, no cycles:
`config → core → light/pose → camera → anim → avatar/input → ui → main`.
See [docs/architecture.md](docs/architecture.md) for the full module table
and the `S`/`hooks`/`rig` shared-state pattern that keeps it acyclic.

## Conventions that matter

Quick-reference only — see the linked doc for the full rationale on each:

- Bone rotation signs, `armBase`, `pose.twist`, `armReach`, and the VRM
  bind-pose invariant → [docs/animation.md § Important decisions](docs/animation.md)
- Proportional offsets and loose-mesh handling → [docs/rendering.md](docs/rendering.md)
- Mobile GPU morph-target limits → [docs/performance.md](docs/performance.md)
- Renderer sizing → [docs/rendering.md § Renderer](docs/rendering.md)

## Lighting / shading

See [docs/lighting.md](docs/lighting.md) for the "Look" system (`light.js`)
— configuration, disable/removal steps, and design rationale.

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

Long threads get expensive. Prefer cropped images or pasted error text,
batch related requests, and start a fresh conversation when a thread gets
long — see [docs/workflow.md § Cost management](docs/workflow.md) for why
this is exactly what `/docs` exists to make cheap.

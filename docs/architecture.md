# Architecture

## Current implementation

Plain ES modules, no build step, no bundler. `three.js` `0.169.0` and
`@pixiv/three-vrm` `3.4.0` load from a CDN via an import map in `index.html`
(three-vrm imports bare `"three"`, so the map must resolve both to one
copy). Files sit at the repo root (not in a `js/` subfolder — see
[workflow.md](workflow.md)).

Dependency flow is one-directional, no cycles:

```
config → core → light/pose → camera → anim → avatar/input → ui → main
```

| File | Role |
|---|---|
| `config.js` | All tuning constants + `TOUCH_ZONES` map |
| `core.js` | Renderer/scene/camera, `rig`, `S`, `settings`, storage, sensors, `hooks` |
| `light.js` | Lighting/shading "Look" system: light rig, tone mapping, MToon treatment |
| `pose.js` | `PoseAccumulator`, expression driver, arm IK, `anchorWorld` |
| `camera.js` | Framing, saved views, pan clamp, parallax, `renderScene`, `skeletonBox` |
| `anim.js` | Idle, gestures, tail/ears, particles, petting, reactions, `applyHipsDrop` |
| `avatar.js` | VRM load, mesh repair, morph pruning, rig measurement |
| `input.js` | Taps, petting drags, swipe trail, long-press, play-mode escape |
| `ui.js` | Settings sheet, modes, test bar, blendshape browser, Animation Tuner |
| `main.js` | Frame loop + boot sequence |

`light.js` and `pose.js` sit at the same dependency depth: both import only
`config` + `core`, so neither creates a cycle with the other.

## Design philosophy

Three deliberate structural choices exist specifically to keep the dependency
graph acyclic:

- **`S` object in `core.js`** holds cross-module mutable state (`vrm`,
  `hipsDrop`, `frameScale`, `lastInteract`, `lastBuffer`, …). ES modules can't
  reassign an imported binding, so anything that changes at runtime has to
  live on a shared mutable object rather than as a module-level `let`.
- **`hooks` object in `core.js`** lets low-level code call "up" into
  higher-level modules without importing them: `onAvatarLoaded`,
  `openSettings`, `closeSettings`, `setMode`, `onShake`. E.g. `core.js`'s
  device-motion handler calls `hooks.onShake?.()`, which `anim.js` wires to
  the dizzy reaction — `core.js` never imports `anim.js`.
- **`skeletonBox` lives in `camera.js`**, not `avatar.js`, so `camera.js`
  never has to import `avatar.js` (camera needs bounding-box logic before
  avatar-load concerns like morph pruning are relevant).

The `rig` object (also in `core.js`) is the other big shared structure: it's
populated once per avatar load (in `avatar.js`) and read every frame by
`anim.js`, `pose.js`, `camera.js`, `input.js`. It holds both **normalized**
bones (`rig.bones`, what gets animated) and **raw** bones (`rig.raw`, actual
render-space nodes used for world-position measurement — see
[rendering.md](rendering.md)).

## Important decisions

- **No build step, no bundler.** Files are uploaded individually via the
  GitHub web UI. This constrains the whole architecture toward flat,
  independently-loadable ES modules — see [workflow.md](workflow.md) for why.
- **Everything runs client-side.** The avatar file never leaves the device
  (loaded via `<input type=file>` + IndexedDB cache, no server upload).
- **Procedural animation, not keyframe clips.** See
  [animation.md](animation.md) for the full rationale — this is a standing
  decision, not an oversight.
- **`light.js` is self-contained and removable by design** — see
  [lighting.md](lighting.md). It was added after the initial architecture was
  stable, and its dependency position (imports only `config` + `core`) was
  chosen specifically so it could be deleted without touching the rest of the
  dependency graph.

## Known limitations

- Cross-module state via `S`/`rig`/`hooks` trades type-safety and
  discoverability for zero-cycle simplicity — there's no compiler to catch a
  typo'd property name on `S` or `rig`. Grep is the only enforcement.
- No automated tests. Verification is manual (parse checks, a runtime
  harness, visual testing in-browser) — see [workflow.md](workflow.md).

## Future ideas

- If the module count keeps growing, consider whether `anim.js` (currently
  ~900 lines: idle + gestures + reactions + tail/ear + particles + petting +
  tuner plumbing) should split along those seams. Not urgent — it reads fine
  top-to-bottom today.

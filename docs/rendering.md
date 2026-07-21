# Rendering

Covers VRM loading (`avatar.js`), camera framing (`camera.js`), and the
renderer itself (`core.js`). Lighting/shading is a separate system — see
[lighting.md](lighting.md).

## Current implementation

### VRM load (`mountVRM()` in `avatar.js`)

1. Parse the `.vrm` buffer via `GLTFLoader` + `VRMLoaderPlugin`.
2. `VRMUtils.rotateVRM0()` normalizes VRM 0.x facing to +Z (no-op for VRM
   1.0). **`combineSkeletons`/`removeUnnecessaryVertices` are deliberately
   NOT used** — on some VRChat→VRM conversions they mis-bind body skinning,
   collapsing the body mesh while accessories still render.
3. Per-mesh fixes: `frustumCulled = false` (skinned meshes get wrongly culled
   on mobile), `DoubleSide` (fixes bodies with inverted normals/cull mode —
   a common cause of "only the accessory renders"), metalness forced to 0,
   low roughness bumped to 0.8, near-zero opacity treated as a mistaken
   transparency flag.
4. `setupMorphs()` prunes the morph set (see [performance.md](performance.md)).
5. `attachLooseMeshes()` re-parents rigid, unskinned, unparented meshes to
   the nearest bone by world-position distance, using `Object3D.attach()` so
   nothing jumps. This only fixes *rigid* props — a garment that should
   deform needs re-weighting in the original export.
6. `applyLook(v)` applies the current lighting Look to materials.
7. Rig resolution: normalized bones (`rig.bones`, what gets animated) and raw
   bones (`rig.raw`, actual render-space nodes) are both captured per entry
   in `MANAGED` (humanoid bones + finger bones). Rest quaternions are
   captured after one `v.update(0)` call so the normalized rest pose is
   valid.
8. Measurement pass: arm segment lengths (`rig.armL1`/`armL2`, for
   `armReach` IK), lateral axis (`rig.lateral`, for IK and touch-zone
   projection), `rig.touchScale` (hips→head span — the unit touch-zone
   offsets are expressed in), `rig.legLength` (hips→foot, scales the idle
   bounce sink).
9. `discoverNamedBones()` finds tail/ear nodes by regex on node names (no
   VRM standard for these), ordered root→tip by hierarchy depth so wag
   amplitude can fall off correctly.
10. `frameCamera()` runs, idle/gesture/reaction state resets, diagnostics are
    written to the on-screen load readout.

### Camera framing (`frameCamera()` in `camera.js`)

- **Facing is derived, not assumed.** Forward is computed as perpendicular
  to the shoulder line (`leftShoulder`/`rightShoulder`, falling back to
  upper-arm or hand), not a hardcoded `+Z` guess — so a rotated rig still
  frames and maps touch zones correctly. `CONFIG.FACE_FLIP` negates it for
  avatars that load backward.
- **Bounds come from `skeletonBox()`** (joint world positions: raw bones +
  tail + ears), not a mesh `Box3`, because normalized-bone or skinned-mesh
  bounds don't reliably match render space.
- Frame distance, vertical aim point, and FOV-based fit distance all derive
  from measured skeleton size — no hardcoded metre distances (this avatar is
  ~0.6× human scale; a fixed distance would misframe others).
- **A "view"** is stored as the camera's spherical offset from the framing
  target + a vertical pan (`currentView()`/`applyView()`), not raw world
  coordinates — this survives avatar reloads and window resizes.
- **Tilt parallax** (`updateParallax`/`renderScene`) swings the camera a few
  degrees around the subject as the phone tilts, applied only around the
  render call and undone immediately after, so `OrbitControls` never sees
  the offset and doesn't treat it as user input drift.

### Renderer

`THREE.WebGLRenderer` with `alpha:true` (transparent canvas over the CSS
background gradient), `powerPreference:'high-performance'`,
`outputColorSpace = SRGBColorSpace`. Sized via `renderer.setSize(w,h)` (not
the `false` third-arg form) plus CSS `#view{width:100%;height:100%}` — using
the `false` form or omitting the CSS half breaks mobile viewport sizing.
Pixel ratio is capped at `CONFIG.DPR_MAX` (2), tighter (1.5) in saver mode.

## Design philosophy

Framing and touch-zone placement are **derived from measurement**, never
hardcoded per-avatar. This is the single biggest reason KOJAC-specific
tuning (arm angles, camera distance, touch anchors) survives loading a
different VRM at all — everything is either a fraction of `rig.touchScale`/
`rig.legLength`, or solved via IK against measured bone lengths, or derived
from the shoulder line. See CLAUDE.md Conventions: "Proportional offsets."

## Important decisions

- **Normalized vs. raw bones is a hard split, not a style choice.**
  Animation writes to `rig.bones` (normalized); anything measuring world
  position reads `rig.raw` (raw, matches what's actually rendered).
  Mixing them up produces measurements that don't match the visible pose.
- **`VRMUtils.combineSkeletons`/`removeUnnecessaryVertices` are avoided**
  (see step 2 above) — this was a deliberate rollback after it broke body
  skinning on some conversions, not an unused-optimization oversight.
- **Loose-mesh reattachment only fixes rigid props**, not deforming
  garments — documented in the function's own comment and worth restating
  here since it's an easy fix to reach for on the wrong kind of bug.

## Known limitations

- Tail/ear discovery is name-regex based (`/tail|shippo|しっぽ|尻尾/i`, similar
  for ears) — an avatar with unconventional bone names won't get tail/ear
  motion at all, silently.
- `frameCamera()`'s upper-body fit (`size.y*0.62`, aim at `box.max.y -
  size.y*0.20`) is tuned for a roughly humanoid proportion; a very
  non-humanoid VRM (no legs, unusual torso ratio) would frame oddly.
- No fallback if `leftShoulder`/`rightShoulder`/`leftUpperArm`/`rightUpperArm`
  /`leftHand`/`rightHand` are *all* missing — forward defaults to `(0,0,1)`,
  which is only correct by luck.

## Future ideas

- None currently tracked. Framing/rig-measurement code has been stable
  since the KOJAC avatar was fitted; revisit only if a second avatar with
  meaningfully different proportions or bone naming is added.

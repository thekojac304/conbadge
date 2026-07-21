# Performance

The target device is a **phone worn on a lanyard**, often mid-range or
older, running continuously for hours at a con. Every constraint here traces
back to that.

## Current implementation

### Morph-target pruning (`setupMorphs()` in `avatar.js`)

VRoid/VRChat exports ship hundreds of blendshapes (KOJAC has ~409). Mobile
GPUs **silently fail to render a mesh** with too many active morph targets —
not a crash, just nothing drawn. On load, morphs are matched **by name**
against `MORPH_PATTERNS` regexes (VRoid `Fcl_*` naming, common English
names, etc.), the matched set plus any user-enabled custom morphs are kept,
everything else is pruned from the geometry entirely
(`geometry.morphAttributes`, `morphTargetDictionary`, indices remapped). A
hard cap, `CONFIG.MORPH_CAP` (48 per mesh), is enforced regardless of match
count as a safety backstop.

Blink is handled specially: many models have both a combined "Close" morph
and separate `_L`/`_R` ones. Driving all three simultaneously stacks to
~200% weight and pushes the eyelids through the face, so only the combined
morph is kept if present; separate L/R are only used as a fallback pair.

### Battery saver (`settings.saver`)

Throttles animation + render to 30fps by accumulating delta time and only
running a frame once `S.acc >= 1/30`, but animates using the *accumulated*
elapsed time (not a fixed step) so motion speed stays correct rather than
appearing to slow down. Also caps device pixel ratio at 1.5 instead of
`CONFIG.DPR_MAX` (2).

### Pixel ratio cap

`CONFIG.DPR_MAX = 2` regardless of saver mode — an uncapped `devicePixelRatio`
on a high-density phone screen multiplies fill-rate cost for no visible
benefit at arm's length.

### Particle pool

Fixed pool of 28 sprites (`particles.pool`), created once at first use, never
allocated per-frame. Spawning reuses a free slot or silently skips if the
pool is exhausted — no dynamic growth.

### Loose-mesh / material fixes done once at load, not per-frame

`attachLooseMeshes()`, `frustumCulled = false`, material-side/opacity fixes
all run once during `mountVRM()`, not in the render loop.

## Design philosophy

**Correctness on mobile GPUs takes priority over blendshape completeness.**
Pruning to name-matched morphs is a deliberate trade: the badge loses access
to blendshapes it doesn't use anyway (most of a VRoid export is unused
customization sliders), in exchange for guaranteed rendering. This is stated
explicitly in `avatar.js`'s own comments and is not considered a bug to fix
by "just keeping more morphs."

## Important decisions

- The mobile-GPU morph-target failure mode is **silent** (mesh doesn't
  render, no console error) — this is *why* pruning exists at all, and why
  `CONFIG.MORPH_CAP` is a hard backstop rather than trusting the name-match
  regex to always land under a safe count.
- Custom user-enabled morphs go through the *same* remount pipeline as
  animation morphs (`setupMorphs()`), so the cap and the pruning logic apply
  uniformly — there's no separate unbounded path for user customization.

## Known limitations

- Enabling a previously-pruned morph via the blendshape browser costs a full
  VRM remount (see [ui.md](ui.md)) — there's no incremental way to add one
  morph back without rebuilding the geometry's morph attributes.
- `CONFIG.MORPH_CAP` (48) is a single global number; there's no per-avatar or
  per-mesh tuning if a future avatar's GPU-safe cap differs meaningfully.
- No frame-time budget or dynamic quality scaling — saver mode is a manual
  user toggle, not auto-detected from measured frame time.

## Future ideas

- None currently tracked. Revisit if a future avatar or device profile shows
  the current 48-morph cap or 2× DPR cap causing visible slowdown.

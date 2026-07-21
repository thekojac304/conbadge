# Lighting / Shading — the "Look" system

Owned entirely by `light.js`. This doc summarizes; `light.js`'s own header
comment is the source of truth for exact removal/disable steps.

## Current implementation

A **Look** bundles four things:

- a light rig (hemisphere + key directional + rim directional, with color/
  intensity/position),
- a tone-mapping exposure (`none` or ACES Filmic),
- an MToon parameter set (shadow tint, toony/shift terminator shaping,
  parametric fresnel rim, outline width/color),
- a **backdrop palette** (`bg`: gradient stops + three orb glow colours). This
  is consumed by the CSS backdrop, not the 3D scene — `lookBackground()`
  exposes the active Look's `bg` and `ui.js`'s `applyBackground()` writes it to
  `:root` when "Match lighting" is on. See [ui.md](ui.md) / [rendering.md](rendering.md).

Four user-facing Looks: **Studio** (neutral warm key / cool rim, the
default), **Warm** (sunset, violet shadows), **Cool** (night, teal rim),
**Anime Pop** (punchy, hard cel break, bold outline). A fifth internal Look,
`flat`, exactly reproduces the project's pre-lighting-system baseline (the
three lights that used to live directly in `core.js`) and is used only when
lighting is switched off — never user-selectable.

MToon fields only apply to `MToonMaterial` instances; `MeshStandardMaterial`
avatars are carried by the light rig + tone mapping alone (`applyLook()`
counts and reports both: `look studio · MToon 3/Std 0`).

Outline tuning only touches an outline the avatar **already ships with**
(`outlineWidthMode > 0`) — the system never force-enables the outline pass,
since runtime-enabling it is unreliable across VRM conversions.

### User controls (Settings → Appearance)

- **Lighting** on/off master switch (`settings.lightOn`)
- **Look** style selector (`settings.look`)
- **Brightness** slider (`settings.lightIntensity`, 40–180%, scales the
  whole rig)
- **Rim light** slider (`settings.rimIntensity`, 0–200%, multiplies on top
  of Brightness, rim only)

Brightness/Rim only re-run `applyLightRig()` (cheap — no material touch).
The on/off toggle and the Look selector also re-run `applyLook()` to
re-treat materials. When the switch is off, the style selector and both
sliders grey out.

A subtle autonomous rim "breathing" (`updateLights(dt)`, one sine) runs each
frame so shading reads as alive rather than static — a no-op on the `flat`
Look.

## Design philosophy

**Self-contained and removable.** `light.js` imports only `config` + `core`
(same dependency depth as `pose.js`), so it never creates a cycle and can be
deleted without restructuring anything else. It's imported *into* by
`main.js` (init + per-frame drift), `avatar.js` (material treatment on
load), and `ui.js` (the Look selector) — but nothing it imports depends on
it.

**`flat` is a true no-op**, not an approximation of "off." Material
originals are cached on first treatment (`m.userData._lk`) so switching to
`flat` (or disabling the system) restores captured values exactly rather
than resetting to some computed default.

## Important decisions

- Two-tier gain: `CONFIG.LIGHTING` is a hard kill switch (code-level);
  `settings.lightOn` is the user-facing toggle. `lightingOn()` checks both.
- Shadow tint is computed as `baseColor × shadeTint`, *not* an independent
  color — so the cool/violet shadow reads as the avatar's own fur color in
  shadow, not a colored overlay.
- Brightness and Rim gains are clamped to `[0, 2]` regardless of slider
  range, as a defensive cap on the config side.

## Known limitations

- MToon-specific fields (`shadeColorFactor`, `parametricRimColorFactor`,
  etc.) silently no-op on non-MToon materials via `'field' in m` checks —
  correct behavior, but means a Standard-material avatar gets zero visual
  difference between Looks beyond the shared light rig + tone mapping.
- Outline tuning is opt-in per-avatar (only touches existing outlines) — an
  avatar without a shipped outline pass can't get one from this system.

## Removal / disable reference

- **Disable at runtime:** flip the Lighting switch off, or set
  `CONFIG.LIGHTING = false` to hard-disable. Both fall back to `flat`.
- **Remove entirely:** delete `light.js`; drop its imports/calls in
  `main.js`, `avatar.js`, `ui.js`; remove the Lighting card (`tg-light` /
  `sel-look` / `light-int` / `rim-int`) in `index.html`; paste the three
  baseline lights (see `BASE` in `light.js`) back into `core.js`.
- **Configure:** edit the `LOOKS` presets in `light.js`; change the default
  via `CONFIG.LIGHTING_DEFAULT`; slider ranges live in `index.html`.

## Future ideas

- None currently tracked. Revisit if a second avatar with very different
  material setup (e.g. all-Standard, no MToon) makes the Look system's
  visual impact feel thin for that avatar.

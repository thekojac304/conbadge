// Lighting + shading "Look" system.  Self-contained and removable: it owns the
// scene lights, the renderer tone mapping, and a per-material MToon treatment.
//
// Dependency position: imports only config + core (like pose does), so it never
// creates a cycle. It is imported by main.js (init + per-frame drift), avatar.js
// (material treatment on load), and ui.js (the Look selector).
//
// TO DISABLE at runtime: flip the Lighting toggle off (settings.lightOn), or set
// CONFIG.LIGHTING=false to hard-disable. Brightness/Rim sliders live in settings too.
// TO REMOVE entirely: delete this file, drop the light.js imports/calls in
// main.js, avatar.js and ui.js, remove the <select id="sel-look"> in index.html,
// and paste the three baseline lights (see BASE below) back into core.js.
import { THREE, scene, renderer, settings } from './core.js';
import { CONFIG } from './config.js';

/* ===========================================================================
   Look presets.
   A Look bundles a light rig (hemi + key + rim), a tone-mapping exposure, and an
   MToon parameter set. `flat` reproduces the project's original baseline exactly,
   so switching to it (or disabling the system) is a true no-op on appearance.

   MToon fields (applied only to MToon materials; ignored on MeshStandard, which
   is carried by the light rig + tone mapping alone):
     shadeTint : multiplies the lit colour to make the SHADOW colour. Cool/violet
                 tints under warm fur are the core "anime" cue.
     toony     : shadingToonyFactor — 1 = hard cel break, lower = softer ramp.
     shift     : shadingShiftFactor — moves the terminator (− = more lit).
     rimColor / rimFresnel / rimLift / rimMix : parametric fresnel rim that does
                 not depend on light position, so it reads from every orbit angle.
     outlineWidth / outlineColor : only applied when the avatar ALREADY has an
                 outline (outlineWidthMode>0); we never force-enable a pass.
   =========================================================================== */
const BASE = {   // === original core.js baseline; "Flat (off)" ===
  exposure:1, tone:'none',
  hemi:{ sky:0xffffff, ground:0x223044, int:1.15 },
  key: { color:0xffffff, int:1.4, pos:[0.6,1.4,1.2] },
  rim: { color:0x8fb4ff, int:0.5, pos:[-0.8,1.0,-1.2] },
  mtoon:null,
  // Backdrop palette when "Match lighting" is on: gradient stops + three orb
  // glow colours (screen-blended, so they read as light). flat = original bg.
  bg:{ a:'#141a2c', b:'#05060b', orbs:['#2a3a6a','#1c4a52','#3a2a55'] },
};

export const LOOKS = {
  flat: BASE,

  studio: {   // neutral, flattering default: warm key, cool strong rim
    exposure:1.05, tone:'aces',
    hemi:{ sky:0xbfd4ff, ground:0x1a2233, int:0.38 },
    key: { color:0xfff2e2, int:1.65, pos:[0.7,1.5,1.1] },
    rim: { color:0xcfe0ff, int:2.4, pos:[-0.9,1.2,-1.3] },
    mtoon:{ shadeTint:[0.52,0.57,0.78], toony:0.9, shift:-0.05,
            rimColor:0xcfe0ff, rimFresnel:3.5, rimLift:0.10, rimMix:0.85,
            outlineWidth:0.0010, outlineColor:0x17121f },
    bg:{ a:'#1a2438', b:'#070b14', orbs:['#3350a0','#1f6a72','#4a3a80'] },
  },

  warm: {     // sunset: warm key, violet shadows, pink rim
    exposure:1.0, tone:'aces',
    hemi:{ sky:0xffd9b0, ground:0x2a1830, int:0.36 },
    key: { color:0xffce9c, int:1.75, pos:[0.8,1.3,1.0] },
    rim: { color:0xff9ec8, int:2.2, pos:[-1.0,1.1,-1.2] },
    mtoon:{ shadeTint:[0.66,0.44,0.54], toony:0.85, shift:-0.04,
            rimColor:0xffc0d8, rimFresnel:3.2, rimLift:0.12, rimMix:0.82,
            outlineWidth:0.0011, outlineColor:0x201018 },
    bg:{ a:'#2a1a2e', b:'#0e0710', orbs:['#c06a3a','#b03a6e','#5a2a80'] },
  },

  cool: {     // night: cool key, blue shadows, teal rim
    exposure:1.0, tone:'aces',
    hemi:{ sky:0x9fb8ff, ground:0x101828, int:0.30 },
    key: { color:0xcfe0ff, int:1.35, pos:[0.6,1.4,1.1] },
    rim: { color:0x88ffe0, int:2.6, pos:[-0.9,1.2,-1.3] },
    mtoon:{ shadeTint:[0.40,0.48,0.72], toony:0.92, shift:-0.05,
            rimColor:0x9ffff0, rimFresnel:3.6, rimLift:0.12, rimMix:0.88,
            outlineWidth:0.0010, outlineColor:0x0c1420 },
    bg:{ a:'#101a34', b:'#040a16', orbs:['#2a5ac0','#1f8a8a','#2a3a90'] },
  },

  pop: {      // anime pop: punchy, hard cel break, bold rim + outline
    exposure:1.1, tone:'aces',
    hemi:{ sky:0xffffff, ground:0x202838, int:0.25 },
    key: { color:0xffffff, int:1.8, pos:[0.7,1.5,1.05] },
    rim: { color:0xffffff, int:2.2, pos:[-0.9,1.2,-1.25] },
    mtoon:{ shadeTint:[0.55,0.50,0.68], toony:1.0, shift:-0.02,
            rimColor:0xffffff, rimFresnel:2.5, rimLift:0.15, rimMix:0.9,
            outlineWidth:0.0016, outlineColor:0x120e18 },
    bg:{ a:'#1e2440', b:'#08040e', orbs:['#4a6cff','#e0489c','#8a3ad0'] },
  },
};

// Styles shown in the settings selector. The on/off state is a separate master
// toggle (settings.lightOn), so `flat` is not a user-selectable style here — it's
// only the internal baseline used when lighting is switched off.
export const LOOK_LIST = [
  { key:'studio', label:'Studio' },
  { key:'warm',   label:'Warm'   },
  { key:'cool',   label:'Cool'   },
  { key:'pop',    label:'Anime Pop' },
];

const TONE = { none:THREE.NoToneMapping, aces:THREE.ACESFilmicToneMapping };

// Master on/off: the CONFIG flag hard-disables; settings.lightOn is the user toggle.
export function lightingOn(){ return CONFIG.LIGHTING && settings.lightOn !== false; }

// Resolve the active Look. When lighting is off we fall back to the flat baseline.
function currentLook(){
  if (!lightingOn()) return LOOKS.flat;
  return LOOKS[settings.look] || LOOKS[CONFIG.LIGHTING_DEFAULT] || LOOKS.studio;
}
function gain(v){ return Math.max(0, Math.min(2, v==null?1:v)); }

// Backdrop palette for the active Look, used by ui.js when "Match lighting" is on.
// Falls back to the flat baseline (original bg) when lighting is off.
export function lookBackground(){ return currentLook().bg || LOOKS.flat.bg; }

/* ===========================================================================
   Light rig
   =========================================================================== */
let hemi=null, key=null, rim=null;   // created lazily in initLights
let rimBaseInt=0, live=false, t=0;

export function initLights(){
  hemi = new THREE.HemisphereLight(0xffffff, 0x223044, 1);
  key  = new THREE.DirectionalLight(0xffffff, 1);
  rim  = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(hemi, key, rim);
  applyLightRig();
}

// (Re)configure lights + tone mapping from the active Look and the user's
// Brightness / Rim sliders. Safe to call live. The flat baseline ignores the
// gains so "off" is always an exact no-op.
export function applyLightRig(){
  if (!hemi) return;
  const L = currentLook();
  const flat = (L === LOOKS.flat);
  const g  = flat ? 1 : gain(settings.lightIntensity);   // overall Brightness
  const rg = flat ? 1 : gain(settings.rimIntensity);     // Rim light, on top of g
  hemi.color.setHex(L.hemi.sky); hemi.groundColor.setHex(L.hemi.ground); hemi.intensity = L.hemi.int * g;
  key.color.setHex(L.key.color); key.intensity = L.key.int * g; key.position.set(...L.key.pos);
  rim.color.setHex(L.rim.color); rim.intensity = L.rim.int * g * rg; rim.position.set(...L.rim.pos);
  rimBaseInt = rim.intensity;
  renderer.toneMapping = TONE[L.tone] || THREE.NoToneMapping;
  renderer.toneMappingExposure = L.exposure;
  live = !flat;
}

// Subtle autonomous rim breathing so the shading reads as alive, not static.
// Cheap (one sin, one assignment) and a no-op on the flat Look.
export function updateLights(dt){
  if (!live || !rim) return;
  t += dt;
  rim.intensity = rimBaseInt * (1 + 0.09 * Math.sin(t * 0.6));
}

/* ===========================================================================
   Per-material treatment (MToon).
   Originals are cached on m.userData._lk so applyLook is idempotent and the
   flat Look restores the material exactly.
   =========================================================================== */
const _c = new THREE.Color();

function eachMaterial(vrm, fn){
  vrm.scene.traverse(o=>{
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats){ if (m) fn(m); }
  });
}

// Returns a one-line summary for the load readout, e.g. "look studio · MToon 3/Std 0".
export function applyLook(vrm){
  if (!vrm || !vrm.scene) return '';
  const L = currentLook();
  let nM=0, nS=0, nO=0;

  eachMaterial(vrm, m=>{
    if (m.isMToonMaterial){ nM++; treatMToon(m, L.mtoon); }
    else if (m.isMeshStandardMaterial){ nS++; }        // carried by the rig alone
    else nO++;
  });

  return `look ${settings.look}${lightingOn()?'':' (off)'} · MToon ${nM}/Std ${nS}`
         + (nO?`/other ${nO}`:'');
}

function treatMToon(m, spec){
  // Cache originals once.
  if (!m.userData._lk){
    m.userData._lk = {
      base:   (m.color || m.shadeColorFactor || _c).clone(),
      shade:  m.shadeColorFactor ? m.shadeColorFactor.clone() : null,
      toony:  m.shadingToonyFactor,
      shift:  m.shadingShiftFactor,
      rimC:   m.parametricRimColorFactor ? m.parametricRimColorFactor.clone() : null,
      rimF:   m.parametricRimFresnelPowerFactor,
      rimL:   m.parametricRimLiftFactor,
      rimMix: m.rimLightingMixFactor,
      owMode: m.outlineWidthMode,
      owF:    m.outlineWidthFactor,
      owC:    m.outlineColorFactor ? m.outlineColorFactor.clone() : null,
    };
  }
  const o = m.userData._lk;

  // Flat / no spec → restore captured originals and stop.
  if (!spec){
    if (o.shade && m.shadeColorFactor) m.shadeColorFactor.copy(o.shade);
    if (o.toony != null) m.shadingToonyFactor = o.toony;
    if (o.shift != null) m.shadingShiftFactor = o.shift;
    if (o.rimC && m.parametricRimColorFactor) m.parametricRimColorFactor.copy(o.rimC);
    if (o.rimF != null) m.parametricRimFresnelPowerFactor = o.rimF;
    if (o.rimL != null) m.parametricRimLiftFactor = o.rimL;
    if (o.rimMix != null) m.rimLightingMixFactor = o.rimMix;
    if (o.owMode > 0){
      if (o.owF != null) m.outlineWidthFactor = o.owF;
      if (o.owC && m.outlineColorFactor) m.outlineColorFactor.copy(o.owC);
    }
    m.needsUpdate = true;
    return;
  }

  // Shadow colour = lit colour × cool tint (computed from the ORIGINAL base).
  if (m.shadeColorFactor){
    m.shadeColorFactor.copy(o.base).multiply(_c.setRGB(...spec.shadeTint));
  }
  if ('shadingToonyFactor' in m) m.shadingToonyFactor = spec.toony;
  if ('shadingShiftFactor' in m) m.shadingShiftFactor = spec.shift;

  if (m.parametricRimColorFactor) m.parametricRimColorFactor.setHex(spec.rimColor);
  if ('parametricRimFresnelPowerFactor' in m) m.parametricRimFresnelPowerFactor = spec.rimFresnel;
  if ('parametricRimLiftFactor' in m) m.parametricRimLiftFactor = spec.rimLift;
  if ('rimLightingMixFactor' in m) m.rimLightingMixFactor = spec.rimMix;

  // Only tune an outline the avatar already ships with — never force one on, since
  // runtime-enabling the outline pass is unreliable across conversions.
  if (o.owMode > 0){
    if ('outlineWidthFactor' in m) m.outlineWidthFactor = spec.outlineWidth;
    if (m.outlineColorFactor) m.outlineColorFactor.setHex(spec.outlineColor);
  }
  m.needsUpdate = true;
}

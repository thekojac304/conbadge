// VRM loading: mesh repair, morph-target pruning, rig measurement, diagnostics.
import { THREE, S, rig, settings, scene, hooks, toast, showOverlay, showError, MANAGED } from './core.js';
import { CONFIG } from './config.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { frameCamera } from './camera.js';
import { idle, gestures, reactions } from './anim.js';

let meshDiag = [];
let morphInfo = '';
let attachedInfo = '';

// Priority lists so we degrade gracefully across VRM 0.x / 1.0 + custom names.
const EXPR_CANDIDATES = {
  happy:     ['happy','joy','fun','relaxed'],
  surprised: ['surprised','surprise'],
  blush:     ['blush','Blush','cheek','embarrassed','surprised','surprise'],
  blink:     ['blink','Blink'],
  blinkL:    ['blinkLeft','blink_l','blinkL'],
  blinkR:    ['blinkRight','blink_r','blinkR'],
};

function resolveExpressions(v){
  const em = v.expressionManager;
  const has = (n)=>{ try{ return n && em && !!em.getExpression(n); }catch{ return false; } };
  const pick = (list)=> list.find(has) || null;
  const out = {};
  for (const k in EXPR_CANDIDATES) out[k] = pick(EXPR_CANDIDATES[k]);
  return out;
}

// Traverse raw scene graph for non-humanoid bones (tail/ears) by name heuristics.
function discoverNamedBones(root){
  const tail=[], ears=[];
  const isTail = n => /tail|shippo|しっぽ|尻尾/i.test(n);
  const isEar  = n => /(^|[^h])ear|mimi|耳/i.test(n) && !/head|hair|gear|near|wear/i.test(n);
  root.traverse(o=>{
    const nm = o.name||'';
    if (isTail(nm)) tail.push(o);
    else if (isEar(nm)) ears.push(o);
  });
  // Order tail root->tip by hierarchy depth so wag amplitude can fall off.
  tail.sort((a,b)=> depth(a)-depth(b));
  return { tail: tail.slice(0,6), ears: ears.slice(0,4) };
}
function depth(o){ let d=0, p=o; while(p){ d++; p=p.parent; } return d; }

/* ===========================================================================
   Morph-target setup (name-based).
   VRoid/VRChat avatars ship hundreds of blendshapes; more than a mobile GPU will
   render, so the whole mesh silently fails to draw. Many converted VRMs also
   have NO VRM "expression" definitions — the blendshapes exist only as named
   morph targets. So we find the ones we need BY NAME (VRoid "Fcl_*" etc.), keep
   just those, prune the rest, and drive them directly. Result: mesh renders and
   the face animates without depending on VRM expression metadata.
   =========================================================================== */
const MORPH_PATTERNS = {
  // 'blink' is MULTI-match: we take every matching morph (both eyes) so the
  // avatar can't end up winking. Others take the first match only.
  blink:     [/^Fcl_EYE_Close/i, /(^|[._])blink/i, /eyes?[._]?close/i, /^vrc\.blink/i, /まばたき/],
  happy:     [/Fcl_ALL_Joy/i, /Fcl_ALL_Fun/i, /(^|[._])(joy|smile|happy|fun|grin)$/i],
  surprised: [/Fcl_ALL_Surprised/i, /surprise/i],
  blush:     [/blush/i, /Fcl_ALL_Sorrow/i],
  // extra shapes used for idle micro-expressions (all optional)
  smile:     [/chill\s*smile/i, /closed\s*smile(?!\s*eyes)/i, /soft\s*smile/i, /slight\s*smile/i, /smile/i],
  smileEyes: [/closed\s*smile\s*eyes/i, /happy\s*eyes/i, /Fcl_EYE_Joy/i, /squint/i],
  browUp:    [/brow.*(up|raise)/i, /raise.*brow/i, /Fcl_BRW_Surprised/i],
  browDown:  [/concerned\s*eyes/i, /brow.*(down|angry)/i, /Fcl_BRW_Angry/i],
  tongue:    [/blep/i, /tongue/i, /Fcl_HA_Fun/i],
};
const MORPH_MULTI = new Set(['blink']);   // semantics that keep ALL matches

/* ---------------------------------------------------------------------------
   Some conversions leave rigid accessories (props, armour plates, sleeves)
   unskinned AND unparented from any bone — they render frozen at their bind
   position while the body animates around them. If we find such a mesh, attach
   it to the closest bone so it at least travels with that body part.
   Object3D.attach() preserves world transform, so nothing jumps on load.
   NOTE: a garment that should DEFORM can't be fixed this way — it'll move
   rigidly with one bone. That needs re-weighting in the original export.
--------------------------------------------------------------------------- */
function attachLooseMeshes(v){
  const bones = [];
  v.scene.traverse(o=>{ if(o.isBone) bones.push(o); });
  if(!bones.length) return [];

  const loose = [];
  v.scene.traverse(o=>{
    if(!o.isMesh || o.isSkinnedMesh) return;
    let p = o.parent, underBone = false;
    while(p){ if(p.isBone){ underBone = true; break; } p = p.parent; }
    if(!underBone) loose.push(o);
  });

  const wp = new THREE.Vector3(), bp = new THREE.Vector3();
  const attached = [];
  for (const m of loose){
    if(!m.geometry) continue;
    if(!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    m.geometry.boundingBox.getCenter(wp);
    m.localToWorld(wp);
    let best = null, bd = Infinity;
    for (const b of bones){
      b.getWorldPosition(bp);
      const dd = bp.distanceToSquared(wp);
      if (dd < bd){ bd = dd; best = b; }
    }
    if (best){ best.attach(m); attached.push((m.name||'?')+'→'+(best.name||'?')); }
  }
  return attached;
}

function stripAllMorphs(v){
  v.scene.traverse(o=>{
    if(o.isMesh && o.geometry?.morphAttributes?.position){
      o.geometry.morphAttributes = {};
      o.morphTargetInfluences = [];
      o.morphTargetDictionary = {};
    }
  });
  rig.morphs = {}; rig.customMorphs = [];
  morphInfo = 'morphs stripped';
}

function setupMorphs(v){
  // 0) capture EVERY morph name before pruning (feeds the blendshape panel and
  //    tells us what this particular conversion actually calls things)
  rig.allMorphs = [];
  v.scene.traverse(o=>{
    if(!o.isMesh || !o.morphTargetDictionary) return;
    for (const name in o.morphTargetDictionary){
      rig.allMorphs.push({ mesh:o, name, origIdx:o.morphTargetDictionary[name] });
    }
  });
  S.allMorphNames = [...new Set(rig.allMorphs.map(e=>e.name))].sort();

  const need  = new Map();     // mesh -> Set(origIdx) to keep
  const found = {};            // semantic -> [entry]
  const mark  = (e)=>{ if(!need.has(e.mesh)) need.set(e.mesh, new Set()); need.get(e.mesh).add(e.origIdx); };

  // 1) animation morphs, matched by name
  for (const sem in MORPH_PATTERNS){
    for (const e of rig.allMorphs){
      if (MORPH_PATTERNS[sem].some(rx=>rx.test(e.name))){
        (found[sem] ||= []).push(e);
        if(!MORPH_MULTI.has(sem)) break;         // first match only
      }
    }
  }

  // Blink needs care: a model usually has BOTH a combined "Close" and separate
  // "_L"/"_R" morphs. Driving all three stacks to ~200% and the lids clip
  // through the face. Prefer the combined one; only fall back to the L/R pair.
  if (found.blink?.length){
    const isSide = n => /[._-](l|r|left|right)$/i.test(n);
    const combined = found.blink.filter(e=>!isSide(e.name));
    const sides    = found.blink.filter(e=> isSide(e.name));
    let chosen = combined.length ? [combined[0]] : sides;
    // if we fell back to sides, keep one left + one right (not duplicates)
    if (!combined.length){
      const l = sides.find(e=>/[._-](l|left)$/i.test(e.name));
      const r = sides.find(e=>/[._-](r|right)$/i.test(e.name));
      chosen = [l, r].filter(Boolean);
    }
    found.blink = chosen;
  }
  for (const sem in found) for (const e of found[sem]) mark(e);

  // 2) user-selected customization morphs (from settings), weight > 0
  const custom = (settings && settings.morphs) || {};
  const customWanted = [];
  for (const e of rig.allMorphs){
    const w = custom[e.name];
    if (typeof w === 'number' && w > 0.001){ customWanted.push({ e, w }); mark(e); }
  }

  // 3) prune each mesh to the kept set (respecting the mobile cap), build remap
  const remapByMesh = new Map();
  const kept = [];
  v.scene.traverse(o=>{
    if(!o.isMesh || !o.geometry?.morphAttributes?.position) return;
    const geo = o.geometry;
    let keep = [...(need.get(o) || [])].sort((a,b)=>a-b);
    if (keep.length > CONFIG.MORPH_CAP) keep = keep.slice(0, CONFIG.MORPH_CAP);
    const remap = new Map(); keep.forEach((old,ni)=> remap.set(old,ni));
    remapByMesh.set(o, remap);

    const pos = geo.morphAttributes.position, nrm = geo.morphAttributes.normal;
    if (keep.length === 0){
      geo.morphAttributes = {};
      o.morphTargetInfluences = [];
      o.morphTargetDictionary = {};
    } else {
      geo.morphAttributes.position = keep.map(i=>pos[i]);
      if (nrm) geo.morphAttributes.normal = keep.map(i=>nrm[i]);
      const nd = {};
      for (const k in o.morphTargetDictionary){ const oi=o.morphTargetDictionary[k]; if(remap.has(oi)) nd[k]=remap.get(oi); }
      o.morphTargetDictionary = nd;
      o.morphTargetInfluences = new Array(keep.length).fill(0);   // length MUST match
    }
    kept.push(keep.length);
  });

  // 4) resolve semantic -> [{mesh, remapped idx}] and the static custom weights
  rig.morphs = {};
  for (const sem in found){
    rig.morphs[sem] = found[sem]
      .map(e=>({ mesh:e.mesh, idx: remapByMesh.get(e.mesh)?.get(e.origIdx) }))
      .filter(x=> x.idx != null);
  }
  rig.customMorphs = customWanted
    .map(({e,w})=>({ mesh:e.mesh, idx: remapByMesh.get(e.mesh)?.get(e.origIdx), weight:w }))
    .filter(x=> x.idx != null);

  const have = Object.keys(rig.morphs).filter(k=>rig.morphs[k]?.length);
  morphInfo = 'kept '+kept.join('/')+' ['+(have.join(',')||'none')+'] of '+S.allMorphNames.length;
  console.log('[conbadge] morph names:', S.allMorphNames);
}

async function mountVRM(buffer, filename){
  showOverlay(true, 'Loading avatar…', filename||'', true);
  S.lastBuffer = buffer; S.lastName = filename||'';
  if (S.vrm){ scene.remove(S.vrm.scene); try{ VRMUtils.deepDispose(S.vrm.scene); }catch{} S.vrm=null; }

  const loader = new GLTFLoader();
  loader.register((parser)=> new VRMLoaderPlugin(parser));

  let gltf;
  try{
    gltf = await new Promise((res,rej)=> loader.parse(buffer, '', res, rej));
  }catch(e){
    console.error(e); showError('Could not read that file. Is it a valid .vrm?'); return;
  }

  const v = gltf.userData.vrm;
  if(!v){ showError('No VRM data found in that file.'); return; }

  // --- version normalisation: after rotateVRM0 every model faces +Z ---------
  // NOTE: VRMUtils.combineSkeletons / removeUnnecessaryVertices are intentionally
  // NOT used. On some VRChat→VRM conversions they mis-bind the body's skinning,
  // which makes the body collapse/vanish while simple accessories still render.
  // A single avatar doesn't need that draw-call optimization anyway.
  VRMUtils.rotateVRM0(v);                       // no-op for VRM 1.0
  if (CONFIG.FACE_FLIP) v.scene.rotation.y += Math.PI;

  // Per-mesh fixes for finicky conversions:
  //  - frustumCulled off: skinned meshes sometimes get wrongly culled on mobile
  //  - DoubleSide: shows bodies whose normals/cull mode are inverted (a common
  //    reason only an accessory renders and the body looks invisible)
  // Per-mesh material fixes + capture geometry stats for diagnostics.
  // (Morph handling is done by pruneMorphs() below, after this traverse.)
  meshDiag = [];
  let solidIdx = 0;
  const SOLID = [0xff4455, 0x44ff66, 0x4499ff, 0xffcc33];
  v.scene.traverse(o=>{
    if(!o.isMesh) return;
    o.frustumCulled = false;
    const geo = o.geometry;
    const nm = (o.name||'?').replace(/[^\w]/g,'').slice(0,7);
    const verts  = geo?.attributes?.position?.count ?? 0;
    const morphs = geo?.morphAttributes?.position?.length ?? 0;
    const bones  = o.skeleton?.bones?.length ?? 0;
    // Sk = skinned (follows the skeleton), Me = rigid mesh. A rigid mesh that
    // isn't parented under a bone can't animate at all — that's the "clothes
    // just float there" case.
    const kind = o.isSkinnedMesh ? 'Sk' : 'Me';
    let p=o.parent, underBone=false;
    while(p){ if(p.isBone){ underBone=true; break; } p=p.parent; }
    const par = o.isSkinnedMesh ? '' : (underBone ? '+bone' : '+ROOT');
    meshDiag.push(`${nm} ${kind}${par} v${verts} mo${morphs} b${bones}`);

    if (CONFIG.SOLID_DEBUG){
      o.material = new THREE.MeshBasicMaterial({ color: SOLID[solidIdx++ % SOLID.length], side: THREE.DoubleSide });
    } else {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats){
        if(!m) continue;
        m.side = THREE.DoubleSide;
        if (m.transparent && m.opacity < 0.1){ m.opacity = 1; m.transparent = false; }
        if ('metalness' in m) m.metalness = 0.0;
        if ('roughness' in m && m.roughness < 0.4) m.roughness = 0.8;
        m.needsUpdate = true;
      }
    }
  });

  // Prune the giant VRoid morph set down to the expressions the badge uses, so
  // the heavy meshes render on mobile AND the face can still animate.
  // Detect the badge's expressions by morph name, keep them, prune the rest.
  try {
    if (CONFIG.KEEP_EXPRESSIONS) setupMorphs(v);
    else stripAllMorphs(v);
  } catch(e){ console.warn('[conbadge] morph setup failed, stripping', e); stripAllMorphs(v); }

  // Rescue rigid accessories that aren't skinned or parented to a bone.
  attachedInfo = '';
  if (CONFIG.ATTACH_LOOSE){
    try{
      const at = attachLooseMeshes(v);
      if (at.length){ attachedInfo = ' · attached '+at.length; console.log('[conbadge] attached loose meshes:', at); }
    }catch(e){ console.warn('[conbadge] loose-mesh attach failed', e); }
  }

  scene.add(v.scene);
  S.vrm = v;

  // Resolve rig ------------------------------------------------------------
  // Normalized bones = what we ANIMATE (three-S.vrm maps them to raw in update()).
  // Raw bones = the actual scene nodes that skin the mesh; their world positions
  // match what's rendered, so we MEASURE from these (framing + touch anchors).
  rig.bones = {}; rig.raw = {}; rig.rest.clear();
  for (const name of MANAGED){
    const node = v.humanoid.getNormalizedBoneNode(name);
    if (node){ rig.bones[name]=node; }
    const raw = v.humanoid.getRawBoneNode(name);
    if (raw){ rig.raw[name]=raw; }
  }
  // First update so normalized rest pose is valid, then capture rest quats.
  v.update(0);
  for (const name in rig.bones){ const n=rig.bones[name]; rig.rest.set(n, n.quaternion.clone()); }

  // Arm segment lengths + the body's lateral axis, measured from the rest pose.
  // These let gestures SOLVE for where to put a paw instead of me guessing
  // angles that only happen to work on one avatar's proportions.
  rig.armL1 = rig.armL2 = 0; rig.lateral = null;
  if (rig.raw.rightUpperArm && rig.raw.rightLowerArm && rig.raw.rightHand){
    const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3();
    rig.raw.rightUpperArm.getWorldPosition(a);
    rig.raw.rightLowerArm.getWorldPosition(b);
    rig.raw.rightHand.getWorldPosition(c);
    rig.armL1 = a.distanceTo(b);
    rig.armL2 = b.distanceTo(c);
  }
  if (rig.raw.leftUpperArm && rig.raw.rightUpperArm){
    const a=new THREE.Vector3(), b=new THREE.Vector3();
    rig.raw.leftUpperArm.getWorldPosition(a);
    rig.raw.rightUpperArm.getWorldPosition(b);
    rig.lateral = a.sub(b).setY(0).normalize();     // points toward the avatar's left
  }

  // Reference span for proportional touch zones + gesture scaling.
  rig.touchScale = 0.4;
  if (rig.raw.hips && (rig.raw.head || rig.raw.neck)){
    const a=new THREE.Vector3(), b=new THREE.Vector3();
    rig.raw.hips.getWorldPosition(a);
    (rig.raw.head || rig.raw.neck).getWorldPosition(b);
    rig.touchScale = Math.max(0.05, Math.abs(b.y-a.y));
  }

  // Hips rest position + leg length: the idle bounce sinks the hips as the knees
  // flex, which is what stops it looking like the legs are sliding.
  rig.hipsRest = rig.bones.hips ? rig.bones.hips.position.clone() : null;
  rig.legLength = 0.8;
  if (rig.raw.hips && (rig.raw.leftFoot || rig.raw.rightFoot)){
    const a=new THREE.Vector3(), b=new THREE.Vector3();
    rig.raw.hips.getWorldPosition(a);
    (rig.raw.leftFoot || rig.raw.rightFoot).getWorldPosition(b);
    rig.legLength = Math.max(0.05, Math.abs(a.y-b.y));
  }

  const named = discoverNamedBones(v.scene);
  rig.tail = named.tail; rig.tailRest = named.tail.map(n=>n.quaternion.clone());
  rig.ears = named.ears; rig.earsRest = named.ears.map(n=>n.quaternion.clone());

  rig.expr = resolveExpressions(v);

  // Wandering-gaze target (we drive the eye bones ourselves from this, rather
  // than S.vrm.lookAt, which many converted VRMs don't define).
  if(!rig.lookTarget){ rig.lookTarget = new THREE.Object3D(); scene.add(rig.lookTarget); }
  if (v.lookAt) v.lookAt.target = null;

  frameCamera();
  idle.reset(); gestures.reset(); reactions.clear();

  showOverlay(false);

  // ---- diagnostics: mesh count, bone resolution, model size --------------
  let meshCount=0, visMesh=0;
  v.scene.traverse(o=>{ if(o.isMesh){ meshCount++; if(o.visible) visMesh++; } });
  let span=0;
  if (rig.bones.head && rig.bones.hips){
    const a=new THREE.Vector3(), b=new THREE.Vector3();
    rig.bones.head.getWorldPosition(a); rig.bones.hips.getWorldPosition(b);
    span=Math.abs(a.y-b.y);
  }
  const box=new THREE.Box3().setFromObject(v.scene); const bs=new THREE.Vector3(); box.getSize(bs);
  const bc=new THREE.Vector3(); box.getCenter(bc);
  const rh=v.humanoid.getRawBoneNode('head'); const rhp=new THREE.Vector3(); if(rh) rh.getWorldPosition(rhp);
  const ver = v.meta?.metaVersion || v.meta?.specVersion || '?';
  let springCount = 0;
  try{ v.springBoneManager?.joints?.forEach(()=>springCount++); }catch{}
  const info =
    `VRM ${ver} · ${CONFIG.BUILD} · meshes ${visMesh}/${meshCount}${attachedInfo}\n${morphInfo}\n`+
    meshDiag.join('\n')+`\n`+
    `face: ${Object.keys(rig.morphs||{}).filter(k=>rig.morphs[k]?.length).join(',')||'none'}\n`+
    `tail ${rig.tail.length} ears ${rig.ears.length} springs ${springCount}`;
  toast(info, 9000);
  console.log('[conbadge]', info.replace(/\n/g,' | '), rig.morphs);
  hooks.onAvatarLoaded?.();
}

// Build a bounding box from actual skeleton JOINT world positions (raw bones +
// tail + ears). These are guaranteed to be in render space, unlike normalized
// bones or a skinned-mesh Box3.



export { mountVRM };

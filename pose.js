// Pose accumulator, expression driver, easing, arm IK, rig-space anchors.
import { THREE, S, rig, settings } from './core.js';
import { CONFIG, TOUCH_ZONES } from './config.js';

const _e = new THREE.Euler(), _q = new THREE.Quaternion();
class PoseAccumulator{
  constructor(){ this.map = new Map(); this.tw = new Map(); }
  clear(){ this.map.clear(); this.tw.clear(); }
  add(bone, x=0, y=0, z=0, w=1){
    if(!rig.bones[bone]) return;
    let a = this.map.get(bone); if(!a){ a=[0,0,0]; this.map.set(bone,a); }
    a[0]+=x*w; a[1]+=y*w; a[2]+=z*w;
  }
  // Axial twist (roll along the bone). MUST be applied after the euler offset,
  // in the bone's own frame — folding as part of the same XYZ euler makes the
  // "twist" swing the limb out of plane instead of rolling it.
  twist(bone, x=0, w=1){
    if(!rig.bones[bone]) return;
    this.tw.set(bone, (this.tw.get(bone)||0) + x*w);
  }
  apply(){
    for (const name in rig.bones){
      const node = rig.bones[name];
      const off  = this.map.get(name);
      if (off){ _e.set(off[0],off[1],off[2],'XYZ'); _q.setFromEuler(_e);
                node.quaternion.copy(rig.rest.get(node)).multiply(_q); }
      else { node.quaternion.copy(rig.rest.get(node)); }
      const t = this.tw.get(name);
      if (t){ _e.set(t,0,0,'XYZ'); _q.setFromEuler(_e); node.quaternion.multiply(_q); }
    }
  }
}
const pose = new PoseAccumulator();

// Applies the bounce's hip sink. Rotations come from the accumulator; this is
// the one place we touch a bone's position instead.


// Expression driver — sets morph-target influences directly by semantic name.
// (Converted VRMs often have no VRM expressions, so we bypass expressionManager.)
const morphTarget = {};            // semantic -> desired weight this frame
function setExpr(sem, w){
  if(!rig.morphs) return;
  // fall back to a related morph if the exact one isn't present on this avatar
  const alias = { joy:'happy', fun:'happy', relaxed:'happy', blush:'surprised', surprise:'surprised' };
  let s = sem;
  if(!rig.morphs[s]?.length && alias[s] && rig.morphs[alias[s]]?.length) s = alias[s];
  morphTarget[s] = Math.max(morphTarget[s]||0, w);
}
function flushExpr(dt){
  if(!rig.morphs) return;
  // static user-set blendshapes first (they're separate indices from the
  // animated ones, so animation still layers on top without fighting them)
  for (const c of rig.customMorphs||[]){
    const inf = c.mesh.morphTargetInfluences;
    if (inf && c.idx < inf.length) inf[c.idx] = c.weight;
  }
  // apply this frame's animation targets, resetting untouched ones to 0
  for (const sem in rig.morphs){
    const w = morphTarget[sem] || 0;
    for (const {mesh, idx} of rig.morphs[sem]){
      const inf = mesh.morphTargetInfluences;
      if (inf && idx < inf.length) inf[idx] = w;
    }
  }
  for (const k in morphTarget) morphTarget[k] = 0;
}

/* ---- easing helpers ---- */
const easeInOut = t => t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
// window envelope: 0 → 1 (ease in over `ein`) → hold → 0 (ease out over `eout`)
function envelope(t, dur, ein=0.2, eout=0.25){
  if (t<=0||t>=dur) return 0;
  const inT = dur*ein, outT = dur*eout;
  if (t<inT) return easeInOut(t/inT);
  if (t>dur-outT) return easeInOut((dur-t)/outT);
  return 1;
}

/* ===========================================================================
   Idle life: breathing, blinking, wandering look-at + head drift
   =========================================================================== */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _aP = new THREE.Vector3(), _aA = new THREE.Vector3(), _aB = new THREE.Vector3();
const _right = new THREE.Vector3(), _up = new THREE.Vector3(0,1,0);

// Resolve a zone to a world point. Offsets are proportional (× hips→head span)
// and applied along the avatar's OWN right/up/forward axes, so the mapping holds
// for any avatar scale or facing.
function anchorWorld(zone){
  const s = rig.touchScale || 0.4;
  const fwd = rig.forward || _up.clone().set(0,0,1);

  if (zone.bone==='tail'){ if(!rig.tail.length) return null; rig.tail[0].getWorldPosition(_aP); }
  else if (zone.bone==='ears'){ if(!rig.ears.length) return null; rig.ears[0].getWorldPosition(_aP); }
  else if (zone.bone==='midTorso'){
    // real mid-torso: partway from hips to chest. Using the 'spine' bone here
    // was the bug — on most rigs it sits barely above the hips, so 'belly' and
    // 'groin' collapsed onto nearly the same point.
    const h = rig.raw.hips, c = rig.raw.upperChest || rig.raw.chest || rig.raw.spine;
    if(!h || !c) return null;
    h.getWorldPosition(_aA); c.getWorldPosition(_aB);
    _aP.copy(_aA).lerp(_aB, 0.45);
  }
  else { const b = rig.raw[zone.bone]; if(!b) return null; b.getWorldPosition(_aP); }

  _right.crossVectors(_up, fwd).normalize();
  _aP.addScaledVector(_right, zone.off[0]*s);
  _aP.y += zone.off[1]*s;
  _aP.addScaledVector(fwd, zone.off[2]*s);
  return _aP.clone();
}
// Visualise the touch anchors — flip CONFIG.ZONE_DEBUG to tune them by eye.
function armBase(side, w){
  const m = side==='left' ? -1 : 1;
  const A=CONFIG.ARM_DOWN, O=CONFIG.ARM_OUT, E=CONFIG.ELBOW_BEND, F=CONFIG.ARM_FORWARD;
  const up = side==='left' ? 'leftUpperArm' : 'rightUpperArm';
  const lo = side==='left' ? 'leftLowerArm' : 'rightLowerArm';
  pose.add(up, 0, -m*F*w, m*(A - O)*w);   // cancel forward swing + resting droop
  pose.add(lo, 0, -m*E*w, 0);             // cancel resting elbow bend
}

/* ---------------------------------------------------------------------------
   Two-bone arm IK. Given a world-space target, solve the shoulder and elbow
   angles that actually put the paw there, using the avatar's measured bone
   lengths. Hand-tuned angles only ever fit one set of proportions — which is
   why the head scratch kept landing in the skull or out in front of the face.
   Returns false if the rig wasn't measurable, so callers can fall back.
--------------------------------------------------------------------------- */
const _ikT = new THREE.Vector3(), _ikS = new THREE.Vector3(), _ikOut = new THREE.Vector3();
function armReach(side, target, w){
  const L1 = rig.armL1, L2 = rig.armL2;
  if (!L1 || !L2 || !rig.lateral) return false;
  const sh = rig.raw[side==='left' ? 'leftUpperArm' : 'rightUpperArm'];
  if (!sh) return false;

  sh.getWorldPosition(_ikS);
  _ikT.copy(target).sub(_ikS);
  _ikOut.copy(rig.lateral).multiplyScalar(side==='left' ? 1 : -1);   // outward on this side

  const dx = _ikT.dot(_ikOut);                        // lateral (outward positive)
  const dy = _ikT.y;                                  // vertical
  const dz = rig.forward ? _ikT.dot(rig.forward) : 0; // forward

  // solve in the vertical plane through the arm
  let d = Math.hypot(dx, dy);
  d = THREE.MathUtils.clamp(d, Math.abs(L1-L2)*1.05 + 1e-5, (L1+L2)*0.985);
  const alpha = Math.atan2(dy, dx);                          // direction to target
  const cosB  = (L1*L1 + d*d - L2*L2) / (2*L1*d);
  const beta  = Math.acos(THREE.MathUtils.clamp(cosB, -1, 1));
  const th1   = alpha - beta;                                // elbow-out solution
  const ex = L1*Math.cos(th1), ey = L1*Math.sin(th1);
  const th2 = Math.atan2(dy-ey, dx-ex) - th1;                // elbow fold
  const yaw = Math.atan2(dz, Math.max(0.02, d));             // swing toward front/back

  // Deltas are relative to the idle resting pose, so cancel the parts of it
  // that would otherwise skew the reach (forward swing + resting elbow bend).
  const A=CONFIG.ARM_DOWN, O=CONFIG.ARM_OUT, E=CONFIG.ELBOW_BEND, F=CONFIG.ARM_FORWARD;
  const m = side==='left' ? -1 : 1;
  pose.add(side==='left'?'leftUpperArm':'rightUpperArm', 0, m*(yaw - F)*w, m*(A - O + th1)*w);
  pose.add(side==='left'?'leftLowerArm':'rightLowerArm', 0, -m*E*w,        m*th2*w);
  return true;
}

// Where the scratching paw should land. If the rig has ear bones we aim at the
// one on the scratching side — far more accurate than guessing an offset from
// the head bone, since head size varies wildly between avatars.
const _scT = new THREE.Vector3(), _scOut = new THREE.Vector3(), _scE = new THREE.Vector3();
function scratchTarget(){
  const head = rig.raw.head || rig.raw.neck;
  if (!head || !rig.lateral) return null;
  const s = rig.touchScale || 0.4;
  _scOut.copy(rig.lateral).multiplyScalar(-1);      // avatar's right side

  // pick the ear on the right side, if we found any
  let ear = null, bestDot = 0.001;
  if (rig.ears.length){
    head.getWorldPosition(_scT);
    for (const e of rig.ears){
      e.getWorldPosition(_scE);
      const dot = _scE.sub(_scT).dot(_scOut);
      if (dot > bestDot){ bestDot = dot; ear = e; }
    }
  }

  if (ear){ ear.getWorldPosition(_scT); }
  else {
    head.getWorldPosition(_scT);
    _scT.addScaledVector(_scOut, CONFIG.SCRATCH_SIDE * s);
  }
  _scT.y += CONFIG.SCRATCH_UP * s;                 // vertical nudge, either path

  // The IK puts the WRIST at the target, and the paw extends past the wrist, so
  // hold off by a fraction of a paw length — enough to avoid burying the fingers
  // without parking the arm out in space.
  _scT.addScaledVector(_scOut, rig.armL2 * CONFIG.SCRATCH_PAW);
  if (rig.forward) _scT.addScaledVector(rig.forward, CONFIG.SCRATCH_DEPTH * s);
  return _scT;
}

/* ---------------------------------------------------------------------------
   Tilt parallax — the camera swings a few degrees around the subject as you
   tilt the phone, so the badge reads as a window into a box rather than a flat
   picture. Applied ONLY around the render call and then undone: if OrbitControls
   ever saw the offset position it would treat it as user input and drift.
   Works while the camera is locked, since it isn't user control.
--------------------------------------------------------------------------- */

export { pose, PoseAccumulator, setExpr, flushExpr, envelope, easeInOut,
         armBase, armReach, scratchTarget, anchorWorld, raycaster, ndc };

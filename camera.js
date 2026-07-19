// Camera framing, saved views, vertical pan clamp, tilt parallax, render pass.
// skeletonBox lives here so this module never has to import avatar.js.
import { THREE, S, rig, settings, saveSettings, camera, controls, scene, renderer, motion, hooks } from './core.js';
import { CONFIG, TOUCH_ZONES } from './config.js';

function skeletonBox(){
  const box = new THREE.Box3(); const p = new THREE.Vector3();
  for (const k in rig.raw){ rig.raw[k].getWorldPosition(p); box.expandByPoint(p); }
  for (const n of rig.tail){ n.getWorldPosition(p); box.expandByPoint(p); }
  for (const n of rig.ears){ n.getWorldPosition(p); box.expandByPoint(p); }
  return box;
}

let debugGroup = null;
let frameDebug = '';
const _vTmp = new THREE.Vector3(), _vTgt = new THREE.Vector3(), _sph = new THREE.Spherical();

// A "view" is the camera's spherical offset from the framing target plus the
// vertical pan. Storing it this way survives avatar reloads and window resizes,
// unlike raw world coordinates.
function currentView(){
  _sph.setFromVector3(_vTmp.copy(camera.position).sub(controls.target));
  // clamp the stored height to the same range the pan allows, otherwise the
  // auto-return and clampCameraTarget() pull against each other forever
  const y = THREE.MathUtils.clamp(settings.camOffsetY||0, -CONFIG.PAN_RANGE, CONFIG.PAN_RANGE);
  return { r:_sph.radius, theta:_sph.theta, phi:_sph.phi, y };
}
function applyView(v, lerpT){
  if(!S.frameReady || !v) return;
  _vTgt.set(frameTarget.x, frameTarget.y + (v.y||0)*S.frameScale, frameTarget.z);
  _sph.set(v.r, v.phi, v.theta);
  _vTmp.setFromSpherical(_sph).add(_vTgt);
  if (lerpT == null){
    controls.target.copy(_vTgt);
    camera.position.copy(_vTmp);
    settings.camOffsetY = v.y||0;
  } else {
    controls.target.lerp(_vTgt, lerpT);
    camera.position.lerp(_vTmp, lerpT);
    settings.camOffsetY += ((v.y||0) - settings.camOffsetY) * lerpT;
  }
  controls.update();
}
const frameTarget = new THREE.Vector3();   // where frameCamera aimed (pan is relative to this)

// Keep the pan vertical-only and inside sane limits, then remember it so your
// framing survives a reload.
function clampCameraTarget(){
  if(!S.frameReady) return;
  const maxY = S.frameScale * CONFIG.PAN_RANGE;
  const dy   = THREE.MathUtils.clamp(controls.target.y - frameTarget.y, -maxY, maxY);
  const nx = frameTarget.x, nz = frameTarget.z, ny = frameTarget.y + dy;
  // move the camera by the same delta so the view direction is unchanged
  camera.position.x += nx - controls.target.x;
  camera.position.y += ny - controls.target.y;
  camera.position.z += nz - controls.target.z;
  controls.target.set(nx, ny, nz);
}
function saveCamOffset(){
  if(!S.frameReady) return;
  settings.camOffsetY = (controls.target.y - frameTarget.y) / (S.frameScale || 1);
  saveSettings();
}




// Frame the camera on the avatar.
// Facing is DERIVED from the shoulder line (no +Z guess), bounds come from the
// skeleton joints, and we fit the whole model with margin so it can't vanish.
function frameCamera(){
  if(!S.vrm) return;
  S.vrm.scene.updateWorldMatrix(true, true);

  const skel = skeletonBox();
  const obj  = new THREE.Box3().setFromObject(S.vrm.scene);
  const box  = skel.isEmpty() ? obj : skel;
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());

  // forward = perpendicular to the shoulders → auto-detects which way it faces
  const up = new THREE.Vector3(0,1,0);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const ls = rig.raw.leftShoulder || rig.raw.leftUpperArm || rig.raw.leftHand;
  const rs = rig.raw.rightShoulder || rig.raw.rightUpperArm || rig.raw.rightHand;
  const forward = new THREE.Vector3(0,0,1);
  if (ls && rs){
    ls.getWorldPosition(a); rs.getWorldPosition(b);
    const leftDir = a.sub(b).normalize();
    forward.crossVectors(up, leftDir);
    if (forward.lengthSq() < 1e-6) forward.set(0,0,1); else forward.normalize();
    if (forward.z < 0) forward.negate();               // prefer +Z front by convention
  }
  if (CONFIG.FACE_FLIP) forward.negate();
  rig.forward = forward.clone();      // touch zones project along this

  camera.near = Math.max(0.001, sphere.radius/100);
  camera.far  = sphere.radius*100 + 10;

  // aim at the head / upper chest and fit roughly the upper body
  const target = new THREE.Vector3(center.x, box.max.y - size.y*0.20, center.z);
  const fitV   = Math.max(0.1, size.y*0.62);
  const vHalf  = THREE.MathUtils.degToRad(camera.fov)/2;
  const tanV   = Math.tan(vHalf);
  const distH  = (fitV/2)/tanV;
  const distW  = (fitV/2)/(tanV*Math.max(0.0001, camera.aspect));  // ensure width fits (portrait)
  const dist   = Math.max(distH, distW) * CONFIG.FRAME_DIST;

  camera.up.set(0,1,0);
  camera.position.copy(target).addScaledVector(forward, dist);
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.minDistance = dist * 0.3;
  controls.maxDistance = dist * 3.0;

  // remember the neutral framing, then re-apply any saved vertical offset
  frameTarget.copy(target);
  S.frameScale = Math.max(0.05, size.y);
  S.frameReady = true;
  const off = (settings.camOffsetY || 0) * S.frameScale;
  if (off){ controls.target.y += off; camera.position.y += off; }
  controls.update();

  // debug: green = skeleton bounds, red = geometry bounds, axes at center
  if (debugGroup){ scene.remove(debugGroup); debugGroup = null; }
  if (CONFIG.DEBUG){
    debugGroup = new THREE.Group();
    if(!skel.isEmpty()) debugGroup.add(new THREE.Box3Helper(skel, 0x33ff88));
    if(!obj.isEmpty())  debugGroup.add(new THREE.Box3Helper(obj, 0xff5555));
    const ax = new THREE.AxesHelper(Math.max(0.2, size.y*0.6)); ax.position.copy(center);
    debugGroup.add(ax);
    scene.add(debugGroup);
  }
  frameDebug =
    `cam ${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)} r${sphere.radius.toFixed(2)}\n`+
    `fwd ${forward.x.toFixed(1)},${forward.y.toFixed(1)},${forward.z.toFixed(1)} · skel ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)}`;
}
document.getElementById('btn-reset-cam').onclick = ()=>{
  settings.camOffsetY = 0; saveSettings();
  if(S.vrm) frameCamera();
  if (S.camHeightSync) S.camHeightSync();
  hooks.closeSettings?.();
};

/* ===========================================================================
   Pose accumulator — layered animation without snapping.
   Every frame we start each managed bone from its REST quaternion and add up
   weighted euler offsets from: breathing + idle drift + active gesture +
   active reaction. Because we always start from rest, nothing drifts or
   T-poses; when all layers contribute 0 the avatar sits at its bind pose.
   =========================================================================== */
const parallax = { yaw:0, pitch:0 };
const _pxPos = new THREE.Vector3(), _pxQuat = new THREE.Quaternion();
const _pxOff = new THREE.Vector3(), _pxRight = new THREE.Vector3();
const _upY = new THREE.Vector3(0,1,0);

function updateParallax(dt){
  const on = motion.active && settings.parallax;
  const wantYaw   = on ? THREE.MathUtils.clamp((motion.gamma||0)/45, -1, 1) * CONFIG.PARALLAX_MAX : 0;
  const wantPitch = on ? THREE.MathUtils.clamp(((motion.beta||0)-45)/55, -1, 1)
                         * CONFIG.PARALLAX_MAX * CONFIG.PARALLAX_PITCH : 0;
  const k = 1 - Math.pow(0.03, dt);          // smooth; sensors are noisy
  parallax.yaw   += (wantYaw   - parallax.yaw  ) * k;
  parallax.pitch += (wantPitch - parallax.pitch) * k;
}

function renderScene(){
  const y = parallax.yaw, p = parallax.pitch;
  if (Math.abs(y) < 0.0004 && Math.abs(p) < 0.0004){ renderer.render(scene, camera); return; }
  _pxPos.copy(camera.position); _pxQuat.copy(camera.quaternion);
  _pxOff.copy(camera.position).sub(controls.target);
  _pxRight.crossVectors(_pxOff, _upY).normalize();
  _pxOff.applyAxisAngle(_upY, -y);
  if (_pxRight.lengthSq() > 0.0001) _pxOff.applyAxisAngle(_pxRight, p);
  camera.position.copy(controls.target).add(_pxOff);
  camera.lookAt(controls.target);
  renderer.render(scene, camera);
  camera.position.copy(_pxPos); camera.quaternion.copy(_pxQuat);   // undo before controls sees it
}

/* ===========================================================================
   Main loop — delta-time, optional 30 fps cap
   =========================================================================== */

export { frameCamera, skeletonBox, clampCameraTarget, saveCamOffset, currentView, applyView,
         frameTarget, updateParallax, renderScene };

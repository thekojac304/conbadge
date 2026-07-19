// Core singletons: renderer/scene/camera, shared rig + state, storage, sensors.
// Everything here is dependency-free so other modules can import it without cycles.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from './config.js';

export { THREE };

// Mutable state shared across modules. Kept on one object because ES modules
// can't reassign an imported binding.
export const S = {
  vrm: null,
  lastBuffer: null, lastName: '',
  hipsDrop: 0,
  allMorphNames: [],
  lastInteract: 0,
  frameScale: 1, frameReady: false,
  camHeightSync: null,
};

// Hooks let lower-level modules notify the UI without importing it (avoids a cycle).
export const hooks = { onAvatarLoaded: null, openSettings: null, setMode: null,
                       closeSettings: null, onShake: null };

   =========================================================================== */
const LS = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v==null?d:JSON.parse(v);}catch{ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} },
};

// IndexedDB: one object store keyed 'avatar' holding {name, buffer}
const IDB_NAME='conbadge', IDB_STORE='files';
function idbOpen(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open(IDB_NAME,1);
    r.onupgradeneeded = ()=> r.result.createObjectStore(IDB_STORE);
    r.onsuccess = ()=> res(r.result);
    r.onerror  = ()=> rej(r.error);
  });
}
async function idbPut(key,val){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const tx=db.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).put(val,key);
  tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function idbGet(key){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const tx=db.transaction(IDB_STORE,'readonly'); const rq=tx.objectStore(IDB_STORE).get(key);
  rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }

/* ===========================================================================
   Renderer / scene / camera / lights
   =========================================================================== */
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
camera.position.set(0, 1.35, 1.4);

// Soft, flattering lighting for MToon/standard materials.
scene.add(new THREE.HemisphereLight(0xffffff, 0x223044, 1.15));
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.6, 1.4, 1.2); scene.add(key);
const rim = new THREE.DirectionalLight(0x8fb4ff, 0.5);  rim.position.set(-0.8, 1.0, -1.2); scene.add(rim);

const controls = new OrbitControls(camera, renderer.domElement);
// Two-finger drag pans VERTICALLY only (clamped in clampCameraTarget) so you
// can slide the framing down to fit more of the body without losing the subject.
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.enableDamping = true; controls.dampingFactor = 0.09;
controls.rotateSpeed = 0.5;
controls.minAzimuthAngle = -CONFIG.ORBIT_AZIMUTH;
controls.maxAzimuthAngle =  CONFIG.ORBIT_AZIMUTH;
controls.minPolarAngle   =  CONFIG.ORBIT_POLAR_LO;
controls.maxPolarAngle   =  CONFIG.ORBIT_POLAR_HI;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio||1, settings.saver ? 1.5 : CONFIG.DPR_MAX);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);           // updateStyle=true: sets canvas CSS size to match
  camera.aspect = w/h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

/* ===========================================================================
   VRM state + animation rig
   =========================================================================== */
const clock = new THREE.Clock();

// Everything we might animate, resolved once per load.
const rig = {
  bones:{},          // managedName -> normalized bone node (humanoid)
  raw:{},            // managedName -> raw bone node (render space)
  rest:new Map(),    // node -> rest THREE.Quaternion
  tail:[],           // discovered tail nodes (root..tip)
  tailRest:[],       // their rest quaternions
  ears:[],           // discovered ear nodes
  earsRest:[],
  expr:{},           // semantic -> concrete VRM expression name (or null)
  morphs:{},         // semantic -> [{mesh, idx}] driven directly by name
  allMorphs:[],      // every morph on the model: {mesh, name, origIdx}
  customMorphs:[],   // user-set static blendshapes: {mesh, idx, weight}
  lookTarget:null,   // Object3D used to compute the wandering gaze
  hipsRest:null,     // hips rest position (for the idle bounce)
  legLength:0.8,     // hips→foot distance, scales the bounce sink
  touchScale:0.4,    // hips→head span; touch-zone offsets are multiples of this
  forward:null,      // detected facing direction (touch zones project along it)
};

// Names we drive on the humanoid rig. Null-guarded at resolve time.
const MANAGED = ['hips','spine','chest','upperChest','neck','head','leftEye','rightEye',
  'leftShoulder','leftUpperArm','leftLowerArm','leftHand',
  'rightShoulder','rightUpperArm','rightLowerArm','rightHand',
  'leftUpperLeg','leftLowerLeg','leftFoot',
  'rightUpperLeg','rightLowerLeg','rightFoot'];


export { renderer, scene, camera, controls, canvas, clock, rig, MANAGED, resize, LS, idbGet, idbPut };

// ---- persisted settings -------------------------------------------------
export const settings = LS.get('cb.settings', { name:'', pronouns:'', showPlate:true,
  bgA:'#141a2c', bgB:'#05060b', saver:false, morphs:{}, tailCurl:0, tailLift:0, camOffsetY:0,
  camLock:false, autoReturn:0, viewDefault:null, mode:'setup', keepAwake:true,
  motion:false, parallax:false, particles:true });
settings.morphs = settings.morphs || {};
settings.tailCurl = Math.max(0, settings.tailCurl||0);
export function saveSettings(){ LS.set('cb.settings', settings); }

export function rand(a,b){ return a + Math.random()*(b-a); }

// Small on-screen diagnostic (phones have no easy console).
export function toast(msg, ms=8000){
  const d=document.getElementById('diag'); if(!d) return;
  d.textContent=msg; d.style.opacity='1';
  clearTimeout(toast._t); toast._t=setTimeout(()=>{ d.style.opacity='0'; }, ms);
}

export function showOverlay(show, title, msg, spin){
  const ov=document.getElementById('overlay');
  ov.classList.toggle('gone', !show);
  document.getElementById('spinner').style.display = spin?'block':'none';
  if(title!=null) document.getElementById('ov-title').textContent=title;
  if(msg!=null)   document.getElementById('ov-msg').innerHTML=msg;
  if(show){ document.getElementById('btn-pick').style.display = spin?'none':'inline-block'; }
  document.getElementById('err').textContent='';
}
export function showError(text){
  const ov=document.getElementById('overlay'); ov.classList.remove('gone');
  document.getElementById('spinner').style.display='none';
  document.getElementById('btn-pick').style.display='inline-block';
  document.getElementById('ov-title').textContent='Con Badge';
  document.getElementById('ov-msg').innerHTML='Pick a <b>.vrm</b> avatar to bring your badge to life.';
  document.getElementById('err').textContent=text;
}

const motion = {
  active:false, gamma:0, beta:0, lean:0, pitch:0,
  base:9.8, energy:0, lastShake:0, seen:false,
};

function onDeviceMotion(ev){
  const a = ev.accelerationIncludingGravity;
  if(!a || a.x==null) return;
  motion.seen = true;
  const mag = Math.hypot(a.x||0, a.y||0, a.z||0);
  // slow-moving baseline ≈ gravity; deviation from it is real movement
  motion.base += (mag - motion.base) * 0.04;
  const dev = Math.abs(mag - motion.base);
  motion.energy = Math.max(motion.energy*0.85, dev);

  const now = performance.now();
  if (motion.energy > CONFIG.SHAKE_THRESHOLD && now - motion.lastShake > CONFIG.SHAKE_COOLDOWN){
    motion.lastShake = now;
    motion.energy = 0;
    if (vrm) reactions.fire('dizzy');
  }
}
function onDeviceOrient(ev){
  if (ev.gamma != null){ motion.gamma = ev.gamma; motion.seen = true; }
  if (ev.beta  != null) motion.beta  = ev.beta;
}

async function enableMotion(){
  // iOS 13+ gates both APIs behind a permission call that must come from a tap
  try{
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission){
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') return false;
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission){
      await DeviceOrientationEvent.requestPermission();
    }
  }catch(e){ /* not iOS, or already granted */ }

  window.addEventListener('devicemotion', onDeviceMotion);
  window.addEventListener('deviceorientation', onDeviceOrient);
  motion.active = true;
  // sensors silently deliver nothing on an insecure origin — tell the user
  setTimeout(()=>{
    if (motion.active && !motion.seen){
      toast('No sensor data — motion needs an https page or the installed app', 5000);
    }
  }, 1500);
  return true;
}
function disableMotion(){
  window.removeEventListener('devicemotion', onDeviceMotion);
  window.removeEventListener('deviceorientation', onDeviceOrient);
  motion.active = false; motion.lean = 0; motion.pitch = 0;
}
export { motion, enableMotion, disableMotion };

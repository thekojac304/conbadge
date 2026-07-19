// Pointer handling: taps -> reactions, drags on the avatar -> petting,
// long-press -> settings, corner-hold -> exit play mode. Plus the zone debug view.
import { THREE, S, rig, settings, scene, camera, renderer, controls, hooks, toast } from './core.js';
import { CONFIG, TOUCH_ZONES } from './config.js';
import { anchorWorld, raycaster, ndc } from './pose.js';
import { reactions, petting, hold } from './anim.js';

/* ---------------------------------------------------------------------------
   Swipe trail — a soft tapering streak following the finger while petting.
   Drawn on a 2D overlay canvas rather than in the 3D scene: it's a UI flourish
   that belongs on the glass, not in the world, and it costs almost nothing.
--------------------------------------------------------------------------- */
const trailCanvas = document.getElementById('trail');
const tctx = trailCanvas ? trailCanvas.getContext('2d') : null;
const trail = [];                 // newest last: {x, y, life}
const TRAIL_MAX = 64;

function trailResize(){
  if(!trailCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  trailCanvas.width  = Math.floor(window.innerWidth  * dpr);
  trailCanvas.height = Math.floor(window.innerHeight * dpr);
  trailCanvas.style.width  = window.innerWidth  + 'px';
  trailCanvas.style.height = window.innerHeight + 'px';
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
if (trailCanvas){ trailResize(); window.addEventListener('resize', trailResize); }

function addTrailPoint(x, y){
  trail.push({ x, y, life: CONFIG.TRAIL_LIFE });
  if (trail.length > TRAIL_MAX) trail.shift();
}

function updateTrail(dt){
  if(!tctx) return;
  tctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if(!trail.length) return;

  for (let i = trail.length - 1; i >= 0; i--){
    trail[i].life -= dt;
    if (trail[i].life <= 0) trail.splice(i, 1);
  }
  if (trail.length < 2) return;

  tctx.lineCap = 'round';
  tctx.lineJoin = 'round';
  tctx.shadowColor = `rgba(${CONFIG.TRAIL_COLOR},0.55)`;
  tctx.shadowBlur = 12;
  // Segment by segment, so the stroke can fade with age AND taper toward the
  // tail — a single path can only carry one width and one alpha.
  for (let i = 1; i < trail.length; i++){
    const a = trail[i-1], b = trail[i];
    const age  = Math.max(a.life, b.life) / CONFIG.TRAIL_LIFE;   // 1 = fresh
    const near = i / trail.length;                               // 1 = at the finger
    tctx.strokeStyle = `rgba(${CONFIG.TRAIL_COLOR},${0.5 * age * age})`;
    tctx.lineWidth = Math.max(1.5, CONFIG.TRAIL_WIDTH * age * (0.35 + 0.65*near));
    tctx.beginPath();
    tctx.moveTo(a.x, a.y);
    tctx.lineTo(b.x, b.y);
    tctx.stroke();
  }
  tctx.shadowBlur = 0;
}

let zoneDots = null;
function updateZoneDebug(){
  if (!CONFIG.ZONE_DEBUG){ if(zoneDots){ scene.remove(zoneDots); zoneDots=null; } return; }
  if (!zoneDots){
    zoneDots = new THREE.Group();
    const COLORS = { happy:0x55ff88, blush:0xff77cc, giggle:0xffdd55,
                     bellyRub:0x66ddff, fluster:0xff5555, waveLeft:0xaa88ff, waveRight:0xaa88ff };
    for (const z of TOUCH_ZONES){
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshBasicMaterial({ color: COLORS[z.react] || 0xffffff, depthTest:false })
      );
      m.renderOrder = 999; m.userData.zone = z;
      zoneDots.add(m);
    }
    scene.add(zoneDots);
  }
  const r = (rig.touchScale||0.4) * 0.045;
  for (const m of zoneDots.children){
    const p = anchorWorld(m.userData.zone);
    if (p){ m.visible = true; m.position.copy(p); m.scale.setScalar(r); }
    else m.visible = false;
  }
}

function pickZone(clientX, clientY){
  if(!S.vrm) return null;
  ndc.x = (clientX/window.innerWidth)*2-1;
  ndc.y = -(clientY/window.innerHeight)*2+1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(S.vrm.scene, true);
  if(!hits.length) return null;                     // missed the avatar
  const hit = hits[0].point;

  let best=null, bd=Infinity;
  for (const z of TOUCH_ZONES){
    const a = anchorWorld(z); if(!a) continue;
    const dd = a.distanceToSquared(hit);
    if (dd<bd){ bd=dd; best=z; }
  }
  return best ? { zone:best, point:hit } : null;
}

function reactAt(clientX, clientY){
  const pick = pickZone(clientX, clientY);
  if(!pick) return;
  switch(pick.zone.react){
    case 'happy':     reactions.fire('happy'); break;
    case 'blush':     reactions.fire('blush'); break;
    case 'giggle':    reactions.fire('giggle'); break;
    case 'bellyRub':  reactions.fire('bellyRub'); break;
    case 'boop':      reactions.fire('boop'); break;
    case 'fluster':   reactions.fire('fluster'); break;
    case 'waveLeft':  reactions.fire('wave','left'); break;
    case 'waveRight': reactions.fire('wave','right'); break;
  }
}

/* ===========================================================================
   Gesture arbitration: tap (react) vs drag (orbit) vs long-press (settings)
   vs pinch (zoom, handled by OrbitControls). We watch pointer events on the
   canvas; OrbitControls also listens, so movement past a threshold = orbit.
   =========================================================================== */
let pDown=null, longTimer=null, longFired=false, pointerCount=0, cornerTimer=null;
let grabTimer=null, grabMoveT=0;
const MOVE_TOL=10, LONG_MS=550, TAP_MS=320, CORNER_MS=1200, CORNER_PX=90, CORNER_TOL=45;

/* ---------------------------------------------------------------------------
   Carrying him around. While he's held, the finger has to become a point in 3D
   — we project the pointer ray onto the plane he was grabbed on (facing the
   camera, through the grab point). Depth therefore never changes while you
   drag, which is what you want: he tracks your finger across the glass instead
   of sliding toward or away from the lens.
--------------------------------------------------------------------------- */
const grabPlane = new THREE.Plane();
const _gN = new THREE.Vector3(), _gP = new THREE.Vector3();

function pointerWorld(clientX, clientY){
  ndc.x = (clientX/window.innerWidth)*2-1;
  ndc.y = -(clientY/window.innerHeight)*2+1;
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(grabPlane, _gP) ? _gP : null;
}

function startGrab(pick){
  if (!pick) return false;
  camera.getWorldDirection(_gN);
  grabPlane.setFromNormalAndCoplanarPoint(_gN, pick.point);
  if (!hold.grab(pick.zone, pick.point)) return false;
  grabMoveT = performance.now();
  try{ navigator.vibrate?.(12); }catch{}      // a little haptic thump on pickup
  return true;
}

renderer.domElement.addEventListener('pointerdown', (ev)=>{
  S.lastInteract = performance.now();
  pointerCount++;
  if (pointerCount>1){ cancelLong(); pDown=null; return; }   // pinch → ignore tap/long
  const pick = pickZone(ev.clientX, ev.clientY);
  pDown={ x:ev.clientX, y:ev.clientY, t:performance.now(),
          corner: ev.clientX < CORNER_PX && ev.clientY < CORNER_PX + 40,
          onAvatar: !!pick, pick, petted:false };
  longFired=false;
  // Dragging ON the avatar pets him; dragging on the background orbits the
  // camera. Suspending OrbitControls for the duration keeps the two apart.
  if (pDown.onAvatar) controls.enabled = false;

  // Long-press splits by target: on HIM it's a pickup, on the background it's
  // the settings sheet. Holding still is the shared signal, so the two would
  // collide if they shared a target — hence the split. Moving first cancels
  // both and you're petting instead.
  if (pDown.onAvatar){
    grabTimer = setTimeout(()=>{
      grabTimer = null;
      if (startGrab(pDown && pDown.pick)) longFired = true;
    }, CONFIG.HOLD_GRAB_MS);
  }

  if (settings.mode === 'play'){
    // Escape hatch 1: hold the top-left corner.
    if (pDown.corner){
      cornerTimer = setTimeout(()=>{
        longFired = true; cornerTimer = null;
        exitPlayMode();
      }, CORNER_MS);
    }
  } else if (!pDown.onAvatar){
    longTimer=setTimeout(()=>{ longFired=true; hooks.openSettings?.(); }, LONG_MS);
  }
});

function exitPlayMode(){
  hooks.setMode?.('setup');
  hideExitChip();
  toast('Setup mode', 2000);
}
// Escape hatch 2: tap the corner once to reveal a real exit button for a few
// seconds. Two deliberate taps in one spot — discoverable for you, not for a
// stranger idly poking the badge.
let exitChipTimer = null;
function showExitChip(){
  const chip = document.getElementById('play-exit');
  chip.classList.add('show');
  clearTimeout(exitChipTimer);
  exitChipTimer = setTimeout(hideExitChip, 4000);
}
function hideExitChip(){
  document.getElementById('play-exit').classList.remove('show');
  clearTimeout(exitChipTimer);
}
document.getElementById('play-exit').addEventListener('click', exitPlayMode);
renderer.domElement.addEventListener('pointermove', (ev)=>{
  // Carrying him wins outright: no petting, no trail, no orbit until you let go.
  if (hold.state === 'held'){
    const now = performance.now();
    const dt  = Math.min(0.1, (now - grabMoveT)/1000);
    grabMoveT = now;
    const p = pointerWorld(ev.clientX, ev.clientY);
    if (p) hold.moveTo(p, dt);
    S.lastInteract = now;
    return;
  }
  if(!pDown) return;
  const moved = Math.hypot(ev.clientX-pDown.x, ev.clientY-pDown.y);

  // Petting: accumulate energy from how far the finger travels across him.
  if (pDown.onAvatar && pointerCount === 1){
    const dx = ev.clientX - (pDown.lastX ?? pDown.x);
    const dy = ev.clientY - (pDown.lastY ?? pDown.y);
    const step = Math.hypot(dx, dy) / Math.max(1, window.innerHeight);
    if (step > 0.001){
      const pick = pickZone(ev.clientX, ev.clientY);
      if (pick){
        petting.feed(step, pick.point, pick.zone);
        pDown.petted = true;
        S.lastInteract = performance.now();
        if (settings.particles !== false) addTrailPoint(ev.clientX, ev.clientY);
      }
    }
    pDown.lastX = ev.clientX; pDown.lastY = ev.clientY;
  }
  // The corner hold gets a much looser tolerance — holding a finger still for
  // 1.5s always drifts more than the 10px tap threshold, which is why the
  // escape hatch kept failing.
  if (cornerTimer && moved > CORNER_TOL){ clearTimeout(cornerTimer); cornerTimer=null; }
  if (moved > MOVE_TOL){
    if(longTimer){ clearTimeout(longTimer); longTimer=null; }
    if(grabTimer){ clearTimeout(grabTimer); grabTimer=null; }
    // Mark the tap as invalidated rather than dropping pDown entirely —
    // nulling it here meant pointermove bailed out early and petting could
    // never accumulate past the first few pixels.
    pDown.moved = true;
  }
});
function endPointer(ev){
  pointerCount = Math.max(0, pointerCount-1);
  cancelLong();
  controls.enabled = !settings.camLock;   // restore orbit after a pet-drag
  if (hold.state === 'held'){ hold.release(); pDown=null; return; }
  if (pDown && pDown.petted){ pDown=null; return; }   // a pet isn't a tap
  if (pDown && !longFired && !pDown.moved){
    const moved = Math.hypot(ev.clientX-pDown.x, ev.clientY-pDown.y);
    const dt = performance.now()-pDown.t;
    if (moved<=MOVE_TOL && dt<=TAP_MS){
      // a quick tap in the corner during play mode reveals the exit button
      if (settings.mode==='play' && pDown.corner) showExitChip();
      else reactAt(ev.clientX, ev.clientY);
    }
  }
  pDown=null;
}
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', ()=>{ pointerCount=Math.max(0,pointerCount-1); cancelLong(); hold.release(); controls.enabled = !settings.camLock; pDown=null; });
function cancelLong(){
  if(longTimer){ clearTimeout(longTimer); longTimer=null; }
  if(cornerTimer){ clearTimeout(cornerTimer); cornerTimer=null; }
  if(grabTimer){ clearTimeout(grabTimer); grabTimer=null; }
}

/* Neutralise the idle resting arm pose for one side, so a gesture can specify
   absolute arm angles instead of inheriting the rest pose's forward swing and
   elbow bend. Summing an idle Y-bend with a gesture's Z-fold produces a twisted
   composite rotation — that's what was rolling the palm during waves.
   After calling this, Z is measured from horizontal and mirrors with `m`. */

export { pickZone, reactAt, updateZoneDebug, updateTrail, exitPlayMode, showExitChip, hideExitChip };

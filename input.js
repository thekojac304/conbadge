// All pointer handling: taps -> reactions, drags on the avatar -> petting,
// long-press -> settings, corner-hold -> exit play mode. Also the zone debug view.
import { THREE, S, rig, settings, scene, camera, renderer, controls, hooks, toast } from './core.js';
import { CONFIG, TOUCH_ZONES } from './config.js';
import { anchorWorld, raycaster, ndc } from './pose.js';
import { reactions, petting } from './anim.js';

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
const MOVE_TOL=10, LONG_MS=550, TAP_MS=320, CORNER_MS=1200, CORNER_PX=90, CORNER_TOL=45;

renderer.domElement.addEventListener('pointerdown', (ev)=>{
  S.lastInteract = performance.now();
  pointerCount++;
  if (pointerCount>1){ cancelLong(); pDown=null; return; }   // pinch → ignore tap/long
  pDown={ x:ev.clientX, y:ev.clientY, t:performance.now(),
          corner: ev.clientX < CORNER_PX && ev.clientY < CORNER_PX + 40,
          onAvatar: !!pickZone(ev.clientX, ev.clientY), petted:false };
  longFired=false;
  // Dragging ON the avatar pets him; dragging on the background orbits the
  // camera. Suspending OrbitControls for the duration keeps the two apart.
  if (pDown.onAvatar) controls.enabled = false;

  if (settings.mode === 'play'){
    // Escape hatch 1: hold the top-left corner.
    if (pDown.corner){
      cornerTimer = setTimeout(()=>{
        longFired = true; cornerTimer = null;
        exitPlayMode();
      }, CORNER_MS);
    }
  } else {
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
    // Mark the tap as invalidated rather than dropping pDown entirely —
    // nulling it here meant pointermove bailed out early and petting could
    // never accumulate past the first few pixels.
    pDown.moved = true;
  }
});
function endPointer(ev){
  pointerCount = Math.max(0, pointerCount-1);
  cancelLong();
  controls.enabled = !settings.camLock;   // restore orbit state after a pet-drag
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
renderer.domElement.addEventListener('pointercancel', ()=>{ pointerCount=Math.max(0,pointerCount-1); cancelLong(); controls.enabled = !settings.camLock; pDown=null; });
function cancelLong(){
  if(longTimer){ clearTimeout(longTimer); longTimer=null; }
  if(cornerTimer){ clearTimeout(cornerTimer); cornerTimer=null; }
}

/* Neutralise the idle resting arm pose for one side, so a gesture can specify
   absolute arm angles instead of inheriting the rest pose's forward swing and
   elbow bend. Summing an idle Y-bend with a gesture's Z-fold produces a twisted
   composite rotation — that's what was rolling the palm during waves.

export { pickZone, reactAt, updateZoneDebug, exitPlayMode, showExitChip, hideExitChip };

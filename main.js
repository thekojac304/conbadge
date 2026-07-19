// Entry point: wires the modules together, owns the frame loop and boot sequence.
import { THREE, S, rig, settings, scene, camera, renderer, controls, clock, resize,
         toast, showOverlay, showError, idbGet, motion, enableMotion } from './core.js';
import { CONFIG } from './config.js';
import { pose, flushExpr } from './pose.js';
import { idle, gestures, reactions, petting, particles, applyTailPose, applyEarPose,
         decayImpulses, applyHipsDrop } from './anim.js';
import { clampCameraTarget, applyView, updateParallax, renderScene } from './camera.js';
import { updateZoneDebug } from './input.js';
import { mountVRM } from './avatar.js';
import { applySettings, applyCamLock, syncFullscreenClass, acquireWake, motionNote, els } from './ui.js';

function loop(){
  requestAnimationFrame(loop);
  const raw = Math.min(clock.getDelta(), 0.05);     // clamp after tab switches
  controls.update();                                // damping runs every frame
  clampCameraTarget();                              // keep pan vertical + in range

  // Auto-return: drift back to the saved default view after a quiet period.
  if (settings.autoReturn > 0 && settings.viewDefault && !settings.camLock && S.frameReady){
    if (performance.now() - S.lastInteract > settings.autoReturn*1000){
      applyView(settings.viewDefault, 1 - Math.pow(0.06, raw));   // smooth, framerate-independent
      // only touch the DOM if the sheet is actually visible
      if (S.camHeightSync && els.sheet.classList.contains('open')) S.camHeightSync();
    }
  }

  // battery saver: throttle animation + render to 30fps, but animate with the
  // *accumulated* elapsed time so motion speed stays correct.
  let dt = raw;
  if (settings.saver){ S.acc += raw; if (S.acc < 1/30) return; dt = S.acc; S.acc = 0; }

  if (S.vrm){
    pose.clear();
    idle.update(dt);
    petting.update(dt);
    gestures.update(dt);
    if (reactions.active) reactions.update(dt);
    pose.apply();                 // write humanoid offsets (pre-update)
    applyHipsDrop();              // bounce sink (position, not rotation)
    S.vrm.update(dt);               // humanoid → raw, springs
    flushExpr(dt);                // write morph influences (after update)
    applyTailPose(idle.t);        // persistent tail curl/lift/sway (post-spring)
    applyEarPose(idle.t);         // ear twitches (post-spring)
    decayImpulses(dt);
  }
  if (CONFIG.ZONE_DEBUG) updateZoneDebug();
  particles.update(dt);
  updateParallax(dt);
  renderScene();
}

/* ===========================================================================
   Settings, badge overlay, background, wake lock, fullscreen, PWA
   =========================================================================== */

async function boot(){
  applySettings();
  applyCamLock();
  document.body.classList.toggle('mode-play', settings.mode==='play');
  document.getElementById('tg-wake').checked = settings.keepAwake !== false;
  document.getElementById('tg-particles').checked = settings.particles !== false;
  // Android re-attaches without a prompt; iOS needs a tap, so the toggle just
  // shows off until the user flips it.
  if (settings.motion){
    document.getElementById('tg-motion').checked = true;
    enableMotion().then(ok=>{ if(!ok){ settings.motion=false; document.getElementById('tg-motion').checked=false; } motionNote(); });
  }
  motionNote();
  resize();
  syncFullscreenClass();
  loop();
  acquireWake();

  // Register a service worker for PWA install/offline (only when hosted https).
  if ('serviceWorker' in navigator && location.protocol==='https:'){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }

  // Restore cached avatar if present.
  try{
    const cached = await idbGet('avatar');
    if (cached && cached.buffer){ await mountVRM(cached.buffer, cached.name); return; }
  }catch(e){}
  showOverlay(true, 'Con Badge', 'Pick a <b>.vrm</b> avatar to bring your badge to life. It stays on this device.', false);
}
boot();


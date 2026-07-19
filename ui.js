// Settings sheet, mode switching, the animation test bar and blendshape browser.
import { THREE, S, rig, settings, saveSettings, camera, controls, hooks, toast,
         showOverlay, showError, idbGet, idbPut, resize, motion, enableMotion, disableMotion,
         LS, rand } from './core.js';
import { CONFIG } from './config.js';
import { mountVRM } from './avatar.js';
import { frameCamera, currentView, applyView, saveCamOffset, frameTarget } from './camera.js';
import { gestures, reactions, GESTURE_LIST } from './anim.js';



const els = {
  plate:document.getElementById('nameplate'),
  pname:document.getElementById('plate-name'),
  ppro:document.getElementById('plate-pronouns'),
  inName:document.getElementById('in-name'),
  inPro:document.getElementById('in-pronouns'),
  tgPlate:document.getElementById('tg-plate'),
  tgSaver:document.getElementById('tg-saver'),
  bgA:document.getElementById('bg-a'),
  bgB:document.getElementById('bg-b'),
  stage:document.getElementById('stage'),
  sheet:document.getElementById('settings'),
};

function applySettings(){
  els.pname.textContent = settings.name || '';
  els.ppro.textContent  = settings.pronouns || '';
  els.plate.classList.toggle('hidden', !settings.showPlate || (!settings.name && !settings.pronouns));
  els.stage.style.background = `linear-gradient(180deg, ${settings.bgA}, ${settings.bgB})`;
  document.querySelector('meta[name=theme-color]').setAttribute('content', settings.bgB);
  // reflect into controls
  els.inName.value=settings.name; els.inPro.value=settings.pronouns;
  els.tgPlate.checked=settings.showPlate; els.tgSaver.checked=settings.saver;
  els.bgA.value=settings.bgA; els.bgB.value=settings.bgB;
  resize();
}

els.inName.addEventListener('input', e=>{ settings.name=e.target.value; applySettings(); saveSettings(); });
els.inPro.addEventListener('input',  e=>{ settings.pronouns=e.target.value; applySettings(); saveSettings(); });
els.tgPlate.addEventListener('change', e=>{ settings.showPlate=e.target.checked; applySettings(); saveSettings(); });
els.tgSaver.addEventListener('change', e=>{ settings.saver=e.target.checked; acc=0; applySettings(); saveSettings(); });
els.bgA.addEventListener('input', e=>{ settings.bgA=e.target.value; applySettings(); saveSettings(); });
els.bgB.addEventListener('input', e=>{ settings.bgB=e.target.value; applySettings(); saveSettings(); });

function openSettings(){ els.sheet.classList.add('open'); renderMorphList(); }
function closeSettings(){ els.sheet.classList.remove('open'); }

/* ---- Modes ---------------------------------------------------------------
   setup: gear + fullscreen buttons visible, long-press opens settings.
   play : no controls at all — just the avatar and its touch reactions. The way
          back is a 1.5s hold on the top-left corner, which nobody discovers by
          accident but you can do one-handed on a lanyard. */
function setMode(mode){
  settings.mode = mode; saveSettings();
  document.body.classList.toggle('mode-play', mode==='play');
  if (mode==='play'){ closeSettings(); }
}
document.getElementById('btn-mode').onclick  = ()=>{
  setMode('play');
  toast('Play mode · tap the top-left corner to get back', 3500);
};
document.getElementById('btn-play').onclick  = ()=> setMode('play');
document.getElementById('btn-play2').onclick = ()=> setMode('play');

// Tabs
document.getElementById('tabs').addEventListener('click', e=>{
  const btn = e.target.closest('.tab'); if(!btn) return;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('is-on', t===btn));
  const which = btn.dataset.tab;
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('is-on', p.dataset.panel===which));
  document.getElementById('sheet').scrollTop = 0;
});

// Background presets — quicker than fiddling two colour pickers
const BG_PRESETS = [
  ['#141a2c','#05060b'], ['#1d2440','#070910'], ['#2a1836','#0a0610'],
  ['#0f2b2a','#04100f'], ['#31201a','#0d0705'], ['#20242b','#0b0d10'],
];
(function(){
  const row = document.getElementById('bg-presets');
  row.innerHTML = BG_PRESETS.map(([a,b],i)=>
    `<button class="preset" data-i="${i}" style="background:linear-gradient(180deg,${a},${b})"></button>`).join('');
  row.addEventListener('click', e=>{
    const b = e.target.closest('.preset'); if(!b) return;
    const [a,c] = BG_PRESETS[+b.dataset.i];
    settings.bgA=a; settings.bgB=c; applySettings(); saveSettings();
  });
})();

/* ---- Animation test bar -------------------------------------------------
   Idle gestures fire every 8–20s, which makes verifying a fix agonising. This
   triggers any gesture or reaction on demand. Setup mode only. */
(function(){
  const bar = document.getElementById('test-bar');
  const box = document.getElementById('test-chips');
  const REACTS = [
    ['Pat','happy'], ['Blush','blush'], ['Giggle','giggle'],
    ['Belly','bellyRub'], ['Startle','fluster'], ['Dizzy','dizzy'], ['Boop','boop'],
    ['Wave R','wave:right'], ['Wave L','wave:left'],
  ];
  let html = '<button class="chip stop" data-stop="1">■ Stop</button>';
  html += GESTURE_LIST.map(g=>`<button class="chip" data-g="${g}">${g}</button>`).join('');
  html += REACTS.map(([label,kind])=>`<button class="chip react" data-r="${kind}">${label}</button>`).join('');
  box.innerHTML = html;

  box.addEventListener('click', e=>{
    const b = e.target.closest('.chip'); if(!b) return;
    if (b.dataset.stop){
      gestures.cur = null; gestures.gainTarget = 1; gestures.next = rand(8,20);
      reactions.clear();
      toast('Stopped', 1200);
      return;
    }
    if (b.dataset.g){
      reactions.clear();
      gestures.start(b.dataset.g);
      gestures.gain = 1; gestures.gainTarget = 1;   // skip the fade-in for testing
      toast(b.dataset.g, 1500);
    }
    if (b.dataset.r){
      const [kind, side] = b.dataset.r.split(':');
      reactions.fire(kind, side);
      toast(kind + (side ? ' ('+side+')' : ''), 1500);
    }
  });

  document.getElementById('btn-test').addEventListener('click', ()=>{
    bar.classList.toggle('show');
  });
})();

// Motion sensors toggle
const tgMotion = document.getElementById('tg-motion');
function motionNote(){
  const el = document.getElementById('motion-note');
  if (!window.isSecureContext){
    el.textContent = 'Sensors are blocked on this page — they need an https address or the installed app.';
  } else if (settings.motion && motion.active && !motion.seen){
    el.textContent = 'Waiting for sensor data…';
  } else if (settings.motion){
    el.textContent = 'Give the phone a shake to test it.';
  } else {
    el.textContent = '';
  }
}
tgMotion.addEventListener('change', async e=>{
  if (e.target.checked){
    const ok = await enableMotion();
    settings.motion = ok;
    e.target.checked = ok;
    if (!ok) toast('Motion permission denied', 2500);
  } else {
    disableMotion();
    settings.motion = false;
  }
  saveSettings(); motionNote();
});

document.getElementById('tg-particles').addEventListener('change', e=>{
  settings.particles = e.target.checked; saveSettings();
});

// Tilt parallax — depends on the motion sensors being on
const tgParallax = document.getElementById('tg-parallax');
tgParallax.checked = !!settings.parallax;
tgParallax.addEventListener('change', async e=>{
  settings.parallax = e.target.checked;
  // turning parallax on implies wanting sensors on
  if (settings.parallax && !motion.active){
    const ok = await enableMotion();
    settings.motion = ok; tgMotion.checked = ok;
    if(!ok){ settings.parallax = false; e.target.checked = false; toast('Motion permission denied', 2500); }
  }
  saveSettings(); motionNote();
});

// Keep screen awake toggle
document.getElementById('tg-wake').addEventListener('change', e=>{
  settings.keepAwake = e.target.checked; saveSettings();
  if (settings.keepAwake) acquireWake();
  else if (wakeLock){ try{ wakeLock.release(); }catch{} wakeLock=null; }
});

/* ---- Blendshape panel ---------------------------------------------------
   Lists every morph target found on the avatar. A slider sets a permanent
   weight, saved to localStorage. Because we prune morphs at load time (mobile
   GPUs can't render hundreds), enabling a new one requires re-mounting the
   avatar from the cached buffer — debounced so dragging a slider is smooth. */
let morphRemountTimer = null;
function scheduleMorphRemount(){
  clearTimeout(morphRemountTimer);
  morphRemountTimer = setTimeout(()=>{
    if (S.lastBuffer) mountVRM(S.lastBuffer, S.lastName);
  }, 700);
}
function renderMorphList(){
  const list = document.getElementById('morph-list');
  const q = (document.getElementById('morph-search').value||'').toLowerCase().trim();
  const active = settings.morphs || {};
  if(!S.allMorphNames.length){
    list.innerHTML = '<div class="empty">Load an avatar to see its blendshapes.</div>';
    document.getElementById('morph-count').textContent = '';
    return;
  }
  // active ones first, then name matches (capped so the DOM stays light)
  const names = S.allMorphNames.filter(n=> !q || n.toLowerCase().includes(q));
  names.sort((a,b)=> ((active[b]>0)-(active[a]>0)) || a.localeCompare(b));

  // Render ALL matches (409+ rows is fine because the slider for a row is only
  // created when that row is opened — otherwise 400 range inputs would crawl).
  list.innerHTML = names.map(n=>{
    const v = Math.round(((active[n]||0))*100);
    const esc = n.replace(/"/g,'&quot;').replace(/</g,'&lt;');
    return `<div class="morph-row ${v>0?'active':''}" data-name="${esc}">
      <button class="mr-head" type="button"><span class="mr-name" title="${esc}">${esc}</span><span class="mr-val">${v}%</span></button>
      <div class="mr-edit"></div>
    </div>`;
  }).join('') || '<div class="empty">No blendshapes match that search.</div>';

  const activeCount = Object.values(active).filter(v=>v>0).length;
  document.getElementById('morph-count').textContent =
    `${activeCount} active · ${names.length} of ${S.allMorphNames.length}`;

  // tap a row to open its slider (only one open at a time) — closed rows have
  // no active control, which is what keeps scrolling from nudging values
  list.querySelectorAll('.mr-head').forEach(head=>{
    head.addEventListener('click', ()=>{
      const row = head.closest('.morph-row');
      const wasOpen = row.classList.contains('open');
      list.querySelectorAll('.morph-row.open').forEach(r=>r.classList.remove('open'));
      if (wasOpen) return;
      row.classList.add('open');

      const edit = row.querySelector('.mr-edit');
      if (edit.childElementCount) return;                  // already built
      const name = row.dataset.name;
      const cur  = Math.round(((settings.morphs?.[name])||0)*100);
      const inp  = document.createElement('input');
      inp.type='range'; inp.min='0'; inp.max='100'; inp.value=cur;
      edit.appendChild(inp);
      inp.addEventListener('input', ()=>{
        row.querySelector('.mr-val').textContent = inp.value+'%';
        row.classList.toggle('active', +inp.value>0);
      });
      inp.addEventListener('change', ()=>{
        const val = +inp.value/100;
                if (val>0.001) settings.morphs[name] = val; else delete settings.morphs[name];
        saveSettings();
        scheduleMorphRemount();
      });
    });
  });
}
document.getElementById('morph-search').addEventListener('input', renderMorphList);
document.getElementById('btn-morph-clear').addEventListener('click', ()=>{
  settings.morphs = {}; saveSettings(); renderMorphList(); scheduleMorphRemount();
});

// Tail curl / side — bone rotation, applied live (no remount needed)
function bindTailSlider(id, key){
  const inp = document.getElementById(id), out = document.getElementById(id+'-v');
  inp.value = Math.round((settings[key]||0)*100);
  out.textContent = inp.value;
  inp.addEventListener('input', e=>{
    settings[key] = +e.target.value/100;
    out.textContent = e.target.value;
  });
  inp.addEventListener('change', saveSettings);
}
bindTailSlider('tail-curl','tailCurl');
bindTailSlider('tail-lift','tailLift');

// Camera height — same offset the two-finger pan writes, so the slider and the
// gesture stay in sync.
(function(){
  const inp = document.getElementById('cam-height'), out = document.getElementById('cam-height-v');
  const sync = ()=>{ inp.value = Math.round((settings.camOffsetY||0)*100/CONFIG.PAN_RANGE); out.textContent = inp.value; };
  sync();
  inp.addEventListener('input', e=>{
    settings.camOffsetY = (+e.target.value/100) * CONFIG.PAN_RANGE;
    out.textContent = e.target.value;
    if (S.frameReady){
      const want = frameTarget.y + settings.camOffsetY*S.frameScale;
      camera.position.y += want - controls.target.y;
      controls.target.y = want;
      controls.update();
    }
  });
  inp.addEventListener('change', saveSettings);
  S.camHeightSync = sync;
})();
// keep the slider honest when the user pans with two fingers
controls.addEventListener('end', ()=>{ saveCamOffset(); if (S.camHeightSync) S.camHeightSync(); });
controls.addEventListener('start', ()=>{ S.lastInteract = performance.now(); });

// Camera lock — disables orbit/pan/zoom but leaves tap reactions working,
// since those are handled by our own pointer code rather than OrbitControls.
const tgCamLock = document.getElementById('tg-camlock');
const btnLock   = document.getElementById('btn-lock');
// One place that reflects lock state everywhere: OrbitControls, the toolbar
// button, the settings switch, and the height slider.
function applyCamLock(){
  const locked = !!settings.camLock;
  controls.enabled = !locked;
  tgCamLock.checked = locked;
  btnLock.textContent = locked ? '🔒' : '🔓';
  btnLock.title = locked ? 'Camera locked — tap to unlock' : 'Lock camera';
  btnLock.style.borderColor = locked ? 'var(--accent)' : 'var(--stroke)';
  document.getElementById('cam-height').disabled = locked;
}
tgCamLock.addEventListener('change', e=>{
  settings.camLock = e.target.checked; saveSettings(); applyCamLock();
});
btnLock.addEventListener('click', ()=>{
  settings.camLock = !settings.camLock; saveSettings(); applyCamLock();
  toast(settings.camLock ? 'Camera locked' : 'Camera unlocked', 1800);
});

document.getElementById('btn-set-default').addEventListener('click', ()=>{
  settings.viewDefault = currentView();
  saveSettings();
  toast('Default view saved', 2500);
});

const selReturn = document.getElementById('auto-return');
selReturn.value = String(settings.autoReturn||0);
selReturn.addEventListener('change', e=>{
  settings.autoReturn = +e.target.value; saveSettings();
  S.lastInteract = performance.now();
});
document.getElementById('scrim').onclick = closeSettings;
document.getElementById('btn-gear').onclick = openSettings;
document.getElementById('grip').onclick = closeSettings;

// Fullscreen
document.getElementById('btn-fs').onclick = async ()=>{
  try{
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI:'hide' });
  }catch(e){ /* iOS Safari: no Fullscreen API — Add to Home Screen instead */ }
};

// Track fullscreen only to keep the button's icon honest — it no longer hides
// any UI. (Standalone PWA counts as fullscreen for icon purposes.)
function syncFullscreenClass(){
  const fs = !!document.fullscreenElement ||
             window.matchMedia('(display-mode: fullscreen)').matches ||
             window.matchMedia('(display-mode: standalone)').matches;
  document.body.classList.toggle('is-fullscreen', fs);
  const b = document.getElementById('btn-fs');
  if (b){ b.textContent = fs ? '⛶' : '⛶'; b.title = fs ? 'Exit fullscreen' : 'Fullscreen'; }
}
document.addEventListener('fullscreenchange', syncFullscreenClass);
window.addEventListener('resize', syncFullscreenClass);

// Screen Wake Lock (keep the phone awake at the con). Re-acquire on focus.
let wakeLock=null;
async function acquireWake(){
  if (settings.keepAwake === false) return;
  try{ if ('wakeLock' in navigator){ wakeLock = await navigator.wakeLock.request('screen'); } }
  catch(e){ /* denied or unsupported */ }
}
document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState==='visible') acquireWake(); });

/* ---- file picker / IndexedDB persistence ---- */
const fileInput = document.getElementById('file');
function pickFile(){ fileInput.value=''; fileInput.click(); }
document.getElementById('btn-pick').onclick = pickFile;
document.getElementById('btn-replace').onclick = ()=>{ closeSettings(); pickFile(); };

fileInput.addEventListener('change', async ()=>{
  const f = fileInput.files[0]; if(!f) return;
  showOverlay(true, 'Loading avatar…', f.name, true);
  const buf = await f.arrayBuffer();
  try{ await idbPut('avatar', { name:f.name, buffer:buf }); }catch(e){ /* private mode: still load in-memory */ }
  await mountVRM(buf, f.name);
});

/* ---- overlay / spinner / errors ---- */





// Small on-screen diagnostic (phones have no easy console).


/* ===========================================================================
   Boot
   =========================================================================== */

// Let lower-level modules drive the UI without importing it (avoids a cycle).
hooks.openSettings  = openSettings;
hooks.closeSettings = closeSettings;
hooks.setMode       = setMode;
hooks.onAvatarLoaded = ()=>{ if (els.sheet.classList.contains('open')) renderMorphList(); };

export { applySettings, applyCamLock, openSettings, closeSettings, setMode, renderMorphList,
         els, acquireWake, syncFullscreenClass, motionNote, pickFile };

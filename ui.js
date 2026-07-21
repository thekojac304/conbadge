// Settings sheet, mode switching, animation test bar, blendshape browser.
import { THREE, S, rig, settings, saveSettings, camera, controls, hooks, toast,
         showOverlay, showError, idbGet, idbPut, resize, motion, enableMotion, disableMotion,
         LS, rand } from './core.js';
import { CONFIG } from './config.js';
import { mountVRM } from './avatar.js';
import { frameCamera, currentView, applyView, saveCamOffset, frameTarget } from './camera.js';
import { gestures, reactions, GESTURE_LIST, tuner, tunerHold, tunerRelease } from './anim.js';
import { LOOK_LIST, applyLightRig, applyLook, lookBackground } from './light.js';



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
  tgBgAuto:document.getElementById('tg-bgauto'),
  tgLight:document.getElementById('tg-light'),
  selLook:document.getElementById('sel-look'),
  lightInt:document.getElementById('light-int'),
  lightIntV:document.getElementById('light-int-v'),
  rimInt:document.getElementById('rim-int'),
  rimIntV:document.getElementById('rim-int-v'),
  stage:document.getElementById('stage'),
  sheet:document.getElementById('settings'),
};

function applySettings(){
  els.pname.textContent = settings.name || '';
  els.ppro.textContent  = settings.pronouns || '';
  els.plate.classList.toggle('hidden', !settings.showPlate || (!settings.name && !settings.pronouns));
  applyBackground();
  // reflect into controls
  els.inName.value=settings.name; els.inPro.value=settings.pronouns;
  els.tgPlate.checked=settings.showPlate; els.tgSaver.checked=settings.saver;
  els.bgA.value=settings.bgA; els.bgB.value=settings.bgB;
  els.tgBgAuto.checked = settings.bgAuto !== false;
  reflectLighting();
  resize();
}

/* ---- Backdrop palette -----------------------------------------------------
   Everything (gradient + orb glows) is driven through CSS custom properties on
   :root, so the manual pickers, the presets, and the Look-matched palette all
   write the same knobs. "Match lighting" (bgAuto) pulls colours from the active
   Look; off falls back to the manual bgA/bgB with the default orb tints. */
const ROOT = document.documentElement;
const DEFAULT_ORBS = ['#2a3a6a','#1c4a52','#3a2a55'];
function applyBackground(){
  const auto = settings.bgAuto !== false;
  let a, b, orbs;
  if (auto){ const bg = lookBackground(); a = bg.a; b = bg.b; orbs = bg.orbs; }
  else     { a = settings.bgA; b = settings.bgB; orbs = DEFAULT_ORBS; }
  ROOT.style.setProperty('--bg-a', a);
  ROOT.style.setProperty('--bg-b', b);
  ROOT.style.setProperty('--orb-a', orbs[0]);
  ROOT.style.setProperty('--orb-b', orbs[1]);
  ROOT.style.setProperty('--orb-c', orbs[2]);
  document.querySelector('meta[name=theme-color]').setAttribute('content', b);
  // Manual pickers/presets are meaningless while the backdrop follows the Look.
  els.bgA.disabled = els.bgB.disabled = auto;
  const presets = document.getElementById('bg-presets');
  if (presets) presets.style.opacity = auto ? '.4' : '';
}

/* ---- Lighting Look, Brightness, Rim -------------------------------------- */
// Populate the Look selector from light.js's registry.
els.selLook.innerHTML = LOOK_LIST.map(o=>`<option value="${o.key}">${o.label}</option>`).join('');

// Mirror the stored lighting settings into the controls + grey out the Look
// style / sliders when the whole system is switched off.
function reflectLighting(){
  const on = settings.lightOn !== false;
  els.tgLight.checked = on;
  els.selLook.value   = settings.look || 'studio';
  els.lightInt.value  = Math.round((settings.lightIntensity ?? 1)*100);
  els.rimInt.value    = Math.round((settings.rimIntensity   ?? 1)*100);
  els.lightIntV.textContent = els.lightInt.value;
  els.rimIntV.textContent   = els.rimInt.value;
  els.selLook.disabled = els.lightInt.disabled = els.rimInt.disabled = !on;
}

els.tgLight.addEventListener('change', e=>{
  settings.lightOn = e.target.checked; saveSettings();
  reflectLighting();
  applyLightRig();                 // switch the rig on/off live
  if (S.vrm) applyLook(S.vrm);     // MToon treatment on when on, restored when off
  applyBackground();               // bg tracks lighting on/off when auto
});
els.selLook.addEventListener('change', e=>{
  settings.look = e.target.value; saveSettings();
  applyLightRig();                 // relight live
  if (S.vrm) applyLook(S.vrm);     // re-treat materials live
  applyBackground();               // re-tint backdrop to the new Look when auto
});
// Brightness + Rim only scale the light rig, so no material re-treat needed.
els.lightInt.addEventListener('input', e=>{
  settings.lightIntensity = +e.target.value/100; els.lightIntV.textContent = e.target.value; applyLightRig();
});
els.rimInt.addEventListener('input', e=>{
  settings.rimIntensity = +e.target.value/100; els.rimIntV.textContent = e.target.value; applyLightRig();
});
els.lightInt.addEventListener('change', saveSettings);
els.rimInt.addEventListener('change', saveSettings);

els.inName.addEventListener('input', e=>{ settings.name=e.target.value; applySettings(); saveSettings(); });
els.inPro.addEventListener('input',  e=>{ settings.pronouns=e.target.value; applySettings(); saveSettings(); });
els.tgPlate.addEventListener('change', e=>{ settings.showPlate=e.target.checked; applySettings(); saveSettings(); });
els.tgSaver.addEventListener('change', e=>{ settings.saver=e.target.checked; S.acc=0; applySettings(); saveSettings(); });
els.bgA.addEventListener('input', e=>{ settings.bgA=e.target.value; applyBackground(); saveSettings(); });
els.bgB.addEventListener('input', e=>{ settings.bgB=e.target.value; applyBackground(); saveSettings(); });
els.tgBgAuto.addEventListener('change', e=>{ settings.bgAuto=e.target.checked; applyBackground(); saveSettings(); });

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
    settings.bgA=a; settings.bgB=c; applyBackground(); saveSettings();
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

/* ---- Animation Tuner ----------------------------------------------------
   Universal pose tuner. Pick any gesture or reaction; it holds that animation
   frozen at its peak so it sits still, then per-bone X/Y/Z + twist sliders add
   offsets on top in real time. The bone list is built from the LOADED rig, so
   every bone the avatar has (fingers, toes, jaw, eyes, …) is posable. The
   readout prints the offsets as pose.add()/pose.twist() deltas to bake in. A
   "Tuner" chip is appended to the test bar. Offsets are ADDITIVE on the
   animation's own pose. */
(function(){
  const box = document.getElementById('test-chips');
  if (!box) return;

  const REACTIONS = ['happy','blush','giggle','bellyRub','fluster','dizzy','boop','wave:right','wave:left'];
  // X/Y/Z euler + a twist (axial roll → pose.twist). Index maps to override[i].
  const CTRLS = [['x','X'],['y','Y'],['z','Z'],['w','Twist (roll)']];
  const RANGE = 1.8;   // slider extent (radians)

  // Friendly labels for the joints; everything else (fingers, toes) is prettified.
  const LABELS = {
    leftLowerArm:'L forearm — ELBOW', rightLowerArm:'R forearm — ELBOW',
    leftLowerLeg:'L shin — KNEE', rightLowerLeg:'R shin — KNEE',
    leftUpperArm:'L upper arm (shoulder)', rightUpperArm:'R upper arm (shoulder)',
    leftUpperLeg:'L thigh (hip)', rightUpperLeg:'R thigh (hip)',
    leftHand:'L hand / wrist', rightHand:'R hand / wrist',
    leftFoot:'L foot / ankle', rightFoot:'R foot / ankle',
    leftShoulder:'L shoulder (clavicle)', rightShoulder:'R shoulder (clavicle)',
  };
  function pretty(n){
    let pre='';
    if (n.startsWith('left'))  { pre='L '; n=n.slice(4); }
    else if (n.startsWith('right')) { pre='R '; n=n.slice(5); }
    n = n.replace(/([a-z])([A-Z])/g,'$1 $2');
    return pre + n.charAt(0).toUpperCase() + n.slice(1);
  }
  const label = n => LABELS[n] || pretty(n);
  function group(n){
    if (/Thumb|Index|Middle|Ring|Little/.test(n)) return n.startsWith('left') ? 'Left hand — fingers' : 'Right hand — fingers';
    if (/^left(Shoulder|UpperArm|LowerArm|Hand)/.test(n))  return 'Left arm';
    if (/^right(Shoulder|UpperArm|LowerArm|Hand)/.test(n)) return 'Right arm';
    if (/^left(UpperLeg|LowerLeg|Foot|Toes)/.test(n))  return 'Left leg';
    if (/^right(UpperLeg|LowerLeg|Foot|Toes)/.test(n)) return 'Right leg';
    return 'Body / head';
  }
  const GROUP_ORDER = ['Body / head','Left arm','Left hand — fingers','Right arm',
                       'Right hand — fingers','Left leg','Right leg'];

  const btn = (id,txt,flex='') =>
    `<button id="${id}" style="${flex}padding:6px 9px;border-radius:6px;border:1px solid #2b3a55;`+
    `background:#1c2740;color:#e8eefc;cursor:pointer">${txt}</button>`;

  const panel = document.createElement('div');
  panel.id = 'anim-tuner';
  panel.style.cssText =
    'position:fixed;right:8px;top:8px;width:268px;max-height:94vh;overflow:auto;'+
    'z-index:9999;background:rgba(12,16,24,.94);color:#e8eefc;border:1px solid #2b3a55;'+
    'border-radius:10px;padding:10px 12px;font:12px/1.35 system-ui,sans-serif;'+
    'box-shadow:0 6px 24px rgba(0,0,0,.5);display:none;';

  const optList = (arr,tag) => arr.map(n=>`<option value="${tag}:${n}">${n} (${tag[0]})</option>`).join('');
  let html =
    '<style>'+
      '#anim-tuner select,#anim-tuner input[type=text]{background:#1c2740;color:#e8eefc;'+
        'border:1px solid #2b3a55;border-radius:6px;padding:5px;width:100%;box-sizing:border-box}'+
      '#anim-tuner option{background:#12192a;color:#e8eefc}'+
      '#anim-tuner optgroup{background:#0b1018;color:#8fb0e0;font-style:normal}'+
    '</style>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<b>Animation Tuner</b>'+
      '<button id="tn-close" style="background:none;border:0;color:#9fb3d9;font-size:16px;cursor:pointer">✕</button>'+
    '</div>'+
    '<label style="display:block;margin-bottom:2px;color:#9fb3d9">Animation</label>'+
    `<select id="tn-anim" style="margin-bottom:8px">`+
      `<optgroup label="Gestures">${optList(GESTURE_LIST,'gesture')}</optgroup>`+
      `<optgroup label="Reactions">${optList(REACTIONS,'reaction')}</optgroup>`+
    `</select>`+
    '<label style="display:block;margin-bottom:2px;color:#9fb3d9">Bone / joint</label>'+
    `<input type="text" id="tn-filter" placeholder="filter bones (e.g. finger, knee)…" style="margin-bottom:5px">`+
    `<select id="tn-bone" size="1" style="margin-bottom:8px"></select>`;
  for (const [ax,lbl] of CTRLS){
    html +=
      `<label style="display:block;margin:6px 0 2px">${lbl} `+
      `<span id="tn-v-${ax}" style="float:right;color:#8fd0ff;font-variant-numeric:tabular-nums"></span></label>`+
      `<input type="range" id="tn-s-${ax}" min="${-RANGE}" max="${RANGE}" step="0.01" style="width:100%">`;
  }
  html +=
    '<div style="display:flex;gap:6px;margin-top:10px">'+
      btn('tn-mirror-lr','L→R','flex:1;')+ btn('tn-mirror-rl','R→L','flex:1;')+
      btn('tn-zero','Zero')+
    '</div>'+
    // Face / expression morphs (mouth, blink, blush, brows, tongue …) — a
    // separate channel from bones, driven via setExpr. Built from the avatar.
    '<div style="margin-top:12px;color:#9fb3d9;border-top:1px solid #24314c;padding-top:8px">'+
      '<b>Face / expression</b></div>'+
    '<div id="tn-face"></div>'+
    '<div style="display:flex;gap:6px;margin-top:10px">'+
      btn('tn-copy','Copy deltas','flex:1;')+ btn('tn-reset','Reset all')+
    '</div>'+
    '<textarea id="tn-out" readonly style="width:100%;height:130px;margin-top:8px;box-sizing:border-box;'+
    'background:#0b1018;color:#bfe0ff;border:1px solid #2b3a55;border-radius:6px;font:11px/1.3 monospace;padding:6px"></textarea>';
  panel.innerHTML = html;
  document.body.appendChild(panel);

  const el = id => document.getElementById(id);
  const cur = () => el('tn-bone').value;
  const ov  = b => { let o = tuner.overrides[b]; if (!o){ o=[0,0,0,0]; tuner.overrides[b]=o; } return o; };

  // Build the bone dropdown from the LOADED rig, grouped + filtered.
  function buildBones(){
    const sel = el('tn-bone');
    const names = Object.keys(rig.bones || {});
    if (!names.length){ sel.innerHTML = '<option value="">— load an avatar first —</option>'; return; }
    const f = (el('tn-filter').value || '').trim().toLowerCase();
    const groups = {};
    for (const n of names){
      if (f && !n.toLowerCase().includes(f) && !label(n).toLowerCase().includes(f)) continue;
      (groups[group(n)] ||= []).push(n);
    }
    const order = [...GROUP_ORDER, ...Object.keys(groups).filter(g=>!GROUP_ORDER.includes(g))];
    let h = '';
    for (const g of order){
      if (!groups[g]) continue;
      h += `<optgroup label="${g}">` +
           groups[g].map(n=>`<option value="${n}">${label(n)}</option>`).join('') + '</optgroup>';
    }
    // Ears/tail are non-humanoid nodes — expose them with synthetic keys
    // (ear0…, tail0…) that applyEarPose/applyTailPose pick up via tunerAddTo.
    const extras = [];
    for (let i=0;i<(rig.ears?.length||0);i++) extras.push(['ear'+i, 'Ear '+i]);
    for (let i=0;i<(rig.tail?.length||0);i++) extras.push(['tail'+i, 'Tail '+(i+1)]);
    const fe = extras.filter(([k,l]) => !f || k.includes(f) || l.toLowerCase().includes(f));
    if (fe.length) h += `<optgroup label="Ears / tail">` +
      fe.map(([k,l])=>`<option value="${k}">${l}</option>`).join('') + '</optgroup>';
    const prev = sel.value;
    sel.innerHTML = h || '<option value="">(no match)</option>';
    if (prev && [...sel.options].some(o=>o.value===prev)) sel.value = prev;
  }

  // Face / expression sliders, built from the avatar's animatable morphs.
  function buildFace(){
    const wrap = el('tn-face');
    const morphs = Object.keys(rig.morphs || {});
    if (!morphs.length){ wrap.innerHTML = '<div style="color:#8090a8;margin:4px 0">No expression morphs on this avatar.</div>'; return; }
    wrap.innerHTML = morphs.map((m,i)=>
      `<label style="display:block;margin:5px 0 2px">${m} `+
      `<span id="tn-fv-${i}" style="float:right;color:#8fd0ff;font-variant-numeric:tabular-nums"></span></label>`+
      `<input type="range" id="tn-fs-${i}" min="0" max="1" step="0.01" style="width:100%">`
    ).join('');
    morphs.forEach((m,i)=>{
      const s = el('tn-fs-'+i), v = el('tn-fv-'+i);
      const cur0 = tuner.face[m] || 0;
      s.value = cur0; v.textContent = cur0.toFixed(2);
      s.addEventListener('input', ev=>{
        tuner.face[m] = parseFloat(ev.target.value);
        v.textContent = tuner.face[m].toFixed(2);
        readout();
      });
    });
  }

  function readout(){
    const anim = el('tn-anim').value.split(':').slice(1).join(':');
    const lines = [];
    for (const b in tuner.overrides){
      const o = tuner.overrides[b]; if (!o) continue;
      const special = /^(ear|tail)\d+$/.test(b);   // ears/tail applied specially
      if (o[0]||o[1]||o[2]) lines.push(special
        ? `// ${b}: rotate ${o[0].toFixed(2)}, ${o[1].toFixed(2)}, ${o[2].toFixed(2)}`
        : `pose.add('${b}', ${o[0].toFixed(2)}, ${o[1].toFixed(2)}, ${o[2].toFixed(2)});`);
      if (o[3]) lines.push(special
        ? `// ${b}: twist ${o[3].toFixed(2)}`
        : `pose.twist('${b}', ${o[3].toFixed(2)});`);
    }
    for (const s in tuner.face){ if (tuner.face[s]) lines.push(`setExpr('${s}', ${tuner.face[s].toFixed(2)});`); }
    el('tn-out').value = `// ${anim} — additive deltas\n` + (lines.join('\n') || '// (no offsets yet)');
  }
  function syncSliders(){
    const o = cur() ? ov(cur()) : [0,0,0,0];
    CTRLS.forEach(([ax],i)=>{
      const v = o[i] || 0;
      el('tn-s-'+ax).value = v;
      el('tn-v-'+ax).textContent = (v>=0?' ':'') + v.toFixed(2);
    });
  }
  function refresh(){ syncSliders(); readout(); }

  CTRLS.forEach(([ax],i)=>{
    el('tn-s-'+ax).addEventListener('input', ev=>{
      if (!cur()) return;
      ov(cur())[i] = parseFloat(ev.target.value);
      el('tn-v-'+ax).textContent = (ov(cur())[i]>=0?' ':'') + ov(cur())[i].toFixed(2);
      readout();
    });
  });
  el('tn-bone').addEventListener('change', syncSliders);
  el('tn-filter').addEventListener('input', ()=>{ buildBones(); syncSliders(); });
  el('tn-anim').addEventListener('change', ()=>{
    const [kind, ...rest] = el('tn-anim').value.split(':');
    tunerHold(kind, rest.join(':'));
  });
  el('tn-zero').addEventListener('click', ()=>{ if(cur()){ tuner.overrides[cur()] = [0,0,0,0]; refresh(); } });
  el('tn-reset').addEventListener('click', ()=>{ tuner.overrides = {}; tuner.face = {}; buildFace(); refresh(); });

  // Mirror every override on one side to the other. Across the sagittal plane
  // the world-aligned bones negate Y, Z and the axial twist; X carries over.
  function mirror(from){
    const to = from==='left' ? 'right' : 'left';
    for (const b of Object.keys(tuner.overrides)){
      if (!b.startsWith(from)) continue;
      const o = tuner.overrides[b]; if (!o) continue;
      tuner.overrides[to + b.slice(from.length)] = [o[0]||0, -(o[1]||0), -(o[2]||0), -(o[3]||0)];
    }
    refresh();
  }
  el('tn-mirror-lr').addEventListener('click', ()=>mirror('left'));
  el('tn-mirror-rl').addEventListener('click', ()=>mirror('right'));
  el('tn-copy').addEventListener('click', ()=>{
    const out = el('tn-out'); out.select();
    try { navigator.clipboard.writeText(out.value); } catch(e){}
    try { document.execCommand('copy'); } catch(e){}
    toast('Deltas copied', 1400);
  });

  let open = false;
  function setOpen(v){
    open = v;
    panel.style.display = v ? 'block' : 'none';
    if (v){
      buildBones();
      buildFace();
      const [kind, ...rest] = el('tn-anim').value.split(':');
      tunerHold(kind, rest.join(':'));
      refresh();
    } else {
      tunerRelease();
    }
  }
  el('tn-close').addEventListener('click', ()=>setOpen(false));

  const chip = document.createElement('button');
  chip.className = 'chip react';
  chip.textContent = '⚙ Tuner';
  chip.addEventListener('click', ()=>setOpen(!open));
  box.appendChild(chip);
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

hooks.openSettings   = openSettings;
hooks.closeSettings  = closeSettings;
hooks.setMode        = setMode;
hooks.onAvatarLoaded = ()=>{ if (els.sheet.classList.contains('open')) renderMorphList(); };

export { applySettings, applyCamLock, openSettings, closeSettings, setMode, renderMorphList,
         els, acquireWake, syncFullscreenClass, motionNote, pickFile };

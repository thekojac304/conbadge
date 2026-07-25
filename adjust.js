// Per-avatar animation adjustments.
//
// A built-in procedural animation stays exactly as authored; this module holds a
// static pose DELTA per animation, per avatar, and adds it into the same pose
// accumulator the animation itself writes to, immediately after the animation
// runs. Nothing here forks, rewrites or replaces a built-in — an adjustment is
// purely additive data, so clearing it returns the animation to its source
// behaviour bit-for-bit, and improving a built-in later still carries through
// (the delta rides on top of whatever the new pose is).
//
// Why per-avatar: a delta like "right shoulder back 0.64" exists because THIS
// rig's arm is this long. Source can only hold one set of numbers; the project
// record holds a set per avatar. Keyed on the VRM's filename, NOT its bytes, so
// re-exporting the same avatar doesn't orphan its tuning.
//
// Dependency position (imports config + project + pose only, nothing above it):
//   config → core → project → light/pose → ADJUST → camera → anim → avatar/input → ui → main
// anim.js applies it, ui.js edits it; this module imports neither. Deleting this
// file plus its call sites removes the feature completely.
import { CONFIG } from './config.js';
import * as project from './project.js';
import { pose, setExpr } from './pose.js';

// Ears/tail aren't humanoid bones — pose.add() no-ops on them. Their offsets are
// collected per frame and consumed by applyEarPose/applyTailPose AFTER
// S.vrm.update(), which is the only point they can be written (same path the
// live Tuner and clip playback already use).
const NODE_KEY = /^(ear|tail)\d+$/;

// { [avatarKey]: { [animId]: {ov, face, build, at} } }
const store = { avatars:{} };

const cloneAdj = a => !a ? null : {
  ov:   Object.fromEntries(Object.entries(a.ov   || {}).map(([b,v]) => [b, (v||[]).slice(0,4)])),
  face: { ...(a.face || {}) },
  build: a.build || null,
  at:    a.at || null,
};
const cloneAll = src => Object.fromEntries(Object.entries(src || {}).map(([k, anims]) =>
  [k, Object.fromEntries(Object.entries(anims || {}).map(([id, a]) => [id, cloneAdj(a)]))]));

// The avatar reference object only changes identity when a different model is
// noted, so this recomputes the key on an avatar switch and is a no-op otherwise.
let lastRef, curKey = '';
function avatarKey(){
  const ref = project.avatarInfo();
  if (ref !== lastRef){
    lastRef = ref;
    curKey = String(ref?.name || '').trim().toLowerCase().replace(/\.vrm$/, '');
  }
  return curKey;
}

const isEmpty = d => !d || (!Object.keys(d.ov || {}).length && !Object.keys(d.face || {}).length);

export const adjust = {
  // Animation currently held by the Tuner. Its adjustment is muted while it's
  // being edited, because the Tuner has loaded that same delta into its sliders —
  // applying both would double it.
  suppress: null,
  // This frame's accumulated ear/tail offsets, by synthetic key ('ear0', 'tail2').
  nodes: {},

  // Called once per frame from main.js, alongside pose.clear().
  frame(){ for (const k in this.nodes) delete this.nodes[k]; },

  key(){ return avatarKey(); },
  get(id){ return store.avatars[avatarKey()]?.[id] || null; },
  has(id){ return !!this.get(id); },
  list(){ return Object.keys(store.avatars[avatarKey()] || {}); },
  count(){ return this.list().length; },

  // Store a delta for `id` on the current avatar. `d` is the Tuner's snapshot
  // shape: { ov:{bone:[x,y,z,twist]}, face:{morph:weight} }. An all-zero pose
  // clears instead of storing an empty adjustment, so "zero everything and save"
  // and "Clear" mean the same thing.
  set(id, d){
    if (isEmpty(d)) return this.clear(id);
    const k = avatarKey();
    if (!k) return false;                       // no avatar loaded — nothing to key on
    (store.avatars[k] ||= {})[id] = cloneAdj({ ...d, build:CONFIG.BUILD, at:new Date().toISOString() });
    project.saveSoon('anim-adjust');
    return true;
  },

  clear(id){
    const k = avatarKey(), bucket = store.avatars[k];
    if (!bucket || !bucket[id]) return false;
    delete bucket[id];
    if (!Object.keys(bucket).length) delete store.avatars[k];
    project.saveSoon('anim-adjust-clear');
    return true;
  },

  // Add this animation's stored delta into the current frame's pose, scaled by
  // the animation's own weight `w` (its envelope for gestures/reactions, 1 for
  // idle, energy for petting). Scaling is what keeps the delta from popping on at
  // the animation's start and off at its end — it fades in and out with the
  // motion. The Tuner holds at peak (w≈1), so what's dialled in is what shows at
  // the animation's peak.
  apply(id, w){
    if (!w || w <= 0.001 || this.suppress === id) return;
    const a = this.get(id);
    if (!a) return;
    for (const b in a.ov){
      const o = a.ov[b]; if (!o) continue;
      if (NODE_KEY.test(b)){
        const n = (this.nodes[b] ||= [0,0,0,0]);
        n[0] += (o[0]||0)*w; n[1] += (o[1]||0)*w; n[2] += (o[2]||0)*w; n[3] += (o[3]||0)*w;
        continue;
      }
      if (o[0] || o[1] || o[2]) pose.add(b, o[0]||0, o[1]||0, o[2]||0, w);
      if (o[3]) pose.twist(b, o[3], w);
    }
    // Face weights go through setExpr like every other layer, so they take the
    // same max() semantics: an adjustment can raise a morph above what the
    // animation asks for, not pull one below it.
    for (const s in a.face){ if (a.face[s]) setExpr(s, a.face[s]*w); }
  },

  // One fragment for the on-screen load readout (the phone has no DevTools, so
  // this is how "my tweaks actually loaded" gets confirmed).
  summary(){
    const n = this.count();
    return n ? ` · ${n} anim tweak${n===1?'':'s'}` : '';
  },
};

project.register({
  id:'animAdjust', version:1,
  capture: ()=> ({ avatars: cloneAll(store.avatars) }),
  apply(d){ store.avatars = cloneAll(d?.avatars); },
});

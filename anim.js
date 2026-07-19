// Idle life, gesture library, tail/ear motion, particles, petting, reactions.
import { THREE, S, rig, settings, scene, camera, rand, motion, hooks } from './core.js';
import { CONFIG } from './config.js';
import { pose, setExpr, envelope, armBase, armReach, scratchTarget, anchorWorld } from './pose.js';

const idle = {
  t:0, blinkIn:rand(2,5), blinkT:-1, gaze:{x:0,y:0}, gazeTarget:{x:0,y:0}, gazeIn:rand(1.2,3),
  faceT:-1, faceIn:rand(3,8), faceKind:null,
  // Weight of the STANDING part of the idle — arms, legs, the bounce. `hold`
  // drives this to 0 while he's off the ground: feet planted on nothing looks
  // absurd, and the resting arm angles fight the dangle. Breathing, blinking,
  // gaze and the face are deliberately NOT gated — those keep running.
  body:1,
  reset(){ this.t=0; this.blinkIn=rand(2,5); this.blinkT=-1; this.gaze={x:0,y:0}; this.gazeTarget={x:0,y:0}; this.gazeIn=rand(1.2,3);
           this.faceT=-1; this.faceIn=rand(3,8); this.faceKind=null; this.body=1; },
  update(dt){
    this.t += dt;

    // Relaxed resting pose. The trick to not looking stiff is layering several
    // slow sines at DIFFERENT frequencies so nothing loops visibly and the two
    // arms never mirror each other exactly.
    const A = CONFIG.ARM_DOWN, F = CONFIG.ARM_FORWARD, O = CONFIG.ARM_OUT, E = CONFIG.ELBOW_BEND;
    const swayL = Math.sin(this.t*0.53)*0.05, swayR = Math.sin(this.t*0.61 + 1.3)*0.05;
    const swingL = Math.sin(this.t*0.31 + 0.4)*0.045, swingR = Math.sin(this.t*0.27 + 2.1)*0.045;
    const flexL = Math.sin(this.t*0.43 + 1.9)*0.13, flexR = Math.sin(this.t*0.37 + 0.6)*0.13;
    const br = Math.sin(this.t*1.9)*0.5+0.5;      // shared breathing phase

    // The 5th argument to pose.add is a weight — passing the body gain here is
    // all it takes to hand the limbs over to `hold`.
    const bd = this.body;

    // shoulders lift a little with each breath
    pose.add('leftShoulder',  0, 0,  br*0.035, bd);
    pose.add('rightShoulder', 0, 0, -br*0.035, bd);
    // upper arms: splay + slow forward/back swing + breathing
    pose.add('leftUpperArm',  0, -F + swingL,  A - O + swayL + br*0.02, bd);
    pose.add('rightUpperArm', 0,  F - swingR, -A + O - swayR - br*0.02, bd);
    // elbows breathe open and closed instead of holding one fixed angle
    pose.add('leftLowerArm',  0, -(E + flexL), 0, bd);
    pose.add('rightLowerArm', 0,  (E + flexR), 0, bd);
    // wrists drift so the hands aren't rigid blocks
    pose.add('leftHand',  swayL*0.8, -0.08 + flexL*0.3,  swayL*0.5, bd);
    pose.add('rightHand', swayR*0.8,  0.08 - flexR*0.3, -swayR*0.5, bd);

    // Knees: a soft resting flex plus a slow bounce. Bending a knee needs three
    // joints working together or the pose breaks — the thigh swings forward
    // (hip flexion), the shin swings back (knee flexion), and the ankle
    // counter-rotates so the foot stays flat on the ground.
    const bph  = Math.sin(this.t*CONFIG.BOUNCE_RATE)*0.5 + 0.5;    // 0..1
    const knee = CONFIG.KNEE_BEND + bph*CONFIG.BOUNCE_AMOUNT;
    const legs = [['leftUpperLeg','leftLowerLeg','leftFoot'], ['rightUpperLeg','rightLowerLeg','rightFoot']];
    // legs run slightly out of phase with each other so the stance shifts
    // subtly instead of both knees pumping in perfect unison
    const legPhase = [Math.sin(this.t*0.41)*0.06, Math.sin(this.t*0.41 + 2.2)*0.06];
    legs.forEach((set, i)=>{
      const k = Math.max(0, knee*(i===0 ? 1.0 : 0.88) + legPhase[i]);
      pose.add(set[0], -k*0.45, 0, 0, bd);   // thigh forward
      pose.add(set[1],  k,      0, 0, bd);   // shin back (knee flexes)
      pose.add(set[2], -k*0.55, 0, 0, bd);   // ankle keeps the foot flat
    });
    // sink the hips as the knees flex so the body bobs instead of the feet sliding
    S.hipsDrop = -knee * rig.legLength * CONFIG.HIP_DROP * 0.5 * bd;

    // subtle weight-shift so the body isn't statue-still
    pose.add('hips', 0, Math.sin(this.t*0.5)*0.02, Math.sin(this.t*0.4)*0.025);
    pose.add('spine', 0, Math.sin(this.t*0.5)*0.015, 0);

    // breathing — a touch quicker so it reads as alive (~18 breaths/min)
    const b = Math.sin(this.t*1.9)*0.5+0.5;
    pose.add('chest',      b*0.05);
    pose.add('upperChest', b*0.035);
    pose.add('spine',      b*0.015);

    // wandering gaze: pick a new look point every 1–3s and ease toward it, so
    // the eyes actually saccade around instead of drifting imperceptibly.
    this.gazeIn -= dt;
    if (this.gazeIn <= 0){ this.gazeTarget = { x:(Math.random()*2-1)*0.5, y:(Math.random()*2-1)*0.28 }; this.gazeIn = rand(1.2,3.2); }
    const k = 1 - Math.pow(0.02, dt);                 // fast-ish ease toward target
    this.gaze.x += (this.gazeTarget.x - this.gaze.x)*k;
    this.gaze.y += (this.gazeTarget.y - this.gaze.y)*k;
    const gx = this.gaze.x, gy = this.gaze.y;

    // Eyes: BOTH driven from the same value so they can never desync. Skipped
    // entirely unless both eye bones exist (a lone eye bone looks broken).
    const G = CONFIG.EYE_GAIN;
    if (G > 0 && rig.bones.leftEye && rig.bones.rightEye){
      pose.add('leftEye',  -gy*G, gx*G, 0);
      pose.add('rightEye', -gy*G, gx*G, 0);
    }
    pose.add('neck', -gy*0.18, gx*0.30, 0);
    pose.add('head', -gy*0.12, gx*0.20, gx*0.05);
    pose.add('chest', 0, gx*0.06, 0);

    // Tilt response: when the phone leans, he shifts weight to stay upright —
    // the same instinct as standing on a moving bus. Smoothed hard because raw
    // accelerometer data is far too jittery to drive a pose directly.
    if (motion.active && CONFIG.TILT_LEAN > 0){
      const wantLean  = THREE.MathUtils.clamp((motion.gamma||0)/40, -1, 1);
      const wantPitch = THREE.MathUtils.clamp(((motion.beta||0)-45)/50, -1, 1);
      const k = 1 - Math.pow(0.06, dt);
      motion.lean  += (wantLean  - motion.lean ) * k;
      motion.pitch += (wantPitch - motion.pitch) * k;
      const L = motion.lean * CONFIG.TILT_LEAN, P = motion.pitch * CONFIG.TILT_LEAN;
      pose.add('hips',  P*0.10, 0, -L*0.12);
      pose.add('spine', -P*0.05, 0,  L*0.07);
      pose.add('chest', -P*0.04, 0,  L*0.06);
      pose.add('head',  -P*0.05, L*0.06, L*0.09);
      // outside arm drifts out slightly for balance
      pose.add('leftUpperArm',  0, 0, -Math.max(0,-L)*0.18);
      pose.add('rightUpperArm', 0, 0,  Math.max(0, L)*0.18);
    }

    // ---- facial idle -------------------------------------------------------
    // A faint smile that slowly breathes, so the face is never fully neutral.
    setExpr('smile', Math.max(0, CONFIG.IDLE_SMILE + Math.sin(this.t*0.23)*0.10));

    // Periodic micro-expressions — small, brief, and randomly chosen. These are
    // what stop the face reading as a mask between the big touch reactions.
    if (this.faceT < 0){
      this.faceIn -= dt;
      if (this.faceIn <= 0){
        const kinds = ['browUp','smileEyes','smileBig','glance','squintThink'];
        this.faceKind = kinds[(Math.random()*kinds.length)|0];
        this.faceT = 0; this.faceIn = rand(6,16);
      }
    } else {
      this.faceT += dt;
      const D = 1.4, w = envelope(this.faceT, D, 0.28, 0.38);
      switch(this.faceKind){
        case 'browUp':     setExpr('browUp', 0.55*w); break;
        case 'smileEyes':  setExpr('smileEyes', 0.5*w); setExpr('smile', 0.35*w); break;
        case 'smileBig':   setExpr('happy', 0.32*w); setExpr('smile', 0.45*w); break;
        case 'glance':     setExpr('browUp', 0.25*w); setExpr('surprised', 0.12*w); break;
        case 'squintThink':setExpr('browDown', 0.30*w); setExpr('smileEyes', 0.22*w); break;
      }
      if (this.faceT >= D) this.faceT = -1;
    }

    // blinking at randomized intervals — short and capped so lids don't clip
    if (this.blinkT<0){ this.blinkIn-=dt; if(this.blinkIn<=0){ this.blinkT=0; } }
    else{
      this.blinkT += dt;
      const D=CONFIG.BLINK_TIME;
      const w = this.blinkT<D/2 ? (this.blinkT/(D/2)) : (1-(this.blinkT-D/2)/(D/2));
      // scale the blink down while petting: the eyes are already softened, and
      // stacking a full blink on top pushes the lids through the face
      const petEase = 1 - Math.min(0.75, petting.energy);
      setExpr('blink', Math.max(0, Math.min(1, w)) * CONFIG.BLINK_MAX * petEase);
      if (this.blinkT>=D){ this.blinkT=-1; this.blinkIn=rand(2,5); }
    }
  }
};

/* ===========================================================================
   Idle gestures — procedural, randomized every 15–45s, crossfaded.
   Each returns its effect through the pose accumulator, scaled by an envelope
   so it eases in and out. `gestureGain` fades the whole layer out instantly
   when a touch reaction fires, so gestures never fight reactions.
   =========================================================================== */
const GESTURES = {
  // IMPORTANT: these are DELTAS from the resting pose, not absolute angles.
  // Rest puts the right arm at Z = -A and the left at Z = +A (A = ARM_DOWN).
  // So to raise the right arm to X above horizontal the delta is +(A + X),
  // and the left mirrors it as -(A + X). Getting this backwards rotates the
  // arm through the body and looks 180° off.
  // The elbow fold and the side-to-side sweep share the Z axis, so most of the
  // motion lives in the WRIST — otherwise oscillating the fold just swings the
  // paw between the face and a straight arm. The forearm holds ~upright and
  // only tips slightly; the hand does the actual waving.
  wave(t,d){ const e=envelope(t,d); const s=Math.sin(t*7);
    const W=CONFIG.WAVE_WAGGLE, P=CONFIG.WAVE_PALM;
    armBase('right', e);                                                // clean slate
    pose.add('rightUpperArm', 0, CONFIG.WAVE_FORWARD*e, CONFIG.WAVE_RAISE*e);
    pose.add('rightLowerArm', 0, 0, (CONFIG.WAVE_ELBOW + s*W*0.35)*e);  // upright, slight tip
    pose.add('rightHand',     0, 0, (s*W)*e);                           // wrist does the wave
    // Palm orientation as a TRUE axial roll, mostly at the wrist — twisting the
    // forearm at its root is what pinches the mesh at the elbow.
    pose.twist('rightLowerArm', P*0.3*e);
    pose.twist('rightHand',     P*0.7*e);
  },
  // A real stretch isn't symmetric and isn't a hold — the arms lead with bent
  // elbows, unfold near the top, and arrive slightly apart in time.
  // NOTE: raising an arm SUBTRACTS on the left and ADDS on the right, hence the
  // `m` mirror. Getting that backwards swings the arm through the body.
  stretch(t,d){
    const armE = (off)=> envelope(Math.max(0, t-off), d-off, 0.34, 0.30);
    const sway = Math.sin(t*1.7);
    const doArm = (side, e)=>{
      if (e <= 0.001) return;
      const m = side==='left' ? -1 : 1;
      armBase(side, e);                                   // clean slate
      const unfold = Math.max(0, 1 - e*1.6);              // elbows open near the top
      const up = side==='left' ? 'leftUpperArm' : 'rightUpperArm';
      const lo = side==='left' ? 'leftLowerArm' : 'rightLowerArm';
      const hd = side==='left' ? 'leftHand'     : 'rightHand';
      pose.add(up, 0, m*(-0.08)*e, m*(CONFIG.STRETCH_RAISE + sway*0.05)*e);
      pose.add(lo, 0, 0, m*(0.95*unfold + 0.10)*e);
      pose.add(hd, 0, 0, m*0.14*e);
    };
    doArm('left',  armE(0.0));
    doArm('right', armE(0.22));                           // right lags behind

    // body follows: arch back, rise slightly, head tips up then relaxes
    const body = envelope(t, d, 0.3, 0.32);
    pose.add('spine', -0.14*body, sway*0.03*body, 0);
    pose.add('chest', -0.11*body, 0, 0);
    pose.add('neck',  -0.08*body, 0, 0);
    pose.add('head',  -0.13*body, sway*0.05*body, 0);
    gestureHips = Math.max(gestureHips, 0.03*rig.legLength*body);
    pose.add('leftLowerLeg',  -0.10*body, 0, 0);
    pose.add('rightLowerLeg', -0.10*body, 0, 0);
    setExpr('smileEyes', 0.35*body);
  },
  footShuffle(t,d){ const e=envelope(t,d); const s=Math.sin(t*3.0);
    const up = Math.max(0,s), dn = Math.max(0,-s);
    pose.add('hips', 0, s*0.05*e, s*0.06*e);            // weight shifts side to side
    // each step lifts the thigh, folds the knee, and lands the foot flat
    pose.add('rightUpperLeg', -up*0.30*e, 0, 0);
    pose.add('rightLowerLeg',  up*0.52*e, 0, 0);
    pose.add('rightFoot',     -up*0.22*e, 0, 0);
    pose.add('leftUpperLeg',  -dn*0.30*e, 0, 0);
    pose.add('leftLowerLeg',   dn*0.52*e, 0, 0);
    pose.add('leftFoot',      -dn*0.22*e, 0, 0);
    pose.add('spine', 0, s*0.03*e, 0);
  },
  lookAround(t,d){ const e=envelope(t,d,0.3,0.3); const s=Math.sin(t*1.4);
    pose.add('neck',0, s*0.5*e, 0); pose.add('head',0, s*0.35*e, s*0.08*e);
    pose.add('chest',0, s*0.12*e, 0);
  },
  headTilt(t,d){ const e=envelope(t,d,0.35,0.4);
    pose.add('head',0,0.05*e, 0.5*e); pose.add('neck',0,0,0.22*e);
  },

  // Head scratch: the paw position is SOLVED (see armReach) so it lands beside
  // the ear on any avatar, instead of relying on angles tuned to one rig.
  scratchHead(t,d){ const e=envelope(t,d,0.28,0.3); const s=Math.sin(t*15);
    const tgt = scratchTarget();
    if (tgt && armReach('right', tgt, e)){
      // Twist the forearm so the PALM faces the head — rotating about the bone's
      // own X axis is pronation/supination, exactly the motion you'd use.
      pose.add('rightLowerArm', CONFIG.SCRATCH_PALM*e, 0, s*0.09*e);
      pose.add('rightHand',     CONFIG.SCRATCH_PALM*0.35*e, 0, (0.12 + s*0.30)*e);
    } else {
      // fallback if the rig couldn't be measured
      const A=CONFIG.ARM_DOWN;
      pose.add('rightUpperArm', 0, 0, (A+0.10)*e);
      pose.add('rightLowerArm', 0, 0, (2.30 + s*0.09)*e);
      pose.add('rightHand',     0, 0, (0.12 + s*0.30)*e);
    }
    pose.add('head', 0.04*e, -0.09*e, -0.12*e);      // leans into it
    pose.add('neck', 0, -0.05*e, -0.06*e);
    earImpulse = Math.max(earImpulse, 0.4*e);
  },

  // The full-body dog shake. Fast alternating twist that travels head→hips.
  shake(t,d){ const e=envelope(t,d,0.14,0.22);
    const f = Math.sin(t*23), f2 = Math.sin(t*23 - 0.7), f3 = Math.sin(t*23 - 1.4);
    pose.add('head',  0, f*0.30*e, f*0.14*e);
    pose.add('neck',  0, f2*0.20*e, 0);
    pose.add('chest', 0, f2*-0.13*e, 0);
    pose.add('spine', 0, f3*-0.10*e, 0);
    pose.add('hips',  0, f3*0.07*e, 0);
    gestureTail = Math.max(gestureTail, 0.5*e);
    earImpulse  = Math.max(earImpulse, 0.9*e);
  },

  // Shift weight onto one hip and settle — a casual standing reset.
  weightShift(t,d){ const e=envelope(t,d,0.4,0.4);
    pose.add('hips',  0, 0.09*e, 0.12*e);
    pose.add('spine', 0,-0.04*e,-0.07*e);
    pose.add('chest', 0, 0,      -0.05*e);
    pose.add('head',  0, 0,       0.05*e);
    pose.add('leftUpperLeg',  0.05*e, 0, 0);
    pose.add('rightLowerLeg', 0.10*e, 0, 0);
  },

  // Dip the muzzle and take a couple of quick sniffs.
  sniff(t,d){ const e=envelope(t,d,0.22,0.3); const n=Math.sin(t*11);
    pose.add('head', (0.20 + n*0.045)*e, 0.06*e, 0);
    pose.add('neck', 0.11*e, 0.04*e, 0);
    pose.add('chest', 0.04*e, 0, 0);
    earImpulse = Math.max(earImpulse, 0.25*e);
  },

  // Lazy tail swish with a small counter-balance in the hips.
  tailSwish(t,d){ const e=envelope(t,d,0.3,0.35);
    gestureTail = Math.max(gestureTail, 1.0*e);
    pose.add('hips', 0, Math.sin(t*2.2)*0.035*e, 0);
  },

  // ---- leg gestures -------------------------------------------------------
  // Lift a hind paw, fold the knee, glance down at it, put it back.
  pawLift(t,d){ const e=envelope(t,d,0.28,0.32);
    pose.add('rightUpperLeg', -0.42*e, 0, 0);   // thigh forward
    pose.add('rightLowerLeg',  0.80*e, 0, 0);   // knee folds up
    pose.add('rightFoot',     -0.28*e, 0, 0);
    pose.add('hips',  0, 0, -0.06*e);           // weight onto the other leg
    pose.add('leftLowerLeg', 0.08*e, 0, 0);
    pose.add('head', 0.06*e, -0.10*e, 0.07*e);  // peeks at it
  },

  // Idle toe tapping — one foot, quick repeated taps.
  toeTap(t,d){ const e=envelope(t,d,0.2,0.25); const s=Math.max(0, Math.sin(t*9));
    pose.add('rightFoot',     -0.40*s*e, 0, 0);
    pose.add('rightLowerLeg',  0.14*s*e, 0, 0);
    pose.add('hips', 0, 0, -0.03*e);
  },

  // Rise onto the toes and settle back — uses the hips channel so the whole
  // body actually lifts rather than just the ankles rotating.
  heelRaise(t,d){ const e=envelope(t,d,0.32,0.38);
    gestureHips = Math.max(gestureHips, 0.055*rig.legLength*e);
    pose.add('leftFoot',  -0.55*e, 0, 0);
    pose.add('rightFoot', -0.55*e, 0, 0);
    pose.add('leftLowerLeg',  -0.14*e, 0, 0);
    pose.add('rightLowerLeg', -0.14*e, 0, 0);
    pose.add('spine', -0.05*e); pose.add('head', -0.07*e);
  },

  // Stretch one leg out and roll the ankle.
  legStretch(t,d){ const e=envelope(t,d,0.35,0.4); const r=Math.sin(t*3.5);
    pose.add('leftUpperLeg', -0.38*e, 0, 0);
    pose.add('leftLowerLeg',  0.12*e, 0, 0);
    pose.add('leftFoot',      0.28*e, r*0.18*e, 0);   // ankle circles
    pose.add('hips',  0, 0, 0.06*e);
    pose.add('spine', 0, 0,-0.04*e);
  },

  // Quick playful blep. The tongue leads, then the head tilts into it — doing
  // both at once reads as a glitch rather than a deliberate little moment.
  blep(t,d){
    const e  = envelope(t, d, 0.18, 0.35);
    const tn = envelope(t, d, 0.10, 0.30);          // tongue snaps out faster
    setExpr('tongue',    0.95*tn);
    setExpr('smile',     0.45*e);
    setExpr('smileEyes', 0.28*e);
    pose.add('head', 0.06*e, Math.sin(t*2.6)*0.06*e, 0.15*e);   // tilt + slow sway
    pose.add('neck', 0.03*e, 0, 0.07*e);
    earImpulse = Math.max(earImpulse, 0.45*e);
  },

  // Just the ears — small enough to fire often without being distracting.
  earFlick(t,d){ const e=envelope(t,d,0.2,0.3);
    earImpulse = Math.max(earImpulse, 1.0*e);
    pose.add('head', 0, Math.sin(t*6)*0.05*e, 0.04*e);
  },
};
const GESTURE_LIST = Object.keys(GESTURES);

const gestures = {
  cur:null, t:0, dur:0, gain:0, gainTarget:0, next:rand(8,20),
  reset(){ this.cur=null; this.t=0; this.gain=0; this.gainTarget=0; this.next=rand(4,9); },
  start(name){ this.cur=name; this.t=0;
    this.dur = ({ wave:2.6, stretch:4.0, footShuffle:3.4, lookAround:3.6, headTilt:2.6,
                  scratchHead:3.0, shake:1.5, weightShift:4.0, sniff:2.6,
                  tailSwish:3.4, earFlick:1.2, blep:1.9,
                  pawLift:2.8, toeTap:3.0, heelRaise:2.4, legStretch:3.6 })[name] || 3;
    this.gainTarget=1; },
  fadeOut(){ this.gainTarget=0; },
  update(dt){
    // fade layer gain (fast) so reactions can suppress instantly
    const r = 1-Math.pow(0.0001, dt);
    this.gain += (this.gainTarget-this.gain)*r;
    if (this.cur){
      this.t += dt;
      if (this.t>=this.dur){ this.cur=null; this.next=rand(8,20); this.gainTarget=1; }
      else if (this.gain>0.001){
        // temporarily scale accumulator writes by gain via a wrapper
        const add = pose.add.bind(pose), tw = pose.twist.bind(pose);
        pose.add   = (b,x=0,y=0,z=0,w=1)=> add(b,x,y,z,w*this.gain);
        pose.twist = (b,x=0,w=1)=> tw(b,x,w*this.gain);
        GESTURES[this.cur](this.t, this.dur);
        pose.add = add; pose.twist = tw;
      }
    } else if (!reactions.active){
      this.next -= dt;
      if (this.next<=0) this.start(GESTURE_LIST[(Math.random()*GESTURE_LIST.length)|0]);
    }
  }
};

/* ===========================================================================
   Tail pose — curl / lift / idle sway.
   VRChat's "tail curl" isn't a blendshape; it's rotation spread across the tail
   bone chain. We apply it AFTER S.vrm.update() so it wins over spring bones, and
   distribute the angle over every joint so the whole tail arcs (a husky curl)
   rather than kinking at the base.
   =========================================================================== */
const _te = new THREE.Euler(), _tq = new THREE.Quaternion();
let gestureTail = 0;       // extra tail motion requested by a gesture (0..1)
let earImpulse = 0;        // ear twitch energy, decays each frame
let gestureHips = 0;       // vertical hips offset requested by a gesture (metres)

/* Ears — one place that merges idle micro-twitches, gesture flicks and the
   happy-reaction twitch. Runs post-update like the tail. */
function applyEarPose(time){
  if(!rig.ears.length) return;
  const react = (reactions.active && (reactions.kind==='happy' || reactions.kind==='bellyRub'))
    ? Math.max(0, 1-reactions.t/0.6) : 0;
  const energy = Math.max(react, earImpulse);
  const flick  = Math.sin(time*21) * energy * 0.34;
  const drift  = Math.sin(time*0.55) * 0.022;         // always-on micro motion
  for (let i=0;i<rig.ears.length;i++){
    const dir = (i%2) ? -1 : 1;
    _te.set(flick + drift, 0, dir*(flick*0.55 + drift*0.4), 'XYZ');
    _tq.setFromEuler(_te);
    rig.ears[i].quaternion.copy(rig.earsRest[i]).multiply(_tq);
  }
}

function applyTailPose(time){
  if(!rig.tail.length) return;

  const curl = Math.max(0, settings.tailCurl||0);   // 0..1, one direction only
  const side = (settings.tailLift||0);              // -1..1  (lean left/right)
  const n = rig.tail.length;

  // Wag is ADDED on top of the curl rather than replacing it, so a happy
  // reaction swishes from wherever you've posed the tail.
  const wagging = (reactions.active && (reactions.kind==='happy' || reactions.kind==='bellyRub'))
                  || petting.energy > 0.25;

  // Distribute the curl so each joint bends MORE than the last — that's what
  // makes the tail coil rather than arc as one stiff banana.
  let wsum = 0; const ws = [];
  for (let i=0;i<n;i++){ const w = 0.35 + 1.65*(i/Math.max(1,n-1)); ws.push(w); wsum += w; }

  for (let i=0;i<n;i++){
    const tip = i/Math.max(1,n-1);
    const w = ws[i]/wsum;

    // WHIP: each joint lags slightly behind the one before it and swings a
    // little wider toward the tip. Without the lag every joint moves in
    // lockstep, which is what made it look like a rigid plank.
    const lag = i * CONFIG.TAIL_LAG;
    const sway = Math.sin(time*1.1 - lag) * 0.04 * (0.4 + tip);
    const swish = gestureTail * Math.sin(time*3.4 - lag) * 0.18 * (0.4 + tip);
    const wag  = wagging ? Math.sin(reactions.t*11 - lag) * 0.30 * (0.35 + tip*1.1) : 0;

    // Curling straight up runs the tail into the back, so splay it slightly to
    // one side as it curls — which is how a real husky tail sits anyway.
    const splay = curl * CONFIG.TAIL_CURL_SPLAY * w;

    const c = curl * CONFIG.TAIL_CURL_MAX * CONFIG.TAIL_CURL_SIGN * w;
    const s = side*1.4*w + splay;
    const x = (CONFIG.TAIL_CURL_AXIS === 'z') ? s : c;
    const z = (CONFIG.TAIL_CURL_AXIS === 'z') ? c : s;
    _te.set(x, sway + swish + wag, z, 'XYZ'); _tq.setFromEuler(_te);
    rig.tail[i].quaternion.copy(rig.tailRest[i]).multiply(_tq);
  }
}

/* ===========================================================================
   Particles — little hearts while petting, sparkles on a boop.
   A fixed pool of sprites (no allocation during play), each with its own
   material so they fade independently. Cheap enough for a phone.
   =========================================================================== */
const particles = {
  pool: [], tex: null, sparkTex: null, ready: false,
  makeTex(kind){
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    if (kind === 'heart'){
      g.beginPath();
      g.moveTo(32, 52);
      g.bezierCurveTo(2, 32, 10, 6, 32, 22);
      g.bezierCurveTo(54, 6, 62, 32, 32, 52);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(32, 2); g.quadraticCurveTo(36, 28, 62, 32);
      g.quadraticCurveTo(36, 36, 32, 62);
      g.quadraticCurveTo(28, 36, 2, 32);
      g.quadraticCurveTo(28, 28, 32, 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },
  init(){
    if (this.ready) return;
    this.tex = this.makeTex('heart');
    this.sparkTex = this.makeTex('spark');
    for (let i=0;i<28;i++){
      const m = new THREE.SpriteMaterial({ map:this.tex, transparent:true, opacity:0, depthTest:false });
      const s = new THREE.Sprite(m);
      s.visible = false; s.renderOrder = 900;
      s.userData = { vel:new THREE.Vector3(), life:0, max:1, base:0.1 };
      scene.add(s);
      this.pool.push(s);
    }
    this.ready = true;
  },
  spawn(pos, n=1, kind='heart', color=0xff6f9c){
    this.init();
    const scale = (rig.touchScale || 0.4);
    for (let k=0;k<n;k++){
      const s = this.pool.find(p=>!p.visible);
      if (!s) return;                                  // pool exhausted; skip
      s.material.map = (kind==='heart') ? this.tex : this.sparkTex;
      s.material.color.setHex(color);
      s.material.opacity = 0;
      s.position.copy(pos);
      s.position.x += (Math.random()-0.5) * scale*0.18;
      s.position.y += (Math.random()-0.5) * scale*0.10;
      s.position.z += (Math.random()-0.5) * scale*0.18;
      s.userData.vel.set((Math.random()-0.5)*scale*0.30, scale*(0.45+Math.random()*0.30), (Math.random()-0.5)*scale*0.20);
      s.userData.max = s.userData.life = 0.9 + Math.random()*0.5;
      s.userData.base = scale * (0.10 + Math.random()*0.06);
      s.visible = true;
      s.scale.setScalar(0.01);
    }
  },
  update(dt){
    if (!this.ready) return;
    for (const s of this.pool){
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      if (u.life <= 0){ s.visible = false; s.material.opacity = 0; continue; }
      const p = 1 - u.life/u.max;                       // 0→1 over lifetime
      u.vel.y += dt * (rig.touchScale||0.4) * 0.25;     // gentle float upward
      u.vel.multiplyScalar(1 - dt*0.6);                 // drag
      s.position.addScaledVector(u.vel, dt);
      s.material.opacity = p < 0.18 ? (p/0.18) : (1 - (p-0.18)/0.82);
      s.scale.setScalar(u.base * (p < 0.18 ? (0.5 + p*2.8) : 1));
    }
  }
};

/* ===========================================================================
   Petting — a sustained state rather than a one-shot reaction. Dragging across
   the avatar builds energy; it decays when you stop, so the response eases in
   and out instead of snapping on and off.
   =========================================================================== */
const petting = {
  energy: 0, active: false, heartT: 0, pos: new THREE.Vector3(), zone: null,
  feed(dist, point, zone){
    this.energy = Math.min(1, this.energy + dist * CONFIG.PET_GAIN);
    this.active = true;
    this.zone = zone;
    if (point) this.pos.copy(point);
  },
  update(dt){
    if (!this.active) this.energy = Math.max(0, this.energy - dt*CONFIG.PET_DECAY);
    this.active = false;                                // re-asserted by pointermove
    if (this.energy <= 0.02) return;

    const e = this.energy;
    setExpr('happy',     0.85*e);
    setExpr('smile',     0.80*e);
    setExpr('smileEyes', CONFIG.PET_EYES*e);
    pose.add('head',  -0.10*e, 0, 0.07*e);              // leans into the hand
    pose.add('neck',  -0.05*e, 0, 0.04*e);
    pose.add('chest', -0.03*e, 0, 0);
    earImpulse = Math.max(earImpulse, 0.25*e);

    if (settings.particles !== false){
      this.heartT -= dt;
      if (this.heartT <= 0 && e > 0.35){
        this.heartT = CONFIG.HEART_RATE;
        particles.spawn(this.pos, 1, 'heart', 0xff6f9c);
      }
    }
  }
};

/* ===========================================================================
   Touch reactions.  A reaction owns humanoid offsets (pre-update, via pose),
   expression targets, tail/ear overrides (post-update), and scale pulses.
   A new tap replaces the current reaction and fades gestures out cleanly.
   =========================================================================== */
const reactions = {
  active:null, t:0, dur:0, kind:null, side:null,
  scalePulse:0,               // giggle squash envelope 0..1
  clear(){ this.active=null; this.t=0; this.kind=null; this.side=null; this.scalePulse=0; this._sparked=false; if(S.vrm) S.vrm.scene.scale.setScalar(1); },
  fire(kind, side){
    this.kind=kind; this.side=side; this.t=0; this.active=true; this._sparked=false;
    this.dur = ({ happy:CONFIG.TAIL_WAG_SECONDS, blush:2.0, giggle:1.3, wave:2.4,
                  bellyRub:3.2, fluster:2.4, dizzy:3.8, boop:1.4 })[kind] || 2.0;
    gestures.fadeOut();       // clean interrupt: gain fades the gesture layer out
  },
  update(dt){
    if(!this.active) return;
    this.t += dt;
    const t=this.t, d=this.dur, e=envelope(t,d,0.15,0.3);

    if (this.kind==='happy'){
      // full-face smile: mouth + eyes + brows together, which reads far more
      // clearly than driving a single 'happy' morph on its own
      setExpr('happy',     1.0*e);
      setExpr('smile',     0.85*e);
      setExpr('smileEyes', 0.55*e);
      setExpr('browUp',    0.30*e);
      // a little head lift/tilt into the pat
      pose.add('head', -0.07*e, 0, 0.06*e);
      pose.add('neck', -0.04*e, 0, 0);
    }
    else if (this.kind==='blush'){
      // uses 'blush' morph if present, else falls back to 'surprised' via setExpr alias
      setExpr('blush', 0.9*e);
    }
    else if (this.kind==='bellyRub'){
      // contented: big smile, eyes softened, leans back into it, tail going
      setExpr('happy', 0.85*e);
      setExpr('smile', 0.80*e);
      setExpr('smileEyes', 0.62*e);
      const s = Math.sin(t*4.2);
      pose.add('head',  -0.11*e, s*0.10*e, 0.06*e);
      pose.add('neck',  -0.06*e, s*0.05*e, 0);
      pose.add('chest', -0.06*e, s*0.05*e, 0);
      pose.add('spine',  0,      s*0.04*e, 0);
      pose.add('hips',   0,      s*0.03*e, 0);
      earImpulse = Math.max(earImpulse, 0.30*e);
    }
    else if (this.kind==='fluster'){
      // startled and embarrassed: a sharp jolt, then pull back, ears up, blush
      const jolt = Math.max(0, 1 - t/0.30);
      setExpr('surprised', 0.90*e);
      setExpr('blush',     1.00*e);
      setExpr('browUp',    0.55*e);
      pose.add('head',  -0.16*e - jolt*0.14, 0.24*e, 0.05*e);   // recoils, looks away
      pose.add('neck',  -0.09*e, 0.13*e, 0);
      pose.add('chest',  0.11*e + jolt*0.05, 0.09*e, 0);        // curls away
      pose.add('spine',  0.08*e, 0, 0);
      pose.add('hips',   0.05*e, 0, 0);
      // Hands come FORWARD to cover, not inward — pulling them toward the
      // body just buried the arms in the thighs.
      pose.add('leftUpperArm',  0, -0.55*e, -0.14*e);
      pose.add('rightUpperArm', 0,  0.55*e,  0.14*e);
      pose.add('leftLowerArm',  0, -0.75*e, 0);
      pose.add('rightLowerArm', 0,  0.75*e, 0);
      pose.add('leftHand',      0, -0.20*e, 0);
      pose.add('rightHand',     0,  0.20*e, 0);
      // knees pinch together slightly
      pose.add('leftUpperLeg',  0, 0,  0.05*e);
      pose.add('rightUpperLeg', 0, 0, -0.05*e);
      earImpulse  = Math.max(earImpulse, 1.0*e);
      gestureTail = Math.max(gestureTail, 0.7*e);
    }
    else if (this.kind==='dizzy'){
      // wobbling loop: head rolls in a circle, body sways out of phase, arms
      // out for balance, knees unsteady — then it settles as the envelope fades
      const w = Math.sin(t*5.2), w2 = Math.cos(t*5.2), slow = Math.sin(t*1.7);
      setExpr('surprised', 0.65*e);
      setExpr('blush',     0.35*e);
      setExpr('browUp',    0.40*e);
      pose.add('head',  w2*0.18*e, w*0.34*e, w*0.30*e);
      pose.add('neck',  w2*0.09*e, w*0.17*e, w*0.15*e);
      pose.add('chest', 0, w*0.12*e, w2*0.11*e);
      pose.add('spine', 0, w*0.08*e, w2*0.09*e);
      pose.add('hips',  0, slow*0.06*e, w2*0.13*e);
      // arms out to catch balance
      pose.add('leftUpperArm',  0, 0, -(0.45 + w*0.14)*e);
      pose.add('rightUpperArm', 0, 0,  (0.45 - w*0.14)*e);
      pose.add('leftLowerArm',  0, -0.30*e, 0);
      pose.add('rightLowerArm', 0,  0.30*e, 0);
      // unsteady legs
      pose.add('leftLowerLeg',  (0.16 + w*0.09)*e, 0, 0);
      pose.add('rightLowerLeg', (0.16 - w*0.09)*e, 0, 0);
      gestureHips = Math.min(gestureHips, -0.02*rig.legLength*e);
      gestureTail = Math.max(gestureTail, 0.9*e);
      earImpulse  = Math.max(earImpulse, 0.45*e);
    }
    else if (this.kind==='boop'){
      // Recoil eases IN over ~0.18s rather than starting at full amplitude —
      // an instant peak reads as a violent snap. Gentle pull-back, then a
      // pleased little wiggle and a blep.
      const jolt = envelope(t, 0.55, 0.34, 0.55);
      const s2 = Math.sin(t*13);
      setExpr('surprised', 0.70*jolt + 0.20*e);
      setExpr('blink',     0.85*envelope(t, 0.26, 0.35, 0.45));
      setExpr('smile',     0.55*e);
      setExpr('browUp',    0.55*e);
      setExpr('tongue',    0.9*envelope(Math.max(0,t-0.18), 1.0, 0.25, 0.4));  // blep
      pose.add('head', (0.085*jolt - 0.04*e), s2*0.05*e, s2*0.03*e);
      pose.add('neck', 0.05*jolt, 0, 0);
      pose.add('chest', 0.03*jolt, 0, 0);
      earImpulse  = Math.max(earImpulse, 1.0*e);
      gestureTail = Math.max(gestureTail, 0.6*e);
      if (!this._sparked){
        this._sparked = true;
        const p = anchorWorld({ bone:'head', off:[0,-0.06,0.24] });
        if (p && settings.particles !== false) particles.spawn(p, 6, 'spark', 0xfff0a0);
      }
    }
    else if (this.kind==='giggle'){
      setExpr('happy', 0.9*e);
      setExpr('smile', 0.75*e);
      setExpr('smileEyes', 0.6*e);
      // squash-and-stretch pulse (2 bounces), compress Y / expand XZ
      const p = Math.sin(t*14)*Math.pow(1-t/d,2);
      if (S.vrm){ const sx=1+0.05*p, sy=1-0.07*p; S.vrm.scene.scale.set(sx, sy, sx); }
    }
    else if (this.kind==='wave'){
      const W=CONFIG.WAVE_WAGGLE, P=CONFIG.WAVE_PALM;
      const L = this.side==='left';
      const side = L ? 'left' : 'right';
      const arm  = L ? 'leftUpperArm' : 'rightUpperArm';
      const fore = L ? 'leftLowerArm' : 'rightLowerArm';
      const hand = L ? 'leftHand'     : 'rightHand';
      const m  = L ? -1 : 1;
      const s = Math.sin(t*8);
      armBase(side, e);                                    // clean slate
      pose.add(arm,  0, m*CONFIG.WAVE_FORWARD*e, m*CONFIG.WAVE_RAISE*e);
      pose.add(fore, 0, 0, m*(CONFIG.WAVE_ELBOW + s*W*0.35)*e);
      pose.add(hand, 0, 0, m*(s*W)*e);
      pose.twist(fore, P*0.3*e);
      pose.twist(hand, P*0.7*e);
      setExpr('happy', 0.5*e);
    }

    if (t>=d){ this.clear(); }
  }
  // NOTE: tail and ear motion during reactions is handled by applyTailPose()
  // and applyEarPose(), so they layer with the curl setting and idle twitches
  // instead of overwriting them.
};

/* ===========================================================================
   Pick him up.  A long press ON the avatar grabs him; dragging swings him
   around under your finger; letting go drops him.

   The grip is PINNED, not parented. Each frame we work out where the grabbed
   point currently sits in root space, then place the root so that point lands
   under your finger. The pivot is therefore wherever you actually grabbed —
   scruff, paw, tail — with no reparenting and nothing for the VRM hierarchy to
   fight over, and the pin holds even while the limb it's attached to flails.

   Where you grab decides the mood. By the scruff he goes limp and content the
   way a kitten does; by a foot he ends up upside down and deeply unimpressed.
   =========================================================================== */
const GRIP_KIND = {
  ears:'scruff', head:'scruff', nose:'scruff', cheekL:'scruff', cheekR:'scruff', chest:'scruff',
  belly:'body',  groin:'body',  handL:'body',  handR:'body',    armL:'body',    armR:'body',
  thighL:'foot', thighR:'foot', footL:'foot',  footR:'foot',    tail:'foot',
};

// Touch zones name a humanoid bone (or the discovered tail/ear chains); the pin
// needs the actual RAW node, since that's what carries a usable world matrix.
function gripNode(zone){
  if (zone.bone === 'tail')     return rig.tail[0] || rig.raw.hips || null;
  if (zone.bone === 'ears')     return rig.ears[0] || rig.raw.head || null;
  if (zone.bone === 'midTorso') return rig.raw.spine || rig.raw.chest || rig.raw.hips || null;
  return rig.raw[zone.bone] || null;
}

const _hV = new THREE.Vector3(), _hP = new THREE.Vector3();
const _hRight = new THREE.Vector3(), _hFwd = new THREE.Vector3();
const _hQa = new THREE.Quaternion(), _hQb = new THREE.Quaternion(), _hQc = new THREE.Quaternion();
const _hZero = new THREE.Vector3();
const LAND_TIME = 0.45;            // seconds of landing squash

const hold = {
  state:null,                      // null | 'held' | 'falling' | 'landed'
  kind:'body',
  node:null,                       // raw bone the finger is pinched onto
  grip:new THREE.Vector3(),        // grip point, in THAT BONE's local space
  target:new THREE.Vector3(),      // finger position, world space
  vel:new THREE.Vector3(),         // finger velocity held / body velocity falling
  pos:new THREE.Vector3(),         // root world position — we own it while active
  home:new THREE.Quaternion(),     // root rotation to return to (FACE_FLIP lives here)
  swing:{ x:0, z:0, vx:0, vz:0 },  // pendulum: angle + angular velocity
  flip:0,                          // 0..1 blend into upside-down
  gain:0,                          // 0..1 weight of the whole hold layer
  t:0,                             // seconds in the current state
  land:0,                          // landing squash timer, counts down
  impact:0,                        // touchdown speed 0..1, drives the squash depth
  dirty:false,                     // root transform is ours; needs clearing when we finish

  grab(zone, point){
    if (!S.vrm || settings.pickup === false || this.state) return false;
    const n = gripNode(zone);
    if (!n) return false;
    this.node = n;
    this.grip.copy(point); n.worldToLocal(this.grip);
    this.kind = GRIP_KIND[zone.name] || 'body';
    this.state = 'held'; this.t = 0; this.land = 0; this.impact = 0;
    this.target.copy(point);
    this.vel.set(0,0,0);
    this.swing.x = this.swing.z = this.swing.vx = this.swing.vz = 0;
    this.home.copy(S.vrm.scene.quaternion);
    this.pos.copy(S.vrm.scene.position);
    reactions.clear();          // whatever he was mid-way through, he's airborne now
    gestures.fadeOut();
    return true;
  },

  // Called from input.js on every pointermove, with the finger projected onto
  // the plane he was grabbed on. Velocity is measured HERE rather than in
  // update() because pointer events arrive faster than frames on most phones —
  // sampling per frame throws away most of the flick you're trying to capture.
  moveTo(point, dt){
    if (this.state !== 'held') return;
    if (dt > 0.0005){
      _hV.copy(point).sub(this.target).divideScalar(dt);
      this.vel.lerp(_hV, 1 - Math.pow(0.02, Math.min(dt, 0.05)));
    }
    this.target.copy(point);
  },

  release(){
    if (this.state !== 'held') return;
    this.state = 'falling'; this.t = 0;
    if (this.vel.length() > CONFIG.HOLD_FLING_MAX) this.vel.setLength(CONFIG.HOLD_FLING_MAX);
  },

  // Pendulum step. Driven by the finger's velocity resolved onto SCREEN axes:
  // the swing has to match the direction you see yourself dragging, not the
  // avatar's own facing. Semi-implicit Euler, dt clamped so a dropped frame
  // can't blow the spring up.
  stepSwing(dt, driven){
    const h = Math.min(dt, 0.033);
    const K = CONFIG.HOLD_SWING_SPRING, C = CONFIG.HOLD_SWING_DAMP, M = CONFIG.HOLD_SWING_MAX;
    let tz = 0, tx = 0;
    if (driven){
      _hRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      // NEGATED: drag right and his top should trail LEFT. Flip this one sign if
      // he ever leans into the drag instead of away from it.
      tz = THREE.MathUtils.clamp(-this.vel.dot(_hRight) * CONFIG.HOLD_SWING, -M, M);
      tx = THREE.MathUtils.clamp(this.vel.y * CONFIG.HOLD_SWING * 0.5, -M*0.5, M*0.5);
    }
    this.swing.vz += (K*(tz - this.swing.z) - C*this.swing.vz) * h;
    this.swing.vx += (K*(tx - this.swing.x) - C*this.swing.vx) * h;
    this.swing.z  += this.swing.vz * h;
    this.swing.x  += this.swing.vx * h;
  },

  update(dt){
    const airborne = (this.state === 'held' || this.state === 'falling');
    const fade = 1 - Math.pow(0.001, dt / Math.max(0.02, CONFIG.HOLD_FADE));
    this.gain += ((airborne ? 1 : 0) - this.gain) * fade;
    idle.body = 1 - this.gain;        // hand the limbs over / take them back
    if (this.land > 0) this.land -= dt;

    if (this.state === 'held'){
      this.t += dt;
      const wantFlip = (this.kind === 'foot') ? 1 : 0;
      this.flip += (wantFlip - this.flip) * (1 - Math.pow(0.02, dt));
      this.stepSwing(dt, true);
    }
    else if (this.state === 'falling'){
      this.t += dt;
      this.vel.y -= CONFIG.HOLD_GRAVITY * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.flip *= Math.pow(0.004, dt);     // rights himself mid-air: always lands on his feet
      this.stepSwing(dt, false);
      if (this.pos.y <= 0){
        this.pos.y = 0;
        // Divisor set from the visible world height (~0.45m): a gentle set-down
        // lands well under 0.6, while a drop from the top of the screen or a
        // downward fling clears it. Lower it and he's dizzy every single time.
        this.impact = Math.min(1, Math.abs(this.vel.y) / 4.0);
        this.vel.set(0,0,0);
        this.state = 'landed'; this.t = 0; this.land = LAND_TIME;
        // The landing sells itself better through an existing reaction than a
        // bespoke one: hard drop = dizzy, dropped on his head = indignant.
        reactions.fire(this.impact > 0.60 ? 'dizzy' : (this.kind === 'foot' ? 'fluster' : 'happy'));
      }
    }
    else if (this.state === 'landed'){
      this.t += dt;
      this.pos.lerp(_hZero, 1 - Math.pow(0.02, dt));   // scampers back to his spot
      this.flip *= Math.pow(0.001, dt);
      this.stepSwing(dt, false);
      if (this.t > CONFIG.HOLD_RECOVER){ this.state = null; this.node = null; }
    }

    /* ---- pose layer -------------------------------------------------------
       Everything here is ABSOLUTE, because idle.body has faded the resting
       stance out from under it. Left arm takes +Z to hang, right arm -Z. */
    const g = this.gain;
    if (g <= 0.002) return;
    const t = this.t, F = CONFIG.HOLD_FLAIL;
    const calm = this.kind === 'scruff', rage = this.kind === 'foot';
    const A = CONFIG.ARM_DOWN, O = CONFIG.ARM_OUT, E = CONFIG.ELBOW_BEND;
    const settle = Math.max(0, 1 - t/2.2);            // the startle wears off
    const energy = rage ? (0.55 + 0.45*settle) : calm ? 0.10 : (0.25 + 0.5*settle);

    // Four different frequencies so no two limbs ever pump in unison.
    const f1 = Math.sin(t*14.0), f2 = Math.sin(t*15.7 + 2.1);
    const f3 = Math.sin(t*12.5 + 1.1), f4 = Math.sin(t*13.9 + 3.4);

    // arms hang from the shoulder, then flail about that
    pose.add('leftUpperArm',  f3*F*energy*0.35, -0.05, A - O*0.35 + f1*F*energy*0.55, g);
    pose.add('rightUpperArm', f4*F*energy*0.35,  0.05, -(A - O*0.35 + f2*F*energy*0.55), g);
    pose.add('leftLowerArm',  0, -(E*0.5 + Math.max(0,f2)*F*energy*0.8), 0, g);
    pose.add('rightLowerArm', 0,  (E*0.5 + Math.max(0,f1)*F*energy*0.8), 0, g);
    pose.add('leftHand',  f2*0.25*energy, 0, 0, g);
    pose.add('rightHand', f1*0.25*energy, 0, 0, g);

    // legs dangle straight, and kick when he objects
    const kick = F*energy*0.75;
    pose.add('leftUpperLeg',  -0.06 + f3*kick*0.6, 0,  0.04, g);
    pose.add('rightUpperLeg', -0.06 + f4*kick*0.6, 0, -0.04, g);
    pose.add('leftLowerLeg',   0.10 + Math.max(0,-f3)*kick, 0, 0, g);
    pose.add('rightLowerLeg',  0.10 + Math.max(0,-f4)*kick, 0, 0, g);

    // spine curls up when he's cross, hangs slack when he's happy about it
    const curl = rage ? (0.16 + 0.12*settle) : calm ? -0.05 : 0.06;
    pose.add('spine', curl,      f1*0.05*energy, 0, g);
    pose.add('chest', curl*0.7,  f2*0.04*energy, 0, g);
    pose.add('neck', -curl*0.5,  0, 0, g);
    // +X on the head is chin-DOWN. Calm droops; cross cranes back to glare at you.
    pose.add('head', calm ? 0.10 : (-0.14 - 0.08*settle), f2*0.10*energy, f1*0.08*energy, g);

    if (rage){
      setExpr('surprised', (0.45 + 0.35*settle)*g);
      setExpr('browDown',  0.85*g);
      setExpr('blush',     0.35*g);
    } else if (calm){
      setExpr('smile',     0.55*g);
      setExpr('smileEyes', 0.45*g);
      setExpr('happy',     0.25*g);
    } else {
      setExpr('surprised', (0.15 + 0.60*settle)*g);
      setExpr('browUp',    0.50*g);
      setExpr('smile',     0.30*(1-settle)*g);
    }
    earImpulse  = Math.max(earImpulse, (rage ? 0.9 : calm ? 0.15 : 0.5) * energy * g);
    gestureTail = Math.max(gestureTail, (rage ? 1.0 : calm ? 0.25 : 0.6) * g);
  },
};

/* Root transform for the hold. Runs AFTER S.vrm.update() so the bone world
   matrices it reads are the posed ones. Both reads use last frame's matrices
   consistently, so the old root transform cancels exactly — the one frame of
   lag is invisible at any sane framerate. */
function applyHoldRoot(){
  if (!S.vrm) return;
  const root = S.vrm.scene;

  if (!hold.state && hold.gain < 0.002){
    if (hold.dirty){                       // hand the root back exactly as we found it
      root.position.set(0,0,0);
      root.quaternion.copy(hold.home);
      root.scale.setScalar(1);
      hold.dirty = false;
    }
    return;
  }
  hold.dirty = true;

  // rotation: pendulum swing (screen axes) × upside-down flip (his own facing)
  _hFwd.setFromMatrixColumn(camera.matrixWorld, 2).normalize();   // toward the viewer
  _hRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  _hQa.setFromAxisAngle(_hFwd,   hold.swing.z);
  _hQb.setFromAxisAngle(_hRight, hold.swing.x);
  if (hold.flip > 0.0005){
    _hV.copy(rig.forward || _hFwd);
    _hQc.setFromAxisAngle(_hV, Math.PI * hold.flip);
  } else _hQc.identity();
  root.quaternion.copy(_hQb).multiply(_hQa).multiply(_hQc).multiply(hold.home);

  // landing squash — compress on Y, spread on XZ, settling as it decays
  if (hold.land > 0){
    const p = 1 - hold.land/LAND_TIME;                       // 0 → 1
    const s = Math.sin(Math.PI*p) * hold.impact * 0.35 * (1-p);
    root.scale.set(1 + s*0.6, 1 - s, 1 + s*0.6);
  } else root.scale.setScalar(1);

  if (hold.state === 'held' && hold.node){
    // where the grip sits right now, expressed in root-local space
    _hP.copy(hold.grip);
    hold.node.localToWorld(_hP);
    root.worldToLocal(_hP);
    // ...then put the root wherever it needs to be for that point to meet the finger
    _hP.multiply(root.scale).applyQuaternion(root.quaternion);
    hold.pos.copy(hold.target).sub(_hP);
  }
  root.position.copy(hold.pos);
}

/* ===========================================================================
   Raycast a tap → nearest touch-zone anchor → reaction
   =========================================================================== */
/* ===========================================================================
   Device motion — shake to make him dizzy, tilt to make him lean.
   Both need a secure context (https / installed app); a plain file:// or
   content:// page gets no sensor events at all. iOS additionally requires an
   explicit permission prompt triggered by a user tap.
   =========================================================================== */

// Applies the idle bounce's hip sink plus any gesture-requested lift. Rotations
// come from the pose accumulator; this is the one place we touch a bone's
// POSITION. Lives here rather than in pose.js because it reads gestureHips.
function applyHipsDrop(){
  if (rig.bones.hips && rig.hipsRest){
    rig.bones.hips.position.copy(rig.hipsRest);
    rig.bones.hips.position.y += S.hipsDrop + gestureHips;
  }
}

// Gesture-driven impulses decay each frame; gestures re-assert them while active.
export function decayImpulses(dt){
  const decay = Math.exp(-dt*5);
  gestureTail *= decay; earImpulse *= decay; gestureHips *= decay;
  if (gestureTail < 0.001) gestureTail = 0;
  if (earImpulse  < 0.001) earImpulse  = 0;
  if (Math.abs(gestureHips) < 0.0001) gestureHips = 0;
}

// shake -> dizzy, wired here so core.js never has to import anim.js
hooks.onShake = ()=> reactions.fire('dizzy');

export { applyHipsDrop, idle, GESTURES, GESTURE_LIST, gestures, reactions, petting, particles,
         applyTailPose, applyEarPose, hold, applyHoldRoot };

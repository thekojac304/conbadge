# Shelved: "Pick him up" (was b35–b37)

Long-press ON the avatar to grab him, drag to carry him, release to drop him.
Removed in b38 to keep the live badge simple. Everything needed to put it back
is in this file — the code blocks below are the exact text that was removed, not
a retyping of it.

It was working and verified when it was shelved: module parse, cross-module leak
check, a runtime harness covering all seven grip points through the full
grab -> carry -> fling -> land -> recover cycle, and a physics sim confirming the
pendulum is stable at 60/30/15 fps.

## What it did

Hold still on him for 500 ms and he's grabbed (a haptic thump confirms it).
Drag and he swings under your finger like a pendulum, trailing behind and
overshooting when you stop. Let go and he falls, rights himself mid-air, lands
with a squash, and scampers home.

Where you grab sets the mood:

| Grip | Zones | Behaviour |
|---|---|---|
| `scruff` | head, ears, nose, cheeks, chest | limp and content, kitten-by-the-scruff |
| `body` | belly, groin, hands, arms | startled, mild wriggle, settles into a smile |
| `foot` | feet, thighs, tail | upside down, kicking, thoroughly unimpressed |

Landing reuses an existing reaction rather than adding one: hard drop -> `dizzy`,
foot-grip -> `fluster`, otherwise -> `happy`.

## Two ideas worth keeping if you rebuild it differently

**The grip is pinned, not reparented.** Each frame it computes where the grabbed
point currently sits in root space, then places the root so that point lands
under your finger. That is why the pivot ends up wherever you actually grabbed,
with no reparenting and nothing for the VRM hierarchy to fight over, and why the
pin holds even while the limb it is attached to is flailing.

**The long-press had to split by target.** On the avatar it grabbed; on the
background it opened settings. Both gestures are "hold still", so they collide
unless they own different targets. Moving the finger first still cancelled into
petting, leaving that gesture untouched.

## Re-adding it

Six files. Steps 1-2 are the feature; 3-6 are the wiring.

### 1. config.js — constants

Paste back above `KEEP_EXPRESSIONS`:

```js
  /* --- Pick him up: long-press ON the avatar grabs, drag swings him around ---
     Swing is a damped spring driven by how fast your finger moves, so he trails
     behind the drag and overshoots when you stop. Spring/damp are in the usual
     units: omega = sqrt(SPRING), zeta = DAMP / (2*sqrt(SPRING)). Keep zeta near
     0.5 — critically damped (zeta 1) reads as stiff and lifeless. */
  HOLD_GRAB_MS: 500,       // hold still this long ON him to grab (moving first = petting)
  HOLD_SWING: 0.55,        // radians of lean per m/s of drag (how hard he trails behind)
  HOLD_SWING_MAX: 1.15,    // cap on that lean (~66°) so he can't wrap right over
  HOLD_SWING_SPRING: 46,   // pendulum stiffness — higher = snappier, less lazy
  HOLD_SWING_DAMP: 6.4,    // pendulum damping — lower = swings longer after you stop
  HOLD_FLAIL: 1.0,         // limb flail amplitude when he's held somewhere undignified
  HOLD_GRAVITY: 7.0,       // m/s² once released (below real 9.8: he's small, reads better)
  HOLD_FLING_MAX: 2.4,     // m/s cap on throw speed, so a fast flick can't launch him off-screen
  HOLD_RECOVER: 0.85,      // seconds to settle back to home position after landing
  HOLD_FADE: 0.18,         // seconds to blend the idle stance out on grab / in on landing
```

Touch zones `footL`/`footR` are still in config (kept in b38 as ticklish tap
targets) — the `foot` grip needs them, so nothing to do there.

### 2. anim.js — the feature itself

Add `camera` to the core import; it is only needed for the screen-axis pendulum:

```js
import { THREE, S, rig, settings, scene, camera, rand, motion, hooks } from './core.js';
```

Paste this block back in just above the `Raycast a tap` section:

```js
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
```

Extend the export list at the bottom of the file:

```js
export { applyHipsDrop, idle, GESTURES, GESTURE_LIST, gestures, reactions, petting, particles,
         applyTailPose, applyEarPose, hold, applyHoldRoot };
```

### 3. anim.js — hand the limbs over while he is airborne

`hold` fades the standing stance out via `idle.body`; without this he dangles
with his feet planted on nothing. Add the field to `idle`:

```js
  body:1,     // weight of the STANDING idle — arms, legs, bounce. `hold` drives
              // this to 0 while airborne. Breathing, blink, gaze, face are NOT
              // gated, so they keep running while he is held.
```

Reset it in `idle.reset()` (append `this.body=1;`), then take `const bd = this.body;`
at the top of `idle.update()` and pass `bd` as the 5th argument (the pose weight)
to every resting **arm** and **leg** `pose.add` call — shoulders, upper arms,
lower arms, hands, and the three calls inside the `legs.forEach`. Also scale the
hip sink:

```js
    S.hipsDrop = -knee * rig.legLength * CONFIG.HIP_DROP * 0.5 * bd;
```

Leave breathing, gaze, blink and the facial idle ungated.

### 4. input.js — the gesture

Import it: `import { reactions, petting, hold } from './anim.js';`

Add alongside the other pointer state:

```js
let grabTimer=null, grabMoveT=0;

const grabPlane = new THREE.Plane();
const _gN = new THREE.Vector3(), _gP = new THREE.Vector3();

// Project the pointer ray onto the plane he was grabbed on (camera-facing,
// through the grab point) so depth never changes while you drag.
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
  try{ navigator.vibrate?.(12); }catch{}
  return true;
}
```

In `pointerdown`, cache the pick so it can be reused when the timer fires:

```js
  const pick = pickZone(ev.clientX, ev.clientY);
  pDown={ x:ev.clientX, y:ev.clientY, t:performance.now(),
          corner: ev.clientX < CORNER_PX && ev.clientY < CORNER_PX + 40,
          onAvatar: !!pick, pick, petted:false };
```

then start the grab timer, and — this is the important half — restrict the
settings long-press to the background only by changing its `} else {` to
`} else if (!pDown.onAvatar){`:

```js
  if (pDown.onAvatar){
    grabTimer = setTimeout(()=>{
      grabTimer = null;
      if (startGrab(pDown && pDown.pick)) longFired = true;
    }, CONFIG.HOLD_GRAB_MS);
  }
```

At the very top of `pointermove`, before the `if(!pDown) return;`:

```js
  if (hold.state === 'held'){
    const now = performance.now();
    const dt  = Math.min(0.1, (now - grabMoveT)/1000);
    grabMoveT = now;
    const p = pointerWorld(ev.clientX, ev.clientY);
    if (p) hold.moveTo(p, dt);
    S.lastInteract = now;
    return;                      // no petting, no trail, no orbit while carrying
  }
```

Cancel a pending grab once the finger travels far enough to be a pet — add to
the `moved > MOVE_TOL` branch and to `cancelLong()`:

```js
    if(grabTimer){ clearTimeout(grabTimer); grabTimer=null; }
```

Release in `endPointer`, straight after the `controls.enabled` line:

```js
  if (hold.state === 'held'){ hold.release(); pDown=null; return; }
```

and add `hold.release();` to the `pointercancel` handler.

### 5. main.js — the frame loop

```js
import { idle, gestures, reactions, petting, particles, applyTailPose, applyEarPose,
         decayImpulses, applyHipsDrop, hold, applyHoldRoot } from './anim.js';
```

Order matters in both places. `hold.update` sets `idle.body`, so it runs first;
`applyHoldRoot` reads final bone world matrices, so it runs after the VRM update
and the tail/ear passes:

```js
    pose.clear();
    hold.update(dt);              // first: it sets idle.body, which idle reads below
    idle.update(dt);
    ...
    applyEarPose(idle.t);
    applyHoldRoot();              // pin grip to finger / fall / land (root transform)
    decayImpulses(dt);
```

### 6. Settings toggle

index.html, after the keep-awake row:

```html
          <div class="inline">
            <span>Pick him up<small>Press and hold on him, then drag him around</small></span>
            <label class="switch"><input type="checkbox" id="tg-pickup" checked /><span class="track"></span><span class="knob"></span></label>
          </div>
```

ui.js, near the other toggles (`!== false` so it defaults on for upgraders):

```js
const tgPickup = document.getElementById('tg-pickup');
tgPickup.checked = settings.pickup !== false;
tgPickup.addEventListener('change', e=>{
  settings.pickup = e.target.checked; saveSettings();
});
```

`hold.grab()` already returns false when `settings.pickup === false`, so no
other guard is needed.

## Known tuning notes from when it was live

- **Swing direction** is one clearly-commented negation in `stepSwing`. If he
  leans *into* your drag instead of away from it, flip that single sign.
- `HOLD_SWING` (0.55) is the swing amount. A fast flick peaks near 74 degrees,
  which is dramatic but was intentional. Lower it for something more restrained.
- The dizzy-on-landing threshold divides impact speed by 4.0 and fires above
  0.6. That was tuned so a gentle set-down stays calm and only a drop from the
  top of the screen goes dizzy — an earlier divisor of 3.0 made him dizzy on
  essentially every drop.
- Gravity is 7.0 m/s rather than 9.8. He is small, and real gravity read as
  frantic at his scale.

// Con Badge — tuning constants and the touch-zone map.
export const CONFIG = {
  BUILD: 'b37',            // bump on each new version — shown in the load readout
  FACE_FLIP: false,        // set true if your avatar loads facing away from you
  ORBIT_AZIMUTH: 0.62,     // rad: how far left/right you can orbit (clamped both ways)
  ORBIT_POLAR_LO: 1.12,    // rad from +Y: how far you can look down over the top
  ORBIT_POLAR_HI: 1.86,    // rad: how far you can look up from below
  FRAME_DIST: 0.95,        // camera distance as a fraction of head-to-mid-torso span
  PAN_RANGE: 0.9,          // how far you can slide the framing vertically (× body height)
  ARM_DOWN: 1.25,          // radians to lower arms out of the VRM T-pose (negate if they raise)
  ARM_FORWARD: 0.30,       // swing arms forward so the hands clear the thighs
  ARM_OUT: 0.22,           // outward splay from the body (raise if hands clip the hips)
  ELBOW_BEND: 0.40,        // resting elbow bend (flip sign if elbows bend backwards)
  KNEE_BEND: 0.30,         // resting knee flex (radians) — 0 is locked/stiff
  BOUNCE_RATE: 1.05,       // bounce speed; kept near the breathing rate so they harmonise
  BOUNCE_AMOUNT: 0.17,     // extra knee flex at the bottom of each bounce
  HIP_DROP: 0.55,          // how much the hips sink with the knees (0 = no sink)
  EYE_GAIN: 0.45,          // how far the eye bones rotate when looking around (0 = off)
  WAVE_RAISE: 0.32,        // upper-arm angle ABOVE HORIZONTAL during a wave (absolute now)
  WAVE_FORWARD: 0.28,      // slight forward angle so the wave isn't dead flat to the side
  WAVE_ELBOW: 1.45,        // elbow fold (Z) — holds the forearm ~upright
  WAVE_WAGGLE: 0.55,       // wrist sweep amplitude (the actual waving motion)
  WAVE_PALM: 1.25,         // forearm twist so the palm faces FORWARD (matched to SCRATCH_PALM)
  STRETCH_RAISE: 1.85,     // arms-overhead angle above horizontal (~106°)
  SCRATCH_SIDE: 0.12,      // fallback clearance if no ear bones (× hips→head span)
  SCRATCH_PAW: 0.04,       // hold-off as a fraction of forearm (raise if fingers clip the ear)
  SCRATCH_PALM: 1.25,      // forearm twist so the palm faces the head (negate to flip)
  SCRATCH_UP: 0.00,        // vertical nudge of the scratch point (× hips→head span)
  SCRATCH_DEPTH: 0.02,     // forward/back nudge of the scratch point
  BLINK_TIME: 0.10,        // seconds for a full blink (down+up)
  BLINK_MAX: 0.9,          // max eyelid weight; lower if the lids clip through the face
  IDLE_SMILE: 0.16,        // baseline resting smile (0 = fully neutral face)
  TAIL_CURL_AXIS: 'x',     // axis the tail curls on ('x' pitch up/down, 'z' side) — flip if wrong
  TAIL_WAG_AXIS: 'auto',   // axis the wag/sway SWINGS on. 'auto' = the bending axis the
                           // curl isn't using. Y is deliberately never the default: on this
                           // rig (and most VRM tails) Y runs ALONG the bone, so rotating
                           // there twists the tail on its own axis and looks like nothing
                           // is happening. Force 'x'/'y'/'z' only if 'auto' picks wrong.
  TAIL_CURL_SIGN: -1,      // which way is "up over the back" (negative was correct on this rig)
  TAIL_CURL_MAX: 2.9,      // total radians of curl at slider 100
  TAIL_CURL_SPLAY: 0.32,   // sideways lean added as it curls, so it clears the back
  TAIL_LAG: 0.55,          // phase lag per joint — this is what makes the wag whip
  DEBUG: false,            // draw skeleton/geometry bounds + axes to diagnose framing
  SOLID_DEBUG: false,      // paint every mesh a flat bright color (isolates geometry vs material)
  ZONE_DEBUG: false,       // draw a dot at every touch-zone anchor (set true to tune zones)
  ATTACH_LOOSE: true,      // re-parent unskinned meshes (rigid accessories) to the nearest bone
  PET_GAIN: 4.5,           // how fast petting builds up (higher = more sensitive)
  PET_DECAY: 1.6,          // how fast it fades once you stop
  HEART_RATE: 0.16,       // seconds between hearts while petting
  TRAIL_LIFE: 0.45,        // seconds a swipe-trail point stays visible
  TRAIL_WIDTH: 14,         // widest point of the trail, in CSS pixels
  TRAIL_COLOR: '255,150,190',   // rgb triple for the trail stroke
  PET_EYES: 0.42,          // how far the eyes soften when petted (lower if lids clip)        // seconds between hearts while petting
  SHAKE_THRESHOLD: 14,     // m/s² of jolt needed to trigger dizzy (lower = more sensitive)
  SHAKE_COOLDOWN: 3000,    // ms before another shake can register
  TILT_LEAN: 0.55,         // how much he counter-leans when the phone tilts (0 = off)
  PARALLAX_MAX: 0.20,      // radians of camera swing at full tilt (~11°); negate to invert
  PARALLAX_PITCH: 0.55,    // vertical parallax as a fraction of horizontal
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
  KEEP_EXPRESSIONS: true,  // keep morphs used by badge expressions, prune the rest (mobile-safe)
  MORPH_CAP: 48,           // hard cap on kept morphs per mesh (safety for mobile GPUs)
  DPR_MAX: 2,              // pixel-ratio cap (perf); saver mode drops this
  TAIL_WAG_SECONDS: 3.0,
};

/* ---------------------------------------------------------------------------
   TOUCH-ZONE → BONE MAP.  This is the thing to tune per avatar.
   Each tap raycasts the mesh, then snaps to the NEAREST anchor below. Anchors
   are derived from humanoid bones (+ optional offsets) or from discovered
   tail/ear nodes. Reorder / re-weight / add offsets to taste.
     bone:    normalized humanoid bone name, or 'tail'/'ears' (discovered nodes)
     offset:  metres added to that bone's world position to place the anchor
     react:   which reaction fires (see REACTIONS below)
   Anchors are matched by nearest 3D distance to the hit point, so overlapping
   zones resolve to whichever anchor point is closest to where you touched.
--------------------------------------------------------------------------- */
export const TOUCH_ZONES = [
  // OFFSETS ARE PROPORTIONAL, not metres: [right, up, forward] in units of the
  // avatar's hips-to-head span. Avatars vary hugely in scale (this one is ~0.6x
  // human size), so fixed metre offsets land in the wrong place. Forward/right
  // come from the avatar's detected facing, so a rotated rig still maps right.
  //
  // A tap snaps to the NEAREST anchor, so anchors also act as "catchers" —
  // adding thigh/forearm anchors stops those taps being stolen by groin/chest.
  { name:'ears',   bone:'ears',       off:[0, 0, 0],          react:'happy'     },
  { name:'head',   bone:'head',       off:[0, 0.11, 0.02],    react:'happy'     }, // top of skull
  { name:'nose',   bone:'head',       off:[0,-0.06, 0.22],    react:'boop'      }, // snout tip — boop!
  { name:'cheekL', bone:'head',       off:[ 0.13,-0.03, 0.12], react:'blush'    },
  { name:'cheekR', bone:'head',       off:[-0.13,-0.03, 0.12], react:'blush'    },
  { name:'chest',  bone:'upperChest', off:[0, 0.02, 0.13],    react:'giggle'    }, // pecs / upper torso
  { name:'belly',  bone:'midTorso',   off:[0,-0.02, 0.15],    react:'bellyRub'  }, // mid-torso, hips↔chest
  { name:'groin',  bone:'hips',       off:[0,-0.05, 0.16],    react:'fluster'   }, // pelvis front
  { name:'thighL', bone:'leftUpperLeg',  off:[0,-0.16, 0.08], react:'giggle'    }, // catcher: ticklish legs
  { name:'thighR', bone:'rightUpperLeg', off:[0,-0.16, 0.08], react:'giggle'    },
  { name:'footL',  bone:'leftFoot',   off:[0, 0, 0],          react:'giggle'    }, // ticklish — and the undignified grab point
  { name:'footR',  bone:'rightFoot',  off:[0, 0, 0],          react:'giggle'    },
  { name:'handL',  bone:'leftHand',   off:[0, 0, 0],          react:'waveLeft'  },
  { name:'handR',  bone:'rightHand',  off:[0, 0, 0],          react:'waveRight' },
  { name:'armL',   bone:'leftLowerArm',  off:[0, 0, 0],       react:'waveLeft'  }, // catcher: forearm
  { name:'armR',   bone:'rightLowerArm', off:[0, 0, 0],       react:'waveRight' },
  { name:'tail',   bone:'tail',       off:[0, 0, 0],          react:'happy'     },
];

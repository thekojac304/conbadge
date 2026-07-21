# Current Focus

_Keep this short. Update it whenever the active thread of work changes —
this is the first thing to read at the start of a new session._

Active area:
- Lighting / shading "Look" system (`light.js`) — implemented and wired into
  `main.js`, `avatar.js`, `ui.js`, `index.html`, `core.js`. Working tree has
  this as uncommitted/not-yet-confirmed-live changes as of build `b74`.
  Awaiting the user to upload the changed files and confirm the build stamp
  + visual result on-device.

Recently completed (per commit history):
- Animation debug system
- Knee articulation
- Leg animation smoothness

Next priorities:
1. Confirm the lighting system renders correctly on-device (all four Looks,
   brightness/rim sliders, on/off toggle) and commit once confirmed.
2. Resume normal animation-tuning cadence via the Animation Tuner as new
   gesture/reaction requests come in.
3. (Placeholder — replace with the next real priority once the lighting
   work is confirmed and closed out.)

---

_This file only tracks the **active** thread. For durable subsystem
knowledge, see the other files in `docs/`._

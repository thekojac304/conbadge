# Documentation Index

This is the entry point into `/docs`. Read this file, then read only what
your task actually touches — see "Starting a new session" below.

Documentation here records **design intent and decisions**, not a mirror of
the source. If something is fully answered by reading the code, it doesn't
belong here. What belongs here: *why* the code is the way it is, invariants
that aren't obvious from a diff, standing decisions, and workflow
conventions that would otherwise have to be rediscovered the hard way.

## Files

| File | Purpose | Read it for… |
|---|---|---|
| [current-focus.md](current-focus.md) | Active work, blockers, next priorities | **Always** — first thing every session |
| [architecture.md](architecture.md) | Module structure, dependency flow, `S`/`hooks`/`rig` shared state | Any cross-module change, adding a new module, "where does X live" |
| [animation.md](animation.md) | Pose pipeline, idle/gestures/reactions, Animation Tuner, keyframe clips (Path B) | Touching `anim.js`, `pose.js`, any gesture/reaction/pose work |
| [rendering.md](rendering.md) | VRM load, mesh repair, morph pruning at load time, camera framing/IK, backdrop | Touching `avatar.js`, `camera.js`, avatar-load behavior, backdrop/parallax |
| [lighting.md](lighting.md) | The "Look" lighting/shading system | Touching `light.js`, MToon materials, brightness/rim/Look controls |
| [ui.md](ui.md) | Settings sheet, modes, test bar, Tuner UI, nameplate, touch input | Touching `ui.js`, `input.js`, any settings-sheet or touch-interaction work |
| [performance.md](performance.md) | Mobile GPU limits, morph capping, battery saver | Anything affecting frame cost, morph counts, or mobile rendering |
| [workflow.md](workflow.md) | Git/push loop, build stamp, verification steps, doc-maintenance rules | Every session touches this implicitly; read in full if unsure how to hand off a change |

## Starting a new session

1. Read `CLAUDE.md` (project root).
2. Read this file (`docs/index.md`).
3. Read [current-focus.md](current-focus.md).
4. Read **only** the subsystem doc(s) relevant to the task at hand, using
   the table above.

Do **not** read the entire `/docs` folder by default — it costs context for
no benefit on most tasks. Reach for a doc you skipped only if you hit a
decision you can't explain from the code + the docs you've already read.

## Keeping this current

Doc maintenance is part of a feature's definition of done — see
[CLAUDE.md § Documentation](../CLAUDE.md) and
[workflow.md § Documentation maintenance](workflow.md) for the exact rule
(what triggers an update, what doesn't, and what belongs in
`current-focus.md` vs. a subsystem doc).

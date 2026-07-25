# Current Focus

_This is an **active-work tracker**, not a changelog — implementation
history lives in `git log` and in the subsystem docs. Keep only what the
next session needs immediately: what's in flight, what's blocked, what's
next. Update this whenever the active thread changes; prune an entry the
moment it's resolved instead of letting it accumulate._

## Active work

- **Project save system** — phases 1–2 shipped (`b88`–`b90`); design and
  rationale in [persistence.md](persistence.md). `b88` added `project.js` (the
  versioned record, slice registry, rev reconciliation, autosave, migrations,
  legacy import) and the guarded IDB v2 upgrade; `b88`/`b89` are **confirmed on
  the phone** (migration ran, `persisted` granted, autosave advancing `rev`).
  `b89` added the readout line after the import toast turned out to be invisible
  — the load readout is itself a `toast()` sharing `#diag` and always overwrote
  it. `b90` (phase 2) moves the clip library onto a real `clips` slice owned by
  `anim.js` that also carries **`clips.editKeys`** + name/loop, adds a `tuner`
  slice, wires `saveSoon()` into every Tuner mutation, and adds the history ring
  (`history()`/`restore()`).

  `b91` (phase 3) adds the **Project tab**: name, save state, export/import
  `.conbadge.json`, the undo-history restore list, and a storage readout — plus
  an `avatar` slice holding the model's name/size by reference. This completes
  the project-save work as scoped.

  **On-device checks owed:** (b90) open the Tuner, capture a couple of keyframes,
  reload **without** pressing Save, confirm the draft and the `N-key draft`
  readout come back, and that both clips survived the v1→v2 migration. (b91)
  export a file, confirm it downloads, then import it back.

- **Tuner single-driver fix + menu redesign** (build `b87`, working tree, not
  yet confirmed on-device). Two changes:
  1. *State fix* — the Tuner no longer goes stale after using the keyframe
     timeline. One invariant now holds (`tuner.active === !clips.playing`),
     enforced by an `enterPose()` transition + self-healing sliders + a
     `clips.ended` auto-end bridge. See
     [ui.md § Single source of truth](ui.md). All synchronous transitions
     (capture/play/pause/scrub/stop/edit/update/dup/delete/switch) were verified
     in-sandbox by asserting the invariant after each; the auto-end bridge was
     verified by driving `clips.update`+`tickTimeline` manually (rAF is dead in
     the sandbox). **On-device check still owed:** confirm a bone slider visibly
     moves the avatar after a non-loop clip finishes and after a scrub — that's
     the render-loop path, which needs rAF.
  2. *Access* — the 🎬 menu is now a bottom-docked wrapping popover with
     `⚙ Animation Tuner` + `■ Stop` pinned on top (no more horizontal scroll to
     reach the Tuner). Layout verified at desktop (1280) and mobile (375): zero
     horizontal overflow, vertical scroll only. See
     [ui.md § Animation menu](ui.md).

- **Tuner auto-fade while adjusting** (`.tn-dim`, `dimDrag`/`dimPlay`, from
  `b86`). Slider-drag/scrub fade/restore verified live; **play-dim path still
  needs an on-device check** — it runs off the `requestAnimationFrame` tick that
  doesn't fire in this sandbox, so confirm the panel dims while a clip plays.
  (Unaffected by the b87 state fix; `enterPose()` clears `dimPlay` on return.)

- **Second-avatar outfit doesn't animate** (`b92`/`b93`, diagnostic only so far).
  An avatar exported with a full outfit renders the outfit frozen at bind pose.
  `b92` added `auditSkinning()`; see [rendering.md](rendering.md).

  **Confirmed on-device (`b92`):** it's the duplicate-armature case. 17 garment
  meshes flag `DEAD` (Sweatsh, Sash, Scarf, Bracele, Bodysui, ULTRA_*, …) — zero
  live bones each, small skeletons (b8–b29, vs the body's b95), so each garment
  carries only the bones it's weighted to rather than a full rig copy. The
  bandana that *does* work reads `Bandana Sk b8` with no marker (skinned into
  the body skeleton). Three rigid props (Visor, BadgeAt, Glowsti) were already
  rescued by `attachLooseMeshes()` — `attached 3`.

  **Open question `b93` answers:** no `>N` appeared on any line, i.e. zero exact
  name matches — but the exact matcher only strips `.001`-style suffixes, so
  prefixed/suffixed merge names would miss. `b93` adds loose (containment)
  matching → `~N`, plus a `dead:` sample line showing real bone names and their
  would-be targets. **Owed:** reload and report the `dead:` line.

  Then pick the fix: per-bone rebind by name (preserves real deformation) if the
  names map; nearest-live-bone-by-position as the approximate fallback if they
  don't; re-export with a merged armature is the only true fix either way.

## Blocked / pending

- **Idle resting-pose tuning.** The Tuner's **Base → idle** target
  (see [animation.md § Animation Tuner](animation.md)) is wired and ready.
  User still owes: tuned resting arm/hand position deltas from dialing it
  live. Bake as **raw** values (no `*e` — idle has no envelope), into the
  idle base offsets / relevant `CONFIG` constants.

## Next priorities

1. On-device confirmation of the b90 draft-survives-reload path (above), plus
   the b87 Tuner fixes (bone slider drives the avatar after a clip finishes /
   after a scrub) and the b86 auto-fade play-dim path.
2. Take a first project export as a real backup once b91 is confirmed.
3. Idle resting-pose tuning session (see above) once the user has time to
   dial it in.
4. Resume normal animation-tuning cadence via the Animation Tuner as new
   gesture/reaction requests come in.

---

_For durable subsystem knowledge, start at [docs/index.md](index.md)._

# Current Focus

_This is an **active-work tracker**, not a changelog — implementation
history lives in `git log` and in the subsystem docs. Keep only what the
next session needs immediately: what's in flight, what's blocked, what's
next. Update this whenever the active thread changes; prune an entry the
moment it's resolved instead of letting it accumulate._

## Active work

- **Project save system, phase 1** (build `b88`, working tree, not yet confirmed
  on-device). New `project.js`: versioned project record in IndexedDB, slice
  registry, rev-based reconciliation with the localStorage settings mirror,
  debounced autosave + pagehide flush, forward-compatible migrations, and the
  automatic legacy (`cb.settings`/`cb.clips`) import. `core.js` IDB bumped to
  v2 with a guarded upgrade; `main.js` awaits `project.load()` before
  `applySettings()`. Full design in [persistence.md](persistence.md).
  Verified locally: 42-case harness (legacy import, all three reconciliation
  cases, forward-compat preservation, save-failure surfacing, debounce/flush),
  a real-browser v1→v2 upgrade test (cached avatar survives, no
  `ConstraintError`), and an end-to-end boot on a local server that imported
  seeded legacy data and autosaved a live toggle change.
  **On-device check owed:** load on the phone, confirm the `b88` stamp, that
  settings/nameplate come back unchanged after the migration, and that the
  "Imported your existing settings and N clips" toast appears exactly once.

  *Phase 2 (next):* real `clips` slice owned by `anim.js` including
  **`clips.editKeys`**, a `tuner` slice, and the autosave history ring — this is
  what actually closes the "lose unsaved animation work on reload" gap.
  *Phase 3:* Project card UI with export/import `.conbadge.json`.

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

## Blocked / pending

- **Idle resting-pose tuning.** The Tuner's **Base → idle** target
  (see [animation.md § Animation Tuner](animation.md)) is wired and ready.
  User still owes: tuned resting arm/hand position deltas from dialing it
  live. Bake as **raw** values (no `*e` — idle has no envelope), into the
  idle base offsets / relevant `CONFIG` constants.

## Next priorities

1. On-device confirmation of the b88 legacy migration (above), plus the b87
   Tuner fixes (bone slider drives the avatar after a clip finishes / after a
   scrub) and the b86 auto-fade play-dim path.
2. Project save phase 2 — persist `clips.editKeys` + Tuner state, history ring.
3. Idle resting-pose tuning session (see above) once the user has time to
   dial it in.
4. Resume normal animation-tuning cadence via the Animation Tuner as new
   gesture/reaction requests come in.

---

_For durable subsystem knowledge, start at [docs/index.md](index.md)._

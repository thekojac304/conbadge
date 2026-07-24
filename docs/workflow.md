# Workflow

## Current implementation

There is no build step, no bundler, no local dev server in the normal loop.
Claude Code has direct git access to this working copy and pushes straight to
`origin main` — **always asking for confirmation before pushing**, never
silently. GitHub Pages deploys from `main` directly (no Actions workflow), so
a confirmed push goes live in ~30–60s. This replaced the earlier GitHub
web-UI upload flow (uploading one file at a time, replacing by name) once git
push access was set up, so the user could iterate from their phone without
manually re-uploading each file. The repo layout stays flat regardless (files
at repo root, no `js/` subfolder — a `js/` subfolder previously caused
GitHub's web uploader to flatten paths and 404; kept flat now mainly to avoid
churn, not because git has the same limitation).

### Iteration loop

1. Bump `CONFIG.BUILD` in `config.js` (e.g. `b74` → `b75`) — this stamp shows
   in the on-screen load readout, so the user can confirm a reload actually
   picked up the new files.
2. Claude verifies the change (see below), commits, and asks before pushing.
3. User confirms the push.
4. User confirms the new build stamp in the load readout on their phone.

The service worker (`sw.js`) is **network-first** for the app shell, so a
normal page reload picks up changes — no cache-clearing step needed.

### Verification before handing over files

Proportional to the change — the module structure is stable, so parse +
harness checks are usually sufficient; this is not a mandatory checklist for
every one-line tweak.

- **Module-mode parse**: copy each changed file to `.mjs` and run
  `node --check`. Plain `node --check file.js` parses as a *script* and
  misses ESM-only syntax errors (import/export statements).
- **Runtime harness**: stub `THREE` + DOM, import `main.js`, execute several
  frames, call every gesture. Catches undefined-reference bugs static
  analysis can't (a typo'd property on `rig`/`S` that only surfaces once
  that code path actually runs).
- **Cross-module leak check**: strip comments/strings, confirm no module
  references an identifier owned by another module without importing it —
  guards against the dependency-flow discipline in
  [architecture.md](architecture.md) silently breaking.
- **Confirm the bumped `CONFIG.BUILD` stamp is actually present** in the
  emitted file before handing it over — catches a forgotten bump before the
  user wastes a round-trip confirming "did this actually update?"

Don't echo large file sections back into chat during this process — keep
verification internal, report the result.

### Documentation maintenance

This project's `/docs` folder is meant to persist context **between Claude
Code sessions** — each new session starts without memory of prior ones, so
`/docs` (not scrollback, not chat history) is the durable record. Start at
[docs/index.md](index.md) for the file map and the recommended read order
for a new session.

**Documentation is part of a feature's definition of done, not a separate
pass.** When a change meaningfully touches architecture, a subsystem's
behavior, workflow, or introduces a standing decision (a tuning convention,
a deliberate tradeoff, a "why we didn't do X"), update the relevant docs in
the *same* handover as the code:

- Update the relevant `docs/*.md` subsystem file(s).
- Update [docs/current-focus.md](current-focus.md) to reflect the new
  active state.
- Remove information the change makes obsolete — a doc that only ever grows
  is as much drift as one that never updates.
- Don't document temporary experiments or work that got reverted — if it
  didn't ship, it doesn't belong in a subsystem doc (a rejected approach's
  *lesson* can be worth a line — see e.g. ui.md's note on the rejected SVG
  region picker — but not its full narrative).

**Do NOT touch docs for:** formatting, refactoring, variable renames, tiny
numeric tuning (a config constant nudged by feel), or insignificant bug
fixes. These don't change architecture, behavior, or decisions — updating
docs for them is churn that makes real doc updates harder to spot in a diff.

**`current-focus.md` is a tracker, not a changelog.** Keep only active work,
current blockers, and next priorities — anything the next session needs
*immediately*. Implementation history belongs in `git log` (which already
has descriptive commit messages) and in the subsystem docs' own "Current
implementation" sections. The moment an active-work entry resolves, either
delete it or fold its durable lesson into the relevant subsystem doc, and
remove it from the tracker — don't leave resolved threads accumulating.

## Design philosophy

**Optimize for round-trip cost, not for local tooling elegance.** Every
verification step exists because a *wrong* handoff costs the user a real
upload-and-reload cycle to discover, on a phone, often with no DevTools
console — see CLAUDE.md's on-screen error handler, which exists for exactly
this reason. Catching an error before handoff is much cheaper than catching
it after.

## Important decisions

- **No `js/` subfolder** — a structural constraint imposed by how GitHub's
  web uploader handles nested paths, not a stylistic choice. Don't
  "helpfully" reorganize into subfolders.
- **Network-first service worker** specifically so the upload-confirm loop
  doesn't need a "clear cache" step — this was a deliberate fix, not a
  default left in place.

## Known limitations

- No CI, no automated test suite — verification is manual and
  Claude-performed before every push.
- A single `git push` lands all changed files atomically (an improvement over
  the old per-file web-UI upload, where a multi-file change could leave the
  live site briefly inconsistent mid-upload).

## Cost management

Long threads get expensive: every turn re-reads the whole history, and this
project generates lots of screenshots and code dumps. Prefer cropped images
or pasted error text, batch related requests, and start a fresh conversation
when a thread gets long — this is exactly what `docs/` and
`docs/current-focus.md` exist to make cheap: a new session should be able to
read a handful of files and be productive immediately, instead of
re-deriving context from scrollback.

## Future ideas

- None currently tracked.

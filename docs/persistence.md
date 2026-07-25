# Persistence

Covers `project.js` — the versioned project record, the slice registry,
autosave, and migrations — plus the storage helpers in `core.js`.

## Current implementation

### Where data actually lives

There is no working folder. Everything lives in **browser-origin storage**, a
per-site sandbox the browser manages. `p_default` is a *key in an IndexedDB
object store*, not a path.

| Store (DB `conbadge`, v2) | Key | Value |
|---|---|---|
| `files` | `avatar` | `{name, buffer}` — the cached VRM |
| `projects` | `p_default` | the versioned project record |
| `history` | `{id}:{rev}` | autosave ring, newest `HISTORY_MAX` (20) revisions |
| `meta` | `backup:v0` | pre-migration copy of the legacy localStorage blobs |

Plus three localStorage keys: `cb.settings` (the synchronous settings mirror),
`cb.rev` (the record revision that mirror was written at), and `cb.clips` (a
mirror of the clip library, kept in step by the clips slice's `capture()`).

Consequences worth knowing, because they're the reason export matters:

- Scoped to **origin + browser + device**. Nothing syncs. A local test server is
  a *different origin* with entirely separate data — that's what makes it safe
  to verify storage changes locally without touching real data.
- "Clear site data" wipes it, and it can be **evicted under storage pressure**
  (Safari has been the strict one: script-writable storage cleared after ~a week
  of no interaction for sites not installed to the Home Screen).
- `project.load()` calls `navigator.storage.persist()` to ask for exemption from
  eviction. It is **best-effort** — Chrome grants it silently for installed or
  high-engagement origins and denies it for a bare `localhost` visit, so a
  `false` in the local harness is expected and not a failure.
- Export (phase 3) is the only durable, portable copy. Autosave protects against
  crashes and reloads; only export protects against the storage layer itself.

### The record

```js
{ magic:'conbadge.project', schema:1, id:'p_default', name:'', rev:12,
  savedAt:'2026-07-24T…', app:{ build:'b88' },
  slices:{ settings:{v:1,data:{…}}, clips:{v:1,data:{…}} } }
```

Two version levels: `schema` for the envelope, and a per-slice `v` so one
subsystem's format can evolve without touching another's.

### Slice registry

`project.js` imports only `config` + `core`, so it sits high in the chain and
subsystems can register with it without creating a cycle — the `hooks` pattern
generalized:

```
config → core → project → light/pose → camera → anim → avatar/input → ui → main
```

```js
project.register({ id, version, capture() → data, apply(data), migrate:{ [from]: fn } });
```

This shape was chosen over a project manager that imports every subsystem
directly: such a module would have to sit *below* `ui.js` to read Tuner state,
but `ui.js` needs to call it for the export/import buttons — a cycle. With the
registry, each subsystem also keeps ownership of its own serialization instead
of a god module accumulating every field list.

Registered today:

| Slice | Owner | Data |
|---|---|---|
| `settings` v1 | `project.js` (it can import `core` directly) | the whole `settings` object |
| `avatar` v1 | `project.js` via `noteAvatar()` | `{name, size}` — a **reference**, never the model |
| `clips` v2 | `anim.js` | `{library, editKeys, editName, editLoop}` |
| `tuner` v1 | `anim.js` | `{overrides, face}` |
| `animAdjust` v1 | `adjust.js` | `{avatars:{[key]:{[animId]:{ov,face,build,at}}}}` |

`clips` carries **`editKeys` — the clip being authored** — not just the saved
library, which is what makes an in-progress clip survive a reload. `tuner`
deliberately stores only the dialled-in deltas, **not** `kind`/`name`: reopening
the app shouldn't leave an animation held frozen.

`animAdjust` is bucketed **by avatar** (VRM filename, lower-cased, `.vrm`
stripped — *not* the bytes, so a re-export keeps its tuning). The app is still
single-project, so this bucket is what keeps one avatar's pose corrections off
another's; if multiple named projects ever land, a project holding one avatar
just has one bucket. See
[animation.md § Per-avatar animation adjustments](animation.md) for why these
deltas can't live in source.

Every mutation path in the Tuner UI (capture, retime, update, dup, delete, load,
save, name/loop, and the bone/face sliders) calls `project.saveSoon()`. Nothing
depends on pressing **Save** to survive — Save now only names a draft and files
it in the library.

### Reconciliation: why there are two copies of settings

[core.js](../core.js) reads `cb.settings` **synchronously at module-init** —
every module imports `settings` and reads it immediately, so that read can't
become async without reworking boot. So localStorage stays the live working copy
and IndexedDB holds the canonical record; `cb.rev` pairs them. On load:

| Condition | Meaning | Action |
|---|---|---|
| `record.rev > cb.rev` | record is newer (an import, another context) | apply record slices over `settings` |
| `record.rev === cb.rev` | in sync — and the mirror may hold edits made since the last debounced save | **don't** apply the settings slice |
| `record.rev < cb.rev` | the last record write failed | keep the mirror, toast, re-save |

The `===` case is the one that matters: applying the record there would silently
roll back any setting changed since the last autosave.

`settings` is hydrated with `Object.assign`, never wholesale replacement — a key
missing from the record means the build that wrote it didn't have that key, so
this build's default is the right value to keep. It's mutated **in place**
because ES modules can't reassign an imported binding.

### Autosave

`saveSettings()` in `core.js` writes the mirror then calls
`hooks.onSettingsSaved`, which `project.js` wires to a **1500ms debounced**
record save. Flushed on `pagehide` and `visibilitychange → hidden` — *not*
`beforeunload`, which mobile browsers routinely skip. An IndexedDB write started
in a pagehide handler isn't guaranteed to complete, which is exactly why the
synchronous localStorage mirror exists: it always lands, so a killed tab is at
worst one debounce behind on the record and loses nothing from `settings`.

Storage failures are **never silent** — quota, private mode, or a blocked
upgrade sets `state.lastError` and raises a `toast()`. The user is normally on a
phone with no DevTools; a save that fails invisibly is the worst possible
outcome for a feature whose whole point is not losing work.

### Save state in the load readout

`project.summary()` appends a line to the on-screen load readout (built in
`avatar.js`): `project rev 12 · saved 20:11 · 3 clips · persisted`, or
`project SAVE FAILED — …` when `state.lastError` is set.

This exists because **the load readout is itself a `toast()`**, so it shares
`#diag` with every other message. The avatar mounts after `project.load()`, so
the readout reliably overwrites any boot-time toast — including the legacy-import
message, which was consequently never seen on-device. Save state has to live in
the readout itself, not in a toast that the readout replaces.

### Export / import

`exportProject()` returns `{json, filename}` — the record itself plus an
`exportedAt`, pretty-printed, named
`{project}-{date}-rev{n}.conbadge.json`. `ui.js` turns it into a Blob download.
It `save()`s first (never `flush()`, which only writes an *already pending*
save), and rethrows `state.lastError` rather than handing over a file that
silently predates the current state.

The **avatar is a reference only** (`{name, size}`): a 30MB VRM base64'd into
JSON is ~40MB of string to build on a phone, and the user already has the file.
Import reports which `.vrm` to load.

`importProject(text)` validates `magic`, refuses a `schema` newer than this build
understands, then **saves the current state to the history ring first** so an
import is walk-back-able rather than one-way; the return value includes the
`restorePoint` rev to make that actionable in a toast. The imported record adopts
the local `ACTIVE_ID` and continues **local** rev numbering — revs must never go
backwards, or the mirror comparison breaks.

Both import and `restore()` mutate `settings` without going through
`saveSettings()`, which is why `writeMirrorRev()` rewrites the `cb.settings`
mirror too. Without that, the stale mirror wins the equal-rev comparison on the
next load and **silently reverts the import** — it is regression-tested.

### Migrations

- **Legacy (v0) import** — on first run with no record but existing `cb.settings`
  / `cb.clips`, a v1 record is built from them, the pre-migration blobs are
  stashed at `meta['backup:v0']`, and a toast reports what was imported. The
  legacy localStorage keys are **deliberately left in place** as a safety net.
- **Per-slice chains** — `migrate:{ 0:fn, 1:fn }` keyed by the version migrated
  *from*, applied in sequence up to the registered version.
- **Forward compatibility** — a slice whose stored `v` exceeds what this build
  knows is *not applied*, and a slice with no registered handler is left alone.
  Both are preserved verbatim and re-emitted on the next save (`captureRecord()`
  merges over the loaded `raw`), so opening a project written by a newer build on
  an older build never strips data.
- **A migration saves immediately.** `load()` calls `save({reason:'migrate'})`
  whenever `state.migratedFrom` is set, because a migration otherwise only
  changes in-memory state — the record keeps its old shape, and anything reading
  `raw` (the load readout, an export) keeps reporting the pre-migration data
  until some unrelated event happens to trigger a write.

### Autosave history ring

Every successful save also appends to the `history` store, pruned to the newest
`HISTORY_MAX` (20) revisions. `history()` lists them newest-first; `restore(rev)`
applies one and then **saves it forward as a new revision**, so restoring is
itself undoable rather than rewriting history. The whole ring is best-effort:
`pushHistory()` swallows its own errors, because history must never be the
reason a real save fails.

### The IndexedDB v2 upgrade

The v1 handler called `createObjectStore('files')` unconditionally, which throws
`ConstraintError` on every existing install once the version is bumped. The v2
handler guards with `objectStoreNames.contains()`, rejects on `onblocked` (a
second open tab holding v1 stops the upgrade) with a message telling the user to
close it, and sets `db.onversionchange` so open tabs don't block *future*
upgrades. All four stores are created at v2 even though `history` is unused
until phase 2 — the version bump is the risky part, so it's worth doing once.

## Important decisions

- **IndexedDB canonical, localStorage a synchronous mirror of the settings slice
  only.** Driven by core.js's module-init read, not by preference. The cost is
  two writers for one piece of state; `cb.rev` plus "`project.js` is the only
  writer of the record" is what contains it.
- **The clips v1→v2 migration merges live `cb.clips` OVER the record's copy.**
  In phase 1 nothing triggered a save when a clip was saved, so the record's
  library was only as current as the last unrelated write — localStorage was
  always at least as fresh. Taking the record's copy alone would silently drop
  any clip saved since. This was a real case, not a hypothetical: a b89 install
  had one clip in the record and two in localStorage.
- **Clip/Tuner state is deep-copied on both capture and apply.** A keyframe
  channel array shared between the record and the live editor corrupts keys as
  soon as one is edited — see [ui.md](ui.md) on `cloneKey()`.
- **Legacy keys are not deleted after import.** They cost a few KB and are the
  fallback if the record is lost. Remove them only after several builds have
  confirmed the record is reliable.
- **A failed save must not advance `rev`.** Otherwise the mirror and record
  revisions desynchronize in the direction that makes the *stale* copy look
  authoritative on next load.

## Known limitations

- **`settings` never gains defaults for keys added after a user's blob was first
  written.** `LS.get('cb.settings', {…})` returns the *stored* object whenever the
  key exists — the default object is only used when there's no blob at all. So a
  long-standing install has `undefined` for every setting introduced since, and
  each read site's own `|| default` / `!== false` guard is what keeps it working
  (visible as `look undefined` in the load readout). Pre-dates the project system.
  Fixing it means merging stored-over-defaults, which is **not behaviour-neutral**:
  a key like `bgAuto` (default `true`) currently reads falsy for those users, so
  merging would switch their backdrop to Look-matched colours.

- Single project (`p_default`). The store is keyed for more; the UI isn't built.
- `flush()` only writes a *pending* debounced save; it is **not** "ensure
  persisted". Call `save()` when the write must definitely happen.
- Import/restore use `confirm()`. Fine on a phone, but it's the only blocking
  browser dialog in the app.
- Export is manual. There's a staleness nudge in the Project card at 14 days, but
  nothing automates the backup.

## Future ideas

- Optional binary container carrying the VRM bytes, so one file moves everything
  (a magic header + JSON + raw bytes, ~40 lines, no dependencies — deliberately
  not base64).
- Multiple named projects, on the already-keyed `projects` store.
- Auto-export reminder, or a periodic export straight to the Downloads folder if
  the File System Access API ever lands on mobile.

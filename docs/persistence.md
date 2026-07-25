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
| `history` | `{id}:{ts}` | autosave ring (created at v2, **not written yet** — phase 2) |
| `meta` | `backup:v0` | pre-migration copy of the legacy localStorage blobs |

Plus two localStorage keys: `cb.settings` (the synchronous settings mirror) and
`cb.rev` (the record revision that mirror was written at). The legacy
`cb.clips` is still the live clip library until phase 2.

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

Registered today: `settings` (owned by `project.js` itself, since it can import
`core` directly) and `clips` (a **passthrough** that captures
`localStorage['cb.clips']` verbatim — phase 2 replaces it with a real slice
owned by `anim.js`).

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
- **The clips slice is a passthrough in phase 1.** It captures live `cb.clips` on
  *every* save rather than a one-time copy, and its `apply()` only seeds
  localStorage when empty. Without that, saving a clip after the initial import
  would leave the record's copy stale, and phase 2 would restore the stale one
  over the fresh one.
- **Legacy keys are not deleted after import.** They cost a few KB and are the
  fallback if the record is lost. Remove them only after several builds have
  confirmed the record is reliable.
- **A failed save must not advance `rev`.** Otherwise the mirror and record
  revisions desynchronize in the direction that makes the *stale* copy look
  authoritative on next load.

## Known limitations

- Phase 1 persists settings and the clip library only. **`clips.editKeys` (the
  clip being authored) and Tuner overrides are still memory-only** — the
  original loss risk is not closed until phase 2.
- No export/import yet (phase 3), so there is still no off-device copy.
- The autosave history ring store exists but is unwritten, so there's no
  "restore an earlier revision" path yet.
- Single project (`p_default`). The store is keyed for more; the UI isn't built.

## Future ideas

- Phase 2: real `clips` slice owned by `anim.js` (incl. `editKeys`), `tuner`
  slice owned by `ui.js`, the history ring, and an "autosaved ✓" indicator.
- Phase 3: Project card in the settings sheet — name, last-saved stamp, Export /
  Import `.conbadge.json`, restore-from-autosave, `navigator.storage.estimate()`
  readout, and a nudge when the last export goes stale.
- Later: optional binary container carrying the VRM bytes; multiple named
  projects.

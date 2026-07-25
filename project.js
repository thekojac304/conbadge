// Project persistence: the versioned project record, the slice registry, storage,
// autosave scheduling, and migrations. See docs/persistence.md.
//
// Imports only config + core, so subsystems higher up the chain (anim, ui) can
// register their own serialization with it without creating a cycle — the same
// "call up without importing" trick as core's `hooks`, generalized.
//
//   config → core → PROJECT → light/pose → camera → anim → avatar/input → ui → main
//
// Storage model: IndexedDB holds the canonical record; localStorage keeps the
// synchronous `cb.settings` mirror that core.js reads at module-init (every
// module imports `settings` and reads it immediately, so that read cannot become
// async without reworking boot). `cb.rev` pairs the mirror to a record revision
// so the two can be reconciled instead of one silently clobbering the other.
import { CONFIG } from './config.js';
import { settings, hooks, idbGet, idbPut, idbDel, idbKeys, idbAll, toast } from './core.js';

export const SCHEMA = 1;              // envelope format version
const MAGIC        = 'conbadge.project';
const ACTIVE_ID    = 'p_default';     // phase 1 is single-project; the store is keyed for more
const REV_KEY      = 'cb.rev';        // localStorage: rev the settings mirror was written at
const LEGACY_SETTINGS = 'cb.settings';
const LEGACY_CLIPS    = 'cb.clips';
const SAVE_DEBOUNCE   = 1500;

/* ===========================================================================
   Slice registry
   =========================================================================== */
// A slice owns one subsystem's serialization:
//   { id, version, capture() → data, apply(data), migrate:{ [fromVersion]: fn } }
// A slice present in the record with no registered spec (or a version NEWER than
// this build understands) is preserved verbatim and re-emitted on save, so a
// project written by a newer build never gets stripped by an older one.
const slices = new Map();
export function register(spec){
  if (!spec || !spec.id) return;
  slices.set(spec.id, spec);
  // Registration can happen after load() on a hot path; hydrate immediately so
  // a late slice still sees its stored data.
  if (state.ready && raw?.slices?.[spec.id]) applySlice(spec, raw.slices[spec.id]);
}

export const state = {
  ready:false, rev:0, savedAt:null, name:'', persisted:false,
  lastError:null, lastSavedReason:null, migratedFrom:null, lastExportAt:null,
};

let raw = null;        // the record as loaded, incl. slices this build doesn't know
let saveTimer = 0;
let saving = null;     // in-flight save promise, so flush() can await it

/* ===========================================================================
   Migrations
   =========================================================================== */
// Envelope migrations, keyed by the schema they migrate FROM. Schema 1 is the
// first, so this is empty — the chain exists so adding schema 2 is mechanical.
const SCHEMA_MIGRATIONS = {};

function migrateEnvelope(rec){
  let s = rec.schema|0;
  while (s < SCHEMA){
    const fn = SCHEMA_MIGRATIONS[s];
    if (!fn) break;                 // no path: leave it, slices still migrate individually
    rec = fn(rec); s = rec.schema|0;
  }
  return rec;
}

// Chain a slice's own migrations from its stored version up to the registered one.
function migrateSlice(spec, entry){
  let v = entry.v|0, data = entry.data;
  while (v < (spec.version|0)){
    const fn = spec.migrate && spec.migrate[v];
    if (!fn) break;
    data = fn(data); v++;
  }
  return { v, data };
}

function applySlice(spec, entry){
  if (!entry || entry.data == null) return;
  // Newer than this build understands — don't guess at it, don't apply it, and
  // (because `raw` is merged over on save) don't destroy it either.
  if ((entry.v|0) > (spec.version|0)){
    console.warn(`[project] slice "${spec.id}" is v${entry.v}, this build knows v${spec.version} — preserved, not applied`);
    return;
  }
  const m = migrateSlice(spec, entry);
  if (m.v !== (entry.v|0)) state.migratedFrom = state.migratedFrom || `slice:${spec.id}:v${entry.v}`;
  try { spec.apply?.(m.data); }
  catch(e){ console.warn(`[project] slice "${spec.id}" failed to apply`, e); }
}

/* ===========================================================================
   Built-in slices
   =========================================================================== */
// Settings. Object.assign rather than wholesale replacement: a key missing from
// the record means the build that wrote it didn't have that key, so this build's
// default (from core's LS.get fallback) is the right value to keep. Mutated in
// place because ES modules can't reassign an imported binding.
register({
  id:'settings', version:1,
  capture: ()=> ({ ...settings }),
  apply: data => {
    Object.assign(settings, data);
    settings.morphs = settings.morphs || {};              // same guards core.js applies
    settings.tailCurl = Math.max(0, settings.tailCurl||0);
  },
});

// The `clips` and `tuner` slices are registered by anim.js, which owns that
// state. project.js only needs to know cb.clips exists for the legacy import.

// Avatar reference ONLY — name and byte size, never the VRM itself. A 30MB model
// base64'd into JSON is ~40MB of string to build on a phone, and you already have
// the .vrm file; import just tells you which one to pick.
let avatarRef = null;
export function noteAvatar(name, size){
  const next = name ? { name, size:size|0 } : null;
  if (JSON.stringify(next) === JSON.stringify(avatarRef)) return;
  avatarRef = next;
  saveSoon('avatar');
}
register({
  id:'avatar', version:1,
  capture: ()=> avatarRef,
  // Don't clobber a live avatar with the record's reference — load() runs before
  // the VRM mounts, so this only fills in what the record remembered.
  apply: d => { if (!avatarRef && d && d.name) avatarRef = d; },
});
export function avatarInfo(){ return avatarRef; }

/* ===========================================================================
   Record build / load / save
   =========================================================================== */
function emptyRecord(){
  return { magic:MAGIC, schema:SCHEMA, id:ACTIVE_ID, name:'', rev:0, savedAt:null,
           app:{ build:CONFIG.BUILD }, slices:{} };
}

function captureRecord(){
  const rec = { ...(raw || emptyRecord()) };
  rec.magic = MAGIC; rec.schema = SCHEMA; rec.id = ACTIVE_ID;
  rec.app = { build:CONFIG.BUILD };
  rec.slices = { ...(raw?.slices || {}) };     // keep unknown/newer slices verbatim
  for (const spec of slices.values()){
    if (raw?.slices?.[spec.id] && (raw.slices[spec.id].v|0) > (spec.version|0)) continue;  // don't downgrade
    try { rec.slices[spec.id] = { v:spec.version, data:spec.capture?.() }; }
    catch(e){ console.warn(`[project] slice "${spec.id}" failed to capture`, e); }
  }
  return rec;
}

function mirrorRev(){ const v = parseInt(localStorage.getItem(REV_KEY)||'0', 10); return isNaN(v) ? 0 : v; }

// Legacy (pre-project) storage: an unversioned cb.settings blob + cb.clips.
// Lifted into a v1 record on first run. The legacy keys are deliberately LEFT
// IN PLACE as a safety net, and a copy of the pre-migration state is stashed
// under meta['backup:v0'].
function hasLegacy(){
  try { return !!(localStorage.getItem(LEGACY_SETTINGS) || localStorage.getItem(LEGACY_CLIPS)); }
  catch(e){ return false; }
}
async function importLegacy(){
  let clipCount = 0;
  try { clipCount = Object.keys(JSON.parse(localStorage.getItem(LEGACY_CLIPS))||{}).length; } catch(e){}
  try {
    await idbPut('backup:v0', {
      at:new Date().toISOString(), build:CONFIG.BUILD,
      settings: localStorage.getItem(LEGACY_SETTINGS),
      clips: localStorage.getItem(LEGACY_CLIPS),
    }, 'meta');
  } catch(e){ /* backup is best-effort; don't block the import */ }
  // core.js already parsed cb.settings into `settings`, and the clips slice
  // captures cb.clips directly, so a plain capture IS the lift.
  raw = emptyRecord();
  state.migratedFrom = 'legacy:v0';
  await save({ reason:'legacy-import' });
  return clipCount;
}

export async function load(){
  // Ask to be exempt from eviction under storage pressure (and from Safari's
  // clearing of script-writable storage for non-installed sites). Best-effort:
  // Chrome grants it silently for installed/high-engagement origins.
  try {
    if (navigator.storage?.persist){
      state.persisted = await navigator.storage.persisted?.() || false;
      if (!state.persisted) state.persisted = await navigator.storage.persist();
    }
  } catch(e){}

  try { state.lastExportAt = (await idbGet('lastExportAt', 'meta')) || null; } catch(e){}

  let rec = null;
  try { rec = await idbGet(ACTIVE_ID, 'projects'); }
  catch(e){
    // No record access at all — run on the localStorage mirror alone rather than
    // wiping anything, and make the failure visible (the user is on a phone).
    state.lastError = e;
    state.ready = true;
    toast('Project storage unavailable — settings still save locally. ' + (e.message||''), 6000);
    return state;
  }

  if (rec && rec.magic === MAGIC){
    raw = migrateEnvelope(rec);
    state.name = raw.name || '';
    // Reconcile against the synchronous mirror core.js already loaded.
    //   record newer  → an import/another context wrote it; apply it.
    //   equal         → in sync, and the mirror may hold edits made since the
    //                   last debounced save, so DON'T clobber it.
    //   mirror newer  → the last record write failed; keep the mirror, re-save.
    const rrev = raw.rev|0, mrev = mirrorRev();
    if (rrev > mrev){
      for (const spec of slices.values()) applySlice(spec, raw.slices?.[spec.id]);
      state.rev = rrev; state.savedAt = raw.savedAt;
      writeMirrorRev(rrev);
    } else {
      for (const spec of slices.values()){
        if (spec.id === 'settings') continue;              // mirror wins for settings
        applySlice(spec, raw.slices?.[spec.id]);
      }
      state.rev = rrev; state.savedAt = raw.savedAt;
      if (mrev > rrev){
        toast('Recovered unsaved settings from this device', 4000);
        await save({ reason:'mirror-newer' });
      }
    }
    // A migration only changed the IN-MEMORY state; persist it now rather than
    // waiting for an unrelated event to trigger a save. Without this the record
    // keeps its old shape (and the readout keeps reporting it) until something
    // else happens to write — which is exactly how a stale clip count survived.
    if (state.migratedFrom) await save({ reason:'migrate' });
  } else if (hasLegacy()){
    const n = await importLegacy();
    toast(`Imported your existing settings${n ? ` and ${n} clip${n===1?'':'s'}` : ''}`, 5000);
  } else {
    raw = emptyRecord();
    await save({ reason:'first-run' });
  }

  state.ready = true;
  return state;
}

// The mirror is rewritten from the SAME `settings` object the record just
// captured, so the two can never disagree at equal revs. This is load-bearing
// for import/restore: those mutate `settings` without going through
// saveSettings(), so without it the stale mirror would win the equal-rev
// comparison on the next load and silently revert the import.
function writeMirrorRev(rev){
  try {
    localStorage.setItem(REV_KEY, String(rev));
    localStorage.setItem(LEGACY_SETTINGS, JSON.stringify(settings));
  } catch(e){}
}

export async function save({ reason='manual' } = {}){
  if (saveTimer){ clearTimeout(saveTimer); saveTimer = 0; }
  const rec = captureRecord();
  rec.rev = (state.rev|0) + 1;
  rec.savedAt = new Date().toISOString();
  rec.name = state.name || rec.name || '';

  saving = (async ()=>{
    try {
      await idbPut(ACTIVE_ID, rec, 'projects');
      raw = rec;
      state.rev = rec.rev; state.savedAt = rec.savedAt;
      state.lastError = null; state.lastSavedReason = reason;
      writeMirrorRev(rec.rev);          // pair the mirror to the revision just written
      pushHistory(rec);                 // best-effort, never blocks or fails the save
      return true;
    } catch(e){
      // Quota, private mode, or a blocked upgrade. Never silent — the mirror is
      // still holding the settings, but the record is now behind.
      state.lastError = e;
      toast('Could not save project: ' + (e.message || e), 6000);
      return false;
    } finally { saving = null; }
  })();
  return saving;
}

/* ===========================================================================
   Autosave history ring
   =========================================================================== */
// A rolling window of past revisions, so a bad edit is recoverable rather than
// overwritten. One autosave slot can be clobbered by a bad state; a ring can't.
// Deliberately best-effort and non-blocking: history must never be the reason a
// real save fails or feels slow.
export const HISTORY_MAX = 20;

async function pushHistory(rec){
  try {
    const key = `${ACTIVE_ID}:${String(rec.rev).padStart(6,'0')}`;
    await idbPut(key, { rev:rec.rev, savedAt:rec.savedAt, build:rec.app?.build,
                        reason:state.lastSavedReason, rec }, 'history');
    const keys = (await idbKeys('history')).filter(k => String(k).startsWith(ACTIVE_ID + ':')).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_MAX))) await idbDel(k, 'history');
  } catch(e){ /* history is a nicety; the record itself already landed */ }
}

// [{rev, savedAt, build, reason}] newest first — the restore list (phase 3 UI).
export async function history(){
  try {
    const all = await idbAll('history');
    return all.filter(h => h && h.rec && h.rec.id === ACTIVE_ID)
              .sort((a,b)=> b.rev - a.rev)
              .map(({rev, savedAt, build, reason}) => ({ rev, savedAt, build, reason }));
  } catch(e){ return []; }
}

// Restore a past revision: applied to the live app AND saved forward as a new
// revision, so restoring is itself undoable rather than rewriting history.
export async function restore(rev){
  const key = `${ACTIVE_ID}:${String(rev).padStart(6,'0')}`;
  const entry = await idbGet(key, 'history');
  if (!entry || !entry.rec) throw new Error(`No saved revision ${rev}`);
  raw = migrateEnvelope(entry.rec);
  for (const spec of slices.values()) applySlice(spec, raw.slices?.[spec.id]);
  await save({ reason:`restore-${rev}` });
  toast(`Restored revision ${rev}`, 4000);
  return state;
}

/* ===========================================================================
   Export / import
   =========================================================================== */
// Autosave protects against crashes and reloads. Export is the ONLY thing that
// protects against the storage layer itself — eviction, "clear site data", a
// lost or wiped phone. Nothing leaves the device: this is a local download.
export async function exportProject(){
  await save({ reason:'pre-export' });          // the file must reflect current state
  if (state.lastError) throw state.lastError;   // don't hand over a stale export silently
  const rec = JSON.parse(JSON.stringify(raw));
  rec.exportedAt = new Date().toISOString();
  const stamp = rec.exportedAt.slice(0,10);
  const base = (state.name || 'conbadge').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'conbadge';
  state.lastExportAt = rec.exportedAt;
  try { await idbPut('lastExportAt', rec.exportedAt, 'meta'); } catch(e){}
  return { json: JSON.stringify(rec, null, 2),
           filename: `${base}-${stamp}-rev${rec.rev}.conbadge.json` };
}

// Replaces the active project. The pre-import state is saved to the history ring
// first, so an import is recoverable via restore() rather than being one-way.
export async function importProject(text){
  let rec;
  try { rec = JSON.parse(text); }
  catch(e){ throw new Error('Not a valid project file — could not read it as JSON'); }
  if (!rec || rec.magic !== MAGIC) throw new Error('Not a Con Badge project file');
  if ((rec.schema|0) > SCHEMA)
    throw new Error(`This project was written by a newer build (format ${rec.schema}, this build reads ${SCHEMA}). Update the badge first.`);

  await save({ reason:'pre-import' });           // current state -> history, recoverable
  const restorePoint = state.rev;

  raw = migrateEnvelope(rec);
  raw.id = ACTIVE_ID;                            // adopt it as this device's active project
  state.name = raw.name || '';
  state.migratedFrom = null;
  for (const spec of slices.values()) applySlice(spec, raw.slices?.[spec.id]);
  await save({ reason:'import' });
  return { rev:state.rev, name:state.name, restorePoint,
           avatar:raw.slices?.avatar?.data || null,
           clips:Object.keys(raw.slices?.clips?.data?.library || {}).length };
}

export function setName(name){
  state.name = (name || '').slice(0, 60);
  if (raw) raw.name = state.name;
  saveSoon('name');
}

// {usage, quota} in bytes, or null where the browser won't say.
export async function estimate(){
  try { const e = await navigator.storage?.estimate?.(); return e ? { usage:e.usage, quota:e.quota } : null; }
  catch(e){ return null; }
}

// Debounced autosave. Every mutation path calls this; flush() forces it out.
export function saveSoon(reason='autosave'){
  if (!state.ready) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{ saveTimer = 0; save({ reason }); }, SAVE_DEBOUNCE);
}

export async function flush(reason='flush'){
  if (saveTimer){ clearTimeout(saveTimer); saveTimer = 0; await save({ reason }); }
  else if (saving) await saving;
}

/* ===========================================================================
   Autosave triggers
   =========================================================================== */
hooks.onSettingsSaved = ()=> saveSoon('settings');

// A backgrounded tab on mobile can be killed without further notice, and an
// IndexedDB write started here is not guaranteed to complete. pagehide/
// visibilitychange (NOT beforeunload, which mobile browsers routinely skip) is
// the right pair; the synchronous localStorage mirror is the write that always
// lands, so the pending record is at worst one debounce behind on next load.
function onHide(){
  if (saveTimer){ clearTimeout(saveTimer); saveTimer = 0; save({ reason:'pagehide' }); }
}
window.addEventListener('pagehide', onHide);
document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState === 'hidden') onHide(); });

// Read-only view of the current record, for export/diagnostics (phase 3).
export function snapshot(){ return raw ? JSON.parse(JSON.stringify(raw)) : null; }

// One line for the on-screen load readout (avatar.js). The phone has no DevTools,
// so this is the only way to see that the record is actually being written — and
// a failed save has to be visible for longer than a toast that the readout itself
// immediately overwrites.
export function summary(){
  if (!state.ready) return 'project not loaded';
  if (state.lastError) return 'project SAVE FAILED — ' + (state.lastError.message || state.lastError);
  const t = state.savedAt
    ? new Date(state.savedAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '—';
  const c = raw?.slices?.clips?.data;
  const n = Object.keys(c?.library || {}).length;
  const k = (c?.editKeys || []).length;
  return `project rev ${state.rev} · saved ${t} · ${n} clip${n===1?'':'s'}`
       + (k ? ` · ${k}-key draft` : '')
       + (state.persisted ? ' · persisted' : '')
       + (state.migratedFrom ? ` · migrated from ${state.migratedFrom}` : '');
}

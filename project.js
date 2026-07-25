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
import { settings, hooks, idbGet, idbPut, toast } from './core.js';

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
  lastError:null, lastSavedReason:null, migratedFrom:null,
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

// Clip library passthrough. ui.js still reads/writes localStorage['cb.clips']
// directly (phase 2 moves it onto a real slice owned by anim.js), so capture it
// verbatim each save — otherwise the record's copy would go stale the first time
// a clip is saved, and phase 2 would restore the stale one over the fresh one.
register({
  id:'clips', version:1,
  capture: ()=> { try { return JSON.parse(localStorage.getItem(LEGACY_CLIPS)) || {}; } catch(e){ return {}; } },
  apply: data => {
    // Only seed localStorage if it has nothing — never overwrite live clip work
    // with a record copy during phase 1's passthrough arrangement.
    try {
      if (data && Object.keys(data).length && !localStorage.getItem(LEGACY_CLIPS))
        localStorage.setItem(LEGACY_CLIPS, JSON.stringify(data));
    } catch(e){}
  },
});

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

function writeMirrorRev(rev){
  try { localStorage.setItem(REV_KEY, String(rev)); } catch(e){}
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

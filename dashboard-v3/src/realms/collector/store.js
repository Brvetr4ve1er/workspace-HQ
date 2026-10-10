// COLLECT store — app-lifetime state + the window.hq.media bridge. Subscribes
// ONCE at import (like the Summoning badge subscriber) so the rail badge stays
// live while the realm is unmounted; panes read `state` and listen on `cbus`.
// No bridge (v3 dev harness, parity shots) → `available` is false and the
// realm renders its calm "live app only" state; nothing here throws.
import { refreshBadges } from '../../core/shell.js';

export const api = (typeof window !== 'undefined' && window.hq && window.hq.media) || null;
export const available = !!api;

export const state = { info: null, settings: null, sources: [], queue: [], library: [], lastResult: null, savedThisSession: 0, ready: false, initError: null };

// realm-local pub/sub (the app bus stays free of collector chatter)
const subs = new Map();
export const cbus = {
  on(ev, fn) { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev)?.delete(fn); },
  emit(ev, p) { subs.get(ev)?.forEach((fn) => { try { fn(p); } catch (err) { console.error('[collector]', ev, err); } }); },
};

const ACTIVE = new Set(['running', 'queued', 'paused', 'conflict']);
export function badgeCount() { const n = state.queue.filter((j) => ACTIVE.has(j.status)).length; return n || null; }

export function queueSummary() {
  const q = state.queue, n = (s) => q.filter((j) => j.status === s).length;
  const live = q.filter((j) => j.status === 'running');
  const done = live.reduce((a, j) => a + (j.bytesDone || 0), 0), total = live.reduce((a, j) => a + (j.bytesTotal || 0), 0);
  return { active: n('running'), queued: n('queued') + n('paused') + n('conflict'), done: n('done'), failed: n('failed'), conflicts: n('conflict'), pct: total ? Math.round((done / total) * 100) : null };
}

const fail = (r) => r && typeof r === 'object' && !Array.isArray(r) && r.error;

let readyP = null;
export function ready() {
  if (!api) return Promise.resolve(false);
  if (readyP) return readyP;
  readyP = (async () => {
    const info = await api.info();
    if (fail(info)) { state.initError = info.error; return false; }   // engine did not start (see media-collector/index.js)
    const [settings, sources, queue] = await Promise.all([api.settingsGet(), api.sources(), api.queueList()]);
    state.info = info;
    state.settings = fail(settings) ? null : settings;
    state.sources = Array.isArray(sources) ? sources : [];
    state.queue = Array.isArray(queue) ? queue : [];
    await refreshLibrary();
    state.ready = true;
    refreshBadges();
    return true;
  })().catch((err) => { console.warn('[collector] init failed', err); state.initError = { code: 'SOURCE_UNAVAILABLE', message: 'The media collector is not responding.', detail: String(err && err.message || err).slice(0, 200), next: 'Restart WorkspaceHQ.' }; readyP = null; return false; });
  return readyP;
}

export async function refreshLibrary() {
  const items = await api.libraryList({});
  state.library = Array.isArray(items) ? items : [];
  cbus.emit('library', state.library);
  return state.library;
}

export async function saveSettings(patch) {
  const r = await api.settingsSet(patch);
  if (r && r.value) { state.settings = r.value; cbus.emit('settings', r.value); }
  return r || { value: state.settings, errors: {} };
}

export function setLastResult(r) { state.lastResult = r; cbus.emit('result', r); }

if (api) {
  api.onQueue((q) => {
    const before = new Set(state.queue.filter((j) => j.status === 'done').map((j) => j.id));
    state.queue = Array.isArray(q) ? q : [];
    const fresh = state.queue.filter((j) => j.status === 'done' && !before.has(j.id));
    if (fresh.length) { state.savedThisSession += fresh.length; refreshLibrary(); for (const j of fresh) cbus.emit('job:done', j); }
    cbus.emit('queue', state.queue);
    refreshBadges();
  });
  api.onJob((j) => {
    const i = state.queue.findIndex((x) => x.id === j.id);
    if (i !== -1) state.queue[i] = { ...state.queue[i], ...j };
    cbus.emit('job', j);
  });
  ready();
}

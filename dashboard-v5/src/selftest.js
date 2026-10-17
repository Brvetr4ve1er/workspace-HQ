// ?selftest=1 (loaded by boot.js; dev-main.js --selftest turns its last line
// into an exit code). Renders every combination the screen can be in —
// theme × time-machine end (live, oldest) × every tab and sub-tab plus the
// first project's page × every overlay, then preview states × theme × overlay
// on Home — and counts what broke:
//   errors      console.error calls, uncaught errors, unhandled rejections
//   unresolved  template bindings that never resolved (WHQ.unresolved, boot included)
//   failures    runtime render failures (WHQ.failures, boot included)
// Read-only by construction: it drives setState / go / openProject / setProps
// only and never touches window.hq. setState persists prefs and place, so
// those storage keys are snapshotted first and put back at the end.
import { NAV, SUBS } from './live/catalog.mjs';
import { TRAILERS } from './logic/whats-new.js';
import { gapsOf } from './live/adapter.mjs';

// + Ask's chat and sources (v3's keys, contract K-1): Ask saves them itself, so a combo must not leave its sample behind
const LOCAL_KEYS = ['whq3-prefs', 'hq-theme', 'hq-theme-migrated', 'hq-oracle-chat', 'hq-oracle-include', 'hq-claude-lib'], SESSION_KEYS = ['whq3-place'];
// every overlay closed; applied before each combo so combos never stack
const CLEAR = { paletteOpen: false, paletteMode: 'go', paletteQuery: '', paletteSel: 0, askOpen: false, runsOpen: false, scrubOpen: false, settingsOpen: false, cheatOpen: false, moreOpen: false, ambientOverlay: false, focus: null, confirm: null, commit: null, sheet: null, levelUp: null, onboard: null, lightbox: null, pageMore: false, whatsNewOpen: false, whatsNewMissing: {}, clSrc: 'all', clProj: '', clSince: 'all', clQuery: '', clSearched: false, clOpen: false, clExpanded: {}, clForgetAsk: false, clLinkPick: '',
  // Phase 3 surface state (app.js initState, contract K-4), back to its defaults before every combo
  sysExamining: false, sysSaves: {}, fixed: [], libKind: 'all', libSource: 'all', libSchool: 'all', libShow: 40, libRescanning: false, autoQuery: '',
  projSearch: '', projStatus: 'all', canvasNoteOpen: false, canvasDraft: '', canvasBoard: null, canvasSaving: false, askChecking: false, studioFilter: 'all' };
const RESTORE = Object.keys(CLEAR).concat(['tab', 'sub', 'route', 'snapOffset', 'themePref', 'sound', 'askHistory', 'askInclude', 'askDraft', 'confirmAsk', 'commitSel', 'diagTab', 'journalDraft']);
// Ask entries as logic/ask.js keeps them: { id, q, a: { text, status, meta (v3's), est } } (+ local / refusal)
const ASK_SEC = [{ id: 'scan', label: 'Scan', chars: 900, clipped: false }, { id: 'tasks', label: 'Tasks', chars: 400, clipped: true }, { id: 'vault', label: 'Vault', chars: 0, clipped: false, note: 'no matching notes' }];
const ASK = [
  { q: 'selftest question', id: 'selftest-ask', a: { text: 'Synthetic answer for the selftest.', status: 'done', meta: { status: 'done', sections: ASK_SEC, ms: 1400, model: 'selftest-model' }, est: true } },
  { q: 'selftest stopped', id: 'selftest-stop', a: { text: 'A partial answer that was', status: 'cancelled', meta: { status: 'cancelled', sections: ASK_SEC, ms: 900, model: 'selftest-model' }, est: true } },
  { q: 'selftest interrupted', id: 'selftest-int', a: { text: '', status: 'error', meta: { status: 'error', reason: 'interrupted — the window reloaded' }, est: false } },
  { q: 'selftest refused', id: 'selftest-ref', local: true, a: { text: 'The local model runtime isn’t running. Start Ollama, then ask again.', status: 'unavailable', meta: null, est: false, refusal: true } },
];
const ASK_STREAMING = [{ q: 'selftest streaming', id: 'selftest-live', a: { text: 'Streaming so f', status: 'thinking', meta: null, est: false } }];
// a 1x1 PNG: the recovered sample recording's thumbnail (data: is allowed by the CSP's img-src)
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// One render = the queued flush (a microtask) + a frame for refs, animations
// and custom elements. A hidden window may get ~1 frame a second, so a 60 Hz
// frame's worth of time stands in when rAF doesn't come.
const frame = () => new Promise((res) => { let done = false; const fin = () => { if (!done) { done = true; res(); } }; requestAnimationFrame(fin); setTimeout(fin, 16); });
const rendered = () => new Promise((res) => queueMicrotask(res)).then(frame);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const short = (a) => a.map((x) => (x && x.stack) || (x && x.message) || String(x)).join(' ').slice(0, 400);

function snapshot(store, keys) { const o = {}; for (const k of keys) { try { o[k] = store.getItem(k); } catch { o[k] = null; } } return o; }
function restore(store, saved) { for (const [k, v] of Object.entries(saved)) { try { if (v == null) store.removeItem(k); else store.setItem(k, v); } catch {} } }

export async function run(W = window.WHQ) {
  const t0 = performance.now();
  const stats = { combos: 0, errors: 0 };
  const samples = [], holes = new Map();
  let label = 'start';
  const note = (kind, args) => { stats.errors++; if (samples.length < 25) samples.push(label + ' · ' + kind + ' · ' + short(args)); };
  const origError = console.error;
  console.error = function (...a) { note('console.error', a); return origError.apply(this, a); };
  const onError = (e) => note('error', [e.error || e.message]);
  const onRejection = (e) => note('unhandledrejection', [e.reason]);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const savedLocal = snapshot(localStorage, LOCAL_KEYS), savedSession = snapshot(sessionStorage, SESSION_KEYS);
  const L = W && W.app && W.app.logic;
  if (W) for (const k of W.unresolved) holes.set(k, 'boot');
  const initial = {}, initialProps = {};
  try {
    if (!L) throw new Error('no mounted app (WHQ.app is null)');
    for (const k of RESTORE) initial[k] = L.state[k];
    for (const k of ['previewState', 'errorText']) initialProps[k] = L.props[k];
    const M = W.store.model;
    const combo = async (name, drive) => {
      label = name;
      drive();
      await rendered();
      stats.combos++;
      for (const k of W.unresolved) if (!holes.has(k)) holes.set(k, name);
    };

    L.setState({ sound: false });   // no chiptune blips for a thousand tab switches (restored below)
    await rendered(); await sleep(300);   // let boot reads land first

    const views = [];
    for (const n of NAV) for (const s of SUBS[n.id] || [[undefined]]) views.push({ tab: n.id, sub: s[0], name: n.id + (s[0] ? '/' + s[0] : '') });
    const proj = (M.P0[0] || {}).id;
    if (proj) views.push({ tab: 'projects', sub: 'grid', project: proj, name: 'project-page' });
    const open = typeof L.openTasks === 'function' ? L.openTasks(0) : M.T0;
    const auto = M.AUTOS[0];
    const overlays = [
      ['none', {}],
      ['palette-go', { paletteOpen: true, paletteMode: 'go' }],
      ['palette-ask', { paletteOpen: true, paletteMode: 'ask' }],
      ['ask', { askOpen: true, askHistory: ASK }],
      ['runs', { runsOpen: true }],
      ['scrub', { scrubOpen: true }],
      ['settings', { settingsOpen: true }],
      ['cheat', { cheatOpen: true }],
      ['focus', { focus: { taskId: open[0] ? open[0].id : null, start: Date.now() } }],
      auto && ['confirm', { confirm: auto.id, confirmAsk: 'always' }],
      proj && ['commit', { commit: { pid: proj, files: [{ name: 'src/a.js', st: 'mod', on: true }], stat: '', loading: false, msg: 'x', drafted: '' }, commitSel: 0 }],
      ['sheet', { sheet: { title: 't', body: 'b', ok: 'ok', danger: true } }],
      ['levelUp', { levelUp: { l: 5, t: 'Foreman' } }],
      // What's new · trailers: as this build bundles them, then every trailer failed to play (the text fallback)
      ['whats-new', { whatsNewOpen: true }],
      ['whats-new-fallback', { whatsNewOpen: true, whatsNewMissing: Object.fromEntries(TRAILERS.map((t) => [t.id, true])) }],
      ['whats-new-over-settings', { settingsOpen: true, whatsNewOpen: true }],
      ...[1, 2, 3].map((step) => ['onboard-' + step, { onboard: { step, path: '', dev: 'npm run dev', branch: 'main', name: '' } }]),
    ].filter(Boolean);
    const offsets = M.maxOff > 0 ? [0, M.maxOff] : [0];
    const base = { askHistory: initial.askHistory };

    for (const theme of ['dark', 'light']) {
      for (const off of offsets) {
        for (const v of views) {
          for (const [ov, patch] of overlays) {
            await combo([theme, 'off' + off, v.name, ov].join(' '), () => {
              L.go(v.tab, v.sub);
              if (v.project) L.openProject(v.project);
              L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: off }, patch));
            });
          }
        }
      }
    }
    // Phase 3 states the cross product above doesn't reach: one view each, both themes, both
    // time-machine ends. A few need sample rows the owner's data may lack; those go into the
    // STORE (store.live, never window.hq) and are put back below.
    const LV = W.store.live, savedLive = { captures: LV.captures, canvasBoards: LV.canvasBoards, llm: LV.llm, claudeHub: LV.claudeHub, claudeLib: LV.claudeLib };
    try {
      const at = (tab, sub, project) => ({ tab, sub, project });
      const clutter = (M.CLUTTER || []).find((c) => c.rows && c.rows.length);
      const cleanText = clutter ? 'Clean up: ' + clutter.rows[0].label : '';
      const gapP = M.P0.find((p) => gapsOf(p).length);
      const gapText = gapP ? gapsOf(gapP)[0].text : '';
      const inter = (M.INTERACTIVE || [])[0];
      const board = () => { LV.canvasBoards = [{ name: 'Selftest Board', nodes: [], edges: [] }]; };
      // H1 Claude Hub card (System > Machine): every state the Hub can be in, injected into the store (never window.hq).
      // The card shows only with a bridge: dev-main.js --preload=fake, or the real app (without one these render it hidden).
      const HUB_COUNTS = { projects: 3, conversations: 40, messages: 900 };
      const HUB = [
        ['none', null],
        ['indexing', { state: 'indexing', role: 'writer', backfill: { done: 8, total: 32 }, counts: HUB_COUNTS, dbBytes: 5 * 1048576 }],
        ['ready', { state: 'ready', role: 'writer', backfill: { done: 32, total: 32 }, counts: HUB_COUNTS, dbBytes: 2048 }],
        ['reader', { state: 'ready', role: 'reader', counts: { projects: 0, conversations: 0, messages: 0 } }],
        ['no-node', { state: 'no-node', node: 'v20.1.0', error: 'Claude Hub needs Node 22.13 or newer (found v20.1.0)' }],
        ['down', { state: 'down', error: 'Claude Hub exited (1)' }],
      ];
      // H2 Claude › Chats: sample Hub rows go into the store (never window.hq); cl* state is patched per combo.
      const CL_READY = { state: 'ready', role: 'writer', counts: HUB_COUNTS };
      const CL_CONVS = [
        { id: 'code:selftest-a', title: 'Selftest chat A', source: 'code', project_id: 'p1', project_name: 'project-a', last_at: new Date(Date.now() - 3600000).toISOString(), message_count: 4, tokens_in: 1200, tokens_out: 800 },
        { id: 'code:selftest-b', title: 'Selftest chat B', source: 'web', project_id: 'p1', project_name: 'project-a', last_at: new Date(Date.now() - 86400000).toISOString(), message_count: 2 },
      ];
      const CL_THREAD = { conversation: { id: 'code:selftest-a', title: 'Selftest chat A', project_name: 'project-a', cwd: null, active_ms: 120000 }, hasMore: true, messages: [
        { id: 'm1', role: 'user', at: new Date().toISOString(), text: 'Hello <b>not html</b>' },
        { id: 'm2', role: 'tool', at: new Date().toISOString(), text: 'tool output' },
        { id: 'm3', role: 'assistant', at: new Date().toISOString(), text: 'Hi' },
      ] };
      const clLib = (o) => () => { LV.claudeHub = CL_READY; LV.claudeLib = { projects: [{ id: 'p1', name: 'project-a', conversations: 2 }], convs: CL_CONVS, convsMore: true, filters: {}, q: '', hits: null, noTerms: false, thread: null, stats: null, error: null, busy: false, ...o }; };
      const STATES = [
        ['ask-empty', at('home'), { askOpen: true, askHistory: [] }],
        ['ask-streaming', at('home'), { askOpen: true, askHistory: ASK_STREAMING }],
        ['ask-offline', at('home'), { askOpen: true, askHistory: [] }, () => { LV.llm = { available: false, reason: 'selftest: runtime down' }; }],
        ['ask-offline-checking', at('home'), { askOpen: true, askChecking: true, askHistory: [] }, () => { LV.llm = { available: true, runtime: 'selftest', chatModel: null }; }],
        ['palette-capture', at('home'), { paletteOpen: true, paletteMode: 'go', paletteQuery: 'capture A selftest idea' }],
        ['system-examining', at('system', 'machine'), { sysExamining: true }],
        ['system-fixed', at('system', 'machine'), { fixed: M.ISSUES.map((i) => i.id).concat(['llm']) }],
        ...HUB.map(([n, h]) => ['hub-' + n, at('system', 'machine'), {}, () => { LV.claudeHub = h; }]),
        ...['saving', 'noted', 'failed'].map((st) => cleanText && ['clutter-' + st, at('system', 'clutter'), { sysSaves: { [cleanText]: st } }]),
        ['project-security', at('projects', 'grid', (M.P0[0] || {}).id), { diagTab: 'security' }],
        ...['saving', 'noted', 'failed'].map((st) => gapP && ['project-gaps-' + st, at('projects', 'grid', gapP.id), { sysSaves: { [gapText]: st } }]),
        ['auto-interactive', at('automations', 'runnable'), { libKind: 'interactive' }],
        ['auto-skills', at('automations', 'runnable'), { libSource: 'skill', libShow: 400 }],
        ['auto-category', at('automations', 'runnable'), { libSchool: (M.AUTOS[0] || {}).cat || 'Other' }],
        ['auto-none', at('automations', 'runnable'), { autoQuery: 'zzz-selftest-none' }],
        ['auto-rescanning', at('automations', 'runnable'), { libRescanning: true }],
        inter && ['confirm-interactive', at('automations', 'runnable'), { confirm: inter.id, confirmAsk: 'always' }],
        ['projects-risk', at('projects', 'grid'), { projStatus: 'risk' }],
        ['projects-none', at('projects', 'grid'), { projSearch: 'zzz-selftest-none' }],
        ['canvas-note', at('claude', 'canvas'), { canvasNoteOpen: true, canvasDraft: 'A selftest note' }, board],
        ['canvas-note-saving', at('claude', 'canvas'), { canvasNoteOpen: true, canvasDraft: 'A selftest note', canvasSaving: true }, board],
        ['chats-list', at('claude', 'chats'), {}, clLib({})],
        ['chats-empty-nobridge', at('claude', 'chats'), {}, () => { LV.claudeHub = null; LV.claudeLib = { ...LV.claudeLib, convs: null }; }],
        ['chats-filtered-none', at('claude', 'chats'), { clSrc: 'web', clSince: '7' }, clLib({ convs: [], convsMore: false })],
        ['chats-search-hits', at('claude', 'chats'), { clSearched: true, clQuery: 'img' }, clLib({ q: 'img', hits: [{ conversationId: 'code:selftest-a', messageId: 'm1', title: 'Selftest chat A', at: new Date().toISOString(), snippet: 'a \u0002<img src=x>\u0003 b' }] })],
        ['chats-search-none', at('claude', 'chats'), { clSearched: true, clQuery: 'zzz' }, clLib({ q: 'zzz', hits: [] })],
        ['chats-thread', at('claude', 'chats'), { clOpen: true }, clLib({ thread: CL_THREAD })],
        ['chats-thread-tool-open', at('claude', 'chats'), { clOpen: true, clExpanded: { m2: true } }, clLib({ thread: CL_THREAD })],
        ['chats-forget-ask', at('claude', 'chats'), { clOpen: true, clForgetAsk: true }, clLib({ thread: CL_THREAD })],
        ['chats-thread-gone', at('claude', 'chats'), { clOpen: true }, clLib({ thread: { missing: 'code:x' } })],
        ['chats-error', at('claude', 'chats'), {}, clLib({ error: 'Claude Hub: selftest error' })],
        // Task 11: the brief's cl-* combos (hostile snippet, Projects link pick, History activity, project-page section)
        ['cl-chats-empty', at('claude', 'chats'), {}, clLib({ convs: [], convsMore: false })],
        ['cl-chats-rows', at('claude', 'chats'), {}, clLib({})],
        ['cl-chats-hits-hostile', at('claude', 'chats'), { clSearched: true, clQuery: 'img' }, clLib({ q: 'img', hits: [{ conversationId: 'code:selftest-a', messageId: 'm', title: 'Selftest chat A', at: new Date().toISOString(), snippet: '\u0002<img src=x onerror=alert(1)>\u0003 tail \u0002open' }] })],
        ['cl-thread-open', at('claude', 'chats'), { clOpen: true }, clLib({ thread: CL_THREAD })],
        ['cl-thread-forget-ask', at('claude', 'chats'), { clOpen: true, clForgetAsk: true, clExpanded: { m2: true } }, clLib({ thread: CL_THREAD })],
        ['cl-projects', at('claude', 'projects'), { clLinkPick: 'p1' }, clLib({ projects: [{ id: 'p1', name: 'project-a', path: 'C:\placeholder\project-a', conversations: 2, last_at: CL_CONVS[0].last_at, hq_project_id: (M.P0[0] || {}).id || null, link_state: 'auto' }] })],
        ['cl-history-activity', at('history', 'trends'), {}, clLib({ stats: { from: '2026-09-06', to: '2026-10-05', tzOffsetMin: 0, days: [{ day: '2026-10-04', chats: 1, messages: 3, active_ms: 60000 }], projects: [{ project_id: 'p1', name: 'project-a', chats: 1, tokens_in: 5, tokens_out: 9, tokens_cache_read: 0, tokens_cache_write: 0 }], totals: { chats: 1, active_ms: 60000, tokens_in: 5, tokens_out: 9, tokens_cache_read: 0, tokens_cache_write: 0 } } })],
        M.P0[0] && ['cl-page-chats', at('projects', 'grid', M.P0[0].id), {}, () => { clLib({})(); LV.claudeLib.byHq = { [M.P0[0].id]: CL_CONVS }; }],
        ['canvas-no-boards', at('claude', 'canvas'), { canvasNoteOpen: true }, () => { LV.canvasBoards = []; }],
      ].filter(Boolean);
      for (const theme of ['dark', 'light']) {
        for (const off of offsets) {
          for (const [name, v, patch, live] of STATES) {
            await combo([theme, 'off' + off, 'p3:' + name].join(' '), () => {
              Object.assign(LV, savedLive);
              if (live) live();
              L.go(v.tab, v.sub);
              if (v.project) L.openProject(v.project);
              L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: off }, patch));
            });
          }
        }
        // Studio with captures: real files only (a missing file logs an error-level load
        // failure). The snip is the app icon; the "recording" points at that same PNG, which
        // a <video> can't decode: the lightbox's "couldn't load" path. It has a thumbnail.
        Object.assign(LV, savedLive);
        L.go('studio'); L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }));
        await rendered(); await sleep(250);   // the tab change's refreshCaptures lands before the sample rows go in
        const icon = decodeURIComponent(new URL('icons/hq-256.png', location.href).pathname).replace(/^\/([A-Za-z]:)/, '$1');
        const now = Date.now();
        const caps = [
          { id: icon, path: icon, kind: 'snip', recovered: false, name: 'selftest-snip.png', day: 'Today', time: '09:00', size: '1 KB', thumb: null, mtime: now },
          { id: icon + '#rec', path: icon, kind: 'rec', recovered: true, name: 'selftest-rec.webm', day: 'Today', time: '08:00', size: '2 MB', thumb: PIXEL, mtime: now - 3600000 },
        ];
        for (const [name, patch] of [['studio-all', {}], ['studio-rec', { studioFilter: 'rec' }], ['lightbox-snip', { lightbox: caps[0].id }], ['lightbox-rec', { lightbox: caps[1].id }]]) {
          await combo([theme, 'p3:' + name].join(' '), () => {
            LV.captures = caps;
            L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }, patch));
          });
          await sleep(80);   // this combo's image / video load and error events fire inside it
        }
      }
    } finally {
      Object.assign(LV, savedLive);
    }

    // preview states (loading / error / nobridge / live) only change the shell and body
    for (const state of ['loading', 'error', 'nobridge', 'live']) {
      for (const theme of ['dark', 'light']) {
        for (const [ov, patch] of overlays) {
          await combo(['state:' + state, theme, ov].join(' '), () => {
            W.app.setProps({ previewState: state, errorText: state === 'error' ? 'selftest: synthetic error text' : initialProps.errorText });
            L.go('home');
            L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }, patch));
          });
        }
      }
    }
    await sleep(300);   // stragglers: timers and frames the last combos queued
  } catch (e) {
    note('selftest crashed', [e]);
  } finally {
    // the app first (its componentDidUpdate rewrites prefs + place), then storage
    label = 'restore';
    try {
      if (L) {
        W.app.setProps(initialProps);
        L.setState(initial);
        await rendered();
      }
    } catch (e) { note('restore failed', [e]); }
    restore(localStorage, savedLocal); restore(sessionStorage, savedSession);
    console.error = origError;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }
  const summary = { combos: stats.combos, errors: stats.errors, unresolved: W ? W.unresolved.size : -1, failures: W && W.failures ? W.failures.count : -1 };
  const detail = { ms: Math.round(performance.now() - t0), samples, holes: [...holes].map(([k, at]) => k + ' @ ' + at), lastFailure: W && W.failures ? W.failures.last : '' };
  window.__selftestDetail = detail;
  console.log('[selftest:detail] ' + JSON.stringify(detail));
  console.log('[selftest] ' + JSON.stringify(summary));
  window.__selftest = summary;
  return summary;
}

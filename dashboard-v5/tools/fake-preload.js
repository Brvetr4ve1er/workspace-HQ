// A recording fake of window.hq for the v5 dev harness (dev-main.js --preload=fake).
// It exposes every method dashboard/preload.js exposes, with the same nesting,
// so the renderer runs its real code paths with nothing behind them:
//  - every call is recorded as {method, args, at} (functions → '[function]')
//  - writes resolve true and do nothing; reads resolve canned shapes that
//    live/adapter.mjs accepts (mostly empty)
//  - push channels keep their callbacks HERE, in the preload world, and fire
//    them on window.hqFake.emit(channel, payload); the channel is the IPC name
//    ('hq:scan-status') or the method path ('onScanStatus', 'llm.onDelta',
//    'studio.onCaptureAdded'). Callbacks and disposers cross contextBridge as
//    proxies, so storing them here and calling them later works.
// window.hqFake = {
//   calls(method?)        recorded calls (copies), optionally for one method path
//   reset(all?)           clear the log + sequences (castSpell, pending chats); all=true also drops set() overrides and prefs
//   emit(channel, data)   push to that channel's subscribers; returns how many were called
//   set(method, value)    from now on that method returns `value` (copied); a function is called with the args;
//                         {__reject:'msg'} rejects; undefined restores the default
// }
// Canned specials: castSpell asks for confirmation on its first call
// ({confirm_required, preview:{content_hash:'fake-hash-2'}}) and then returns {castId:'c-fake'};
// llm.chat streams three accumulated deltas 100 ms apart through llm.onDelta, then resolves.
'use strict';

const WRITE = 'write', SEND = 'send';

function createFake() {
  const log = [];
  const subs = new Map();        // channel → Set(callback)
  const alias = new Map();       // method path → channel
  const overrides = new Map();   // method path → value
  const chats = new Map();       // jobId → {timers, resolve}
  const DEFAULT_PREFS = { theme: 'dark', resolved: 'dark', reduceMotion: false };
  let prefs = { ...DEFAULT_PREFS }, casts = 0;

  // cloneable copy of what crossed the bridge (contextBridge can't copy functions back out)
  const clean = (v, d = 0) => {
    if (typeof v === 'function') return '[function]';
    if (v == null || typeof v !== 'object') return v;
    if (d > 6) return '[deep]';
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return '[bytes ' + v.byteLength + ']';
    if (Array.isArray(v)) return v.map((x) => clean(x, d + 1));
    const o = {};
    for (const k of Object.keys(v)) o[k] = clean(v[k], d + 1);
    return o;
  };
  const record = (method, args) => { log.push({ method, args: clean(args), at: Date.now() }); };
  const push = (channel, payload) => {
    let n = 0;
    for (const cb of [...(subs.get(channel) || [])]) {
      try { cb(payload); n++; } catch (e) { console.error('[hqFake] a ' + channel + ' subscriber threw:', e); }
    }
    return n;
  };

  // ---- the stateful canned answers ----
  const chat = (req) => new Promise((resolve) => {
    const jobId = req && req.jobId, parts = ['Fake', 'Fake answer', 'Fake answer from the fake model.'];
    const job = { resolve, timers: [] };
    if (jobId) chats.set(jobId, job);
    parts.forEach((text, i) => job.timers.push(setTimeout(() => {
      push('hq:llm:delta', { jobId, text });   // main sends the accumulated text, not the increment
      if (i === parts.length - 1) {
        chats.delete(jobId);
        resolve({ status: 'done', output: text, sections: [{ label: 'Scan', chars: 10 }], model: 'fake-model', ms: 300 });
      }
    }, 100 * (i + 1))));
  });
  const cancelChat = (jobId) => {
    const j = chats.get(jobId);
    if (j) { j.timers.forEach(clearTimeout); chats.delete(jobId); j.resolve({ status: 'cancelled', output: '' }); }
    return true;
  };
  const cast = () => (casts++ === 0 ? { confirm_required: true, preview: { content_hash: 'fake-hash-2' } } : { castId: 'c-fake' });
  const setPrefs = (patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    const next = { ...prefs };
    if (['dark', 'light', 'os'].includes(p.theme)) next.theme = p.theme;
    if (typeof p.reduceMotion === 'boolean') next.reduceMotion = p.reduceMotion;
    next.resolved = next.theme === 'light' ? 'light' : 'dark';   // the fake has no OS theme: 'os' resolves dark
    prefs = next;
    setTimeout(() => push('hq:ui-prefs', prefs), 0);   // main broadcasts after answering
    return prefs;
  };

  // [method path, kind]: WRITE resolves true · SEND returns undefined · 'on:<channel>'
  // subscribes · a function is the canned answer. Mirrors dashboard/preload.js
  // top to bottom (tools/cdp-gate.mjs --scenario fake-parity diffs the two).
  const SPEC = [
    ['runScan', WRITE], ['openRepo', WRITE], ['openFile', WRITE], ['reclaim', WRITE], ['snapshot', WRITE],
    ['captureSave', WRITE], ['claudeQuest', WRITE],
    ['draftCommit', () => ({ message: 'chore: fake draft', via: 'local:fake' })], ['doCommit', WRITE],
    ['probeLlm', () => ({ available: true, runtime: 'fake', chatModel: 'fake-model' })],
    ['llm.warm', WRITE], ['llm.chat', chat], ['llm.cancel', cancelChat], ['llm.onDelta', 'on:hq:llm:delta'],
    ['uiPrefs.get', () => prefs], ['uiPrefs.set', setPrefs], ['uiPrefs.on', 'on:hq:ui-prefs'],
    ['liveState', () => ({ dev: [], casts: [], scan: { state: 'idle' } })], ['onScanStatus', 'on:hq:scan-status'],
    ['openAt', WRITE], ['onNavigate', 'on:hq:navigate'],
    ['commitPreview', () => ({
      files: [{ path: 'src/a.js', status: 'M', env: false }, { path: 'sub/.env', status: '??', env: true }, { path: '.env.example', status: '??', env: false }],
      stat: ' src/a.js | 2 +-', envHits: ['sub/.env'], branch: 'main',
    })],
    ['logDecision', WRITE], ['learn', WRITE], ['archiveProject', WRITE], ['reviveProject', WRITE], ['markQuestDone', WRITE], ['actedOn', WRITE],
    ['healthScan', () => ({ organs: [] })], ['healthFix', WRITE],
    ['getSocial', () => ({ accounts: { accounts: [] }, outbox: { actions: [] }, inbox: { events: [] } })],
    ['getCanvas', () => []], ['canvasAdd', WRITE], ['onCanvas', 'on:hq:canvas'],
    ['getSessions', () => []], ['sessionStart', () => ({ jobId: 'j-fake' })], ['sessionKill', WRITE],
    ['sessionDiff', () => ({ files: [], stat: '' })], ['onSessionOutput', 'on:hq:session-output'], ['onClaudeSessions', 'on:hq:claude-sessions'],
    ['devStart', WRITE], ['devStop', WRITE], ['saveNote', WRITE], ['onDevStatus', 'on:hq:dev-status'],
    ['castSpell', cast], ['cancelCast', WRITE], ['getSpellbook', () => ({ spells: [] })], ['favoriteSpell', WRITE], ['rescanSpellbook', WRITE],
    ['getSpellTelemetry', () => ({ casts: [], favorites: [], confirmed_hashes: {} })], ['hideCastPalette', WRITE],
    ['onCastOutput', 'on:hq:cast-output'], ['onCastDone', 'on:hq:cast-done'],
    ['shardSummon', WRITE], ['shardSummonCancel', WRITE], ['shardClose', WRITE], ['shardSave', WRITE],
    ['shardLibSpawn', WRITE], ['shardLibDelete', WRITE], ['shardRegen', WRITE], ['onShardInit', 'on:shard:init'],
    ['getMiniData', () => null], ['showMain', WRITE], ['miniHide', WRITE], ['killServers', WRITE],
    ['onMiniUpdate', 'on:hq:mini-update'], ['onMachine', 'on:hq:machine'],
    ['getBrowserLive', () => null], ['onBrowserTab', 'on:hq:browser-tab'],
    ['studio.panelToggle', WRITE], ['studio.snipArm', WRITE], ['studio.snipCommit', SEND], ['studio.snipCancel', SEND],
    ['studio.recSources', () => []], ['studio.recStart', WRITE], ['studio.recChunk', SEND], ['studio.recStop', WRITE],
    ['studio.recAbort', SEND], ['studio.recToggle', WRITE], ['studio.recPause', SEND], ['studio.panelMode', WRITE],
    ['studio.onRecCommand', 'on:hq:studio:rec-command'],
    ['studio.libraryList', () => []], ['studio.libraryReveal', WRITE], ['studio.libraryDelete', WRITE],
    ['studio.settingsGet', () => ({})], ['studio.settingsSet', WRITE],
    ['studio.recStatus', 'on:hq:studio:rec-status'], ['studio.onCaptureAdded', 'on:studio:capture-added'],
    ['studio.onSnipFrozen', 'on:hq:studio:snip-frozen'], ['studio.onOpenRealm', 'on:hq:studio:open-realm'],
  ];

  const answer = (method, kind, args) => {
    try {
      if (overrides.has(method)) {
        const v = overrides.get(method);
        if (typeof v === 'function') return Promise.resolve(v(...args));
        if (v && typeof v === 'object' && '__reject' in v) return Promise.reject(new Error(String(v.__reject)));
        return Promise.resolve(v);
      }
      return Promise.resolve(kind === WRITE ? true : kind(...args));
    } catch (e) { return Promise.reject(e); }
  };
  const make = (method, kind) => {
    if (typeof kind === 'string' && kind.startsWith('on:')) {
      const channel = kind.slice(3);
      alias.set(method, channel);
      return (cb) => {
        record(method, [cb]);
        if (typeof cb !== 'function') return () => {};
        if (!subs.has(channel)) subs.set(channel, new Set());
        subs.get(channel).add(cb);
        return () => { subs.get(channel).delete(cb); };
      };
    }
    if (kind === SEND) return (...args) => { record(method, args); };
    return (...args) => { record(method, args); return answer(method, kind, args); };
  };

  const hq = {};
  for (const [method, kind] of SPEC) {
    const keys = method.split('.');
    let o = hq;
    for (const k of keys.slice(0, -1)) o = o[k] || (o[k] = {});
    o[keys[keys.length - 1]] = make(method, kind);
  }

  const control = {
    calls: (method) => log.filter((c) => !method || c.method === method).map((c) => ({ ...c })),
    reset: (all) => {
      log.length = 0; casts = 0;
      for (const id of [...chats.keys()]) cancelChat(id);
      if (all) { overrides.clear(); prefs = { ...DEFAULT_PREFS }; }
      return true;
    },
    emit: (channel, payload) => push(alias.get(channel) || channel, payload),
    set: (method, value) => {
      if (!SPEC.some(([m]) => m === method)) throw new Error('hqFake.set: no such method ' + method);
      if (value === undefined) overrides.delete(method); else overrides.set(method, value);
      return true;
    },
  };
  return { hq, control, methods: SPEC.map(([m]) => m) };
}

// In the renderer's preload world: expose both. Under plain Node (no Electron)
// this file only exports the factory.
let electron = null;
try { electron = require('electron'); } catch {}
if (electron && typeof electron === 'object' && electron.contextBridge) {
  const fake = createFake();
  electron.contextBridge.exposeInMainWorld('hq', fake.hq);
  electron.contextBridge.exposeInMainWorld('hqFake', fake.control);
}
if (typeof module === 'object' && module && module.exports) module.exports = { createFake };

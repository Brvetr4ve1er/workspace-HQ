// Secure bridge: exposes a minimal, allow-listed API to the dashboard renderer.
// contextIsolation is on and nodeIntegration off, so the UI can only call these.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hq', {
  runScan: () => ipcRenderer.invoke('hq:scan'),
  openRepo: (relPath) => ipcRenderer.invoke('hq:open-repo', relPath),
  openFile: (projPath, fileRel) => ipcRenderer.invoke('hq:open-file', projPath, fileRel),
  reclaim: (projPath, dirNames) => ipcRenderer.invoke('hq:reclaim', projPath, dirNames),
  snapshot: (projPath, name) => ipcRenderer.invoke('hq:snapshot', projPath, name),
  captureSave: (text) => ipcRenderer.invoke('hq:capture-save', text),
  captureCancel: () => ipcRenderer.invoke('hq:capture-cancel'),
  claudeQuest: (projPath, prompt) => ipcRenderer.invoke('hq:claude-quest', projPath, prompt),
  draftCommit: (projPath) => ipcRenderer.invoke('hq:draft-commit', projPath),
  doCommit: (projPath, msg) => ipcRenderer.invoke('hq:do-commit', projPath, msg),
  // PC-Brain Phase 0/1: presence-check for a local LLM runtime (Ollama/LM Studio)
  probeLlm: () => ipcRenderer.invoke('hq:llm:probe'),
  logDecision: (projId, text) => ipcRenderer.invoke('hq:log-decision', projId, text),
  learn: (projId, text) => ipcRenderer.invoke('hq:learn', projId, text),
  archiveProject: (id) => ipcRenderer.invoke('hq:archive-project', id),
  reviveProject: (id) => ipcRenderer.invoke('hq:revive-project', id),
  orphanArchive: (p) => ipcRenderer.invoke('hq:orphan-archive', p),
  markQuestDone: (id) => ipcRenderer.invoke('hq:quest-done', id),
  actedOn: (entry) => ipcRenderer.invoke('hq:acted-on', entry),
  getActedOn: () => ipcRenderer.invoke('hq:acted-on-read'),
  // M2: MED-BAY — live PC-health scan + whitelisted safe fix runner
  healthScan: () => ipcRenderer.invoke('hq:health-scan'),
  healthFix: (command) => ipcRenderer.invoke('hq:health-fix', command),
  // M3: THE CANVAS — shared JSON Canvas boards, fs-watched live
  getSocial: () => ipcRenderer.invoke('hq:social-read'),

  getCanvas: () => ipcRenderer.invoke('hq:canvas-read'),
  canvasAdd: (name, node) => ipcRenderer.invoke('hq:canvas-add', name, node),
  onCanvas: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:canvas', handler);
    return () => ipcRenderer.removeListener('hq:canvas', handler);
  },
  // MA: Claude session presence (registry in claude-sessions.js)
  getSessions: () => ipcRenderer.invoke('hq:sessions-list'),
  // v4 SPINE B3: session dispatch/kill/diff + output stream (session-api.js)
  sessionStart: (opts) => ipcRenderer.invoke('hq:session-start', opts),
  sessionKill: (jobId) => ipcRenderer.invoke('hq:session-kill', jobId),
  sessionDiff: (opts) => ipcRenderer.invoke('hq:session-diff', opts),
  onSessionOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:session-output', handler);
    return () => ipcRenderer.removeListener('hq:session-output', handler);
  },
  onClaudeSessions: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:claude-sessions', handler);
    return () => ipcRenderer.removeListener('hq:claude-sessions', handler);
  },
  devStart: (id) => ipcRenderer.invoke('hq:dev-start', id),
  devStop: (id) => ipcRenderer.invoke('hq:dev-stop', id),
  saveNote: (id, note) => ipcRenderer.invoke('hq:note-save', id, note),
  onDevStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:dev-status', handler);
    return () => ipcRenderer.removeListener('hq:dev-status', handler);
  },
  // casting engine bridge (Spellbook)
  castSpell: (id, confirmedHash, opts) => ipcRenderer.invoke('hq:spell-cast', id, confirmedHash, opts),
  cancelCast: (id) => ipcRenderer.invoke('hq:spell-cancel', id),
  getSpellbook: () => ipcRenderer.invoke('hq:spellbook-get'),
  favoriteSpell: (id) => ipcRenderer.invoke('hq:spell-favorite', id),
  rescanSpellbook: () => ipcRenderer.invoke('hq:spellbook-rescan'),
  getSpellTelemetry: () => ipcRenderer.invoke('hq:spell-telemetry'),
  hideCastPalette: () => ipcRenderer.invoke('hq:cast-palette-hide'),
  onCastOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:cast-output', handler);
    return () => ipcRenderer.removeListener('hq:cast-output', handler);
  },
  onCastDone: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:cast-done', handler);
    return () => ipcRenderer.removeListener('hq:cast-done', handler);
  },
  // organic UI (shards): summon palette + shard self-service
  shardSummon: (text) => ipcRenderer.invoke('hq:shard-summon', text),
  shardSummonCancel: () => ipcRenderer.invoke('hq:shard-summon-cancel'),
  shardClose: () => ipcRenderer.invoke('hq:shard-close'),
  shardSave: (patch) => ipcRenderer.invoke('hq:shard-save', patch),
  shardLibSpawn: (key) => ipcRenderer.invoke('hq:shard-lib-spawn', key),
  shardLibDelete: (key) => ipcRenderer.invoke('hq:shard-lib-delete', key),
  shardRegen: () => ipcRenderer.invoke('hq:shard-regen'),
  onShardInit: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('shard:init', handler);
    return () => ipcRenderer.removeListener('shard:init', handler);
  },
  // mini HUD bridge
  getMiniData: () => ipcRenderer.invoke('hq:mini-data'),
  showMain: () => ipcRenderer.invoke('hq:show-main'),
  miniHide: () => ipcRenderer.invoke('hq:mini-hide'),
  killServers: () => ipcRenderer.invoke('hq:kill-servers'),
  onMiniUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:mini-update', handler);
    return () => ipcRenderer.removeListener('hq:mini-update', handler);
  },
  onMachine: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:machine', handler);
    return () => ipcRenderer.removeListener('hq:machine', handler);
  },
  // browser bridge: live active-tab ticker from the WorkspaceHQ Bridge extension
  getBrowserLive: () => ipcRenderer.invoke('hq:browser-live'),
  onBrowserTab: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:browser-tab', handler);
    return () => ipcRenderer.removeListener('hq:browser-tab', handler);
  },
  // v3 STUDIO (Group 1): snip / record / library / settings + the two
  // subscriptions realm and panel need to stay live. Panel-internal helpers
  // (recSources / recStart / recChunk / recStop / recAbort / snipCommit /
  // snipCancel / onSnipFrozen) are exposed here too because they need the
  // same allow-listed contextBridge surface.
  studio: {
    panelToggle: () => ipcRenderer.invoke('hq:studio:panel-toggle'),
    snipArm: (kind) => ipcRenderer.invoke('hq:studio:snip-arm', { kind }),
    snipCommit: (payload) => ipcRenderer.send('hq:studio:snip-commit', payload),
    snipCancel: () => ipcRenderer.send('hq:studio:snip-cancel'),
    recSources: () => ipcRenderer.invoke('hq:studio:rec-sources'),
    recStart: (opts) => ipcRenderer.invoke('hq:studio:rec-start', opts),
    // MediaRecorder chunks come through as ArrayBuffer; contextBridge clones
    // them across the isolation boundary. Pass through untouched.
    recChunk: (recId, seq, buf) => ipcRenderer.send('hq:studio:rec-chunk', { recId, seq, buf }),
    recStop: (recId) => ipcRenderer.invoke('hq:studio:rec-stop', { recId }),
    recAbort: (recId) => ipcRenderer.send('hq:studio:rec-abort', { recId }),
    recToggle: (opts) => ipcRenderer.invoke('hq:studio:rec-toggle', opts),
    libraryList: (query) => ipcRenderer.invoke('hq:studio:library-list', query),
    libraryReveal: (p) => ipcRenderer.invoke('hq:studio:library-reveal', p),
    libraryDelete: (p) => ipcRenderer.invoke('hq:studio:library-delete', p),
    settingsGet: () => ipcRenderer.invoke('hq:studio:settings-get'),
    settingsSet: (patch) => ipcRenderer.invoke('hq:studio:settings-set', patch),
    // Every subscription helper returns an unsubscribe function — v3 realm
    // unmount() MUST call it (same rule as the rest of window.hq).
    recStatus: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:studio:rec-status', handler);
      return () => ipcRenderer.removeListener('hq:studio:rec-status', handler);
    },
    onCaptureAdded: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('studio:capture-added', handler);
      return () => ipcRenderer.removeListener('studio:capture-added', handler);
    },
    onSnipFrozen: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:studio:snip-frozen', handler);
      return () => ipcRenderer.removeListener('hq:studio:snip-frozen', handler);
    },
    onOpenRealm: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:studio:open-realm', handler);
      return () => ipcRenderer.removeListener('hq:studio:open-realm', handler);
    },
  },
});

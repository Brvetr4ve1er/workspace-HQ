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
  logDecision: (projId, text) => ipcRenderer.invoke('hq:log-decision', projId, text),
  learn: (projId, text) => ipcRenderer.invoke('hq:learn', projId, text),
  archiveProject: (id) => ipcRenderer.invoke('hq:archive-project', id),
  reviveProject: (id) => ipcRenderer.invoke('hq:revive-project', id),
  orphanArchive: (p) => ipcRenderer.invoke('hq:orphan-archive', p),
  markQuestDone: (id) => ipcRenderer.invoke('hq:quest-done', id),
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
});

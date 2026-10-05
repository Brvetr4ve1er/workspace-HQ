// Shard preload — the REDUCED bridge (MA deliverable 4). Shards render
// conjured (Claude-written) HTML, so they get exactly what shard.html calls
// and nothing else: no castSpell, no doCommit, no reclaim — closing the
// conjured-HTML → full-bridge injection chain. Sender-scoped handlers
// (shardClose/shardSave/shardRegen) stay safe by construction.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hq', {
  shardClose: () => ipcRenderer.invoke('hq:shard-close'),
  shardSave: (patch) => ipcRenderer.invoke('hq:shard-save', patch),
  shardRegen: () => ipcRenderer.invoke('hq:shard-regen'),
  shardLibSpawn: (key) => ipcRenderer.invoke('hq:shard-lib-spawn', key),
  shardLibDelete: (key) => ipcRenderer.invoke('hq:shard-lib-delete', key),
  markQuestDone: (id) => ipcRenderer.invoke('hq:quest-done', id),
  showMain: () => ipcRenderer.invoke('hq:show-main'),
  // read-only theme sync (v5 clean pass) — no setter: conjured HTML can't change prefs
  uiPrefs: {
    get: () => ipcRenderer.invoke('hq:ui-prefs-get'),
    on: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:ui-prefs', handler);
      return () => ipcRenderer.removeListener('hq:ui-prefs', handler);
    },
  },
  onShardInit: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('shard:init', handler);
    return () => ipcRenderer.removeListener('shard:init', handler);
  },
});

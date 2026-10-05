// Summon-palette preload — two calls, nothing else (MA deliverable 4).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hq', {
  shardSummon: (text) => ipcRenderer.invoke('hq:shard-summon', text),
  shardSummonCancel: () => ipcRenderer.invoke('hq:shard-summon-cancel'),
  // read-only theme sync (v5 clean pass)
  uiPrefs: {
    get: () => ipcRenderer.invoke('hq:ui-prefs-get'),
    on: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:ui-prefs', handler);
      return () => ipcRenderer.removeListener('hq:ui-prefs', handler);
    },
  },
});

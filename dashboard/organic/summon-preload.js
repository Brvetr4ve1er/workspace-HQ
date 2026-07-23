// Summon-palette preload — two calls, nothing else (MA deliverable 4).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hq', {
  shardSummon: (text) => ipcRenderer.invoke('hq:shard-summon', text),
  shardSummonCancel: () => ipcRenderer.invoke('hq:shard-summon-cancel'),
});

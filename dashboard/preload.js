// Secure bridge: exposes a minimal, allow-listed API to the dashboard renderer.
// contextIsolation is on and nodeIntegration off, so the UI can only call these.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hq', {
  runScan: () => ipcRenderer.invoke('hq:scan'),
  openRepo: (relPath) => ipcRenderer.invoke('hq:open-repo', relPath),
  markQuestDone: (id) => ipcRenderer.invoke('hq:quest-done', id),
  devStart: (id) => ipcRenderer.invoke('hq:dev-start', id),
  devStop: (id) => ipcRenderer.invoke('hq:dev-stop', id),
  saveNote: (id, note) => ipcRenderer.invoke('hq:note-save', id, note),
  onDevStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:dev-status', handler);
    return () => ipcRenderer.removeListener('hq:dev-status', handler);
  },
  // mini HUD bridge
  getMiniData: () => ipcRenderer.invoke('hq:mini-data'),
  showMain: () => ipcRenderer.invoke('hq:show-main'),
  miniHide: () => ipcRenderer.invoke('hq:mini-hide'),
  onMiniUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:mini-update', handler);
    return () => ipcRenderer.removeListener('hq:mini-update', handler);
  },
});

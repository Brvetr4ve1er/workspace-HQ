// v3 preload — starts minimal; the real `hq` surface is added realm-by-realm
// during M0 ports, mirroring dashboard/preload.js one channel at a time so
// docs/sync/IPC-CONTRACT.md stays the single reference.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('hqv3', { dev: true });

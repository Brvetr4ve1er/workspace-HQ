// v4 dev preload — a marker only. The real app runs dashboard/preload.js
// (dev-main.js loads it with HQ_V4_PRELOAD=v2); this stub exists so the dev
// harness boots with contextIsolation without faking any `hq` surface —
// views must treat a missing window.hq as "disabled with a reason".
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('hqv4', { dev: true });

// Secure bridge: exposes a minimal, allow-listed API to the dashboard renderer.
// contextIsolation is on and nodeIntegration off, so the UI can only call these.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('hq', {
  runScan: () => ipcRenderer.invoke('hq:scan'),
  openRepo: (relPath) => ipcRenderer.invoke('hq:open-repo', relPath),
  openFile: (projPath, fileRel) => ipcRenderer.invoke('hq:open-file', projPath, fileRel),
  reclaim: (projPath, dirNames) => ipcRenderer.invoke('hq:reclaim', projPath, dirNames),
  snapshot: (projPath, name) => ipcRenderer.invoke('hq:snapshot', projPath, name),
  captureSave: (text) => ipcRenderer.invoke('hq:capture-save', text),
  claudeQuest: (projPath, prompt) => ipcRenderer.invoke('hq:claude-quest', projPath, prompt),
  draftCommit: (projPath) => ipcRenderer.invoke('hq:draft-commit', projPath),
  doCommit: (projPath, msg) => ipcRenderer.invoke('hq:do-commit', projPath, msg),
  // PC-Brain Phase 0/1: presence-check for a local LLM runtime (Ollama/LM Studio)
  probeLlm: (opts) => ipcRenderer.invoke('hq:llm:probe', opts),
  // PC-Brain Phase 2: ORACLE chat. onDelta pushes the accumulated answer text;
  // the chat() promise resolves with the final result. Unsubscribe on unmount.
  llm: {
    warm: () => ipcRenderer.invoke('hq:llm:warm'),
    chat: (req) => ipcRenderer.invoke('hq:llm:chat', req),
    cancel: (jobId) => ipcRenderer.invoke('hq:llm:cancel', jobId),
    onDelta: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:llm:delta', handler);
      return () => ipcRenderer.removeListener('hq:llm:delta', handler);
    },
  },
  // v5 clean pass (IPC-CONTRACT "Pending — v5 clean pass"): shared UI prefs,
  // what's running now, deep links into the main window, the commit guard.
  uiPrefs: {
    get: () => ipcRenderer.invoke('hq:ui-prefs-get'),
    set: (patch) => ipcRenderer.invoke('hq:ui-prefs-set', patch),
    on: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:ui-prefs', handler);
      return () => ipcRenderer.removeListener('hq:ui-prefs', handler);
    },
  },
  claudeHub: {
    health: () => ipcRenderer.invoke('hq:claude-hub:health'),
    projects: (opts) => ipcRenderer.invoke('hq:claude-hub:projects', opts),
    conversations: (opts) => ipcRenderer.invoke('hq:claude-hub:conversations', opts),
    conversation: (id, opts) => ipcRenderer.invoke('hq:claude-hub:conversation', id, opts),
    search: (q, opts) => ipcRenderer.invoke('hq:claude-hub:search', q, opts),
    stats: (opts) => ipcRenderer.invoke('hq:claude-hub:stats', opts),
    link: (id, hqId, state) => ipcRenderer.invoke('hq:claude-hub:link', id, hqId, state),
    forget: (target) => ipcRenderer.invoke('hq:claude-hub:forget', target),
    reindex: () => ipcRenderer.invoke('hq:claude-hub:reindex'),
    documents: (opts) => ipcRenderer.invoke('hq:claude-hub:documents', opts),
    document: (id) => ipcRenderer.invoke('hq:claude-hub:document', id),
    on: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:claude-hub:event', handler);
      return () => ipcRenderer.removeListener('hq:claude-hub:event', handler);
    },
  },
  // Claude Hub H5: Save to vault — preview drafts (writes nothing); save writes one confirmed note
  claudeVault: {
    preview: (conversationId) => ipcRenderer.invoke('hq:claude-vault:preview', conversationId),
    save: (req) => ipcRenderer.invoke('hq:claude-vault:save', req),
  },
  vaultOpen: (name, how) => ipcRenderer.invoke('hq:vault-open', name, how),   // Life › Notes: 'open' | 'search' in Obsidian, a scanned vault only
  claudeChat: {
    send: (req) => ipcRenderer.invoke('hq:claude-chat:send', req),
    cancel: (turnId) => ipcRenderer.invoke('hq:claude-chat:cancel', turnId),
    on: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:claude-chat:event', handler);
      return () => ipcRenderer.removeListener('hq:claude-chat:event', handler);
    },
  },
  liveState: () => ipcRenderer.invoke('hq:live-state'),
  onScanStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:scan-status', handler);
    return () => ipcRenderer.removeListener('hq:scan-status', handler);
  },
  openAt: (route) => ipcRenderer.invoke('hq:open-at', route),
  onNavigate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hq:navigate', handler);
    return () => ipcRenderer.removeListener('hq:navigate', handler);
  },
  commitPreview: (projPath) => ipcRenderer.invoke('hq:commit-preview', projPath),
  logDecision: (projId, text) => ipcRenderer.invoke('hq:log-decision', projId, text),
  use: (surface, action) => ipcRenderer.invoke('hq:use', surface, action),   // usage counter (allowlisted ids only)
  reach: { read: () => ipcRenderer.invoke('hq:reach:read') },   // Settings › Reach rows
  learn: (projId, text) => ipcRenderer.invoke('hq:learn', projId, text),
  archiveProject: (id) => ipcRenderer.invoke('hq:archive-project', id),
  reviveProject: (id) => ipcRenderer.invoke('hq:revive-project', id),
  markQuestDone: (id) => ipcRenderer.invoke('hq:quest-done', id),
  actedOn: (entry) => ipcRenderer.invoke('hq:acted-on', entry),
  // M2: MED-BAY — live PC-health scan + whitelisted safe fix runner
  healthScan: () => ipcRenderer.invoke('hq:health-scan'),
  healthFix: (command) => ipcRenderer.invoke('hq:health-fix', command),
  pcOpenFolder: (p) => ipcRenderer.invoke('hq:pc-open-folder', p),   // only a folder listed in the current disk breakdown
  githubRefresh: () => ipcRenderer.invoke('hq:github-refresh'),   // re-reads the account through the owner's gh login
  githubOpen: (u) => ipcRenderer.invoke('hq:github-open', u),   // only a github.com link listed in the current snapshot
  accountsRefresh: () => ipcRenderer.invoke('hq:accounts-refresh'),   // re-reads Vercel + Supabase through the owner's CLI logins
  accountsOpen: (u) => ipcRenderer.invoke('hq:accounts-open', u),   // only a Vercel / Supabase link listed in the current snapshot

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
  // quick-run palette: "Needs you" rows + Go mode (IPC-CONTRACT hq:quick:*). The cast window shares this preload; main answers { error } to any other sender.
  quick: {
    read: () => ipcRenderer.invoke('hq:quick:read'),
    openBrief: (ref) => ipcRenderer.invoke('hq:quick:open-brief', ref),
    openGo: (route) => ipcRenderer.invoke('hq:quick:open-go', route),
  },
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
  // quick-run palette bridge
  showMain: () => ipcRenderer.invoke('hq:show-main'),
  killServers: () => ipcRenderer.invoke('hq:kill-servers'),
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
  // Operator Brief (IPC-CONTRACT hq:brief:*): the 1–3 things that need the owner now. Read-only, plus dismiss.
  brief: {
    read: () => ipcRenderer.invoke('hq:brief:read'),
    dismiss: (key) => ipcRenderer.invoke('hq:brief:dismiss', key),
    act: (key, verb, value) => ipcRenderer.invoke('hq:brief:act', value === undefined ? { key, verb } : { key, verb, value }),   // act in place on a row (IPC-CONTRACT hq:brief:act)
    onBrief: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:brief', handler);
      return () => ipcRenderer.removeListener('hq:brief', handler);
    },
  },
  // Sessions board (IPC-CONTRACT hq:sessions-board:*): every Claude Code session of the last 24 h, where each stopped, and Resume.
  // Main reads the folder from the Hub; the renderer only ever sends a session id.
  sessionsBoard: {
    read: () => ipcRenderer.invoke('hq:sessions-board:read'),
    resume: (id, opts) => ipcRenderer.invoke('hq:sessions-board:resume', id, opts),
    openFolder: (id) => ipcRenderer.invoke('hq:sessions-board:open-folder', id),
    onBoard: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:sessions-board', handler);
      return () => ipcRenderer.removeListener('hq:sessions-board', handler);
    },
  },

  // Client delivery (IPC-CONTRACT hq:delivery:*): the card on each project page. The renderer sends a project id and validated intents only.
  delivery: {
    read: (projectId) => ipcRenderer.invoke('hq:delivery:read', projectId),
    apply: (intent) => ipcRenderer.invoke('hq:delivery:apply', intent),
    clients: () => ipcRenderer.invoke('hq:delivery:clients'),
  },

  // Client delivery check (IPC-CONTRACT hq:delivery-check:*): phone size and ar/fr/en against a dev server on THIS PC. Main re-validates the address.
  deliveryCheck: {
    detect: (projectId) => ipcRenderer.invoke('hq:delivery-check:detect', projectId),
    run: (projectId, url) => ipcRenderer.invoke('hq:delivery-check:run', projectId, url),
    read: (projectId) => ipcRenderer.invoke('hq:delivery-check:read', projectId),
    forget: (projectId) => ipcRenderer.invoke('hq:delivery-check:forget', projectId),
  },

  // money space (IPC-CONTRACT hq:money:*). Intents only — main validates every field.
  money: {
    read: () => ipcRenderer.invoke('hq:money:read'),
    apply: (intent) => ipcRenderer.invoke('hq:money:apply', intent),
    importFile: () => ipcRenderer.invoke('hq:money:import'),
    exportFile: () => ipcRenderer.invoke('hq:money:export'),
  },
  // Settings: may Claude sessions read Money in words? (IPC-CONTRACT hq:money-access:*; a strict boolean, off by default)
  moneyAccess: {
    read: () => ipcRenderer.invoke('hq:money-access:read'),
    set: (on) => ipcRenderer.invoke('hq:money-access:set', on),
  },

  // System › Machine › How the PC changed (IPC-CONTRACT hq:machine-history:read; read-only: eight history fields and the folders that grew, never a path)
  machineHistory: {
    read: () => ipcRenderer.invoke('hq:machine-history:read'),
  },

  // Brief history (IPC-CONTRACT hq:brief-history:read / :ack): what the Brief noticed and how it ended; ack only records that the all-clear card was shown
  briefHistory: {
    read: () => ipcRenderer.invoke('hq:brief-history:read'),
    ack: () => ipcRenderer.invoke('hq:brief-history:ack'),
  },

  // Home: where today went (IPC-CONTRACT hq:today:read; { dayOffset: 0..6 }, read once per arrival, nothing is written)
  today: {
    read: (o) => ipcRenderer.invoke('hq:today:read', o),
  },

  // Cosmos space (IPC-CONTRACT hq:cosmos:*). Intents and element ids only; paths come from main or from pathForFile (a dropped File).
  cosmos: {
    read: (opts) => ipcRenderer.invoke('hq:cosmos:read', opts),
    apply: (intent) => ipcRenderer.invoke('hq:cosmos:apply', intent),
    pickFolder: () => ipcRenderer.invoke('hq:cosmos:pick-folder'),
    index: () => ipcRenderer.invoke('hq:cosmos:index'),
    cancelIndex: () => ipcRenderer.invoke('hq:cosmos:cancel-index'),
    trash: (ids) => ipcRenderer.invoke('hq:cosmos:trash', ids),
    reveal: (id) => ipcRenderer.invoke('hq:cosmos:reveal', id),
    importFiles: (paths) => ipcRenderer.invoke('hq:cosmos:import-files', paths),
    importFromLocal: () => ipcRenderer.invoke('hq:cosmos:import-local'),
    onProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('hq:cosmos:index-progress', handler);
      return () => ipcRenderer.removeListener('hq:cosmos:index-progress', handler);
    },
    // Not an IPC channel: Electron 32 has no File.path, so the preload reads a dropped File's path (one File per call, never a FileList). '' on any failure.
    pathForFile: (file) => { try { const p = webUtils.getPathForFile(file); return typeof p === 'string' ? p : ''; } catch { return ''; } },
  },
});

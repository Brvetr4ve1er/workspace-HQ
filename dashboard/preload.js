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
    socialSummary: () => ipcRenderer.invoke('hq:claude-hub:social-summary'),
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
  // Social tab › Vault (VEEMO CORTEX): list 30_Areas/Social + 00_Inbox/Social *.md, open a listed note, save one new note on the owner's Save
  socialVault: {
    list: () => ipcRenderer.invoke('hq:social-vault:list'),
    open: (rel, how) => ipcRenderer.invoke('hq:social-vault:open', rel, how),
    save: (req) => ipcRenderer.invoke('hq:social-vault:save', req),
  },
  socialOpenSite: (platform) => ipcRenderer.invoke('hq:social-open-site', platform),   // a listed platform's home page, to sign in there
  socialCancel: (id) => ipcRenderer.invoke('hq:social-cancel', id),   // Social › Inbox Discard: staged → canceled only (never publishes)
  vaultOpen: (name, how) => ipcRenderer.invoke('hq:vault-open', name, how),   // Life › Notes: 'open' | 'search' in Obsidian, a scanned vault only
  statCardSave: (dataUrl) => ipcRenderer.invoke('hq:stat-card-save', dataUrl),   // Save stat card PNG: main picks the path, the renderer never names one
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
  // M3: THE CANVAS — shared JSON Canvas boards, fs-watched live
  getSocial: () => ipcRenderer.invoke('hq:social-read'),

  getCanvas: () => ipcRenderer.invoke('hq:canvas-read'),
  canvasAdd: (name, node) => ipcRenderer.invoke('hq:canvas-add', name, node),
  canvasRemove: (board, id) => ipcRenderer.invoke('hq:canvas-remove', board, id),   // one node + its edges; a copy goes to removed.jsonl
  canvasCreate: (board) => ipcRenderer.invoke('hq:canvas-create', board),   // a new empty board, never over an existing one
  canvasClear: (board) => ipcRenderer.invoke('hq:canvas-clear', board),   // every node + edge; a copy goes to removed.jsonl, the board stays
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
});

// A recording fake of window.hq for the v5 dev harness (dev-main.js --preload=fake).
// It exposes every method dashboard/preload.js exposes, with the same nesting,
// so the renderer runs its real code paths with nothing behind them:
//  - every call is recorded as {method, args, at} (functions → '[function]')
//  - writes resolve true and do nothing — except where a v5 caller reads fields of
//    the answer: those resolve main's real success shape (doCommit / rescanSpellbook
//    {ok:true}, healthFix {ok, output}); reads resolve canned shapes that
//    live/adapter.mjs accepts (mostly empty)
//  - push channels keep their callbacks HERE, in the preload world, and fire
//    them on window.hqFake.emit(channel, payload); the channel is the IPC name
//    ('hq:scan-status') or the method path ('onScanStatus', 'llm.onDelta',
//    'studio.onCaptureAdded'). Callbacks and disposers cross contextBridge as
//    proxies, so storing them here and calling them later works.
// window.hqFake = {
//   calls(method?)        recorded calls (copies), optionally for one method path
//   reset(all?)           clear the log + sequences (castSpell, pending chats); all=true also drops set() overrides and prefs
//   emit(channel, data)   push to that channel's subscribers; returns how many were called
//   set(method, value)    from now on that method returns `value` (copied); a function is called with the args;
//                         {__reject:'msg'} rejects; undefined restores the default
//   set(method, value, {persist:true})   also keeps a JSON value for the NEXT page loads of this tab
//                         (sessionStorage 'hqFake:persist'): the preload re-runs on every reload, so this is
//                         how a scenario makes e.g. liveState answer something at boot. reset(true) clears it.
// }
// Canned specials: castSpell asks for confirmation on its first call
// ({confirm_required, preview:{content_hash:'fake-hash-2'}}) and then returns {castId:'c-fake'};
// llm.chat streams three accumulated deltas 100 ms apart through llm.onDelta, then resolves.
'use strict';

const WRITE = 'write', SEND = 'send';

// P2 harvest candidates (placeholder text; reasons are the Hub's own wording)
const FAKE_CANDIDATES = [
  { key: 'cand:' + '1'.repeat(40), text: 'Placeholder prompt one: review the placeholder module and list what to change, file by file, with the reason for each change, in plain words.',
    chars: 141, score: 11, sessions: 3, lastAt: '2026-10-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 9, text: 'used in 3 sessions' }, { key: 'turns', points: 2, text: 'followed by 8 assistant messages' }],
    sources: [{ kind: 'code', conversationId: 'code:sess-a1', at: '2026-10-01T10:00:00Z', project: 'project-a' },
      { kind: 'history', documentId: 'history:sess-a1:0', at: '2026-09-20T09:00:00Z', project: 'project-a' }] },
  { key: 'cand:' + '2'.repeat(40), text: 'Placeholder prompt two: draft a placeholder plan with steps, owners and checks, then point out every step that has no check yet.',
    chars: 128, score: 3.25, sessions: 1, lastAt: '2026-09-15T10:00:00Z',
    reasons: [{ key: 'reuse', points: 0, text: 'seen in 1 session' }, { key: 'turns', points: 3.25, text: 'followed by 13 assistant messages' }],
    sources: [{ kind: 'chatgpt', conversationId: 'chatgpt:placeholder-1', at: '2026-09-15T10:00:00Z', project: null }] },
  { key: 'cand:' + '3'.repeat(40), text: 'Placeholder prompt three: ' + 'summarize the placeholder notes into a short list of decisions and open questions. '.repeat(4).trim(),
    chars: 357, score: -4, sessions: 1, lastAt: '2026-09-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 0, text: 'seen in 1 session' }, { key: 'turns', points: 0, text: 'no assistant message followed it' },
      { key: 'length', points: 1, text: '300+ characters' }, { key: 'library', points: -5, text: 'already a prompt note' }],
    sources: [{ kind: 'web', conversationId: 'web:placeholder-web-1', at: '2026-09-01T10:00:00Z', project: 'claude.ai chats' }] },
];
const fakeSlug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'prompt';

// storage (optional): a Web Storage for set(…, {persist:true}); the Electron branch passes sessionStorage
function createFake(opts) {
  const storage = opts && opts.storage ? opts.storage : null;
  const PERSIST_KEY = 'hqFake:persist';
  const log = [];
  const subs = new Map();        // channel → Set(callback)
  const alias = new Map();       // method path → channel
  const overrides = new Map();   // method path → value
  const readPersisted = () => { try { const o = JSON.parse((storage && storage.getItem(PERSIST_KEY)) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
  const writePersisted = (o) => { try { if (Object.keys(o).length) storage.setItem(PERSIST_KEY, JSON.stringify(o)); else storage.removeItem(PERSIST_KEY); } catch {} };
  const chats = new Map();       // jobId → {timers, resolve}
  const HUB_AT = '2026-10-04T09:00:00.000Z';
  const HUB_PROJECTS = [
    { id: 'code:C--placeholder-project-a', source: 'code', key: 'C--placeholder-project-a', name: 'project-a', path: 'C:\\placeholder\\project-a', hq_project_id: 'project-a', link_state: 'auto', conversations: 2, last_at: HUB_AT },
    { id: 'code:C--placeholder-project-b', source: 'code', key: 'C--placeholder-project-b', name: 'project-b', path: 'C:\\placeholder\\project-b', hq_project_id: null, link_state: 'none', conversations: 1, last_at: '2026-09-30T08:00:00.000Z' },
  ];
  const HUB_CONVS = [
    { id: 'code:sess-a1', source: 'code', project_id: HUB_PROJECTS[0].id, native_id: 'sess-a1', title: 'Release planning', title_source: 'ai', started_at: '2026-10-04T08:40:00.000Z', last_at: HUB_AT, message_count: 4, cwd: 'C:\\placeholder\\project-a', git_branch: 'main', model: 'claude-placeholder', tokens_in: 6, tokens_out: 40, tokens_cache_read: 100, tokens_cache_write: 10, active_ms: 120000, forgotten: 0, project_name: 'project-a', hq_project_id: 'project-a' },
    { id: 'code:sess-a2', source: 'code', project_id: HUB_PROJECTS[0].id, native_id: 'sess-a2', title: 'Fix the caf\u00e9 bug \ud83d\ude80', title_source: 'first-prompt', started_at: '2026-10-03T10:00:00.000Z', last_at: '2026-10-03T10:05:00.000Z', message_count: 2, cwd: 'C:\\placeholder\\project-a', git_branch: null, model: null, tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_write: null, active_ms: 0, forgotten: 0, project_name: 'project-a', hq_project_id: 'project-a' },
  ];
  const hubThread = (id) => {
    const c = HUB_CONVS.find((x) => x.id === id);
    if (!c) return null;
    return { conversation: c, hasMore: false, messages: [
      { id: id + ':u1', conversation_id: id, role: 'user', at: c.started_at, text: 'Plan the release for project-a', tool_name: null, is_sidechain: 0 },
      { id: id + ':a1', conversation_id: id, role: 'assistant', at: c.last_at, text: '[tool: Read README.md]', tool_name: 'Read', is_sidechain: 0 },
      { id: id + ':t1', conversation_id: id, role: 'tool', at: c.last_at, text: '# project-a\nplaceholder readme', tool_name: null, is_sidechain: 0 },
      { id: id + ':a2', conversation_id: id, role: 'assistant', at: c.last_at, text: 'Here is a release plan.', tool_name: null, is_sidechain: 0 },
    ] };
  };
  const FAKE_PROMPTS = [
    { id: 'prompt:' + 'a'.repeat(40), source: 'prompt', path: 'C:\\fake-vault\\40_Resources\\Prompts\\review-a-pr.md', title: 'Review a PR like a staff engineer', project_id: null, project_path: null,
      mtime_ms: Date.parse('2026-10-15T10:00:00Z'), size: 220, origin: null, meta: { title: 'Review a PR like a staff engineer', tags: ['review', 'code'], variables: ['project', 'file'] }, variables: ['project', 'file'] },
    { id: 'prompt:' + 'b'.repeat(40), source: 'prompt', path: 'C:\\fake-vault\\40_Resources\\Prompts\\weekly-notes.md', title: 'Weekly notes digest', project_id: null, project_path: null,
      mtime_ms: Date.parse('2026-10-10T08:00:00Z'), size: 140, origin: null, meta: { title: 'Weekly notes digest', tags: ['notes'] }, variables: [] },
  ];
  const HUB_DOCS = [{ id: 'memory:fake1', source: 'memory', path: 'C:\\fake\\.claude\\projects\\p\\memory\\tea.md', title: 'Fake tea rule', project_id: 'code:p', project_path: 'C:\\fake\\p', mtime_ms: 1759320000000, size: 40, origin: null, snippet: 'offer fake \u0002tea\u0003 first', rank: -1 }, { id: 'claude-md:fake2', source: 'claude-md', path: 'C:\\fake\\p\\CLAUDE.md', title: 'CLAUDE.md — p', project_id: 'code:p', project_path: 'C:\\fake\\p', mtime_ms: 1759320000000, size: 30, origin: null, snippet: 'fake \u0002tea\u0003 rules', rank: -0.5 }];
  const HUB_HITS = [
    { messageId: 'code:sess-a1:a2', conversationId: 'code:sess-a1', at: HUB_AT, role: 'assistant', title: 'Release planning', source: 'code', projectId: HUB_PROJECTS[0].id, snippet: 'Here is a \u0002release\u0003 plan.', rank: -2 },
    { messageId: 'code:sess-a2:u1', conversationId: 'code:sess-a2', at: '2026-10-03T10:00:00.000Z', role: 'user', title: 'Fix the caf\u00e9 bug \ud83d\ude80', source: 'code', projectId: HUB_PROJECTS[0].id, snippet: '\u2026pasted \u0002<img src=x onerror=alert(1)>\u0003 <script>release()</script> and \u0002release', rank: -1 },
  ];
  const DEFAULT_PREFS = { theme: 'dark', resolved: 'dark', reduceMotion: false };
  let prefs = { ...DEFAULT_PREFS }, casts = 0;

  // cloneable copy of what crossed the bridge (contextBridge can't copy functions back out)
  const clean = (v, d = 0) => {
    if (typeof v === 'function') return '[function]';
    if (v == null || typeof v !== 'object') return v;
    if (d > 6) return '[deep]';
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return '[bytes ' + v.byteLength + ']';
    if (Array.isArray(v)) return v.map((x) => clean(x, d + 1));
    const o = {};
    for (const k of Object.keys(v)) o[k] = clean(v[k], d + 1);
    return o;
  };
  const record = (method, args) => { log.push({ method, args: clean(args), at: Date.now() }); };
  const push = (channel, payload) => {
    let n = 0;
    for (const cb of [...(subs.get(channel) || [])]) {
      try { cb(payload); n++; } catch (e) { console.error('[hqFake] a ' + channel + ' subscriber threw:', e); }
    }
    return n;
  };

  // ---- the stateful canned answers ----
  const chat = (req) => new Promise((resolve) => {
    const claude = !!(req && req.include && req.include.claude === true);   // H5: a Claude history section, cited
    const jobId = req && req.jobId, parts = ['Fake', 'Fake answer', claude ? 'Fake answer from the fake model, from chat Fake release planning, 2026-10-01.' : 'Fake answer from the fake model.'];
    const job = { resolve, timers: [], sent: '', t0: Date.now() };
    if (jobId) chats.set(jobId, job);
    parts.forEach((text, i) => job.timers.push(setTimeout(() => {
      job.sent = text;
      push('hq:llm:delta', { jobId, text });   // main sends the accumulated text, not the increment
      if (i === parts.length - 1) {
        chats.delete(jobId);
        const sections = [{ label: 'Scan', chars: 10 }].concat(claude ? [{ id: 'claude', label: 'Claude history', chars: 420, clipped: false, cites: ['chat Fake release planning, 2026-10-01'] }] : []);
        resolve({ status: 'done', output: text, sections, model: 'fake-model', ms: 300 });
      }
    }, 100 * (i + 1))));
  });
  // like main (hq:llm:cancel): true when that job was running, false otherwise; the
  // stopped chat answers {status:'cancelled', output:<what had streamed>} — main's
  // stream keeps the partial text (it is '' only when the stop beat the context build)
  const cancelChat = (jobId) => {
    const j = chats.get(jobId);
    if (!j) return false;
    j.timers.forEach(clearTimeout); chats.delete(jobId);
    j.resolve({ status: 'cancelled', output: j.sent, sections: [{ label: 'Scan', chars: 10 }], model: 'fake-model', ms: Date.now() - j.t0 });
    return true;
  };
  // Claude Hub H3 — like main (hq:claude-chat:send/cancel): increments, one end per turn.
  const turns = new Map();
  let turnSeq = 0;
  const chatTurn = (req) => {
    const r = req && typeof req === 'object' ? req : {};
    if (typeof r.text !== 'string' || !r.text.trim()) return { error: 'empty message' };
    const turnId = 'ct-fake-' + (++turnSeq), mode = r.mode === 'edits' ? 'edits' : 'read-only';
    const resumed = typeof r.conversationId === 'string' && r.conversationId.startsWith('code:') ? r.conversationId.slice(5) : null;
    const sessionId = resumed || '00000000-0000-4000-8000-000000000001';
    const steps = [
      { kind: 'session', sessionId, mode }, { kind: 'delta', text: 'Placeholder' }, { kind: 'tool', name: 'Read', hint: 'README.md' },
      { kind: 'delta', text: ' answer from the fake claude.' },
      { kind: 'done', sessionId, mode, usage: { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 }, isError: false, subtype: 'success', result: '', stopped: false },
    ];
    const t = { timers: [], sessionId, mode };
    turns.set(turnId, t);
    steps.forEach((s, i) => t.timers.push(setTimeout(() => {
      if (s.kind === 'done') turns.delete(turnId);
      push('hq:claude-chat:event', { turnId, ...s });
    }, 150 * (i + 1))));
    return resumed ? { turnId, sessionId } : { turnId };
  };
  const cancelTurn = (turnId) => {
    const t = turns.get(turnId);
    if (!t) return false;
    t.timers.forEach(clearTimeout); turns.delete(turnId);
    setTimeout(() => push('hq:claude-chat:event', { turnId, kind: 'done', sessionId: t.sessionId, mode: t.mode, usage: null, isError: false, subtype: '', result: '', stopped: true }), 0);
    return true;
  };

  const cast = () => (casts++ === 0 ? { confirm_required: true, preview: { content_hash: 'fake-hash-2' } } : { castId: 'c-fake' });
  const setPrefs = (patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    const next = { ...prefs };
    if (['dark', 'light', 'os'].includes(p.theme)) next.theme = p.theme;
    if (typeof p.reduceMotion === 'boolean') next.reduceMotion = p.reduceMotion;
    next.resolved = next.theme === 'light' ? 'light' : 'dark';   // the fake has no OS theme: 'os' resolves dark
    prefs = next;
    setTimeout(() => push('hq:ui-prefs', prefs), 0);   // main broadcasts after answering
    return prefs;
  };

  // [method path, kind]: WRITE resolves true · SEND returns undefined · 'on:<channel>'
  // subscribes · a function is the canned answer. Mirrors dashboard/preload.js
  // top to bottom (tools/cdp-gate.mjs --scenario fake-parity diffs the two).
  const SPEC = [
    ['runScan', WRITE], ['openRepo', WRITE], ['openFile', WRITE], ['reclaim', WRITE], ['snapshot', WRITE],
    ['captureSave', WRITE], ['claudeQuest', WRITE],
    ['draftCommit', () => ({ message: 'chore: fake draft', via: 'local:fake' })], ['doCommit', () => ({ ok: true })],
    ['probeLlm', () => ({ available: true, runtime: 'fake', chatModel: 'fake-model' })],
    ['llm.warm', () => ({ status: 'warm', model: 'fake-model' })], ['llm.chat', chat], ['llm.cancel', cancelChat], ['llm.onDelta', 'on:hq:llm:delta'],
    ['uiPrefs.get', () => prefs], ['uiPrefs.set', setPrefs], ['uiPrefs.on', 'on:hq:ui-prefs'],
    ['claudeHub.health', () => ({ state: 'ready', role: 'writer', node: 'v25.6.1', backfill: { done: 3, total: 3 }, counts: { projects: 2, conversations: 3, messages: 5 }, dbBytes: 1048576, lastImport: null, importing: false })],
    ['claudeHub.projects', () => HUB_PROJECTS], ['claudeHub.conversations', () => HUB_CONVS],
    ['claudeHub.conversation', (id) => hubThread(id)], ['claudeHub.search', () => HUB_HITS],
    ['claudeHub.stats', () => ({ from: '2026-09-06', to: '2026-10-05', tzOffsetMin: 0,
      days: [{ day: '2026-10-03', chats: 1, messages: 2, active_ms: 0 }, { day: '2026-10-04', chats: 1, messages: 4, active_ms: 120000 }],
      projects: [{ project_id: HUB_PROJECTS[0].id, name: 'project-a', chats: 2, tokens_in: 6, tokens_out: 40, tokens_cache_read: 100, tokens_cache_write: 10 }],
      totals: { chats: 2, active_ms: 120000, tokens_in: 6, tokens_out: 40, tokens_cache_read: 100, tokens_cache_write: 10 } })],
    ['claudeHub.link', WRITE], ['claudeHub.forget', WRITE], ['claudeHub.reindex', () => ({ started: true })],
    ['claudeHub.importExport', (kind) => ({ started: true, file: kind === 'chatgpt' ? 'chatgpt-export.zip' : 'claude-export.zip', kind: kind === 'chatgpt' ? 'chatgpt' : 'claude' })],
    ['claudeHub.promptCandidates', () => ({ candidates: FAKE_CANDIDATES, pooled: { messages: 42, history: 17 }, capped: { messages: false, history: false }, hidden: 0 })],
    ['claudeHub.hideCandidate', WRITE],
    ['claudePrompts.promote', (p) => { const name = (p && p.name) || fakeSlug(p && p.title) + '.md'; return { path: '40_Resources/Prompts/' + name, name, id: 'prompt:' + 'c'.repeat(40), masked: 0 }; }],
    ['claudeHub.documents', (opts) => {
      if (!(opts && opts.source === 'prompt')) return HUB_DOCS;
      const q = opts.q ? String(opts.q).toLowerCase() : '';
      return q ? FAKE_PROMPTS.filter((d) => d.title.toLowerCase().includes(q)) : FAKE_PROMPTS;
    }],
    // Prompt library P1: harness fixture only — the real Hub answers [] until P3 writes prompt_use rows
    ['claudeHub.promptStats', () => [{ prompt_id: 'prompt:' + 'a'.repeat(40), uses: 3, last_at: '2026-10-20T09:00:00.000Z' }]],
    ['claudePrompts.status', () => ({ vault: 'fake-vault', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: true })],
    ['claudePrompts.open', (id, how) => (how === 'obsidian' || how === 'file' ? { ok: true, how } : { error: 'a prompt note opens only in Obsidian or as a file' })],
    ['claudeHub.document', (id) => { const d = HUB_DOCS.find((x) => x.id === id); return d ? { ...d, text: 'Offer fake tea first.\nFake second line.', meta: null } : null; }],
    ['claudeHub.on', 'on:hq:claude-hub:event'],
    // Claude Hub H5: Save to vault (canned draft; save resolves true and is recorded)
    ['claudeVault.preview', (id) => ({ path: 'C:\\fake-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Fake release planning.md', rel: '30_Areas/Claude/project-a/2026-10-01 Fake release planning.md', exists: false, model: 'fake-model', basis: 4,
      markdown: '---\nsource: claude-code\nconversation: ' + JSON.stringify(String(id)) + '\nproject: "[[project-a]]"\ncreated: 2026-10-16\nchat_date: 2026-10-01\ntitle: "Fake release planning"\ndrafted_by: "local model fake-model, from 4 chat messages"\ntags: [claude]\n---\n\n# Fake release planning\n\nProject: [[project-a]] · chat of 2026-10-01\n\n## Summary\nThe fake release ships Friday.\n\n## Decisions\n- ship Friday\n\n## To-dos\n- [ ] tag\n\n## Links\n- none\n' })],
    ['claudeVault.save', WRITE],
    ['claudeImports.pending', () => ({ folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [], refused: [] })],
    ['claudeImports.dismiss', WRITE],
    ['claudeImports.on', 'on:hq:claude-imports:event'],
    ['claudeChat.send', chatTurn], ['claudeChat.cancel', cancelTurn], ['claudeChat.on', 'on:hq:claude-chat:event'],
    ['liveState', () => ({ dev: [], casts: [], scan: { state: 'idle' } })], ['onScanStatus', 'on:hq:scan-status'],
    ['openAt', WRITE], ['onNavigate', 'on:hq:navigate'],
    ['commitPreview', () => ({
      files: [{ path: 'src/a.js', status: 'M', env: false }, { path: 'sub/.env', status: '??', env: true }, { path: '.env.example', status: '??', env: false }],
      stat: ' src/a.js | 2 +-', envHits: ['sub/.env'], branch: 'main',
    })],
    ['logDecision', WRITE], ['learn', WRITE], ['archiveProject', WRITE], ['reviveProject', WRITE], ['markQuestDone', WRITE], ['actedOn', WRITE],
    ['healthScan', () => ({ organs: [] })], ['healthFix', () => ({ ok: true, output: 'fake fix ran' })],
    ['getSocial', () => ({ accounts: { accounts: [] }, outbox: { actions: [] }, inbox: { events: [] } })],
    ['getCanvas', () => []], ['canvasAdd', WRITE], ['onCanvas', 'on:hq:canvas'],
    ['getSessions', () => []], ['sessionStart', () => ({ jobId: 'j-fake' })], ['sessionKill', WRITE],
    ['sessionDiff', () => ({ files: [], stat: '' })], ['onSessionOutput', 'on:hq:session-output'], ['onClaudeSessions', 'on:hq:claude-sessions'],
    ['devStart', WRITE], ['devStop', WRITE], ['saveNote', WRITE], ['onDevStatus', 'on:hq:dev-status'],
    ['castSpell', cast], ['cancelCast', WRITE], ['getSpellbook', () => ({ spells: [] })], ['favoriteSpell', WRITE], ['rescanSpellbook', () => ({ ok: true })],
    ['getSpellTelemetry', () => ({ casts: [], favorites: [], confirmed_hashes: {} })], ['hideCastPalette', WRITE],
    ['onCastOutput', 'on:hq:cast-output'], ['onCastDone', 'on:hq:cast-done'],
    ['shardSummon', WRITE], ['shardSummonCancel', WRITE], ['shardClose', WRITE], ['shardSave', WRITE],
    ['shardLibSpawn', WRITE], ['shardLibDelete', WRITE], ['shardRegen', WRITE], ['onShardInit', 'on:shard:init'],
    ['getMiniData', () => null], ['showMain', WRITE], ['miniHide', WRITE], ['killServers', WRITE],
    ['onMiniUpdate', 'on:hq:mini-update'], ['onMachine', 'on:hq:machine'],
    ['getBrowserLive', () => null], ['onBrowserTab', 'on:hq:browser-tab'],
    ['studio.panelToggle', WRITE], ['studio.snipArm', WRITE], ['studio.snipCommit', SEND], ['studio.snipCancel', SEND],
    ['studio.recSources', () => []], ['studio.recStart', WRITE], ['studio.recChunk', SEND], ['studio.recStop', WRITE],
    ['studio.recAbort', SEND], ['studio.recToggle', WRITE], ['studio.recPause', SEND], ['studio.panelMode', WRITE],
    ['studio.onRecCommand', 'on:hq:studio:rec-command'],
    ['studio.libraryList', () => []], ['studio.libraryReveal', WRITE], ['studio.libraryDelete', WRITE], ['studio.libraryOpen', WRITE],
    ['studio.settingsGet', () => ({})], ['studio.settingsSet', WRITE],
    ['studio.recStatus', 'on:hq:studio:rec-status'], ['studio.onCaptureAdded', 'on:studio:capture-added'],
    ['studio.onSnipFrozen', 'on:hq:studio:snip-frozen'], ['studio.onOpenRealm', 'on:hq:studio:open-realm'],
  ];

  const answer = (method, kind, args) => {
    try {
      if (overrides.has(method)) {
        const v = overrides.get(method);
        if (typeof v === 'function') return Promise.resolve(v(...args));
        if (v && typeof v === 'object' && '__reject' in v) return Promise.reject(new Error(String(v.__reject)));
        return Promise.resolve(v);
      }
      return Promise.resolve(kind === WRITE ? true : kind(...args));
    } catch (e) { return Promise.reject(e); }
  };
  const make = (method, kind) => {
    if (typeof kind === 'string' && kind.startsWith('on:')) {
      const channel = kind.slice(3);
      alias.set(method, channel);
      return (cb) => {
        record(method, [cb]);
        if (typeof cb !== 'function') return () => {};
        if (!subs.has(channel)) subs.set(channel, new Set());
        subs.get(channel).add(cb);
        return () => { subs.get(channel).delete(cb); };
      };
    }
    if (kind === SEND) return (...args) => { record(method, args); };
    return (...args) => { record(method, args); return answer(method, kind, args); };
  };

  const hq = {};
  for (const [method, kind] of SPEC) {
    const keys = method.split('.');
    let o = hq;
    for (const k of keys.slice(0, -1)) o = o[k] || (o[k] = {});
    o[keys[keys.length - 1]] = make(method, kind);
  }

  const control = {
    calls: (method) => log.filter((c) => !method || c.method === method).map((c) => ({ ...c })),
    reset: (all) => {
      log.length = 0; casts = 0;
      for (const id of [...chats.keys()]) cancelChat(id);
      for (const t of turns.values()) t.timers.forEach(clearTimeout); turns.clear();   // Claude Hub H3 fake chat turns
      if (all) { overrides.clear(); prefs = { ...DEFAULT_PREFS }; if (storage) writePersisted({}); }
      return true;
    },
    emit: (channel, payload) => push(alias.get(channel) || channel, payload),
    set: (method, value, o) => {
      if (!SPEC.some(([m]) => m === method)) throw new Error('hqFake.set: no such method ' + method);
      const persist = !!(o && o.persist);
      if (persist && !storage) throw new Error('hqFake.set: nowhere to persist (no storage)');
      if (persist && typeof value === 'function') throw new Error('hqFake.set: only JSON values persist across reloads');
      if (value === undefined) overrides.delete(method); else overrides.set(method, value);
      if (persist) { const p = readPersisted(); if (value === undefined) delete p[method]; else p[method] = JSON.parse(JSON.stringify(value)); writePersisted(p); }
      return true;
    },
  };
  // a value persisted by an earlier load of this tab answers from the start (before boot.js reads it)
  for (const [m, v] of Object.entries(readPersisted())) if (SPEC.some(([k]) => k === m)) overrides.set(m, v);
  return { hq, control, methods: SPEC.map(([m]) => m) };
}

// In the renderer's preload world: expose both. Under plain Node (no Electron)
// this file only exports the factory.
let electron = null;
try { electron = require('electron'); } catch {}
if (electron && typeof electron === 'object' && electron.contextBridge) {
  let storage = null;
  try { storage = window.sessionStorage; } catch {}   // per tab, survives Page.reload (set(…, {persist:true}))
  const fake = createFake({ storage });
  electron.contextBridge.exposeInMainWorld('hq', fake.hq);
  electron.contextBridge.exposeInMainWorld('hqFake', fake.control);
}
if (typeof module === 'object' && module && module.exports) module.exports = { createFake };

// ?selftest=1 (loaded by boot.js; dev-main.js --selftest turns its last line
// into an exit code). Renders every combination the screen can be in —
// theme × time-machine end (live, oldest) × every tab and sub-tab plus the
// first project's page × every overlay, then preview states × theme × overlay
// on Home — and counts what broke:
//   errors      console.error calls, uncaught errors, unhandled rejections
//   unresolved  template bindings that never resolved (WHQ.unresolved, boot included)
//   failures    runtime render failures (WHQ.failures, boot included)
// Read-only by construction: it drives setState / go / openProject / setProps
// only and never touches window.hq. setState persists prefs and place, so
// those storage keys are snapshotted first and put back at the end.
import { NAV, SUBS } from './live/catalog.mjs';
import { TRAILERS } from './logic/whats-new.js';
import { gapsOf } from './live/adapter.mjs';

// + Ask's chat and sources (v3's keys, contract K-1): Ask saves them itself, so a combo must not leave its sample behind
const LOCAL_KEYS = ['whq3-prefs', 'hq-theme', 'hq-theme-migrated', 'hq-oracle-chat', 'hq-oracle-include', 'hq-claude-lib'], SESSION_KEYS = ['whq3-place'];
// every overlay closed; applied before each combo so combos never stack
const CLEAR = { paletteOpen: false, paletteMode: 'go', paletteQuery: '', paletteSel: 0, askOpen: false, runsOpen: false, scrubOpen: false, settingsOpen: false, cheatOpen: false, moreOpen: false, ambientOverlay: false, focus: null, confirm: null, commit: null, sheet: null, levelUp: null, onboard: null, vault: null, lightbox: null, pageMore: false, whatsNewOpen: false, whatsNewMissing: {}, clSrc: 'all', clProj: '', clSince: 'all', clQuery: '', clSearched: false, clOpen: false, clExpanded: {}, clForgetAsk: false, clLinkPick: '', prQuery: '', prSearched: false, prFor: null, ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false, prView: 'library', hcSel: [], promote: null,
  // Phase 3 surface state (app.js initState, contract K-4), back to its defaults before every combo
  sysExamining: false, sysSaves: {}, fixed: [], libKind: 'all', libSource: 'all', libSchool: 'all', libShow: 40, libRescanning: false, autoQuery: '',
  projSearch: '', projStatus: 'all', canvasNoteOpen: false, canvasDraft: '', canvasBoard: null, canvasSaving: false, askChecking: false, studioFilter: 'all' };
const RESTORE = Object.keys(CLEAR).concat(['tab', 'sub', 'route', 'snapOffset', 'themePref', 'sound', 'askHistory', 'askInclude', 'askDraft', 'confirmAsk', 'commitSel', 'diagTab', 'journalDraft']);
// Ask entries as logic/ask.js keeps them: { id, q, a: { text, status, meta (v3's), est } } (+ local / refusal)
const ASK_SEC = [{ id: 'scan', label: 'Scan', chars: 900, clipped: false }, { id: 'tasks', label: 'Tasks', chars: 400, clipped: true }, { id: 'vault', label: 'Vault', chars: 0, clipped: false, note: 'no matching notes' }];
// H5: an answer grounded in Claude history (cited chats in the meta line) and one where the Hub was down
const ASK_CLAUDE = [
  { q: 'selftest claude', id: 'selftest-claude', a: { text: 'From chat Selftest planning, 2026-10-01: ship on Friday.', status: 'done', meta: { status: 'done', sections: ASK_SEC.concat([{ id: 'claude', label: 'Claude history', chars: 1800, clipped: false, cites: ['chat Selftest planning, 2026-10-01'] }]), ms: 1400, model: 'selftest-model' }, est: true } },
  { q: 'selftest claude down', id: 'selftest-claude-down', a: { text: 'Not in what I can see.', status: 'done', meta: { status: 'done', sections: ASK_SEC.concat([{ id: 'claude', label: 'Claude history', chars: 0, clipped: false, cites: [], note: 'Claude Hub is not running' }]), ms: 900, model: 'selftest-model' }, est: true } },
];
// H5 Save to vault: one draft in each dialog phase (synthetic path and text)
const VAULT_DRAFT = { id: 'code:selftest', path: 'C:\\selftest-vault\\30_Areas\\Claude\\selftest\\2026-10-01 Selftest chat.md', rel: '30_Areas/Claude/selftest/2026-10-01 Selftest chat.md', draft: '---\nconversation: "code:selftest"\n---\n# Selftest chat\n\n## Summary\nSynthetic.\n', model: 'selftest-model', basis: 4 };
const ASK = [
  { q: 'selftest question', id: 'selftest-ask', a: { text: 'Synthetic answer for the selftest.', status: 'done', meta: { status: 'done', sections: ASK_SEC, ms: 1400, model: 'selftest-model' }, est: true } },
  { q: 'selftest stopped', id: 'selftest-stop', a: { text: 'A partial answer that was', status: 'cancelled', meta: { status: 'cancelled', sections: ASK_SEC, ms: 900, model: 'selftest-model' }, est: true } },
  { q: 'selftest interrupted', id: 'selftest-int', a: { text: '', status: 'error', meta: { status: 'error', reason: 'interrupted — the window reloaded' }, est: false } },
  { q: 'selftest refused', id: 'selftest-ref', local: true, a: { text: 'The local model runtime isn’t running. Start Ollama, then ask again.', status: 'unavailable', meta: null, est: false, refusal: true } },
];
const ASK_STREAMING = [{ q: 'selftest streaming', id: 'selftest-live', a: { text: 'Streaming so f', status: 'thinking', meta: null, est: false } }];
// a 1x1 PNG: the recovered sample recording's thumbnail (data: is allowed by the CSP's img-src)
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// One render = the queued flush (a microtask) + a frame for refs, animations
// and custom elements. A hidden window may get ~1 frame a second, so a 60 Hz
// frame's worth of time stands in when rAF doesn't come.
const frame = () => new Promise((res) => { let done = false; const fin = () => { if (!done) { done = true; res(); } }; requestAnimationFrame(fin); setTimeout(fin, 16); });
const rendered = () => new Promise((res) => queueMicrotask(res)).then(frame);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const short = (a) => a.map((x) => (x && x.stack) || (x && x.message) || String(x)).join(' ').slice(0, 400);

function snapshot(store, keys) { const o = {}; for (const k of keys) { try { o[k] = store.getItem(k); } catch { o[k] = null; } } return o; }
function restore(store, saved) { for (const [k, v] of Object.entries(saved)) { try { if (v == null) store.removeItem(k); else store.setItem(k, v); } catch {} } }

export async function run(W = window.WHQ) {
  const t0 = performance.now();
  const stats = { combos: 0, errors: 0 };
  const samples = [], holes = new Map();
  let label = 'start';
  const note = (kind, args) => { stats.errors++; if (samples.length < 25) samples.push(label + ' · ' + kind + ' · ' + short(args)); };
  const origError = console.error;
  console.error = function (...a) { note('console.error', a); return origError.apply(this, a); };
  const onError = (e) => note('error', [e.error || e.message]);
  const onRejection = (e) => note('unhandledrejection', [e.reason]);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const savedLocal = snapshot(localStorage, LOCAL_KEYS), savedSession = snapshot(sessionStorage, SESSION_KEYS);
  const L = W && W.app && W.app.logic;
  if (W) for (const k of W.unresolved) holes.set(k, 'boot');
  const initial = {}, initialProps = {};
  try {
    if (!L) throw new Error('no mounted app (WHQ.app is null)');
    for (const k of RESTORE) initial[k] = L.state[k];
    for (const k of ['previewState', 'errorText']) initialProps[k] = L.props[k];
    const M = W.store.model;
    const combo = async (name, drive) => {
      label = name;
      drive();
      await rendered();
      stats.combos++;
      for (const k of W.unresolved) if (!holes.has(k)) holes.set(k, name);
    };

    L.setState({ sound: false });   // no chiptune blips for a thousand tab switches (restored below)
    await rendered(); await sleep(300);   // let boot reads land first

    const views = [];
    for (const n of NAV) for (const s of SUBS[n.id] || [[undefined]]) views.push({ tab: n.id, sub: s[0], name: n.id + (s[0] ? '/' + s[0] : '') });
    const proj = (M.P0[0] || {}).id;
    if (proj) views.push({ tab: 'projects', sub: 'grid', project: proj, name: 'project-page' });
    const open = typeof L.openTasks === 'function' ? L.openTasks(0) : M.T0;
    const auto = M.AUTOS[0];
    const overlays = [
      ['none', {}],
      ['palette-go', { paletteOpen: true, paletteMode: 'go' }],
      ['palette-ask', { paletteOpen: true, paletteMode: 'ask' }],
      ['ask', { askOpen: true, askHistory: ASK }],
      ['runs', { runsOpen: true }],
      ['scrub', { scrubOpen: true }],
      ['settings', { settingsOpen: true }],
      ['cheat', { cheatOpen: true }],
      ['focus', { focus: { taskId: open[0] ? open[0].id : null, start: Date.now() } }],
      auto && ['confirm', { confirm: auto.id, confirmAsk: 'always' }],
      proj && ['commit', { commit: { pid: proj, files: [{ name: 'src/a.js', st: 'mod', on: true }], stat: '', loading: false, msg: 'x', drafted: '' }, commitSel: 0 }],
      ['sheet', { sheet: { title: 't', body: 'b', ok: 'ok', danger: true } }],
      ['levelUp', { levelUp: { l: 5, t: 'Foreman' } }],
      // What's new · trailers: as this build bundles them, then every trailer failed to play (the text fallback)
      ['whats-new', { whatsNewOpen: true }],
      ['whats-new-fallback', { whatsNewOpen: true, whatsNewMissing: Object.fromEntries(TRAILERS.map((t) => [t.id, true])) }],
      ['whats-new-over-settings', { settingsOpen: true, whatsNewOpen: true }],
      ...[1, 2, 3].map((step) => ['onboard-' + step, { onboard: { step, path: '', dev: 'npm run dev', branch: 'main', name: '' } }]),
    ].filter(Boolean);
    const offsets = M.maxOff > 0 ? [0, M.maxOff] : [0];
    const base = { askHistory: initial.askHistory };

    for (const theme of ['dark', 'light']) {
      for (const off of offsets) {
        for (const v of views) {
          for (const [ov, patch] of overlays) {
            await combo([theme, 'off' + off, v.name, ov].join(' '), () => {
              L.go(v.tab, v.sub);
              if (v.project) L.openProject(v.project);
              L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: off }, patch));
            });
          }
        }
      }
    }
    // Phase 3 states the cross product above doesn't reach: one view each, both themes, both
    // time-machine ends. A few need sample rows the owner's data may lack; those go into the
    // STORE (store.live, never window.hq) and are put back below.
    const LV = W.store.live, savedLive = { captures: LV.captures, canvasBoards: LV.canvasBoards, llm: LV.llm, claudeHub: LV.claudeHub, claudeLib: LV.claudeLib, claudeChat: LV.claudeChat, claudeImport: LV.claudeImport, claudeImports: LV.claudeImports, prompts: LV.prompts, candidates: LV.candidates };
    try {
      const at = (tab, sub, project) => ({ tab, sub, project });
      const clutter = (M.CLUTTER || []).find((c) => c.rows && c.rows.length);
      const cleanText = clutter ? 'Clean up: ' + clutter.rows[0].label : '';
      const gapP = M.P0.find((p) => gapsOf(p).length);
      const gapText = gapP ? gapsOf(gapP)[0].text : '';
      const inter = (M.INTERACTIVE || [])[0];
      const board = () => { LV.canvasBoards = [{ name: 'Selftest Board', nodes: [], edges: [] }]; };
      // H1 Claude Hub card (System > Machine): every state the Hub can be in, injected into the store (never window.hq).
      // The card shows only with a bridge: dev-main.js --preload=fake, or the real app (without one these render it hidden).
      const HUB_COUNTS = { projects: 3, conversations: 40, messages: 900 };
      const HUB = [
        ['none', null],
        ['indexing', { state: 'indexing', role: 'writer', backfill: { done: 8, total: 32 }, counts: HUB_COUNTS, dbBytes: 5 * 1048576 }],
        ['ready', { state: 'ready', role: 'writer', backfill: { done: 32, total: 32 }, counts: HUB_COUNTS, dbBytes: 2048 }],
        ['reader', { state: 'ready', role: 'reader', counts: { projects: 0, conversations: 0, messages: 0 } }],
        ['no-node', { state: 'no-node', node: 'v20.1.0', error: 'Claude Hub needs Node 22.13 or newer (found v20.1.0)' }],
        ['down', { state: 'down', error: 'Claude Hub exited (1)' }],
      ];
      // H2 Claude › Chats: sample Hub rows go into the store (never window.hq); cl* state is patched per combo.
      const CL_READY = { state: 'ready', role: 'writer', counts: HUB_COUNTS };
      const CL_CONVS = [
        { id: 'code:selftest-a', title: 'Selftest chat A', source: 'code', project_id: 'p1', project_name: 'project-a', last_at: new Date(Date.now() - 3600000).toISOString(), message_count: 4, tokens_in: 1200, tokens_out: 800 },
        { id: 'code:selftest-b', title: 'Selftest chat B', source: 'web', project_id: 'p1', project_name: 'project-a', last_at: new Date(Date.now() - 86400000).toISOString(), message_count: 2 },
      ];
      const CL_THREAD = { conversation: { id: 'code:selftest-a', title: 'Selftest chat A', project_name: 'project-a', cwd: null, active_ms: 120000 }, hasMore: true, messages: [
        { id: 'm1', role: 'user', at: new Date().toISOString(), text: 'Hello <b>not html</b>' },
        { id: 'm2', role: 'tool', at: new Date().toISOString(), text: 'tool output' },
        { id: 'm3', role: 'assistant', at: new Date().toISOString(), text: 'Hi' },
      ] };
      const clLib = (o) => () => { LV.claudeHub = CL_READY; LV.claudeLib = { projects: [{ id: 'p1', name: 'project-a', conversations: 2 }], convs: CL_CONVS, convsMore: true, filters: {}, q: '', hits: null, noTerms: false, thread: null, stats: null, error: null, busy: false, ...o }; };
      // Prompt library P1 — Library states (live.prompts as the store leaves it)
      const PR_ROWS = [
        { id: 'prompt:st1', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\review-a-pr.md', title: 'Selftest review prompt', mtime_ms: 1, meta: { tags: ['review'] }, variables: ['project', 'file'] },
        { id: 'prompt:st2', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\weekly.md', title: 'Selftest weekly digest', mtime_ms: 2, meta: {}, variables: [] },
      ];
      const PR_ST = (o = {}) => ({ vault: 'VEEMO CORTEX', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: true, ...o });
      const prLib = (P) => () => { LV.prompts = { rows: null, stats: null, status: null, q: '', hits: null, error: null, statsErr: null, busy: false, ...P }; };
      // P2 harvest candidates (placeholder text)
      const HC1 = 'cand:' + '1'.repeat(40), HC2 = 'cand:' + '2'.repeat(40);
      const HC_ROWS = [
        { key: HC1, text: 'Placeholder prompt one: review the placeholder module and list what to change, file by file.', score: 11, sessions: 3, lastAt: '2026-10-01T10:00:00Z',
          reasons: [{ key: 'reuse', points: 9, text: 'used in 3 sessions' }, { key: 'turns', points: 2, text: 'followed by 8 assistant messages' }],
          sources: [{ kind: 'code', conversationId: 'code:sess-a1', at: '2026-10-01T10:00:00Z', project: 'project-a' }] },
        { key: HC2, text: 'Placeholder prompt two: draft a placeholder plan with steps, owners and checks for each step.', score: -4, sessions: 1, lastAt: '2026-09-01T10:00:00Z',
          reasons: [{ key: 'reuse', points: 0, text: 'seen in 1 session' }, { key: 'library', points: -5, text: 'already a prompt note' }],
          sources: [{ kind: 'chatgpt', conversationId: 'chatgpt:placeholder-1', at: '2026-09-01T10:00:00Z', project: null }] },
      ];
      const hcLive = (o = {}) => () => { LV.candidates = { rows: HC_ROWS.slice(), pooled: { messages: 42, history: 17 }, capped: { messages: false, history: false }, hidden: 0, error: null, busy: false, loaded: true, ...o }; };
      const HC_ITEM = (key, title) => ({ key, title, text: 'Placeholder prompt text.', source: { kind: 'code', conversation: 'code:sess-a1', at: '2026-10-01T10:00:00Z' } });
      const hcDlg = (phase, o = {}) => ({ prView: 'candidates', promote: { seq: 1, keys: [HC1], items: [HC_ITEM(HC1, 'Placeholder prompt one')], phase, clash: null, results: [], error: null, ...o } });
      const STATES = [
        ['ask-empty', at('home'), { askOpen: true, askHistory: [] }],
        ['ask-streaming', at('home'), { askOpen: true, askHistory: ASK_STREAMING }],
        ['ask-offline', at('home'), { askOpen: true, askHistory: [] }, () => { LV.llm = { available: false, reason: 'selftest: runtime down' }; }],
        ['ask-offline-checking', at('home'), { askOpen: true, askChecking: true, askHistory: [] }, () => { LV.llm = { available: true, runtime: 'selftest', chatModel: null }; }],
        ['ask-claude', at('home'), { askOpen: true, askHistory: ASK_CLAUDE }],   // askInclude is not a CLEAR key: leave the chips alone
        ['vault-drafting', at('home'), { vault: { id: 'code:selftest', phase: 'drafting' } }],
        ['vault-ready-replace', at('home'), { vault: Object.assign({}, VAULT_DRAFT, { phase: 'ready', exists: true, askReplace: true, saveError: 'A note with this name appeared after the draft was made.' }) }],
        ['vault-error', at('home'), { vault: { id: 'code:selftest', phase: 'error', error: 'selftest: the local model isn’t running' } }],
        ['vault-saved', at('home'), { vault: Object.assign({}, VAULT_DRAFT, { phase: 'saved', exists: false }) }],
        ['palette-capture', at('home'), { paletteOpen: true, paletteMode: 'go', paletteQuery: 'capture A selftest idea' }],
        ['system-examining', at('system', 'machine'), { sysExamining: true }],
        ['system-fixed', at('system', 'machine'), { fixed: M.ISSUES.map((i) => i.id).concat(['llm']) }],
        ...HUB.map(([n, h]) => ['hub-' + n, at('system', 'machine'), {}, () => { LV.claudeHub = h; }]),
        ...['saving', 'noted', 'failed'].map((st) => cleanText && ['clutter-' + st, at('system', 'clutter'), { sysSaves: { [cleanText]: st } }]),
        ['project-security', at('projects', 'grid', (M.P0[0] || {}).id), { diagTab: 'security' }],
        ...['saving', 'noted', 'failed'].map((st) => gapP && ['project-gaps-' + st, at('projects', 'grid', gapP.id), { sysSaves: { [gapText]: st } }]),
        ['auto-interactive', at('automations', 'runnable'), { libKind: 'interactive' }],
        ['auto-skills', at('automations', 'runnable'), { libSource: 'skill', libShow: 400 }],
        ['auto-category', at('automations', 'runnable'), { libSchool: (M.AUTOS[0] || {}).cat || 'Other' }],
        ['auto-none', at('automations', 'runnable'), { autoQuery: 'zzz-selftest-none' }],
        ['auto-rescanning', at('automations', 'runnable'), { libRescanning: true }],
        inter && ['confirm-interactive', at('automations', 'runnable'), { confirm: inter.id, confirmAsk: 'always' }],
        ['projects-risk', at('projects', 'grid'), { projStatus: 'risk' }],
        ['projects-none', at('projects', 'grid'), { projSearch: 'zzz-selftest-none' }],
        ['canvas-note', at('claude', 'canvas'), { canvasNoteOpen: true, canvasDraft: 'A selftest note' }, board],
        ['canvas-note-saving', at('claude', 'canvas'), { canvasNoteOpen: true, canvasDraft: 'A selftest note', canvasSaving: true }, board],
        ['chats-list', at('claude', 'chats'), {}, clLib({})],
        ['chats-empty-nobridge', at('claude', 'chats'), {}, () => { LV.claudeHub = null; LV.claudeLib = { ...LV.claudeLib, convs: null }; }],
        ['chats-filtered-none', at('claude', 'chats'), { clSrc: 'web', clSince: '7' }, clLib({ convs: [], convsMore: false })],
        ['chats-search-hits', at('claude', 'chats'), { clSearched: true, clQuery: 'img' }, clLib({ q: 'img', hits: [{ conversationId: 'code:selftest-a', messageId: 'm1', title: 'Selftest chat A', at: new Date().toISOString(), snippet: 'a \u0002<img src=x>\u0003 b' }] })],
        ['chats-search-none', at('claude', 'chats'), { clSearched: true, clQuery: 'zzz' }, clLib({ q: 'zzz', hits: [] })],
        ['chats-composer-new', at('claude', 'chats'), { ccOpen: true }, clLib({})],
        ['chats-composer-edits', at('claude', 'chats'), { ccOpen: true, ccMode: 'edits', ccText: 'hello' }, clLib({})],
        ['chats-composer-continue', at('claude', 'chats'), { ccOpen: true, ccConv: 'code:selftest-a', clOpen: true }, clLib({ thread: CL_THREAD })],
        ['chats-thread', at('claude', 'chats'), { clOpen: true }, clLib({ thread: CL_THREAD })],
        ['chats-thread-tool-open', at('claude', 'chats'), { clOpen: true, clExpanded: { m2: true } }, clLib({ thread: CL_THREAD })],
        ['chats-forget-ask', at('claude', 'chats'), { clOpen: true, clForgetAsk: true }, clLib({ thread: CL_THREAD })],
        ['chats-thread-gone', at('claude', 'chats'), { clOpen: true }, clLib({ thread: { missing: 'code:x' } })],
        ['chats-error', at('claude', 'chats'), {}, clLib({ error: 'Claude Hub: selftest error' })],
        // Task 11: the brief's cl-* combos (hostile snippet, Projects link pick, History activity, project-page section)
        ['cl-chats-empty', at('claude', 'chats'), {}, clLib({ convs: [], convsMore: false })],
        ['cl-chats-rows', at('claude', 'chats'), {}, clLib({})],
        ['cl-chats-hits-hostile', at('claude', 'chats'), { clSearched: true, clQuery: 'img' }, clLib({ q: 'img', hits: [{ conversationId: 'code:selftest-a', messageId: 'm', title: 'Selftest chat A', at: new Date().toISOString(), snippet: '\u0002<img src=x onerror=alert(1)>\u0003 tail \u0002open' }] })],
        ['cl-thread-open', at('claude', 'chats'), { clOpen: true }, clLib({ thread: CL_THREAD })],
        // Claude Hub H5 — Save to vault dialog (logic/claude-vault.js): every phase over the open thread
        ...(() => {
          const base = { id: 'code:selftest-a', phase: 'ready', path: 'C:/placeholder-vault/30_Areas/Claude/project-a/2026-10-01 Selftest chat.md', rel: '30_Areas/Claude/project-a/2026-10-01 Selftest chat.md', draft: '# Selftest chat\nPlaceholder note text.', exists: false, model: 'selftest-model', basis: 3, askReplace: false, saveError: null };
          return [['drafting', { id: base.id, phase: 'drafting' }], ['ready', base],
            ['ask-replace', { ...base, exists: true, askReplace: true, saveError: 'A note with this name appeared after the draft was made.' }],
            ['saving', { ...base, phase: 'saving' }], ['saved', { ...base, phase: 'saved' }],
            ['error', { id: base.id, phase: 'error', error: 'selftest: the local model isn’t running' }],
          ].map(([n, vault]) => ['cl-vault-' + n, at('claude', 'chats'), { clOpen: true, vault }, clLib({ thread: CL_THREAD })]);
        })(),
        ['cl-thread-forget-ask', at('claude', 'chats'), { clOpen: true, clForgetAsk: true, clExpanded: { m2: true } }, clLib({ thread: CL_THREAD })],
        ['cl-projects', at('claude', 'projects'), { clLinkPick: 'p1' }, clLib({ projects: [{ id: 'p1', name: 'project-a', path: 'C:\placeholder\project-a', conversations: 2, last_at: CL_CONVS[0].last_at, hq_project_id: (M.P0[0] || {}).id || null, link_state: 'auto' }] })],
        ['cl-history-activity', at('history', 'trends'), {}, clLib({ stats: { from: '2026-09-06', to: '2026-10-05', tzOffsetMin: 0, days: [{ day: '2026-10-04', chats: 1, messages: 3, active_ms: 60000 }], projects: [{ project_id: 'p1', name: 'project-a', chats: 1, tokens_in: 5, tokens_out: 9, tokens_cache_read: 0, tokens_cache_write: 0 }], totals: { chats: 1, active_ms: 60000, tokens_in: 5, tokens_out: 9, tokens_cache_read: 0, tokens_cache_write: 0 } } })],
        M.P0[0] && ['cl-page-chats', at('projects', 'grid', M.P0[0].id), {}, () => { clLib({})(); LV.claudeLib.byHq = { [M.P0[0].id]: CL_CONVS }; }],
        ['prompts-list', at('claude', 'prompts'), {}, prLib({ rows: PR_ROWS, stats: [{ prompt_id: 'prompt:st1', uses: 2, last_at: '2026-10-01T10:00:00Z' }], status: PR_ST() })],
        ['prompts-no-obsidian', at('claude', 'prompts'), {}, prLib({ rows: PR_ROWS, stats: [], status: PR_ST({ obsidian: false }) })],
        ['prompts-nofolder', at('claude', 'prompts'), {}, prLib({ rows: [], stats: [], status: PR_ST({ folder: { exists: false } }) })],
        ['prompts-folder-error', at('claude', 'prompts'), {}, prLib({ rows: [], stats: [], status: PR_ST({ folder: { exists: false, error: '40_Resources/Prompts leads outside the vault — refusing' } }) })],
        ['prompts-empty', at('claude', 'prompts'), {}, prLib({ rows: [], stats: [], status: PR_ST() })],
        ['prompts-error', at('claude', 'prompts'), {}, prLib({ rows: PR_ROWS, error: 'Claude Hub: hub not running', status: PR_ST() })],
        ['prompts-nohits', at('claude', 'prompts'), { prQuery: 'zzz', prSearched: true }, prLib({ rows: PR_ROWS, stats: [], status: PR_ST(), q: 'zzz', hits: [] })],
        ['prompts-for-project', at('claude', 'prompts'), { prFor: (M.P0[0] || {}).id || null }, prLib({ rows: PR_ROWS, stats: [], status: PR_ST() })],
        ['project-run-a-prompt', at('projects', 'grid', (M.P0[0] || {}).id), {}, prLib({ rows: PR_ROWS, stats: [], status: PR_ST() })],
        ['cand-list', at('claude', 'prompts'), { prView: 'candidates', hcSel: [HC1] }, hcLive()],
        ['cand-loading', at('claude', 'prompts'), { prView: 'candidates' }, hcLive({ rows: null, busy: true })],
        ['cand-empty', at('claude', 'prompts'), { prView: 'candidates' }, hcLive({ rows: [], pooled: { messages: 12, history: 3 } })],
        ['cand-error', at('claude', 'prompts'), { prView: 'candidates' }, hcLive({ error: 'Claude Hub: timeout' })],
        ['cand-capped', at('claude', 'prompts'), { prView: 'candidates' }, hcLive({ capped: { messages: true, history: true }, hidden: 3 })],
        ['promote-ask-single', at('claude', 'prompts'), hcDlg('ask'), hcLive()],
        ['promote-ask-multi', at('claude', 'prompts'), hcDlg('ask', { keys: [HC1, HC2], items: [HC_ITEM(HC1, 'Placeholder prompt one'), HC_ITEM(HC2, 'Placeholder prompt two')] }), hcLive()],
        ['promote-saving', at('claude', 'prompts'), hcDlg('saving'), hcLive()],
        ['promote-clash', at('claude', 'prompts'), hcDlg('clash', { clash: { next: 'placeholder-prompt-one-2.md' } }), hcLive()],
        ['promote-done', at('claude', 'prompts'), hcDlg('done', { results: [{ title: 'Placeholder prompt one', ok: true, name: 'placeholder-prompt-one.md' }, { title: 'Placeholder prompt two', ok: false, error: 'not written — a note with that name is there; promote it alone to save it as placeholder-prompt-two-2.md' }] }), hcLive()],
        // Claude Hub H3 — composer (logic/claude-chat.js): every visible state, both themes, both snapshot ends
        ...(() => {
          const SID = '00000000-0000-4000-8000-000000000001';
          const turn = (o) => ({ turnId: 'st-1', convId: 'code:' + SID, projectId: null, prompt: 'Placeholder question', mode: 'read-only', status: 'running',
            items: [{ type: 'text', text: 'Placeholder answer' }, { type: 'tool', name: 'Read', hint: 'README.md' }], sessionId: SID, usage: null, error: null, seeded: null,
            startedAt: Date.now(), endedAt: null, ...o });
          const cont = { ccOpen: true, ccConv: 'code:' + SID };
          const firstProj = (M.P0[0] || {}).id || '';
          return [
            ['cc-new-empty', at('claude', 'chats'), { ccOpen: true }],
            ['cc-new-picked', at('claude', 'chats'), { ccOpen: true, ccProj: firstProj, ccText: 'Placeholder question' }],
            ['cc-streaming', at('claude', 'chats'), cont, () => { LV.claudeChat = { turns: [turn()] }; }],
            ['cc-stopped', at('claude', 'chats'), cont, () => { LV.claudeChat = { turns: [turn({ status: 'stopped', endedAt: Date.now() })] }; }],
            ['cc-error', at('claude', 'chats'), cont, () => { LV.claudeChat = { turns: [turn({ status: 'error', error: 'stopped after 10 min', endedAt: Date.now() })] }; }],
            ['cc-edits-done', at('claude', 'chats'), { ...cont, ccMode: 'edits' }, () => { LV.claudeChat = { turns: [turn({ mode: 'edits', status: 'done', usage: { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 }, endedAt: Date.now() })] }; }],
            ['cc-seeded', at('claude', 'chats'), cont, () => { LV.claudeChat = { turns: [turn({ seeded: { chars: 30000, trimmed: true } })] }; }],
            ['ci-running', at('claude', 'chats'), {}, () => { LV.claudeImport = { kind: 'import', phase: 'conversations', done: 12, total: 0 }; }],
            ['ci-done', at('claude', 'chats'), {}, () => { LV.claudeImport = { kind: 'import', phase: 'done', done: 5, total: 5, report: { conversations: { seen: 5, imported: 3, unchanged: 0, forgotten: 0, skipped: 2 }, messages: { imported: 5, skipped: 1, empty: 1 }, projects: { seen: 2, imported: 1, unchanged: 0, forgotten: 0, skipped: 1 }, unknownFields: { mystery_field: 1 }, truncated: false } }; }],
            ['ci-failed', at('claude', 'chats'), {}, () => { LV.claudeImport = { kind: 'import', phase: 'failed', done: 0, total: 0, error: 'not a zip file' }; }],
            ['h6-doc-hits', at('claude', 'chats'), {}, clLib({ q: 'tea', hits: [], docHits: [{ id: 'memory:1', source: 'memory', title: 'Tea rule', snippet: 'offer \u0002tea\u0003', mtime_ms: 1759320000000 }, { id: 'claude-md:2', source: 'claude-md', title: 'CLAUDE.md — p', snippet: '\u0002tea\u0003', mtime_ms: 1759320000000 }] })],
            ['h6-doc-open', at('claude', 'chats'), {}, clLib({ doc: { id: 'memory:1', source: 'memory', title: 'Tea rule', text: 'line one\n\nline two', project_path: 'C:\\fake\\p', mtime_ms: 1759320000000 } })],
            ['h6-doc-loading', at('claude', 'chats'), {}, clLib({ doc: { id: 'memory:1', loading: true } })],
            ['h6-doc-error', at('claude', 'chats'), {}, clLib({ doc: { id: 'memory:1', error: 'That document is no longer in the index (its file was removed or it was forgotten).' } })],
            ['h6-drop-card', at('claude', 'chats'), {}, () => { LV.claudeImports = { folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [{ dropId: 'd1', file: 'chatgpt-export.zip', bytes: 39845888, kind: 'chatgpt' }, { dropId: 'd2', file: 'claude.zip', bytes: 1000, kind: 'claude' }], refused: [], error: null }; }],
            ['h6-drop-card-reader', at('home'), {}, () => { LV.claudeHub = { ...(LV.claudeHub || {}), state: 'ready', role: 'reader' }; LV.claudeImports = { folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [{ dropId: 'd1', file: 'chatgpt-export.zip', bytes: 1, kind: 'chatgpt' }], refused: [], error: null }; }],
            ['h6-system-report', at('system', 'machine'), {}, () => { LV.claudeHub = { state: 'ready', role: 'writer', counts: { projects: 1, conversations: 4, messages: 10, documents: 5 }, lastImport: { at: '2026-10-25T10:00:00Z', ok: true, source: 'chatgpt', report: { source: 'chatgpt', conversations: { imported: 4, unchanged: 0, forgotten: 0, skipped: 3 }, messages: { imported: 10, skipped: 0, empty: 1 }, branches: { skipped: 2 }, files: { other: ['chat.html'] }, memory: { found: false, imported: 0 } } } }; LV.claudeImports = { folder: { exists: false, name: 'WorkspaceHQ Imports' }, found: [], refused: [{ file: 'photos.zip', error: 'Not a ChatGPT or claude.ai export (looked for conversations.json)' }], error: null }; }],
            ['h6-chatgpt-filter', at('claude', 'chats'), { clSrc: 'chatgpt' }, clLib({ convs: [] })],
            ['cc-web', at('claude', 'chats'), { ccOpen: true, ccConv: 'web:st-web' }, () => { LV.claudeLib = { ...LV.claudeLib, thread: { conversation: { id: 'web:st-web', source: 'web', title: 'Selftest web chat', project_id: 'web:chats' }, messages: [], hasMore: false }, projects: [{ id: 'web:chats', source: 'web', hq_project_id: null }] }; }],
          ];
        })(),
        ['canvas-no-boards', at('claude', 'canvas'), { canvasNoteOpen: true }, () => { LV.canvasBoards = []; }],
      ].filter(Boolean);
      for (const theme of ['dark', 'light']) {
        for (const off of offsets) {
          for (const [name, v, patch, live] of STATES) {
            await combo([theme, 'off' + off, 'p3:' + name].join(' '), () => {
              Object.assign(LV, savedLive);
              if (live) live();
              L.go(v.tab, v.sub);
              if (v.project) L.openProject(v.project);
              L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: off }, patch));
            });
          }
        }
        // Studio with captures: real files only (a missing file logs an error-level load
        // failure). The snip is the app icon; the "recording" points at that same PNG, which
        // a <video> can't decode: the lightbox's "couldn't load" path. It has a thumbnail.
        Object.assign(LV, savedLive);
        L.go('studio'); L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }));
        await rendered(); await sleep(250);   // the tab change's refreshCaptures lands before the sample rows go in
        const icon = decodeURIComponent(new URL('icons/hq-256.png', location.href).pathname).replace(/^\/([A-Za-z]:)/, '$1');
        const now = Date.now();
        const caps = [
          { id: icon, path: icon, kind: 'snip', recovered: false, name: 'selftest-snip.png', day: 'Today', time: '09:00', size: '1 KB', thumb: null, mtime: now },
          { id: icon + '#rec', path: icon, kind: 'rec', recovered: true, name: 'selftest-rec.webm', day: 'Today', time: '08:00', size: '2 MB', thumb: PIXEL, mtime: now - 3600000 },
        ];
        for (const [name, patch] of [['studio-all', {}], ['studio-rec', { studioFilter: 'rec' }], ['lightbox-snip', { lightbox: caps[0].id }], ['lightbox-rec', { lightbox: caps[1].id }]]) {
          await combo([theme, 'p3:' + name].join(' '), () => {
            LV.captures = caps;
            L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }, patch));
          });
          await sleep(80);   // this combo's image / video load and error events fire inside it
        }
      }
    } finally {
      Object.assign(LV, savedLive);
    }

    // preview states (loading / error / nobridge / live) only change the shell and body
    for (const state of ['loading', 'error', 'nobridge', 'live']) {
      for (const theme of ['dark', 'light']) {
        for (const [ov, patch] of overlays) {
          await combo(['state:' + state, theme, ov].join(' '), () => {
            W.app.setProps({ previewState: state, errorText: state === 'error' ? 'selftest: synthetic error text' : initialProps.errorText });
            L.go('home');
            L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }, patch));
          });
        }
      }
    }
    await sleep(300);   // stragglers: timers and frames the last combos queued
  } catch (e) {
    note('selftest crashed', [e]);
  } finally {
    // the app first (its componentDidUpdate rewrites prefs + place), then storage
    label = 'restore';
    try {
      if (L) {
        W.app.setProps(initialProps);
        L.setState(initial);
        await rendered();
      }
    } catch (e) { note('restore failed', [e]); }
    restore(localStorage, savedLocal); restore(sessionStorage, savedSession);
    console.error = origError;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }
  const summary = { combos: stats.combos, errors: stats.errors, unresolved: W ? W.unresolved.size : -1, failures: W && W.failures ? W.failures.count : -1 };
  const detail = { ms: Math.round(performance.now() - t0), samples, holes: [...holes].map(([k, at]) => k + ' @ ' + at), lastFailure: W && W.failures ? W.failures.last : '' };
  window.__selftestDetail = detail;
  console.log('[selftest:detail] ' + JSON.stringify(detail));
  console.log('[selftest] ' + JSON.stringify(summary));
  window.__selftest = summary;
  return summary;
}

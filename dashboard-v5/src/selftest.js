// ?selftest=1 (loaded by boot.js; dev-main.js --selftest turns its last line
// into an exit code). Renders every combination the screen can be in —
// theme × time-machine end (live, oldest) × every tab and sub-tab plus the
// first project's page × every overlay, then preview states × theme × overlay
// on Home — and counts what broke:
//   errors      console.error calls, uncaught errors, unhandled rejections,
//               and the store's failed-read count (boot reads included)
//   unresolved  template bindings that never resolved (WHQ.unresolved, boot included)
//   failures    runtime render failures (WHQ.failures, boot included)
// Read-only by construction: it drives setState / go / openProject / setProps
// only and never touches window.hq. setState persists prefs and place, so
// those storage keys are snapshotted first and put back at the end.
import { NAV, SUBS } from './live/catalog.mjs';
import { TRAILERS } from './logic/whats-new.js';
import { gapsOf } from './live/adapter.mjs';
import { cosInitState } from './logic/cosmos.js';

// + Ask's chat and sources (v3's keys, contract K-1): Ask saves them itself, so a combo must not leave its sample behind
const LOCAL_KEYS = ['whq3-prefs', 'hq-theme', 'hq-theme-migrated', 'hq-oracle-chat', 'hq-oracle-include', 'hq-claude-lib'], SESSION_KEYS = ['whq3-place'];
// every overlay closed; applied before each combo so combos never stack
const CLEAR = { paletteOpen: false, paletteMode: 'go', paletteQuery: '', paletteSel: 0, askOpen: false, runsOpen: false, scrubOpen: false, settingsOpen: false, cheatOpen: false, moreOpen: false, ambientOverlay: false, focus: null, confirm: null, commit: null, sheet: null, levelUp: null, onboard: null, vault: null, lightbox: null, pageMore: false, whatsNewOpen: false, whatsNewMissing: {}, clSrc: 'all', clProj: '', clSince: 'all', clQuery: '', clSearched: false, clOpen: false, clExpanded: {}, clForgetAsk: false, clLinkPick: '', ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false,
  // Phase 3 surface state (app.js initState, contract K-4), back to its defaults before every combo
  sysExamining: false, sysSaves: {}, fixed: [], libKind: 'all', libSource: 'all', libSchool: 'all', libShow: 40, libRescanning: false, autoQuery: '',
  projSearch: '', projStatus: 'all', askChecking: false, mny: {}, mst: {}, dlv: {}, dlvBusy: false, brfBusy: false, cls: null, batOpen: null, batBal: '', batBusy: false, batDone: {},
  // Reach (Settings): the loaded rows and their errors, back to unloaded before every combo
  rchRows: null, rchAt: null, rchError: '', rchBusy: false,
  // Money for Claude sessions (Settings): the switch as main last said it, back to unloaded before every combo
  macOn: false, macLoaded: false, macAskedAt: null, macBusy: false, macErr: '' };
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
    // the money fixture (tools/money.fake-views.json): a JSON module — fetch() can't read file:// in Electron
    const MONEY = (await import('../tools/money.fake-views.json', { with: { type: 'json' } })).default;
    // the Cosmos states (src/selftest-cosmos.mjs) run on the invented library generator (tools/cosmos-fixture.mjs): the readable copy, no JSON file
    const { cosmosStates, COSMOS_OFFLINE_ROWS, COSMOS_SCRUBBED_ROWS } = await import('./selftest-cosmos.mjs');
    const { fakeCosmos } = await import('../tools/cosmos-fixture.mjs');
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
    const LV = W.store.live, savedLive = { llm: LV.llm, claudeHub: LV.claudeHub, claudeLib: LV.claudeLib, claudeChat: LV.claudeChat, money: LV.money, brief: LV.brief, board: LV.board, delivery: LV.delivery, cosmos: LV.cosmos };
    try {
      const at = (tab, sub, project) => ({ tab, sub, project });
      const clutter = (M.CLUTTER || []).find((c) => c.rows && c.rows.length);
      const cleanText = clutter ? 'Clean up: ' + clutter.rows[0].label : '';
      const gapP = M.P0.find((p) => gapsOf(p).length);
      const gapText = gapP ? gapsOf(gapP)[0].text : '';
      const inter = (M.INTERACTIVE || [])[0];
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
        ['index-only', { state: 'ready', role: 'writer', backfill: { done: 32, total: 32 }, counts: HUB_COUNTS, dbBytes: 2048, indexOnly: 47 }],   // recall dish: Reindex says why before any click
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
            ['h6-doc-hits', at('claude', 'chats'), {}, clLib({ q: 'tea', hits: [], docHits: [{ id: 'memory:1', source: 'memory', title: 'Tea rule', snippet: 'offer \u0002tea\u0003', mtime_ms: 1759320000000 }, { id: 'claude-md:2', source: 'claude-md', title: 'CLAUDE.md — p', snippet: '\u0002tea\u0003', mtime_ms: 1759320000000 }] })],
            ['h6-doc-open', at('claude', 'chats'), {}, clLib({ doc: { id: 'memory:1', source: 'memory', title: 'Tea rule', text: 'line one\n\nline two', project_path: 'C:\\fake\\p', mtime_ms: 1759320000000 } })],
            ['h6-doc-loading', at('claude', 'chats'), {}, clLib({ doc: { id: 'memory:1', loading: true } })],
            ['h6-doc-error', at('claude', 'chats'), {}, clLib({ doc: { id: 'memory:1', error: 'That document is no longer in the index (its file was removed or it was forgotten).' } })],
            ['cc-web', at('claude', 'chats'), { ccOpen: true, ccConv: 'web:st-web' }, () => { LV.claudeLib = { ...LV.claudeLib, thread: { conversation: { id: 'web:st-web', source: 'web', title: 'Selftest web chat', project_id: 'web:chats' }, messages: [], hasMore: false }, projects: [{ id: 'web:chats', source: 'web', hq_project_id: null }] }; }],
          ];
        })(),
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
        // Money: every load state + every inline form / flag the cross product doesn't reach (space-port-money)
        const MV = { ready: { view: MONEY.full, error: '', loaded: true }, empty: { view: MONEY.empty, error: '', loaded: true },
          error: { view: null, error: 'selftest: synthetic read error', loaded: true }, loading: { view: null, error: '', loaded: false } };
        const o0 = MONEY.full.obligations[0], j0 = MONEY.full.jars[0], promo = MONEY.full.slips.find((c) => c.warn);
        for (const [name, sub, money, mny, extra] of [
          ['money-empty', 'today', MV.empty, {}],
          ['money-error', 'today', MV.error, {}],
          ['money-loading', 'today', MV.loading, {}],
          ['money-acct-new', 'today', MV.ready, { acct: { name: '', currency: 'DA', balance: '' } }],
          ['money-acct-confirm', 'today', MV.ready, { acct: { id: MONEY.full.accounts[1].id, name: 'Card', currency: 'USD', balance: '' } }],
          ['money-ask', 'today', MV.ready, { ask: { type: 'account-archive', payload: { id: 'x' }, question: 'Archive Cash? Its history stays.' } }],
          ...(M.maxOff > 0 ? [['money-scrubbed', 'today', MV.ready, {}, { snapOffset: 1 }]] : []),
          ['money-bill-new', 'runway', MV.ready, { bill: { name: '', amount: '', currency: 'DA', kind: 'bill', cadence: 'monthly', firstDue: '2026-11-20', accountId: '' } }],
          ['money-bill-installment', 'runway', MV.ready, { bill: { name: 'Phone plan', amount: '4000', currency: 'DA', kind: 'installment', cadence: 'monthly', firstDue: '2026-11-15', accountId: '', installmentTotal: '12', paidBefore: '4' } }],
          ['money-pay-open', 'runway', MV.ready, { pay: { id: o0.id, amount: '', accountId: '' } }],
          ['money-runway-empty', 'runway', MV.empty, {}],
          ['money-jar-new', 'jars', MV.ready, { jar: { name: '', target: '', targetDate: '' } }],
          ['money-jar-move', 'jars', MV.ready, { move: { jarId: j0.id, kind: 'withdraw', amount: '' } }],
          ['money-jar-cover', 'jars', MV.ready, { cover: { toJarId: j0.id, fromJarId: '', amount: '500' } }],
          ['money-payday-open', 'jars', MV.ready, { payday: { amount: '', accountId: '' } }],
          ['money-jars-empty', 'jars', MV.empty, {}],
          ['money-slip-armed', 'inbox', MV.ready, { armed: { [promo.id]: true } }],
          ['money-inbox-empty', 'inbox', MV.empty, {}],
          // money in one minute (the start card, empty view) and the quick line (Today with accounts): typed values, saving, a refusal, the dry preview chip, a slip, a refused line
          ['mst-empty', 'today', MV.empty, {}, { mst: {} }],
          ['mst-saving', 'today', MV.empty, {}, { mst: { card: { cashDA: '12 000', cardUSD: '40.50', fx: '245', payday: '25' }, saving: true } }],
          ['mst-refused', 'today', MV.empty, {}, { mst: { card: { cashDA: '12 000', payday: '31' }, refused: 'payday is a day from 1 to 28.' } }],
          ['mny-quick-preview', 'today', MV.ready, {}, { mst: { line: '150 cafe', preview: { kind: 'log', amount: 150, currency: 'DA', category: 'Food', account: 'Cash', date: '2026-11-05', label: '150 DA · Food · Cash', reason: '' } } }],
          ['mny-quick-slip', 'today', MV.ready, {}, { mst: { line: '$12.49 netflix card', preview: { kind: 'slip', amount: 12.49, currency: 'USD', category: 'Other', account: 'Card', date: '2026-11-05', label: '$12.49 · Other · Card', reason: 'needs your DA rate' } } }],
          ['mny-quick-refused', 'today', MV.ready, {}, { mst: { line: 'hello', preview: { kind: 'none', amount: null, currency: '', category: '', account: '', date: '', label: '', reason: 'type it like 150 cafe' }, lineError: 'type it like 150 cafe' } }],
          ['mny-quick-note', 'today', MV.ready, {}, { mst: { note: 'logged 150 DA · Food · Cash — undo in Recent' } }],
        ]) {
          // arriving on money (or another sub) re-reads it (app.js componentDidUpdate): let that answer land first
          if (L.state.tab !== 'money' || L.state.sub.money !== sub) { L.go('money', sub); await rendered(); await sleep(250); }
          await combo([theme, 'p3:' + name].join(' '), () => {
            LV.money = money;
            L.go('money', sub); L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0, mny }, extra || {}));
          });
        }
        // Cosmos (key 0): every state of the Feed, its dialogs and the honest blocks (src/selftest-cosmos.mjs; the invented library, never the owner's).
        // The slice is put straight into the store and the arrival read is held (the fake's own answer would replace it); cosmos-offline hides
        // hq.cosmos for one combo (the store's hq, never window.hq). CLEAR does not cover the cos* keys, so cosInitState() is spread first.
        for (const [name, sub, cosLive, cs, extra] of cosmosStates(fakeCosmos())) {
          if (COSMOS_SCRUBBED_ROWS.includes(name) && !(M.maxOff > 0)) continue;
          const hq3 = W.store.hq, rc0 = W.store.refreshCosmos;
          try {
            await combo([theme, 'p3:' + name].join(' '), () => {
              if (COSMOS_OFFLINE_ROWS.includes(name) && hq3) W.store.hq = Object.assign({}, hq3, { cosmos: undefined });
              W.store.refreshCosmos = () => Promise.resolve({});
              LV.cosmos = cosLive;
              L.go('cosmos', sub);
              L.setState(Object.assign({}, CLEAR, base, cosInitState(), { themePref: theme, snapOffset: 0 }, cs, extra || {}));
            });
          } finally { W.store.hq = hq3; W.store.refreshCosmos = rc0; }
        }
        // Operator Brief (heads Home): every load state, 1-3 items of each severity, +more, source errors, busy
        const bItem = (key, severity, action) => ({ key, rule: key.split(':')[0], severity, text: 'Selftest ' + severity + ' item', why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action });
        const BI = [bItem('secrets:p:1', 'high', { kind: 'go', tab: 'projects', projectId: (M.P0[0] || {}).id || 'p' }), bItem('scan-stale:d', 'med', { kind: 'scan' }), bItem('claude-sync:0:never', 'low', { kind: 'go', tab: 'claude', sub: 'chats' })];
        const BV = (items, more = 0, errors = [], overflow) => ({ brief: Object.assign({ v: 1, generatedAt: '2026-11-05T09:00:00.000Z', items, more, errors }, overflow ? { overflow } : {}), error: '', loaded: true });
        // the senses' items: CI, a failed prod deploy, a waiting pull request (their actions land on Projects › GitHub / Vercel & Supabase)
        const sItem = (key, severity, text, sub, count = 0) => Object.assign(bItem(key, severity, { kind: 'go', tab: 'projects', sub }), { text, count, source: sub === 'accounts' ? 'vercel' : 'github' });
        const SI = [sItem('prod-deploy-error:placeholder-site:d', 'high', 'placeholder-site failed to deploy to production', 'accounts'), sItem('ci-red:o/r:d', 'med', 'CI is failing on placeholder-repo and 2 more repos', 'github', 2), sItem('review-waiting:d', 'low', '2 pull requests are waiting on you', 'github', 1)];
        // standing: items unchanged for 3 days that stepped aside (brief-core.mjs); the Home line names each one and keeps it clickable
        const STD = [Object.assign(bItem('ci-red:o/r:d1', 'med', { kind: 'go', tab: 'projects', sub: 'github' }), { text: 'CI is failing on placeholder-repo', since: '2026-11-05T09:00:00.000Z' }), Object.assign(bItem('dirty:p:12', 'low', { kind: 'go', tab: 'projects', projectId: (M.P0[0] || {}).id || 'p' }), { text: 'Placeholder project has 12 uncommitted files', since: '2026-11-06T09:00:00.000Z' })];
        const BSTD = (items, standing, more = 0) => { const v = BV(items, more); v.brief.standing = standing; return v; };
        // act in place (batch 2): the rows that carry a verb (quest-red, money-stale, dirty, session-waiting), the inline confirm, the balance field, the done line, busy
        const aText = (it, text, extra) => Object.assign({}, it, { text }, extra || {});
        const AQ = aText(bItem('quest-red:wq:selftest', 'high', { kind: 'go', tab: 'tasks' }), 'Selftest critical quest');
        const AM = aText(bItem('money-stale:c1:2026-10-01T10:00:00.000Z', 'med', { kind: 'go', tab: 'money', sub: 'today' }), 'Confirm Selftest Cash — last confirmed 9 days ago');
        const AD = aText(bItem('dirty:p:12', 'low', { kind: 'go', tab: 'projects', projectId: (M.P0[0] || {}).id || 'p' }), 'Selftest Project has 12 uncommitted files');
        const AW = aText(bItem('session-waiting:s1:2026-11-05T08:00:00.000Z', 'med', { kind: 'go', tab: 'claude', sub: 'sessions' }), 'Selftest Studio: a Claude session has waited on a tool for 40 min', { source: 'claude-code', age: 'sessions board' });
        const aDone = new Date(Date.now() - 2 * 60e3).toISOString();
        for (const [name, brief, extra] of [
          ['brief-empty', BV([])],
          ['brief-standing-1', BSTD(BI, STD.slice(0, 1))],
          ['brief-standing-2', BSTD(BI.slice(0, 2), STD, 1)],
          ['brief-standing-only', BSTD([], STD)],
          ['brief-error', { brief: null, error: 'selftest: synthetic brief error', loaded: true }],
          ['brief-loading', { brief: null, error: '', loaded: false }],
          ['brief-1', BV(BI.slice(0, 1))],
          ['brief-2', BV(BI.slice(0, 2))],
          ['brief-3-more', BV(BI, 4)],
          ['brief-source-errors', BV([], 0, [{ source: 'pc-health', error: 'unreadable (selftest)' }])],
          ['brief-busy', BV(BI), { brfBusy: true }],
          ['brief-senses', BV(SI)],
          ['brief-act-verbs', BV([AQ, AD, AW])],
          ['brief-act-money', BV([AM, AD])],
          ['brief-act-quest-confirm', BV([AQ, AD, AW]), { batOpen: AQ.key }],
          ['brief-act-balance-confirm', BV([AM, AD]), { batOpen: AM.key, batBal: '2 500' }],
          ['brief-act-acted', BV([Object.assign({}, AQ, { acted: { verb: 'quest-done', at: aDone } }), AD])],
          ['brief-act-busy', BV([AQ, AW]), { batOpen: AQ.key, batBusy: true }],
          ['brief-overflow', BV(BI, 4, [], SI.slice(1))],
          ['brief-overflow-one', BV(BI, 1, [], SI.slice(2))],
          ['brief-overflow-source-errors', BV(BI, 2, [{ source: 'github', error: 'data/github.json is partial — its checks were skipped' }], SI.slice(0, 2))],
        ]) {
          await combo([theme, 'p3:' + name].join(' '), () => {
            LV.brief = brief;
            L.go('home'); L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }, extra || {}));
          });
        }
        // Reach (Settings): every state of the doors block. The rows are put straight into state and the loader is held (_rchAsked), so the
        // fake's own rows don't replace them; rch-offline hides hq.reach for one combo (the store's hq, never window.hq) and puts it back.
        const RR = (id, ok, extra) => Object.assign({ id, ok, detail: 'Selftest detail for ' + id, who: 'owner' }, extra || {});
        const RCH_OPEN = ['phone-door', 'user-scope', 'bridge', 'tray-icon', 'calls'].map((id) => RR(id, true));
        const RCH_MIXED = [RR('phone-door', false, { step: 'start remote control', copy: 'claude remote-control' }), RR('user-scope', true), RR('bridge', null), RR('tray-icon', false, { step: 'pin the icon in the tray overflow', who: 'owner' }), RR('calls', true)];
        const hq0 = W.store.hq;
        for (const [name, patch, offline] of [
          ['rch-offline', {}, true],
          ['rch-loading', {}],
          ['rch-error', { rchError: 'selftest: synthetic reach error' }],
          ['rch-mixed', { rchRows: RCH_MIXED, rchAt: '2026-11-07T09:00:00.000Z' }],
          ['rch-all-open', { rchRows: RCH_OPEN, rchAt: '2026-11-07T09:00:00.000Z' }],
          ['rch-stale-error', { rchRows: RCH_MIXED, rchAt: '2026-11-07T09:00:00.000Z', rchError: 'selftest: refresh failed' }],
        ]) {
          try {
            await combo([theme, 'p3:' + name].join(' '), () => {
              if (offline && hq0) W.store.hq = Object.assign({}, hq0, { reach: undefined });
              L._rchAsked = true;
              L.go('home'); L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0, settingsOpen: true }, patch));
            });
          } finally { W.store.hq = hq0; L._rchAsked = false; }
        }
        // Money for Claude sessions (Settings, mac*): every state of the switch card. The state is put straight in and the loader is held (_macAsked),
        // so the fake's own answer doesn't replace it; mac-offline hides hq.moneyAccess for one combo (the store's hq, never window.hq).
        for (const [name, patch, offline] of [
          ['mac-offline', {}, true],
          ['mac-loading', {}],
          ['mac-read-error', { macErr: 'selftest: synthetic read error' }],
          ['mac-off-never', { macLoaded: true, macOn: false, macAskedAt: null }],
          ['mac-on-asked', { macLoaded: true, macOn: true, macAskedAt: new Date(Date.now() - 3 * 3600e3).toISOString() }],
          ['mac-on-saving', { macLoaded: true, macOn: true, macBusy: true, macAskedAt: null }],
          ['mac-save-error', { macLoaded: true, macOn: false, macErr: 'selftest: that did not save' }],
        ]) {
          try {
            await combo([theme, 'p3:' + name].join(' '), () => {
              if (offline && hq0) W.store.hq = Object.assign({}, hq0, { moneyAccess: undefined });
              L._macAsked = true;
              L.go('home'); L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0, settingsOpen: true }, patch));
            });
          } finally { W.store.hq = hq0; L._macAsked = false; }
        }
        // Sessions board (Claude › Sessions) and the Home strip: every state of the board. The board is put straight into the store and the
        // arrival refresh is held, so the fake's own board doesn't replace it; sbd-offline hides hq.sessionsBoard for one combo (the store's hq).
        const GEN = '2026-11-07T12:00:00.000Z', NOWMS = Date.parse(GEN), agoIso = (min) => new Date(NOWMS - min * 60e3).toISOString();
        const sCard = (n, state, o) => Object.assign({ id: String(n).repeat(8) + '-1111-4111-8111-111111111111', title: 'Selftest session ' + n, project: { id: n % 2 ? 'alpha' : null, name: n % 2 ? 'alpha-site' : 'scratch', matched: n % 2 ? 'auto' : 'folder' },
          branch: 'main', cwdLabel: 'alpha-site', startedAt: agoIso(300 + n), lastAt: agoIso(5 + n * 3), activeMin: 20 + n, messages: 10 + n, tokens: { in: 1000, out: 2000, cacheRead: 90000 }, state,
          sentence: 'selftest ' + state, longRun: false, canResume: false, canOpen: true }, o || {});
        const SB = (sessions, extra) => Object.assign({ v: 1, generatedAt: GEN, state: 'ok', sessions, nightly: { count: 1, lastAt: agoIso(600) }, codex: { count: 2, lastAt: '2026-11-04T10:00:00.000Z', recent: [{ title: 'Selftest codex thread', updatedAt: '2026-11-04T10:00:00.000Z' }] },
          limitStops: { days: 7, count: 1, last: { kind: 'weekly', at: agoIso(360) } }, counts: { total: sessions.length, week: sessions.length + 1 } }, extra || {});
        const BS = (board) => ({ board, error: '', loaded: true });
        const running = sCard(1, 'running', { lastAt: agoIso(0.5), sentence: 'working now · 4 turns this hour', activeMin: 130, longRun: true });
        const waiting = sCard(2, 'waiting-tool', { lastTool: 'Bash', sentence: 'asked to run Bash 14 min ago — no result since (a permission prompt, or a long tool)' });
        const stopped = sCard(3, 'stopped-mid-tool', { lastAt: agoIso(180), canResume: true, sentence: 'stopped mid-tool: asked to run Edit 3 h ago' });
        const limited = sCard(4, 'limit', { lastAt: agoIso(360), canResume: true, limitKind: 'weekly', resetsAt: '2026-11-08T17:00:00.000Z', sentence: 'stopped at your weekly limit · resets Sat 5 pm' });
        const finished = sCard(5, 'finished', { lastAt: agoIso(90), canResume: true, sentence: 'finished its turn 90 min ago' });
        const quiet = sCard(6, 'quiet', { lastAt: agoIso(500), canResume: false, sentence: 'quiet for 8 h', canOpen: false, why: 'Claude Code deleted this transcript (older than 30 days)' });
        const many = Array.from({ length: 14 }, (_, i) => sCard(i + 1, ['running', 'finished', 'stopped-mid-tool', 'quiet'][i % 4], { lastAt: agoIso(2 + i * 40), canResume: i % 4 !== 0 }));
        const hq1 = W.store.hq, rb0 = W.store.refreshBoard;
        for (const [name, board, where, offline] of [
          ['sbd-offline', BS(null), 'sessions', true],
          ['sbd-loading', { board: null, error: '', loaded: false }, 'sessions'],
          ['sbd-error', { board: null, error: 'selftest: synthetic board error', loaded: true }, 'sessions'],
          ['sbd-hub-down', BS(SB([stopped, finished].map((c) => Object.assign({}, c, { canResume: false, why: 'Claude Hub isn’t running' })), { state: 'hub-down' })), 'sessions'],
          ['sbd-empty', BS(SB([], { nightly: { count: 0, lastAt: null }, codex: null, limitStops: { days: 7, count: 0, last: null } })), 'sessions'],
          ['sbd-working', BS(SB([running])), 'sessions'],
          ['sbd-waiting', BS(SB([waiting])), 'sessions'],
          ['sbd-stopped', BS(SB([stopped, quiet])), 'sessions'],
          ['sbd-limit', BS(SB([limited, finished])), 'sessions'],
          ['sbd-many', BS(SB(many)), 'sessions'],
          ['sbd-home-strip', BS(SB([running, waiting, stopped])), 'home'],
          ['sbd-home-quiet', BS(SB([finished, quiet])), 'home'],
        ]) {
          try {
            await combo([theme, 'p3:' + name].join(' '), () => {
              if (offline && hq1) W.store.hq = Object.assign({}, hq1, { sessionsBoard: undefined });
              W.store.refreshBoard = () => Promise.resolve();
              LV.board = board;
              if (where === 'home') L.go('home'); else L.go('claude', 'sessions');
              L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }));
            });
          } finally { W.store.hq = hq1; W.store.refreshBoard = rb0; }
        }
        // Client delivery card (a project page): every state of the view. The slice is put straight into the store and the arrival read is held
        // (the fake's own answers would replace it); dlv-offline hides hq.delivery for one combo; dlv-app-draft puts text in the add form.
        if (proj) {
          const dIso = (min) => new Date(Date.now() - min * 60e3).toISOString();
          const dView = (o) => Object.assign({ projectId: proj, client: true, mode: 'client', source: 'app', scopeFile: null, sourceLabel: 'a checklist kept in WorkspaceHQ', sourceNote: '', fileState: null, fileDetail: null,
            candidates: [{ rel: 'docs/plan.md', items: 4, done: 1 }], walkTruncated: false, walkError: null,
            milestones: [{ name: 'Design', done: 1, total: 2, items: [{ id: 'i-1', text: 'Selftest home page', done: true }, { id: 'i-2', text: 'Selftest gallery', done: false }] }], done: 1, total: 2, summary: '1 of 2 done', doneSince: [],
            link: { kind: 'preview', url: 'https://selftest-site-abc.vercel.app', state: 'ready', at: dIso(120), branch: 'feat' }, linkWhy: null, update: 'Selftest — update · Still to do (1 of 2): Selftest gallery', lastCopyAt: null }, o || {});
          const DS = (v, error) => ({ byProject: v ? { [proj]: v } : {}, error: error || '', loaded: true });
          const fileMs = [{ name: 'General', done: 2, total: 3, items: [{ text: 'Selftest step 1', done: true }, { text: 'Selftest step 2', done: true }, { text: 'Selftest step 3', done: false }] }];
          const hq2 = W.store.hq, rd0 = W.store.refreshDelivery;
          for (const [name, slice, offline, patch] of [
            ['dlv-offline', DS(null), true],
            ['dlv-loading', { byProject: {}, error: '', loaded: false }],
            ['dlv-error', DS(null, 'selftest: synthetic delivery error')],
            ['dlv-not-client', DS(dView({ client: false, mode: 'none', source: 'none', milestones: [], done: 0, total: 0, summary: '', link: null, update: '' }))],
            ['dlv-no-scope', DS(dView({ source: 'none', milestones: [], done: 0, total: 0, summary: '', link: null, linkWhy: 'No Vercel project linked to this repo', update: '' }))],
            ['dlv-file', DS(dView({ source: 'file', scopeFile: 'SCOPE.md', sourceLabel: 'SCOPE.md', milestones: fileMs, done: 2, total: 3, summary: '2 of 3 done', fileState: 'ok' }))],
            ['dlv-app', DS(dView())],
            ['dlv-app-draft', DS(dView()), false, { dlv: { draft: 'Selftest new item', ms: 'Design' } }],
            ['dlv-plan', DS(dView({ client: false, mode: 'plan', source: 'file', scopeFile: 'docs/plan.md', sourceLabel: 'docs/plan.md — a plan checklist, not the quote', milestones: fileMs, done: 2, total: 3, summary: '2 of 3 done', fileState: 'ok', link: null, update: '' }))],
            ['dlv-file-missing', DS(dView({ source: 'file', scopeFile: 'docs/gone.md', sourceLabel: 'docs/gone.md — a plan checklist, not the quote', fileState: 'missing', fileDetail: 'the file is not there', milestones: [], done: 0, total: 0, summary: '', update: '' }))],
            ['dlv-no-link', DS(dView({ link: null, linkWhy: 'No Vercel project linked to this repo' }))],
            ['dlv-link-building', DS(dView({ link: { kind: 'production', url: 'https://selftest-site.vercel.app', state: 'building', at: dIso(3), branch: 'main' }, lastCopyAt: dIso(600) }))],
          ]) {
            try {
              await combo([theme, 'p3:' + name].join(' '), () => {
                if (offline && hq2) W.store.hq = Object.assign({}, hq2, { delivery: undefined });
                W.store.refreshDelivery = () => Promise.resolve();
                LV.delivery = slice;
                L.go('projects', 'grid'); L.openProject(proj);
                L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }, patch || {}));
              });
            } finally { W.store.hq = hq2; W.store.refreshDelivery = rd0; }
          }
          // Client delivery check (batch 2: the block under the card): every state of the phone-and-language check. The delivery slice says client, the arrival
          // (dckArrive) is held so its own read/probe never replaces the state put straight into dck, and dck-offline hides hq.deliveryCheck for one combo.
          const cIso = (min) => new Date(Date.now() - min * 60e3).toISOString();
          const dReady = { state: 'ready', startedHere: false, candidates: [{ origin: 'http://127.0.0.1:5173', title: 'Selftest Studio' }], hasCommand: true };
          const dNothing = { state: 'nothing-answering', startedHere: false, candidates: [], hasCommand: true };
          const dRep = (o) => Object.assign({ v: 1, at: cIso(120), origin: '127.0.0.1:5173', phone: { width: 390, height: 844, scale: 3 },
            routes: [{ path: '/', locale: 'en', title: 'Selftest Studio', loaded: true, shot: 's-0.png' }, { path: '/fr', locale: 'fr', title: 'Selftest Studio (fr)', loaded: true, shot: 's-1.png' }],
            findings: [
              { id: 'overflow', level: 'problem', route: '/', text: 'Sideways scroll at 390 px: the page is 900 px wide · widest: table.wide', offenders: ['table.wide'] },
              { id: 'small-text', level: 'heads-up', route: '/', text: '1 piece of visible text under 12 px' },
              { id: 'identical', level: 'heuristic', route: '/fr', text: 'Heuristic: 3 strings on /fr are word for word the same as on /', samples: ['Welcome to Selftest', 'Contact us'] },
            ],
            counts: { problem: 1, headsUp: 1, heuristic: 1 }, languageSwitch: 'found', blocked: { count: 4, hosts: [{ host: 'fonts.example.test', count: 4 }] }, requestsSeen: 12,
            truncated: { routes: false, requests: false, time: false }, summary: '1 to fix · 1 to look at · 1 heuristic (may be wrong) · 2 pages at 390 px',
            blockedLine: '4 outside requests blocked (fonts.example.test)', notes: [], shots: ['s-0.png', 's-1.png'] }, o || {});
          const dClean = dRep({ findings: [], counts: { problem: 0, headsUp: 0, heuristic: 0 }, blocked: { count: 0, hosts: [] }, blockedLine: '', summary: 'Nothing found · 2 pages at 390 px' });
          const dNoSwitch = dRep({ routes: [{ path: '/', locale: 'en', title: 'Selftest Studio', loaded: true, shot: 's-0.png' }], findings: [], counts: { problem: 0, headsUp: 0, heuristic: 0 }, languageSwitch: 'none',
            summary: 'Nothing found · 1 page at 390 px', notes: ['No language switch found, so nothing was checked per language'], shots: ['s-0.png'] });
          const dMany = dRep({ findings: Array.from({ length: 45 }, (_, i) => ({ id: 'small-text', level: 'heads-up', route: '/p' + i, text: 'Selftest finding ' + i })), counts: { problem: 0, headsUp: 45, heuristic: 0 }, summary: '45 to look at · 2 pages at 390 px' });
          const dck = (o) => ({ dck: Object.assign({ pid: proj, url: '', detect: null, report: null, phase: 'idle', err: '' }, o) });
          for (const [name, offline, patch] of [
            ['dck-offline', true, dck({})],
            ['dck-not-looked', false, dck({})],
            ['dck-looking', false, dck({ phase: 'detecting' })],
            ['dck-nothing', false, dck({ detect: dNothing })],
            ['dck-nothing-typed', false, dck({ detect: dNothing, url: 'http://localhost:4000' })],
            ['dck-no-command', false, dck({ detect: Object.assign({}, dNothing, { hasCommand: false }) })],
            ['dck-ready', false, dck({ detect: dReady, url: 'http://127.0.0.1:5173' })],
            ['dck-ready-here', false, dck({ detect: Object.assign({}, dReady, { startedHere: true }), url: 'http://127.0.0.1:5173' })],
            ['dck-running', false, dck({ detect: dReady, url: 'http://127.0.0.1:5173', phase: 'running' })],
            ['dck-error', false, dck({ detect: dReady, url: 'https://selftest.example.test', err: 'Only a dev server on this PC can be checked' })],
            ['dck-report', false, dck({ detect: dReady, url: 'http://127.0.0.1:5173', report: dRep() })],
            ['dck-report-clean', false, dck({ detect: dReady, url: 'http://127.0.0.1:5173', report: dClean })],
            ['dck-report-no-switch', false, dck({ detect: dNothing, report: dNoSwitch })],
            ['dck-report-many', false, dck({ detect: dReady, url: 'http://127.0.0.1:5173', report: dMany })],
            ['dck-report-running-again', false, dck({ detect: dReady, url: 'http://127.0.0.1:5173', report: dRep(), phase: 'running' })],
          ]) {
            try {
              await combo([theme, 'p3:' + name].join(' '), () => {
                if (offline && hq2) W.store.hq = Object.assign({}, hq2, { deliveryCheck: undefined });
                W.store.refreshDelivery = () => Promise.resolve();
                L.dckArrive = () => Promise.resolve(null);
                LV.delivery = DS(dView());
                L.go('projects', 'grid'); L.openProject(proj);
                L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }, patch));
              });
            } finally { W.store.hq = hq2; W.store.refreshDelivery = rd0; delete L.dckArrive; }
          }
        }
        // Projects > Clients (batch 2: the list of client jobs): every state of the list. The rows are put straight into the cls state and the arrival read is
        // held (the fake's own answer would replace them); cls-offline hides hq.delivery for one combo. Invented names only.
        {
          const hq3 = W.store.hq, cIso2 = (min) => new Date(Date.now() - min * 60e3).toISOString();
          const cRow = (o) => Object.assign({ id: 'c-x', name: 'Selftest Client', mode: 'client', done: 0, total: 0, linkState: 'none', lastCopyAt: null, fileState: null, inScan: true }, o);
          const cMix = [
            cRow({ id: 'c-1', name: 'Selftest Studio', done: 1, total: 4, linkState: 'ready-production', lastCopyAt: cIso2(3 * 24 * 60) }),
            cRow({ id: 'c-2', name: 'Selftest Shop', done: 2, total: 2, linkState: 'ready-preview', lastCopyAt: cIso2(90) }),
            cRow({ id: 'c-3', name: 'Selftest Blog', linkState: 'not-ready' }),
            cRow({ id: 'c-4', name: 'Selftest Docs', fileState: 'missing', linkState: 'none' }),
            cRow({ id: 'c-gone', name: 'c-gone', inScan: false, lastCopyAt: cIso2(9 * 24 * 60) }),
          ];
          const cMany = Array.from({ length: 30 }, (_, i) => cRow({ id: 'c-m' + i, name: 'Selftest Client ' + i, done: i % 5, total: 5, linkState: i % 2 ? 'ready-production' : 'none' }));
          const cls = (o) => ({ cls: Object.assign({ rows: null, omitted: 0, error: '', loaded: true, busy: false, at: '' }, o) });
          for (const [name, offline, patch] of [
            ['cls-offline', true, cls({})],
            ['cls-loading', false, cls({ loaded: false, busy: true })],
            ['cls-error', false, cls({ error: 'the delivery service did not answer' })],
            ['cls-empty', false, cls({ rows: [] })],
            ['cls-ready', false, cls({ rows: cMix })],
            ['cls-ready-refreshing', false, cls({ rows: cMix, busy: true })],
            ['cls-ready-error', false, cls({ rows: cMix, error: 'the delivery service did not answer' })],
            ['cls-many-omitted', false, cls({ rows: cMany, omitted: 3 })],
          ]) {
            try {
              await combo([theme, 'p3:' + name].join(' '), () => {
                if (offline && hq3) W.store.hq = Object.assign({}, hq3, { delivery: undefined });
                L.clsArrive = () => Promise.resolve(null);
                L.go('projects', 'clients');
                L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }, patch));
              });
            } finally { W.store.hq = hq3; delete L.clsArrive; }
          }
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
  // store reads that failed (live/store.js pull() warns AND counts them): an adapter crash
  // on real boot data no-ops a whole read with only a console.warn, which the hooks above
  // never see — fold the store's own counter in so the gate goes red, boot reads included
  const rf = W && W.store && W.store.readFailures;
  if (rf && rf.count) { stats.errors += rf.count; for (const s of rf.samples) if (samples.length < 25) samples.push('store read failed · ' + s); }
  const summary = { combos: stats.combos, errors: stats.errors, unresolved: W ? W.unresolved.size : -1, failures: W && W.failures ? W.failures.count : -1 };
  const detail = { ms: Math.round(performance.now() - t0), samples, holes: [...holes].map(([k, at]) => k + ' @ ' + at), lastFailure: W && W.failures ? W.failures.last : '' };
  window.__selftestDetail = detail;
  console.log('[selftest:detail] ' + JSON.stringify(detail));
  console.log('[selftest] ' + JSON.stringify(summary));
  window.__selftest = summary;
  return summary;
}

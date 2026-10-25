// Golden guard for Component.renderVals() (app.js + src/vals/*.js + src/logic/*.js).
// Recorded against the code as it stood before the planned split into smaller
// files; the split must leave every scenario's render values byte-identical.
//
// Each scenario builds a fresh store (synthetic DATA, hq = null unless stated)
// and a fresh Component, sets component.state directly, calls renderVals() and
// hashes a canonical serialisation of the result (keys sorted recursively,
// functions → "[fn]", {current} refs → "[ref]", undefined dropped, Date → ISO).
// componentDidMount is never called (it starts timers, FX and the store).
//
//   node --test dashboard-v5/src/vals.golden.test.mjs
//   UPDATE_GOLDEN=1  … rewrites __golden__/vals.hashes.json (only for a deliberate change)
//   GOLDEN_DUMP=<dir> … also writes <dir>/<scenario>.json (must be outside the repo)
//
// Determinism: TZ is pinned to UTC, Date is frozen at 2026-10-05 10:00 (local =
// UTC) with node:test mock timers, and toLocaleString / localeCompare default to
// en-US when the code passes no locale. What can still move the hashes: a Node
// upgrade whose ICU formats "Oct 5, 03:00 AM" differently.
// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component } from './app.js';
import { createStore } from './live/store.js';
import { SUBS } from './live/catalog.mjs';
import * as A from './live/adapter.mjs';
import { proj, scan, spell, spellbook, telemetry, organ, pcHealth } from './live/__fixtures__/synthetic.mjs';

process.env.TZ = 'UTC';   // before any Date is built; Node resets its tz cache on assignment

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const HASHES = join(HERE, '__golden__', 'vals.hashes.json');
const NOW = new Date(2026, 9, 5, 10, 0, 0).getTime();   // Monday 2026-10-05 10:00 local (UTC)
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const DUMP = process.env.GOLDEN_DUMP ? resolve(process.env.GOLDEN_DUMP) : null;

// ---- browser globals renderVals / initState touch ---------------------------------
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
// Node 25 ships localStorage/sessionStorage as accessor globals: define, don't assign
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
define('window', { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery, addEventListener() {}, removeEventListener() {} });
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {} });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

// default-locale formatting → en-US, so another machine's locale can't move the hashes
function pinLocale() {
  const undo = [];
  const pin = (proto, name, wrap) => { const orig = proto[name]; proto[name] = wrap(orig); undo.push(() => { proto[name] = orig; }); };
  const dflt = (l) => (l == null || (Array.isArray(l) && !l.length) ? 'en-US' : l);
  pin(Date.prototype, 'toLocaleString', (o) => function (l, opt) { return o.call(this, dflt(l), opt); });
  pin(Number.prototype, 'toLocaleString', (o) => function (l, opt) { return o.call(this, dflt(l), opt); });
  pin(String.prototype, 'localeCompare', (o) => function (that, l, opt) { return o.call(this, that, dflt(l), opt); });
  return () => undo.forEach((f) => f());
}

// ---- synthetic DATA: 4 scans, oldest → newest -----------------------------------------
const SCAN_IDS = ['2026-09-25', '2026-09-30', '2026-10-03', '2026-10-05'];
const P = (id, o, extra) => Object.assign(proj(id, o), extra || {});
const INSIGHTS = [
  { text: 'Tests cover only the parser', severity: 'warning' },
  { text: 'A key-like string sits in .env', severity: 'danger' },
  { text: 'Bundle size is stable', severity: 'info' },
  { text: '' },
];
const ROADMAP = [
  { milestone: 'MVP', status: 'done', progress_pct: 100, items: ['login', 'export'] },
  { milestone: 'Beta', status: 'in_progress', progress_pct: 60, items: ['sync', 'themes', 'search', 'undo', 'one too many'] },
  { milestone: 'Launch', status: 'planned', items: [] },
  { milestone: 'Later', status: 'planned' },
];
function projectsAt(k) {
  const list = [
    // secrets + suggestions + own side quests + risk flags + insights/roadmap + a dev port
    P('a', { pct: 40 + 5 * k, dev: 'npm run dev -- --port 5173', commits: 10 + 3 * k, dirty: [6, 4, 5, 3][k], ahead: 1, secrets: 2, gitRisk: 'high', gitFlags: ['many-dirty', 'odd_flag'], days: 1,
      // (Phase 3: the last two suggestions repeat an open and a finished side quest — Next shows neither)
      suggestions: [{ kind: 'polish', text: 'Add a usage section to the README', effort: 'S', impact: 'M' }, { text: 'An uncategorised suggestion' }, { text: 'own  side quest.' }, { text: 'Finished side quest' }],
      // (Phase 3: sq-a-ci is the collector's own "no CI" quest, so the CI gap row is not offered again)
      side: [{ id: 'sq-a-own', kind: 'idea', title: 'Own side quest', effort: 'S', impact: 'L' }, { id: 'sq-a-done', kind: 'idea', title: 'Finished side quest', done: true }, { id: 'sq-a-ci', kind: 'idea', title: 'Add CI', effort: 'M', impact: 'M' }],
      signals: { has_tests: false, has_ci: false, has_readme: true, test_files: 0 } },
    { insights: INSIGHTS, roadmap: ROADMAP }),
    P('b', { git: false, pct: 20, days: 3 }),                                                                   // no git
    P('c', { pct: 70, dirty: [18, 22, 24, 25][k], ahead: 2, branch: 'feature-x', state: 'stale', days: 40 + k, commits: 30, dev: 'python -m http.server 5500' }),   // dirty, off-branch
    P('d', { pct: 90, dirty: 0, days: 0, commits: 50 + 2 * k }),                                                 // clean
    P('e', { pct: 100, state: 'dormant', days: 120, commits: 5 }),                                               // dormant
  ];
  if (k >= 2) list.push(P('f', { pct: 5, commits: 0, dirty: 7, days: 0 }));                                     // new, never committed
  list[0].metrics.code_health.loc = 12345;   // a thousands separator in "Size" (Number#toLocaleString)
  return list;
}
const Q = (id, tier, title, o = {}) => ({ id, tier, title, insight: o.why || '', ...(o.proj ? { project_id: o.proj } : {}), age_days: o.age ?? 1, xp: o.xp ?? 10, status: o.status || 'open', ...(o.completed ? { completed: o.completed } : {}) });
function questsAt(k) {
  const q = [
    Q('q-a-secret', 'red', 'Rotate the exposed key in Project A', { why: 'Two likely secrets in .env', proj: 'a', age: 3 + k, xp: 40 }),
    Q('q-c-commit', 'orange', 'Commit the work in progress', { why: 'Many uncommitted files', proj: 'c', age: 5, xp: 20 }),
    Q('q-b-git', 'red', 'Put Project B under version control', { why: 'No git at all', proj: 'b', age: 10, xp: 30, status: k >= 3 ? 'in_progress' : 'open' }),
    Q('q-ws-tidy', 'yellow', 'Tidy the workspace root', { why: 'Stray folders', age: 1, xp: 10 }),
    Q('q-d-tests', 'yellow', 'Add tests to Project D', { proj: 'd', age: 2, xp: 15 }),
    Q('q-a-push', 'orange', 'Push Project A', { proj: 'a', xp: 25, status: k >= 1 ? 'done' : 'open', completed: k >= 1 ? '2026-09-30' : null }),
    Q('q-e-branch', 'yellow', 'Delete the stale branch', { proj: 'e', xp: 5, status: k >= 2 ? 'done' : 'open', completed: k >= 2 ? '2026-10-02' : null }),
    Q('q-x-blocked', 'orange', 'Something blocked', { status: 'blocked' }),
  ];
  if (k >= 2) q.push(Q('q-f-first', 'orange', 'Make the first commit in Project F', { proj: 'f', xp: 20 }));
  return q;
}
const SIDE = [
  { id: 'sq-llm', kind: 'idea', title: 'Try a plugin system', project_id: 'a', project_name: 'Project A', source: 'llm', effort: 'M', impact: 'H' },
  { id: 'sq-purge', kind: 'polish', title: 'Purge build caches', project_id: 'c', source: 'rules', effort: 'S', impact: 'M', reclaim_bytes: 2500000000, fat_dirs: [{ name: 'node_modules' }, 'dist'] },
  { id: 'sq-risk', kind: 'risk', title: 'Pin dependency versions', project_id: 'd', effort: 'S', impact: 'M' },
  { id: 'sq-urgent', kind: 'urgent', title: 'Renew the dev certificate', effort: 'S', impact: 'H' },
  { id: 'sq-capture', kind: 'idea', title: 'A captured thought', source: 'capture' },
  { id: 'sq-done', kind: 'idea', title: 'Already done', done: true },
  { id: 'sq-dismissed', kind: 'idea', title: 'Dismissed', dismissed: true },
];
const sideAt = (k) => (k >= 3 ? SIDE : k === 2 ? SIDE.slice(0, 3) : []);
const achAt = (k) => (k >= 3
  ? [{ id: 'liftoff', unlocked: true, unlocked_on: '2026-09-01' }, { id: 'in_sync', unlocked: true, unlocked_on: '2026-10-05' }, { id: 'quest_streak_5', progress: { have: 3, need: 5 } }, { id: 'scan_streak_7', progress: { have: 4, need: 7 } }]
  : [{ id: 'liftoff', unlocked: true, unlocked_on: '2026-09-01' }, { id: 'quest_streak_5', progress: { have: k, need: 5 } }]);
const changesAt = (k) => [
  [],
  [{ type: 'quest_completed', detail: 'Finished · Push Project A', project_id: 'a' }, { type: 'git_pushed', project_id: 'a' }],
  [{ type: 'new_project', detail: 'Project F appeared', project_id: 'f' }, { type: 'spell_learned', detail: 'Learned a new automation' }],
  [
    { type: 'quest_completed', detail: 'Finished · Delete the stale branch', project_id: 'e' },
    { type: 'level_up', level: 3, title: 'Builder' },
    { type: 'new_achievement', name: 'Clean Slate', achievement_id: 'in_sync' },
    { type: 'build_flip', impact: 'negative', detail: 'Build went red', project_id: 'c' },
    { type: 'build_flip', impact: 'positive', detail: 'Build back to green', project_id: 'd' },
    { type: 'dirty_spike', impact: 'negative', project_id: 'c' },
    { type: 'readme_added', impact: 'positive' },
    { type: 'something_else' },
  ],
][k];
const BROWSER = {
  by_domain: [{ domain: 'docs.example.org', focus_ms: 95 * 60000 }, { domain: 'localhost', focus_ms: 75 * 60000 }, { domain: 'example.com', focus_ms: 30 * 60000 }, { domain: 'video.example.net', focus_ms: 20 * 60000 }, { domain: 'idle.example', focus_ms: 10000 }],
  by_project: [{ project_id: 'a', domains: ['localhost', 'docs.example.org'] }],
};
const browserAt = (k) => (k >= 3 ? BROWSER : k === 2 ? { by_domain: [{ domain: 'example.com', focus_ms: 45 * 60000 }] } : undefined);
const INVENTORY = {
  duplicates: [{ detail: 'Project A copy ↔ Project A' }, { detail: 'notes ↔ notes-old' }, { detail: 'x ↔ y' }, { detail: 'p ↔ q' }],
  empty: ['C:/dev/empty-1', 'C:/dev/empty-2'],
  clones: [{ name: 'lib-x', diverged: true }, { name: 'lib-y' }],
  trivial: ['C:/dev/tiny'],
  vaults: [{ name: 'Vault One', recent7: 12, stale90: 30, notes: 200, role: 'primary' }, { name: 'Vault Two', recent7: 0, stale90: 5, notes: 0, role: '' }],
};
const LEARNINGS = [{ text: 'Caching the scan halves the run time', project_id: 'a', ts: '2026-10-04T18:00:00Z' }, { text: 'A workspace-wide lesson', ts: null }, { text: '' }];

function DATA() {
  const scans = SCAN_IDS.map((id, k) => Object.assign(scan(id, projectsAt(k), {
    xp: [250, 300, 340, 410][k], quests: questsAt(k), side: sideAt(k), ach: achAt(k), changes: changesAt(k),
    archived: k >= 3 ? [P('z', { state: 'dormant', days: 200 }, { archived_on: '2026-09-20' }), P('y', { git: false })] : [],
    inv: k >= 3 ? INVENTORY : {}, browser: browserAt(k),
  }), { recent_learnings: k >= 3 ? LEARNINGS : [] }));
  const S = (s, extra) => Object.assign(s, extra);
  return {
    scans,
    spellbook: spellbook([
      spell('grimoire:scan', { name: 'Deep scan', source: 'grimoire', icon: '◎', school: 'divination', desc: 'Re-reads every project' }),
      spell('grimoire:morning', { name: 'Morning routine', source: 'grimoire', kind: 'chain', confirm: true, school: 'evocation', chain: [{ name: 'Pull' }, { id: 'step-build' }, 'plain-step'] }),
      S(spell('script:backup', { name: 'Backup notes', source: 'script', command: 'pwsh', args: ['-File', 'backup.ps1'], school: 'abjuration' }), { schedule: { state: 'Ready', next_run: '2026-10-06 02:00', last_run: '2026-10-05 02:00', last_result: 0 } }),
      spell('npm:a:test', { name: 'test (Project A)', source: 'npm', command: 'npm', args: ['test'], school: 'restoration' }),
      S(spell('task:nightly', { name: 'Nightly cleanup', source: 'task', school: 'transmutation' }), { schedule: { state: 'Disabled', last_run: '2026-10-04 02:00', last_result: 1 } }),
      spell('skill:review', { name: 'Review', kind: 'channeled', source: 'skill', command: 'claude', args: ['/review'] }),
      spell('command:plan', { name: 'Plan', kind: 'channeled', source: 'command', command: 'claude', args: ['/plan'] }),
      spell('script:broken', { name: 'Broken', source: 'script', invalid: true }),
      spell('plugin:ref', { name: 'Reference only', kind: 'reference', source: 'plugin' }),
    ], { total: 60, bySource: { skill: 20, command: 10, plugin: 5, task: 3, npm: 8, script: 9, grimoire: 5 }, familiars: 6 }),
    telemetry: telemetry([
      { cast_id: 'c0', spell_id: 'gone:spell', started_at: '2026-09-30T09:00:00Z', outcome: 'fizzled' },
      { cast_id: 'c1', spell_id: 'grimoire:scan', started_at: '2026-10-01T09:00:00Z', outcome: 'resolved', duration_ms: 42000 },
      { cast_id: 'c2', spell_id: 'npm:a:test', started_at: '2026-10-04T15:00:00Z', outcome: 'fizzled', exit_code: 1, duration_ms: 8000 },
      { cast_id: 'c3', spell_id: 'skill:review', started_at: '2026-10-05T08:30:00Z', outcome: 'channeled' },
      { cast_id: 'c4', spell_id: 'grimoire:morning', started_at: '2026-10-05T09:58:00Z', outcome: 'resolved', duration_ms: 120000 },
    ], { favorites: ['grimoire:scan'], confirmed: { 'grimoire:scan': 'h-grimoire:scan' } }),
    pcHealth: pcHealth([
      organ('cpu', { value: 12, status: 'grace' }),
      organ('disk', { label: 'Storage', value: 91, status: 'ember', diagnosis: 'Disk filling up', teaching: 'Less than 10% free', fixes: [{ title: 'Clean temp files', command: 'Remove-Item $env:TEMP\\* -Recurse -Force', danger: 'safe' }] }),
      organ('ram', { label: 'Memory', value: 95, status: 'blood', diagnosis: 'Memory pressure', fixes: [{ title: 'Close heavy apps', command: 'taskmgr', danger: 'unsafe' }] }),
      organ('gpu', { status: 'off', unit: '' }),
    ], { at: '2026-10-05T03:00:00Z', host: { name: 'test-pc' } }),
    weeklyRecap: { week_start: '2026-09-28', week_end: '2026-10-04', stats: { xp_gain: 70, quests_completed: 3, achievements_unlocked: 1 }, narrative_md: '# Week\n**Good** week with _steady_ progress.\n> quoted `code`', ai_narrative: true },
    projectNotes: { a: [{ text: 'First note', date: '2026-10-01T10:00:00Z' }, { text: 'Second note', date: '2026-10-04T10:00:00Z' }, { text: 'Undated note' }], b: [] },
    canvas: [{ name: 'Board One', nodes: [
      { id: 'n1', text: '# Plan\n- step one\n- step two\n- **step three**' },
      { id: 'n2', text: 'A short note\nwith a body line' },
      { id: 'n3', text: 'Long note\n' + 'word '.repeat(50) },
      { id: 'n4', file: 'notes/x.md' },
      { id: 'n5', text: '   ' },
    ] }],
    built_at: '2026-10-05T03:05:00Z',
  };
}

// everything window.hq would have pushed after boot (sessions, casts, dev servers, vitals, social, captures)
const CAPTURE_ROWS = [
  { path: 'C:/captures/snip-1.png', kind: 'snip', name: 'snip-1.png', mtimeMs: Date.parse('2026-10-05T09:15:00Z'), size: 245000 },
  { path: 'C:/captures/rec-1.mp4', kind: 'rec', recovered: true, name: 'rec-1.mp4', mtimeMs: Date.parse('2026-10-04T18:00:00Z'), size: 12500000 },
  { path: 'C:/captures/snip-0.png', kind: 'snip', name: 'snip-0.png', mtimeMs: Date.parse('2026-09-28T08:00:00Z'), size: 800, thumbDataUrl: 'data:image/png;base64,AAAA' },
];
function richLive(L, store) {
  L.sessions = A.sessions([
    { jobId: 'j1', label: 'Fix the build', cwd: 'C:/dev/a', status: 'running', startedAt: Date.parse('2026-10-05T09:40:00Z'), tail: 'line 1\nline 2' },
    { jobId: 'j2', label: 'Write docs', projectId: 'd', status: 'done', exitCode: 0, startedAt: '2026-10-05T08:00:00Z', tail: '' },
    { jobId: 'j3', label: 'Broken run', cwd: 'C:/elsewhere', exitCode: 2, startedAt: '2026-10-05T07:00:00Z' },
  ], store.model.at(0).P0);
  L.sessionOut = { j1: 'streamed line 1\nstreamed line 2' };
  L.casts = {
    k1: { castId: 'k1', spellId: 'grimoire:scan', name: 'Deep scan', icon: '◎', out: ['scanning…'], status: 'running', t0: Date.parse('2026-10-05T09:55:00Z') },
    k2: { castId: 'k2', spellId: 'npm:a:test', name: 'test (Project A)', icon: '▶', out: ['✗ failed'], status: 'failed', t0: Date.parse('2026-10-05T09:50:00Z'), done: true, meta: '8s · exit 1' },
  };
  L.dev = { a: { since: Date.parse('2026-10-05T09:00:00Z') }, c: null, d: { since: Date.parse('2026-10-05T09:30:00Z') } };
  L.machine = { cpu: 23.4, ram: 61.7 };
  L.browserNow = { domain: 'docs.example.org' };
  L.llm = { available: false };
  L.social = { ...A.social({
    accounts: { accounts: [{ platform: 'bluesky', handle: 'placeholder.example' }] },
    outbox: { actions: [{ id: 's1', platform: 'bluesky', text: 'Draft post text', status: 'staged', staged_at: '2026-10-04T12:00:00Z' }, { id: 's2', platform: 'bluesky', status: 'sent' }] },
    inbox: { events: [{ kind: 'mention', author: 'someone.example', text: 'nice work', ts: '2026-10-05T09:00:00Z', url: 'https://example.com/post/1' }, { kind: 'like', author: 'x' }] },
  }), loaded: true };
  L.captures = A.captures(CAPTURE_ROWS);
}

// ---- scenarios ---------------------------------------------------------------------------
// { name, data: 'base'|'empty', hq, width, props, live(L, store), setup(c), state: patch | (c, M) => patch }
// names are file-safe (GOLDEN_DUMP writes <name>.json): letters, digits, '.', '-'
const TABS = ['home', 'projects', 'tasks', 'automations', 'claude', 'history', 'system', 'life', 'studio'];
const DIAG = ['git', 'security', 'standing', 'insights', 'roadmap'];
const SCEN = [];
const add = (name, o = {}) => SCEN.push({ name, ...o });
const tabSub = (tab, sub) => (c) => ({ tab, sub: { ...c.state.sub, [tab]: sub } });
const page = (id, diagTab, extra) => (c) => ({ tab: 'projects', route: { type: 'project', id }, diagTab, ...(extra || {}) });
const palette = (paletteQuery, extra) => ({ paletteOpen: true, paletteMode: 'go', paletteQuery, paletteSel: 0, ...(extra || {}) });

// every tab × each of its subs
for (const tab of TABS) {
  if (!SUBS[tab]) add('tab.' + tab, { state: { tab } });
  else for (const [sub] of SUBS[tab]) add('tab.' + tab + '.' + sub, { state: tabSub(tab, sub) });
}
// project page: two projects × every diagnostics tab
for (const id of ['a', 'b']) for (const d of DIAG) add('project.' + id + '.' + d, { state: page(id, d) });
add('project.a.toggles', { state: page('a', 'standing', { pageMore: true, journalKind: 'learning', journalDraft: 'a draft', journalAdds: { a: [{ k: 'decision', t: 'Use the plugin approach', d: 'Today' }] } }) });
// time machine, theme, preview states
add('home.snap-1', { state: { tab: 'home', snapOffset: 1 } });
add('home.snap-max', { state: (c, M) => ({ tab: 'home', snapOffset: M.maxOff }) });
add('past.tasks-ideas', { state: (c) => ({ ...tabSub('tasks', 'ideas')(c), snapOffset: 1 }) });
add('past.project-a', { state: page('a', 'roadmap', { snapOffset: 2 }) });
add('theme.light', { state: { themePref: 'light' } });
add('theme.os', { state: { themePref: 'os' } });
add('preview.nobridge', { props: { previewState: 'nobridge' } });
add('preview.loading', { props: { previewState: 'loading' } });
add('preview.error', { props: { previewState: 'error' } });
add('error.empty-store', { data: 'empty' });
add('narrow.home', { width: 600, state: { moreOpen: true, ambientOverlay: true } });
// sort orders and local state
for (const s of ['dirty', 'recent', 'name']) add('sort.' + s, { state: (c) => ({ ...tabSub('projects', 'grid')(c), projSort: s }) });
add('state.after-work', { state: { tab: 'tasks', completed: ['q-d-tests', 'sq-capture'], recentDone: ['q-d-tests'], committed: { c: true }, dismissed: ['sq-risk'], fixed: ['organ-disk', 'dup'], xp: 425, displayXp: 420 } });
add('state.toggles', { state: { tab: 'automations', taskFilter: 'orange', momentum: 'xp', trendRange: 14, hoverProj: 'c', autoQuery: 'scan', composerProj: 'd', composer: 'Draft a session prompt', studioFilter: 'snip', pinned: ['grimoire:morning', 'npm:a:test'], trusted: ['grimoire:scan'], recapOpen: true, sinceDismissed: true, sessionSel: 'none', expandedRun: 'c1' } });
// overlays: palette
add('overlay.palette-go-empty', { state: palette('') });
add('overlay.palette-go-commit-a', { state: palette('commit a') });
add('overlay.palette-go-open-b', { state: palette('open b') });
add('overlay.palette-go-run-deep', { state: palette('run deep') });
add('overlay.palette-go-focus-tidy', { state: palette('focus tidy') });
add('overlay.palette-go-theme-l', { state: palette('theme l') });
add('overlay.palette-go-go-pro', { state: palette('go pro') });
add('overlay.palette-go-query-scan', { state: palette('scan', { paletteSel: 1 }) });
add('overlay.palette-go-past', { state: palette('', { snapOffset: 1, paletteSel: 3 }) });
add('overlay.palette-ask', { state: { paletteOpen: true, paletteMode: 'ask', paletteQuery: 'what changed?', paletteSel: 0 } });
// overlays: ask, runs, scrub, settings, cheat sheet
// Phase 3 P1: entries as logic/ask.js keeps them — { id, q, a: { text, status, meta (v3's, as stored), est } }
const ASK_SEC = [{ id: 'scan', label: 'Scan', chars: 1200, clipped: false }, { id: 'tasks', label: 'Tasks', chars: 4000, clipped: true }, { id: 'vault', label: 'Vault', chars: 0, clipped: false, note: 'no matching notes' }];
const ASK_DONE = [
  { q: 'What is uncommitted?', id: 'a1', a: { text: 'Project C has 25 uncommitted files.', status: 'done', meta: { status: 'done', sections: ASK_SEC, ms: 1200, model: 'placeholder-model' }, est: true } },
  { q: 'Which project is quiet?', id: 'a2', a: { text: 'Project E has had no', status: 'cancelled', meta: { status: 'cancelled', sections: ASK_SEC, ms: 800, model: 'placeholder-model' }, est: true } },
  { q: 'Asked before a reload', id: 'a3', a: { text: '', status: 'error', meta: { status: 'error', reason: 'interrupted — the window reloaded' }, est: false } },
  { q: 'Asked while offline', id: 'a4', a: { text: 'The model is offline.', status: 'unavailable', meta: { status: 'unavailable', reason: 'no runtime' }, est: true } },
  { q: 'Old question', id: 'a5', local: true, a: { text: 'The local model runtime isn’t running.', status: 'unavailable', meta: null, est: false, refusal: true } },
];
add('overlay.ask', { state: { askOpen: true, askDraft: 'a draft question', askHistory: ASK_DONE } });
// a bridge with llm.chat/cancel: Retry offered, and the button is Stop while an answer streams
const LLM_HQ = { llm: { chat() {}, cancel() {}, warm() {} } };
add('overlay.ask-bridge', { hq: LLM_HQ, live: (L) => { L.llm = { available: true, runtime: 'placeholder', chatModel: 'placeholder-model' }; }, state: { askOpen: true, askHistory: ASK_DONE, askInclude: { scan: false, tasks: true, projects: true, health: true, browser: false, vault: false } } });
add('overlay.ask-streaming', { hq: LLM_HQ, live: (L) => { L.llm = { available: true, runtime: 'placeholder', chatModel: 'placeholder-model' }; }, state: { askOpen: true, askHistory: ASK_DONE.slice(0, 1).concat([{ q: 'Any exposed secrets?', id: 'a6', a: { text: 'Project A has', status: 'thinking', meta: null, est: false } }]) } });
add('overlay.ask-empty', { hq: LLM_HQ, live: (L) => { L.llm = { available: true, runtime: 'placeholder', chatModel: 'placeholder-model' }; }, state: { askOpen: true, askHistory: [] } });
add('overlay.ask-offline', { hq: LLM_HQ, live: (L) => { L.llm = { available: false, reason: 'not running' }; }, state: { askOpen: true, askHistory: [] } });
add('overlay.ask-no-chat-model', { hq: LLM_HQ, live: (L) => { L.llm = { available: true, runtime: 'placeholder', chatModel: null }; }, state: { askOpen: true, askHistory: [], askChecking: true } });
// Phase 2 C2: the scan row comes from main's live scan state (hq:live-state / hq:scan-status), not a localRuns entry
add('overlay.runs', { live: (L) => { L.scan = { state: 'running', startedAt: Date.parse('2026-10-05T10:00:00Z'), endedAt: null, code: null }; }, state: { runsOpen: true, expandedRun: 'c2', localRuns: [
  { id: 't1', name: 'Review', status: 'opened', meta: 'Terminal opened · claude /review', started: '09:50', out: ['Opened in an external terminal; output stays there.'] },
] } });
add('overlay.runs-scan-failed', { live: (L) => { L.scan = { state: 'failed', startedAt: Date.parse('2026-10-05T10:00:00Z'), endedAt: Date.parse('2026-10-05T10:04:00Z'), code: 1 }; }, state: { runsOpen: true } });
add('overlay.runs-notes', { state: { runsOpen: true, actTab: 'notes', notifLog: [{ text: 'Committed 3 files', kind: 'success', at: '09:59' }, { text: 'Run failed', kind: 'error', at: '09:40' }] } });
add('overlay.scrub-compare', { state: { scrubOpen: true, compareOff: 2 } });
add('overlay.settings', { state: { settingsOpen: true } });
add('overlay.cheat', { state: { cheatOpen: true } });
// overlays: focus, confirm, commit, sheet, level-up, onboarding
add('overlay.focus', { state: { focus: { taskId: 'q-a-secret', start: NOW - 125000 }, now: NOW } });
add('overlay.focus-none', { state: { focus: { taskId: null, start: NOW - 5000 }, now: NOW } });
add('overlay.confirm-first-auto', { state: (c, M) => ({ confirm: M.AUTOS[0].id }) });
add('overlay.confirm-chain', { state: { tab: 'automations', confirm: 'grimoire:morning', confirmAsk: 'always' } });
add('overlay.commit', { state: { commitSel: 1, commit: { pid: 'a', loading: false, msg: 'feat: placeholder change', drafted: 'Drafted by the local model · edit before committing',
  files: [{ name: 'src/app.js', st: 'mod', on: true }, { name: 'notes/new-file.md', st: 'new', on: true }, { name: 'old/removed.txt', st: 'del', on: true }],
  stat: ' src/app.js | 4 ++--\n notes/new-file.md | 10 ++++++++++\n old/removed.txt | 3 ---\n 3 files changed, 12 insertions(+), 5 deletions(-)' } } });
add('overlay.commit-env', { state: { commitSel: 5, commit: { pid: 'c', loading: false, msg: '', drafted: 'No draft · write the message yourself', stat: '', files: [{ name: '.env', status: '??', st: 'new', env: true, on: true }, { name: 'config/.env.local', status: 'M', st: 'mod', env: true, on: true }, { name: 'src/app.js', status: 'M', st: 'mod', env: false, on: true }], envHits: ['.env', 'config/.env.local'], branch: 'main', error: '', busy: false } } });
add('overlay.commit-loading', { state: { commitSel: 0, commit: { pid: 'c', files: [], stat: '', loading: true, msg: '', drafted: 'Drafting with the local model…' } } });
add('overlay.sheet-danger', { state: { sheet: { act: 'archive', id: 'a', title: 'Archive Project A?', body: 'It leaves counts, tasks and the map.', ok: 'Archive', danger: true } } });
add('overlay.sheet-safe', { state: { sheet: { act: 'fix', cmd: 'cleanmgr', fixTitle: 'Clean temp files', title: 'Clean temp files?', body: 'Runs this PowerShell command now:\n\ncleanmgr', ok: 'Run fix', danger: false } } });
add('overlay.level-up', { state: { levelUp: { l: 4, t: 'Operator' } } });
for (const step of [1, 2, 3]) add('overlay.onboard-' + step, { state: { onboard: { step, path: 'C:/dev/new-project', dev: 'npm run dev', branch: 'main', name: 'Project New' } } });
// overlays: toasts (one with a live Undo window), lightbox on a capture
add('overlay.toasts', {
  setup: (c) => { c._pending['done:q-d-tests'] = { fn() {}, timer: null }; },
  state: { toasts: [
    { id: 'k1', kind: 'success', text: 'Done · Add tests to Project D', undo: 'q-d-tests' },
    { id: 'k2', kind: 'progress', text: 'Running · Deep scan', runSpell: 'grimoire:scan' },
    { id: 'k3', kind: 'error', text: 'Couldn’t save · offline' },
    { id: 'k4', kind: 'info', text: 'Scanning every project', scan: true },
    { id: 'k5', kind: 'success', text: 'Marked done · old', undo: 'gone' },
  ] },
});
add('overlay.lightbox', { live: (L) => { L.captures = A.captures(CAPTURE_ROWS); }, state: (c, M) => ({ tab: 'studio', lightbox: M.CAPTURES[1].id }) });
// live data pushed over the bridge (sessions, casts, dev servers, vitals, social, captures)
add('live.home', { live: richLive, state: { tab: 'home' } });
add('live.claude-sessions', { live: richLive, state: (c) => ({ ...tabSub('claude', 'sessions')(c), sessionSel: 'j1' }) });
add('live.system', { live: richLive, state: tabSub('system', 'machine') });
add('live.life-social', { live: richLive, state: tabSub('life', 'social') });
add('live.studio-rec', { live: richLive, state: { tab: 'studio', studioFilter: 'rec' } });
add('live.runs', { live: richLive, state: { runsOpen: true, expandedRun: 'k1' } });
// an (inert) bridge object: the writable branches (nothing on it is called while rendering)
add('bridge.home', { hq: {}, state: { tab: 'home' } });
add('bridge.project-a', { hq: {}, state: page('a', 'git') });

// ---- Phase 3 (v3 parity) states -------------------------------------------------------------
// an inert bridge with the Phase 3 methods, so their buttons render enabled
const P3_HQ = { captureSave() {}, healthScan() {}, healthFix() {}, claudeQuest() {}, canvasAdd() {}, rescanSpellbook() {}, castSpell() {}, studio: { libraryReveal() {} } };
const FRESH_PC = { scanned_at: '2026-10-05T09:58:00Z', host: { name: 'test-pc' }, organs: [organ('cpu', { value: 9, status: 'grace' }), organ('gpu', { label: 'Graphics', value: 96, status: 'ember', diagnosis: 'GPU running hot', fixes: [] })] };
// P8 palette: the capture verb, and the new Commands rows found by searching
add('overlay.palette-go-capture', { state: palette('capture Some Idea For Later') });
add('overlay.palette-go-trailers', { state: palette('trailers') });
add('overlay.palette-go-ask-panel', { state: palette('ask panel') });
// P8 What's new (bundled flags as this build has them), its fallback, over Settings
add('overlay.whats-new', { state: { whatsNewOpen: true } });
add('overlay.whats-new-fallback', { state: { whatsNewOpen: true, whatsNewMissing: { 'hq-trailer-1': true, 'hq-trailer-2': true } } });
add('overlay.whats-new-over-settings', { state: { settingsOpen: true, whatsNewOpen: true } });
// P2 System: Re-examine running, a fresh report (no reload: store.refreshMachine), every issue fixed, clutter saves
add('system.examining', { hq: P3_HQ, state: (c) => ({ ...tabSub('system', 'machine')(c), sysExamining: true }) });
add('system.reexamined', { hq: P3_HQ, live: (L, store) => { store.refreshMachine(FRESH_PC); }, state: tabSub('system', 'machine') });
add('system.all-fixed', { hq: P3_HQ, state: (c) => ({ ...tabSub('system', 'machine')(c), fixed: ['organ-disk', 'organ-ram'] }) });
add('system.clutter-saves', { hq: P3_HQ, state: (c) => ({ ...tabSub('system', 'clutter')(c), sysSaves: { 'Clean up: Project A copy ↔ Project A': 'saving', 'Clean up: notes ↔ notes-old': 'noted', 'Clean up: x ↔ y': 'failed' } }) });
add('system.clutter-past', { hq: P3_HQ, state: (c) => ({ ...tabSub('system', 'clutter')(c), snapOffset: 1 }) });
// H1 Claude Hub card (spec 2026-10-13 §9 System): each state of the Hub, injected into the store.
// An (inert) bridge is part of every one: without window.hq the card is hidden (hubShow false).
const HUB_COUNTS = { projects: 3, conversations: 40, messages: 900 };
const hubAt = (hub) => ({ hq: P3_HQ, live: (L) => { L.claudeHub = hub; }, state: tabSub('system', 'machine') });
add('system.hub-indexing', hubAt({ state: 'indexing', role: 'writer', node: 'v25.6.1', backfill: { done: 8, total: 32 }, counts: HUB_COUNTS, dbBytes: 5 * 1048576 }));
add('system.hub-ready', hubAt({ state: 'ready', role: 'writer', node: 'v25.6.1', backfill: { done: 32, total: 32 }, counts: HUB_COUNTS, dbBytes: 2048 }));
add('system.hub-reader', hubAt({ state: 'ready', role: 'reader', node: 'v25.6.1', counts: { projects: 0, conversations: 0, messages: 0 } }));
add('system.hub-no-node', hubAt({ state: 'no-node', node: 'v20.1.0', error: 'Claude Hub needs Node 22.13 or newer (found v20.1.0)' }));
add('system.hub-down', hubAt({ state: 'down', node: 'v25.6.1', error: 'Claude Hub exited (1)' }));
// H2 Claude library (Task 11): own inert bridge CL_HQ (P3_HQ itself stays untouched so no earlier scenario moves)
const CL_AT = '2026-10-04T09:00:00.000Z';
const CL_CONV = { id: 'code:g-1', source: 'code', project_id: 'code:g-p', title: 'Golden chat', last_at: CL_AT, message_count: 3, tokens_in: 5, tokens_out: 9, project_name: 'project-a', hq_project_id: null };
const CL_HQ = { ...P3_HQ, claudeHub: { link() {}, forget() {}, reindex() {} } };
const clAt = (lib, tab, sub, state = {}) => ({ hq: CL_HQ, live: (L) => { L.claudeHub = { state: 'ready', role: 'writer', counts: HUB_COUNTS }; Object.assign(L.claudeLib, lib); }, state: (c) => ({ ...tabSub(tab, sub)(c), ...state }) });
add('claude.chats-rows', clAt({ projects: [], convs: [CL_CONV], convsMore: true }, 'claude', 'chats'));
add('claude.chats-hits', clAt({ convs: [CL_CONV], q: 'img', hits: [{ conversationId: 'code:g-1', messageId: 'm', title: 'Golden chat', at: CL_AT, snippet: '\u0002<img src=x>\u0003 tail' }] }, 'claude', 'chats', { clSearched: true }));
add('claude.thread', clAt({ convs: [CL_CONV], thread: { conversation: CL_CONV, hasMore: true, messages: [{ id: 'm1', role: 'tool', at: CL_AT, text: 'out' }, { id: 'm2', role: 'assistant', at: CL_AT, text: 'reply' }] } }, 'claude', 'chats', { clOpen: true }));
add('claude.projects', clAt({ projects: [{ id: 'code:g-p', name: 'project-a', path: 'C:\\placeholder\\project-a', conversations: 1, last_at: CL_AT, hq_project_id: 'project-a', link_state: 'auto' }] }, 'claude', 'projects'));
// Claude Hub H3 — composer. A bridge with claudeChat (never started: render() does not call store.start()).
const CC_HQ = { ...P3_HQ, claudeChat: { send() {}, cancel() {}, on() { return () => {}; } } };
const CC_SID = '00000000-0000-4000-8000-000000000001';
const ccTurn = (o) => ({ turnId: 'g-1', convId: 'code:' + CC_SID, projectId: null, prompt: 'Placeholder question', mode: 'read-only', status: 'running',
  items: [{ type: 'text', text: 'Placeholder answer' }, { type: 'tool', name: 'Read', hint: 'README.md' }], sessionId: CC_SID, usage: null, error: null, seeded: null,
  startedAt: Date.parse('2026-10-05T09:59:00Z'), endedAt: null, ...o });
// tabSub(tab, sub) returns a FUNCTION (c) => ({...}): call it - spreading the function itself yields {} and every scenario would render Home
const ccAt = (state, turns) => ({ hq: CC_HQ, live: (L) => { L.claudeChat = { turns }; }, state: (c) => ({ ...tabSub('claude', 'chats')(c), ...state }) });
add('claude.composer-new', ccAt({ ccOpen: true }, []));
add('claude.composer-streaming', ccAt({ ccOpen: true, ccConv: 'code:' + CC_SID }, [ccTurn()]));
add('claude.composer-edits-done', ccAt({ ccOpen: true, ccConv: 'code:' + CC_SID, ccMode: 'edits' }, [ccTurn({ mode: 'edits', status: 'done', usage: { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 }, endedAt: Date.parse('2026-10-05T10:00:00Z') })]));
add('claude.composer-error', ccAt({ ccOpen: true, ccConv: 'code:' + CC_SID }, [ccTurn({ status: 'error', error: 'stopped after 10 min', endedAt: Date.parse('2026-10-05T10:00:00Z') })]));
add('history.claude-activity', clAt({ stats: { days: [{ day: '2026-10-04', chats: 1, messages: 3, active_ms: 60000 }], projects: [], totals: { chats: 1, active_ms: 60000 } } }, 'history', 'trends'));
// P3 project page: bridge (⚡ Terminal, Add to ideas enabled), a gap being saved, Security flags
add('project.a.p3-bridge', { hq: P3_HQ, state: page('a', 'security', { sysSaves: { 'Project A: add a test suite': 'noted' } }) });
add('project.c.git-risk', { state: page('c', 'git') });
// P4 Studio: a snip in the lightbox (the recording one is overlay.lightbox), the recordings filter with a bridge
add('overlay.lightbox-snip', { hq: P3_HQ, live: (L) => { L.captures = A.captures(CAPTURE_ROWS); }, state: (c, M) => ({ tab: 'studio', lightbox: M.CAPTURES[0].id }) });
add('overlay.lightbox-thumb-only', { live: (L) => { L.captures = A.captures(CAPTURE_ROWS); }, state: (c, M) => ({ tab: 'studio', lightbox: M.CAPTURES[2].id }) });
// P5 Canvas ＋ Note: form open on the second board, saving, no bridge (disabled with the reason)
add('claude.canvas-note', { hq: P3_HQ, state: (c) => ({ ...tabSub('claude', 'canvas')(c), canvasNoteOpen: true, canvasDraft: 'A note for the board', canvasBoard: 'Board One' }) });
add('claude.canvas-note-saving', { hq: P3_HQ, state: (c) => ({ ...tabSub('claude', 'canvas')(c), canvasNoteOpen: true, canvasDraft: 'A note for the board', canvasSaving: true }) });
add('claude.canvas-note-nobridge', { state: (c) => ({ ...tabSub('claude', 'canvas')(c), canvasNoteOpen: true }) });
add('claude.canvas-pushed-boards', { hq: P3_HQ, live: (L) => { L.canvasBoards = A.canvasBoards({ boards: [{ name: 'Board Two', nodes: [] }, { name: 'bad/name', nodes: [] }] }); }, state: (c) => ({ ...tabSub('claude', 'canvas')(c), canvasNoteOpen: true }) });
// P6 Automations: kind / source / category chips, nothing matching, Show more, Rescan running, an interactive confirm
add('auto.interactive', { state: (c) => ({ ...tabSub('automations', 'runnable')(c), libKind: 'interactive' }) });
add('auto.source-skill', { state: (c) => ({ ...tabSub('automations', 'runnable')(c), libSource: 'skill' }) });
add('auto.school', { state: (c, M) => ({ ...tabSub('automations', 'runnable')(c), libSchool: M.AUTOS[0].cat }) });
add('auto.none', { state: (c) => ({ ...tabSub('automations', 'runnable')(c), autoQuery: 'zzz-none' }) });
add('auto.rescanning', { hq: P3_HQ, state: (c) => ({ ...tabSub('automations', 'runnable')(c), libRescanning: true, libShow: 160 }) });
add('overlay.confirm-interactive', { hq: P3_HQ, state: (c, M) => ({ tab: 'automations', confirm: M.INTERACTIVE[0].id, confirmAsk: 'always' }) });
// P7 Projects: status chip, a search on the name, a search matching nothing
add('projects.status-risk', { state: (c) => ({ ...tabSub('projects', 'grid')(c), projStatus: 'risk' }) });
add('projects.search-name', { state: (c) => ({ ...tabSub('projects', 'grid')(c), projSearch: 'PROJECT c' }) });
add('projects.search-none', { state: (c) => ({ ...tabSub('projects', 'grid')(c), projSearch: 'zzz-none', projStatus: 'care' }) });

// ---- render + canonical hash -----------------------------------------------------------------
function render(sc) {
  localStorage.clear(); sessionStorage.clear();
  const w = sc.width || 1440;
  window.innerWidth = w; document.documentElement.clientWidth = w;
  const store = createStore(sc.data === 'empty' ? {} : DATA(), sc.hq === undefined ? null : sc.hq);
  if (sc.live) sc.live(store.live, store);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  if (sc.props) Object.assign(c.props, sc.props);   // setProps-style
  if (sc.setup) sc.setup(c);
  if (sc.state) Object.assign(c.state, typeof sc.state === 'function' ? sc.state(c, store.model) : sc.state);
  return c.renderVals();
}

// keys sorted recursively · functions "[fn]" · {current} refs "[ref]" · undefined dropped
// (in arrays too) · Date → ISO · non-finite numbers spelled out · cycles "[circular]"
function canon(x, stack = new Set()) {
  if (x === null) return null;
  const t = typeof x;
  if (t === 'function') return '[fn]';
  if (t === 'undefined') return undefined;
  if (t === 'number') return Number.isFinite(x) ? x : '[' + String(x) + ']';
  if (t === 'bigint') return String(x) + 'n';
  if (t === 'symbol') return '[symbol]';
  if (t !== 'object') return x;
  if (Object.prototype.toString.call(x) === '[object Date]') return Number.isNaN(x.getTime()) ? '[invalid date]' : x.toISOString();
  if (stack.has(x)) return '[circular]';
  stack.add(x);
  let out;
  if (Array.isArray(x)) out = x.map((v) => canon(v, stack)).filter((v) => v !== undefined);
  else {
    const keys = Object.keys(x);
    if (keys.length === 1 && keys[0] === 'current') out = '[ref]';
    else { out = {}; for (const k of keys.sort()) { const v = canon(x[k], stack); if (v !== undefined) out[k] = v; } }
  }
  stack.delete(x);
  return out;
}
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

test('scenario names are unique and file-safe', () => {
  const names = SCEN.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'duplicate scenario names');
  for (const n of names) assert.match(n, /^[a-z0-9][a-z0-9.-]*$/, 'not file-safe: ' + n);
});

test('renderVals golden: every scenario matches __golden__/vals.hashes.json', (t) => {
  if (DUMP) {
    const rel = relative(REPO, DUMP);
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) assert.fail('GOLDEN_DUMP must point outside the repo (got ' + DUMP + ')');
    mkdirSync(DUMP, { recursive: true });
  }
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const unpin = pinLocale();
  try {
    const got = {}, threw = [], unstable = [];
    for (const sc of SCEN) {
      let json, again;
      try { json = JSON.stringify(canon(render(sc))); again = JSON.stringify(canon(render(sc))); }
      catch (e) { threw.push(sc.name + ' · ' + ((e && e.stack) || e)); continue; }
      if (json !== again) unstable.push(sc.name);
      got[sc.name] = sha(json);
      if (DUMP) writeFileSync(join(DUMP, sc.name + '.json'), JSON.stringify(JSON.parse(json), null, 2) + '\n');
    }
    assert.deepEqual(threw, [], 'renderVals threw in:\n' + threw.join('\n'));
    assert.deepEqual(unstable, [], 'two renders of the same scenario differ (non-deterministic): ' + unstable.join(', '));
    if (UPDATE) {
      mkdirSync(dirname(HASHES), { recursive: true });
      writeFileSync(HASHES, JSON.stringify(sorted(got), null, 2) + '\n');
      t.diagnostic('UPDATE_GOLDEN: wrote ' + Object.keys(got).length + ' scenario hashes to ' + relative(REPO, HASHES));
      return;
    }
    const want = JSON.parse(readFileSync(HASHES, 'utf8'));
    const changed = Object.keys(got).filter((k) => k in want && want[k] !== got[k]).sort();
    const added = Object.keys(got).filter((k) => !(k in want)).sort();
    const gone = Object.keys(want).filter((k) => !(k in got)).sort();
    if (changed.length || added.length || gone.length) {
      assert.fail([
        changed.length ? changed.length + ' scenario(s) render differently:\n  ' + changed.join('\n  ') : '',
        added.length ? 'not in the hashes file:\n  ' + added.join('\n  ') : '',
        gone.length ? 'in the hashes file but no longer a scenario:\n  ' + gone.join('\n  ') : '',
        'Inspect with GOLDEN_DUMP=<dir outside the repo>; re-record with UPDATE_GOLDEN=1 only for a deliberate change.',
      ].filter(Boolean).join('\n'));
    }
  } finally {
    unpin();
  }
});

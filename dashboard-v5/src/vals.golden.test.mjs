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
const SOCIAL_SUMMARY = { kinds: [{ origin: 'facebook', kind: 'interests', docs: 2, newest_ms: 5 }, { origin: 'instagram', kind: 'posts', docs: 3, newest_ms: 30 }, { origin: 'instagram', kind: 'likes', docs: 1, newest_ms: 20 }], dms: [{ origin: 'instagram', conversations: 4, messages: 120, last_at: '2026-10-02T10:00:00Z' }] };
const TABS = ['home', 'projects', 'tasks', 'automations', 'claude', 'history', 'system', 'life', 'social', 'studio'];
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
// Claude Hub H5: the 7th chip on, an answer citing a chat, and a Hub-down note
const ASK_CLAUDE = [
  { q: 'What did we decide about the release?', id: 'c1', a: { text: 'From chat Release planning, 2026-10-01: Friday.', status: 'done', meta: { status: 'done', sections: ASK_SEC.concat([{ id: 'claude', label: 'Claude history', chars: 2400, clipped: false, cites: ['chat Release planning, 2026-10-01', 'chat Café menu, 2026-09-20'] }]), ms: 1500, model: 'placeholder-model' }, est: true } },
  { q: 'And the menu?', id: 'c2', a: { text: 'Not in what I can see.', status: 'done', meta: { status: 'done', sections: [{ id: 'claude', label: 'Claude history', chars: 0, clipped: false, cites: [], note: 'Claude Hub is not running' }], ms: 700, model: 'placeholder-model' }, est: true } },
];
add('overlay.ask-claude', { hq: LLM_HQ, live: (L) => { L.llm = { available: true, runtime: 'placeholder', chatModel: 'placeholder-model' }; }, state: { askOpen: true, askHistory: ASK_CLAUDE, askInclude: { scan: true, tasks: true, projects: true, health: false, browser: false, vault: false, claude: true } } });
// Claude Hub H5: the Save to vault dialog in each phase (an inert claudeVault bridge, so the button and actions are "wired")
const VAULT_HQ = { claudeVault: { preview() {}, save() {} } };
const VAULT_DRAFT = { id: 'code:s-1', path: 'C:\\placeholder-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Release planning.md', rel: '30_Areas/Claude/project-a/2026-10-01 Release planning.md', draft: '---\nconversation: "code:s-1"\n---\n# Release planning\n\n## Summary\nPlaceholder.\n', model: 'placeholder-model', basis: 12 };
add('overlay.vault-drafting', { hq: VAULT_HQ, state: { vault: { id: 'code:s-1', phase: 'drafting' } } });
add('overlay.vault-ready', { hq: VAULT_HQ, state: { vault: { ...VAULT_DRAFT, phase: 'ready', exists: false, askReplace: false, saveError: null } } });
add('overlay.vault-replace', { hq: VAULT_HQ, state: { vault: { ...VAULT_DRAFT, phase: 'ready', exists: true, askReplace: true, saveError: 'A note with this name appeared after the draft was made.' } } });
add('overlay.vault-error', { hq: VAULT_HQ, state: { vault: { id: 'code:s-1', phase: 'error', error: 'the local model isn’t running — start Ollama or LM Studio and try again (no runtime)' } } });
add('overlay.vault-saved', { hq: VAULT_HQ, state: { vault: { ...VAULT_DRAFT, phase: 'saved', exists: false } } });
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
add('live.social-inbox', { live: richLive, state: tabSub('social', 'inbox') });   // was live.life-social (Life › Social moved, 2026-10-27)
add('live.social-accounts', { live: richLive, state: tabSub('social', 'accounts') });
add('live.social-inbox-discard-ask', { hq: {}, live: richLive, state: (c) => ({ ...tabSub('social', 'inbox')(c), soDiscardAsk: 's1' }) });   // Discard's second-click state
add('live.social-archive', { live: (L, store) => { richLive(L, store); L.claudeHub = { state: 'ready', role: 'writer' }; L.socialArchive = { summary: SOCIAL_SUMMARY, error: null, busy: false, sel: { origin: 'instagram', kind: 'posts' }, list: [{ id: 'social:instagram:posts:1', source: 'social', origin: 'instagram', title: 'Instagram · your posts (1–2)', mtime_ms: Date.parse('2026-10-01T00:00:00Z') }], listErr: null, q: 'placeholder', hits: [{ id: 'social:facebook:interests:1', source: 'social', origin: 'facebook', title: 'Facebook · pages', mtime_ms: Date.parse('2026-09-01T00:00:00Z'), snippet: 'a placeholder page' }], doc: { id: 'social:instagram:posts:1', source: 'social', title: 'Instagram · your posts (1–2)', text: ['line one', 'line two'].join(String.fromCharCode(10)), mtime_ms: Date.parse('2026-10-01T00:00:00Z'), meta: { origin: 'instagram', kind: 'posts' } } }; }, state: (c) => ({ ...tabSub('social', 'archive')(c), soQuery: 'placeholder', soSearched: true }) });
add('social.archive-empty', { live: (L) => { L.claudeHub = { state: 'ready', role: 'writer' }; L.socialArchive = { summary: { kinds: [], dms: [] }, error: null, busy: false, sel: null, list: null, listErr: null, q: '', hits: null, doc: null }; }, state: tabSub('social', 'archive') });
add('social.archive-hub-down', { live: (L) => { L.claudeHub = { state: 'no-node', node: 'v20.0.0' }; }, state: tabSub('social', 'archive') });
add('live.social-vault', { hq: {}, live: (L) => { L.socialVault = { vault: 'Example Vault', folder: '30_Areas/Social', exists: true, obsidian: true, notes: [{ rel: '30_Areas/Social/Plan.md', name: 'Plan.md', title: 'Posting plan', mtime: Date.parse('2026-10-20T00:00:00Z'), size: 10, where: 'social' }, { rel: '00_Inbox/Social Profile — Example.md', name: 'Social Profile — Example.md', title: 'Social Profile — Example', mtime: Date.parse('2026-10-26T00:00:00Z'), size: 10, where: 'inbox' }], error: null, busy: false }; }, state: (c) => ({ ...tabSub('social', 'vault')(c), soTitle: 'A title', soBody: 'Some text' }) });
add('social.vault-new', { live: (L) => { L.socialVault = { vault: 'Example Vault', folder: '30_Areas/Social', exists: false, obsidian: false, notes: [], error: null, busy: false }; }, state: tabSub('social', 'vault') });
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
// PC health detail panels (2026-10-26): every panel filled from a placeholder report (pc-health detail + trends)
const DETAIL_PC = { ...FRESH_PC, detail: {
  gpus: [{ name: 'Placeholder dGPU', vramGB: 8, vramSource: 'registry', driverDate: '2026-07-02', driverDays: 100 }, { name: 'Placeholder iGPU', vramGB: 0.5, vramSource: 'wmi', driverDate: '2025-12-11', driverDays: 320, width: 1920, height: 1080, hz: 144 }],
  gpuLive: { name: 'Placeholder dGPU', tempC: 88, loadPct: 40, memUsedMB: 2048, memTotalMB: 8192, powerW: 60.25, powerLimitW: 115, clockMHz: 1500, pstate: 'P0' },
  topRam: [{ name: 'app-a', count: 20, mb: 3072 }, { name: 'app-b', count: 1, mb: 512 }],
  topCpu: [{ name: 'app-a', pct: 12 }, { name: 'app-b', pct: 0 }],
  hogs: { at: '2026-10-05T09:00:00Z', partial: true, items: [{ path: 'C:/Users/tester/Videos', label: 'Videos', gb: 50 }, { path: 'C:/Users/tester/Downloads', label: 'Downloads', gb: 10.5 }] },
  recycleGB: 1.25,
  storage: [{ name: 'Placeholder NVMe', media: 'SSD', bus: 'NVMe', health: 'Healthy', sizeGB: 477 }, { name: 'Placeholder HDD', media: 'HDD', bus: 'SATA', health: 'Warning', sizeGB: 1000 }],
  battery: { pct: 15, plugged: false, runtimeMin: 75 }, power: { plan: 'High performance' },
  network: { adapter: 'Placeholder Wi-Fi', wireless: true, linkMbps: 287 },
  displays: [{ gpu: 'Placeholder iGPU', width: 1920, height: 1080, hz: 144 }],
  rebootPending: true, startupApps: ['App One', 'App Two'], uptimeHrs: 400,
  unreadable: ['CPU temperature', 'Battery wear'],
}, trends: [{ id: 'disk', dir: 'down', bad: true, text: 'Disk free fell 9.6 GB over this week (49.6 → 40 GB)' }, { id: 'ram', dir: 'flat', bad: false, text: 'RAM averaged 75% across the last 3 checks (peak 80%)' }] };
add('system.machine-detail', { hq: { ...P3_HQ, pcOpenFolder() {} }, live: (L, store) => { store.refreshMachine(DETAIL_PC); }, state: tabSub('system', 'machine') });
// Projects › GitHub (2026-10-26): a placeholder account snapshot (data/github.json), Refresh running, signed out, stale + partial
const GH = { v: 1, state: 'ok', at: '2026-10-05T09:30:00.000Z', login: 'octo-owner', partial: false, errors: [],
  totals: { repos: 3, private: 1, archived: 1, stars: 3, openPrs: 2, openIssues: 1, ciFailing: 1, cloned: 1, waiting: 2 },
  repos: [
    { full: 'octo-owner/alpha', name: 'alpha', url: 'https://github.com/octo-owner/alpha', private: false, fork: false, archived: false, pushedAt: '2026-10-05T08:00:00Z', stars: 3, forks: 0, desc: 'Placeholder repo', lang: 'JavaScript', openPrs: 2, openIssues: 1, branch: 'main', lastCommit: { at: '2026-10-05T08:00:00Z', title: 'placeholder commit' }, ci: 'failure', local: 'C:/dev/alpha' },
    { full: 'octo-owner/beta', name: 'beta', url: 'https://github.com/octo-owner/beta', private: true, fork: true, archived: false, pushedAt: '2026-09-20T08:00:00Z', stars: 0, forks: 0, desc: '', lang: '', openPrs: 0, openIssues: 0, branch: 'main', lastCommit: null, ci: null, local: null },
    { full: 'octo-owner/gamma', name: 'gamma', url: 'https://github.com/octo-owner/gamma', private: false, fork: false, archived: true, pushedAt: '2025-01-01T00:00:00Z', stars: 0, forks: 0, desc: '', lang: 'Go', openPrs: 0, openIssues: 0, branch: 'main', lastCommit: null, ci: 'success', local: null },
  ],
  waiting: [
    { kind: 'review', repo: 'other/x', number: 4, title: 'Placeholder review', url: 'https://github.com/other/x/pull/4', updatedAt: '2026-10-05T07:00:00Z', author: 'someone', draft: false, ci: 'pending' },
    { kind: 'on-your-repo', repo: 'octo-owner/alpha', number: 7, title: 'Placeholder bump', url: 'https://github.com/octo-owner/alpha/pull/7', updatedAt: '2026-10-01T07:00:00Z', author: 'a-bot', draft: true, ci: 'failure' },
  ],
  mine: [{ kind: 'mine', repo: 'octo-owner/alpha', number: 8, title: 'Placeholder feature', url: 'https://github.com/octo-owner/alpha/pull/8', updatedAt: '2026-10-04T07:00:00Z', author: 'octo-owner', draft: false, ci: 'success' }],
  issues: [{ repo: 'other/x', number: 9, title: 'Placeholder issue', url: 'https://github.com/other/x/issues/9', updatedAt: '2026-10-03T07:00:00Z', author: 'someone' }] };
const GH_HQ = { ...P3_HQ, githubRefresh() {}, githubOpen() {} };
add('projects.github', { hq: GH_HQ, live: (L, store) => { store.refreshGithub(GH); }, state: tabSub('projects', 'github') });
add('projects.github-failing-refreshing', { hq: GH_HQ, live: (L, store) => { store.refreshGithub(GH); }, state: (c) => ({ ...tabSub('projects', 'github')(c), ghFilter: 'failing', ghBusy: true }) });
add('projects.github-signed-out', { hq: GH_HQ, live: (L, store) => { store.refreshGithub({ v: 1, state: 'signed-out', at: '2026-10-05T09:30:00.000Z', error: 'Not signed in to GitHub — run: gh auth login' }); }, state: tabSub('projects', 'github') });
add('projects.github-stale-partial', { hq: GH_HQ, live: (L, store) => { store.refreshGithub({ ...GH, stale: true, staleReason: 'repos: network', partial: true, waiting: [], totals: { ...GH.totals, waiting: null } }); }, state: tabSub('projects', 'github') });
add('projects.github-none', { state: tabSub('projects', 'github') });
// Projects › Vercel & Supabase (2026-10-26, Front D3): a placeholder data/accounts.json — both connected, not connected, stale + refreshing
const DEP = (o) => ({ project: 'site-a', state: 'ready', target: 'production', url: 'https://site-a-x1.vercel.app', at: '2026-10-05T08:00:00.000Z', commit: 'placeholder commit', branch: 'main', ...o });
const ACC = { v: 1,
  vercel: { state: 'ok', at: '2026-10-05T09:30:00.000Z', user: 'octo-owner', partial: false, errors: [], totals: { projects: 2, prodFailing: 1, building: 1 },
    projects: [
      { name: 'site-a', framework: 'nextjs', repo: 'octo-owner/site-a', dashboard: 'https://vercel.com/octo-team/site-a', prod: DEP(), latest: DEP({ state: 'building', target: 'preview', url: 'https://site-a-x2.vercel.app', branch: 'feat' }), updatedAt: '2026-10-05T08:00:00.000Z' },
      { name: 'site-b', framework: '', repo: null, dashboard: 'https://vercel.com/octo-team/site-b', prod: DEP({ project: 'site-b', state: 'blocked', url: 'https://site-b-y1.vercel.app' }), latest: DEP({ project: 'site-b', state: 'blocked', url: 'https://site-b-y1.vercel.app' }), updatedAt: '2026-10-01T08:00:00.000Z' },
      { name: 'site-c', framework: '', repo: null, dashboard: '', prod: null, latest: null, updatedAt: '' },
    ],
    deploys: [DEP({ state: 'building', target: 'preview', url: 'https://site-a-x2.vercel.app', branch: 'feat' }), DEP({ project: 'site-b', state: 'error', url: '' })] },
  supabase: { state: 'ok', at: '2026-10-05T09:30:00.000Z', totals: { projects: 2, unhealthy: 1 },
    projects: [{ name: 'db-a', ref: 'abc', region: 'eu-west-1', status: 'active_healthy', createdAt: '', dashboard: 'https://supabase.com/dashboard/project/abc' }, { name: 'db-b', ref: 'def', region: 'us-east-1', status: 'inactive', createdAt: '', dashboard: '' }] } };
const AC_HQ = { ...P3_HQ, accountsRefresh() {}, accountsOpen() {} };
add('projects.accounts', { hq: AC_HQ, live: (L, store) => { store.refreshAccounts(ACC); }, state: tabSub('projects', 'accounts') });
add('projects.accounts-not-connected', { hq: AC_HQ, live: (L, store) => { store.refreshAccounts({ v: 1, vercel: { state: 'signed-out', at: '2026-10-05T09:30:00.000Z', error: 'Not signed in' }, supabase: { state: 'no-cli', at: '2026-10-05T09:30:00.000Z', error: 'not installed' } }); }, state: tabSub('projects', 'accounts') });
add('projects.accounts-stale-refreshing', { hq: AC_HQ, live: (L, store) => { store.refreshAccounts({ ...ACC, vercel: { ...ACC.vercel, stale: true, staleReason: 'network' }, supabase: { ...ACC.supabase, projects: [] } }); }, state: (c) => ({ ...tabSub('projects', 'accounts')(c), acBusy: true }) });
add('projects.accounts-none', { state: tabSub('projects', 'accounts') });
// data overhaul Front A2: the newest scan is days old (scans stopped landing) — the top bar says so
add('shell.stale-data', { live: (L, store) => { Object.defineProperty(store.model, 'FRESH', { configurable: true, get: () => ({ days: 4, stale: true, estAge: 3, badge: '4 days old', note: 'Data from a scan 4 days ago · completion %, insights and roadmap are estimates from 3 days before that scan' }) }); } });
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
// ---- Claude Hub H4: claude.ai import strip + web Continue
const CI_REP = { files: { conversations: true, projects: true }, conversations: { seen: 5, imported: 3, unchanged: 0, forgotten: 0, skipped: 2 },
  messages: { imported: 5, skipped: 1, empty: 1 }, projects: { seen: 2, imported: 1, unchanged: 0, forgotten: 0, skipped: 1 }, unknownFields: { mystery_field: 1 }, truncated: false };
const CI_HUB = { state: 'ready', role: 'writer', node: 'v25.6.1', backfill: { done: 3, total: 3 }, counts: HUB_COUNTS, lastImport: null, importing: false };
const CI_HQ = { ...P3_HQ, claudeHub: { importExport() {} } };
const ciAt = (imp, hub = CI_HUB) => ({ hq: CI_HQ, live: (L) => { L.claudeHub = hub; L.claudeImport = imp; }, state: tabSub('claude', 'chats') });
add('claude.import-running', ciAt({ kind: 'import', phase: 'conversations', done: 12, total: 0 }));
add('claude.import-done', ciAt({ kind: 'import', phase: 'done', done: 5, total: 5, report: CI_REP }));
add('claude.import-failed', ciAt({ kind: 'import', phase: 'failed', done: 0, total: 0, error: 'not a zip file' }));
add('claude.import-reader', ciAt(null, { ...CI_HUB, role: 'reader' }));
add('claude.import-last', ciAt(null, { ...CI_HUB, lastImport: { at: '2026-10-04T08:00:00.000Z', ok: true, report: CI_REP } }));
// ---- AI archive H6: document hits + in-place view, drop confirm card, System ChatGPT report, ChatGPT source filter
const H6_DOCS = [{ id: 'memory:1', source: 'memory', title: 'Tea rule', snippet: 'offer \u0002tea\u0003', mtime_ms: 1759320000000 }];
add('claude.h6-doc-hits', { hq: CI_HQ, live: (L) => { L.claudeLib = { ...L.claudeLib, q: 'tea', hits: [], docHits: H6_DOCS }; }, state: tabSub('claude', 'chats') });
add('claude.h6-doc-open', { hq: CI_HQ, live: (L) => { L.claudeLib = { ...L.claudeLib, doc: { id: 'memory:1', source: 'memory', title: 'Tea rule', text: 'a\n\nb', mtime_ms: 1759320000000 } }; }, state: tabSub('claude', 'chats') });
add('claude.h6-drop-card', { hq: CI_HQ, live: (L) => { L.claudeImports = { folder: { exists: true, name: 'WorkspaceHQ Imports' }, found: [{ dropId: 'd1', file: 'chatgpt-export.zip', bytes: 39845888, kind: 'chatgpt' }], refused: [], error: null }; }, state: tabSub('claude', 'chats') });
add('system.h6-chatgpt-report', { hq: CI_HQ, live: (L) => { L.claudeHub = { state: 'ready', role: 'writer', counts: { projects: 1, conversations: 4, messages: 10, documents: 5 }, lastImport: { at: '2026-10-25T10:00:00Z', ok: true, source: 'chatgpt', report: { source: 'chatgpt', conversations: { imported: 4 }, messages: { imported: 10 }, branches: { skipped: 2 }, files: { other: [] }, memory: { found: false, imported: 0 } } } }; }, state: tabSub('system', 'machine') });
add('claude.h6-chatgpt-filter', { hq: CI_HQ, live: (L) => { L.claudeLib = { ...L.claudeLib, convs: [] }; }, state: (c) => ({ ...tabSub('claude', 'chats')(c), clSrc: 'chatgpt' }) });
add('claude.web-continue', { hq: CC_HQ, live: (L) => {
  L.claudeLib.thread = { conversation: { id: 'web:g-web', source: 'web', title: 'Golden web chat', project_id: 'web:chats' }, messages: [], hasMore: false };
  L.claudeLib.projects = [{ id: 'web:chats', source: 'web', key: 'chats', name: 'claude.ai chats', hq_project_id: null, link_state: 'none', conversations: 1, last_at: CL_AT }];
}, state: (c) => ({ ...tabSub('claude', 'chats')(c), ccOpen: true, ccConv: 'web:g-web' }) });
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
// Prompt library P1 — Claude › Prompts › Library (spec 2026-10-15 §6.3)
const PR_HQ = { claudeHub: { documents() {}, promptStats() {} }, claudePrompts: { status() {}, open() {} } };
const PR_ROWS = [
  { id: 'prompt:g1', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\review-a-pr.md', title: 'Golden review prompt', mtime_ms: 1, meta: { tags: ['review', 'code'] }, variables: ['project', 'file'] },
  { id: 'prompt:g2', source: 'prompt', path: 'C:\\placeholder\\vault\\40_Resources\\Prompts\\weekly.md', title: 'Golden weekly digest', mtime_ms: 2, meta: { tags: 'notes' }, variables: [] },
];
const PR_STATUS = (o = {}) => ({ vault: 'VEEMO CORTEX', rel: '40_Resources/Prompts', folder: { exists: true }, obsidian: true, ...o });
const prLive = (P) => (L) => { L.prompts = { rows: null, stats: null, status: null, q: '', hits: null, error: null, statsErr: null, busy: false, ...P }; };
const PR_AT = tabSub('claude', 'prompts');   // tabSub returns a (c) => patch function: pass it as `state` itself, or call it with c
add('claude.prompts-list', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [{ prompt_id: 'prompt:g1', uses: 2, last_at: '2026-10-01T10:00:00Z' }], status: PR_STATUS() }), state: PR_AT });
add('claude.prompts-not-run', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [], status: PR_STATUS() }), state: PR_AT });
add('claude.prompts-no-obsidian', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [], status: PR_STATUS({ obsidian: false }) }), state: PR_AT });
add('claude.prompts-nofolder', { hq: PR_HQ, live: prLive({ rows: [], stats: [], status: PR_STATUS({ folder: { exists: false } }) }), state: PR_AT });
add('claude.prompts-empty', { hq: PR_HQ, live: prLive({ rows: [], stats: [], status: PR_STATUS() }), state: PR_AT });
add('claude.prompts-error', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, error: 'Claude Hub: hub not running', status: PR_STATUS() }), state: PR_AT });
add('claude.prompts-nobridge', { live: prLive({}), state: PR_AT });   // no `hq` → render() passes null (vals.golden.test.mjs render: `sc.hq === undefined ? null`)
add('claude.prompts-nohits', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [], status: PR_STATUS(), q: 'zzz', hits: [] }), state: (c) => ({ ...PR_AT(c), prQuery: 'zzz', prSearched: true }) });
add('claude.prompts-for-project', { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [], status: PR_STATUS() }), state: (c) => ({ ...PR_AT(c), prFor: 'a' }) });   // 'a' = the base DATA project the `project.a.*` scenarios open
// Prompt library P3 — run modal + pack dialog (spec 2026-10-15 §6.3). Run states patch the Library scenario with state.run / state.pack.
const RN_ID = 'prompt:g1';
const rnRun = (o) => (c) => ({ ...PR_AT(c), run: { id: RN_ID, projectId: null, vars: {}, target: 'chat', mode: 'read-only', phase: 'edit', error: null, missing: [], result: null, ...o } });
const rnPack = (o) => (c) => ({ ...PR_AT(c), pack: { phase: 'plan', plan: RN_PLAN, result: null, error: null, ...o } });
const RN_PLAN = { planId: 'pack-' + '0'.repeat(16), source: 'placeholder-pack.zip', total: 3, skipped: { notMd: 1, tooBig: 0, tooMany: 0, duplicate: 0, unreadable: 0 },
  notes: [{ name: 'review-a-pr.md', title: 'Review a PR like a staff engineer', exists: true }, { name: 'standup-notes.md', title: 'Standup notes', exists: false }, { name: 'bug-triage.md', title: 'Bug triage', exists: false }] };
const RN_BASE = { hq: PR_HQ, live: prLive({ rows: PR_ROWS, stats: [], status: PR_STATUS() }) };
add('claude.run-chat-edit', { ...RN_BASE, state: rnRun({}) });
add('claude.run-chat-ready', { ...RN_BASE, state: rnRun({ projectId: 'a', vars: { file: 'a.js' } }) });
add('claude.run-missing', { ...RN_BASE, state: rnRun({ projectId: 'a', phase: 'error', error: 'fill in {{file}}', missing: ['file'] }) });
add('claude.run-copy-done', { ...RN_BASE, state: rnRun({ target: 'claude.ai', phase: 'done', result: { ok: true, target: 'claude.ai', title: 'x', usage: 'recorded' } }) });
add('claude.run-not-counted', { ...RN_BASE, state: rnRun({ target: 'chatgpt', phase: 'done', result: { ok: true, target: 'chatgpt', title: 'x', usage: 'not recorded: read-only hub (another WorkspaceHQ owns the index)' } }) });
add('claude.pack-plan', { ...RN_BASE, state: rnPack({}) });
add('claude.pack-done', { ...RN_BASE, state: rnPack({ phase: 'done', result: { imported: 2, masked: 0, skipped: { exists: 1, failed: 0 } } }) });
add('claude.pack-error', { ...RN_BASE, state: rnPack({ phase: 'error', plan: null, error: 'that ZIP is over 50 MB' }) });
// P2 harvest candidates + Promote dialog (placeholder text)
const HC_HQ = { ...PR_HQ, claudeHub: { ...PR_HQ.claudeHub, promptCandidates() {}, hideCandidate() {} }, claudePrompts: { ...PR_HQ.claudePrompts, promote() {} } };
const HC_AT = (o) => (c) => ({ ...PR_AT(c), ...o });
const HC1 = 'cand:' + '1'.repeat(40), HC2 = 'cand:' + '2'.repeat(40);
const HC_ROWS = () => [
  { key: HC1, text: 'Placeholder prompt one: review the placeholder module and list what to change, file by file.', score: 11, sessions: 3, lastAt: '2026-10-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 9, text: 'used in 3 sessions' }, { key: 'turns', points: 2, text: 'followed by 8 assistant messages' }],
    sources: [{ kind: 'code', conversationId: 'code:sess-a1', at: '2026-10-01T10:00:00Z', project: 'project-a' }, { kind: 'history', documentId: 'history:sess-a1:0', at: '2026-09-20T09:00:00Z', project: 'project-a' }] },
  { key: HC2, text: 'Placeholder prompt two: draft a placeholder plan with steps, owners and checks for each step.', score: -4, sessions: 1, lastAt: '2026-09-01T10:00:00Z',
    reasons: [{ key: 'reuse', points: 0, text: 'seen in 1 session' }, { key: 'turns', points: 0, text: 'no assistant message followed it' }, { key: 'length', points: 1, text: '300+ characters' }, { key: 'library', points: -5, text: 'already a prompt note' }],
    sources: [{ kind: 'chatgpt', conversationId: 'chatgpt:placeholder-1', at: '2026-09-01T10:00:00Z', project: null }] },
];
const HC_LIVE = (o = {}) => (L) => { L.candidates = { rows: HC_ROWS(), pooled: { messages: 42, history: 17 }, capped: { messages: false, history: false }, hidden: 0, error: null, busy: false, loaded: true, ...o }; };
const HC_ITEM = (t) => ({ key: HC1, title: t, text: 'Placeholder prompt one: review the placeholder module.', source: { kind: 'code', conversation: 'code:sess-a1', at: '2026-10-01T10:00:00Z' } });
add('claude.candidates-list', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', hcSel: [HC1] }) });
add('claude.candidates-capped', { hq: HC_HQ, live: HC_LIVE({ capped: { messages: true, history: true }, hidden: 3 }), state: HC_AT({ prView: 'candidates' }) });
add('claude.candidates-loading', { hq: HC_HQ, live: HC_LIVE({ rows: null, busy: true }), state: HC_AT({ prView: 'candidates' }) });
add('claude.candidates-empty', { hq: HC_HQ, live: HC_LIVE({ rows: [], pooled: { messages: 12, history: 3 } }), state: HC_AT({ prView: 'candidates' }) });
add('claude.candidates-error', { hq: HC_HQ, live: HC_LIVE({ error: 'Claude Hub: timeout' }), state: HC_AT({ prView: 'candidates' }) });
add('claude.candidates-nobridge', { live: HC_LIVE(), state: HC_AT({ prView: 'candidates' }) });
add('claude.promote-ask-single', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', promote: { seq: 1, keys: [HC1], items: [HC_ITEM('Placeholder prompt one')], phase: 'ask', clash: null, results: [], error: null } }) });
add('claude.promote-ask-multi', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', hcSel: [HC1, HC2], promote: { seq: 1, keys: [HC1, HC2], items: [HC_ITEM('Placeholder prompt one'), { ...HC_ITEM('Placeholder prompt two'), key: HC2 }], phase: 'ask', clash: null, results: [], error: null } }) });
add('claude.promote-clash', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', promote: { seq: 1, keys: [HC1], items: [HC_ITEM('Placeholder prompt one')], phase: 'clash', clash: { next: 'placeholder-prompt-one-2.md' }, results: [], error: null } }) });
add('claude.promote-done', { hq: HC_HQ, live: HC_LIVE(), state: HC_AT({ prView: 'candidates', promote: { seq: 1, keys: [HC1, HC2], items: [HC_ITEM('Placeholder prompt one'), { ...HC_ITEM('Placeholder prompt two'), key: HC2 }], phase: 'done', clash: null,
  results: [{ title: 'Placeholder prompt one', ok: true, name: 'placeholder-prompt-one.md' }, { title: 'Placeholder prompt two', ok: false, error: 'not written — a note with that name is there; promote it alone to save it as placeholder-prompt-two-2.md' }], error: null } }) });
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

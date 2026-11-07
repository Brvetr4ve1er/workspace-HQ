// node --test dashboard/tray-menu.test.mjs — the tray menu as data. Every
// pre-v5 tray capability must survive the redesign, and every click must reach
// the action it names (with the projects/spell its label counted).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { trayTemplate, statusLine, scanCounts } = require('./tray-menu.js');

// Placeholder scan (public repo): only the fields the tray reads.
const proj = (id, name, { dirty = 0, unpushed = false, secrets = 0 } = {}) => ({
  id, name, path: `~/dev/${id}`,
  metrics: { git_safety: { dirty, unpushed }, risk_security: { secrets_found: secrets } },
});
const SCAN = {
  account: { level: 8, daily_top3: [{ project_id: 'project-b', title: 'Fix the thing' }] },
  projects: [
    proj('project-a', 'Project A', { dirty: 30, unpushed: true, secrets: 2 }),
    proj('project-b', 'Project B', { dirty: 4 }),
    proj('project-c', 'Project C', { unpushed: true }),
  ],
};
const SPELLS = [{ id: 'sp-build', name: 'Build', icon: '🔨' }, { id: 'sp-test', name: 'Test' }];

function spyActions() {
  const calls = [];
  const names = ['show', 'scan', 'quickRun', 'openAutomations', 'cast',
    'pushAll', 'snapshotDirty', 'killServers', 'openUrgent', 'quit'];
  const actions = Object.fromEntries(names.map((n) => [n, (...args) => calls.push([n, ...args])]));
  return { actions, calls };
}
const labels = (items) => items.map((i) => (i.type === 'separator' ? '─' : i.label));
const byLabel = (items, re) => items.find((i) => typeof i.label === 'string' && re.test(i.label));
// Electron invokes click(menuItem, browserWindow, event) — mimic that.
const click = (item) => item.click({ checked: true }, null, {});

// ---------------------------------------------------------------- statusLine
test('statusLine: level, uncommitted file count and secrets', () => {
  assert.equal(statusLine(SCAN), 'lv 8 · 34 uncommitted · 2 secrets');
});
test('statusLine: zero parts are omitted, the level never is', () => {
  assert.equal(statusLine({ account: { level: 3 }, projects: [proj('a', 'A')] }), 'lv 3');
  assert.equal(statusLine({ account: { level: 3 }, projects: [proj('a', 'A', { dirty: 5 })] }), 'lv 3 · 5 uncommitted');
  assert.equal(statusLine({ account: { level: 3 }, projects: [proj('a', 'A', { secrets: 1 })] }), 'lv 3 · 1 secret');
});
test('statusLine: no scan → em dash', () => {
  assert.equal(statusLine(null), '—');
  assert.equal(statusLine(undefined), '—');
});
test('statusLine: a partial scan never throws', () => {
  assert.equal(statusLine({}), 'lv ?');
  assert.equal(statusLine({ account: { level: 2 }, projects: [null, {}, { metrics: {} }, proj('a', 'A', { dirty: 1 })] }), 'lv 2 · 1 uncommitted');
});

// ---------------------------------------------------------------- scanCounts
// The mini HUD gets these same numbers (main.js miniPayload, K-6).
test('scanCounts: uncommitted files and secrets summed, unpushed = projects', () => {
  assert.deepEqual(scanCounts(SCAN), { level: 8, uncommitted: 34, secrets: 2, unpushed: 2 });
});
test('scanCounts agrees with the status line', () => {
  const c = scanCounts(SCAN);
  assert.equal(statusLine(SCAN), `lv ${c.level} · ${c.uncommitted} uncommitted · ${c.secrets} secrets`);
});
test('scanCounts: no scan / partial scan → zeros and a null level, never throws', () => {
  const zero = { level: null, uncommitted: 0, secrets: 0, unpushed: 0 };
  assert.deepEqual(scanCounts(null), zero);
  assert.deepEqual(scanCounts(undefined), zero);
  assert.deepEqual(scanCounts({}), zero);
  assert.deepEqual(scanCounts({ account: { level: 2 }, projects: [null, {}, { metrics: {} }, proj('a', 'A', { dirty: -3, secrets: 'x' })] }),
    { level: 2, uncommitted: 0, secrets: 0, unpushed: 0 });
});

// ---------------------------------------------------------------- layout
test('layout: status line, the core items in design order, Run ▸, quick actions, Quit', () => {
  const { actions } = spyActions();
  const items = trayTemplate({ scan: SCAN, hudVisible: true, spells: SPELLS, devServers: 2 }, actions);
  assert.deepEqual(labels(items), [
    'lv 8 · 34 uncommitted · 2 secrets', '─',
    'Show workspace-hq', 'Scan now (uses Claude)', 'Quick-run… (Ctrl+Alt+X)', 'Run',
    '─', 'Quick actions',
    'Push committed work to the remote (2 projects)',
    'Back up projects with uncommitted changes (2)',
    'Stop all running dev servers (2)',
    "Open the most urgent project's folder: Project B",
    '─', 'Quit',
  ]);
  assert.equal(items[0].enabled, false, 'the status line is not clickable');
  assert.equal(byLabel(items, /^Quick actions$/).enabled, false);
});

test('Run ▸ lists the spells, then Open Automations', () => {
  const { actions } = spyActions();
  const run = byLabel(trayTemplate({ scan: SCAN, spells: SPELLS }, actions), /^Run$/);
  assert.deepEqual(labels(run.submenu), ['🔨 Build', '✴️ Test', '─', 'Open Automations']);
});

test('Run ▸ with no spells still offers Open Automations (no dangling separator)', () => {
  const { actions } = spyActions();
  const run = byLabel(trayTemplate({ scan: null, spells: [] }, actions), /^Run$/);
  assert.deepEqual(labels(run.submenu), ['Open Automations']);
});

test('no scan, nothing running: no quick actions, no double separators', () => {
  const { actions } = spyActions();
  const items = trayTemplate({ scan: null, hudVisible: false, spells: [] }, actions);
  assert.equal(items[0].label, '—');
  assert.equal(byLabel(items, /^Quick actions$/), undefined);
  assert.deepEqual(labels(items).slice(-3), ['Run', '─', 'Quit']);
});

test('dev servers alone (no scan) still offer Stop all running dev servers', () => {
  const { actions } = spyActions();
  const items = trayTemplate({ scan: null, spells: [], devServers: 1 }, actions);
  assert.ok(byLabel(items, /^Stop all running dev servers \(1\)$/));
});

test('a clean workspace hides the quick actions that do not apply', () => {
  const { actions } = spyActions();
  const clean = { account: { level: 1, daily_top3: [] }, projects: [proj('project-a', 'Project A')] };
  const items = trayTemplate({ scan: clean, spells: [] }, actions);
  assert.equal(byLabel(items, /^Quick actions$/), undefined);
  assert.equal(byLabel(items, /^Push /), undefined);
});

test('an urgent quest pointing at an unknown project offers no Open item', () => {
  const { actions } = spyActions();
  const scan = { account: { level: 1, daily_top3: [{ project_id: 'gone' }] }, projects: [proj('project-a', 'Project A')] };
  assert.equal(byLabel(trayTemplate({ scan, spells: [] }, actions), /most urgent/), undefined);
});

// ---------------------------------------------------------------- clicks
test('every click reaches the right action, with the right argument', () => {
  const { actions, calls } = spyActions();
  const items = trayTemplate({ scan: SCAN, hudVisible: true, spells: SPELLS, devServers: 2 }, actions);
  const run = byLabel(items, /^Run$/);

  const expect = [
    [byLabel(items, /^Show workspace-hq$/), ['show']],
    [byLabel(items, /^Scan now/), ['scan']],
    [byLabel(items, /^Quick-run/), ['quickRun']],
    [byLabel(run.submenu, /Build$/), ['cast', 'sp-build']],
    [byLabel(run.submenu, /Test$/), ['cast', 'sp-test']],
    [byLabel(run.submenu, /^Open Automations$/), ['openAutomations']],
    [byLabel(items, /^Stop all running dev servers/), ['killServers']],
    [byLabel(items, /^Quit$/), ['quit']],
  ];
  for (const [item, want] of expect) {
    calls.length = 0;
    click(item);
    assert.deepEqual(calls, [want], `${item.label} → ${want[0]}`);
  }

  calls.length = 0;
  click(byLabel(items, /^Push /));
  assert.equal(calls[0][0], 'pushAll');
  assert.deepEqual(calls[0][1].map((p) => p.id), ['project-a', 'project-c'], 'the projects the label counted');

  calls.length = 0;
  click(byLabel(items, /^Back up /));
  assert.equal(calls[0][0], 'snapshotDirty');
  assert.deepEqual(calls[0][1].map((p) => p.id), ['project-a', 'project-b']);

  calls.length = 0;
  click(byLabel(items, /most urgent/));
  assert.equal(calls[0][0], 'openUrgent');
  assert.equal(calls[0][1].id, 'project-b');
});

test('a missing action is a no-op, not a crash', () => {
  const items = trayTemplate({ scan: SCAN, spells: SPELLS }, {});
  for (const it of items) if (typeof it.click === 'function') assert.doesNotThrow(() => click(it));
  assert.doesNotThrow(() => trayTemplate(null, null));
  assert.equal(trayTemplate(null, null)[0].label, '—');
});

// ---------------------------------------------------------------- the Brief block (tray-brief view)
const VIEW = {
  status: 'ok', statusLine: 'Needs you · 4 · 1 new · 14:05', noteLine: null, showLevel: false, total: 4, newCount: 1,
  rows: [
    { ref: 'aaaaaaaaaaaa', scan: false, label: 'urgent · new · A project has secrets in plain sight' },
    { ref: 'bbbbbbbbbbbb', scan: true, label: 'soon · Scan data is old' },
  ],
  overflow: { label: '+2 more · CI failing on 2 repos' },
};

test('brief: with state.brief null or absent the template is exactly today\'s', () => {
  const { actions } = spyActions();
  const plain = trayTemplate({ scan: SCAN, spells: SPELLS, devServers: 1 }, actions);
  for (const brief of [null, undefined]) {
    const t = trayTemplate({ scan: SCAN, spells: SPELLS, devServers: 1, brief }, actions);
    assert.deepEqual(labels(t), labels(plain));
    assert.equal(JSON.stringify(t), JSON.stringify(plain), 'byte-identical');
  }
  assert.equal(plain[0].label, 'lv 8 · 34 uncommitted · 2 secrets');
});

test('brief: the status line leads, then up to 3 rows and the +N more line, all before Show workspace-hq', () => {
  const { actions } = spyActions();
  const t = trayTemplate({ scan: SCAN, spells: SPELLS, brief: VIEW }, actions);
  const l = labels(t);
  assert.deepEqual(l.slice(0, 5), ['Needs you · 4 · 1 new · 14:05', 'urgent · new · A project has secrets in plain sight', 'soon · Scan data is old', '+2 more · CI failing on 2 repos', '─']);
  assert.equal(l[5], 'Show workspace-hq');
  assert.equal(t[0].enabled, false, 'the status line is not clickable');
  assert.ok(!l.some((x) => /^lv 8/.test(x)), 'the level line is gone while the brief is ready');
  assert.deepEqual(l.slice(5), labels(trayTemplate({ scan: SCAN, spells: SPELLS }, actions)).slice(2), 'everything after the block is today\'s menu');
});

test('brief: a row opens its ref, a scan row runs the Scan path, the +N more line opens Home', () => {
  const { actions, calls } = spyActions();
  actions.openRef = (...a) => calls.push(['openRef', ...a]);
  const t = trayTemplate({ scan: SCAN, brief: VIEW }, actions);
  click(t[1]); click(t[2]); click(t[3]);
  assert.deepEqual(calls, [['openRef', 'aaaaaaaaaaaa'], ['openRef', 'bbbbbbbbbbbb'], ['scan'], ['show']], 'the scan row logs its use through openRef, then runs Scan');
  const bare = spyActions();
  click(trayTemplate({ scan: SCAN, brief: VIEW }, bare.actions)[2]);
  assert.deepEqual(bare.calls, [['scan']], 'without openRef the scan row still scans');
});

test('brief: not ready keeps today\'s level line below; an incomplete note sits under the header; more than 3 rows are cut to 3', () => {
  const { actions } = spyActions();
  const notReady = trayTemplate({ scan: SCAN, brief: { status: 'not-ready', statusLine: 'Brief not ready yet', noteLine: null, showLevel: true, rows: [], overflow: null } }, actions);
  assert.deepEqual(labels(notReady).slice(0, 3), ['Brief not ready yet', 'lv 8 · 34 uncommitted · 2 secrets', '─']);
  const note = trayTemplate({ scan: SCAN, brief: { ...VIEW, noteLine: "Brief incomplete · couldn't read github" } }, actions);
  assert.equal(labels(note)[1], "Brief incomplete · couldn't read github");
  assert.equal(note[1].enabled, false);
  const five = { ...VIEW, rows: [1, 2, 3, 4, 5].map((n) => ({ ref: String(n).repeat(12), scan: false, label: 'row ' + n })), overflow: null };
  assert.equal(labels(trayTemplate({ brief: five }, actions)).filter((x) => /^row /.test(x)).length, 3);
});

test('brief: a garbage brief or a missing openRef never throws', () => {
  for (const brief of ['x', 7, [], { rows: 'no', overflow: 3 }, { rows: [null, { ref: 5 }], statusLine: 9 }]) {
    assert.doesNotThrow(() => trayTemplate({ scan: SCAN, brief }, {}), JSON.stringify(brief));
  }
  const t = trayTemplate({ brief: VIEW }, {});
  assert.doesNotThrow(() => click(t[1]));
});

test('brief: the real tray-brief view feeds the template end to end', async () => {
  const { create } = require('./tray-brief.js');
  const tb = create({ log: () => {} });
  await tb.ready;
  tb.set({ v: 1, generatedAt: new Date().toISOString(), items: [{ key: 'secrets:a:2', rule: 'secrets', severity: 'high', text: 'Project A has 2 secrets in plain sight', why: 'x', source: 'scan', age: 'scan 1 h ago', count: 0, action: { kind: 'go', tab: 'projects', projectId: 'a' } }], more: 0, overflow: [], errors: [] });
  const opened = [];
  const t = trayTemplate({ scan: SCAN, brief: tb.view() }, { openRef: (ref) => tb.open(ref, (r) => opened.push(r)) });
  assert.match(t[0].label, /^Needs you · 1 · 1 new · \d\d:\d\d$/);
  assert.equal(t[1].label, 'urgent · new · A project has secrets in plain sight', 'projection wording: no project name on the tray');
  click(t[1]);
  assert.deepEqual(opened, [{ tab: 'projects', projectId: 'a' }]);
});

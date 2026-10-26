// dashboard/llm-context.test.mjs
// The Ask context assembler's Claude history section (Claude Hub H5, spec 2026-10-13 §9 Ask). Temp data dirs and
// temp vaults with placeholder text; the Hub is a recording fake — no real Hub, no real index, no real vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ctx = require('./llm-context.js');
const NOW = new Date('2026-10-05T10:00:00.000Z');

// The module as it was before H5 (commit 49025ed), compiled in memory under a name in dashboard/ so its
// relative require('./browser-bridge') resolves. Nothing is written to disk.
function preH5() {
  const src = execFileSync('git', ['show', '49025ed:dashboard/llm-context.js'], { cwd: HERE, encoding: 'utf8' });
  const file = path.join(HERE, '__pre_h5_llm_context__.js');
  const m = new Module(file, null);
  m.filename = file; m.paths = Module._nodeModulePaths(HERE);
  m._compile(src, file);
  return m.exports;
}
function workspace({ big = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-llmctx-'));
  const n = big ? 200 : 3;
  const S = {
    account: { level: 3, xp: 10, xp_to_next: 5, totals: {} }, scan: { id: 'scan-placeholder' },
    projects: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'project-' + i, activity: { state: 'active', last_commit: '2026-10-01', days_since_commit: i }, metrics: { git_safety: { has_git: true, branch: 'main', dirty: 1 } }, signals: {} })),
    quests: Array.from({ length: n }, (_, i) => ({ id: 'q' + i, status: 'open', tier: 'orange', title: 'Placeholder task ' + i + ' about the release plan', project_id: 'p' + i, age_days: i })),
  };
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(S));
  const vault = path.join(dir, 'vault');
  fs.mkdirSync(path.join(vault, '20_Notes'), { recursive: true });
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(vault, '20_Notes', 'release-' + i + '.md'), 'release plan placeholder '.repeat(200));
  return { dataDir: dir, vaultDir: vault, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
// a recording fake of claude-hub-host's request(): answer(args) → the Hub result or {error}
function fakeHub(answer) {
  const calls = [];
  return { calls, request: (op, args, opts) => { calls.push({ op, args, opts }); return Promise.resolve(typeof answer === 'function' ? answer(args) : answer); } };
}
const fill = (args) => {
  const text = ('CLAUDE HISTORY (placeholder)\n- chat "Release planning", 2026-10-01 · project-a · Claude Code\n  · you: ' + 'release plan '.repeat(400)).slice(0, args.budgetChars);
  return { text, chars: text.length, cites: ['chat Release planning, 2026-10-01'], hits: [{ conversationId: 'code:rel' }], words: ['release', 'plan'] };
};
const ALL = { scan: true, tasks: true, projects: true, health: false, browser: false, vault: true };

test('SECTION_IDS gains claude as the 7th, last entry; CLAUDE_RESERVE is 3000', () => {
  assert.deepEqual(ctx.SECTION_IDS, ['scan', 'tasks', 'projects', 'health', 'browser', 'vault', 'claude']);
  assert.equal(ctx.CLAUDE_RESERVE, 3000);
});

test('unticked: the context is byte-for-byte what it was before H5, and the Hub is never asked (Review Focus 2)', async () => {
  const w = workspace({ big: true });
  try {
    const hub = fakeHub(fill);
    const args = { dataDir: w.dataDir, vaultDir: w.vaultDir, include: ALL, query: 'what is the release plan?', now: NOW };
    const before = await preH5().assemble(args);
    const after = await ctx.assemble({ ...args, include: { ...ALL, claude: false }, claudeHub: hub });
    assert.deepEqual(after, before);
    assert.equal(hub.calls.length, 0);
  } finally { w.cleanup(); }
});

test('ticked on a big workspace: Claude history still gets its 3000 chars and the whole context stays ≤ 12000 (Review Focus 2)', async () => {
  const w = workspace({ big: true });
  try {
    const hub = fakeHub(fill);
    const r = await ctx.assemble({ dataDir: w.dataDir, vaultDir: w.vaultDir, include: { ...ALL, claude: true }, query: 'what is the release plan?', now: NOW, claudeHub: hub });
    assert.equal(hub.calls.length, 1);
    assert.equal(hub.calls[0].op, 'contextFor');
    assert.deepEqual(hub.calls[0].args, { query: 'what is the release plan?', budgetChars: 3000 });
    assert.deepEqual(hub.calls[0].opts, { timeout: 4000 });
    const c = r.sections.find((s) => s.id === 'claude');
    assert.equal(c.label, 'Claude history');
    assert.equal(c.chars, 3000);
    assert.deepEqual(c.cites, ['chat Release planning, 2026-10-01']);
    assert.ok(r.text.includes('CLAUDE HISTORY (placeholder)'));
    assert.ok(r.chars <= 12000, String(r.chars));
    const others = r.sections.filter((s) => s.id !== 'claude').reduce((a, s) => a + s.chars, 0);
    assert.ok(others > 8000, 'the fixture really is big: ' + others);
    assert.ok(others <= 12000 - 3000, String(others));
  } finally { w.cleanup(); }
});

test('the Hub missing, down, stopped, slow or broken: the answer still runs on the other sources and the note says why (Review Focus 3)', async () => {
  const w = workspace();
  const cases = [
    [null, 'Claude Hub is not running'],
    [fakeHub({ error: 'hub not running' }), 'Claude Hub is not running'],
    [fakeHub({ error: 'hub stopped' }), 'Claude Hub stopped while answering'],
    [fakeHub({ error: 'timeout' }), 'Claude Hub did not answer within 4 s'],
    [fakeHub({ error: 'the index is not open yet' }), 'the index is not open yet'],
    [fakeHub({ error: 'no such table: message_fts' }), 'no such table: message_fts'],
    [{ request: () => Promise.reject(new Error('boom')) }, 'boom'],
  ];
  try {
    for (const [hub, note] of cases) {
      const r = await ctx.assemble({ dataDir: w.dataDir, vaultDir: w.vaultDir, include: { scan: true, tasks: true, claude: true }, query: 'release plan', now: NOW, claudeHub: hub });
      const c = r.sections.find((s) => s.id === 'claude');
      assert.deepEqual(c, { id: 'claude', label: 'Claude history', chars: 0, clipped: false, cites: [], note }, note);
      assert.ok(r.sections.find((s) => s.id === 'tasks').chars > 0, note + ': the other sources still answer');
      assert.doesNotMatch(r.text, /CLAUDE HISTORY/);
    }
  } finally { w.cleanup(); }
});

test('the Hub found nothing: its own text goes in (the model hears "no past chats matched") and the note says so', async () => {
  const w = workspace();
  try {
    const text = 'CLAUDE HISTORY (placeholder)\n- no past chats matched: zebra';
    const hub = fakeHub({ text, chars: text.length, cites: [], hits: [], words: ['zebra'], note: 'no past chats matched' });
    const r = await ctx.assemble({ dataDir: w.dataDir, vaultDir: w.vaultDir, include: { claude: true }, query: 'zebra', now: NOW, claudeHub: hub });
    const c = r.sections.find((s) => s.id === 'claude');
    assert.deepEqual(c, { id: 'claude', label: 'Claude history', chars: text.length, clipped: false, cites: [], note: 'no past chats matched' });
    assert.ok(r.text.endsWith(text));
  } finally { w.cleanup(); }
});

test('claudeSection: never throws; a malformed Hub answer is an honest note, not an empty success', async () => {
  for (const bad of [undefined, null, 42, { text: 7 }, { cites: 'x' }]) {
    const r = await ctx.claudeSection(fakeHub(bad), 'release', 3000);
    assert.equal(r.text, '');
    assert.deepEqual(r.cites, []);
    assert.equal(r.note, 'the Claude Hub answered in an unknown shape');
  }
  const ok = await ctx.claudeSection(fakeHub(fill), 'release', 500);
  assert.equal(ok.text.length, 500);
  assert.deepEqual(ok.cites, ['chat Release planning, 2026-10-01']);
});

// ---- PC health in Ask (2026-10-26): real VRAM + detail lines when the sidecar has `detail`; old sidecars still omit VRAM
test('health: a new sidecar gives the real VRAM, what uses the machine, biggest folders and trends', async () => {
  const w = workspace();
  try {
    fs.writeFileSync(path.join(w.dataDir, 'pc-health.json'), JSON.stringify({
      scanned_at: '2026-10-26T10:00:00',
      organs: [{ id: 'gpu', label: 'Graphics', value: 8, unit: 'GB VRAM', status: 'grace', diagnosis: 'Placeholder dGPU · 8 GB' }],
      detail: { topRam: [{ name: 'app-a', mb: 3072 }], hogs: { partial: true, items: [{ label: 'Videos', gb: 50 }] }, gpuLive: { tempC: 50, loadPct: 3 }, unreadable: ['CPU temperature'] },
      trends: [{ text: 'Disk free fell 9.6 GB over this week' }],
    }));
    const r = await ctx.assemble({ dataDir: w.dataDir, vaultDir: w.vaultDir, include: { health: true }, now: NOW });
    const text = typeof r === 'string' ? r : r.text;
    assert.match(text, /Graphics: 8 GB VRAM/);
    assert.doesNotMatch(text, /VRAM figure omitted/);
    assert.match(text, /Using the most memory: app-a 3\.0 GB/);
    assert.match(text, /Biggest folders: Videos 50 GB \(partial list\)/);
    assert.match(text, /GPU now: 50 °C, 3% load/);
    assert.match(text, /Not measurable without admin: CPU temperature/);
    assert.match(text, /Trend: Disk free fell 9\.6 GB/);
  } finally { w.cleanup(); }
});

test('health: an old sidecar (no detail) still omits the capped VRAM figure', async () => {
  const w = workspace();
  try {
    fs.writeFileSync(path.join(w.dataDir, 'pc-health.json'), JSON.stringify({ scanned_at: '2026-10-05T10:00:00', organs: [{ id: 'gpu', label: 'Graphics', value: 4, unit: 'GB VRAM', status: 'grace' }] }));
    const r = await ctx.assemble({ dataDir: w.dataDir, vaultDir: w.vaultDir, include: { health: true }, now: NOW });
    const text = typeof r === 'string' ? r : r.text;
    assert.match(text, /VRAM figure omitted/);
    assert.doesNotMatch(text, /4 GB VRAM/);
  } finally { w.cleanup(); }
});

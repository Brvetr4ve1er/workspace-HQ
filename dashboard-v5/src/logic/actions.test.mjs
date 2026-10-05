// Actions & safety (Phase 2 · P-A): the run confirm (Enter, hash), the scan state,
// the commit dialog (.env refusal, busy guard, honest toasts), dev stop, Ask
// (streaming, re-probe) and Claude (project required, the session's own project).
//
// Built like src/vals.golden.test.mjs: a store over synthetic DATA, a Component
// that is never mounted (setState is synchronous then), and a FAKE window.hq that
// records every call. Toasts are recorded instead of shown.
//
//   node --test dashboard-v5/src/logic/actions.test.mjs
// Synthetic fixtures only — the real scans are personal and the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import * as A from '../live/adapter.mjs';
import { proj, scan, spell, spellbook, telemetry } from '../live/__fixtures__/synthetic.mjs';

process.env.TZ = 'UTC';   // "HH:MM" labels below are UTC

// ---- browser globals the Component touches (same approach as vals.golden.test.mjs) ----
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
define('window', { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery, addEventListener() {}, removeEventListener() {} });
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {}, activeElement: null });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

const tick = () => new Promise((res) => setImmediate(res));

const DATA = () => ({
  scans: [scan('2026-10-05', [proj('a', { dirty: 3 }), proj('b', { dirty: 0 }), proj('n', { git: false })])],
  spellbook: spellbook([
    spell('grimoire:scan', { name: 'Deep scan', source: 'grimoire' }),
    spell('script:backup', { name: 'Backup notes', source: 'script' }),
    spell('grimoire:morning', { name: 'Morning routine', source: 'grimoire', kind: 'chain', chain: ['grimoire:scan', 'script:backup'] }),
  ]),
  telemetry: telemetry([]),
});

const CLEAN_PREVIEW = () => ({ files: [{ path: 'src/a.js', status: 'M', env: false }, { path: 'notes/new.md', status: '??', env: false }], stat: ' src/a.js | 2 +-', envHits: [], branch: 'main' });
const ENV_PREVIEW = () => ({
  files: [{ path: 'src/a.js', status: 'M', env: false }, { path: 'sub/.env', status: '??', env: true }, { path: '.env.example', status: '??', env: false }],
  stat: ' src/a.js | 2 +-', envHits: ['sub/.env'], branch: 'main',
});

// A recording fake of window.hq; `over` replaces a method's answer
function fakeHq(over = {}) {
  const calls = [];
  const rec = (name, dflt) => (...args) => { calls.push([name, ...args]); return (over[name] || dflt || (() => true))(...args); };
  const hq = {
    castSpell: rec('castSpell', () => ({ castId: 'c-1' })), cancelCast: rec('cancelCast'),
    runScan: rec('runScan'), devStop: rec('devStop'),
    commitPreview: rec('commitPreview', CLEAN_PREVIEW), draftCommit: rec('draftCommit', () => ({ message: 'chore: placeholder change', via: 'local:fake' })), doCommit: rec('doCommit', () => ({ ok: true })),
    claudeQuest: rec('claudeQuest'), sessionStart: rec('sessionStart', () => ({ jobId: 'j-new' })),
    probeLlm: rec('probeLlm', () => ({ available: true, chatModel: 'fake-model' })),
    llm: { chat: rec('llm.chat', () => ({ status: 'done', output: '  An answer.  ', sections: [], model: 'fake-model', ms: 300 })), warm: rec('llm.warm') },
  };
  return { hq, calls, called: (n) => calls.filter((c) => c[0] === n).map((c) => c.slice(1)) };
}

function make(over) {
  localStorage.clear(); sessionStorage.clear();
  const f = fakeHq(over);
  const store = createStore(DATA(), f.hq);
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  const toasts = [];
  c.toast = (kind, text, o) => { toasts.push(Object.assign({ kind, text }, o || {})); return 'k' + toasts.length; };
  return { c, store, f, toasts, last: () => toasts[toasts.length - 1] || {} };
}
const keyEvent = (target) => { const e = { key: 'Enter', target, prevented: 0 }; e.preventDefault = () => { e.prevented++; }; return e; };

// ---- C-1 run confirm ----------------------------------------------------------------
test('confirmKey: Enter on a focused button (or inside one) does nothing — the button decides', async () => {
  const { c, f } = make();
  c.askRun(c.auto('grimoire:scan'));
  assert.equal(c.state.confirm, 'grimoire:scan');
  const btn = { tagName: 'BUTTON', closest: () => btn };
  const inner = { tagName: 'SPAN', closest: (sel) => (sel === 'button' ? btn : null) };
  for (const target of [btn, inner]) {
    const e = keyEvent(target);
    assert.equal(c.confirmKey(e), false);
    assert.equal(e.prevented, 0, 'no preventDefault: the button’s own click must still happen');
  }
  await tick();
  assert.equal(c.state.confirm, 'grimoire:scan', 'the dialog stays open');
  assert.deepEqual(f.called('castSpell'), []);
});

test('confirmKey: Enter elsewhere confirms the run with data.js’s hash', async () => {
  const { c, f } = make();
  c.askRun(c.auto('grimoire:scan'));
  const e = keyEvent({ tagName: 'DIV', closest: () => null });
  assert.equal(c.confirmKey(e), true);
  assert.equal(e.prevented, 1);
  await tick();
  assert.equal(c.state.confirm, null);
  assert.deepEqual(f.called('castSpell'), [['grimoire:scan', 'h-grimoire:scan']]);
});

test('confirmKey: a held Enter (auto-repeat) never confirms — not even the dialog main reopened', async () => {
  let n = 0;
  const { c, f } = make({ castSpell: () => (n++ === 0 ? { confirm_required: true, preview: { content_hash: 'h-changed' } } : { castId: 'c-2' }) });
  c.askRun(c.auto('grimoire:scan'));
  const div = { tagName: 'DIV', closest: () => null };
  const held = Object.assign(keyEvent(div), { repeat: true });
  assert.equal(c.confirmKey(held), true, 'handled (swallowed)');
  assert.equal(held.prevented, 1);
  await tick();
  assert.deepEqual(f.called('castSpell'), [], 'a repeat on the first dialog runs nothing');
  assert.equal(c.state.confirm, 'grimoire:scan');
  assert.equal(c.confirmKey(keyEvent(div)), true);   // a real press confirms
  await tick();
  assert.equal(c.state.confirm, 'grimoire:scan', 'main said the command changed: the dialog is back');
  const again = Object.assign(keyEvent(div), { repeat: true });
  c.confirmKey(again);
  await tick();
  assert.equal(f.called('castSpell').length, 1, 'the key still held from the last press does not confirm the changed command');
  const onBtn = Object.assign(keyEvent({ tagName: 'BUTTON', closest: () => null }), { repeat: true });
  assert.equal(c.confirmKey(onBtn), true);
  assert.equal(onBtn.prevented, 1, 'a held Enter on a button does not keep clicking it either');
  c.confirmKey(keyEvent(div));
  await tick();
  assert.deepEqual(f.called('castSpell'), [['grimoire:scan', 'h-grimoire:scan'], ['grimoire:scan', 'h-changed']]);
});

test('confirm: the hash (and command) from main’s confirm_required answer is what the next confirm sends', async () => {
  let n = 0;
  const { c, f, last } = make({ castSpell: () => (n++ === 0 ? { confirm_required: true, preview: { content_hash: 'h-changed', command: 'node', args: ['scan.mjs', '--deep'], cwd: 'C:/dev/a' } } : { castId: 'c-2' }) });
  c.askRun(c.auto('grimoire:scan'));
  await c.confirmRun();
  assert.equal(c.state.confirm, 'grimoire:scan', 'main asked again: the dialog is back');
  assert.equal(c.state.confirmHash, 'h-changed');
  assert.match(last().text, /changed since you last ran it/);
  const v = c.renderVals();
  assert.equal(v.confirm.cmd, 'node scan.mjs --deep', 'the dialog shows the command main will run, not data.js’s copy');
  assert.equal(v.confirm.dir, 'C:/dev/a');
  await c.confirmRun();
  assert.deepEqual(f.called('castSpell'), [['grimoire:scan', 'h-grimoire:scan'], ['grimoire:scan', 'h-changed']]);
  assert.equal(c.state.confirmHash, null);
  // a fresh dialog never inherits an earlier answer
  c.setState({ confirmHash: 'stale', confirmPreview: { id: 'grimoire:scan', cmd: 'stale', dir: '' } });
  c.askRun(c.auto('script:backup'));
  assert.equal(c.state.confirmHash, null);
  assert.equal(c.state.confirmPreview, null);
});

// ---- C-2 scan state ----------------------------------------------------------------
test('scanStatus: labels from LIVE.scan', () => {
  const { c, store } = make();
  assert.deepEqual([c.scanStatus().running, c.scanStatus().label], [false, '']);
  store.live.scan = { state: 'running', startedAt: '2026-10-05T14:02:00Z' };
  assert.equal(c.scanStatus().running, true);
  assert.equal(c.scanStatus().label, 'Scanning since 14:02');
  store.live.scan = { state: 'failed', startedAt: '2026-10-05T14:02:00Z', endedAt: '2026-10-05T14:05:00Z', code: 1 };
  assert.deepEqual([c.scanStatus().failed, c.scanStatus().code, c.scanStatus().label], [true, 1, 'Last scan failed (exit 1)']);
  store.live.scan = { state: 'done', startedAt: '2026-10-05T14:02:00Z', endedAt: '2026-10-05T14:09:00Z', code: 0 };
  assert.deepEqual([c.scanStatus().done, c.scanStatus().label], [true, '']);
});

test('scanNow refuses while a scan is running', async () => {
  const { c, f, store, last } = make();
  store.live.scan = { state: 'running', startedAt: '2026-10-05T14:02:00Z' };
  await c.scanNow();
  assert.deepEqual(f.called('runScan'), []);
  assert.equal(last().text, 'A scan is already running');
});

test('scanNow starts a scan without a local Activity row; the row comes from LIVE.scan', async () => {
  const { c, f, store, toasts } = make();
  store.live.scan = { state: 'idle', startedAt: null, endedAt: null, code: null };
  await c.scanNow();
  assert.equal(f.called('runScan').length, 1);
  assert.deepEqual(c.state.localRuns, []);
  assert.ok(toasts.some((t) => t.kind === 'progress' && t.scan));
  assert.equal(c.renderVals().runs.filter((r) => r.name === 'Full scan').length, 0, 'idle: no scan row');
  store.live.scan = { state: 'failed', startedAt: '2026-10-05T14:02:00Z', endedAt: '2026-10-05T14:05:00Z', code: 1, error: 'collector exited 1' };
  const row = c.renderVals().runs.find((r) => r.name === 'Full scan');
  assert.equal(row.status, 'Failed');
  assert.equal(row.started, '14:02');
  assert.match(row.meta, /exit 1 at 14:05/);
  assert.equal(row.out, 'collector exited 1');
});

test('a scan this window watched: its end replaces the progress toast; a failure from before the load does not toast', () => {
  const { c, store, toasts } = make();
  store.live.scan = { state: 'failed', code: 2, startedAt: '2026-10-05T09:00:00Z', endedAt: '2026-10-05T09:01:00Z' };
  c.announceRuns();
  assert.equal(toasts.length, 0, 'hydrated failure: shown in Activity, not toasted again');
  c.setState({ toasts: [{ id: 'k9', kind: 'progress', text: 'Scanning…', scan: true }] });
  store.live.scan = { state: 'running', startedAt: '2026-10-05T14:02:00Z' };
  c.announceRuns();
  store.live.scan = { state: 'failed', startedAt: '2026-10-05T14:02:00Z', endedAt: '2026-10-05T14:05:00Z', code: 1 };
  c.announceRuns();
  assert.deepEqual(c.state.toasts, [], 'the progress toast is gone');
  assert.equal(toasts.at(-1).kind, 'error');
  assert.equal(toasts.at(-1).text, 'Last scan failed (exit 1) · see workspace hq/logs');
});

test('Activity: dev rows say since when; chain members are labelled as part of the chain', () => {
  const { c, store } = make();
  store.live.dev = { a: { since: Date.parse('2026-10-05T09:30:00Z') } };
  const t = Date.parse('2026-10-05T10:00:00Z');
  store.live.casts = {
    ch: { castId: 'ch', spellId: 'grimoire:morning', name: 'Morning routine', out: [], status: 'running', t0: t },
    m2: { castId: 'm2', spellId: 'script:backup', name: 'Backup notes', out: [], status: 'running', t0: t + 2000 },
    m1: { castId: 'm1', spellId: 'grimoire:scan', name: 'Deep scan', out: [], status: 'ok', t0: t + 1000, done: true, meta: '1s' },
  };
  const runs = c.renderVals().runs;
  const dev = runs.find((r) => r.name === 'Dev server · Project A');
  assert.equal(dev.started, 'running since 09:30');
  const names = runs.map((r) => r.name);
  const i = names.indexOf('Morning routine');
  assert.deepEqual(names.slice(i, i + 3), ['Morning routine', '↳ Deep scan', '↳ Backup notes']);
  assert.equal(runs[i + 1].meta, '1s · part of Morning routine · step 1 of 2');
  assert.equal(runs[i + 2].meta, 'running · part of Morning routine · step 2 of 2');
});

test('stopDev awaits main and says what happened', async () => {
  let answer = false;
  const { c, f, last } = make({ devStop: () => answer });
  await c.stopDev('a');
  assert.deepEqual(f.called('devStop'), [['a']]);
  assert.equal(last().text, 'That dev server wasn’t running');
  answer = true;
  await c.stopDev('a');
  assert.equal(last().text, 'Dev server stopped · Project A');
});

// ---- C1 commit ------------------------------------------------------------------------
test('commit: the preview comes from hq.commitPreview; an .env hit blocks the commit and is named', async () => {
  const { c, f, last } = make({ commitPreview: ENV_PREVIEW });
  await c.openCommit('a');
  assert.deepEqual(f.called('commitPreview'), [['C:/dev/a']]);
  assert.deepEqual(c.state.commit.envHits, ['sub/.env']);
  assert.deepEqual(f.called('draftCommit'), [], 'no draft (it may use Claude quota) for a commit that can’t happen');
  c.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: 'feat: placeholder' }) }));
  const v = c.renderVals().commit;
  assert.equal(v.none, true, 'Commit disabled');
  assert.equal(v.hasAlert, true);
  assert.match(v.alert, /A \.env file is in this change set — add it to \.gitignore before committing/);
  assert.match(v.alert, /sub\/\.env/);
  assert.deepEqual(v.files.map((x) => x.warn), [false, true, false], 'main’s env flag only: .env.example is not a hit');
  await c.doCommit();
  assert.deepEqual(f.called('doCommit'), []);
  assert.equal(last().kind, 'error');
});

test('commit: disabled while loading, busy, empty or without a message; a preview error shows in the dialog', async () => {
  const { c, f } = make({ commitPreview: () => ({ error: 'project folder not found' }) });
  const p = c.openCommit('a');
  assert.equal(c.renderVals().commit.none, true, 'loading');
  assert.equal(c.renderVals().commit.okLabel, 'Reading…');
  await p;
  const v = c.renderVals().commit;
  assert.equal(v.none, true);
  assert.match(v.alert, /project folder not found/);
  c.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: 'x' }) }));
  await c.doCommit();
  assert.deepEqual(f.called('doCommit'), []);

  const ok = make();
  await ok.c.openCommit('b');   // not dirty in the scan: the preview decides, and it lists two files
  assert.equal(ok.c.state.commit.files.length, 2);
  assert.equal(ok.c.renderVals().commit.none, false, 'files + drafted message → enabled');
  ok.c.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: '   ' }) }));
  assert.equal(ok.c.renderVals().commit.none, true, 'no message');
  const empty = make({ commitPreview: () => ({ files: [], stat: '', envHits: [], branch: 'main' }) });
  await empty.c.openCommit('a');
  assert.equal(empty.c.renderVals().commit.none, true, 'nothing to commit');
});

test('commit: status badges tolerate unknown status strings', async () => {
  const { c } = make({ commitPreview: () => ({ files: ['M', '??', 'AM', 'D', 'UU', 'staged', 'X'].map((status, i) => ({ path: 'f' + i, status, env: false })), stat: '', envHits: [], branch: 'main' }) });
  await c.openCommit('a');
  assert.deepEqual(c.renderVals().commit.files.map((x) => x.st), ['M', 'A', 'A', 'D', 'U', 'S', 'X']);
});

test('doCommit: one commit at a time; success counts the preview’s files', async () => {
  let release;
  const { c, f, last } = make({ doCommit: () => new Promise((res) => { release = res; }) });
  await c.openCommit('a');
  assert.equal(c.state.commit.msg, 'chore: placeholder change');
  const first = c.doCommit(), second = c.doCommit();
  assert.equal(c.state.commit.busy, true);
  assert.equal(c.renderVals().commit.none, true);
  assert.equal(c.renderVals().commit.okLabel, 'Committing…');
  release({ ok: true });
  await Promise.all([first, second]);
  assert.deepEqual(f.called('doCommit'), [['C:/dev/a', 'chore: placeholder change']]);
  assert.equal(last().kind, 'success');
  assert.equal(last().text, 'Committed 2 files to main · Project A · re-scanning');
  assert.equal(c.state.commit, null);
  assert.equal(c.state.committed.a, true);
});

test('doCommit: a refused path, an .env refusal and a git error each say so', async () => {
  const no = make({ doCommit: () => false });
  await no.c.openCommit('a'); await no.c.doCommit();
  assert.deepEqual([no.last().kind, no.last().text], ['error', 'Couldn’t commit — the project path wasn’t accepted']);
  assert.equal(no.c.state.commit.busy, false, 'the dialog stays, usable');

  const env = make({ doCommit: () => ({ error: 'refused: .env in change set', envHits: ['late/.env'] }) });
  await env.c.openCommit('a'); await env.c.doCommit();
  assert.equal(env.last().kind, 'error');
  assert.match(env.last().text, /late\/\.env/);
  assert.equal(env.c.renderVals().commit.none, true, 'now blocked');

  const git = make({ doCommit: () => ({ error: 'nothing added to commit' }) });
  await git.c.openCommit('a'); await git.c.doCommit();
  assert.deepEqual([git.last().kind, git.last().text], ['error', 'Couldn’t commit · nothing added to commit']);

  // the guard fails closed with envHits ['<git error>']: that is a git failure, not an .env file
  const closed = make({ doCommit: () => ({ error: 'refused: .env in change set', envHits: ['<git error>'] }) });
  await closed.c.openCommit('a'); await closed.c.doCommit();
  assert.deepEqual([closed.last().kind, closed.last().text], ['error', 'Couldn’t commit · git couldn’t list the change set (nothing was staged)']);
  const v = closed.c.renderVals().commit;
  assert.equal(v.none, true);
  assert.doesNotMatch(v.alert, /\.env/, 'no claim that an .env file is in the set');
});

// ---- C3 Ask ----------------------------------------------------------------------------
test('Ask: deltas are start-trimmed like the final answer; stream is on only while it arrives', () => {
  const { c } = make();
  c.setState({ askHistory: [{ q: 'q', id: 'a1', a: { text: '', src: [], est: false, status: 'thinking' } }] });
  assert.equal(c.renderVals().asks[0].stream, true);
  c.onAskDelta({ jobId: 'a1', text: '\n\n  The answer so' });
  assert.equal(c.state.askHistory[0].a.text, 'The answer so');
  c.patchAsk('a1', { text: 'The answer so far.', status: 'done' });
  assert.equal(c.renderVals().asks[0].stream, false);
});

test('Ask: a model that looked down is probed again before refusing', async () => {
  const up = make();
  up.store.live.llm = { available: false };
  const p = up.c.submitAsk('what changed?');
  assert.equal(up.c.state.askHistory.at(-1).a.status, 'thinking', 'the question shows at once');
  await p;
  assert.deepEqual(up.f.called('probeLlm'), [[{ force: true }]]);
  assert.equal(up.f.called('llm.chat').length, 1);
  assert.equal(up.c.state.askHistory.at(-1).a.text, 'An answer.');

  const down = make({ probeLlm: () => ({ available: true, chatModel: null }) });
  down.store.live.llm = { available: false };
  await down.c.submitAsk('what changed?');
  assert.equal(down.f.called('probeLlm').length, 1);
  assert.deepEqual(down.f.called('llm.chat'), []);
  const a = down.c.state.askHistory.at(-1).a;
  assert.equal(a.refusal, true);
  assert.equal(a.text, 'No local chat model is installed. Pull one with Ollama, then retry.');
});

// ---- C4 Claude -------------------------------------------------------------------------
test('sendClaude without a project clears the composer’s project and keeps Run disabled', () => {
  const { c, last } = make();
  assert.equal(c.state.composerProj, 'a');
  c.sendClaude('Tidy the workspace root', undefined);
  assert.equal(c.state.composerProj, null);
  assert.equal(c.state.composer, 'Tidy the workspace root');
  assert.equal(last().text, 'Pick a project for this task first');
  assert.equal(c.renderVals().cantStartSession, true);
  c.sendClaude('Add tests', 'b');
  assert.equal(c.state.composerProj, 'b');
  assert.equal(c.renderVals().cantStartSession, false);
});

test('Open in terminal uses the selected session’s project, not the composer’s', async () => {
  const { c, f, store, last } = make();
  store.live.sessions = A.sessions([
    { jobId: 'j1', label: 'Fix the build', cwd: 'C:/dev/b/src', status: 'running', startedAt: '2026-10-05T09:40:00Z' },
    { jobId: 'j2', label: 'Somewhere else', cwd: 'C:/elsewhere', status: 'running', startedAt: '2026-10-05T09:00:00Z' },
  ], store.model.at(0).P0);
  c.setState({ composerProj: 'a', sessionSel: 'j1' });
  assert.equal(c.renderVals().sessionDetail.proj, 'Project B');
  await c.renderVals().sessionDetail.term();
  assert.deepEqual(f.called('claudeQuest'), [['C:/dev/b', 'Fix the build']]);
  assert.match(last().text, /Project B/);

  c.setState({ sessionSel: 'j2' });
  assert.equal(c.renderVals().sessionDetail.proj, 'No project folder');
  await c.renderVals().sessionDetail.term();
  assert.equal(f.called('claudeQuest').length, 1, 'no project → nothing opened');
  assert.deepEqual([last().kind, last().text], ['error', 'This session has no project folder']);
});

test('Open in terminal: main refusing the folder is an error toast', async () => {
  const { c, store, last } = make({ claudeQuest: () => false });
  store.live.sessions = A.sessions([{ jobId: 'j1', label: 'Fix the build', cwd: 'C:/dev/a', status: 'done', exitCode: 0 }], store.model.at(0).P0);
  await c.sessionTerminal('j1');
  assert.equal(last().kind, 'error');
  assert.match(last().text, /Couldn’t open a terminal/);
});

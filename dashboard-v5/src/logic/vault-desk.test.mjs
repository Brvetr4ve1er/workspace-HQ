// Life > Notes > Vault desk, renderer side: the pure view logic (clean, words, line info), the mixin (read on arrival only, one read at a time,
// capture and its marks) and the vals (ONE top-level key, every state, a static check that every key the template reads exists).
// Rig in the crew.test.mjs style. Placeholder data only (the repo is public).
//   node --test dashboard-v5/src/logic/vault-desk.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { vdkClean, vdkWhere, vdkStateWords, vdkLineInfo, VDK_OFF, VDK_LINE_MAX } from './vault-desk-view.mjs';
import { vaultDeskLogic, VDK_SURFACE, VDK_CAPTURE_SURFACE } from './vault-desk.js';
import { useLogLogic } from './use-log.js';
import { vaultDeskVals } from '../vals/vault-desk.js';
import tpl from '../tpl/vault-desk.tpl.js';

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const ANSWER = (o = {}) => ({ state: 'ready', vaultName: 'Example Vault', canOpen: true, folder: '10_Daily', folderFromSettings: false, settingsIgnored: false,
  noteName: '2026-11-16', date: '2026-11-16', text: '# Monday\n\n- a line\n', truncated: false, recent: [{ name: '2026-11-16' }, { name: 'Placeholder note' }], ...o });

function rig(o = {}) {
  const calls = [], toasts = [], marks = [], opened = [];
  const desk = o.noMethod ? {} : {
    read: async () => { calls.push('read'); await (o.gate || Promise.resolve()); if (o.reject) throw new Error('boom'); return o.answer || ANSWER(); },
    capture: async (t) => { calls.push('capture:' + t); await (o.capGate || Promise.resolve()); return o.capAnswer || { ok: true }; },
  };
  const self = Object.assign(Object.create(vaultDeskLogic), useLogLogic, {
    state: { tab: 'life', sub: { life: 'notes' }, route: null, vdk: o.vdk || {}, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    ps: () => (o.noBridge ? 'nobridge' : 'live'),
    toast: (k, t) => toasts.push([k, t]),
    lifeVaultOpen: (n, how) => { opened.push([n, how]); },
    hq: o.noBridge ? null : { vaultDesk: desk, use: (s, a) => { marks.push(s + '/' + a); } },
  });
  const vals = () => vaultDeskVals.call(self, { S: self.state }).vdkv;
  return { self, calls, toasts, marks, opened, vals };
}

test('clean: a known state, bounded strings, at most twelve recent names, line breaks kept in the note', () => {
  assert.equal(vdkClean(null), null);
  assert.equal(vdkClean({ state: 'weird' }).state, 'no-folder');
  const c = vdkClean(ANSWER({ text: 'a\r\nb\u0000c', recent: Array.from({ length: 20 }, (_, i) => ({ name: 'n' + i })).concat([{ name: 5 }, null]), vaultName: 'x'.repeat(300) }));
  assert.equal(c.text, 'a\nbc');
  assert.equal(c.recent.length, 12);
  assert.equal(c.vaultName.length, 100);
  assert.equal(vdkClean(ANSWER({ canOpen: 'yes' })).canOpen, false, 'only a real true opens');
});

test('words: where it looked, from settings or the app\'s own name, and what each missing state means', () => {
  assert.match(vdkWhere(vdkClean(ANSWER())), /“10_Daily”.*app’s own daily folder name/);
  assert.match(vdkWhere(vdkClean(ANSWER({ folderFromSettings: true, folder: 'Journal' }))), /“Journal”.*daily notes settings/);
  assert.match(vdkWhere(vdkClean(ANSWER({ settingsIgnored: true }))), /not safe to use/);
  assert.match(vdkWhere(vdkClean(ANSWER({ folder: '' }))), /top of the vault/);
  assert.match(vdkStateWords(vdkClean(ANSWER({ state: 'no-folder' }))), /never makes folders/);
  assert.match(vdkStateWords(vdkClean(ANSWER({ state: 'no-note' }))), /never makes notes/);
  assert.equal(vdkStateWords(vdkClean(ANSWER())), '');
  assert.deepEqual(vdkLineInfo('  '), { n: 0, empty: true, long: false });
  assert.equal(vdkLineInfo('x'.repeat(VDK_LINE_MAX + 1)).long, true);
  assert.equal(vdkLineInfo(7).empty, true);
});

test('mixin: nothing is read until the owner is on Life > Notes; one read on arrival, one open mark', async () => {
  const off = rig({ state: { tab: 'home', sub: { life: 'notes' } } });
  assert.equal(await off.self.vdkArrive(), null);
  assert.deepEqual(off.calls, []);
  const other = rig({ state: { tab: 'life', sub: { life: 'screen' } } });
  assert.equal(await other.self.vdkArrive(), null);
  assert.deepEqual(other.calls, []);
  const r = rig();
  await r.self.vdkArrive();
  assert.deepEqual(r.calls, ['read']);
  assert.deepEqual(r.marks, [VDK_SURFACE + '/open']);
  assert.equal(r.self.state.vdk.data.noteName, '2026-11-16');
});

test('mixin: one read at a time; an error keeps what is shown; no bridge reads nothing', async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const r = rig({ gate });
  const first = r.self.vdkRead();
  assert.equal(await r.self.vdkRead(), null, 'a second read while one runs is dropped');
  release();
  await first;
  assert.deepEqual(r.calls, ['read']);
  r.self.hq.vaultDesk.read = async () => ({ error: 'vault not found' });
  await r.self.vdkRead();
  assert.equal(r.self.state.vdk.error, 'vault not found');
  assert.ok(r.self.state.vdk.data, 'the last answer stays');
  assert.equal(r.vals().error, true);
  assert.equal(r.vals().ready, true);
  const nb = rig({ noBridge: true });
  assert.deepEqual(await nb.self.vdkRead(), { error: VDK_OFF });
  const nm = rig({ noMethod: true });
  assert.deepEqual(await nm.self.vdkRead(), { error: VDK_OFF });
  const bad = rig({ reject: true });
  assert.match((await bad.self.vdkRead()).error, /could not be read/);
});

test('capture: sends the line only, marks ONE act on success, clears the draft, reads again', async () => {
  const r = rig();
  await r.self.vdkRead();
  r.self.vdkDraft({ target: { value: 'buy bread' } });
  assert.equal(r.vals().canSend, true);
  assert.equal(await r.self.vdkCapture(), true);
  assert.deepEqual(r.calls, ['read', 'capture:buy bread', 'read']);
  assert.deepEqual(r.marks, [VDK_CAPTURE_SURFACE + '/act']);
  assert.equal(r.self.state.vdk.draft, '');
  assert.deepEqual(r.toasts.at(-1), ['success', 'Added to today’s note']);
});

test('capture: a refusal toasts main\'s words, keeps the line, and marks nothing; an empty or long line never reaches main', async () => {
  const r = rig({ capAnswer: { error: 'the daily note is not a plain file' } });
  await r.self.vdkRead();
  assert.equal(await r.self.vdkCapture('keep me'), false);
  assert.match(r.toasts.at(-1)[1], /not a plain file/);
  assert.equal(r.self.state.vdk.draft, 'keep me');
  assert.deepEqual(r.marks.filter((m) => m.includes('capture')), []);
  const before = r.calls.length;
  assert.equal(await r.self.vdkCapture('   '), false);
  assert.equal(await r.self.vdkCapture('x'.repeat(VDK_LINE_MAX + 1)), false);
  assert.equal(r.calls.length, before);
  const odd = rig({ capAnswer: { ok: 'yes' } });
  await odd.self.vdkRead();
  assert.equal(await odd.self.vdkCapture('x'), false);
  assert.deepEqual(odd.marks.filter((m) => m.includes('capture')), []);
});

test('capture: a double Enter is one call; Enter sends the box\'s own text, Shift+Enter does not', async () => {
  let release;
  const r = rig({ capGate: new Promise((res) => { release = res; }) });
  await r.self.vdkRead();
  const ev = (o) => ({ key: 'Enter', shiftKey: false, isComposing: false, preventDefault() {}, target: { value: 'one line' }, ...o });
  r.self.vdkKey(ev({ shiftKey: true }));
  assert.equal(r.calls.filter((c) => c.startsWith('capture')).length, 0);
  r.self.vdkKey(ev());
  r.self.vdkKey(ev());
  await new Promise((res) => setTimeout(res, 5));
  assert.equal(r.calls.filter((c) => c.startsWith('capture')).length, 1);
  assert.equal(r.vals().sending, true);
  assert.equal(r.vals().canSend, false);
  release();
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(r.vals().sending, false);
  assert.equal(r.marks.filter((m) => m === VDK_CAPTURE_SURFACE + '/act').length, 1);
});

test('open: goes through the existing Open in Obsidian by the vault name, and only when main said it can', async () => {
  const r = rig();
  await r.self.vdkRead();
  r.self.vdkOpen();
  assert.deepEqual(r.opened, [['Example Vault', 'open']]);
  const no = rig({ answer: ANSWER({ canOpen: false }) });
  await no.self.vdkRead();
  assert.equal(no.self.vdkOpen(), null);
  assert.deepEqual(no.opened, []);
  assert.equal(no.vals().canOpen, false);
});

test('vals: ONE top-level key in every state, the same key set everywhere, and a frozen constant off Life > Notes', async () => {
  const keys = (v) => Object.keys(v).sort().join();
  const off = vaultDeskVals.call(rig({ state: { tab: 'home' } }).self, { S: { tab: 'home' } });
  assert.deepEqual(Object.keys(off), ['vdkv']);
  assert.equal(off.vdkv.on, false);
  const base = keys(off.vdkv);
  const states = [
    rig({ noBridge: true }).vals(),
    rig().vals(),   // loading
    (() => { const r = rig({ vdk: { error: 'vault not found', loaded: true } }); return r.vals(); })(),
  ];
  for (const k of ['no-folder', 'no-note', 'ready']) { const r = rig({ answer: ANSWER({ state: k }) }); await r.self.vdkRead(); states.push(r.vals()); }
  for (const v of states) { assert.equal(keys(v), base); assert.equal(v.on, true); }
  assert.equal(states[0].offline, true);
  assert.equal(states[1].loading, true);
  assert.equal(states[2].error, true);
  assert.equal(states[3].canType, false, 'no folder: nothing to type into');
  assert.equal(states[4].canType, false, 'no note: nothing to type into');
  assert.equal(states[4].hasNote, false);
  assert.equal(states[5].canType, true);
  assert.equal(states[5].hasNote, true);
  assert.equal(states[5].recent.length, 2);
});

test('template: every vdkv key the fragment reads exists in the vals, and the note is text, never markup', async () => {
  const r = rig();
  await r.self.vdkRead();
  const v = r.vals();
  for (const m of tpl.matchAll(/\{\{\s*!?vdkv\.([A-Za-z0-9_]+)\s*\}\}/g)) assert.ok(m[1] in v, 'vdkv.' + m[1] + ' is in the vals');
  for (const m of tpl.matchAll(/\{\{\s*n\.([A-Za-z0-9_]+)\s*\}\}/g)) assert.ok(m[1] in v.recent[0], 'n.' + m[1] + ' is a recent key');
  assert.ok(!/innerHTML|v-html|dangerously/i.test(tpl));
  assert.ok(!/\{\{\s*vdkv\.noteText\s*\}\}[^<]*style=/.test(tpl));
  assert.ok(tpl.includes('data-vdk="line"') && tpl.includes('data-vdk="note"') && tpl.includes('data-vdk="send"'));
});

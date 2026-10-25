// Save to vault in v5 (Claude Hub H5, spec 2026-10-13 §9 Vault). A store over synthetic DATA, a Component that is
// never mounted (setState is synchronous then), and a FAKE window.hq whose claudeVault answers only when the test
// says so. Synthetic fixtures only.
//   node --test dashboard-v5/src/logic/claude-vault.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { basisNote } from '../vals/claude-vault.js';
import extrasTpl from '../tpl/extras.tpl.js';
import { proj, scan, spellbook, telemetry } from '../live/__fixtures__/synthetic.mjs';

process.env.TZ = 'UTC';

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
// two scans (newest first): the "past snapshot" test sets snapOffset 1, which needs an older scan to exist
// (writeReason formats that scan's day — library.test.mjs uses the same twoScans shape)
const DATA = () => ({ scans: [scan('2026-10-05', [proj('a'), proj('b')]), scan('2026-10-04', [proj('a'), proj('b')])], spellbook: spellbook([]), telemetry: telemetry([]) });
const DRAFT = { path: 'C:\\placeholder-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Release planning.md', rel: '30_Areas/Claude/project-a/2026-10-01 Release planning.md', markdown: '---\nconversation: "code:s-1"\n---\n# Release planning\n', exists: false, model: 'placeholder-model', basis: 12 };

// claudeVault.preview/save stay pending until answerPreview(r) / answerSave(r)
function make({ withVault = true, thread = true } = {}) {
  localStorage.clear(); sessionStorage.clear();
  const calls = [];
  let pv = null, sv = null;
  const hq = { probeLlm: () => ({ available: true }) };
  if (withVault) hq.claudeVault = {
    preview: (id) => { calls.push(['preview', id]); return new Promise((r) => { pv = r; }); },
    save: (req) => { calls.push(['save', req]); return new Promise((r) => { sv = r; }); },
  };
  const store = createStore(DATA(), hq);
  if (thread) store.live.claudeLib = { thread: { conversation: { id: 'code:s-1', title: 'Release planning' }, messages: [], hasMore: false } };
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  const toasts = [], said = [];
  c.toast = (kind, text) => { toasts.push({ kind, text }); return 'k'; };
  c.notWired = (what) => { said.push(['notWired', what]); };
  c.denied = (why) => { said.push(['denied', why]); };
  return { c, store, calls, toasts, said, answerPreview: async (r) => { pv(r); await tick(); }, answerSave: async (r) => { sv(r); await tick(); } };
}
const saves = (calls) => calls.filter((x) => x[0] === 'save').map((x) => x[1]);

test('the thread view’s button: on for an open chat, it asks for a draft; nothing is written by opening (spec §9)', async () => {
  const t = make();
  const v = t.c.renderVals();
  assert.equal(v.clVaultOff, false);
  assert.match(v.clVaultTip, /nothing is written until you press Save/);
  v.clVault();
  assert.deepEqual(t.calls, [['preview', 'code:s-1']]);
  assert.equal(t.c.renderVals().vaultDrafting, true);
  await t.answerPreview(DRAFT);
  const r = t.c.renderVals();
  assert.equal(r.vaultReady, true);
  assert.equal(r.vaultRel, DRAFT.rel);
  assert.equal(r.vaultDraft, DRAFT.markdown);
  assert.equal(r.vaultBasis, basisNote('placeholder-model', 12));
  assert.deepEqual(saves(t.calls), [], 'a preview never saves');
  assert.equal(make({ thread: false }).c.renderVals().clVaultOff, true);
});

test('Save sends the owner’s edited text, without replace; a saved note toasts its path', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview(DRAFT);
  t.c.renderVals().onVaultEdit({ target: { value: DRAFT.markdown + 'my edit\n' } });
  t.c.renderVals().vaultSave();
  assert.deepEqual(saves(t.calls), [{ path: DRAFT.path, markdown: DRAFT.markdown + 'my edit\n' }]);
  assert.equal(t.c.renderVals().vaultSaving, true);
  assert.equal(t.c.renderVals().vaultSaveOff, true, 'no second save while one runs');
  await t.answerSave(true);
  assert.equal(t.c.renderVals().vaultSaved, true);
  assert.deepEqual(t.toasts.at(-1), { kind: 'success', text: 'Saved to vault: ' + DRAFT.rel });
});

test('a note that is already there: Save only asks; Keep it writes nothing; Replace sends replace:true (Review Focus 5)', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview({ ...DRAFT, exists: true });
  let v = t.c.renderVals();
  assert.equal(v.vaultHasExists, true);
  assert.match(v.vaultExistsNote, /already in the vault/);
  v.vaultSave();
  assert.equal(t.c.renderVals().vaultAskReplace, true);
  assert.deepEqual(saves(t.calls), [], 'asking is not saving');
  t.c.renderVals().vaultKeep();
  assert.equal(t.c.renderVals().vaultAskReplace, false);
  assert.deepEqual(saves(t.calls), []);
  t.c.renderVals().vaultSave();
  t.c.renderVals().vaultReplace();
  assert.deepEqual(saves(t.calls), [{ path: DRAFT.path, markdown: DRAFT.markdown, replace: true }]);
  await t.answerSave(true);
  assert.equal(t.c.renderVals().vaultSaved, true);
});

test('a save answered "exists" (a note appeared after the preview) goes back to the question — never an automatic retry (Review Focus 5)', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview(DRAFT);
  t.c.renderVals().vaultSave();
  await t.answerSave({ error: 'a note with this name is already there', exists: true });
  const v = t.c.renderVals();
  assert.equal(v.vaultReady, true);
  assert.equal(v.vaultAskReplace, true);
  assert.equal(v.vaultHasExists, true);
  assert.match(v.vaultSaveError, /appeared/);
  assert.equal(saves(t.calls).length, 1, 'no automatic second save');
});

test('a save error keeps the draft and says why', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview(DRAFT);
  t.c.renderVals().vaultSave();
  await t.answerSave({ error: 'the note is open or locked by another program (EBUSY) — close it and press Replace again' });
  const v = t.c.renderVals();
  assert.equal(v.vaultReady, true); assert.equal(v.vaultDraft, DRAFT.markdown);
  assert.equal(v.vaultHasSaveError, true); assert.match(v.vaultSaveError, /EBUSY/);
});

test('a preview error says why, and Try again asks again', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview({ error: 'the local model isn’t running — start Ollama or LM Studio and try again (no runtime)' });
  const v = t.c.renderVals();
  assert.equal(v.vaultFailed, true); assert.match(v.vaultError, /local model isn’t running/);
  v.vaultRetry();
  assert.deepEqual(t.calls.map((x) => x[0]), ['preview', 'preview']);
  assert.equal(t.c.renderVals().vaultDrafting, true);
});

test('closing while the draft is coming drops the late answer; Escape (closeTop) closes the dialog', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1');
  t.c.renderVals().vaultClose();
  await t.answerPreview(DRAFT);
  assert.equal(t.c.state.vault, null);
  assert.equal(t.c.renderVals().vaultOpen, false);
  t.c.openVaultPreview('code:s-1');
  t.c.closeTop();
  assert.equal(t.c.state.vault, null);
});

test('no bridge → "not wired"; a past snapshot → denied; neither asks for a draft', () => {
  const a = make({ withVault: false });
  a.c.openVaultPreview('code:s-1');
  assert.deepEqual(a.said, [['notWired', 'Save to vault']]);
  assert.equal(a.c.renderVals().clVaultOff, true);
  const b = make();
  b.c.setState({ snapOffset: 1 });
  b.c.openVaultPreview('code:s-1');
  assert.equal(b.said[0][0], 'denied');
  assert.deepEqual(b.calls, []);
});

test('an empty draft cannot be saved', async () => {
  const t = make();
  t.c.openVaultPreview('code:s-1'); await t.answerPreview(DRAFT);
  t.c.renderVals().onVaultEdit({ target: { value: '   ' } });
  assert.equal(t.c.renderVals().vaultSaveOff, true);
});

test('basisNote and the dialog markup say what the model did and that nothing is written before Save', () => {
  assert.equal(basisNote('placeholder-model', 12), 'Drafted by the local model (placeholder-model) from 12 chat messages. Check and edit it — nothing is written until you press Save.');
  assert.equal(basisNote(null, 1), 'Drafted by the local model (unknown model) from 1 chat message. Check and edit it — nothing is written until you press Save.');
  assert.match(extrasTpl, /<!-- v5: Save to vault \(Claude Hub H5/);
  assert.match(extrasTpl, /role="dialog" aria-label="Save to vault"/);
  assert.match(extrasTpl, /data-vault="save"/);
  assert.match(extrasTpl, /data-vault="replace"/);
});

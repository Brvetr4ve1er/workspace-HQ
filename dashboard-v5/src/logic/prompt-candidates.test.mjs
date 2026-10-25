// Candidates actions (spec 2026-10-15 §6.3, phase P2). A plain object stands in for the Component.
import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesLogic, NOT_WRITTEN } from './prompt-candidates.js';

const K1 = 'cand:' + '1'.repeat(40), K2 = 'cand:' + '2'.repeat(40);
const ROWS = [
  { key: K1, text: 'Placeholder one\nmore', reasons: [], sources: [{ kind: 'code', conversationId: 'code:s1', at: '2026-10-01T10:00:00Z', project: 'p' }] },
  { key: K2, text: 'Placeholder two', reasons: [], sources: [{ kind: 'chatgpt', conversationId: 'chatgpt:g1', at: '2026-09-01T10:00:00Z', project: null }] },
];
function rig({ promote, hide, canWrite = true } = {}) {
  const c = Object.assign(Object.create(candidatesLogic), {
    state: { prView: 'library', hcSel: [], promote: null }, toasts: [], promoted: [], refreshed: { cand: 0, prompts: 0 },
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); },
    toast(kind, text) { this.toasts.push([kind, text]); },
    canWrite: () => canWrite, writeReason: () => 'read-only preview', denied(why) { this.toasts.push(['denied', why]); },
    forceUpdate() {},
    async call(fn) { try { const r = await fn(); if (r && r.error) { this.toasts.push(['error', r.error]); return null; } return r; } catch (e) { this.toasts.push(['error', String(e)]); return null; } },
  });
  c.store = { live: { candidates: { rows: ROWS.slice(), loaded: false, hidden: 0 } },
    refreshCandidates() { c.refreshed.cand++; this.live.candidates.loaded = true; return Promise.resolve(); },
    refreshPrompts() { c.refreshed.prompts++; return Promise.resolve(); } };
  c.hq = { claudePrompts: { promote: async (p) => { c.promoted.push(p); return promote ? promote(p, c.promoted.length) : { path: '40_Resources/Prompts/x.md', name: 'x.md', id: 'prompt:x', masked: 0 }; } },
    claudeHub: { hideCandidate: async (k) => (hide ? hide(k) : true) } };
  return c;
}

test('hcView switches and loads candidates once', async () => {
  const c = rig();
  c.hcView('candidates');
  assert.equal(c.state.prView, 'candidates'); assert.equal(c.refreshed.cand, 1);
  c.hcView('library'); c.hcView('candidates');
  assert.equal(c.refreshed.cand, 1, 'already loaded: no second ask');
  c.hcView('junk'); assert.equal(c.state.prView, 'candidates');
});

test('hcToggle selects; hcAsk opens ONE confirm for the selection; nothing is written before hcGo', () => {
  const c = rig();
  c.hcAsk(); assert.deepEqual(c.toasts.at(-1), ['info', 'Tick one or more candidates first.']);
  c.hcToggle(K1); c.hcToggle(K2); c.hcToggle(K2); c.hcToggle(K2);
  assert.deepEqual(c.state.hcSel, [K1, K2]);
  c.hcAsk();
  assert.equal(c.state.promote.phase, 'ask');
  assert.deepEqual(c.state.promote.items.map((i) => i.title), ['Placeholder one', 'Placeholder two']);
  assert.deepEqual(c.state.promote.items[0].source, { kind: 'code', conversation: 'code:s1', at: '2026-10-01T10:00:00Z' });
  assert.equal(c.promoted.length, 0);
});

test('single Promote: editable title, written, Library + candidates re-read', async () => {
  const c = rig();
  c.hcAsk(K1);
  c.hcTitle({ target: { value: '  My title  ' } });
  assert.equal(c.state.promote.items[0].title, '  My title  ');   // kept as typed: onChange fires per keystroke (runtime maps it to 'input'), so a trim here would eat every space typed
  await c.hcGo();
  assert.deepEqual(c.promoted[0], { text: 'Placeholder one\nmore', title: 'My title', tags: ['harvested'], source: { kind: 'code', conversation: 'code:s1', at: '2026-10-01T10:00:00Z' } });
  assert.equal(c.state.promote.phase, 'done');
  assert.deepEqual(c.state.promote.results, [{ title: 'My title', ok: true, name: 'x.md' }]);
  assert.deepEqual(c.state.hcSel, []);
  assert.deepEqual(c.refreshed, { cand: 1, prompts: 1 });
  assert.equal(c.toasts.at(-1)[0], 'success');
});

test('single Promote clash: asks once more and saves as the offered name only after hcSaveAs', async () => {
  const c = rig({ promote: (p, n) => (n === 1 ? { error: 'a prompt note with this name is already there', exists: true, next: 'placeholder-one-2.md' }
    : { path: '40_Resources/Prompts/' + p.name, name: p.name, id: 'prompt:y', masked: 0 }) });
  c.hcAsk(K1); await c.hcGo();
  assert.equal(c.state.promote.phase, 'clash'); assert.deepEqual(c.state.promote.clash, { next: 'placeholder-one-2.md' });
  assert.equal(c.promoted.length, 1);
  await c.hcSaveAs();
  assert.equal(c.promoted[1].name, 'placeholder-one-2.md');
  assert.equal(c.state.promote.phase, 'done');
  assert.equal(c.state.promote.results[0].name, 'placeholder-one-2.md');
});

test('multi Promote: one confirm; a clash inside a batch is reported, never saved under a new name', async () => {
  const c = rig({ promote: (p) => (p.title === 'Placeholder two' ? { error: 'a prompt note with this name is already there', exists: true, next: 'placeholder-two-2.md' }
    : { path: '40_Resources/Prompts/placeholder-one.md', name: 'placeholder-one.md', id: 'prompt:z', masked: 0 }) });
  c.hcToggle(K1); c.hcToggle(K2); c.hcAsk(); await c.hcGo();
  assert.equal(c.promoted.length, 2);
  assert.equal(c.promoted.some((p) => p.name), false, 'a batch never sends a name');
  assert.deepEqual(c.state.promote.results, [{ title: 'Placeholder one', ok: true, name: 'placeholder-one.md' },
    { title: 'Placeholder two', ok: false, error: NOT_WRITTEN('placeholder-two-2.md') }]);
  assert.equal(NOT_WRITTEN('placeholder-two-2.md'), 'not written — a note with that name is there; promote it alone to save it as placeholder-two-2.md');
  assert.equal(c.toasts.at(-1)[1], 'Promoted 1 of 2 — see the list for the one not written.');
});

test('a read-only preview cannot Promote or Hide; Cancel writes nothing; Hide removes the row and says it is permanent', async () => {
  const ro = rig({ canWrite: false });
  ro.hcAsk(K1); assert.equal(ro.state.promote, null); assert.deepEqual(ro.toasts.at(-1), ['denied', 'read-only preview']);
  await ro.hcHide(K1); assert.deepEqual(ro.toasts.at(-1), ['denied', 'read-only preview']);
  const c = rig();
  c.hcAsk(K1); c.hcCancel(); assert.equal(c.state.promote, null); assert.equal(c.promoted.length, 0);
  await c.hcHide(K1);
  assert.deepEqual(c.store.live.candidates.rows.map((r) => r.key), [K2]);
  assert.equal(c.store.live.candidates.hidden, 1);
  assert.deepEqual(c.toasts.at(-1), ['info', 'Hidden — this prompt will not be offered again.']);
  const bad = rig({ hide: () => ({ error: 'read-only hub (another WorkspaceHQ owns the index)' }) });
  await bad.hcHide(K1);
  assert.equal(bad.store.live.candidates.rows.length, 2);
  assert.match(bad.toasts.at(-1)[1], /read-only hub/);
});

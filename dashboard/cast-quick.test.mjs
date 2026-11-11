// node --test dashboard/cast-quick.test.mjs — the quick-run palette's page code (cast.js boot) with a tiny fake document and a fake
// window.hq: the "Needs you" rows on an empty query, Tab into Go mode, Enter on each kind of row, and the honest states.
// Placeholder names only (public repo). cast.js and cast-modes.js run as scripts in a vm context, like the page loads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = (n) => readFileSync(new URL('./' + n, import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 5));

class El {
  constructor(id) { this.id = id; this.children = []; this.hidden = false; this._text = ''; this.value = ''; this.className = ''; this.attrs = {}; this.listeners = {}; this.title = ''; this.placeholder = ''; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); if (v === '') this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, f) { this.listeners[t] = f; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  querySelector() { return new El('x'); }
  scrollIntoView() {}
  focus() {}
}

function page({ hq }) {
  const ids = ['q', 'list', 'empty', 'msg', 'confirm', 'stat', 'modes', 'note', 'hint'];
  const els = Object.fromEntries(ids.map((i) => [i, new El(i)]));
  els.empty.textContent = 'no matching spells';
  els.msg.hidden = true; els.confirm.hidden = true; els.modes.hidden = true; els.note.hidden = true;
  const doc = { getElementById: (i) => els[i], createElement: () => new El('row') };
  const win = { document: doc, hq, addEventListener() {} };
  const ctx = vm.createContext({ window: win, setTimeout, clearTimeout, Promise, Date, Math, Array, String, Number, Object, Set, Map, JSON });
  vm.runInContext(SRC('cast-modes.js'), ctx);
  vm.runInContext(SRC('cast.js'), ctx);
  const key = (k, extra = {}) => { let prevented = false; els.q.listeners.keydown(Object.assign({ key: k, repeat: false, preventDefault() { prevented = true; } }, extra)); return () => prevented; };
  const type = (v) => { els.q.value = v; els.q.listeners.input(); };
  const rows = () => els.list.children.map((r) => r.children.map((c) => c.textContent));
  return { els, key, type, rows };
}

const SPELLS = { spells: [{ id: 's1', name: 'Alpha spell', kind: 'castable', school: 'x', source: 'grimoire' }] };
function fakeHq(over = {}) {
  const calls = { brief: [], go: [], hide: 0 };
  const quick = Object.assign({
    read: async () => ({ brief: [{ ref: 'aaaaaaaaaaaa', label: 'A project has secrets in plain sight', scan: false }, { ref: 'bbbbbbbbbbbb', label: 'A bill is late', scan: true }], status: 'ok', projects: [{ id: 'proj-a', name: 'Project Alpha' }] }),
    openBrief: async (ref) => { calls.brief.push(ref); return 'go'; },
    openGo: async (route) => { calls.go.push(route); return { ok: true }; },
  }, over);
  return { calls, hq: { getSpellbook: async () => SPELLS, getSpellTelemetry: async () => ({ favorites: [], rollup: {} }), hideCastPalette: async () => { calls.hide++; return true; }, quick } };
}

test('empty query: the Needs-you rows lead the spell list, with the projection wording only', async () => {
  const { hq } = fakeHq();
  const p = page({ hq });
  await tick();
  const rows = p.rows();
  assert.deepEqual(rows[0], ['!', 'A project has secrets in plain sight', 'needs you']);
  assert.deepEqual(rows[1], ['!', 'A bill is late', 'needs you']);
  assert.equal(rows[2][1], 'Alpha spell');
  assert.equal(p.els.modes.hidden, false);
  assert.equal(p.els.modes.children.length, 2);
  assert.equal(p.els.hint.textContent, 'up/down choose · enter run · tab go · esc close');
});

test('a typed query hides the Needs-you rows (the spell list and the spend row are unchanged)', async () => {
  const { hq } = fakeHq();
  const p = page({ hq });
  await tick();
  p.type('alp');
  assert.deepEqual(p.rows().map((r) => r[1]), ['Alpha spell']);
});

test('Enter on a Needs-you row asks main with the ref and closes the palette; "none" says the item is gone', async () => {
  const f = fakeHq();
  const p = page({ hq: f.hq });
  await tick();
  p.key('Enter');
  await tick();
  assert.deepEqual(f.calls.brief, ['aaaaaaaaaaaa']);
  assert.equal(f.calls.hide, 1);
  const g = fakeHq({ openBrief: async () => 'none' });
  const p2 = page({ hq: g.hq });
  await tick();
  p2.key('Enter');
  await tick();
  assert.equal(p2.els.msg.textContent, 'that item is gone');
  assert.equal(g.calls.hide, 0);
});

test('an {error} from openBrief is said on the message line and the palette stays open', async () => {
  const g = fakeHq({ openBrief: async () => ({ error: 'the scan did not start (one may already be running)' }) });
  const p = page({ hq: g.hq });
  await tick();
  p.key('ArrowDown');
  p.key('Enter');
  await tick();
  assert.match(p.els.msg.textContent, /did not start/);
  assert.equal(g.calls.hide, 0);
});

test('Tab goes to Go mode: the ten spaces, then typing "run" puts Money > Runway first; Enter navigates; Tab again returns', async () => {
  const f = fakeHq();
  const p = page({ hq: f.hq });
  await tick();
  const prevented = p.key('Tab');
  assert.equal(prevented(), true);
  assert.equal(p.rows().length, 8);   // the palette draws at most eight Go rows
  assert.deepEqual(p.rows()[0], ['→', 'Home', 'Space']);
  assert.equal(p.els.hint.textContent, 'up/down choose · enter open · tab run · esc close');
  p.type('run');
  assert.deepEqual(p.rows()[0], ['→', 'Money › Runway', 'View']);
  assert.equal(p.rows()[1][1], 'Automations › Runnable');
  p.key('Enter');
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.go)), [{ tab: 'money', sub: 'runway' }]);
  assert.equal(f.calls.hide, 1);
  assert.equal(f.calls.brief.length, 0, 'a Go row never opens a brief item or runs anything');
  p.key('Tab');
  assert.equal(p.els.hint.textContent, 'up/down choose · enter run · tab go · esc close');
});

test('Go mode: projects appear only once something is typed, by name; Enter opens that project', async () => {
  const f = fakeHq();
  const p = page({ hq: f.hq });
  await tick();
  p.key('Tab');
  assert.ok(!p.rows().some((r) => r[2] === 'Project'), 'no projects on an empty query');
  p.type('alpha');
  assert.deepEqual(p.rows(), [['→', 'Project Alpha', 'Project']]);
  p.key('Enter');
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.go)), [{ tab: 'projects', projectId: 'proj-a' }]);
});

test('honest states: an empty brief, no latest.json, nothing matching, and no navigation bridge', async () => {
  const f = fakeHq({ read: async () => ({ brief: [], status: 'empty', projects: null }) });
  const p = page({ hq: f.hq });
  await tick();
  assert.equal(p.els.note.textContent, 'nothing needs you');
  assert.equal(p.els.note.hidden, false);
  p.key('Tab');
  p.type('mon');
  assert.ok(p.rows().length > 0);
  assert.equal(p.els.note.textContent, 'no projects loaded');
  p.type('zzzz');
  assert.equal(p.rows().length, 0);
  assert.equal(p.els.empty.textContent, 'nothing matches · no projects loaded');

  const bare = fakeHq();
  delete bare.hq.quick;
  const p2 = page({ hq: bare.hq });
  await tick();
  assert.equal(p2.els.note.textContent, 'this window has no navigation bridge');
  assert.equal(p2.rows()[0][1], 'Alpha spell', 'the spell list is untouched');
  p2.key('Tab');
  p2.key('Enter');
  await tick();
  assert.equal(p2.els.msg.textContent, 'this window has no navigation bridge');
});

test('a read that answers {error} says it and draws no Needs-you rows', async () => {
  const f = fakeHq({ read: async () => ({ error: 'not available from this window' }) });
  const p = page({ hq: f.hq });
  await tick();
  assert.equal(p.els.msg.textContent, 'not available from this window');
  assert.equal(p.rows()[0][1], 'Alpha spell');
});

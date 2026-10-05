// Shell regressions found in review R2 (Phase 2, packages P-B / P-C): the running count
// includes the scan, live stays live across the reload a finished scan triggers, deep
// links land on the route's tab, the error screen says which case it is, and the
// onboarding copy says what the default scan sends to Claude. The Component is built
// the way src/vals.golden.test.mjs builds it (componentDidMount is never called).
//
//   node --test dashboard-v5/src/logic/shell.test.mjs
//
// Synthetic fixtures only (placeholder names and paths) — the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import { proj, scan } from '../live/__fixtures__/synthetic.mjs';
import onboardTpl from '../tpl/ov-onboard.tpl.js';

process.env.TZ = 'UTC';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
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

const IDS = ['2026-10-01', '2026-10-03', '2026-10-05'];
const DATA = (n) => ({ scans: IDS.slice(0, n).map((id) => scan(id, [proj('a', { dirty: 2 }), proj('b')])) });
function make(n, props) {
  const store = createStore(n ? DATA(n) : {}, null);
  return new Component(Object.assign({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false }, props || {}));
}
const fresh = () => { localStorage.clear(); sessionStorage.clear(); };

test('a running scan counts as running work (header badge, status rail, pet mood)', () => {
  fresh();
  const c = make(3);
  assert.equal(c.runningCount(), 0);
  c.store.live.scan = { state: 'running', startedAt: Date.parse('2026-10-05T09:00:00Z') };
  assert.equal(c.runningCount(), 1);
  const v = c.renderVals();
  assert.equal(v.isScanning, true);
  assert.equal(v.hasRunning, true);
  c.store.live.scan = { state: 'failed', code: 1, startedAt: 1, endedAt: 2 };
  assert.equal(c.runningCount(), 0);
});

test('live stays live after a finished scan reloads the window with one more scan', () => {
  fresh();
  const a = make(2);
  a.componentDidUpdate();   // writes whq3-place the way every render does
  const b = make(3);
  assert.equal(b.state.snapOffset, 0, 'the latest scan, not the one before it');
  assert.equal(b.canWrite(), false, 'no bridge here, but not because of a past view');
  assert.ok(!/viewing/i.test(b.writeReason()));
});

test('a past view keeps its scan when a new one lands (by id, not by offset)', () => {
  fresh();
  const a = make(2);
  a.state.snapOffset = 1;   // viewing 2026-10-01
  a.componentDidUpdate();
  const b = make(3);
  assert.equal(b.state.snapOffset, 2);
  assert.equal(b.M.at(b.state.snapOffset).id, '2026-10-01');
});

test('a deep link to a project lands on the route’s tab with the project open', () => {
  fresh();
  const c = make(3);
  c.state.tab = 'studio';
  c.navigateTo({ tab: 'tasks', projectId: 'a' });
  assert.equal(c.state.tab, 'tasks');
  assert.deepEqual(c.state.route, { type: 'project', id: 'a' });
  c.navigateTo({ tab: 'projects', projectId: 'zz' });   // not in the scan: the tab, and a toast
  assert.equal(c.state.tab, 'projects');
  assert.equal(c.state.route, null);
  assert.ok(c.state.toasts.some((t) => /isn’t in the latest scan/.test(t.text)));
  c.navigateTo({ tab: 'nosuchtab' });                    // a tab this build doesn't have: ignored
  assert.equal(c.state.tab, 'projects');
});

test('the error screen says which case it is', () => {
  fresh();
  const boot = make(3, { previewState: 'error', errorText: 'latest.json · bad token' }).renderVals();
  assert.equal(boot.errorText, 'latest.json · bad token');
  assert.match(boot.errorLead, /couldn’t be read/);
  const empty = make(0).renderVals();
  assert.equal(empty.v.error, true);
  assert.match(empty.errorText, /No scan data yet/);
  const preview = make(3, { previewState: 'error' }).renderVals();   // ?state=error over good data
  assert.ok(!/No scan data/.test(preview.errorText), 'good data must not be reported as missing');
  assert.match(preview.errorLead, /Nothing failed/);
});

test('onboarding step 1 says what the default scan sends to Claude, marked for the designer', () => {
  assert.ok(!onboardTpl.includes('Nothing is uploaded anywhere'));
  assert.match(onboardTpl, /<!-- v5:[^>]*enrich[^>]*--><div[^>]*>A folder on this PC\. [^<]*on by default[^<]*sends Claude[^<]*<\/div>/);
});

// The Brief panel heading Home (spec docs/superpowers/specs/2026-11-05-operator-design.md, UI section): vals + logic.
// Rig in the logic/money.test.mjs style: a never-mounted object over the real mixin and vals, a fake window.hq.
//   node --test dashboard-v5/src/logic/brief.test.mjs
// Placeholder data only — the repo is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import { briefLogic } from './brief.js';
import { briefVals } from '../vals/brief.js';

process.env.TZ = 'UTC';
globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const item = (key, severity, action, text = 'Placeholder ' + key) => ({ key, rule: key.split(':')[0], severity, text, why: 'why ' + key, source: 'scan', age: 'scan 1 h ago', action });
const BRIEF = { v: 1, generatedAt: '2026-11-05T09:05:00.000Z', more: 2, errors: [], items: [
  item('secrets:p1:2', 'high', { kind: 'go', tab: 'projects', projectId: 'p1' }),
  item('scan-stale:2026-11-03', 'med', { kind: 'scan' }),
  item('claude-sync:0:never', 'low', { kind: 'go', tab: 'claude', sub: 'chats' }),
] };

function rig(o = {}) {
  const calls = [], toasts = [];
  const self = Object.assign(Object.create(briefLogic), {
    state: { brfBusy: false, snapOffset: 0, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]),
    LIVE: { brief: o.live === undefined ? { brief: BRIEF, error: '', loaded: true } : o.live },
    hq: o.noBridge ? null : { brief: { read() {}, dismiss() {} } },
    store: {
      dismissBrief: async (key) => { calls.push(['dismiss', key]); return o.dismiss ? o.dismiss(key) : { brief: { ...BRIEF, items: BRIEF.items.filter((i) => i.key !== key) } }; },
      refreshBrief: () => calls.push(['refresh']),
    },
    go: (tab, sub) => calls.push(['go', tab, sub]),
    openProject: (id) => calls.push(['openProject', id]),
    scanNow: () => calls.push(['scan']),
  });
  const vals = (live = true) => briefVals.call(self, { S: self.state, LIVE: self.LIVE, live });
  return { self, calls, toasts, vals };
}

test('every key is brf-prefixed (one shared namespace with the other surfaces)', () => {
  for (const k of Object.keys(rig().vals())) assert.match(k, /^brf/, k);
});

test('load states are honest and exclusive: offline · error · loading · empty · ready', () => {
  const states = (r) => { const v = r.vals(); return ['brfOffline', 'brfError', 'brfLoading', 'brfEmpty', 'brfReady'].filter((k) => v[k]); };
  assert.deepEqual(states(rig({ noBridge: true })), ['brfOffline']);
  assert.deepEqual(states(rig({ live: { brief: null, error: 'brief read failed', loaded: true } })), ['brfError']);
  assert.deepEqual(states(rig({ live: { brief: null, error: '', loaded: false } })), ['brfLoading']);
  assert.deepEqual(states(rig({ live: { brief: { ...BRIEF, items: [], more: 0 }, error: '', loaded: true } })), ['brfEmpty']);
  assert.deepEqual(states(rig()), ['brfReady']);
  assert.equal(rig({ live: { brief: null, error: 'brief read failed', loaded: true } }).vals().brfErrorText, 'brief read failed');
});

test('empty says "Nothing needs you right now · from the HH:MM brief" — never when the engine had source errors', () => {
  const empty = rig({ live: { brief: { ...BRIEF, items: [], more: 0 }, error: '', loaded: true } }).vals();
  assert.equal(empty.brfEmptyText, 'Nothing needs you right now · from the 09:05 brief');
  const partial = rig({ live: { brief: { ...BRIEF, items: [], more: 0, errors: [{ source: 'scan', error: 'no scan yet' }] }, error: '', loaded: true } }).vals();
  assert.equal(partial.brfEmpty, false, 'no items because a source failed is not "nothing needs you"');
  assert.equal(partial.brfHasSourceErrors, true);
  assert.match(partial.brfSourceErrorsText, /scan: no scan yet/);
});

test('items carry severity in words (not colour only), the source + age, and an honest action label', () => {
  const v = rig().vals();
  assert.deepEqual(v.brfItems.map((i) => i.sevLabel), ['urgent', 'soon', 'when you can']);
  assert.deepEqual(v.brfItems.map((i) => i.actLabel), ['Open project', 'Scan now', 'Open Claude']);
  assert.equal(v.brfItems[0].meta, 'from scan 1 h ago');
  assert.match(v.brfItems[0].sevStyle.color, /--red/);
  assert.equal(v.brfHasMore, true);
  assert.equal(v.brfMoreText, '+2 more');
});

test('acting on an item navigates (project / tab+sub) or scans', () => {
  const { vals, calls } = rig();
  const [a, b, c] = vals().brfItems;
  a.act(); b.act(); c.act();
  assert.deepEqual(calls, [['openProject', 'p1'], ['scan'], ['go', 'claude', 'chats']]);
});

test('dismiss sends the key once (busy guard), swaps the answer in, and releases on failure', async () => {
  let release; const r = rig({ dismiss: () => new Promise((res) => { release = () => res({ brief: { ...BRIEF, items: BRIEF.items.slice(1) } }); }) });
  const first = r.vals().brfItems[0].dismiss();
  await r.vals().brfItems[0].dismiss();   // double click while in flight
  assert.equal(r.calls.filter((c) => c[0] === 'dismiss').length, 1, 'one dismiss sent');
  assert.equal(r.vals().brfBusy, true, 'greyed out while in flight');
  release(); await first;
  assert.equal(r.self.state.brfBusy, false);
  const bad = rig({ dismiss: () => Promise.reject(new Error('brief write failed')) });
  await bad.vals().brfItems[0].dismiss();
  assert.equal(bad.self.state.brfBusy, false, 'released after a failure');
  assert.ok(bad.toasts.some(([k, t]) => k === 'error' && /brief write failed/.test(t)), 'the failure is said, not swallowed');
});

test('the Brief is about now: it hides while an older scan is being viewed', () => {
  assert.equal(rig().vals(true).brfShow, true);
  assert.equal(rig().vals(false).brfShow, false, 'scrubbed to an older scan');
});

// ---- the senses: action labels and the "+N more" line that names the overflow ------------------------------------------
test('the CI / pull-request and deploy senses name where their button goes', () => {
  const sense = (key, tab, sub) => item(key, 'med', { kind: 'go', tab, sub });
  const live = { brief: { ...BRIEF, more: 0, items: [sense('ci-red:o/r:d', 'projects', 'github'), sense('prod-deploy-error:s:d', 'projects', 'accounts'), sense('claude-sync:0:never', 'projects', undefined)] }, error: '', loaded: true };
  const labels = rig({ live }).vals().brfItems.map((i) => i.actLabel);
  assert.deepEqual(labels, ['Open GitHub', 'Open Vercel & Supabase', 'Open Projects'], 'other Projects sub-tabs keep the plain label');
});

test('"+N more" names up to two overflow items by their own text, and says plain "+N more" when there are none', () => {
  const ov = (text) => ({ ...item('ci-red:' + text, 'med', { kind: 'go', tab: 'projects', sub: 'github' }, text), count: 0 });
  const plain = rig().vals();
  assert.equal(plain.brfMoreText, '+2 more', 'no overflow field: exactly what it was');
  const many = rig({ live: { brief: { ...BRIEF, more: 4, overflow: [ov('CI is failing on repo-x and 3 more repos'), ov('2 pull requests are waiting on you'), ov('This PC is waiting for a restart')] }, error: '', loaded: true } }).vals();
  assert.equal(many.brfMoreText, '+4 more · CI is failing on repo-x and 3 more repos · 2 pull requests are waiting on you');
  assert.equal(many.brfHasMore, true);
  const junk = rig({ live: { brief: { ...BRIEF, more: 1, overflow: [null, { text: 5 }, { text: '  ' }, ov('only this one')] }, error: '', loaded: true } }).vals();
  assert.equal(junk.brfMoreText, '+1 more · only this one', 'bad rows are skipped, not named');
  const off = rig({ noBridge: true }).vals();
  assert.equal(off.brfMoreText, '+0 more', 'offline names nothing');
});

// ---- standing: items unchanged for 3 days step aside to one line (2026-11-08) --------------------------------------------------
const std = (key, since, action, text = 'Standing ' + key) => ({ ...item(key, 'low', action, text), since, count: 0 });
const STANDING = [std('ci-red:o/r:d', '2026-11-06T09:00:00.000Z', { kind: 'go', tab: 'projects', sub: 'github' }, 'CI is failing on placeholder-repo'), std('dirty:p1:12', '2026-11-05T09:00:00.000Z', { kind: 'go', tab: 'projects', projectId: 'p1' }, 'Placeholder project has 12 uncommitted files')];
const withStanding = (standing, extra = {}) => rig({ live: { brief: { ...BRIEF, ...extra, standing }, error: '', loaded: true } });

test('standing: the line names the oldest date and each item by its own text, one click from where it is cleared', () => {
  const r = withStanding(STANDING), v = r.vals();
  assert.equal(v.brfHasStanding, true);
  assert.equal(v.brfStandingLead, 'Standing since 5 Nov:');
  assert.deepEqual(v.brfStanding.map((s) => s.text), ['CI is failing on placeholder-repo', 'Placeholder project has 12 uncommitted files']);
  assert.deepEqual(v.brfStanding.map((s) => s.sep), ['', '·']);
  assert.match(v.brfStanding[0].tip, /Standing since 6 Nov · Open GitHub/);
  v.brfStanding[0].act(); v.brfStanding[1].act();
  assert.deepEqual(r.calls, [['go', 'projects', 'github'], ['openProject', 'p1']]);
  assert.equal(r.calls.filter((c) => c[0] === 'dismiss').length, 0, 'acting dismisses nothing');
});

test('standing: absent, empty, malformed or not-ready means no line; the three items and "+N more" do not move', () => {
  const plain = rig().vals();
  for (const standing of [undefined, [], 'no', [null, 5, { text: '  ' }, { key: 'k' }]]) {
    const v = withStanding(standing).vals();
    assert.equal(v.brfHasStanding, false); assert.equal(v.brfStandingLead, ''); assert.deepEqual(v.brfStanding, []);
    assert.deepEqual(v.brfItems.map((i) => i.text), plain.brfItems.map((i) => i.text));
    assert.equal(v.brfMoreText, plain.brfMoreText);
  }
  for (const r of [rig({ noBridge: true }), rig({ live: { brief: null, error: 'x', loaded: true } }), rig({ live: { brief: null, error: '', loaded: false } })]) assert.equal(r.vals().brfHasStanding, false);
  const withBad = withStanding([...STANDING, { key: 'x', text: 'Undated one', action: { kind: 'scan' } }]).vals();
  assert.equal(withBad.brfStandingLead, 'Standing since 5 Nov:', 'an undated row does not move the date');
  assert.equal(withBad.brfStanding.length, 3);
});

test('standing: with nothing fresh the panel still says so honestly and keeps the line', () => {
  const v = withStanding(STANDING, { items: [], more: 0 }).vals();
  assert.equal(v.brfEmpty, true); assert.equal(v.brfReady, false); assert.equal(v.brfHasStanding, true);
});

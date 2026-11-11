// Settings › Money for Claude sessions, renderer side: vals/money-access.js + logic/money-access.js on a rigged component.
//   node --test dashboard-v5/src/logic/money-access.test.mjs
// Pins: mac-prefixed keys, the switch is OFF by default and only turns on when main says so, the explanation text is
// present (what it does, what it never shows, where the words travel), one click sends ONE set, a refusal keeps the last
// known position and shows main's words, the "last asked" line, honest no-bridge / loading / error states, one read per
// opening of Settings. Placeholder data only: the repo is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { moneyAccessLogic, lastAskedText, MAC_EXPLAIN, MAC_NEVER, MAC_WARN, MAC_TITLE } from './money-access.js';
import { moneyAccessVals } from '../vals/money-access.js';
import tpl from '../tpl/money-access.tpl.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// macEnsure defers its read with setTimeout(0): wait on a real timer, not setImmediate
const settle = () => new Promise((res) => setTimeout(res, 8));

function rig(o = {}) {
  const calls = [], toasts = [], marks = [];
  const api = o.noBridge ? null : {
    read: async () => { calls.push(['read']); return o.read ? o.read() : { on: false, lastAskedAt: null }; },
    set: async (on) => { calls.push(['set', on]); return o.set ? o.set(on) : { on }; },
  };
  const self = Object.assign(Object.create(moneyAccessLogic), {
    state: { settingsOpen: true, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]), denied(why) { toasts.push(['denied', why]); },
    useMark: (id, action) => marks.push([id, action]),
    hq: api ? { moneyAccess: api } : null,
  });
  const vals = () => moneyAccessVals.call(self, { S: self.state });
  const sets = () => calls.filter((c) => c[0] === 'set');
  const reads = () => calls.filter((c) => c[0] === 'read');
  return { self, calls, toasts, marks, vals, sets, reads };
}
const loaded = async (r) => { r.vals(); await settle(); await settle(); return r.vals(); };

test('every key is mac-prefixed (one shared namespace with the other surfaces)', async () => {
  const r = rig();
  for (const k of Object.keys(await loaded(r))) assert.match(k, /^mac[A-Z]/, k);
});

test('the switch is off by default: off and disabled before main has answered, off and enabled when main says off', async () => {
  const r = rig({ read: () => new Promise(() => {}) });   // main never answers
  const v = r.vals();
  assert.equal(v.macOn, false);
  assert.equal(v.macStateText, 'Off');
  assert.equal(v.macSwitchDisabled, true);
  assert.equal(v.macLoading, true);
  assert.equal(v.macHasAsked, false);
  const r2 = rig();
  const v2 = await loaded(r2);
  assert.equal(v2.macOn, false);
  assert.equal(v2.macStateText, 'Off');
  assert.equal(v2.macSwitchDisabled, false);
  assert.equal(v2.macLoading, false);
  assert.equal(v2.macSwitchLabel, MAC_TITLE + ': off');
});

test('the explanation is present and plain: what it does, what it never shows, where the words travel, the title', async () => {
  const v = await loaded(rig());
  assert.equal(v.macTitle, 'Claude sessions may read Money (words only)');
  for (const phrase of ['set up', 'ok or tight', 'days to payday', 'late or due soon']) assert.ok(v.macExplain.includes(phrase), phrase);
  assert.ok(v.macNever.includes('amounts, names, accounts or notes'));
  assert.ok(/transcripts/.test(v.macWarn) && /local index/.test(v.macWarn));
  assert.equal(v.macExplain, MAC_EXPLAIN);
  assert.equal(v.macNever, MAC_NEVER);
  assert.equal(v.macWarn, MAC_WARN);
  // still said when the switch is on
  const on = await loaded(rig({ read: () => ({ on: true, lastAskedAt: null }) }));
  assert.equal(on.macWarn, MAC_WARN);
  // and the template shows all of it
  for (const k of ['macTitle', 'macExplain', 'macNever', 'macWarn', 'macAsked']) assert.ok(tpl.includes('{{ ' + k + ' }}'), k);
});

test('every binding in the template exists in the vals', async () => {
  const v = await loaded(rig());
  const bound = tpl.replace(/hint-placeholder-val="[^"]*"/g, '');   // the design-time hints are literals, not bindings
  const keys = new Set([...bound.matchAll(/\{\{\s*([A-Za-z0-9_.!]+)\s*\}\}/g)].map((m) => m[1].replace(/^!/, '').split('.')[0]));
  for (const k of keys) assert.ok(k in v, 'template binds ' + k + ' but vals has none');
  assert.ok(keys.size >= 12);
  assert.match(tpl, /role="switch"/);
});

test('turning it on calls set(true) ONCE, shows main’s answer, and turning it off calls set(false)', async () => {
  const r = rig();
  await loaded(r);
  assert.equal(await r.self.macToggle(), true);
  assert.deepEqual(r.sets(), [['set', true]]);
  assert.equal(r.vals().macOn, true);
  assert.equal(r.vals().macStateText, 'On');
  assert.deepEqual(r.toasts.at(-1)[0], 'success');
  assert.deepEqual(r.marks, [['money-access', 'act']]);
  assert.equal(await r.self.macToggle(), true);
  assert.deepEqual(r.sets(), [['set', true], ['set', false]]);
  assert.equal(r.vals().macOn, false);
});

test('no optimistic flip: the switch stays off while the write is in flight; a double click sends one set', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const r = rig({ set: async (on) => { await gate; return { on }; } });
  await loaded(r);
  const first = r.self.macToggle();
  assert.equal(r.vals().macOn, false);
  assert.equal(r.vals().macSwitchDisabled, true);
  assert.equal(await r.self.macToggle(), false);   // told, not sent
  release();
  await first;
  assert.equal(r.sets().length, 1);
  assert.equal(r.vals().macOn, true);
  assert.equal(r.vals().macSwitchDisabled, false);
});

test('a refused or failed set keeps the last known position and shows main’s words', async () => {
  const r = rig({ set: () => ({ error: 'not saved — disk full' }) });
  await loaded(r);
  assert.equal(await r.self.macToggle(), false);
  const v = r.vals();
  assert.equal(v.macOn, false);
  assert.equal(v.macHasErr, true);
  assert.match(v.macErrText, /not saved — disk full/);
  assert.deepEqual(r.toasts.at(-1), ['error', 'not saved — disk full']);
  assert.deepEqual(r.marks, []);
  const t = rig({ set: () => { throw new Error('ipc closed'); } });
  await loaded(t);
  assert.equal(await t.self.macToggle(), false);
  assert.match(t.vals().macErrText, /ipc closed/);
  assert.equal(t.vals().macOn, false);
});

test('a switch whose real position is unknown is never flipped', async () => {
  const r = rig({ read: () => ({ error: 'could not read the Money access switch' }) });
  const v = await loaded(r);
  assert.equal(v.macHasErr, true);
  assert.match(v.macErrText, /Couldn’t read the switch/);
  assert.equal(v.macSwitchDisabled, true);
  assert.equal(await r.self.macToggle(), false);
  assert.equal(r.sets().length, 0);
});

test('the last-asked line: never, minutes, hours, days, and a future time reads as just now', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  assert.equal(lastAskedText(null, now), 'last asked: never');
  assert.equal(lastAskedText(undefined, now), 'last asked: never');
  assert.equal(lastAskedText('garbage', now), 'last asked: never');
  assert.equal(lastAskedText('2026-11-10T11:59:40.000Z', now), 'last asked just now');
  assert.equal(lastAskedText('2026-11-10T12:05:00.000Z', now), 'last asked just now');
  assert.equal(lastAskedText('2026-11-10T11:15:00.000Z', now), 'last asked 45 min ago');
  assert.equal(lastAskedText('2026-11-10T09:00:00.000Z', now), 'last asked 3 h ago');
  assert.equal(lastAskedText('2026-11-05T12:00:00.000Z', now), 'last asked 5 d ago');
});

test('vals show the last asked time from main, or never', async () => {
  const recent = new Date(Date.now() - 3 * 3600e3 - 60e3).toISOString();
  const a = await loaded(rig({ read: () => ({ on: true, lastAskedAt: recent }) }));
  assert.equal(a.macAsked, 'last asked 3 h ago');
  assert.equal(a.macHasAsked, true);
  assert.equal(a.macOn, true);
  assert.equal((await loaded(rig({ read: () => ({ on: true, lastAskedAt: null }) }))).macAsked, 'last asked: never');
});

test('no bridge: an honest offline state, nothing sent, nothing read', async () => {
  const r = rig({ noBridge: true });
  const v = await loaded(r);
  assert.equal(v.macOffline, true);
  assert.match(v.macOfflineText, /desktop app/);
  assert.equal(v.macSwitchDisabled, true);
  assert.equal(v.macOn, false);
  assert.equal(await r.self.macToggle(), false);
  assert.deepEqual(r.calls, []);
  assert.equal(r.toasts[0][0], 'denied');
});

test('one read per opening of Settings; closing re-arms it; closed Settings shows nothing', async () => {
  const r = rig();
  r.vals(); r.vals(); r.vals();
  await settle();
  assert.equal(r.reads().length, 1);
  r.self.setState({ settingsOpen: false });
  assert.equal(r.vals().macShow, false);
  r.self.setState({ settingsOpen: true });
  r.vals();
  await settle();
  assert.equal(r.reads().length, 2);
});

test('the module never calls anything but read and set on the bridge, and never XP', () => {
  const src = fs.readFileSync(path.join(HERE, 'money-access.js'), 'utf8');
  assert.deepEqual([...new Set([...src.matchAll(/api\.(\w+)/g)].map((m) => m[1]))].sort(), ['read', 'set']);
  assert.doesNotMatch(src, /actedOn/);
});

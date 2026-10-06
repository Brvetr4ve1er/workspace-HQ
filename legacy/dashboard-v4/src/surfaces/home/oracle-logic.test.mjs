// oracle-logic.test.mjs — headless unit test for the pure Oracle adapter.
// Ported from legacy/dashboard-v3/src/realms/roundtable/oracle-logic.test.mjs with the
// expectations REWRITTEN for v4's rail: derive.oracle() emits v3 realm ids, and
// v4 registers `go:home|work|projects|system|mind|automate|lookback`, so the v3
// assertions (`go:forge`, `go:hunts`) would have asserted dispatch into nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oracleActionId, oracleButtonMeta, oracleSurfaceId, sentence, restCopy } from './oracle-logic.mjs';

// The ids core/boot.js registers as `go:<id>`. If this list and boot.js ever
// drift, the "every button dispatches into a real surface" test below fails.
const REGISTERED = ['home', 'tasks', 'work', 'projects', 'system', 'mind', 'automate', 'lookback'];
const LABEL_OF = { home: 'Home', tasks: 'Tasks', work: 'Agent', projects: 'Projects', system: 'System', mind: 'Notes', automate: 'Automations', lookback: 'History' };

test('oracleActionId maps every emitted realm to a REGISTERED v4 surface', () => {
  assert.equal(oracleActionId({ action: 'commit', target: { realmId: 'forge', projectId: 'p1' } }), 'go:projects');
  assert.equal(oracleActionId({ action: 'quest',  target: { realmId: 'hunts', questId: 'q1' } }),   'go:tasks');   // v4.3: the board is its own surface
  assert.equal(oracleActionId({ action: 'quest',  target: { realmId: 'forge', projectId: 'p2' } }), 'go:projects'); // the secrets quest is project-scoped
  assert.equal(oracleActionId({ action: 'capture', target: { realmId: 'roundtable' } }), 'capture:idea');
  assert.equal(oracleActionId({ action: 'scan',    target: { realmId: 'roundtable' } }), 'scan:now');
  assert.equal(oracleActionId({ action: 'rest',    target: { realmId: 'roundtable' } }), 'go:home');    // v3's roundtable IS v4's HOME
  assert.equal(oracleActionId({ action: 'rest',    target: {} }), 'go:work');                       // missing realmId -> the safe default surface
  assert.equal(oracleActionId({ action: 'quest',   target: { realmId: 'atlantis' } }), 'go:work');   // unknown realm -> never dispatches into nothing
  assert.equal(oracleActionId(null), null);
});

test('every navigational action id names a surface core/boot.js registers', () => {
  for (const realmId of ['forge', 'hunts', 'roundtable', 'atlantis', undefined]) {
    const id = oracleSurfaceId({ target: { realmId } });
    assert.ok(REGISTERED.includes(id), `${realmId} -> ${id} is not a registered surface`);
  }
});

test('button copy names the SAME room the dispatch id opens', () => {
  const cases = [
    { action: 'commit', target: { realmId: 'forge', projectId: 'p1' } },
    { action: 'quest',  target: { realmId: 'hunts', questId: 'q1' } },
    { action: 'quest',  target: { realmId: 'atlantis' } },
  ];
  for (const o of cases) {
    const meta = oracleButtonMeta(o);
    assert.equal(oracleActionId(o), `go:${meta.destination}`, `${meta.label} must dispatch go:${meta.destination}`);
    // the label the user reads has to contain the destination it dispatches to
    assert.match(meta.label, new RegExp(LABEL_OF[meta.destination], 'i'));
  }
});

test('oracleButtonMeta: per-action copy; unknown/null falls back to a real surface', () => {
  assert.equal(oracleButtonMeta({ action: 'commit', target: { realmId: 'forge' } }).label, 'Open Projects');
  assert.equal(oracleButtonMeta({ action: 'quest',  target: { realmId: 'hunts' } }).label, 'Open Tasks');
  assert.equal(oracleButtonMeta({ action: 'capture' }).label, 'Capture idea');
  assert.equal(oracleButtonMeta({ action: 'scan' }).label, 'Scan now');
  assert.deepEqual(oracleButtonMeta(null), { label: 'Open Agent', icon: '▸', destination: 'work' });
  // capture/scan are not navigational — they must not claim a destination
  assert.equal(oracleButtonMeta({ action: 'scan' }).destination, null);
});

test('button labels are mixed case, never a shouted sentence', () => {
  for (const o of [{ action: 'commit', target: { realmId: 'forge' } }, { action: 'capture' }, { action: 'scan' }, null]) {
    const { label } = oracleButtonMeta(o);
    assert.notEqual(label, label.toUpperCase(), `"${label}" is ALL CAPS`);
  }
});

test('sentence lifts intel copy into prose without touching the rest', () => {
  assert.equal(sentence('exposed secrets are a live breach risk'), 'Exposed secrets are a live breach risk.');
  assert.equal(sentence('5-min win — clear something small'), '5-min win — clear something small.');
  assert.equal(sentence('last touched 60d ago'), 'Last touched 60d ago.');
  assert.equal(sentence('Already punctuated.'), 'Already punctuated.');   // no double stop
  assert.equal(sentence('Is it done?'), 'Is it done?');
  assert.equal(sentence('  padded  '), 'Padded.');
  assert.equal(sentence(''), '');
  assert.equal(sentence(null), '');
  assert.equal(sentence(undefined), '');
  // interior casing (project names, acronyms) survives untouched
  assert.equal(sentence('push DOCTOR CHERFIA CLINIC now'), 'Push DOCTOR CHERFIA CLINIC now.');
});

test('restCopy is night-aware and always a single calm sentence', () => {
  const at = (h) => { const d = new Date(2026, 7, 19, h, 0, 0); return restCopy(d.toISOString()); };
  assert.equal(at(23).eyebrow, 'ALL QUIET');
  assert.equal(at(3).eyebrow,  'ALL QUIET');
  assert.equal(at(6).eyebrow,  'ALL CLEAR');
  assert.equal(at(14).eyebrow, 'ALL CLEAR');
  assert.equal(at(21).eyebrow, 'ALL CLEAR');
  for (const h of [3, 14, 23]) {
    const { line } = at(h);
    assert.notEqual(line, line.toUpperCase(), 'the calm line must be mixed case');
    assert.match(line, /[.!?]$/, 'the calm line must be a terminated sentence');
  }
  // an unparseable timestamp must not throw, and must not claim it is night
  assert.equal(restCopy('not-a-date').eyebrow, 'ALL CLEAR');
  assert.equal(restCopy(undefined).eyebrow, 'ALL CLEAR');
});

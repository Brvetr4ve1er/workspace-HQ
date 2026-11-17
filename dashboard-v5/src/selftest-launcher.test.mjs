// node --test dashboard-v5/src/selftest-launcher.test.mjs
// The Launcher selftest rows: plain Node can check that every row is a whole `lnch` state the renderer accepts, that the names are the ones selftest.js
// lists, and that the vals render every row without an unresolved key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { launcherStates, LNCH_OFFLINE_ROWS, LNCH_PAGE_ROWS } from './selftest-launcher.mjs';
import { lnchInit, launcherLogic, cleanRead } from './logic/launcher.js';
import { launcherVals, workspaceVals } from './vals/launcher.js';

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

test('every row is a whole lnch state with the same keys as lnchInit, and the names are unique', () => {
  const rows = launcherStates({ projectId: 'a' });
  assert.equal(new Set(rows.map((r) => r[0])).size, rows.length);
  for (const [name, lnch] of rows) assert.deepEqual(Object.keys(lnch).sort(), Object.keys(lnchInit()).sort(), name);
  for (const n of [...LNCH_OFFLINE_ROWS, ...LNCH_PAGE_ROWS]) assert.ok(rows.some((r) => r[0] === n), n + ' is a row');
  for (const want of ['launcher-off', 'launcher-loading', 'launcher-error', 'launcher-empty', 'launcher-ready', 'launcher-unallowed', 'launcher-refused', 'launcher-editor-set']) assert.ok(rows.some((r) => r[0] === want), want);
});

test('a held list is a list the renderer accepts (cleanRead keeps every entry and project)', () => {
  for (const [name, lnch] of launcherStates({ projectId: 'a' })) {
    if (!lnch.data) continue;
    const c = cleanRead(lnch.data);
    assert.equal(c.ok, true, name);
    assert.equal(c.data.entries.length, lnch.data.entries.length, name + ' entries survive cleaning');
    assert.equal(c.data.projects.length, lnch.data.projects.length, name + ' projects survive cleaning');
  }
});

test('the vals render every row with the same key set and no unresolved text', () => {
  const keys = Object.keys(launcherVals.call({}, { S: { settingsOpen: false } }).lnchv).sort();
  for (const [name, lnch, extra] of launcherStates({ projectId: 'a' })) {
    const self = Object.assign(Object.create(launcherLogic), {
      state: Object.assign({ settingsOpen: false, paletteOpen: false, lnch }, extra),
      hq: name === 'launcher-offline' ? {} : { launcher: { read: async () => ({}), openWorkspace: async () => ({}) } },
      projectsAt: () => [{ id: 'a', name: 'Project A', dev: 'npm run dev' }],
      _lnchAsked: true,
    });
    const v = launcherVals.call(self, { S: self.state }).lnchv;
    assert.deepEqual(Object.keys(v).sort(), keys, name);
    assert.ok(!/undefined|\[object|NaN/.test(JSON.stringify(v, (k, x) => (typeof x === 'function' ? 'fn' : x))), name + ' has an unresolved value');
    const w = workspaceVals.call(self, { id: 'a' });
    assert.deepEqual(Object.keys(w).sort(), ['busy', 'label', 'line', 'on'], name);
  }
});

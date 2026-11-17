// node --test dashboard/tray-kill.test.mjs — the tray's Stop all running dev servers goes through the dev-command module's killAll(); fakes only, nothing is started or killed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { trayTemplate } from './tray-menu.js';

const require = createRequire(import.meta.url);
const { makeKillServers } = require('./tray-kill.js');

test('the click calls killAll once, then refreshes once, and answers the number killed', () => {
  const order = [];
  const dev = { killAll: () => { order.push('killAll'); return 2; } };
  const kill = makeKillServers({ getDev: () => dev, after: (n) => order.push('after:' + n) });
  assert.equal(kill(), 2);
  assert.deepEqual(order, ['killAll', 'after:2']);
});

test('the module is read at click time (it is created after the tray)', () => {
  let dev = null;
  const seen = [], logs = [];
  const kill = makeKillServers({ getDev: () => dev, after: () => seen.push('refresh'), log: (l) => logs.push(l) });
  assert.equal(kill(), 0);
  assert.deepEqual(seen, ['refresh'], 'the menu is still refreshed');
  assert.equal(logs.length, 1);
  dev = { killAll: () => 1 };
  assert.equal(kill(), 1);
});

test('a killAll that throws is logged as a fixed word and the refresh still runs', () => {
  const logs = [], seen = [];
  const kill = makeKillServers({ getDev: () => ({ killAll: () => { throw new Error('C:\secret\path boom'); } }), after: () => seen.push('refresh'), log: (l) => logs.push(l) });
  assert.equal(kill(), 0);
  assert.deepEqual(seen, ['refresh']);
  assert.deepEqual(logs, ['[tray] kill servers: failed']);
  assert.doesNotMatch(logs.join(' '), /secret|boom/);
});

test('a refresh that throws never throws out of the menu click', () => {
  const kill = makeKillServers({ getDev: () => ({ killAll: () => 3 }), after: () => { throw new Error('x'); }, log: () => {} });
  assert.equal(kill(), 3);
});

test('the tray menu item runs it, and does not run killAll when no server is counted', () => {
  let calls = 0;
  const kill = makeKillServers({ getDev: () => ({ killAll: () => { calls++; return 1; } }), after: () => {} });
  const find = (tpl) => { const out = []; const walk = (xs) => xs.forEach((i) => { if (/Stop all running dev servers/.test(i.label || '')) out.push(i); if (Array.isArray(i.submenu)) walk(i.submenu); }); walk(tpl); return out; };
  const shown = find(trayTemplate({ scan: null, devServers: 2 }, { killServers: kill }));
  assert.equal(shown.length, 1);
  shown[0].click();
  assert.equal(calls, 1, 'the menu click reaches killAll');
  assert.equal(find(trayTemplate({ scan: null, devServers: 0 }, { killServers: kill })).length, 0);
});

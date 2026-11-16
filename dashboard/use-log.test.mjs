// hq:use (dashboard/use-log.js): allowlisted ids only, a per-minute cap, nothing free-text in the day log.
// Fake appLog / ipcMain; placeholder data — the repo is public.
//   node --test dashboard/use-log.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const useLog = require('./use-log.js');

const fakeLog = () => { const lines = []; return { lines, event: (name, f) => { lines.push([name, f]); return true; } }; };

test('every allowlisted surface and action passes, and writes exactly appLog.event("use", {surface, action})', () => {
  assert.deepEqual([...useLog.SURFACES], ['brief-panel', 'sessions-board', 'sessions-strip', 'delivery-card', 'money-start', 'money-quick', 'palette-money-line', 'reach', 'cosmos', 'delivery-check', 'clients-list', 'brief-act', 'quick-jump', 'money-access', 'today-ribbon', 'brief-history', 'machine-drift', 'security', 'security-refresh', 'claude-vault', 'security-recycle', 'home-more', 'projects-archived', 'system-hub-panel', 'automations-library', 'tasks-board', 'space-home', 'space-projects', 'space-tasks', 'space-automations', 'space-claude', 'space-history', 'space-system', 'space-life', 'space-money', 'space-cosmos', 'space-security']);
  assert.deepEqual([...useLog.ACTIONS], ['open', 'act', 'resume', 'copy', 'log', 'handover']);
  // spaced out so the per-minute cap never interferes: every surface x every action is accepted
  const log = fakeLog();
  let c = 0;
  const u = useLog.create({ appLog: log, now: () => (c += 3000) });
  for (const s of useLog.SURFACES) for (const a of useLog.ACTIONS) assert.deepEqual(u.mark(s, a), { ok: true });
  assert.equal(log.lines.length, useLog.SURFACES.length * useLog.ACTIONS.length);
  for (const s of ['claude-vault', 'security-recycle']) assert.ok(useLog.SURFACES.includes(s), s + ' is allowed (act marks, batch 6)');
  assert.ok(useLog.SURFACES.includes('home-more'), 'home-more is allowed (More on Home, batch 7)');
  for (const s of ['projects-archived', 'system-hub-panel', 'automations-library']) assert.ok(useLog.SURFACES.includes(s), s + ' is allowed (the subtraction pass measures what it could fold, batch 7)');
  assert.deepEqual(useLog.create({ appLog: fakeLog(), now: () => 1 }).mark('home-more-typo', 'open'), { error: 'unknown surface or action' }, 'an unknown id is still refused');
  const log2 = fakeLog();
  let t = 0;
  const u2 = useLog.create({ appLog: log2, now: () => (t += 5000) });
  for (const s of useLog.SURFACES) assert.deepEqual(u2.mark(s, 'act'), { ok: true });
  assert.deepEqual(log2.lines[0], ['use', { surface: 'brief-panel', action: 'act' }]);
  assert.deepEqual(Object.keys(log2.lines[0][1]), ['surface', 'action']);
});

test('an omitted action means open', () => {
  const log = fakeLog();
  assert.deepEqual(useLog.create({ appLog: log }).mark('reach'), { ok: true });
  assert.deepEqual(log.lines, [['use', { surface: 'reach', action: 'open' }]]);
});

test('anything else is refused and never logged — free text, wrong types, prototype keys', () => {
  const log = fakeLog();
  const u = useLog.create({ appLog: log });
  const bad = [['alpha-site', 'open'], ['brief-panel', 'delete'], ['brief-panel', 'Open'], ['', 'open'], [null, 'open'], [undefined, undefined],
    [{ toString: () => 'reach' }, 'open'], ['reach', { x: 1 }], ['reach', null], ['__proto__', 'open'], ['constructor', 'open'], ['reach', 'constructor'],
    ['brief-panel ', 'open'], [['reach'], 'open'], [7, 8], ['C:/work/alpha-site', 'open']];
  for (const [s, a] of bad) {
    const r = u.mark(s, a);
    assert.equal(r.ok, undefined, JSON.stringify([s, a]));
    assert.equal(typeof r.error, 'string');
  }
  assert.deepEqual(log.lines, []);
});

test('at most 30 accepted a minute; refused calls do not use up the cap; the window slides', () => {
  const log = fakeLog();
  let t = 1e6;
  const u = useLog.create({ appLog: log, now: () => t });
  for (let i = 0; i < 40; i++) u.mark('nope', 'open');   // refused for the allowlist, not counted
  for (let i = 0; i < 30; i++) assert.deepEqual(u.mark('brief-panel', 'open'), { ok: true }, 'call ' + i);
  const over = u.mark('brief-panel', 'open');
  assert.match(over.error, /too many/);
  assert.equal(log.lines.length, 30, 'the 31st is not logged');
  t += 59e3;
  assert.ok(u.mark('brief-panel', 'open').error, 'still inside the minute');
  t += 2e3;
  assert.deepEqual(u.mark('brief-panel', 'open'), { ok: true });
  assert.equal(log.lines.length, 31);
});

test('a broken or missing appLog never throws at the caller', () => {
  assert.deepEqual(useLog.create({}).mark('reach', 'open'), { ok: true });
  const boom = { event() { throw new Error('disk gone'); } };
  assert.deepEqual(useLog.create({ appLog: boom }).mark('reach', 'open'), { ok: true });
});

test('init registers hq:use and the handler answers like mark()', () => {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const log = fakeLog();
  useLog.init({ ipcMain, appLog: log });
  assert.deepEqual(Object.keys(handlers), ['hq:use']);
  assert.deepEqual(handlers['hq:use']({}, 'sessions-board', 'resume'), { ok: true });
  assert.ok(handlers['hq:use']({}, 'free text', 'open').error);
  assert.deepEqual(log.lines, [['use', { surface: 'sessions-board', action: 'resume' }]]);
  assert.doesNotThrow(() => useLog.init({}));
});

test('every nav space has an allowlisted space-<id> surface (and nothing else of that shape), and an unknown space is refused', async () => {
  const { NAV } = await import('../dashboard-v5/src/live/catalog.mjs');
  const spaceSurfaces = useLog.SURFACES.filter((s) => s.startsWith('space-'));
  assert.deepEqual(spaceSurfaces, NAV.map((n) => 'space-' + n.id));
  const log = fakeLog();
  const u = useLog.create({ appLog: log });
  assert.deepEqual(u.mark('space-money', 'open'), { ok: true });
  assert.ok(u.mark('space-settings', 'open').error);
  assert.ok(u.mark('space-', 'open').error);
  assert.ok(u.mark('space-alpha-site', 'open').error);
  assert.deepEqual(log.lines, [['use', { surface: 'space-money', action: 'open' }]]);
});

test('tasks-board and handover are allowed (act counting, batch 8) and still carry nothing but the two ids', () => {
  assert.ok(useLog.SURFACES.includes('tasks-board'));
  assert.ok(useLog.ACTIONS.includes('handover'));
  const log = fakeLog();
  const u = useLog.create({ appLog: log, now: () => 1 });
  assert.deepEqual(u.mark('tasks-board', 'act'), { ok: true });
  assert.deepEqual(u.mark('brief-act', 'handover'), { ok: true });
  assert.deepEqual(log.lines, [['use', { surface: 'tasks-board', action: 'act' }], ['use', { surface: 'brief-act', action: 'handover' }]]);
});

test('a mark is only ever (surface, action): an extra argument, an id or a name never reaches the log', () => {
  const log = fakeLog();
  const u = useLog.create({ appLog: log, now: () => 1 });
  assert.deepEqual(u.mark('tasks-board', 'act', 'task-id-7', { name: 'Alpha Note' }), { ok: true });
  assert.deepEqual(Object.keys(log.lines[0][1]), ['surface', 'action']);
  assert.equal(JSON.stringify(log.lines).includes('task-id-7') || JSON.stringify(log.lines).includes('Alpha'), false);
  // the later dishes' surfaces (crew, crew-start, vault-desk, vault-desk-capture) get the same shape: a skill or note name in the action slot is refused
  for (const s of useLog.SURFACES.filter((x) => /^(crew|vault-desk)/.test(x))) {
    for (const bad of ['example-skill-name', 'Alpha Note.md', 'plugin:example-skill']) assert.equal(typeof u.mark(s, bad).error, 'string', s + ' / ' + bad);
  }
  for (const s of ['example-skill-name', 'Alpha Note']) assert.equal(typeof u.mark(s, 'act').error, 'string');
});

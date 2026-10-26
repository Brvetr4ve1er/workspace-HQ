import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { loginItemPlan, init } = createRequire(import.meta.url)('./login-item.js');

const EXE = 'C:/apps/electron.exe', APP = 'C:/apps/hq/dashboard';

test('unpackaged: electron.exe + the app folder + --hidden', () => {
  assert.deepEqual(loginItemPlan({ isPackaged: false, argv: [EXE, '.', '--hidden'], execPath: EXE, appPath: APP }), { openAtLogin: true, path: EXE, args: [APP, '--hidden'] });
});

test('packaged: the app itself with --hidden', () => {
  assert.deepEqual(loginItemPlan({ isPackaged: true, argv: ['hq.exe'], execPath: 'hq.exe', appPath: 'x' }), { openAtLogin: true, args: ['--hidden'] });
});

test('test and preview instances never register', () => {
  const base = { isPackaged: false, execPath: EXE, appPath: APP };
  assert.equal(loginItemPlan({ ...base, argv: [EXE, '.', '--user-data-dir=C:/tmp/gate'] }), null);
  assert.equal(loginItemPlan({ ...base, argv: [EXE, '.', '--selftest'] }), null);
  assert.equal(loginItemPlan({ ...base, argv: [EXE, '.'], env: { HQ_NO_LOGIN_ITEM: '1' } }), null);
  assert.equal(loginItemPlan({ ...base, argv: [EXE, '.'], env: { HQ_V5_PROFILE: 'C:/tmp/p' } }), null);
  assert.equal(loginItemPlan({ isPackaged: false, argv: [] }), null);
});

test('init applies the plan; a failing setLoginItemSettings is logged, not thrown', () => {
  const calls = [];
  const app = { isPackaged: true, getAppPath: () => APP, setLoginItemSettings: (p) => calls.push(p) };
  assert.deepEqual(init({ app, argv: ['hq.exe'], env: {} }), { openAtLogin: true, args: ['--hidden'] });
  assert.equal(calls.length, 1);
  const errs = [];
  const bad = { ...app, setLoginItemSettings: () => { throw new Error('denied'); } };
  assert.equal(init({ app: bad, argv: ['hq.exe'], env: {}, log: { error: (m) => errs.push(m) } }), null);
  assert.match(errs[0], /denied/);
  assert.equal(init({ app, argv: ['hq.exe', '--selftest'], env: {} }), null);
  assert.equal(calls.length, 1);
});

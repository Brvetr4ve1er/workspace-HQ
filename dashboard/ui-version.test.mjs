// node --test dashboard/ui-version.test.mjs — the renderer switch main.js createWindow() uses.
// v5 is the app; v2–v4 live in legacy/ and load only when data/.ui-version (or HQ_UI_VERSION
// for one launch) says exactly so. Flag files here are temp files, never the real data/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { resolveUiVersion, rendererPage, isLegacy, DEFAULT_UI } = require('./ui-version.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// a reader over a real temp file, the way main.js reads data/.ui-version
function flagDir(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-uiv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.ui-version');
  if (content !== undefined) fs.writeFileSync(file, content);
  return { file, readFlag: () => fs.readFileSync(file, 'utf8') };
}

test('a missing, unreadable or empty flag file loads v5', (t) => {
  assert.equal(DEFAULT_UI, 'v5');
  assert.equal(resolveUiVersion({ env: {}, readFlag: flagDir(t).readFlag }), 'v5', 'missing file');
  const dir = flagDir(t);
  fs.mkdirSync(dir.file);   // a directory where the file should be: EISDIR on read
  assert.equal(resolveUiVersion({ env: {}, readFlag: dir.readFlag }), 'v5', 'unreadable');
  assert.equal(resolveUiVersion({ env: {}, readFlag: flagDir(t, '').readFlag }), 'v5', 'empty');
  assert.equal(resolveUiVersion({ env: {}, readFlag: flagDir(t, '  \r\n').readFlag }), 'v5', 'whitespace only');
  assert.equal(resolveUiVersion(), 'v5', 'no arguments at all');
  assert.equal(resolveUiVersion({ env: {} }), 'v5', 'no reader');
});

test('only exactly v2..v5 in the file is honoured; anything else loads v5', (t) => {
  for (const v of ['v2', 'v3', 'v4', 'v5']) assert.equal(resolveUiVersion({ env: {}, readFlag: flagDir(t, v).readFlag }), v);
  for (const junk of ['V3', 'v1', 'v6', 'v33', '3', 'v3 rollback', 'legacy', '{"v":"v3"}', 'v 3']) {
    assert.equal(resolveUiVersion({ env: {}, readFlag: flagDir(t, junk).readFlag }), 'v5', JSON.stringify(junk));
  }
});

test('surrounding whitespace, CRLF and a BOM around a valid value are tolerated', (t) => {
  assert.equal(resolveUiVersion({ env: {}, readFlag: flagDir(t, '\nv3').readFlag }), 'v3', 'leading newline');
  assert.equal(resolveUiVersion({ env: {}, readFlag: flagDir(t, 'v3\r\n').readFlag }), 'v3', 'CRLF (Set-Content)');
  assert.equal(resolveUiVersion({ env: {}, readFlag: flagDir(t, '﻿v4').readFlag }), 'v4', 'UTF-8 BOM');
  assert.equal(resolveUiVersion({ env: {}, readFlag: flagDir(t, ' v2 ').readFlag }), 'v2', 'spaces');
});

test('HQ_UI_VERSION overrides the file for one launch only when it is valid', (t) => {
  const v3 = flagDir(t, 'v3').readFlag;
  assert.equal(resolveUiVersion({ env: { HQ_UI_VERSION: 'v5' }, readFlag: v3 }), 'v5');
  assert.equal(resolveUiVersion({ env: { HQ_UI_VERSION: 'v2' }, readFlag: flagDir(t).readFlag }), 'v2', 'override with no file');
  for (const bad of ['v9', 'V5', ' v5', 'v5\n', '']) {
    assert.equal(resolveUiVersion({ env: { HQ_UI_VERSION: bad }, readFlag: v3 }), 'v3', `invalid override ${JSON.stringify(bad)} falls through to the file`);
  }
  assert.equal(resolveUiVersion({ env: { HQ_UI_VERSION: 'v9' }, readFlag: flagDir(t).readFlag }), 'v5', 'invalid override + no file');
});

test('rendererPage: v5 is dashboard-v5, v2..v4 are legacy/dashboard-vN, and every page exists', () => {
  assert.equal(rendererPage(REPO, 'v5'), path.join(REPO, 'dashboard-v5', 'index.html'));
  for (const v of ['v2', 'v3', 'v4']) {
    assert.equal(isLegacy(v), true);
    assert.equal(rendererPage(REPO, v), path.join(REPO, 'legacy', `dashboard-${v}`, 'index.html'));
  }
  assert.equal(isLegacy('v5'), false);
  // defensive: a value that slipped past resolveUiVersion never builds a path from it
  for (const odd of ['v6', '../x', '', undefined]) {
    assert.equal(isLegacy(odd), false);
    assert.equal(rendererPage(REPO, odd), path.join(REPO, 'dashboard-v5', 'index.html'));
  }
  // rollback stays one command only while the quarantined pages are on disk
  for (const v of ['v2', 'v3', 'v4', 'v5']) assert.ok(fs.existsSync(rendererPage(REPO, v)), `missing ${rendererPage(REPO, v)}`);
});

test('main.js loads the main window through this module (no second copy of the rule)', () => {
  const src = fs.readFileSync(path.join(HERE, 'main.js'), 'utf8');
  assert.match(src, /require\('\.\/ui-version'\)/);
  assert.match(src, /win\.loadFile\(uiSwitch\.rendererPage\(SCAN_DIR, uiv\)\)/);
  assert.doesNotMatch(src, /\/\^v\[2-5\]\$\//, 'the version rule lives in ui-version.js only');
});

// The repo is PUBLIC and data/ is NOT ignored wholesale: each owner data file needs its own .gitignore line.
// The money space once shipped trusting "data/ is already ignored" — it wasn't. This pins every owner path.
//   node --test tools/gitignore-owner-data.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_DATA = [
  'data/latest.json', 'data/browser-activity.json', 'data/.bridge-token', 'data/spell-telemetry.json',
  'data/claude/hub.sqlite', 'data/social/outbox.json',
  'data/money/state.json', 'data/money/state.json.corrupt', 'data/money/meta.json',
  'data/brief.json', 'data/brief-state.json',
  'dashboard/data.js',
];

test('every owner data path is gitignored (public repo)', () => {
  const r = spawnSync('git', ['check-ignore', '--no-index', ...OWNER_DATA], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.notEqual(r.status, 128, 'git check-ignore failed to run: ' + r.stderr);
  const ignored = new Set(r.stdout.split(/\r?\n/).filter(Boolean));
  const exposed = OWNER_DATA.filter((p) => !ignored.has(p));
  assert.deepEqual(exposed, [], 'NOT ignored — add a .gitignore line: ' + exposed.join(', '));
});

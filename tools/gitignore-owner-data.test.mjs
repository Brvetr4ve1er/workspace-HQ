// The repo is PUBLIC and data/ is NOT ignored wholesale: each owner data file needs its own .gitignore line.
// The money space once shipped trusting "data/ is already ignored" — it wasn't. This pins every owner path.
// Atomic writers leave <name>.<pid>.tmp behind when they crash, so each pattern is also pinned with one temp name
// (kitchen batch 1, 2026-11-07).
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
  // kitchen batch 1 (2026-11-07): patterns, so one temp name each
  'data/.bridge-token.1234.tmp', 'data/brief.json.1234.tmp', 'data/brief-state.json.1234.tmp',
  'data/.bridge-pairing.json', 'data/.bridge-pairing.json.1234.tmp',
  'data/assistant-audit.jsonl', 'data/assistant-audit.jsonl.1', 'data/assistant-audit.jsonl.1234.tmp',
  'data/.refresh.lock', 'data/.refresh.lock.1', 'data/.refresh.lock.1234.tmp',
  'data/delivery.json', 'data/delivery.json.corrupt', 'data/delivery.json.corrupt-2', 'data/delivery.json.1234.tmp',
  'data/delivery/checks/x.json', 'data/delivery/checks/x.json.1234.tmp', 'data/delivery/shots/x-1.png',
  'data/cosmos/library.json', 'data/cosmos/curation.json', 'data/cosmos/curation.json.prev', 'data/cosmos/cleanup.json',
  'data/cosmos/config.json', 'data/cosmos/thumbs/x.jpg', 'data/cosmos/imports/x.png', 'data/cosmos/clips/x.png',
  // batch 3 (2026-11-11): one temp name each; clips.json and clip-<hash>.<ext> sit under data/cosmos/ (already ignored)
  'data/cosmos/clips.json', 'data/cosmos/imports/clip-0123456789ab.png', 'data/cosmos/.grab-tmp/x.part',
  'data/today.json', 'data/today.json.1234.tmp', 'data/brief-ledger.json', 'data/brief-ledger.json.corrupt', 'data/brief-ledger.json.1234.tmp',
  'data/disk-history.json', 'data/disk-history.json.1234.tmp', 'data/intents/x.json', 'data/intents/x.json.1234.tmp',
  // batch 4 (2026-11-11): the Security space; one temp name each
  'data/security/map.json', 'data/security/map.json.1234.tmp', 'data/security/owner.json', 'data/security/owner.json.1234.tmp',
  'data/security/settings.json', 'data/security/settings.json.1234.tmp', 'data/security/status.json', 'data/security/status.json.1234.tmp',
  'data/security/snapshots.jsonl', 'data/security/snapshots.jsonl.1234.tmp',
];

test('every owner data path is gitignored (public repo)', () => {
  const r = spawnSync('git', ['check-ignore', '--no-index', ...OWNER_DATA], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.notEqual(r.status, 128, 'git check-ignore failed to run: ' + r.stderr);
  const ignored = new Set(r.stdout.split(/\r?\n/).filter(Boolean));
  const exposed = OWNER_DATA.filter((p) => !ignored.has(p));
  assert.deepEqual(exposed, [], 'NOT ignored — add a .gitignore line: ' + exposed.join(', '));
});

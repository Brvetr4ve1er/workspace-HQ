// dashboard-v5/src/selftest-keys.test.mjs — every storage key the renderer writes is snapshotted and restored by the selftest
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const files = ['logic', 'live', 'vals'].flatMap((d) => fs.readdirSync(path.join(SRC, d)).filter((f) => /\.(m?js)$/.test(f) && !/\.test\./.test(f)).map((f) => path.join(SRC, d, f)));
test('selftest LOCAL_KEYS/SESSION_KEYS cover every storage key in the renderer', () => {
  const self = fs.readFileSync(path.join(SRC, 'selftest.js'), 'utf8');
  const listed = new Set([...self.matchAll(/(?:LOCAL_KEYS|SESSION_KEYS) = \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])));
  const used = new Set();
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:local|session)Storage\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/_KEY\s*=\s*'((?:hq|whq3)-[a-z0-9-]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.has('hq-claude-lib'));
  const missing = [...used].filter((k) => !listed.has(k));
  assert.deepEqual(missing, [], 'add to selftest.js LOCAL_KEYS/SESSION_KEYS: ' + missing.join(', '));
});

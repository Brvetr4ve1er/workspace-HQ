// node --test tools/readme-mcp-caveat.test.mjs — the README must not hand the owner the user-scope registration line
// without saying the nightly claude -p runs are still not isolated from it (batch 6 taster finding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readme = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'README.md'), 'utf8');

test('the claude mcp add step carries the not-isolated caveat right under it', () => {
  const at = readme.indexOf('claude mcp add --scope user workspacehq');
  assert.ok(at > 0, 'the paste-yourself command is in the README');
  const near = readme.slice(at, at + 700);
  assert.match(near, /not isolated/i);
  assert.match(near, /do not expect isolation/i);
});

test('the isolation paragraph says plainly that the collector runs do not pass the flags yet', () => {
  assert.match(readme, /today they do NOT/);
  assert.doesNotMatch(readme, /they should pass `--strict-mcp-config/);
});

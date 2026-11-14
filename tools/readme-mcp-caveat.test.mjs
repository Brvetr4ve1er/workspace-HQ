// node --test tools/readme-mcp-caveat.test.mjs — the README must say, right under the user-scope registration line, whether the
// nightly claude -p runs are isolated from it; since the collector one-liners landed (2026-11-14) it must say they ARE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readme = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'README.md'), 'utf8');

test('the claude mcp add step says the nightly runs are isolated, right under it', () => {
  const at = readme.indexOf('claude mcp add --scope user workspacehq');
  assert.ok(at > 0, 'the paste-yourself command is in the README');
  const near = readme.slice(at, at + 700);
  assert.match(near, /are isolated from this registration/);
  assert.doesNotMatch(near, /not isolated|do not expect isolation/i);
});

test('the isolation paragraph names both collector files and no longer calls them a todo', () => {
  assert.match(readme, /Both pass `--strict-mcp-config --mcp-config <abs path>`/);
  assert.ok(readme.includes('collector/enrich.mjs'));
  assert.ok(readme.includes('collector/weekly-narrator.mjs'));
  assert.doesNotMatch(readme, /today they do NOT/);
});

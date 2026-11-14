// node --test tools/nightly-isolation.test.mjs
// Guard for the two unattended `claude -p` spawns the nightly run makes (collector/enrich.mjs, collector/weekly-narrator.mjs):
// they must not load the owner's user-scope MCP tools. The fix is the same one-liner at each site: '--strict-mcp-config',
// '--mcp-config', <absolute path of tools/empty-mcp.json> (a file, not inline JSON: enrich's claude.cmd fallback goes through
// cmd.exe, where braces and quotes are fragile). The collector/ files belong to the structure lane, so until that struct: commit
// lands this guard reports a todo; once ONE site names the flag, BOTH must, and the json file must keep its exact shape.
// Read-only: this test never edits a collector file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const EMPTY = path.join(here, 'empty-mcp.json');
const SITES = ['collector/enrich.mjs', 'collector/weekly-narrator.mjs'];

// The text of every `spawnSync(` call in `src` whose argument list names '-p' (the unattended claude print mode).
function claudePrintSpawns(src) {
  const found = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf('spawnSync(', from);
    if (at < 0) break;
    let depth = 0, end = -1, quote = null;
    for (let i = at + 'spawnSync'.length; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) break;
    const call = src.slice(at, end + 1);
    if (/['"]-p['"]/.test(call)) found.push(call);
    from = end + 1;
  }
  return found;
}

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('tools/empty-mcp.json parses to exactly {mcpServers:{}}', () => {
  const parsed = JSON.parse(fs.readFileSync(EMPTY, 'utf8'));
  assert.deepEqual(parsed, { mcpServers: {} });
});

test('the guard can see both claude -p spawn sites (a moved spawn must not quietly turn the guard into a no-op)', () => {
  for (const rel of SITES) {
    const sites = claudePrintSpawns(read(rel));
    assert.equal(sites.length, 1, rel + ': expected exactly one spawnSync(... \'-p\' ...) site, found ' + sites.length + '; update this guard if the spawn moved');
  }
});

test('claudePrintSpawns reads a call with nested parens and quotes, and ignores a spawn without -p', () => {
  const src = "const a = spawnSync(x(1), ['-p', '--model', M], { input: f('a)b') });\nconst b = spawnSync('git', ['status']);";
  const calls = claudePrintSpawns(src);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('spawnSync(x(1)'));
});

test('both nightly claude -p spawns load no user-scope tools (or: reported as todo until the struct: commit lands)', (t) => {
  const named = SITES.map((rel) => {
    const src = read(rel);
    const call = claudePrintSpawns(src)[0] || '';
    // the flags may be written at the call or built into the args just above it, so look at the call, then at the whole file
    return { rel, src, inCall: call.includes('--strict-mcp-config'), inFile: src.includes('--strict-mcp-config') };
  });
  const any = named.some((n) => n.inFile);
  if (!any) {
    t.todo('neither collector spawn names --strict-mcp-config yet: the struct: ask (enrich.mjs, weekly-narrator.mjs each gain \'--strict-mcp-config\', \'--mcp-config\', <abs path of tools/empty-mcp.json>) is open in HANDOFF');
    return;
  }
  for (const n of named) {
    assert.ok(n.inFile, n.rel + ': one site is isolated, so both must be; this one does not name --strict-mcp-config');
    assert.ok(n.src.includes('--mcp-config'), n.rel + ': --strict-mcp-config without --mcp-config would load no config at all');
    assert.ok(n.src.includes('empty-mcp.json'), n.rel + ': --mcp-config must point at tools/empty-mcp.json');
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(EMPTY, 'utf8')), { mcpServers: {} });
});

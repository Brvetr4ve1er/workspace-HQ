// Adds the optional SessionStart Brief line (tools/brief-lines.mjs) to the owner's Claude Code settings.
// The OWNER runs this themself; the app never calls it. Backs the file up first, touches only hooks.SessionStart,
// refuses to run on a file that is not valid JSON, and does nothing when the entry is already there.
//   node tools/add-brief-hook.mjs            (writes ~/.claude/settings.json)
//   node tools/add-brief-hook.mjs --dry-run  (prints what it would write)
//   node tools/add-brief-hook.mjs --file <path>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const fi = args.indexOf('--file');
const file = fi >= 0 ? args[fi + 1] : path.join(os.homedir(), '.claude', 'settings.json');
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'brief-lines.mjs').replace(/\\/g, '/');
const command = `node "${script}"`;

let raw = '{}';
if (fs.existsSync(file)) raw = fs.readFileSync(file, 'utf8');
let s;
try { s = JSON.parse(raw); } catch (e) { console.error('not changed: the settings file is not valid JSON (' + e.message + ')'); process.exit(1); }

s.hooks ??= {};
const list = (s.hooks.SessionStart ??= []);
if (list.some((g) => (g.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes('brief-lines.mjs')))) {
  console.log('already there: nothing changed');
  process.exit(0);
}
list.push({ hooks: [{ type: 'command', command }] });
const out = JSON.stringify(s, null, 2) + '\n';

if (dry) { console.log(out); process.exit(0); }
if (fs.existsSync(file)) {
  const bak = file + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, bak);
  console.log('backup: ' + bak);
}
fs.writeFileSync(file, out);
JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('added the SessionStart Brief line to ' + file);

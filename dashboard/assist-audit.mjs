// The assistant's one log, file half (spec: "assistant-rulebook"). data/assistant-audit.jsonl, one names-only JSON line per tool call
// (shape: assist-core.mjs auditEntry — never args, text, titles or paths). Every Claude session runs its own MCP process and the app/bridge
// can write too, so appends are single appendFileSync calls (one write per line) and readers tolerate torn lines.
//
//   auditPath(dataDir)                      → data/assistant-audit.jsonl
//   append(dataDir, entry)                  → true | false   (rotates first when the file is past 512 KB; never throws)
//   record(dataDir, fields)                 → the entry written, or null   (auditEntry() + append(); what the MCP guard and the bridge routes call)
//   read(dataDir)                           → { entries, skipped }   (the .1 generation first, then the live file; skipped = torn / foreign lines)
//   rotate(dataDir)                         → true | false   (live file → .1, replacing the older generation: exactly one kept)
//   rotateIfFull(dataDir)                   → true | false   (rotate() only if the live file is STILL past the limit: append's own check can be stale
//                                                             when another writer rotated in between, and renaming that writer's tiny new file
//                                                             over .1 would destroy the full older generation)
// Reachable from CommonJS with: import(pathToFileURL(path.join(__dirname, 'assist-audit.mjs')).href)
import fs from 'node:fs';
import path from 'node:path';
import { auditEntry, AUDIT_VERSION } from './assist-core.mjs';

export const FILE_NAME = 'assistant-audit.jsonl';
export const MAX_BYTES = 512 * 1024;

export const auditPath = (dataDir) => path.join(dataDir, FILE_NAME);

export function rotate(dataDir) {
  const file = auditPath(dataDir);
  try { fs.renameSync(file, file + '.1'); return true; }   // renameSync replaces an existing .1 on Windows and POSIX alike
  catch { return false; }                                    // another process rotated first, or nothing to rotate
}

export function rotateIfFull(dataDir) {
  try { if (fs.statSync(auditPath(dataDir)).size < MAX_BYTES) return false; } catch { return false; }   // looked again right before the rename
  return rotate(dataDir);
}

export function append(dataDir, entry) {
  try {
    const file = auditPath(dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
    try { if (fs.statSync(file).size >= MAX_BYTES) rotateIfFull(dataDir); } catch { /* no file yet */ }
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    return true;
  } catch { return false; }
}

export function record(dataDir, fields) {
  try {
    const entry = auditEntry(fields);
    return append(dataDir, entry) ? entry : null;
  } catch { return null; }
}

function parseFile(file, into) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }   // absent file = nothing yet
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e = null;
    try { e = JSON.parse(line); } catch { e = null; }
    if (e && typeof e === 'object' && e.v === AUDIT_VERSION && typeof e.tool === 'string' && typeof e.at === 'string') into.entries.push(e);
    else into.skipped += 1;
  }
}

export function read(dataDir) {
  const out = { entries: [], skipped: 0 };
  try {
    const file = auditPath(dataDir);
    parseFile(file + '.1', out);
    parseFile(file, out);
  } catch { /* never throws */ }
  return out;
}

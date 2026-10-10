'use strict';
// Durable JSON stores with the quarantine pattern: ENOENT → empty; a real IO
// error rethrows; a present-but-unparseable file is renamed to .corrupt and
// the empty value is used IN MEMORY ONLY — never silently written back over
// months of history. Writes are atomic (temp file + rename).
const fs = require('node:fs');
const path = require('node:path');

function readJsonStore(file, empty, log = console) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return { value: clone(empty), fresh: true }; throw err; }
  try { return { value: JSON.parse(raw), fresh: false }; }
  catch (err) {
    const q = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, q); } catch {}
    log.error(`[store] ${path.basename(file)} is not valid JSON; quarantined to ${path.basename(q)}`);
    return { value: clone(empty), fresh: false, quarantined: q };
  }
}

function writeJsonStore(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

module.exports = { readJsonStore, writeJsonStore };

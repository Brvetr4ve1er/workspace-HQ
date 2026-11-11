// machine history — main side, READ ONLY. IPC-CONTRACT row: hq:machine-history:read (invoke).
// System › Machine › "How the PC changed" asks once when the panel opens (never at boot) and again after a Re-examine.
//   read() → { ok:true, rows:[{ at, cpu, ram, diskFreeGB, startup, temp, pingMs, updateDays }], disk:{ lines:[{ label, deltaGB, days }], note },
//              counts:{ rows, dropped, diskDays } }
//          | { error }
//   - rows come from data/pc-health-history.json (the collector's rolling window; the structure lane owns it, this never writes it).
//     ABSENT = an honest empty answer (rows: []). An oversize or unreadable file is refused with words, not half-read.
//   - ONLY those eight fields are copied: gpuDriverDays, gpuTempC and battery are never returned (the GPU series flips between adapters
//     until the structure lane enumerates the GPU), and no path ever travels — the disk lines carry folder labels and GB only.
//   - the disk part reads data/disk-history.json (dashboard/disk-history.js is its only writer) without moving or fixing anything;
//     a problem there degrades the disk note, never the charts.
//   - `at` is passed through untouched (a zone-less LOCAL time string); the renderer parses it as local time.
//   init({ ipcMain, dataDir, fsMod?, diskHistory?, startDisk? }) → { read, disk }   registers the channel and, once, starts disk-history's ticks
//   (startup, every 6 h, and when pc-health-disk.json changes). The handler resolves a plain object and never throws.
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = 'pc-health-history.json';
const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 200;
const FIELDS = Object.freeze(['cpu', 'ram', 'diskFreeGB', 'startup', 'temp', 'pingMs', 'updateDays']);
const AT_RE = /^\d{4}-\d{2}-\d{2}/;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const DISK_NOTES = Object.freeze({
  corrupt: 'the folder history file could not be read, so nothing is compared',
  'too-big': 'the folder history file is too large to read, so nothing is compared',
  newer: 'the folder history file was written by a newer version of the app, so nothing is compared',
});

/** The eight fields of one history row, or null when it has no usable `at`. Nothing else is copied. */
function pickRow(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.at !== 'string') return null;
  const at = r.at.trim().slice(0, 40);
  if (!AT_RE.test(at)) return null;
  const out = { at };
  for (const k of FIELDS) out[k] = num(r[k]);
  return out;
}

function create({ dataDir, fsMod = fs, diskHistory } = {}) {
  const DH = diskHistory || require('./disk-history');
  const histFile = path.join(dataDir, HISTORY_FILE);
  const diskFile = path.join(dataDir, DH.FILE || 'disk-history.json');

  function readRows() {
    let size;
    try { size = fsMod.statSync(histFile).size; }
    catch (e) { if (e && e.code === 'ENOENT') return { rows: [], dropped: 0 }; return { error: 'could not read the machine history — ' + ((e && e.message) || e) }; }
    if (size > MAX_BYTES) return { error: 'the machine history file is over ' + Math.round(MAX_BYTES / 1024) + ' KB — not read' };
    let list;
    try { list = JSON.parse(fsMod.readFileSync(histFile, 'utf8')); }
    catch (e) { return { error: 'the machine history file is not valid JSON — ' + ((e && e.message) || e) }; }
    if (!Array.isArray(list)) return { error: 'the machine history file is not a list of checks' };
    const rows = [];
    let dropped = 0;
    for (const r of list.slice(-MAX_ROWS)) { const p = pickRow(r); if (p) rows.push(p); else dropped++; }
    return { rows, dropped };
  }

  function readDisk() {
    const s = DH.readStoreFile(fsMod, diskFile, { quarantine: false });   // read-only: this module never moves or rewrites the file
    if (s.state !== 'ok' && s.state !== 'absent') return { lines: [], note: DISK_NOTES[s.state] || DISK_NOTES.corrupt, days: 0 };
    const d = DH.diskLines(s.rows);
    return { lines: d.lines, note: d.note, days: s.rows.length };
  }

  function read() {
    try {
      const h = readRows();
      if (h.error) return { error: h.error };
      const d = readDisk();
      return { ok: true, rows: h.rows, disk: { lines: d.lines, note: d.note }, counts: { rows: h.rows.length, dropped: h.dropped, diskDays: d.days } };
    } catch (e) { return { error: 'could not read the machine history — ' + ((e && e.message) || e) }; }
  }

  return { read };
}

function init({ ipcMain, dataDir, fsMod, diskHistory, startDisk = true } = {}) {
  const DH = diskHistory || require('./disk-history');
  const m = create({ dataDir, fsMod, diskHistory: DH });
  let disk = null;
  if (startDisk) { try { disk = DH.init({ dataDir, fsMod }); } catch (e) { console.error('[machine-history] disk history did not start — ' + ((e && e.message) || e)); } }
  if (ipcMain && typeof ipcMain.handle === 'function') ipcMain.handle('hq:machine-history:read', async () => m.read());
  return { read: m.read, disk };
}

module.exports = { create, init, pickRow, FIELDS, HISTORY_FILE, MAX_BYTES, MAX_ROWS };

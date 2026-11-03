// Two-way daily-note sync: ticking a `- [x] wq:<quest-id>` line in any 10_Daily
// note completes that quest. Extracted from main.js (2026-10-31) so the
// debounce is testable: the old single shared timer meant note B changing
// within the window cancelled note A's pending read — A's ticks were silently
// dropped (routine, not exotic: assemble itself rewrites today's note, and sync
// or templater plugins touch other 10_Daily files). Debounce is PER FILE now.
// Program invariant: new main-side logic lives in a NEW file; main.js wires it.
const fs = require('node:fs');
const path = require('node:path');

function tickedIds(text, isDone) {
  const ids = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!/^\s*[->]?\s*[-*]?\s*\[[xX]\]/.test(line)) continue;
    const m = line.match(/wq:([A-Za-z0-9_-]+)/);
    if (m && !isDone(m[1])) ids.push(m[1]);
  }
  return ids;
}

// the scanner without the fs.watch plumbing — tests drive onEvent directly
function createScanner({ dir, readOverrides, applyDone, debounceMs = 1200, log = console.log, fsMod = fs }) {
  const timers = new Map();   // per-file timers — one shared timer dropped note A when note B changed inside the window
  function onEvent(file) {
    if (!file || !file.endsWith('.md')) return;
    clearTimeout(timers.get(file));
    timers.set(file, setTimeout(() => {
      timers.delete(file);
      let text = '';
      try { text = fsMod.readFileSync(path.join(dir, file), 'utf8'); } catch { return; }
      const ov = readOverrides();
      const ids = tickedIds(text, (id) => ov[id]?.status === 'done');
      if (ids.length) { log(`[daily-note] vault→app completion (${file}):`, ids.join(', ')); applyDone(ids); }
    }, debounceMs));
  }
  function close() { for (const t of timers.values()) clearTimeout(t); timers.clear(); }
  return { onEvent, close };
}

// main.js hook: returns the FSWatcher (or null — a missing dir / watch failure
// is logged, never thrown, exactly like the old inline version)
function watch(opts) {
  const fsMod = opts.fsMod || fs;
  if (!fsMod.existsSync(opts.dir)) return null;
  const scanner = createScanner(opts);
  try {
    const w = fsMod.watch(opts.dir, (_evt, file) => scanner.onEvent(file));
    w.on('close', () => scanner.close());   // no stray timers after before-quit closes the watcher
    return w;
  } catch (e) { (opts.error || console.error)('watchDailyNotes failed:', e); return null; }
}

module.exports = { watch, createScanner, tickedIds };

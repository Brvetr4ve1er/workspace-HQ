// Brief ledger, main side (dish brief-history, batch 3; engine: brief-ledger.mjs). Keeps data/brief-ledger.json, the small file that remembers what the
// Brief noticed and how each thing ended (resolved, dismissed, acted on, changed, or went silent), and serves the two IPC channels:
//   hq:brief-history:read  () → { entries:[{ text, rule, severity, first, ended|null, how, after }], clearedThisWeek, dismissedThisWeek,
//                                 allClear: null | { since, resolved:[{ text, after, how, ended }] }, notice }
//   hq:brief-history:ack   () → { ok:true, acked }   records the all-clear card as shown; the ONLY write the renderer can cause (a no-op while no card is due)
//
// create({ dataDir, now? }) → { observe(brief, { dismissedKeys, errors }), read(brief), ack(brief), registerIpc(ipcMain, getBrief), load(), files:{ ledgerFile } }
//   brief.js compute() calls `await ledger.observe(brief, { dismissedKeys: st.dismissed, errors })` after the data/brief.json write (so a failed write reaches it as the brief error source), and its init() calls
//   ledger.registerIpc(ipcMain, () => b.current()), so main.js only passes the ledger into the existing briefApi init call.
//   observe never throws at the caller. The first observe of this process is the cold start (nothing closes). A write failure keeps the ledger in memory and
//   is said in read().notice; a file that cannot be read is moved to brief-ledger.json.corrupt (never emptied silently) and the notice says so.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let core = null;
const lib = () => core || (core = import(pathToFileURL(path.join(__dirname, 'brief-ledger.mjs')).href));
const msg = (e) => String((e && e.message) || e).slice(0, 200);

function writeAtomic(file, value) {
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* never created */ }
    throw e;
  }
}

function create({ dataDir, now = () => new Date() }) {
  const ledgerFile = path.join(dataDir, 'brief-ledger.json');
  let cur = null;           // the ledger in memory (loaded lazily, once)
  let saved = null;         // the text last written / read, so an unchanged ledger is not rewritten
  let cold = true;          // the next observe is the first of this process
  let notice = '';          // main's own words about the file: set aside, or could not be written

  // a file that cannot be used is moved aside, never overwritten in place: the next save starts from an empty ledger and the old text survives
  function setAside(why) {
    let dest = ledgerFile + '.corrupt';
    try { if (fs.existsSync(dest)) dest = ledgerFile + '.corrupt.' + now().getTime(); fs.renameSync(ledgerFile, dest); notice = 'The Brief history file was ' + why + ' and was set aside as ' + path.basename(dest) + '; a new one was started.'; }
    catch (e) { notice = 'The Brief history file was ' + why + ' and could not be set aside (' + msg(e) + '); it is not being read.'; }
  }

  async function load() {
    if (cur) return cur;
    const L = await lib();
    let raw = null;
    try { raw = fs.readFileSync(ledgerFile, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') notice = 'The Brief history file could not be read (' + msg(e) + ').'; }
    if (raw === null) { cur = L.emptyLedger(); saved = null; return cur; }
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== L.LEDGER_V) {
      setAside(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.v !== L.LEDGER_V ? 'from a different version' : 'unreadable');
      cur = L.emptyLedger(); saved = null; return cur;
    }
    cur = L.cleanLedger(parsed, now());
    saved = raw;
    return cur;
  }

  function save(ledger) {
    const text = JSON.stringify(ledger, null, 1);
    if (text === saved) return true;
    try { writeAtomic(ledgerFile, ledger); saved = text; if (notice.startsWith('The Brief history could not be saved')) notice = ''; return true; }
    catch (e) { notice = 'The Brief history could not be saved (' + msg(e) + '); it is kept for this session only.'; return false; }
  }

  async function observe(brief, opts) {
    try {
      const L = await lib();
      const o = opts && typeof opts === 'object' ? opts : {};
      const ledger = await load();
      const r = L.observe(ledger, brief, { now: now(), dismissedKeys: o.dismissedKeys, errors: o.errors, coldStart: cold });
      cold = false;
      cur = r.ledger;
      save(cur);
      return { ok: true, opened: r.opened, closed: r.closed };
    } catch (e) { return { ok: false, error: msg(e) }; }
  }

  async function read(brief) {
    try {
      const L = await lib();
      const ledger = await load();
      return { ...L.summarize(ledger, brief || null, { now: now() }), notice };
    } catch (e) { return { error: msg(e) }; }
  }

  async function ack(brief) {
    try {
      const L = await lib();
      const ledger = await load();
      if (!L.allClearOf(ledger, brief || null, { now: now() })) return { ok: true, acked: false };   // no card is due: nothing to record
      cur = L.markShown(ledger, now());
      if (!save(cur)) return { error: notice || 'The Brief history could not be saved.' };
      return { ok: true, acked: true };
    } catch (e) { return { error: msg(e) }; }
  }

  function registerIpc(ipcMain, getBrief) {
    const brief = () => { try { return typeof getBrief === 'function' ? getBrief() || null : null; } catch { return null; } };
    ipcMain.handle('hq:brief-history:read', () => read(brief()));
    ipcMain.handle('hq:brief-history:ack', () => ack(brief()));
  }

  return { observe, read, ack, load, registerIpc, files: { ledgerFile } };
}

module.exports = { create };

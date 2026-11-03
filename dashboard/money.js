// money space — main side. Owner money data lives in <dataDir>/money/state.json (gitignored).
// IPC-CONTRACT rows: hq:money:read · hq:money:apply · hq:money:import · hq:money:export.
// The domain logic is Ember's, ported to ESM in ./money/*.mjs and reached through import()
// (Electron 32 cannot require ESM — same idiom as claude-prompts.js / claude-imports.js).
//
// init({ ipcMain, dataDir, getWin }) → { read, apply }   (read/apply exported for tests + MCP later)
// - the renderer sends INTENTS, never entities; commands.mjs validates every field and mints
//   ids/timestamps here. Unknown intent types are refused before any IO.
// - every handler resolves { view, note? } or { error } — never throws at the renderer.
// - writes are synchronous tmp + rename inside one handler tick, so two applies serialize on the
//   event loop and a crash mid-write leaves the previous file intact.
// - a corrupt state.json is quarantined to state.json.corrupt (readJsonStore idiom), never overwritten.
// - NO window reload after a write: the reply carries the fresh view, the renderer swaps it in.
// - no network, nothing outbound. import/export only touch a file the owner picked in a native dialog.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_INTENT_BYTES = 64 * 1024;
let libs = null;   // { store, commands, view } once loaded
async function lib() {
  if (!libs) {
    const load = (f) => import(pathToFileURL(path.join(__dirname, 'money', f)).href);
    const [store, commands, view] = await Promise.all([load('store.mjs'), load('commands.mjs'), load('view.mjs')]);
    libs = { store, commands, view };
  }
  return libs;
}

function create({ dataDir, now = () => new Date(), newId = () => crypto.randomUUID(), pick = null }) {
  const dir = path.join(dataDir, 'money'), file = path.join(dir, 'state.json');

  function readState(L) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return L.store.defaultState(); throw e; }
    try { return L.store.sanitizeState(JSON.parse(raw)); }
    catch (e) {
      try { fs.renameSync(file, file + '.corrupt'); } catch { /* best effort — never throw from a read */ }
      console.error(`[money] corrupt state.json quarantined to state.json.corrupt — ${e.message}`);
      return L.store.defaultState();
    }
  }
  function writeState(state) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, file);
  }
  const reply = (L, state, note) => ({ view: L.view.buildView(state, now()), ...(note ? { note } : {}) });

  async function read() {
    const L = await lib();
    try { return reply(L, readState(L)); }
    catch (e) { return { error: 'could not read money data — ' + e.message }; }
  }

  async function apply(intent) {
    const L = await lib();
    // cheap checks before any IO: shape, size, allowlisted type
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return { error: 'unknown action.' };
    let size = 0; try { size = JSON.stringify(intent).length; } catch { return { error: 'unknown action.' }; }
    if (size > MAX_INTENT_BYTES || !L.commands.INTENTS.includes(intent.type)) return { error: 'unknown action.' };
    let state;
    try { state = readState(L); } catch (e) { return { error: 'could not read money data — ' + e.message }; }
    let r;
    try { r = L.commands.apply(state, intent, { now: now(), newId }); }
    catch (e) { return { error: e instanceof L.commands.MoneyError ? e.message : 'that did not work — ' + e.message }; }
    try { writeState(r.state); } catch (e) { return { error: 'not saved — could not write money data: ' + e.message }; }
    return reply(L, r.state, r.note);
  }

  async function importFile() {
    const L = await lib();
    let f; try { f = pick ? await pick('open') : null; } catch { return { error: 'could not open the file dialog' }; }
    if (!f) return { canceled: true };
    let raw;
    try {
      if (fs.statSync(f).size > MAX_IMPORT_BYTES) return { error: 'that file is too big to be an Ember export.' };
      raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch { return { error: 'that file is not an Ember export (could not read it as JSON).' }; }
    const incoming = L.store.sanitizeState(raw);
    const found = incoming.transactions.length + incoming.money.accounts.length + incoming.money.obligations.length + incoming.money.jars.length;
    if (!found) return { error: 'nothing to import — no accounts, bills, jars or entries in that file.' };
    let state; try { state = readState(L); } catch (e) { return { error: 'could not read money data — ' + e.message }; }
    const merged = L.store.mergeState(state, incoming);
    try { writeState(merged); } catch (e) { return { error: 'not imported — could not write money data: ' + e.message }; }
    const added = merged.transactions.length - state.transactions.length;
    return reply(L, merged, `imported from ${path.basename(f)} · ${added} new entr${added === 1 ? 'y' : 'ies'}`);
  }

  async function exportFile() {
    const L = await lib();
    let state; try { state = readState(L); } catch (e) { return { error: 'could not read money data — ' + e.message }; }
    let f; try { f = pick ? await pick('save') : null; } catch { return { error: 'could not open the file dialog' }; }
    if (!f) return { canceled: true };
    try { fs.writeFileSync(f, JSON.stringify(state, null, 1)); } catch (e) { return { error: 'not exported — ' + e.message }; }
    return { note: `exported to ${path.basename(f)}` };
  }

  return { read, apply, importFile, exportFile, file };
}

function dialogPicker(getWin) {
  return async (mode) => {
    const { dialog, app } = require('electron');
    const win = getWin && getWin();
    const filters = [{ name: 'Money data (.json)', extensions: ['json'] }];
    if (mode === 'open') {
      const opts = { title: 'Import money data (an Ember export or a money export)', properties: ['openFile'], filters };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r && !r.canceled && r.filePaths && r.filePaths[0] ? r.filePaths[0] : null;
    }
    const opts = { title: 'Export money data', defaultPath: path.join(app.getPath('documents'), `money-${new Date().toISOString().slice(0, 10)}.json`), filters };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    return r && !r.canceled && r.filePath ? r.filePath : null;
  };
}

function init({ ipcMain, dataDir, getWin }) {
  const gateFile = process.env.HQ_MONEY_IMPORT_FILE;   // gates only: no dialog in a hidden second instance
  const m = create({ dataDir, pick: gateFile ? async (mode) => (mode === 'open' ? gateFile : null) : dialogPicker(getWin) });
  ipcMain.handle('hq:money:read', () => m.read());
  ipcMain.handle('hq:money:apply', (_e, intent) => m.apply(intent));
  ipcMain.handle('hq:money:import', () => m.importFile());
  ipcMain.handle('hq:money:export', () => m.exportFile());
  return { read: m.read, apply: m.apply };
}

module.exports = { create, init };

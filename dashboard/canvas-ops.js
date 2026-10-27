// Claude › Canvas Remove, ＋ Board, Clear board (IPC-CONTRACT 2026-10-27 Canvas Remove + stat card; ＋ Board and Clear board).
// hq:canvas-remove(board, id) → {ok, board, id, edges} | {error}
//   Drops ONE node from data/canvas/<board>.canvas and every edge that touches it. The node and its edges are
//   appended to data/canvas/removed.jsonl BEFORE the board is rewritten, so a removal can be put back by hand.
//   Same serialization as hq:canvas-add (JSON.stringify(board, null, 1), tmp + rename); the board watcher pushes.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CANVAS_NAME_RE = /^[\w][\w -]{0,63}$/;   // the hq:canvas-add rule: no dots, no separators
const WIN_DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function createCanvasRemove(canvasDir, now = () => new Date()) {
  return function canvasRemove(board, id) {
    const name = String(board || '');
    if (badName(name)) return { error: 'bad board name' };
    const nodeId = typeof id === 'string' ? id : '';
    if (!nodeId || nodeId.length > 120) return { error: 'node id required' };
    const file = path.join(canvasDir, name + '.canvas');
    let b;
    try { b = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { error: 'no board named ' + name }; }
    if (!b || !Array.isArray(b.nodes)) return { error: 'no board named ' + name };
    const node = b.nodes.find((n) => n && String(n.id) === nodeId);
    if (!node) return { error: 'unknown node' };
    const edges = Array.isArray(b.edges) ? b.edges : [];
    const touches = (e) => e && (String(e.fromNode) === nodeId || String(e.toNode) === nodeId);
    const gone = edges.filter(touches);
    const next = Object.assign({}, b, { nodes: b.nodes.filter((n) => n !== node), edges: edges.filter((e) => !touches(e)) });
    try {
      fs.appendFileSync(path.join(canvasDir, 'removed.jsonl'), JSON.stringify({ at: now().toISOString(), board: name, node, edges: gone }) + '\n');
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(next, null, 1));
      fs.renameSync(tmp, file);
    } catch (e) { return { error: 'write failed: ' + String((e && e.message) || e).slice(0, 200) }; }
    return { ok: true, board: name, id: nodeId, edges: gone.length };
  };
}

const badName = (name) => !CANVAS_NAME_RE.test(name) || WIN_DEVICE_RE.test(name.replace(/[ .]+$/, ''));

// hq:canvas-create(board) → {ok, board} | {error}: a new empty board, never over an existing one
// (case-insensitive: on Windows "Ideas" and "ideas" are the same file)
function createCanvasCreate(canvasDir) {
  return function canvasCreate(board) {
    const name = String(board || '');
    if (badName(name)) return { error: 'bad board name' };
    let have = [];
    try { have = fs.readdirSync(canvasDir).filter((f) => f.endsWith('.canvas')).map((f) => f.slice(0, -7).toLowerCase()); } catch { /* no dir yet */ }
    if (have.includes(name.toLowerCase())) return { error: 'a board named ' + name + ' already exists' };
    const file = path.join(canvasDir, name + '.canvas');
    try {
      fs.mkdirSync(canvasDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ nodes: [], edges: [] }, null, 1), { flag: 'wx' });   // wx: never over a file that appeared meanwhile
    } catch (e) { return { error: e && e.code === 'EEXIST' ? 'a board named ' + name + ' already exists' : 'write failed: ' + String((e && e.message) || e).slice(0, 200) }; }
    return { ok: true, board: name };
  };
}

// hq:canvas-clear(board) → {ok, board, nodes, edges} | {error}: every node and edge to removed.jsonl, then an empty board
function createCanvasClear(canvasDir, now = () => new Date()) {
  return function canvasClear(board) {
    const name = String(board || '');
    if (badName(name)) return { error: 'bad board name' };
    const file = path.join(canvasDir, name + '.canvas');
    let b;
    try { b = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { error: 'no board named ' + name }; }
    if (!b || !Array.isArray(b.nodes)) return { error: 'no board named ' + name };
    const edges = Array.isArray(b.edges) ? b.edges : [];
    try {
      fs.appendFileSync(path.join(canvasDir, 'removed.jsonl'), JSON.stringify({ at: now().toISOString(), board: name, cleared: true, nodes: b.nodes, edges }) + '\n');
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.assign({}, b, { nodes: [], edges: [] }), null, 1));
      fs.renameSync(tmp, file);
    } catch (e) { return { error: 'write failed: ' + String((e && e.message) || e).slice(0, 200) }; }
    return { ok: true, board: name, nodes: b.nodes.length, edges: edges.length };
  };
}

function init({ ipcMain, canvasDir }) {
  const remove = createCanvasRemove(canvasDir), create = createCanvasCreate(canvasDir), clear = createCanvasClear(canvasDir);
  ipcMain.handle('hq:canvas-remove', (_e, board, id) => remove(board, id));
  ipcMain.handle('hq:canvas-create', (_e, board) => create(board));
  ipcMain.handle('hq:canvas-clear', (_e, board) => clear(board));
  return { remove, create, clear };
}

module.exports = { createCanvasRemove, createCanvasCreate, createCanvasClear, init };

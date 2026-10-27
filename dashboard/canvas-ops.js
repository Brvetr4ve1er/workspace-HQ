// Claude › Canvas Remove (IPC-CONTRACT 2026-10-27 Canvas Remove + stat card).
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
    if (!CANVAS_NAME_RE.test(name) || WIN_DEVICE_RE.test(name.replace(/[ .]+$/, ''))) return { error: 'bad board name' };
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

function init({ ipcMain, canvasDir }) {
  const remove = createCanvasRemove(canvasDir);
  ipcMain.handle('hq:canvas-remove', (_e, board, id) => remove(board, id));
  return remove;
}

module.exports = { createCanvasRemove, init };

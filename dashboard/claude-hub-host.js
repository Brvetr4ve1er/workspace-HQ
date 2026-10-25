// dashboard/claude-hub-host.js
// Main-process side of the Claude Hub (spec §3.1, §6). Electron's Node 20 has no node:sqlite,
// so the index runs in dashboard/claude-hub/hub.mjs on the system Node (≥ 22.13). This module
// finds that Node, spawns the Hub, routes JSON-line requests with timeouts, restarts it with
// backoff, and forwards its events to the windows. It never lets a Hub failure throw into main.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const MIN = [22, 13];   // node:sqlite is unflagged from 22.13 (22.5–22.12 need --experimental-sqlite)
function nodeOk(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > MIN[0] || (maj === MIN[0] && min >= MIN[1]);
}
function findNode({ env = process.env, run = spawnSync } = {}) {
  for (const cmd of [env.HQ_HUB_NODE, 'node'].filter(Boolean)) {
    try {
      const r = run(cmd, ['-p', 'process.version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const v = String((r && r.stdout) || '').trim();
      if (r && r.status === 0 && /^v\d/.test(v)) return { cmd, version: v, ok: nodeOk(v) };
    } catch { /* try the next candidate */ }
  }
  return null;
}

const hubVaultDir = (env, vaultDir) => (env && env.HQ_VAULT_DIR) || vaultDir || null;
const errText = (e) => String((e && e.message) || e).slice(0, 300);

function create({ hubScript, dbFile, latestFile = null, vaultDir = null, env = process.env, spawnFn = spawn, findNodeFn = () => findNode({ env }), send = () => {}, log = null, backoff = [1000, 5000, 30000], stableMs = 60000 } = {}) {
  let child = null, state = 'idle', node = null, error = null, attempt = 0, restarts = 0, stopping = false, seq = 0, timer = null, readyAt = 0;
  const pending = new Map();
  const push = (event, data) => { try { send('hq:claude-hub:event', { event, data }); } catch { /* window gone */ } };
  // The lifecycle log (app-log.js) holds no personal data. Hub text (stderr, error messages) can carry paths and quoted
  // transcript fragments, so it goes in through log.error(), which redacts paths, URLs, addresses and quoted spans.
  const note = (name, fields, text) => { if (log) try { if (text) log.error(name, text, fields); else log.event(name, fields); } catch { /* logging only */ } };
  const failAll = (msg) => { for (const [, p] of pending) { clearTimeout(p.t); p.resolve({ error: msg }); } pending.clear(); };
  // A state the host will not leave on its own: say so to the windows (and the lifecycle log).
  const settle = (next) => {
    state = next;
    push('health', { state, node: node ? node.version : null, error });
    note('claude-hub-' + state, { node: node ? node.version : null }, error);
  };

  function start() {
    stopping = false; clearTimeout(timer); timer = null;
    try { node = findNodeFn(); } catch { node = null; }
    if (!node || !node.ok) {
      error = 'Claude Hub needs Node 22.13 or newer (found ' + (node ? node.version : 'none') + ')';
      settle('no-node');
      return;
    }
    state = 'starting';
    let c;
    try {
      try { fs.mkdirSync(path.dirname(dbFile), { recursive: true }); } catch { /* exists or unwritable: the hub reports it */ }
      c = spawnFn(node.cmd, ['--no-warnings', hubScript, '--db', dbFile, ...(latestFile ? ['--latest', latestFile] : []), ...(vaultDir ? ['--vault', vaultDir] : [])], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    } catch (e) {   // e.g. EINVAL when HQ_HUB_NODE is a .cmd shim: retrying cannot help
      error = errText(e);
      settle('down');
      return;
    }
    child = c;
    // A broken pipe on any of the three streams is an event on the stream: unhandled, it would throw into main.
    for (const s of [c.stdin, c.stdout, c.stderr]) if (s) s.on('error', () => {});

    const rl = readline.createInterface({ input: c.stdout });
    rl.on('line', (line) => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m && typeof m.id === 'number' && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.t);
        p.resolve(m.ok ? m.result : { error: m.error || 'hub error' });
        return;
      }
      if (m && m.event) {
        if (m.event === 'ready') { state = 'running'; readyAt = Date.now(); error = null; }   // `attempt` is reset only once it has stayed up (onGone)
        if (m.event === 'error' && m.data) error = String(m.data.message || '').slice(0, 300);
        push(m.event, m.data);
      }
    });
    c.stderr.on('data', (d) => { note('claude-hub-stderr', undefined, String(d).slice(0, 300)); });

    // 'close', not 'exit': it fires after the Hub's last stdout line has been read (its final `error` event is how
    // we know why it died), and it is the only one of the two that fires when the spawn itself failed (ENOENT).
    let gone = false;
    const onGone = (code) => {
      if (gone) return;
      gone = true;
      if (child === c) child = null;
      failAll('hub stopped');
      // A Hub that reached `ready` and then died at once would otherwise restart on the shortest backoff for ever;
      // only one that stayed up for stableMs starts over from it.
      if (readyAt && Date.now() - readyAt >= stableMs) attempt = 0;
      readyAt = 0;
      if (stopping) { state = 'idle'; return; }
      if (attempt >= backoff.length) { error = error || 'Claude Hub exited (' + code + ')'; settle('down'); return; }
      state = 'starting';
      push('health', { state, node: node ? node.version : null, error });   // tell the windows now: until the new Hub is up they would keep showing the old one's last answer
      timer = setTimeout(() => { restarts++; start(); }, backoff[attempt++]);
    };
    c.on('error', (e) => { error = errText(e); if (c.pid === undefined) onGone(-1); });
    c.on('close', onGone);
  }

  function request(op, args = {}, { timeout = 5000 } = {}) {
    if (!child || state !== 'running') return Promise.resolve({ error: 'hub not running' });
    const id = ++seq;
    return new Promise((resolve) => {
      const t = timeout ? setTimeout(() => { pending.delete(id); resolve({ error: 'timeout' }); }, timeout) : null;
      pending.set(id, { resolve, t });
      try { child.stdin.write(JSON.stringify({ id, op, args }) + '\n'); } catch { clearTimeout(t); pending.delete(id); resolve({ error: 'hub not running' }); }
    });
  }

  async function health() {
    if (state === 'no-node' || state === 'down') return { state, node: node ? node.version : null, error };
    for (let i = 0; i < 40 && state === 'starting'; i++) await new Promise((r) => setTimeout(r, 50));
    if (state !== 'running') return { state: state === 'idle' ? 'down' : state, node: node ? node.version : null, error };
    const h = await request('health');
    if (h && !h.error) return { ...h, node: h.node || node.version };
    if (state === 'starting') return { state: 'starting', node: node.version, error };   // the Hub died under this request and a restart is pending
    return { state: 'down', node: node.version, error: h && h.error };
  }

  function stop() {
    stopping = true; clearTimeout(timer); timer = null;
    if (child) { const c = child; try { c.stdin.end(); } catch { /* closed */ } setTimeout(() => { try { c.kill(); } catch { /* exited */ } }, 2000).unref(); }
    else if (state === 'starting') state = 'idle';   // waiting out a restart backoff: nothing left to wait for
  }

  return { start, stop, request, health, get state() { return state; }, _child: () => child, _restarts: () => restarts };
}

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
// Every Library channel -> its Hub op. Handlers resolve (the host's request() never rejects); junk args are
// reduced to {} before they reach the Hub, and a Hub `false` becomes an honest {error}.
function registerIpc(ipcMain, host) {
  const h = (ch, fn) => ipcMain.handle('hq:claude-hub:' + ch, fn);
  const bool = (r, why) => (r === true ? true : r === false ? { error: why } : r);
  h('health', () => host.health());
  h('projects', (_e, o) => host.request('listProjects', { source: obj(o).source }));
  h('conversations', (_e, o) => host.request('listConversations', { ...obj(o) }));
  h('conversation', (_e, id, o) => host.request('getConversation', { ...obj(o), id: String(id || '') }));
  h('search', (_e, q, o) => host.request('search', { ...obj(o), q: String(q || '') }));
  h('stats', (_e, o) => host.request('stats', { ...obj(o) }, { timeout: 15000 }));
  h('link', async (_e, id, hqId, state) => bool(await host.request('link', { projectId: String(id || ''), hqProjectId: hqId == null ? null : String(hqId), state: String(state || '') }), 'unknown project'));
  h('forget', async (_e, t) => bool(await host.request('forget', { ...obj(t) }, { timeout: 60000 }), 'nothing to forget'));
  // P2 prompt harvest: the whole pool is scored per ask (<= 2 x 20 000 rows), hence the longer timeout
  h('prompt-candidates', (_e, o) => host.request('promptCandidates', { limit: obj(o).limit }, { timeout: 15000 }));
  h('hide-candidate', async (_e, key) => bool(await host.request('hideCandidate', { key: String(key || '').slice(0, 60) }), 'nothing to hide'));
  h('documents', (_e, o) => host.request('listDocuments', { ...obj(o) }));
  h('document', (_e, id) => host.request('getDocument', { id: String(id || '').slice(0, 300) }));
  h('prompt-stats', () => host.request('promptStats', {}));   // P1: usage per prompt id (prompt_use, written from P3)
  h('reindex', () => host.request('reindex'));
}

function init({ ipcMain, send, dataDir, appLog, vaultDir } = {}) {
  const host = create({
    hubScript: path.join(__dirname, 'claude-hub', 'hub.mjs'),
    dbFile: process.env.HQ_CLAUDE_DB || path.join(dataDir, 'claude', 'hub.sqlite'),
    latestFile: process.env.HQ_HUB_LATEST || path.join(dataDir, 'latest.json'),
    vaultDir: hubVaultDir(process.env, vaultDir), send, log: appLog || null,
  });
  registerIpc(ipcMain, host);
  try { host.start(); } catch (e) { try { appLog && appLog.error('claude-hub-start-failed', e); } catch { /* logging only */ } }   // start() already contains its failures: belt and braces for main
  return host;
}

module.exports = { create, init, registerIpc, findNode, nodeOk, hubVaultDir };

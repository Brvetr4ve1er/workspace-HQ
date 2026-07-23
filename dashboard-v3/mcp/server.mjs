#!/usr/bin/env node
// THE BINDING — WorkspaceHQ stdio MCP server (charter M3, file-mediated v1).
// Newline-delimited JSON-RPC 2.0 on stdin/stdout, zero dependencies.
// Works with the app CLOSED: reads/writes the same data/ files the Warden uses.
// Mutation shapes MIRROR dashboard/main.js exactly (applyDone, hq:capture-save,
// hq:canvas-add) so both writers produce indistinguishable files.
// Live-app mutations (token-gated endpoint, data/.mcp-token) are v2 — see README.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const DATA = path.join(ROOT, 'data');
const COLLECTOR = path.join(ROOT, 'collector', 'collector.mjs');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'workspacehq', version: '0.1.0' };

const CAPTURE_MAX = 4000;
const CANVAS_TEXT_MAX = 2000;
const CANVAS_NAME_RE = /^[\w][\w -]{0,63}$/;   // same rail as main.js: no dots, no separators
// Win32 resolves device basenames (CON, NUL, COM1…) to DOS devices regardless
// of extension — a read can hang the stdio loop, a write goes to the console.
const WIN_DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

// ---------------------------------------------------------------------------
// Safety rails
// ---------------------------------------------------------------------------

class ToolError extends Error {}   // clean refusal — surfaces as isError, never kills the loop

// Every read/write goes through here: resolve, then prefix-check under data\.
function confined(...parts) {
  const p = path.resolve(DATA, ...parts);
  if (p !== DATA && !p.startsWith(DATA + path.sep)) throw new ToolError('path escapes data/ — refused');
  return p;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeAtomic(file, text) {
  // the confinement jail is a prefix check — a pre-planted symlink at the
  // target would redirect the rename outside data/, so refuse links outright
  try { if (fs.lstatSync(file).isSymbolicLink()) throw new ToolError('target is a symlink — refused'); }
  catch (e) { if (e instanceof ToolError) throw e; /* ENOENT = new file, fine */ }
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function latest() {
  const s = readJson(confined('latest.json'), null);
  if (!s || !s.scan) throw new ToolError('data/latest.json missing or unreadable — run a scan first');
  return s;
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'hq_status',
    description: 'Player vitals from the last scan: level, XP, health index, open/red quest counts, scan streak, project count. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      const s = latest();
      const a = s.account || {};
      return {
        date: s.scan.date,
        level: a.level ?? 0,
        xp: a.xp ?? 0,
        health: a.health_index ?? 0,
        open_quests: a.totals?.open_quests ?? 0,
        red_quests: a.totals?.red_quests ?? 0,
        streak: a.streak?.scan_days ?? 0,
        projects: Array.isArray(s.projects) ? s.projects.length : 0,
      };
    },
  },
  {
    name: 'hq_quests_list',
    description: 'All quests and side-quests from the last scan, with quest-overrides.json overlaid so completions marked since the scan (by app or MCP) show as done. Use the ids here with hq_quest_done.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      const s = latest();
      const ov = readJson(confined('quest-overrides.json'), {});
      const status = (id, baked) => (ov[id]?.status === 'done' ? 'done' : (baked || 'open'));
      return {
        quests: (s.quests || []).map((q) => ({
          id: q.id, title: q.title, tier: q.tier, status: status(q.id, q.status), project: q.project_id, xp: q.xp ?? null,
        })),
        side_quests: (s.side_quests || []).map((q) => ({
          id: q.id, title: q.title, kind: q.kind, status: status(q.id, null), project: q.project_id, xp: q.xp ?? null,
        })),
      };
    },
  },
  {
    name: 'hq_quest_done',
    description: 'Mark one quest or side-quest done. Id must exist in the current scan (see hq_quests_list) — unknown ids are refused. XP settles when the app next assembles (reload or scan).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'quest or side-quest id, e.g. "q-crucix-gitinit" or "sq-crucix-secrets"' } },
      required: ['id'],
      additionalProperties: false,
    },
    run(args) {
      const id = String(args.id || '').trim();
      if (!id) throw new ToolError('id required');
      const s = latest();
      const known = (s.quests || []).some((q) => q.id === id) || (s.side_quests || []).some((q) => q.id === id);
      if (!known) throw new ToolError(`unknown quest id "${id}" — not in the current scan; call hq_quests_list first`);
      const file = confined('quest-overrides.json');
      let ov = readJson(file, {});
      // a malformed file (array/string/null) would silently drop the write
      // (string keys on an array vanish in JSON.stringify) — reset to object
      if (!ov || typeof ov !== 'object' || Array.isArray(ov)) ov = {};
      if (ov[id]?.status === 'done') return { ok: false, id, reason: 'already marked done' };
      ov[id] = { status: 'done', completed: today() };            // exact applyDone mutation
      writeAtomic(file, JSON.stringify(ov, null, 2));
      return { ok: true, id, status: 'done', completed: ov[id].completed, note: 'XP settles on next app assemble (reload or scan)' };
    },
  },
  {
    name: 'hq_capture',
    description: 'Brain-dump capture (same store as the Ctrl+Alt+Space box). Text lands in data/brain-dump.json and surfaces as a side-quest on the next assemble. Max 4000 chars.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: CAPTURE_MAX, description: 'the thought to capture' } },
      required: ['text'],
      additionalProperties: false,
    },
    run(args) {
      const t = String(args.text || '').trim().slice(0, CAPTURE_MAX);
      if (!t) throw new ToolError('text required — an empty mind cannot be dumped');
      const file = confined('brain-dump.json');
      let arr = readJson(file, []);
      if (!Array.isArray(arr)) arr = [];
      const entry = { id: `${Date.now().toString(36)}`, ts: new Date().toISOString(), text: t };   // exact hq:capture-save shape
      arr.push(entry);
      writeAtomic(file, JSON.stringify(arr, null, 2));
      return { ok: true, id: entry.id, ts: entry.ts, note: 'surfaces as a side-quest on next app assemble' };
    },
  },
  {
    name: 'hq_canvas_read',
    description: 'THE CANVAS (shared JSON Canvas boards, Obsidian-compatible). Without a name: list boards with node/edge counts. With a name: return that board\'s full JSON.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'board name (omit to list all boards)' } },
      additionalProperties: false,
    },
    run(args) {
      if (args.name != null && args.name !== '') {
        const name = String(args.name);
        if (!CANVAS_NAME_RE.test(name) || WIN_DEVICE_RE.test(name)) throw new ToolError('bad board name — letters, digits, space, - and _ only (max 64), no device names');
        const board = readJson(confined('canvas', `${name}.canvas`), null);
        if (!board) throw new ToolError(`no board named "${name}"`);
        return { name, ...board };
      }
      let files = [];
      try { files = fs.readdirSync(confined('canvas')).filter((f) => f.endsWith('.canvas')); } catch { /* no boards yet */ }
      return {
        boards: files.map((f) => {
          const b = readJson(confined('canvas', f), {});
          return {
            name: f.replace(/\.canvas$/, ''),
            nodes: Array.isArray(b.nodes) ? b.nodes.length : 0,
            edges: Array.isArray(b.edges) ? b.edges.length : 0,
          };
        }),
      };
    },
  },
  {
    name: 'hq_canvas_add',
    description: 'Append a text node to a canvas board (created if absent). The app fs-watches data/canvas, so if it is running the node appears near-live. Max 2000 chars.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'board name (created if it does not exist)' },
        text: { type: 'string', maxLength: CANVAS_TEXT_MAX, description: 'node text (markdown ok)' },
        x: { type: 'number', description: 'canvas x (default 40)' },
        y: { type: 'number', description: 'canvas y (default 40)' },
      },
      required: ['name', 'text'],
      additionalProperties: false,
    },
    run(args) {
      const name = String(args.name || '');
      if (!CANVAS_NAME_RE.test(name) || WIN_DEVICE_RE.test(name)) throw new ToolError('bad board name — letters, digits, space, - and _ only (max 64), no device names');
      const text = String(args.text ?? '');
      if (!text.trim()) throw new ToolError('text required');
      const file = confined('canvas', `${name}.canvas`);
      // From here down: exact mirror of main.js hq:canvas-add (shape AND serialization),
      // so Warden-written and Binding-written boards are indistinguishable.
      let board = { nodes: [], edges: [] };
      try {
        const b = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (b && Array.isArray(b.nodes)) board = { edges: [], ...b };
      } catch { /* new board */ }
      const node = {
        id: 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'text', text: text.slice(0, CANVAS_TEXT_MAX),
        x: Number.isFinite(args.x) ? Math.round(args.x) : 40,
        y: Number.isFinite(args.y) ? Math.round(args.y) : 40,
        width: 280, height: 120,
      };
      board.nodes.push(node);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeAtomic(file, JSON.stringify(board, null, 1));
      return { ok: true, board: name, node: { id: node.id, x: node.x, y: node.y } };
    },
  },
  {
    name: 'hq_scan_trigger',
    description: 'Fire-and-forget: start the collector (raw metrics pass, no LLM). Returns immediately; enrichment/assemble happen on the next app scan or relaunch. Job-id polling: deferred to v2.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      if (!fs.existsSync(COLLECTOR)) throw new ToolError('collector/collector.mjs not found');
      const child = spawn(process.execPath, [COLLECTOR], { cwd: ROOT, detached: true, stdio: 'ignore' });
      child.unref();
      return { started: true, pid: child.pid ?? null, note: 'collector detached; assemble runs on next app scan/relaunch' };
    },
  },
];

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 loop (newline-delimited, MCP subset)
// ---------------------------------------------------------------------------

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function toolsCall(id, params) {
  const tool = TOOLS.find((t) => t.name === params?.name);
  if (!tool) { fail(id, -32602, `unknown tool: ${params?.name}`); return; }
  let out, isError = false;
  try {
    out = tool.run(params?.arguments || {});
  } catch (e) {
    isError = true;
    out = { error: e instanceof ToolError ? e.message : `tool crashed: ${e?.message || e}` };
  }
  const result = { content: [{ type: 'text', text: JSON.stringify(out) }] };
  if (isError) result.isError = true;
  reply(id, result);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const raw = line.trim();
  if (!raw) return;
  let msg;
  try { msg = JSON.parse(raw); } catch { fail(null, -32700, 'parse error'); return; }
  const id = msg?.id;
  const method = msg?.method;
  const isNotification = id === undefined || id === null;
  try {
    if (typeof method !== 'string') { if (!isNotification) fail(id, -32600, 'invalid request'); return; }
    switch (method) {
      case 'initialize':
        reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
        break;
      case 'ping':
        reply(id, {});
        break;
      case 'tools/list':
        reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        break;
      case 'tools/call':
        toolsCall(id, msg.params);
        break;
      default:
        if (method.startsWith('notifications/')) break;   // initialized etc. — accepted silently
        if (!isNotification) fail(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    // nothing on this loop is allowed to kill the server
    if (!isNotification) fail(id, -32603, `internal error: ${e?.message || e}`);
  }
});

rl.on('close', () => process.exit(0));

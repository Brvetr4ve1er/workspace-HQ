#!/usr/bin/env node
// THE BINDING — WorkspaceHQ stdio MCP server (charter M3, file-mediated v1).
// Newline-delimited JSON-RPC 2.0 on stdin/stdout, zero dependencies.
// Works with the app CLOSED: reads/writes the same data/ files the Warden uses.
// Mutation shapes MIRROR dashboard/main.js exactly (applyDone, hq:capture-save)
// so both writers produce indistinguishable files.
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
// Social bridge helpers (sidecars live under data/social/, all gitignored).
// Read side reads what the extension scraped; write side only STAGES actions —
// nothing here can publish. See docs/sync/CONTRACT.md "Social bridge sidecars".
// ---------------------------------------------------------------------------

const SOCIAL_PLATFORMS = ['bluesky', 'mastodon', 'reddit', 'x', 'instagram', 'threads', 'facebook', 'linkedin', 'youtube'];
const SOCIAL_TEXT_MAX = 3000;   // generous staging cap; per-platform limits enforced by the adapter at send

const socialOutbox = () => {
  const d = readJson(confined('social', 'outbox.json'), { updated: null, actions: [] });
  if (!d || typeof d !== 'object' || !Array.isArray(d.actions)) return { updated: null, actions: [] };
  return d;
};
function writeSocialOutbox(d) {
  d.updated = new Date().toISOString();
  const file = confined('social', 'outbox.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(d, null, 2));
}
function normPlatform(p) {
  const k = String(p || '').trim().toLowerCase();
  if (!SOCIAL_PLATFORMS.includes(k)) throw new ToolError(`unknown platform "${p}" — one of: ${SOCIAL_PLATFORMS.join(', ')}`);
  return k;
}
// Append a staged outbox action. THE ONLY write-path Claude has — status is
// always 'staged'; a human must approve+send from the extension popup.
function stageAction(op, args) {
  const platform = normPlatform(args.platform);
  const text = String(args.text || '').trim();
  if (!text) throw new ToolError('text required');
  if (text.length > SOCIAL_TEXT_MAX) throw new ToolError(`text too long (max ${SOCIAL_TEXT_MAX})`);
  const reply_to = args.reply_to ? String(args.reply_to).slice(0, 500) : null;
  if (op === 'reply' && !reply_to) throw new ToolError('reply_to required for a reply (post id/uri/url of the target)');
  // Optional platform-specific routing: `target` = destination (e.g. a Reddit
  // subreddit, without the r/), `title` = a post title where the platform needs
  // one (Reddit). Ignored by platforms that don't use them.
  const target = args.target ? String(args.target).slice(0, 120) : null;
  const title = args.title ? String(args.title).slice(0, 300) : null;
  const d = socialOutbox();
  const action = {
    id: 'ob-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    platform, op, text: text.slice(0, SOCIAL_TEXT_MAX), reply_to, target, title,
    status: 'staged', staged_at: new Date().toISOString(),
    sent_at: null, result: null, error: null, by: 'mcp',
  };
  d.actions.push(action);
  writeSocialOutbox(d);
  return {
    ok: true, id: action.id, platform, op, status: 'staged',
    note: 'STAGED ONLY — not sent. Review and click Approve & Send in the WorkspaceHQ Bridge extension popup to publish. Claude cannot send.',
  };
}

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
  // ---- SOCIAL BINDING (confirm-gated staging; the read tools went with the Social tab, 2026-10-28) ----
  {
    name: 'hq_social_post',
    description: 'STAGE a new top-level post for review. Does NOT publish — it appends a staged action to the outbox; you must click Approve & Send in the WorkspaceHQ Bridge extension popup to actually post. There is no way for Claude to send it. Reddit top-level posts require target (subreddit, without r/) + title.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: `target platform: ${SOCIAL_PLATFORMS.join(', ')}` },
        text: { type: 'string', maxLength: SOCIAL_TEXT_MAX, description: 'the post body' },
        target: { type: 'string', description: 'platform destination — e.g. a Reddit subreddit (without the r/). Ignored where not applicable.' },
        title: { type: 'string', description: 'post title — required for a Reddit top-level post; ignored where the platform has no title.' },
      },
      required: ['platform', 'text'],
      additionalProperties: false,
    },
    run(args) { return stageAction('post', args); },
  },
  {
    name: 'hq_social_reply',
    description: 'STAGE a reply for review. Does NOT publish — appends a staged action; you must Approve & Send in the extension popup. reply_to is the target post id/uri/url.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: `target platform: ${SOCIAL_PLATFORMS.join(', ')}` },
        reply_to: { type: 'string', description: 'id / at-uri / url of the post being replied to' },
        text: { type: 'string', maxLength: SOCIAL_TEXT_MAX, description: 'the reply body' },
      },
      required: ['platform', 'reply_to', 'text'],
      additionalProperties: false,
    },
    run(args) { return stageAction('reply', args); },
  },
  {
    name: 'hq_social_outbox',
    description: 'List outbox actions and their status (staged / sending / sent / failed / canceled). Read-only view of what is waiting for your approval and what has gone out. Optional status filter. sending = the human approved it and the extension claimed it (claimed_at) — the publish is in flight and it can no longer be canceled; a claim with no result for 10+ minutes may be stuck, and only the owner can release it back to staged after checking the platform (released_at marks that). A canceled action with sent_after_cancel:true was published anyway (the human-approved send finished after the cancel landed) — sent_at and result say when and where it went live.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', description: 'filter: staged | sending | sent | failed | canceled' } },
      additionalProperties: false,
    },
    run(args) {
      const f = args.status ? String(args.status).toLowerCase() : null;
      // sent_after_cancel / canceled_at / claimed_at / released_at: additive outbox fields (CONTRACT.md, social bridge amendments)
      const actions = socialOutbox().actions
        .filter((a) => !f || a.status === f)
        .map((a) => ({ id: a.id, platform: a.platform, op: a.op, status: a.status, text: a.text, reply_to: a.reply_to, target: a.target, title: a.title, staged_at: a.staged_at, claimed_at: a.claimed_at ?? null, released_at: a.released_at ?? null, sent_at: a.sent_at, result: a.result, error: a.error, canceled_at: a.canceled_at ?? null, sent_after_cancel: a.sent_after_cancel === true }));
      return { count: actions.length, actions };
    },
  },
  {
    name: 'hq_social_cancel',
    description: 'Cancel a STAGED outbox action so it can never be sent (marks it canceled). Only staged actions can be canceled — sent posts cannot be unsent from here. Safe: never publishes anything.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'outbox action id (see hq_social_outbox)' } },
      required: ['id'],
      additionalProperties: false,
    },
    run(args) {
      const id = String(args.id || '').trim();
      if (!id) throw new ToolError('id required');
      const d = socialOutbox();
      const a = d.actions.find((x) => x.id === id);
      if (!a) throw new ToolError(`unknown outbox id "${id}"`);
      if (a.status !== 'staged') return { ok: false, id, reason: `cannot cancel — status is "${a.status}"` };
      a.status = 'canceled';
      writeSocialOutbox(d);
      return { ok: true, id, status: 'canceled' };
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

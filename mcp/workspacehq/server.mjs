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
import { fileURLToPath } from 'node:url';
import { createGuard, createInflight, describe } from './guard.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const DATA = path.join(ROOT, 'data');
const COLLECTOR = path.join(ROOT, 'collector', 'collector.mjs');

// The assistant's rulebook (guard.mjs): every tool call has a tier, limits counted from data/assistant-audit.jsonl, and one names-only log line.
const guard = createGuard({ root: ROOT, dataDir: DATA, collectorPath: COLLECTOR });
const inflight = createInflight();

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
// op -> platforms whose send ALWAYS refuses (server.test.mjs pins this against browser-bridge/social.js)
const NEVER_SENDS = { post: ['instagram', 'youtube'], reply: ['instagram', 'youtube', 'linkedin'] };
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
  // reddit posts can never publish without both (the adapter refuses at send) —
  // fail at stage time instead of burning a human approval on a dead action
  if (platform === 'reddit' && op === 'post' && (!target || !title)) {
    throw new ToolError('Reddit top-level posts need target (subreddit, without r/) + title');
  }
  // the same rule for combos the send half refuses unconditionally (browser-bridge/social.js: Instagram needs media,
  // YouTube posting isn't wired, LinkedIn comments aren't) — no setting can make them send, so they never reach the
  // owner's approval queue. Threads / Facebook stay stageable: they send once the owner pastes a captured doc_id.
  if ((NEVER_SENDS[op] || []).includes(platform)) {
    throw new ToolError(`${platform} ${op}s can't be sent — the extension's ${platform} adapter refuses every ${op} (see the tool description); nothing staged`);
  }
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

// The Hub reader is loaded on first use (it needs node:sqlite; a Node without it answers with an error naming the version, not a crash).
// Its refusals (no index yet, locked db, newer schema, another folder's chat) are clean tool errors.
async function hubTool(fn, args) {
  const hubRead = await import('./hub-read.mjs');
  try { return await hubRead[fn](args); }
  catch (e) { if (e instanceof hubRead.HubReadError) throw new ToolError(e.message); throw e; }
}

const TOOLS = [
  {
    name: 'hq_brief',
    description: 'The Operator Brief: what needs the owner right now, ranked by the WorkspaceHQ app (deterministic, no LLM) from the scan, quests, money, PC health, CI, deploys, pull requests, the Claude session they left, the scan run and claude.ai sync. Each item has severity (high/med/low), text, why, source, age, count (how many more of the same kind it stands for) and the one action that clears it in the app. Default the top 3; limit (1–12) asks for more — items holds up to that many, overflow the ranked rest (at most 12 in all), more counts everything past the top 3. Read-only — start a session with it to know what matters before anything else. ageMinutes says how old the brief is; the app rewrites it on every scan, money write and every 15 min while it runs.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 12, description: 'how many ranked items to return in items (1–12, default 3); the rest of the ranked list comes back in overflow' } }, additionalProperties: false },
    run(args) {
      let limit = 3;
      if (args && args.limit !== undefined && args.limit !== null) {
        limit = args.limit;
        if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new ToolError('limit must be a whole number from 1 to 12');
      }
      const file = confined('brief.json');
      const b = readJson(file, null);
      if (!b || !Array.isArray(b.items)) return { error: 'no brief yet — the WorkspaceHQ app writes data/brief.json when it runs' };
      const t = Date.parse(b.generatedAt);
      const ranked = b.items.concat(Array.isArray(b.overflow) ? b.overflow : []);
      return { ...b, items: ranked.slice(0, limit), overflow: ranked.slice(limit), ageMinutes: Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60e3)) : null };
    },
  },
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
    description: 'Brain-dump capture (same store as the app\'s own capture — the v5 palette "capture" verb and System > Clutter "Note for cleanup", via hq:capture-save; the old Ctrl+Alt+Space box was retired 2026-09-15). Text lands in data/brain-dump.json and surfaces as a side-quest on the next assemble. Max 4000 chars.',
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
    description: 'Start the collector raw pass (local git only, no LLM, no network) and return at once. Bounded: one pass at a time, shared with the app Scan through data/.refresh.lock, and at most one every 10 minutes (a refusal says why and when to retry). The Brief and latest.json change only after the next app scan (Scan now, or the nightly run).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run() { return guard.scanTrigger(); },
  },
  {
    name: 'hq_activity',
    description: 'What assistants did through this folder: counts by tool, tier and door, the last 20 calls (names only, never arguments or text), the last scan-trigger outcome, and whether each door is open (phone, tools in every session, browser, tray icon). Read-only. since: today | 24h | 7d.',
    inputSchema: { type: 'object', properties: { since: { type: 'string', enum: ['today', '24h', '7d'], description: 'window; default today' } }, additionalProperties: false },
    run(args) { return guard.activity(args || {}); },
  },
  // ---- RECALL (past Claude chats, read-only; hub-read.mjs opens data/claude/hub.sqlite per call and closes it) ----
  {
    name: 'hq_recall',
    description: 'Search your past Claude chats (the Claude Hub index) and get ranked snippets: {hits:[{conversationId, title, project, at, role, snippet}], scope, indexed, note}. Read-only; works with the app closed. '
      + 'scope "here" (default) keeps chats whose folder is inside the folder of this session; "all" reads every folder. source "code" (default) is Claude Code chats, "web" is claude.ai chats; Instagram and Facebook are never searched. '
      + 'Only user and assistant text comes back (no tool output, no subagent turns, no forgotten chats), at most 240 characters a snippet, at most 20 hits. When "here" finds nothing the answer says so and offers scope "all". '
      + 'Caveats: text is masked for known secret shapes, but the raw text stays in the search table of the index, so searching for a secret string can still find its row, and a secret written in plain prose with no label can still slip through.',
    inputSchema: { type: 'object', properties: {
      q: { type: 'string', description: 'words to look for' },
      scope: { type: 'string', enum: ['here', 'all'], description: 'default here' },
      project: { type: 'string', description: 'keep only chats of the project with this name' },
      source: { type: 'string', enum: ['code', 'web'], description: 'default code' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'default 8' } }, required: ['q'], additionalProperties: false },
    async run(args) { return hubTool('hubRecall', args || {}); },
  },
  {
    name: 'hq_chat_read',
    description: 'Read the last turns of one past Claude chat by id (an id from hq_recall): {id, title, turns:[{role, at, text}], more}. Read-only. Only user and assistant turns (no tool output, no subagent turns); each turn at most 1,500 characters and at most 24,000 in all (more:true when cut); limit up to 20 turns, default 8. '
      + 'A chat from another folder is refused unless scope is "all". Caveats: text is masked for known secret shapes, but a secret written in plain prose with no label can still slip through.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'conversationId from hq_recall' },
      scope: { type: 'string', enum: ['here', 'all'], description: 'default here' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'default 8' } }, required: ['id'], additionalProperties: false },
    async run(args) { return hubTool('hubChatRead', args || {}); },
  },
  // ---- SOCIAL BINDING (confirm-gated staging; the read tools went with the Social tab, 2026-10-28) ----
  {
    name: 'hq_social_post',
    description: 'STAGE a new top-level post for review. Does NOT publish — it appends a staged action to the outbox; you must click Approve & Send in the WorkspaceHQ Bridge extension popup to actually post. There is no way for Claude to send it. Reddit top-level posts require target (subreddit, without r/) + title. The send half can only publish posts on bluesky, mastodon, reddit, x and linkedin today: instagram and youtube posts are refused here at stage time (the send can never succeed: text-only posting is unsupported), and threads/facebook stage but only send once the owner pastes a captured doc_id into browser-bridge/social.js.',
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
    description: 'STAGE a reply for review. Does NOT publish — appends a staged action; you must Approve & Send in the extension popup. reply_to is the target post id/uri/url. The send half can only publish replies on bluesky, mastodon, reddit and x today: linkedin, instagram and youtube replies are refused here at stage time (their send can never succeed), and threads/facebook replies stage but are not wired at send.',
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

async function toolsCall(id, params) {
  try {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) { fail(id, -32602, `unknown tool: ${params?.name}`); return; }
    // guard.call never rejects: it looks up the tier, applies the limits, runs the tool, writes the audit line
    const { out, isError } = await guard.call(tool.name, () => tool.run(params?.arguments || {}), { isClean: (e) => e instanceof ToolError });
    const result = { content: [{ type: 'text', text: JSON.stringify(out) }] };
    if (isError) result.isError = true;
    reply(id, result);
  } catch (e) {
    try { fail(id, -32603, `internal error: ${e?.message || e}`); } catch { /* stdout gone */ }
  }
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
        reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description: describe(description), inputSchema })) });
        break;
      case 'tools/call':
        inflight.track(toolsCall(id, msg.params));   // async; the reply is matched by id and survives stdin closing
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

// stdin closing must not drop a reply still in flight (a tool that loads a module, opens the Hub, ...): drain, then exit
rl.on('close', () => { inflight.drain().then(() => process.exit(0), () => process.exit(0)); });

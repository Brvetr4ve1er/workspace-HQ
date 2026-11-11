// Operator Brief senses, main side: gathers what dashboard/brief-senses.mjs needs and hands brief.js one object to merge
// into buildInputs(). Reads data/github.json, data/accounts.json (its vercel section) and data/pc-health.json (detail), and
// asks the Claude Hub for the last day's Claude Code sessions, its code projects, and — only for sessions that matched a
// project with a few uncommitted files — the last turns' tool names. Never throws: whatever can't be read becomes an
// `errors` entry (a bad sidecar names its own source; a Hub failure is source 'claude-code') and the sense stays silent.
//
// gather({ dataDir, hub, now, scan?, docsRoot?, timeoutMs? }) → Promise<{
//   github, vercel, pcDetail, security, sessions, hubProjects, sessionTurns, docsRoot, errors }>
//   now: Date | ms | () => Date | ms.   scan: the parsed latest.json (read from dataDir when omitted).
//   security: numbers, booleans and timestamps from data/security/status.json (read directly, NOT through the 72 h sidecar gate), or null
//   github / vercel are the sidecar documents when usable, else null; pcDetail is { scannedAt, rebootPending } | null.
//   sessions: [{ id, projectId, hqProjectId, cwd, lastAt }]   (never a title)    hubProjects: [{ id, path, hqProjectId, linkState }]
//   sessionTurns: { [sessionId]: [{ toolName }] }
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let senses = null;
const lib = () => senses || (senses = import(pathToFileURL(path.join(__dirname, 'brief-senses.mjs')).href));
let secLib = null;
const securityLib = () => secLib || (secLib = import(pathToFileURL(path.join(__dirname, 'brief-security.mjs')).href));

const HUB_MS = 5000, DAY_MS = 24 * 3600e3, SESSION_LIMIT = 30;
const msg = (e) => String((e && e.message) || e).slice(0, 160);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : null);

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { absent: true } : { error: msg(e) }; }
  try { return { value: JSON.parse(raw) }; } catch (e) { return { error: 'unreadable (' + msg(e) + ')' }; }
}
const toMs = (n) => { const v = typeof n === 'function' ? n() : n; return v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.now(); };

// a hub.request that can neither hang nor throw: { value } | { error }
function ask(hub, op, args, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const end = (r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => end({ error: op + ' timed out after ' + Math.round(timeoutMs / 1000) + ' s' }), timeoutMs);
    if (t.unref) t.unref();
    try {
      Promise.resolve(hub.request(op, args, { timeout: timeoutMs })).then(
        (r) => end(isObj(r) && typeof r.error === 'string' ? { error: r.error.slice(0, 160) } : { value: r }),
        (e) => end({ error: msg(e) }));
    } catch (e) { end({ error: msg(e) }); }
  });
}

async function gather({ dataDir, hub, now, scan, docsRoot, timeoutMs = HUB_MS } = {}) {
  const out = { github: null, vercel: null, pcDetail: null, security: null, sessions: [], hubProjects: [], sessionTurns: {}, docsRoot: docsRoot || require('./project-paths').DOCS_ROOT, errors: [] };
  try {
    const S = await lib();
    const nowMs = toMs(now);
    const note = (source, error) => out.errors.push({ source, error });

    // 1. sidecars: absent = silent, unreadable / partial / not ok / older than 72 h = silent + a named error
    const sidecar = (source, label, doc) => {
      const e = S.sidecarError(source, label, doc, nowMs);
      if (e) { note(e.source, e.error); return null; }
      return S.sidecarState(doc, nowMs).ok ? doc : null;
    };
    const gh = readJson(path.join(dataDir, 'github.json'));
    if (gh.error) note('github', 'data/github.json ' + gh.error + ' — its checks were skipped');
    else if (!gh.absent) out.github = sidecar('github', 'data/github.json', gh.value);

    const ac = readJson(path.join(dataDir, 'accounts.json'));
    if (ac.error) note('vercel', 'data/accounts.json ' + ac.error + ' — its checks were skipped');
    else if (!ac.absent) out.vercel = sidecar('vercel', 'data/accounts.json (vercel)', isObj(ac.value) ? ac.value.vercel : undefined);

    const pc = readJson(path.join(dataDir, 'pc-health.json'));   // brief.js already reports an absent / unreadable file
    if (isObj(pc.value)) {
      const detail = { scannedAt: str(pc.value.scanned_at), rebootPending: isObj(pc.value.detail) ? pc.value.detail.rebootPending === true : false };
      const e = S.sidecarError('pc-health', 'data/pc-health.json', { at: detail.scannedAt }, nowMs);
      if (e) note(e.source, e.error); else out.pcDetail = detail;
    }

    // 1b. data/security/status.json, read DIRECTLY: sidecar()'s 72 h gate would make 'footprint-stale' (30 d) unreachable and its
    // 'at' check would push a named error for a status a scan wrote. 'at' is used only for the age text. Absent = silent.
    const st = readJson(path.join(dataDir, 'security', 'status.json'));
    if (st.error) note('security', 'data/security/status.json ' + st.error + ' — its checks were skipped');
    else if (isObj(st.value)) out.security = (await securityLib()).securityInput(st.value);

    // 2. the Claude Code sessions of the last day and the Hub's code projects (one call each)
    if (hub && typeof hub.request === 'function') {
      const sinceIso = new Date(nowMs - DAY_MS).toISOString();
      const [convs, projs] = await Promise.all([
        ask(hub, 'listConversations', { source: 'code', since: sinceIso, limit: SESSION_LIMIT }, timeoutMs),
        ask(hub, 'listProjects', { source: 'code' }, timeoutMs),
      ]);
      if (convs.error) note('claude-code', 'sessions not read — ' + convs.error);
      else if (Array.isArray(convs.value)) {
        out.sessions = convs.value.filter(isObj).map((c) => ({ id: str(c.id), projectId: str(c.project_id), hqProjectId: str(c.hq_project_id), cwd: str(c.cwd), lastAt: str(c.last_at) })).filter((s) => s.id && s.lastAt);
      }
      if (projs.error) note('claude-code', 'projects not read — ' + projs.error);
      else if (Array.isArray(projs.value)) {
        out.hubProjects = projs.value.filter(isObj).map((p) => ({ id: str(p.id), path: str(p.path), hqProjectId: str(p.hq_project_id), linkState: str(p.link_state) })).filter((p) => p.id);
      }

      // 3. turns only where the verdict hangs on them: sessions that ended before the scan in a project with 1–9 uncommitted files
      let scanDoc = scan;
      if (scanDoc === undefined) { const r = readJson(path.join(dataDir, 'latest.json')); scanDoc = r.value; }
      const scanMs = isObj(scanDoc) && isObj(scanDoc.scan) && Number.isFinite(Date.parse(scanDoc.scan.date)) ? Date.parse(scanDoc.scan.date) : null;
      if (scanMs !== null && out.sessions.length) {
        const cand = S.sessionCandidates({ now: nowMs, scanMs, docsRoot: out.docsRoot, projects: Array.isArray(scanDoc.projects) ? scanDoc.projects : [], sessions: out.sessions, hubProjects: out.hubProjects })
          .filter((c) => c.need).slice(0, S.TURNS_FETCH_MAX);
        const got = await Promise.all(cand.map((c) => ask(hub, 'getConversation', { id: c.session.id, limit: S.TURNS_LIMIT }, timeoutMs)));
        got.forEach((r, i) => {
          if (r.error) { note('claude-code', 'a session\'s last turns were not read — ' + r.error); return; }
          const msgs = isObj(r.value) && Array.isArray(r.value.messages) ? r.value.messages : [];
          out.sessionTurns[cand[i].session.id] = msgs.filter(isObj).map((m) => ({ toolName: str(m.tool_name) }));
        });
      }
    }
  } catch (e) {
    out.errors.push({ source: 'brief-senses', error: 'the senses could not be gathered — ' + msg(e) });
  }
  return out;
}

module.exports = { gather };

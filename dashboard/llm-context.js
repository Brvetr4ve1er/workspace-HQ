// PC-Brain L4 — the grounding assembler for the ORACLE realm. Turns the app's
// own data files into a compact plain-text CONTEXT block the local model is
// told to answer from (and only from). Runs in the main process: the renderer
// sends which sections to include, never the context itself.
//
// Honesty lives HERE, not just in the UI: the ambient-companion spec's "never
// bluff" rule is defeated upstream if an estimate is fed to the model as a
// fact. So every soft value is labelled at the source — completion % is an
// estimate, the health index is a composite that includes estimates, the
// streak counts scanner runs, model-suggested risks say so — and stale soft
// fields (insights / suggestions / roadmap) are omitted entirely.
//
// Budgets keep the whole prompt inside the 8k-token window llm-local asks for:
// 4 KB per section, 12 KB total (~3k tokens) + persona + chat history. When
// "Claude history" is ticked (Claude Hub H5) it is assembled last with
// CLAUDE_RESERVE chars held back for it, so the other sections share 9 KB.
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { BROWSER_WINDOW_DAYS } = require('./browser-bridge');

const SECTION_MAX = 4000;
const TOTAL_MAX = 12000;
const CLAUDE_RESERVE = 3000;
const CLAUDE_TIMEOUT_MS = 4000;
const SECTION_IDS = ['scan', 'tasks', 'projects', 'health', 'browser', 'vault', 'claude'];
const LABEL = { scan: 'scan', tasks: 'tasks', projects: 'projects', health: 'PC health', browser: 'browser', vault: 'vault', claude: 'Claude history' };

const TIER = { red: 'critical', orange: 'important', yellow: 'housekeeping' };
const ORGAN_STATUS = { grace: 'healthy', ember: 'warning', blood: 'critical' };

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const line = (s, n = 180) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const localDay = (d) => d.toLocaleDateString('en-CA');   // YYYY-MM-DD in local time

function dur(ms) {
  const m = Math.round((Number(ms) || 0) / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

// ---------------------------------------------------------------- sections
function scanSection(S) {
  const a = S.account || {}, t = a.totals || {};
  const out = [`SCAN SUMMARY (measured unless marked; snapshot ${S.scan?.id || S.scan?.date || 'unknown'})`];
  out.push(`- Level ${a.level ?? '?'}${a.title ? ` (${a.title})` : ''}, ${a.xp ?? '?'} XP, ${a.xp_to_next ?? '?'} XP to the next level`);
  out.push(`- Health index ${a.health_index ?? '?'}/100 — a composite that includes the estimated completion %, so treat it as rough`);
  out.push(`- Open tasks: ${t.open_quests ?? '?'} (${t.red_quests ?? 0} critical); open side-quests: ${t.open_side_quests ?? '?'}; tasks completed all-time: ${t.quests_done_total ?? '?'}`);
  out.push(`- Projects tracked: ${t.products ?? (S.projects || []).length}; achievements unlocked: ${t.achievements_unlocked ?? '?'}`);
  if (a.streak) out.push(`- Scanner streak: ran ${a.streak.scan_days ?? 0} consecutive days (counts scan runs, NOT the user's commits)`);
  const picks = Array.isArray(a.daily_top3) ? a.daily_top3 : [];
  if (picks.length) {
    out.push('Suggested picks for today (deterministic, from the scan; counts inside a label may be from when its task was created — PROJECTS has the current numbers):');
    for (const p of picks) out.push(`- ${p.kind || 'pick'}: ${line(p.label, 120)} — ${line(p.reason, 100)}`);
  }
  return out.join('\n');
}

function tasksSection(S) {
  const byId = {};
  (S.projects || []).forEach((p) => { byId[p.id] = p; });
  const rank = { red: 0, orange: 1, yellow: 2 };
  const open = (S.quests || [])
    .filter((q) => q.status === 'open' || q.status === 'in_progress')
    .sort((a, b) => (rank[a.tier] ?? 3) - (rank[b.tier] ?? 3) || (b.age_days || 0) - (a.age_days || 0));
  const out = ['OPEN TASKS (the task list is measured; each title/note was written when the task was created — "now:" has the current counts)'];
  if (!open.length) out.push('- none open');
  for (const q of open) {
    const p = q.project_id ? byId[q.project_id] : null;
    const who = q.project_id ? ` — project ${p?.name || q.project_id}` : '';
    const age = Number.isFinite(q.age_days) ? `, open ${q.age_days}d` : '';
    // collector/lib/quests.mjs carries titles + insights verbatim from creation,
    // so "(5 ahead)" can be months old — state the live git numbers beside it.
    const g = p?.metrics?.git_safety;
    const now = g ? ` — now: ${g.dirty ?? 0} uncommitted, ${g.ahead ?? 0} unpushed${g.has_remote === false ? ', no remote' : ''}` : '';
    // Build quests come from the LLM enricher's judgment, not a build run.
    const judged = /-build$/.test(String(q.id || ''));
    const why = q.insight && !judged ? ` — note from ${q.created || 'creation'}: ${line(q.insight, 140)}` : '';
    out.push(`- [${TIER[q.tier] || q.tier || 'task'}] ${line(q.title, 120)}${judged ? ' (build status is model-judged — estimate)' : ''}${who}${age}${now}${why}`);
  }
  // Only MEASURED side-quests. LLM-written ones (source 'llm') are unverified
  // and often stale (e.g. "25 dirty files for 7 days" long after the tree was
  // cleaned) — a 7B model repeats them as fact even when labelled, so they
  // never enter the context at all.
  const sev = { high: 0, urgent: 0, medium: 1, low: 2 };
  const flagged = (S.side_quests || [])
    .filter((s) => (s.kind === 'risk' || s.kind === 'urgent') && s.source !== 'llm')
    .sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3))
    .slice(0, 8);
  if (flagged.length) {
    out.push('Flagged risks (measured):');
    for (const s of flagged) out.push(`- [${s.severity || 'risk'}] ${line(s.title, 140)} (${s.project_name || byId[s.project_id]?.name || s.project_id || 'workspace'})`);
  }
  return out.join('\n');
}

function projectLine(p) {
  const act = p.activity || {}, g = p.metrics?.git_safety || {}, ch = p.metrics?.code_health || {};
  const rs = p.metrics?.risk_security || {}, sig = p.signals || {};
  const bits = [];
  bits.push(act.state || 'unknown');
  if (act.last_commit) bits.push(`last commit ${act.last_commit}${Number.isFinite(act.days_since_commit) ? ` (${act.days_since_commit}d ago)` : ''}`);
  if (g.has_git === false) bits.push('NO git repo');
  else {
    if (g.branch) bits.push(`branch ${g.branch}${(g.flags || []).includes('non-canonical-branch') ? ' (not the main branch)' : ''}`);
    bits.push(`uncommitted files ${g.dirty ?? 0}`);
    if (g.ahead) bits.push(`${g.ahead} commits not pushed`);
    if (g.has_remote === false) bits.push('NO remote backup');
    if (g.risk) bits.push(`git risk ${g.risk}`);
  }
  // build comes from the LLM enricher (collector/lib/projects.mjs), not a build run.
  if (ch.build && ch.build !== 'unknown') bits.push(`build ${ch.build} (model-judged estimate, not an actual build run)`);
  bits.push(sig.has_tests ? `tests present (${sig.test_files ?? ch.tests?.count ?? '?'} files, results unverified)` : 'no tests');
  bits.push(sig.has_ci ? 'CI configured' : 'no CI');
  if (rs.secrets_found) bits.push(`${rs.secrets_found} possible exposed secrets`);
  if (Number.isFinite(p.completion?.pct)) bits.push(`completion ~${p.completion.pct}% (estimate)`);
  return `- ${p.name}${p.kind ? ` [${p.kind}]` : ''}: ${bits.join('; ')}`;
}

function projectsSection(S) {
  const order = { active: 0, cooling: 1, dormant: 2 };
  const list = [...(S.projects || [])].sort((a, b) =>
    (order[a.activity?.state] ?? 3) - (order[b.activity?.state] ?? 3)
    || (a.activity?.days_since_commit ?? 9999) - (b.activity?.days_since_commit ?? 9999));
  const out = ['PROJECTS (measured from git + files; completion % and build status are estimates)'];
  if (!list.length) out.push('- none tracked');
  for (const p of list) out.push(projectLine(p));
  return out.join('\n');
}

function healthSection(ph) {
  if (!ph || !Array.isArray(ph.organs) || !ph.organs.length) return 'PC HEALTH\n- no health scan yet (the SYSTEM tab can run one)';
  const out = [`PC HEALTH (measured; scanned ${String(ph.scanned_at || '').replace('T', ' ').slice(0, 16)})`];
  for (const o of ph.organs) {
    if (!o || typeof o !== 'object') continue;
    const status = ORGAN_STATUS[o.status] || o.status || '?';
    if (o.id === 'gpu') {
      // The collector reads VRAM through WMI's 32-bit AdapterRAM, which caps at
      // 4 GB — the figure is known-wrong on this card (structure-lane fix
      // pending), so the model never gets to repeat it as fact.
      out.push(`- ${o.label || 'Graphics'}: ${status}; VRAM figure omitted (the collector under-reports it)`);
      continue;
    }
    const val = o.value != null ? `${o.value}${o.unit ? ' ' + o.unit : ''}` : 'n/a';
    out.push(`- ${o.label || o.id}: ${val} — ${status}${o.diagnosis ? ` — ${line(o.diagnosis, 140)}` : ''}`);
  }
  return out.join('\n');
}

function browserSection(scanBrowser, activity, now) {
  const out = ['BROWSER FOCUS TIME (measured by the WorkspaceHQ Bridge extension)'];
  const today = localDay(now);
  const byDay = {};
  for (const ev of activity?.events || []) {
    if (!ev || !Number.isFinite(ev.ts) || localDay(new Date(ev.ts)) !== today) continue;
    const d = ev.domain || ev.host || '?';
    byDay[d] = (byDay[d] || 0) + (Number(ev.focus_ms) || 0);
  }
  const todayRows = Object.entries(byDay).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (todayRows.length) {
    out.push(`Today (${today}):`);
    for (const [d, ms] of todayRows) out.push(`- ${d}: ${dur(ms)}`);
  } else {
    out.push(`Today (${today}): no browser activity recorded yet`);
  }
  const overall = (scanBrowser?.by_domain || []).slice(0, 8);
  if (overall.length) {
    out.push(`Up to the last ${BROWSER_WINDOW_DAYS} days, ending ${String(scanBrowser.updated || '').slice(0, 10) || 'at the last scan'} (rolling window kept by the Bridge — not today-only):`);
    for (const r of overall) out.push(`- ${r.domain}: ${dur(r.focus_ms)} focused, ${r.visits ?? '?'} visits`);
  }
  if (!todayRows.length && !overall.length) out.push('- no browser data captured (is the extension running?)');
  return out.join('\n');
}

// Read-only keyword search over the Obsidian vault. Never writes; skips dot
// folders (.obsidian, .trash) and anything that isn't a markdown note.
const STOP = new Set(('the and for with that this what which when where from have does about into your you are was were will would should could there their them then than just only also more most some such very what whats how why who whom why my me our its it\'s can not '
  + 'dans les des une est pour que qui avec sur pas plus sont mais ou quoi comment pourquoi quel quelle').split(/\s+/));

async function walkMd(dir, out, cap) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (out.length >= cap) return;
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkMd(p, out, cap);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
}

async function vaultSection(vaultDir, query) {
  const head = 'VAULT NOTES (read-only keyword matches from the VEEMO CORTEX Obsidian vault)';
  const words = [...new Set((String(query).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) || []).filter((w) => w.length >= 4 && !STOP.has(w)))].slice(0, 8);
  if (!words.length) return `${head}\n- the question has no searchable keywords`;
  if (!fs.existsSync(vaultDir)) return `${head}\n- vault folder not found`;
  const files = [];
  await walkMd(vaultDir, files, 4000);
  const scored = [];
  for (const f of files) {
    const rel = path.relative(vaultDir, f).replace(/\\/g, '/');
    // The app's own nightly snapshots (and weekly recaps) live in the vault too.
    // They carry old completion % / build icons / streaks with no estimate
    // marks — the scan sections already hold the measured current values.
    if (/^30_Areas\/Workspace Status\//i.test(rel)) continue;
    let txt, mtime = 0;
    try {
      const st = await fsp.stat(f);
      if (st.size > 300_000) continue;
      mtime = st.mtimeMs;
      txt = await fsp.readFile(f, 'utf8');
    } catch { continue; }
    const fm = (txt.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
    const gen = (fm.match(/^generated_by:\s*["']?([\w-]+)/m) || [])[1] || '';
    if (gen === 'workspacehq-pipeline') continue;
    const low = txt.toLowerCase(), name = path.basename(f, '.md').toLowerCase();
    let score = 0;
    for (const w of words) {
      if (name.includes(w)) score += 3;
      let i = low.indexOf(w), n = 0;
      while (i >= 0 && n < 5) { n++; i = low.indexOf(w, i + w.length); }
      score += n;
    }
    if (score > 0) scored.push({ rel, score, txt, mtime, gen });
  }
  // Ties go to the most recently edited note, not to walk order.
  scored.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  const top = scored.slice(0, 3);
  if (!top.length) return `${head}\n- no notes matched: ${words.join(', ')}`;
  const out = [head + ' — each note is as old as its date; anything it says about progress is a past snapshot'];
  for (const h of top) {
    // Frontmatter scores (tags are good signal) but makes a useless snippet.
    let body = h.txt.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '');
    // App-written project notes open with a "[!info] N% complete" callout — an old estimate.
    if (h.gen === 'workspacehq') body = body.replace(/(\d+)% complete/g, '$1% complete (old estimate)');
    const low = body.toLowerCase();
    const hits = words.map((w) => low.indexOf(w)).filter((i) => i >= 0);
    const start = Math.max(0, (hits.length ? Math.min(...hits) : 0) - 150);
    const when = h.mtime ? new Date(h.mtime).toLocaleDateString('en-CA') : 'unknown date';
    out.push(`- ${h.rel} (last edited ${when}): "…${line(body.slice(start, start + 600), 600)}…"`);
  }
  return out.join('\n');
}

// Claude history (Claude Hub H5): cited snippets of past chats from the Hub's contextFor op. The Hub runs on system
// Node with node:sqlite; this main process only asks it through claude-hub-host's request(), which never rejects.
// A missing, stopped or slow Hub is a NOTE (shown in Ask's meta line), never an exception and never an empty success.
const HUB_NOTE = {
  'hub not running': 'Claude Hub is not running',
  'hub stopped': 'Claude Hub stopped while answering',
  timeout: 'Claude Hub did not answer within 4 s',
};
async function claudeSection(claudeHub, query, budgetChars) {
  if (!claudeHub || typeof claudeHub.request !== 'function') return { text: '', cites: [], note: HUB_NOTE['hub not running'] };
  let r;
  try { r = await claudeHub.request('contextFor', { query: String(query || ''), budgetChars }, { timeout: CLAUDE_TIMEOUT_MS }); }
  catch (e) { return { text: '', cites: [], note: line(e?.message || e, 80) }; }
  if (r && typeof r.error === 'string') return { text: '', cites: [], note: HUB_NOTE[r.error] || line(r.error, 80) };
  if (!r || typeof r !== 'object' || typeof r.text !== 'string' || !Array.isArray(r.cites)) return { text: '', cites: [], note: 'the Claude Hub answered in an unknown shape' };
  const out = { text: r.text.slice(0, Math.max(0, budgetChars)), cites: r.cites.filter((c) => typeof c === 'string').map((c) => line(c, 120)) };
  if (typeof r.note === 'string' && r.note) out.note = r.note;
  return out;
}

// ---------------------------------------------------------------- assemble
// -> { text, sections: [{id, label, chars, clipped, note?}], chars }
async function assemble({ dataDir, vaultDir, include = {}, query = '', activity = null, now = new Date(), claudeHub = null } = {}) {
  const S = readJson(path.join(dataDir, 'latest.json'));
  const header = `TODAY: ${localDay(now)} (${now.toLocaleDateString('en-US', { weekday: 'long' })}), local time ${now.toTimeString().slice(0, 5)}.`;
  const parts = [header];
  const sections = [];
  let used = header.length;

  // Ticking Claude history holds CLAUDE_RESERVE back from every other section (claude is assembled last).
  const reserve = include.claude === true ? CLAUDE_RESERVE : 0;
  const add = (id, body, extra) => {
    let text = body, clipped = false;
    if (text.length > SECTION_MAX) { text = text.slice(0, SECTION_MAX - 16) + '\n…[trimmed]'; clipped = true; }
    const room = TOTAL_MAX - used - (id === 'claude' ? 0 : reserve);
    if (room < 200) { sections.push({ id, label: LABEL[id], chars: 0, clipped: true, note: 'dropped — context budget full', ...(extra ? { cites: [] } : {}) }); return; }
    if (text.length > room) { text = text.slice(0, room - 16) + '\n…[trimmed]'; clipped = true; }
    parts.push(text);
    used += text.length + 2;
    sections.push({ id, label: LABEL[id], chars: text.length, clipped, ...(extra || {}) });
  };

  for (const id of SECTION_IDS) {
    if (include[id] !== true) continue;
    try {
      if (id === 'claude') {
        const c = await claudeSection(claudeHub, query, Math.min(CLAUDE_RESERVE, TOTAL_MAX - used - 2));
        if (!c.text) sections.push({ id, label: LABEL[id], chars: 0, clipped: false, cites: [], ...(c.note ? { note: c.note } : {}) });
        else add(id, c.text, { cites: c.cites, ...(c.note ? { note: c.note } : {}) });
        continue;
      }
      if (id === 'vault') { add(id, await vaultSection(vaultDir, query)); continue; }
      if (id === 'health') { add(id, healthSection(readJson(path.join(dataDir, 'pc-health.json')))); continue; }
      if (!S) { sections.push({ id, label: LABEL[id], chars: 0, clipped: false, note: 'no scan data yet' }); continue; }
      if (id === 'scan') add(id, scanSection(S));
      else if (id === 'tasks') add(id, tasksSection(S));
      else if (id === 'projects') add(id, projectsSection(S));
      else if (id === 'browser') add(id, browserSection(S.browser, activity, now));
    } catch (e) {
      sections.push({ id, label: LABEL[id], chars: 0, clipped: false, note: `failed: ${String(e?.message || e).slice(0, 80)}` });
    }
  }
  if (sections.every((s) => !s.chars)) parts.push('(No context sections were included — answer only general questions and tell the user to tick a source.)');
  const text = parts.join('\n\n');
  return { text, sections, chars: text.length };
}

module.exports = { assemble, claudeSection, SECTION_IDS, CLAUDE_RESERVE };

// Browser-activity aggregator for the "Working On Now" insight.
//
// Input: data/browser-activity.json (written by the Electron bridge from the
// WorkspaceHQ Bridge extension) — { updated, live, events[] } where each event
// is { domain, host, port, path, url, title, ts, focus_ms }.
//
// Output: a deterministic `browser` block for latest.json. Pure over its inputs
// (no clock reads) so the golden harness stays stable: it aggregates whatever is
// in the file; the rolling-window pruning happens on the ingest side.

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// 4-5 digit ports mentioned in a dev_cmd (e.g. "http.server 5500", ":8080").
function portsOf(cmd) {
  return new Set((String(cmd || '').match(/\b\d{4,5}\b/g) || []));
}

// Distinctive tokens for matching a project to a URL (repo slug, domain, name).
function tokensOf(p) {
  const base = String(p.path || '').split(/[\\/]/).pop() || '';
  const raw = [...slug(p.name).split(' '), ...slug(base).split(' '), slug(p.id)];
  return [...new Set(raw)].filter((t) => t && t.length >= 4);
}

const isLocal = (host) => /^(localhost|127\.0\.0\.1)(:|$)/.test(String(host || ''));
const bareHost = (host) => String(host || '').split(':')[0].toLowerCase();

// Priority: explicit config (browser_domains) > localhost dev-port > name/repo slug.
function assignProject(ev, ctx) {
  const host = ev.host || ev.domain || '';
  const bh = bareHost(host);
  for (const { needle, id } of ctx.domainMap) {
    if (bh === needle || bh.endsWith('.' + needle)) return id;
  }
  if (isLocal(host)) {
    const port = ev.port || (host.split(':')[1] || '');
    const hit = port && ctx.portMap.get(String(port));
    return hit || null;   // an unmapped localhost port is "just localhost"
  }
  const hay = slug(`${host} ${ev.path || ''}`);
  for (const p of ctx.projects) {
    const toks = ctx.projTokens.get(p.id) || [];
    if (toks.some((t) => hay.includes(t))) return p.id;
  }
  return null;
}

export function buildBrowser(activity, projects = []) {
  if (!activity || !Array.isArray(activity.events) || !activity.events.length) {
    return { captured: false, updated: activity?.updated || null, current: null, by_domain: [], by_project: [], totals: { focus_ms: 0, visits: 0, domains: 0 } };
  }

  const portMap = new Map();
  const projTokens = new Map();
  const domainMap = [];   // [{needle, id}] from each project's browser_domains config
  for (const p of projects) {
    projTokens.set(p.id, tokensOf(p));
    for (const port of portsOf(p.dev_cmd)) if (!portMap.has(port)) portMap.set(port, p.id);
    for (const d of p.browser_domains || []) { const needle = bareHost(d); if (needle) domainMap.push({ needle, id: p.id }); }
  }
  const ctx = { projects, portMap, projTokens, domainMap };
  const projName = new Map(projects.map((p) => [p.id, p.name]));

  const domains = new Map();     // domain -> {focus_ms, visits, last_ts, title}
  const byProj = new Map();      // project_id -> {focus_ms, visits, domains:Set}
  let totalFocus = 0;

  for (const ev of activity.events) {
    if (!ev || !ev.domain) continue;
    const focus = Number(ev.focus_ms) || 0;
    totalFocus += focus;

    const d = domains.get(ev.domain) || { domain: ev.domain, focus_ms: 0, visits: 0, last_ts: 0, title: '' };
    d.focus_ms += focus; d.visits += 1;
    if ((ev.ts || 0) >= d.last_ts) { d.last_ts = ev.ts || 0; if (ev.title) d.title = ev.title; }
    domains.set(ev.domain, d);

    const pid = assignProject(ev, ctx);
    if (pid) {
      const pr = byProj.get(pid) || { project_id: pid, project_name: projName.get(pid) || pid, focus_ms: 0, visits: 0, _domains: new Set() };
      pr.focus_ms += focus; pr.visits += 1; pr._domains.add(ev.domain);
      byProj.set(pid, pr);
    }
  }

  const by_domain = [...domains.values()]
    .sort((a, b) => (b.focus_ms - a.focus_ms) || a.domain.localeCompare(b.domain))
    .slice(0, 15);

  const by_project = [...byProj.values()]
    .map((pr) => ({ project_id: pr.project_id, project_name: pr.project_name, focus_ms: pr.focus_ms, visits: pr.visits, domains: [...pr._domains].sort() }))
    .sort((a, b) => (b.focus_ms - a.focus_ms) || a.project_id.localeCompare(b.project_id));

  // "current" = the live session if the bridge sent one, else the most recent event.
  const src = activity.live || [...activity.events].sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
  const current = src ? {
    domain: src.domain, host: src.host || src.domain, title: src.title || '', url: src.url || '',
    focus_ms: Number(src.focus_ms) || 0,
    project_id: assignProject(src, ctx),
    live: !!activity.live,
  } : null;

  return {
    captured: true,
    updated: activity.updated || null,
    current,
    by_domain,
    by_project,
    totals: { focus_ms: totalFocus, visits: activity.events.length, domains: domains.size },
  };
}

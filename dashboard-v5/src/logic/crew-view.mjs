// The Crew's pure view logic (Claude > Crew; main side: dashboard/crew.js, hq:crew:read). Rows arrive finished from main; this file
// re-checks them (an unknown role, a bad id or a non-string never reaches the screen), searches them, groups them by role in main's own
// role order, and pages them: 12 rows a role, 60 rows a page while searching. No DOM, no clock, no IPC.
export const CRW_PER_ROLE = 12;
export const CRW_PAGE = 60;
export const CRW_QUERY_MAX = 80;
export const CRW_OFF = 'The Crew needs the desktop app';
export const CRW_ID_RE = /^[A-Za-z0-9._:-]+$/;
const ID_MAX = 100;
const CTRL = /[\u0000-\u001f\u007f-\u009f]+/g;

const str = (x, n) => (typeof x === 'string' ? Array.from(x.replace(CTRL, ' ')).slice(0, n).join('').trim() : '');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** The roles main sent, [{ id, label }] in its order; 'other' is always there so no row can fall off the list. */
export function crwCleanRoles(roles) {
  const out = [];
  for (const r of Array.isArray(roles) ? roles : []) {
    if (!isObj(r) || typeof r.id !== 'string' || !/^[a-z]{2,16}$/.test(r.id) || out.some((x) => x.id === r.id)) continue;
    out.push({ id: r.id, label: str(r.label, 40) || r.id });
  }
  if (!out.some((r) => r.id === 'other')) out.push({ id: 'other', label: 'Other' });
  return out;
}

/** One row from main, made safe; null when it has no name. A bad or empty id gives a row with no Start. */
export function crwCleanRow(r, roleIds) {
  if (!isObj(r)) return null;
  const name = str(r.name, 100);
  if (!name) return null;
  const idOk = typeof r.id === 'string' && r.id.length > 0 && r.id.length <= ID_MAX && CRW_ID_RE.test(r.id);
  const role = typeof r.role === 'string' && roleIds.has(r.role) ? r.role : 'other';
  return { id: idOk ? r.id : '', name, description: str(r.description, 140), role, plugin: str(r.plugin, 60), canStart: idOk && r.canStart === true };
}

/** { roles, rows } from the whole of main's answer. */
export function crwCleanRoster(a) {
  const roles = crwCleanRoles(a && a.roles), ids = new Set(roles.map((r) => r.id));
  const rows = [];
  for (const r of Array.isArray(a && a.skills) ? a.skills : []) { const c = crwCleanRow(r, ids); if (c) rows.push(c); }
  return { roles, rows };
}

export const crwCleanQuery = (q) => (typeof q === 'string' ? q.replace(CTRL, ' ').slice(0, CRW_QUERY_MAX) : '');

/** Every typed word must appear in the row's name, plugin, description or role label (case and accents ignored). */
export function crwFilter(rows, q, roles) {
  const tokens = norm(crwCleanQuery(q)).split(/\s+/).filter(Boolean);
  if (!tokens.length) return rows;
  const label = new Map((roles || []).map((r) => [r.id, norm(r.label)]));
  return rows.filter((r) => {
    const hay = norm(r.name) + ' ' + norm(r.plugin) + ' ' + norm(r.description) + ' ' + (label.get(r.role) || '');
    return tokens.every((t) => hay.includes(t));
  });
}

/**
 * What the screen draws.
 *   searching false: groups = every role with rows, in main's role order, each showing 12 rows (all of them once its role is in `open`)
 *   searching true:  flat = the matches, 60 a page (`page` pages are shown), groups empty
 */
export function crwView({ rows = [], roles = [], q = '', page = 1, open = {} } = {}) {
  const query = crwCleanQuery(q).trim();
  if (query) {
    const hits = crwFilter(rows, query, roles);
    const shown = hits.slice(0, CRW_PAGE * Math.max(1, Math.floor(page) || 1));
    return { searching: true, total: rows.length, matches: hits.length, flat: shown, flatMore: Math.max(0, hits.length - shown.length), groups: [] };
  }
  const groups = [];
  for (const role of roles) {
    const mine = rows.filter((r) => r.role === role.id);
    if (!mine.length) continue;
    const expanded = !!(open && open[role.id]);
    const shown = expanded ? mine : mine.slice(0, CRW_PER_ROLE);
    groups.push({ role: role.id, label: role.label, count: mine.length, rows: shown, more: mine.length - shown.length, expanded, canCollapse: expanded && mine.length > CRW_PER_ROLE });
  }
  return { searching: false, total: rows.length, matches: rows.length, flat: [], flatMore: 0, groups };
}

// The Crew, pure half (Claude > Crew; plan batch 8, dish 2). No file, no process, no clock: text in, plain rows out.
//
//   parseSkillHead(text)            -> { name, description }   frontmatter only, the first 2 KB of the file, never the body
//   assignRole({ plugin, name, description }) -> a role id from ROLES (never throws; 'other' when nothing fits)
//   plainText(s, max)               -> one line of plain text, control characters gone, cut at max with an ellipsis
//   groupByRole(rows)               -> [{ role, label, rows }] in ROLES order, only roles that have rows, rows by name
//   validId(id)                     -> boolean   the one shape a skill id may have (ID_RE, at most ID_MAX characters)
//   buildStartPrompt(id)            -> the fixed sentence with the validated id, or null for a bad id
//
// Trust. A skill is a file somebody else wrote. Its frontmatter name and description are shown as plain text and used for
// nothing else: the id a session starts with is the FOLDER name (plus the plugin's own name for a plugin skill), checked
// against ID_RE, and the prompt is a fixed sentence around that id. The description never reaches a prompt or a command.
export const HEAD_BYTES = 2048;
export const DESC_MAX = 140;
export const ID_RE = /^[A-Za-z0-9._:-]+$/;
export const ID_MAX = 100;   // the fixed sentence plus an id must survive the launcher's 500 character cut

export const ROLES = Object.freeze([
  Object.freeze({ id: 'developers', label: 'Developers' }),
  Object.freeze({ id: 'designers', label: 'Designers' }),
  Object.freeze({ id: 'marketing', label: 'Marketing' }),
  Object.freeze({ id: 'finance', label: 'Finance' }),
  Object.freeze({ id: 'legal', label: 'Legal' }),
  Object.freeze({ id: 'operations', label: 'Operations' }),
  Object.freeze({ id: 'sales', label: 'Sales' }),
  Object.freeze({ id: 'people', label: 'People' }),
  Object.freeze({ id: 'data', label: 'Data' }),
  Object.freeze({ id: 'product', label: 'Product' }),
  Object.freeze({ id: 'other', label: 'Other' }),
]);
const ROLE_IDS = new Set(ROLES.map((r) => r.id));

// public marketplace plugin names only (the plugin's own name, never the installing person's choices)
export const PLUGIN_ROLES = Object.freeze({
  engineering: 'developers', 'engineering-skills': 'developers', 'feature-dev': 'developers', vercel: 'developers', supabase: 'developers', postman: 'developers', 'code-review': 'developers',
  design: 'designers', 'ui-design': 'designers', figma: 'designers', 'frontend-design': 'designers',
  marketing: 'marketing', 'marketing-skills': 'marketing', 'searchfit-seo': 'marketing', 'brand-voice': 'marketing',
  finance: 'finance',
  legal: 'legal',
  operations: 'operations', 'customer-support': 'operations', 'small-business': 'operations',
  sales: 'sales',
  'human-resources': 'people',
  data: 'data',
  'product-management': 'product', 'product-skills': 'product',
});

// word stems, matched against the start of each word of the skill's folder name, then of its description
export const NAME_STEMS = Object.freeze({
  developers: ['code', 'test', 'debug', 'deploy', 'api', 'backend', 'frontend', 'review', 'refactor', 'git', 'devops', 'python', 'react', 'typescript', 'lint', 'tdd', 'architect'],
  designers: ['design', 'ui', 'ux', 'figma', 'visual', 'css', 'layout', 'brand', 'accessib', 'typograph'],
  marketing: ['seo', 'content', 'campaign', 'social', 'email', 'copywrit', 'marketing', 'ads', 'newsletter'],
  finance: ['finance', 'invoice', 'tax', 'budget', 'payroll', 'ledger', 'audit', 'journal', 'reconcil', 'expense'],
  legal: ['legal', 'contract', 'compliance', 'nda', 'privacy', 'clause', 'counsel'],
  operations: ['ops', 'runbook', 'process', 'incident', 'vendor', 'status', 'support', 'ticket', 'logistic'],
  sales: ['sales', 'lead', 'pipeline', 'crm', 'outreach', 'deal', 'forecast', 'prospect'],
  people: ['hiring', 'recruit', 'interview', 'onboarding', 'people', 'offer', 'performance', 'candidate', 'hr'],
  data: ['data', 'analytic', 'dashboard', 'chart', 'statistic', 'query', 'sql', 'metric', 'dataset'],
  product: ['product', 'roadmap', 'spec', 'backlog', 'sprint', 'prd', 'stakeholder', 'persona'],
});

const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const wordsOf = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const clipChars = (s, n) => { const c = Array.from(s); return c.length <= n ? s : c.slice(0, n - 1).join('').trimEnd() + '…'; };

/** One line of plain text: control and bidi-control characters become spaces, runs of space collapse, cut at max characters. */
export function plainText(s, max = DESC_MAX) {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clipChars(t, max);
}

function unquote(v) {
  const s = v.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) return s.slice(1, -1);
  return s;
}

/**
 * The frontmatter's name and description from the first 2 KB of a SKILL.md. Reads between the opening --- line and the next ---
 * line only; text with no frontmatter, no closing line inside the 2 KB, or lines it cannot read gives empty strings (name-only
 * rows). A block description (> or |) and an indented continuation are joined with spaces. The body is never looked at.
 */
export function parseSkillHead(text) {
  const out = { name: '', description: '' };
  if (typeof text !== 'string' || !text) return out;
  const lines = text.slice(0, HEAD_BYTES).replace(/^﻿/, '').split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== '---') return out;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { end = i; break; }
  if (end < 0) return out;   // the head was cut before the frontmatter closed: odd, so name-only
  const fm = lines.slice(1, end);
  const read = (key) => {
    for (let i = 0; i < fm.length; i++) {
      const m = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(fm[i]);
      if (!m || m[1].toLowerCase() !== key) continue;
      let v = m[2];
      if (/^[>|][+-]?\s*$/.test(v.trim()) || v.trim() === '') {
        const parts = [];
        for (let j = i + 1; j < fm.length && /^\s+\S/.test(fm[j]); j++) parts.push(fm[j].trim());
        v = parts.join(' ');
      } else {
        const parts = [v];
        for (let j = i + 1; j < fm.length && /^\s+\S/.test(fm[j]); j++) parts.push(fm[j].trim());
        v = parts.join(' ');
      }
      return unquote(v);
    }
    return '';
  };
  out.name = plainText(read('name'), 100);
  out.description = plainText(read('description'), 400);
  return out;
}

/** A role id. The plugin table first (public plugin names), then the folder name's stems, then the description's, else 'other'. */
export function assignRole({ plugin, name, description } = {}) {
  const p = norm(plugin);
  if (p && Object.prototype.hasOwnProperty.call(PLUGIN_ROLES, p)) return PLUGIN_ROLES[p];
  const hit = (words) => {
    let best = null, bestN = 0;
    for (const role of Object.keys(NAME_STEMS)) {
      let n = 0;
      for (const stem of NAME_STEMS[role]) if (words.some((w) => w.startsWith(stem))) n++;
      if (n > bestN) { best = role; bestN = n; }   // ROLES order breaks a tie: the earlier role keeps it
    }
    return best;
  };
  return hit(wordsOf(name)) || hit(wordsOf(description)) || 'other';
}

export function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= ID_MAX && ID_RE.test(id); }

/** Rows grouped by role, in ROLES order, only roles with rows; rows by name then id. */
export function groupByRole(rows) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const role = r && ROLE_IDS.has(r.role) ? r.role : 'other';
    if (!by.has(role)) by.set(role, []);
    by.get(role).push(r);
  }
  const cmp = (a, b) => String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' }) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  return ROLES.filter((r) => by.has(r.id)).map((r) => ({ role: r.id, label: r.label, rows: by.get(r.id).slice().sort(cmp) }));
}

/** The seed sentence for a session. Only a validated id goes in; everything else about the skill stays out. */
export function buildStartPrompt(id) {
  return validId(id) ? 'Use the ' + id + ' skill to help me with:' : null;
}

#!/usr/bin/env node
// Spellbook scanner: catalogs the user's arsenal of automations as castable RPG
// spells -> data/spellbook.json. Five deterministic, READ-ONLY discovery passes:
//   1. Claude arsenal   (~/.claude/skills, plugin skills/commands, plugin tomes)
//   2. Scripts          (workspace-root *.ps1/*.mjs)
//   3. npm scripts      (per product from collector.config.json)
//   4. Scheduled tasks  (schtasks CSV, non-Microsoft)
//   5. Grimoire         (spellbook/spells/*.md manifests — highest precedence)
// MCP servers are emitted separately as non-castable "familiars".
//
// The catalog is the casting engine's WHITELIST: main.js only ever executes
// commands that this scanner emitted, and the scanner only emits commands whose
// origin resolves under trusted roots. LLM enrichment (tooltip/school/rarity
// refinement) merges in via data/spellbook-enrichment.json when present, with
// precedence: override > manifest > enrichment > heuristic.
//
//   node collector/spellbook.mjs        (also runs inside run-pipeline.ps1, optional step)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HQ = path.resolve(__dirname, '..');
const DATA = path.join(HQ, 'data');
const GRIMOIRE = path.join(HQ, 'spellbook');
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'collector.config.json'), 'utf8'));
const SB = CFG.spellbook ?? {};
const CLAUDE_DIR = SB.claude_dir ?? path.join(os.homedir(), '.claude');
const PROJECT_ROOT = CFG.root;

const RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const SCHOOLS = ['divination', 'conjuration', 'transmutation', 'abjuration', 'evocation', 'illusion', 'enchantment', 'restoration'];
const SCHOOL_ICON = { divination: '🔮', conjuration: '✨', transmutation: '⚗️', abjuration: '🛡️', evocation: '⚡', illusion: '🎭', enchantment: '📣', restoration: '🩹' };

const sha1 = (s) => crypto.createHash('sha1').update(s ?? '').digest('hex');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const listDirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };
const listFiles = (p, re) => { try { return fs.readdirSync(p).filter((f) => re.test(f)); } catch { return []; } };

// ---------------------------------------------------------------- heuristics
const keywordRules = (SB.school_keywords ?? []).map((k) => ({ re: new RegExp(k.re, 'i'), school: k.school }));
function schoolFor(text) {
  for (const r of keywordRules) if (r.re.test(text)) return r.school;
  return 'evocation'; // it executes *something*
}
function bumpRarity(r, n) {
  return RARITY[Math.min(Math.max(RARITY.indexOf(r) + n, 0), RARITY.length - 2)]; // never auto-legendary
}

// --------------------------------------------------- tiny frontmatter parser
// Supports `key: value` lines; args/chain accept a JSON array; body = after 2nd ---.
function parseFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return { attrs: {}, body: md };
  const attrs = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[')) { try { v = JSON.parse(v); } catch { /* keep raw */ } }
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^-?\d+$/.test(v)) v = Number(v);
    else v = v.replace(/^["']|["']$/g, '');
    attrs[kv[1]] = v;
  }
  return { attrs, body: m[2].trim() };
}

// Placeholders keep grimoire manifests relocatable; expanded HERE (trusted side),
// never at cast time.
const expandVars = (s) => typeof s === 'string'
  ? s.replaceAll('{{HQ}}', HQ).replaceAll('{{PROJECTS}}', PROJECT_ROOT)
  : s;

// ----------------------------------------------------------------- the forge
const spells = [];
const familiars = [];
const warn = (msg) => console.error('[spellbook] ' + msg);

function addSpell(s) {
  const text = `${s.name} ${s.description ?? ''} ${s.origin_path ?? ''}`;
  const spell = {
    id: s.id,
    name: s.name,
    source: s.source,
    kind: s.kind ?? 'castable',
    command: s.command ?? null,
    args: s.args ?? [],
    cwd: s.cwd ?? null,
    school: s.school ?? schoolFor(text),
    rarity: s.rarity ?? 'common',
    icon: s.icon ?? null,
    description: (s.description ?? '').slice(0, 240),
    tooltip: null,           // filled by enrichment (Phase 7)
    body: (s.body ?? '').slice(0, 2048),
    content_hash: s.content_hash ?? sha1(s.id),
    origin_path: s.origin_path ?? null,
    schedule: s.schedule ?? null,
    confirm: s.confirm ?? false,
    timeout_min: s.timeout_min ?? 10,
    chain: s.chain ?? null,
    invalid: false,
  };
  if (!spell.icon) spell.icon = SCHOOL_ICON[spell.school] ?? '✴️';
  spells.push(spell);
}

// Trust boundary: castable spells must originate under roots the user owns.
const TRUSTED_ROOTS = [CLAUDE_DIR, HQ, PROJECT_ROOT].map((p) => path.resolve(p).toLowerCase());
const underTrustedRoot = (p) => {
  if (!p) return false;
  const rp = path.resolve(p).toLowerCase();
  return TRUSTED_ROOTS.some((r) => rp === r || rp.startsWith(r + path.sep));
};

// ------------------------------------------------ pass 1: the Claude arsenal
function skillSpell(dir, skillName, prefix, castName) {
  const md = readIf(path.join(dir, 'SKILL.md'));
  if (md == null) return;
  const { attrs } = parseFrontmatter(md);
  addSpell({
    id: `${prefix}${slug(castName)}`,
    name: attrs.name || skillName,
    source: 'skill',
    kind: 'channeled',                                   // runs inside a Claude session
    command: 'claude',
    args: ['/' + castName],
    cwd: PROJECT_ROOT,
    description: attrs.description || '',
    content_hash: sha1(md),
    origin_path: path.join(dir, 'SKILL.md'),
    rarity: fs.existsSync(path.join(dir, 'references')) || fs.existsSync(path.join(dir, 'scripts')) ? 'uncommon' : 'common',
  });
}

function scanClaudeArsenal() {
  // Personal skills
  const skillsDir = path.join(CLAUDE_DIR, 'skills');
  const ignore = new Set(SB.ignore_skill_dirs ?? []);
  for (const name of listDirs(skillsDir)) {
    if (ignore.has(name)) continue;
    skillSpell(path.join(skillsDir, name), name, 'skill:', name);
  }

  // Personal agents/commands (*.md) — currently empty dirs, future-proof
  for (const [sub, prefix] of [['agents', 'agent:'], ['commands', 'command:']]) {
    const dir = path.join(CLAUDE_DIR, sub);
    for (const f of listFiles(dir, /\.md$/)) {
      const md = readIf(path.join(dir, f));
      if (md == null) continue;
      const { attrs } = parseFrontmatter(md);
      const name = attrs.name || f.replace(/\.md$/, '');
      addSpell({
        id: `${prefix}${slug(name)}`,
        name,
        source: sub === 'agents' ? 'agent' : 'command',
        kind: 'channeled',
        command: 'claude',
        args: ['/' + name],
        cwd: PROJECT_ROOT,
        description: attrs.description || '',
        content_hash: sha1(md),
        origin_path: path.join(dir, f),
      });
    }
  }

  // Installed plugins: each bundle is a non-castable "tome"; its skills/ and
  // commands/ are the real castable spells (invoked as /plugin:skill).
  const manifest = readIf(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'));
  if (!manifest) { warn('no installed_plugins.json — skipping plugins'); return; }
  let plugins;
  try { plugins = JSON.parse(manifest).plugins ?? {}; } catch { warn('unparseable installed_plugins.json'); return; }

  for (const [key, installs] of Object.entries(plugins)) {
    const inst = Array.isArray(installs) ? installs[0] : installs;
    if (!inst?.installPath || !fs.existsSync(inst.installPath)) continue;
    const pluginName = key.split('@')[0];
    const pj = (() => {
      for (const c of ['.claude-plugin/plugin.json', 'plugin.json']) {
        const t = readIf(path.join(inst.installPath, c));
        if (t) { try { return JSON.parse(t); } catch { /* ignore */ } }
      }
      return {};
    })();

    addSpell({
      id: `plugin:${slug(pluginName)}`,
      name: pluginName,
      source: 'plugin',
      kind: 'tome',                                       // collection item, not castable
      description: pj.description || `Installed plugin (${key.split('@')[1] ?? 'marketplace'})`,
      content_hash: sha1(inst.version ?? inst.gitCommitSha ?? pluginName),
      origin_path: inst.installPath,
      rarity: 'uncommon',
      icon: '📦',
    });

    for (const skillName of listDirs(path.join(inst.installPath, 'skills'))) {
      skillSpell(path.join(inst.installPath, 'skills', skillName), skillName,
        `skill:${slug(pluginName)}:`, `${pluginName}:${skillName}`);
    }
    const cmdDir = path.join(inst.installPath, 'commands');
    for (const f of listFiles(cmdDir, /\.md$/)) {
      const md = readIf(path.join(cmdDir, f));
      if (md == null) continue;
      const { attrs } = parseFrontmatter(md);
      const cmdName = f.replace(/\.md$/, '');
      addSpell({
        id: `command:${slug(pluginName)}:${slug(cmdName)}`,
        name: attrs.name || `${pluginName}:${cmdName}`,
        source: 'command',
        kind: 'channeled',
        command: 'claude',
        args: [`/${pluginName}:${cmdName}`],
        cwd: PROJECT_ROOT,
        description: attrs.description || '',
        content_hash: sha1(md),
        origin_path: path.join(cmdDir, f),
      });
    }
  }
}

// ------------------------------------------- pass 2: workspace-root scripts
function scanScripts() {
  for (const f of listFiles(HQ, /\.(ps1|mjs)$/)) {
    const full = path.join(HQ, f);
    const src = readIf(full) ?? '';
    const firstComment = (src.split(/\r?\n/).find((l) => /^\s*(#|\/\/)/.test(l)) ?? '')
      .replace(/^\s*(#|\/\/)\s?/, '').trim();
    const isPs = f.endsWith('.ps1');
    const lines = src.split(/\r?\n/).length;
    addSpell({
      id: `script:${slug(f.replace(/\.(ps1|mjs)$/, ''))}`,
      name: f.replace(/\.(ps1|mjs)$/, ''),
      source: 'script',
      command: isPs ? 'powershell' : 'node',
      args: isPs ? ['-ExecutionPolicy', 'Bypass', '-File', full] : [full],
      cwd: HQ,
      description: firstComment,
      content_hash: sha1(src),
      origin_path: full,
      rarity: lines > 200 ? 'rare' : 'uncommon',
      confirm: true,                                       // scripts touch the pipeline — always preview
      timeout_min: 20,
    });
  }
}

// -------------------------------------------------- pass 3: product npm runs
function resolveProductPath(p) {
  const abs = path.join(PROJECT_ROOT, p);
  if (!p.includes('*')) return fs.existsSync(abs) ? abs : null;
  const [pre, post] = p.split('*');
  const parent = path.join(PROJECT_ROOT, path.dirname(pre + 'x'));
  const prefix = path.basename(pre + 'x').slice(0, -1);
  for (const d of listDirs(parent)) {
    if (d.startsWith(prefix)) {
      const cand = path.join(parent, d + (post ?? ''));
      if (fs.existsSync(cand)) return cand;
    }
  }
  return null;
}

function scanNpmScripts() {
  const channeled = new Set(SB.channeled_npm_scripts ?? ['dev', 'start', 'serve']);
  for (const prod of CFG.products ?? []) {
    const dir = resolveProductPath(prod.path);
    if (!dir) continue;
    const pkgRaw = readIf(path.join(dir, 'package.json'));
    if (!pkgRaw) continue;
    let scripts;
    try { scripts = JSON.parse(pkgRaw).scripts ?? {}; } catch { continue; }
    for (const [name, cmd] of Object.entries(scripts)) {
      if (typeof cmd !== 'string' || /^echo .Error/.test(cmd)) continue; // npm placeholder
      addSpell({
        id: `npm:${prod.id}:${slug(name)}`,
        name: `${prod.name} · ${name}`,
        source: 'npm',
        kind: channeled.has(name) ? 'channeled' : 'castable',
        // npm is npm.cmd on Windows — spawn via cmd /c with tokenized args (no interpolation)
        command: 'cmd',
        args: ['/c', 'npm', 'run', name],
        cwd: dir,
        description: cmd.slice(0, 160),
        content_hash: sha1(prod.id + ':' + name + ':' + cmd),
        origin_path: path.join(dir, 'package.json'),
        rarity: /deploy|release|publish/.test(name) ? 'rare' : 'common',
        confirm: /deploy|release|publish/.test(name),
      });
    }
  }
}

// ----------------------------------------------- pass 4: scheduled tasks
function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function scanScheduledTasks() {
  let csv;
  try {
    csv = execFileSync('schtasks', ['/Query', '/FO', 'CSV', '/V'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  } catch (e) { warn('schtasks query failed: ' + e.message); return; }

  const rows = csv.split(/\r?\n/).filter(Boolean);
  if (!rows.length) return;
  // /V repeats the header per task folder; find columns defensively (locale risk:
  // on a non-English header we bail per-field to null, spell still listed).
  const header = parseCsvLine(rows[0]);
  const col = (name) => header.indexOf(name);
  const iName = col('TaskName'), iNext = col('Next Run Time'), iLast = col('Last Run Time'),
    iResult = col('Last Result'), iRun = col('Task To Run'), iComment = col('Comment'), iState = col('Scheduled Task State');
  if (iName === -1) { warn('schtasks: no TaskName column (locale?) — skipping tasks'); return; }

  const seen = new Set();
  for (const row of rows.slice(1)) {
    if (row.startsWith('"HostName"')) continue;           // repeated header
    const cells = parseCsvLine(row);
    const taskName = cells[iName];
    if (!taskName || taskName.startsWith('\\Microsoft\\') || seen.has(taskName)) continue;
    seen.add(taskName);
    const clean = (v) => (v && v !== 'N/A' ? v : null);
    const display = taskName.replace(/^\\/, '');
    addSpell({
      id: `task:${slug(display)}`,
      name: display,
      source: 'task',
      command: 'schtasks',
      args: ['/Run', '/TN', taskName],
      cwd: HQ,
      description: clean(cells[iComment]) ?? `Scheduled: ${clean(cells[iRun]) ?? ''}`.trim(),
      content_hash: sha1(taskName + ':' + (cells[iRun] ?? '')),
      origin_path: null,                                   // trusted by name capture, not path
      schedule: {
        next_run: clean(cells[iNext]),
        last_run: clean(cells[iLast]),
        last_result: clean(cells[iResult]),
        state: clean(cells[iState]),
      },
      rarity: 'uncommon',
      icon: '⏰',
    });
  }
}

// ------------------------------------------------------- pass 5: grimoire
function scanGrimoire() {
  const dir = path.join(GRIMOIRE, 'spells');
  for (const f of listFiles(dir, /\.md$/)) {
    const md = readIf(path.join(dir, f));
    if (md == null) continue;
    const { attrs, body } = parseFrontmatter(md);
    if (!attrs.name) { warn(`grimoire ${f}: missing name — skipped`); continue; }
    const id = 'grimoire:' + slug(attrs.id || f.replace(/\.md$/, ''));
    const isChain = attrs.kind === 'chain';
    if (!isChain && !attrs.command) { warn(`grimoire ${f}: missing command — skipped`); continue; }
    // A grimoire manifest with the same id as a discovered spell shadows it.
    const shadowId = attrs.id ? String(attrs.id) : null;
    if (shadowId) {
      const i = spells.findIndex((s) => s.id === shadowId);
      if (i > -1) spells.splice(i, 1);
    }
    addSpell({
      id: shadowId && shadowId.includes(':') ? shadowId : id,
      name: attrs.name,
      source: 'grimoire',
      kind: attrs.kind ?? 'castable',
      command: expandVars(attrs.command) ?? null,
      args: (Array.isArray(attrs.args) ? attrs.args : []).map(expandVars),
      cwd: expandVars(attrs.cwd) ?? HQ,
      school: SCHOOLS.includes(attrs.school) ? attrs.school : undefined,
      rarity: isChain ? 'epic' : (RARITY.includes(attrs.rarity) ? attrs.rarity : 'rare'),
      icon: attrs.icon,
      description: attrs.description || body.split(/\r?\n/).find((l) => l.trim()) || '',
      body,
      content_hash: sha1(md),
      origin_path: path.join(dir, f),
      confirm: isChain ? true : (attrs.confirm ?? false),
      timeout_min: attrs.timeout_min,
      chain: Array.isArray(attrs.chain) ? attrs.chain : null,
    });
  }
}

// ------------------------------------------------------------- familiars
function scanFamiliars() {
  const cj = readIf(path.join(os.homedir(), '.claude.json'));
  if (cj) {
    try {
      const servers = JSON.parse(cj).mcpServers ?? {};
      for (const [name, cfg] of Object.entries(servers)) {
        familiars.push({
          id: `mcp:${slug(name)}`,
          name,
          transport: cfg.type ?? (cfg.url ? 'http' : 'stdio'),
          detail: (cfg.command ? [cfg.command, ...(cfg.args ?? [])].join(' ') : cfg.url ?? '').slice(0, 160),
          school: schoolFor(name),
          configured: true,
          scope: 'user',
        });
      }
    } catch { warn('unparseable ~/.claude.json'); }
  }
  // Project-level .mcp.json files
  for (const prod of CFG.products ?? []) {
    const dir = resolveProductPath(prod.path);
    const raw = dir && readIf(path.join(dir, '.mcp.json'));
    if (!raw) continue;
    try {
      for (const [name, cfg] of Object.entries(JSON.parse(raw).mcpServers ?? {})) {
        familiars.push({
          id: `mcp:${prod.id}:${slug(name)}`,
          name: `${name} (${prod.name})`,
          transport: cfg.type ?? (cfg.url ? 'http' : 'stdio'),
          detail: (cfg.command ? [cfg.command, ...(cfg.args ?? [])].join(' ') : cfg.url ?? '').slice(0, 160),
          school: schoolFor(name),
          configured: true,
          scope: 'project',
        });
      }
    } catch { /* malformed project mcp — skip */ }
  }
}

// ------------------------------------------------------------------ assemble
scanClaudeArsenal();
scanScripts();
scanNpmScripts();
scanScheduledTasks();
scanGrimoire();
scanFamiliars();

// Chain validation: every referenced id must exist and not itself be a chain.
const byId = new Map(spells.map((s) => [s.id, s]));
for (const s of spells) {
  if (!s.chain) continue;
  const bad = s.chain.filter((ref) => !byId.has(ref) || byId.get(ref).chain);
  if (bad.length) { s.invalid = true; s.description = `⚠ broken chain refs: ${bad.join(', ')} · ${s.description}`; }
}

// Trust boundary: drop castables whose origin/cwd escape trusted roots
// (scheduled tasks are trusted by captured name instead of path).
const kept = spells.filter((s) => {
  if (s.kind === 'tome' || s.source === 'task') return true;
  const ok = underTrustedRoot(s.origin_path) && (!s.cwd || underTrustedRoot(s.cwd) || s.cwd === PROJECT_ROOT);
  if (!ok) warn(`dropped ${s.id}: origin/cwd outside trusted roots`);
  return ok;
});

// Enrichment merge (Phase 7 writes this; tolerate absence). Manifested/overridden
// fields win later — enrichment only fills what heuristics guessed.
let enrichment = {};
try { enrichment = JSON.parse(fs.readFileSync(path.join(DATA, 'spellbook-enrichment.json'), 'utf8')); } catch { /* not enriched yet */ }
for (const s of kept) {
  const e = enrichment[s.id];
  if (!e || e.hash !== s.content_hash) continue;
  s.tooltip = e.tooltip ?? null;
  if (s.source !== 'grimoire') {
    if (SCHOOLS.includes(e.school)) s.school = e.school;
    if (RARITY.includes(e.rarity) && e.rarity !== 'legendary') s.rarity = e.rarity;
  }
}

// User overrides — final word.
let overrides = {};
try { overrides = JSON.parse(fs.readFileSync(path.join(GRIMOIRE, 'overrides.json'), 'utf8')); } catch { /* none */ }
const visible = [];
for (const s of kept) {
  const o = overrides[s.id];
  if (o) {
    if (o.hidden) continue;
    if (o.name) s.name = o.name;
    if (SCHOOLS.includes(o.school)) s.school = o.school;
    if (RARITY.includes(o.rarity)) s.rarity = o.rarity;   // overrides MAY grant legendary
    if (o.icon) s.icon = o.icon;
  }
  visible.push(s);
}
visible.sort((a, b) => a.name.localeCompare(b.name));

const counts = { total: visible.length, by_source: {}, by_school: {}, familiars: familiars.length };
for (const s of visible) {
  counts.by_source[s.source] = (counts.by_source[s.source] ?? 0) + 1;
  counts.by_school[s.school] = (counts.by_school[s.school] ?? 0) + 1;
}

const out = { generated_at: new Date().toISOString(), counts, spells: visible, familiars };
fs.mkdirSync(DATA, { recursive: true });
const tmp = path.join(DATA, 'spellbook.json.tmp');
fs.writeFileSync(tmp, JSON.stringify(out, null, 1));
fs.renameSync(tmp, path.join(DATA, 'spellbook.json'));
console.log(`[spellbook] ${visible.length} spells (${Object.entries(counts.by_source).map(([k, v]) => `${k}:${v}`).join(' ')}) + ${familiars.length} familiars -> data/spellbook.json`);

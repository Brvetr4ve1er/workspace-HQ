// The Crew, main side (Claude > Crew; IPC-CONTRACT hq:crew:read and hq:crew:start; plan batch 8, dish 2).
// The installed Claude skills (loose ones under <claude home>/skills and each installed plugin's skills) as plain rows, and one
// button per row that opens a terminal session which starts with "Use the <id> skill to help me with:".
//
//   create({ env?, cwd, launchTools, launchFn?, toolsHelper?, fsApi?, now?, log?, coreLoader? }) -> { read(), start(id), _clear() }
//   init({ ipcMain, getWin, ...create deps }) -> the same object; registers the two channels
//
//   hq:crew:read  ()          -> { roles:[{id,label}], skills:[{ id, name, description, role, plugin, canStart }], total, generatedAt } | { error }
//   hq:crew:start { id }      -> { ok: true } | { error }
//     Main window only (event.sender === getWin().webContents, the security.js pattern). Answers are fixed words, never an error
//     message or a path. The roster never carries a body, a path or a frontmatter name.
//
// Where it reads. The Claude home is env.HQ_CLAUDE_HOME or ~/.claude, READ ONLY: this module never writes there. Loose skills are
// <home>/skills/<folder>/SKILL.md; plugin skills are <installPath>/skills/<folder>/SKILL.md for each entry of
// <home>/plugins/installed_plugins.json, and an installPath that does not resolve to a place inside the home is refused (a
// symlink out of the home is refused too). Folders that start with a dot (trash copies) and anything that is not a folder are skipped.
// Only the first 2 KB of each SKILL.md is read, never the body.
//
// What a Start can say. The id is the FOLDER name (a plugin skill: <plugin name>:<folder>), checked against crew-core's ID_RE, and
// it must be in the roster this module built itself; the frontmatter name never decides an id, so a skill cannot claim another's.
// The row of a folder that fails the check is listed without a Start (canStart false). The seed text is crew-core's fixed
// sentence around the validated id; the description never reaches it. The folder the session opens in is `cwd` (the app root,
// given by main), never read from the payload. The session ALWAYS goes through launch-tools (an explicit `--permission-mode default`):
// when its helper file is missing this module refuses to start rather than let claude-launch.js fall back to the helper with no mode.
// Limits: 6 starts an hour, and the same id not twice within 5 seconds.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchClaudeTerminal, TOOLS_HELPER } = require('./claude-launch');

const WIN = process.platform === 'win32';
const MAX_SKILLS = 3000;
const MAX_PLUGINS = 200;
const CACHE_MS = 60e3;
const HOUR_MS = 3600e3;
const MAX_STARTS_PER_HOUR = 6;
const SAME_ID_MS = 5e3;
const PLUGIN_NAME_RE = /^[A-Za-z0-9._-]{1,60}$/;
const NOT_HERE = 'not available here';
const WORDS = Object.freeze({
  read: 'the crew could not be read',
  unknown: 'that skill is not in the crew',
  rate: 'too many sessions started this hour',
  soon: 'that skill was just started',
  noTools: 'the session helper is missing',
  failed: 'a terminal could not be opened',
});

let corePromise = null;
const loadCore = () => corePromise || (corePromise = import(pathToFileURL(path.join(__dirname, 'crew-core.mjs')).href));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const norm = (p) => { let s = path.resolve(String(p)); if (s.length > path.parse(s).root.length) s = s.replace(/[\\/]+$/, ''); return WIN ? s.toLowerCase() : s; };
const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

function create({ env = process.env, cwd, launchTools, launchFn = launchClaudeTerminal, toolsHelper = TOOLS_HELPER, fsApi = fs, now = () => Date.now(), log = (l) => console.log(l), coreLoader = loadCore, home } = {}) {
  const claudeHome = () => home || env.HQ_CLAUDE_HOME || path.join(os.homedir(), '.claude');
  let cache = null;   // { sig, at, roster }
  const startTimes = [];
  const lastById = new Map();

  const statKey = (p) => { try { const s = fsApi.statSync(p); return s.mtimeMs + ':' + s.size; } catch { return 'x'; } };
  const realOf = (p) => { try { return typeof fsApi.realpathSync === 'function' ? fsApi.realpathSync(p) : p; } catch { return null; } };

  // the plugin skill folders that may be read: [{ pluginName, dir }]
  function pluginDirs(homeDir) {
    let raw;
    try { raw = JSON.parse(fsApi.readFileSync(path.join(homeDir, 'plugins', 'installed_plugins.json'), 'utf8')); } catch { return []; }
    const plugins = isObj(raw) && isObj(raw.plugins) ? raw.plugins : isObj(raw) ? raw : null;
    if (!plugins) return [];
    const realHome = realOf(homeDir);
    const out = [];
    for (const key of Object.keys(plugins).slice(0, MAX_PLUGINS)) {
      const installs = Array.isArray(plugins[key]) ? plugins[key] : [plugins[key]];
      const pluginName = String(key).split('@')[0];
      for (const inst of installs) {
        const ip = isObj(inst) && typeof inst.installPath === 'string' ? inst.installPath : '';
        if (!ip || !path.isAbsolute(ip)) continue;
        if (!within(norm(ip), norm(homeDir))) continue;
        const realIp = realOf(ip);
        if (!realIp || !realHome || !within(norm(realIp), norm(realHome))) continue;
        out.push({ pluginName, dir: path.join(ip, 'skills') });
      }
    }
    return out;
  }

  function skillFolders(dir) {
    let ents;
    try { ents = fsApi.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return ents.filter((e) => e && typeof e.name === 'string' && !e.name.startsWith('.') && e.isDirectory()).map((e) => e.name).sort();
  }

  // the first 2 KB of a file, never more
  function readHead(file, bytes) {
    let fd = null;
    try {
      fd = fsApi.openSync(file, 'r');
      const buf = Buffer.alloc(bytes);
      const n = fsApi.readSync(fd, buf, 0, bytes, 0);
      return buf.toString('utf8', 0, n);
    } catch { return null; } finally { if (fd !== null) { try { fsApi.closeSync(fd); } catch { /* closed */ } } }
  }

  function signature(homeDir, pdirs) {
    return [statKey(path.join(homeDir, 'plugins', 'installed_plugins.json')), statKey(path.join(homeDir, 'skills'))].concat(pdirs.map((p) => p.dir + '=' + statKey(p.dir))).join('|');
  }

  async function build() {
    const core = await coreLoader();
    const homeDir = claudeHome();
    const pdirs = pluginDirs(homeDir);
    const sig = signature(homeDir, pdirs);
    const t = now();
    if (cache && cache.sig === sig && t - cache.at < CACHE_MS) return cache.roster;
    const rows = [];
    const seen = new Set();
    const add = (pluginName, folder, file) => {
      if (rows.length >= MAX_SKILLS) return;
      const head = readHead(file, core.HEAD_BYTES);
      if (head === null) return;   // no SKILL.md in that folder
      const parsed = core.parseSkillHead(head);
      const pluginOk = !pluginName || PLUGIN_NAME_RE.test(pluginName);
      const id = pluginName ? (pluginOk ? pluginName + ':' + folder : '') : folder;
      const canStart = !!id && core.validId(id) && !seen.has(id);
      if (canStart) seen.add(id);
      rows.push({
        id: canStart ? id : '', name: core.plainText(folder, 100), description: core.plainText(parsed.description, core.DESC_MAX),
        role: core.assignRole({ plugin: pluginName, name: folder, description: parsed.description }),
        plugin: pluginName ? core.plainText(pluginName, 60) : '', canStart,
      });
    };
    for (const f of skillFolders(path.join(homeDir, 'skills'))) add('', f, path.join(homeDir, 'skills', f, 'SKILL.md'));
    for (const p of pdirs) for (const f of skillFolders(p.dir)) add(p.pluginName, f, path.join(p.dir, f, 'SKILL.md'));
    rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || (a.plugin < b.plugin ? -1 : a.plugin > b.plugin ? 1 : 0));
    const byId = new Map();
    for (const r of rows) if (r.canStart) byId.set(r.id, r);
    const roster = { rows, byId, generatedAt: new Date(t).toISOString() };
    cache = { sig, at: t, roster };
    return roster;
  }

  async function read() {
    try {
      const core = await coreLoader();
      const r = await build();
      return { roles: core.ROLES.map((x) => ({ id: x.id, label: x.label })), skills: r.rows.map((x) => ({ ...x })), total: r.rows.length, generatedAt: r.generatedAt };
    } catch { return { error: WORDS.read }; }
  }

  async function start(id) {
    try {
      const core = await coreLoader();
      if (!core.validId(id)) return { error: WORDS.unknown };
      const roster = await build();
      const row = roster.byId.get(id);
      if (!row) return { error: WORDS.unknown };
      if (!launchTools || typeof launchTools.prepare !== 'function' || typeof launchTools.buildArgs !== 'function') return { error: WORDS.noTools };
      let helperThere = false;
      try { helperThere = !!toolsHelper && fsApi.existsSync(toolsHelper); } catch { helperThere = false; }
      if (!helperThere) return { error: WORDS.noTools };   // claude-launch.js would fall back to the helper that has no permission mode
      const t = now();
      while (startTimes.length && t - startTimes[0] >= HOUR_MS) startTimes.shift();
      if (startTimes.length >= MAX_STARTS_PER_HOUR) return { error: WORDS.rate };
      const last = lastById.get(id);
      if (last !== undefined && t - last < SAME_ID_MS) return { error: WORDS.soon };
      startTimes.push(t); lastById.set(id, t);
      if (lastById.size > 500) { for (const [k, v] of lastById) if (t - v >= HOUR_MS) lastById.delete(k); }
      const prompt = core.buildStartPrompt(id);
      if (!prompt) return { error: WORDS.unknown };
      const ok = launchFn(cwd, prompt, { env, tools: launchTools, toolsHelper, log });
      return ok ? { ok: true } : { error: WORDS.failed };
    } catch { return { error: WORDS.failed }; }
  }

  return { read, start, _clear() { cache = null; startTimes.length = 0; lastById.clear(); } };
}

function init({ ipcMain, getWin, ...deps } = {}) {
  const crew = create(deps);
  const fromMain = (event) => {
    try {
      const w = typeof getWin === 'function' ? getWin() : null;
      if (!w || (typeof w.isDestroyed === 'function' && w.isDestroyed())) return false;
      const wc = w.webContents;
      if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
      return !!event && event.sender === wc;
    } catch { return false; }
  };
  ipcMain.handle('hq:crew:read', async (event) => (fromMain(event) ? crew.read() : { error: NOT_HERE }));
  ipcMain.handle('hq:crew:start', async (event, arg) => {
    if (!fromMain(event)) return { error: NOT_HERE };
    return crew.start(isObj(arg) && typeof arg.id === 'string' ? arg.id : '');
  });
  return crew;
}

module.exports = { create, init, WORDS, NOT_HERE, MAX_STARTS_PER_HOUR, SAME_ID_MS, MAX_SKILLS };

// Static UI vocabulary for the v3 design: navigation, tiers, levels, the
// milestone catalog, keyboard maps. Everything here is configuration, never
// data — measured values come from the scan via adapter.mjs.
//
// LEVELS and MILESTONES mirror schema/gamification.config.json (the structure
// lane's source of truth; the renderer can't read it at runtime because it is
// not baked into window.DATA). catalog.test.mjs fails if they drift.

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// [level, min_xp, title] — schema level_curve.tiers
export const LEVELS = [[1, 0, 'Drifter'], [2, 150, 'Tinkerer'], [3, 350, 'Builder'], [4, 600, 'Operator'], [5, 900, 'Foreman'], [6, 1300, 'Architect'], [7, 1800, 'Overseer'], [8, 2400, 'Workspace Warden'], [9, 3100, 'Grandmaster']];
export function levelOf(xp) {
  let i = 0;
  LEVELS.forEach((L, k) => { if (xp >= L[1]) i = k; });
  const c = LEVELS[i], n = LEVELS[i + 1];
  return { l: c[0], t: c[2], min: c[1], next: n ? n[1] : null, pct: n ? Math.round((xp - c[1]) / (n[1] - c[1]) * 100) : 100, toNext: n ? n[1] - xp : 0 };
}

export const NAV = [
  { id: 'home', label: 'Home', glyph: '⌂' },
  { id: 'projects', label: 'Projects', glyph: '▦' },
  { id: 'tasks', label: 'Tasks', glyph: '☑' },
  { id: 'automations', label: 'Automations', glyph: '▶' },
  { id: 'claude', label: 'Claude', glyph: '✦' },
  { id: 'history', label: 'History', glyph: '◷' },
  { id: 'system', label: 'System', glyph: '▣' },
  { id: 'life', label: 'Life', glyph: '♥' },
  { id: 'studio', label: 'Studio', glyph: '◉' },
];
export const SUBS = {
  projects: [['grid', 'Grid'], ['map', 'Map'], ['archived', 'Archived'], ['github', 'GitHub'], ['accounts', 'Vercel & Supabase']],
  tasks: [['ranked', 'Ranked'], ['byproject', 'By project'], ['ideas', 'Ideas & risks']],
  automations: [['runnable', 'Runnable'], ['library', 'Library'], ['scheduled', 'Scheduled']],
  claude: [['chats', 'Chats'], ['prompts', 'Prompts'], ['projects', 'Projects'], ['sessions', 'Sessions'], ['canvas', 'Canvas']],
  history: [['trends', 'Trends'], ['timeline', 'Timeline'], ['milestones', 'Milestones']],
  system: [['machine', 'Machine'], ['clutter', 'Workspace clutter']],
  life: [['screen', 'Screen time'], ['social', 'Social'], ['notes', 'Notes']],
};
export const ST = {
  risk: { label: 'At risk', color: 'var(--red)', tone: 'red', rank: 0 },
  care: { label: 'Needs care', color: 'var(--orange)', tone: 'orange', rank: 1 },
  idle: { label: 'Idle', color: 'var(--blue)', tone: 'blue', rank: 2 },
  ok: { label: 'Healthy', color: 'var(--green)', tone: 'green', rank: 3 },
};
export const TIER = {
  red: { label: 'Critical', color: 'var(--red)', rank: 0 },
  orange: { label: 'Important', color: 'var(--orange)', rank: 1 },
  yellow: { label: 'Housekeeping', color: 'var(--yellow)', rank: 2 },
};
export const KIND = { risk: ['Risk', 'red'], urgent: ['Urgent', 'orange'], idea: ['Idea', 'blue'], polish: ['Polish', 'default'], task: ['Task', 'gold'], suggestion: ['Suggestion', 'default'] };

// schema achievements: id + name + icon verbatim; descriptions in plain
// language (the design retired "spell / cast" wording for "automation / run").
export const MILESTONES = [
  { id: 'liftoff', name: 'Liftoff', icon: '🚀', desc: 'Push a repo to a remote for the first time.' },
  { id: 'in_sync', name: 'Clean Slate', icon: '🧼', desc: 'Get a repo to zero uncommitted files.' },
  { id: 'green_machine', name: 'Green Machine', icon: '✅', desc: 'Every project builds green at once.' },
  { id: 'version_control', name: 'Under Control', icon: '🔒', desc: 'Every project has git with at least one commit.' },
  { id: 'test_first', name: 'Safety Net', icon: '🥅', desc: 'Add a first passing test suite to a project.' },
  { id: 'crash_slayer', name: 'Crash Slayer', icon: '🔧', desc: 'Take a project from a red build to green.' },
  { id: 'quest_streak_5', name: 'On a Roll', icon: '🔥', desc: 'Complete 5 tasks.' },
  { id: 'debt_zero', name: 'Inbox Zero (Code)', icon: '🏆', desc: 'Drive critical tasks to zero.' },
  { id: 'scan_streak_7', name: 'Habit Formed', icon: '📈', desc: 'Scan on 7 days in a row.' },
  { id: 'declutter', name: 'Marie Kondo', icon: '🧹', desc: 'Remove every stray empty folder from the workspace.' },
  { id: 'secret_free', name: 'No Loose Keys', icon: '🔑', desc: 'No likely secrets in any project.' },
  { id: 'documented', name: 'Well Documented', icon: '📚', desc: 'Every project has a README.' },
  { id: 'scribe', name: 'Scribe', icon: '✍️', desc: 'Capture 30 learnings.' },
  { id: 'cartographer', name: 'Cartographer', icon: '🗺️', desc: 'Every project has a vault note.' },
  { id: 'first_cast', name: 'Apprentice', icon: '🪄', desc: 'Run your first automation from the app.' },
  { id: 'arcanist_50', name: 'Arcanist', icon: '📖', desc: 'Have 50 automations catalogued.' },
  { id: 'battle_mage_100', name: 'Battle Mage', icon: '⚔️', desc: 'Finish 100 automation runs.' },
  { id: 'polymath', name: 'Polymath', icon: '🌈', desc: 'Run at least one automation from every category.' },
  { id: 'familiar_bond', name: 'Familiar Bond', icon: '🐦‍⬛', desc: 'Connect 5 MCP servers.' },
  { id: 'spell_master', name: 'Spell Master', icon: '🏅', desc: 'Run one automation on 40 different days.' },
  { id: 'daily_ritualist', name: 'Daily Ritualist', icon: '🕯️', desc: 'Run the automation of the day 7 times.' },
  { id: 'chain_caster', name: 'Chain Caster', icon: '⛓️', desc: 'Finish a multi-step automation without a failure.' },
];

// Global hotkeys main.js registers (dashboard/main.js globalShortcut), plus the Shift
// variants dashboard/screen-capture.js registers. Status is "ok" unless main reports a
// registration failure (no channel for that yet). Ctrl Alt R never starts a recording
// (MediaRecorder lives in the record panel): with nothing recording it opens the recorder,
// during a recording it stops it. Ctrl Alt Shift R calls the same recToggle (its mic/system
// audio options only apply when a source is passed, which a hotkey never does).
export const HOTKEYS = [['Ctrl Alt G', 'Summon palette', 'ok'], ['Ctrl Alt X', 'Quick-run palette', 'ok'], ['Ctrl Alt S', 'Snip', 'ok'], ['Ctrl Alt Shift S', 'Snap the screen under the cursor (saved + copied)', 'ok'], ['Ctrl Alt R', 'Open recorder / stop', 'ok'], ['Ctrl Alt Shift R', 'Open recorder / stop (same as Ctrl Alt R)', 'ok'], ['Ctrl Alt L', 'Open Studio', 'ok']];
export const KEYS = [['Ctrl K  or  /', 'Search & commands'], ['Tab (in search)', 'Switch Go / Ask'], ['1 – 9', 'Destinations'], ['F', 'Focus on the next action'], ['← →', 'Scrub snapshots'], ['Esc', 'Close the top overlay'], ['?', 'This sheet']];

// automation categories: spellbook "schools" in plain words (brief §6.4c)
export const SCHOOL = { divination: 'Analyze', conjuration: 'Generate', transmutation: 'Build', abjuration: 'Secure', evocation: 'Execute', illusion: 'Design', enchantment: 'Notify', restoration: 'Fix' };

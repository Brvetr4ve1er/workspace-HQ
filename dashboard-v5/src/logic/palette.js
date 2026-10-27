// The command palette’s items (Ctrl K): verbs, go-to, projects, tasks, automations, commands.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { libKindOf } from './library.js';

export const paletteLogic = {
  paletteItems() {
    const S = this.state, raw = S.paletteQuery.trim(), q = raw.toLowerCase(), M = this.M, NAV = M.NAV;
    const g = [];
    // everything the app can run, as on Automations: the background automations, then the
    // interactive ones (Claude skills/commands, npm dev…), which open a terminal. Both go
    // through the same confirm-first askRun (logic/runs.js).
    const runPool = M.AUTOS.concat(M.INTERACTIVE || []);
    const termHint = (a, bg) => (libKindOf(a) === 'interactive' ? 'opens a terminal' : bg);
    const vm = q.match(/^(commit|open|run|focus|theme|go)\s+(.+)$/), doItems = [];
    // capture <text>: the text keeps its case (the other verbs match lowercased)
    const cap = raw.match(/^capture\s+(.+)$/i);
    if (cap) { const text = cap[1].trim(); doItems.push({ glyph: '✎', label: 'Capture to Ideas · ' + text, hint: 'reloads the window', run: () => this.paletteCapture(text) }); }
    if (vm) {
      const verb = vm[1], arg = vm[2].trim();
      if (verb === 'commit' || verb === 'open') this.projectsAt(0).filter((p) => p.name.toLowerCase().includes(arg) || p.id === arg).forEach((p) => doItems.push({ glyph: '›', label: (verb === 'commit' ? 'Commit ' : 'Open ') + p.name, hint: verb === 'commit' ? (p.dirty || 0) + ' files' : 'project page', run: () => (verb === 'commit' ? this.openCommit(p.id) : this.openProject(p.id)) }));
      if (verb === 'run') runPool.filter((a) => a.name.toLowerCase().includes(arg)).forEach((a) => doItems.push({ glyph: '›', label: 'Run ' + a.name, hint: termHint(a, 'confirm first'), run: () => this.askRun(a) }));
      if (verb === 'focus') this.openTasks(0).filter((t) => t.title.toLowerCase().includes(arg)).forEach((t) => doItems.push({ glyph: '›', label: 'Focus · ' + t.title, hint: 'F', run: () => this.startFocus(t.id) }));
      if (verb === 'theme') ['dark', 'light', 'os'].filter((x) => x.startsWith(arg)).forEach((x) => doItems.push({ glyph: '›', label: 'Theme · ' + x, hint: '', run: () => this.setState({ themePref: x }) }));
      if (verb === 'go') NAV.filter((n) => n.label.toLowerCase().startsWith(arg)).forEach((n) => doItems.push({ glyph: '›', label: 'Go to ' + n.label, hint: '', run: () => this.go(n.id) }));
    }
    if (doItems.length) g.push(['Do', doItems]);
    const go = NAV.map((n, i) => ({ glyph: n.glyph, label: n.label, hint: String(i + 1), run: () => this.go(n.id) }));
    [['Map', 'projects', 'map'], ['Archived projects', 'projects', 'archived'], ['Ideas & risks', 'tasks', 'ideas'], ['Library', 'automations', 'library'], ['Canvas', 'claude', 'canvas'], ['Sessions', 'claude', 'sessions'], ['Timeline', 'history', 'timeline'], ['Milestones', 'history', 'milestones'], ['Workspace clutter', 'system', 'clutter'], ['Screen time', 'life', 'screen'], ['Notes', 'life', 'notes'], ['Social accounts', 'social', 'accounts'], ['Social inbox', 'social', 'inbox'], ['Instagram & Facebook archive', 'social', 'archive'], ['Social notes (vault)', 'social', 'vault']].forEach((a) => go.push({ glyph: '↳', label: a[0], hint: NAV.find((n) => n.id === a[1]).label, run: () => this.go(a[1], a[2]) }));
    g.push(['Go to', go]);
    g.push(['Projects', this.projectsAt(0).map((p) => ({ glyph: '▦', label: p.name, hint: p.reason, run: () => this.openProject(p.id) }))]);
    g.push(['Tasks', this.openTasks(0).map((t) => ({ glyph: '◎', label: t.title, hint: 'Focus', run: () => this.startFocus(t.id) }))]);
    g.push(['Automations', runPool.map((a) => ({ glyph: a.icon, label: 'Run ' + a.name, hint: termHint(a, 'background'), run: () => this.askRun(a) }))]);
    const cmds = [
      { glyph: '⟳', label: 'Scan now', hint: 'uses Claude quota', run: () => this.scanNow() },
      { glyph: '◎', label: 'Start focus', hint: 'F', run: () => this.toggleFocus() },
      { glyph: '◐', label: 'Toggle light / dark', hint: '', run: () => this.toggleTheme() },
      { glyph: '♥', label: S.petOn ? 'Hide Bit' : 'Show Bit', hint: 'pet', run: () => this.setState({ petOn: !S.petOn, paletteOpen: false }) },
      { glyph: '⚙', label: 'Settings', hint: '', run: () => this.setState({ settingsOpen: true, paletteOpen: false }) },
      { glyph: '?', label: 'Keyboard shortcuts', hint: '?', run: () => this.setState({ cheatOpen: true, paletteOpen: false }) },
      { glyph: '≡', label: 'Activity & runs', hint: '', run: () => this.setState({ runsOpen: true, paletteOpen: false }) },
      // the Ask panel without a new question: today's chat (kept in v3's hq-oracle-chat) or the starter prompts
      { glyph: '✦', label: 'Ask panel', hint: (S.askHistory || []).length ? 'today’s chat' : 'local model', run: () => this.openAskPanel() },
      // the capture verb, found by searching; it fills the box and waits for the text
      { glyph: '✎', label: 'Capture an idea…', hint: 'capture <text>', run: () => this.setState({ paletteOpen: true, paletteMode: 'go', paletteQuery: 'capture ', paletteSel: 0 }) },
    ];
    // K-3: What's new (logic/whats-new.js, P3-SHELL); listed only once that build has it
    if (typeof this.openWhatsNew === 'function') cmds.push({ glyph: '★', label: 'What’s new · trailers', hint: '', run: () => this.openWhatsNew() });
    if (S.snapOffset) cmds.unshift({ glyph: '●', label: 'Back to live', hint: '', run: () => this.setState({ snapOffset: 0, paletteOpen: false }) });
    g.push(['Commands', cmds]);
    let idx = 0; const out = [];
    g.forEach(([name, items]) => {
      const f = name === 'Do' ? items.slice(0, 8) : items.filter((it) => !q || it.label.toLowerCase().includes(q) || (it.hint || '').toLowerCase().includes(q)).slice(0, q ? 8 : (name === 'Go to' ? 9 : 4));
      if (!f.length) return;
      out.push({ name, items: f.map((it) => { const my = idx++; return Object.assign({}, it, { active: my === S.paletteSel, idx: my }); }) });
    });
    return { groups: out, count: idx, flat: out.reduce((a, gr) => a.concat(gr.items), []) };
  },
  // capture <text> → data/brain-dump.json; main re-assembles and RELOADS the window
  // before answering, so the toast goes first and nothing relies on state after the call
  async paletteCapture(text) {
    text = String(text || '').trim();
    if (!text) return;
    if (!this.canWrite()) return this.denied();
    const hq = this.hq;
    if (!hq || typeof hq.captureSave !== 'function') return this.notWired('Capture');
    this.toast('info', 'Saving to Ideas — the window reloads to show it');
    let ok;
    try { ok = await hq.captureSave(text); }
    catch (e) { this.toast('error', 'Not saved · ' + (e && e.message || e)); return; }
    if (!ok) this.toast('error', 'Not saved');
  },
};

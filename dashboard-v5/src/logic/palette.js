// The command palette’s items (Ctrl K): verbs, go-to, projects, tasks, automations, commands.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.

export const paletteLogic = {
  paletteItems() {
    const S = this.state, q = S.paletteQuery.trim().toLowerCase(), M = this.M, NAV = M.NAV;
    const g = [];
    const vm = q.match(/^(commit|open|run|focus|theme|go)\s+(.+)$/), doItems = [];
    if (vm) {
      const verb = vm[1], arg = vm[2].trim();
      if (verb === 'commit' || verb === 'open') this.projectsAt(0).filter((p) => p.name.toLowerCase().includes(arg) || p.id === arg).forEach((p) => doItems.push({ glyph: '›', label: (verb === 'commit' ? 'Commit ' : 'Open ') + p.name, hint: verb === 'commit' ? (p.dirty || 0) + ' files' : 'project page', run: () => (verb === 'commit' ? this.openCommit(p.id) : this.openProject(p.id)) }));
      if (verb === 'run') M.AUTOS.filter((a) => a.name.toLowerCase().includes(arg)).forEach((a) => doItems.push({ glyph: '›', label: 'Run ' + a.name, hint: 'confirm first', run: () => this.askRun(a) }));
      if (verb === 'focus') this.openTasks(0).filter((t) => t.title.toLowerCase().includes(arg)).forEach((t) => doItems.push({ glyph: '›', label: 'Focus · ' + t.title, hint: 'F', run: () => this.startFocus(t.id) }));
      if (verb === 'theme') ['dark', 'light', 'os'].filter((x) => x.startsWith(arg)).forEach((x) => doItems.push({ glyph: '›', label: 'Theme · ' + x, hint: '', run: () => this.setState({ themePref: x }) }));
      if (verb === 'go') NAV.filter((n) => n.label.toLowerCase().startsWith(arg)).forEach((n) => doItems.push({ glyph: '›', label: 'Go to ' + n.label, hint: '', run: () => this.go(n.id) }));
    }
    if (doItems.length) g.push(['Do', doItems]);
    const go = NAV.map((n, i) => ({ glyph: n.glyph, label: n.label, hint: String(i + 1), run: () => this.go(n.id) }));
    [['Map', 'projects', 'map'], ['Archived projects', 'projects', 'archived'], ['Ideas & risks', 'tasks', 'ideas'], ['Library', 'automations', 'library'], ['Canvas', 'claude', 'canvas'], ['Sessions', 'claude', 'sessions'], ['Timeline', 'history', 'timeline'], ['Milestones', 'history', 'milestones'], ['Workspace clutter', 'system', 'clutter'], ['Screen time', 'life', 'screen'], ['Social', 'life', 'social'], ['Notes', 'life', 'notes']].forEach((a) => go.push({ glyph: '↳', label: a[0], hint: NAV.find((n) => n.id === a[1]).label, run: () => this.go(a[1], a[2]) }));
    g.push(['Go to', go]);
    g.push(['Projects', this.projectsAt(0).map((p) => ({ glyph: '▦', label: p.name, hint: p.reason, run: () => this.openProject(p.id) }))]);
    g.push(['Tasks', this.openTasks(0).map((t) => ({ glyph: '◎', label: t.title, hint: 'Focus', run: () => this.startFocus(t.id) }))]);
    g.push(['Automations', M.AUTOS.map((a) => ({ glyph: a.icon, label: 'Run ' + a.name, hint: 'background', run: () => this.askRun(a) }))]);
    const cmds = [
      { glyph: '⟳', label: 'Scan now', hint: 'uses Claude quota', run: () => this.scanNow() },
      { glyph: '◎', label: 'Start focus', hint: 'F', run: () => this.toggleFocus() },
      { glyph: '◐', label: 'Toggle light / dark', hint: '', run: () => this.toggleTheme() },
      { glyph: '♥', label: S.petOn ? 'Hide Bit' : 'Show Bit', hint: 'pet', run: () => this.setState({ petOn: !S.petOn, paletteOpen: false }) },
      { glyph: '⚙', label: 'Settings', hint: '', run: () => this.setState({ settingsOpen: true, paletteOpen: false }) },
      { glyph: '?', label: 'Keyboard shortcuts', hint: '?', run: () => this.setState({ cheatOpen: true, paletteOpen: false }) },
      { glyph: '≡', label: 'Activity & runs', hint: '', run: () => this.setState({ runsOpen: true, paletteOpen: false }) },
    ];
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
};

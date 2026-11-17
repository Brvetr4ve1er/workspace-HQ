// An INVENTED Launcher for the fake preload (Settings > Launcher, the project page's Open workspace): makeLauncherFake({ mode, record, devAllowed })
// answers what hq.launcher.* answers. Every name is made up (the repo is public). The function is SELF-CONTAINED on purpose:
// tools/launcher-fixture-paste.mjs pastes its source into fake-preload.js (which is sandboxed and cannot require anything) and a test keeps the
// pasted copy equal to this one. A test also pins the sentences and the fixed words below to dashboard/launcher-core.mjs, so the fake cannot drift
// from what main says.
//
//   mode()        a function: the state a scenario asked for ('locked' | 'error' | 'refuse' | '', read from sessionStorage 'hqFake:launcher')
//   record(m, a)  the fake's own call log (the Open workspace act mark is written the way main writes it)
//   devAllowed    the Set of project ids whose dev command the owner allowed in this fake session (the same Set the fake's devAllow fills), so
//                 an Allow on the project page and the Launcher's "Allowed commands" list agree
//
// Projects are the gate's own invented ones (ids a to d; only "a" has a scanned dev command): a is unconfirmed until it is allowed, the rest are none.
export function makeLauncherFake({ mode, record, devAllowed }) {
  const SEED = () => [{ id: 'aaaa0001', kind: 'folder', name: 'Placeholder folder', host: '', editor: false }, { id: 'aaaa0002', kind: 'app', name: 'Example editor', host: '', editor: true }, { id: 'aaaa0003', kind: 'url', name: 'docs.example.test', host: 'docs.example.test', editor: false }];
  const PROJECTS = [{ id: 'a', name: 'Project A', dev: 'unconfirmed' }, { id: 'b', name: 'Project B', dev: 'none' }, { id: 'c', name: 'Project C', dev: 'none' }, { id: 'd', name: 'Project D', dev: 'none' }];
  const KINDS = ['folder', 'file', 'app', 'url'];
  const WHY = 'that is not a full path on a drive';
  const SENT = {
    dev: { started: 'Dev server: started', running: 'Dev server: already running', unconfirmed: 'Dev server: not allowed yet', refused: "Dev server: can't run this command", busy: 'Dev server: too many starts this hour', none: 'Dev server: no command scanned for this project', skipped: '' },
    editor: { opened: 'Editor: opened', none: 'Editor: none chosen. Pick one in Launcher', failed: "Editor: didn't open", skipped: '' },
    terminal: { opened: 'Terminal: opened', skipped: "Terminal: skipped, the folder name has a symbol Windows Terminal can't take", failed: "Terminal: didn't open" },
  };
  const FOLDER_MISSING = 'Folder not found: rescan';
  const lineOf = (steps) => steps.map((s) => (SENT[s.step][s.state] ? SENT[s.step][s.state] + '.' : '')).filter(Boolean).join(' ');
  let entries = SEED(), editor = 'aaaa0002', seq = 3;
  let running = {};
  const devOf = (p) => (p.dev === 'none' ? 'none' : devAllowed.has(p.id) ? 'allowed' : p.dev);
  return {
    rows: [
      ['launcher.read', () => {
        const m = mode();
        if (m === 'error') return { error: 'the launcher could not be read' };
        if (m === 'locked') return { entries: [], editor: null, projects: [], terminal: 'console', locked: true, limit: 40 };
        return { entries: entries.map((e) => ({ ...e, editor: e.id === editor })), editor, projects: PROJECTS.map((p) => ({ id: p.id, name: p.name, dev: devOf(p) })), terminal: 'wt', locked: false, limit: 40 };
      }],
      ['launcher.add', (kind) => {
        if (KINDS.indexOf(kind) < 0) return { state: 'refused', why: 'that kind of entry does not exist' };
        if (mode() === 'refuse') return { state: 'refused', why: WHY };
        if (mode() === 'locked') return { state: 'locked', why: 'this computer cannot keep the launcher list safely' };
        if (entries.length >= 40) return { state: 'full' };
        seq += 1; const id = 'aaaa' + String(seq).padStart(4, '0');
        entries.push({ id, kind, name: 'Placeholder ' + kind + ' ' + seq, host: kind === 'url' ? 'docs.example.test' : '', editor: false });
        return { state: 'added', id };
      }],
      ['launcher.remove', (id) => { const n = entries.length; entries = entries.filter((e) => e.id !== id); if (editor === id) editor = null; return { state: entries.length < n ? 'removed' : 'unknown' }; }],
      ['launcher.setEditor', (id) => { const e = entries.find((x) => x.id === id); if (!e) return { state: 'unknown' }; if (e.kind !== 'app') return { state: 'refused', why: 'an app must be an .exe file' }; editor = id; return { state: 'set' }; }],
      ['launcher.open', (id) => ({ state: entries.some((e) => e.id === id) ? 'opened' : 'unknown' })],
      ['launcher.openWorkspace', (projectId) => {
        const p = PROJECTS.find((x) => x.id === projectId);
        if (!p) return { ok: false, steps: ['dev', 'editor', 'terminal'].map((step) => ({ step, state: 'skipped' })), line: FOLDER_MISSING };
        const d = devOf(p);
        const dev = d === 'allowed' ? (running[p.id] ? 'running' : 'started') : d;
        if (d === 'allowed') running[p.id] = true;
        const ed = editor ? 'opened' : 'none';
        const steps = [{ step: 'dev', state: dev }, { step: 'editor', state: ed }, { step: 'terminal', state: 'opened' }];
        if (dev === 'started' || ed === 'opened') record('use', ['launcher-workspace', 'act']);
        return { ok: true, steps, line: lineOf(steps) };
      }],
    ],
    reset: () => { entries = SEED(); editor = 'aaaa0002'; seq = 3; running = {}; },
  };
}

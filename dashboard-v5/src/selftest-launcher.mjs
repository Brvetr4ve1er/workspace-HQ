// Settings > Launcher and the project page's Open workspace - the states the selftest walks (selftest.js loops them in both themes).
//
//   launcherStates({ projectId }) -> [name, lnch, extra][]
//     lnch    the whole `lnch` component state this row sets (logic/launcher.js lnchInit() plus the row's own values); the caller holds the arrival read
//             (L._lnchAsked = true) so the fake preload's own answer never replaces a preset state
//     extra   a state patch: Settings open (every Settings row)
//   LNCH_OFFLINE_ROWS   rows that need hq.launcher hidden for one combo (the store's hq, never window.hq)
//   LNCH_PAGE_ROWS      rows that open the project page instead of Home
//
// Everything is invented and deterministic: placeholder names, no clock, no IO. projectId names a project the page really has (its scanned dev
// command is the text shown under "Allowed commands").

export const LNCH_OFFLINE_ROWS = Object.freeze(['launcher-offline']);
export const LNCH_PAGE_ROWS = Object.freeze(['launcher-workspace-idle', 'launcher-workspace-busy', 'launcher-workspace-line', 'launcher-workspace-line-long']);

const entry = (n, kind, name, host = '') => ({ id: 'selftest' + String(n).padStart(2, '0'), kind, name, host });
const ENTRIES = [entry(1, 'folder', 'Placeholder folder'), entry(2, 'app', 'Example editor'), entry(3, 'url', 'docs.example.test', 'docs.example.test'), entry(4, 'file', 'Placeholder plan.pdf'), entry(5, 'app', 'Another example app')];
const LONG_NAME = 'A placeholder entry with a very long name that goes on and on to see where the row wraps ' + 'x'.repeat(40);

export function launcherStates({ projectId = 'a' } = {}) {
  const base = { data: null, loaded: true, busy: false, error: '', notice: '', noticeBad: false, ws: {} };
  const data = (o) => Object.assign({ entries: ENTRIES, editor: 'selftest02', projects: [{ id: projectId, name: 'Project A', dev: 'allowed' }, { id: 'zz-none', name: 'Project Z', dev: 'none' }], terminal: 'wt', locked: false, limit: 40 }, o);
  const open = { settingsOpen: true };
  const dev = (state) => ({ projects: [{ id: projectId, name: 'Project A', dev: state }] });
  return [
    ['launcher-off', Object.assign({}, base, { data: data() }), {}],   // Settings closed with a list held: no section at all
    ['launcher-offline', Object.assign({}, base), open],
    ['launcher-loading', Object.assign({}, base, { loaded: false, busy: true }), open],
    ['launcher-error', Object.assign({}, base, { error: 'the launcher could not be read' }), open],
    ['launcher-locked', Object.assign({}, base, { data: data({ entries: [], editor: null, locked: true, projects: [] }) }), open],
    ['launcher-empty', Object.assign({}, base, { data: data({ entries: [], editor: null, projects: [] }) }), open],
    ['launcher-ready', Object.assign({}, base, { data: data() }), open],
    ['launcher-unallowed', Object.assign({}, base, { data: data(dev('unconfirmed')) }), open],
    ['launcher-refused', Object.assign({}, base, { data: data(dev('refused')) }), open],
    ['launcher-no-editor', Object.assign({}, base, { data: data({ editor: null }) }), open],
    ['launcher-editor-set', Object.assign({}, base, { data: data({ editor: 'selftest05' }), notice: 'Editor chosen' }), open],
    ['launcher-ready-notice-bad', Object.assign({}, base, { data: data(), notice: 'Not added: that is not a full path on a drive', noticeBad: true }), open],
    ['launcher-ready-error', Object.assign({}, base, { data: data(), error: 'the launcher could not be read' }), open],
    ['launcher-full', Object.assign({}, base, { data: data({ limit: 5 }) }), open],
    ['launcher-long-name', Object.assign({}, base, { data: data({ entries: [entry(1, 'folder', LONG_NAME), entry(2, 'app', 'Example editor')] }) }), open],
    ['launcher-console', Object.assign({}, base, { data: data({ terminal: 'console' }) }), open],
    ['launcher-workspace-idle', Object.assign({}, base), {}],
    ['launcher-workspace-busy', Object.assign({}, base, { ws: { [projectId]: { busy: true, line: '' } } }), {}],
    ['launcher-workspace-line', Object.assign({}, base, { ws: { [projectId]: { busy: false, line: 'Dev server: not allowed yet. Press Allow and run. Editor: opened. Terminal: opened.' } } }), {}],
    ['launcher-workspace-line-long', Object.assign({}, base, { ws: { [projectId]: { busy: false, line: 'Dev server: not allowed yet. Press Allow and run. Editor: none chosen. Pick one in Settings > Launcher. ' + "Terminal: skipped, the folder name has a symbol Windows Terminal can't take. " + 'x'.repeat(120) } } }), {}],
  ];
}

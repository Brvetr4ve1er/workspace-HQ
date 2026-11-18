// The Lantern look: the states the selftest walks (selftest.js loops them beside the Workbench look's, in both themes).
//
//   lanternInitState()        the consoleLayer a row never inherits from the previous row (everything off); the caller spreads it first
//   lanternStates({ projectId })  [{ name, kind, state, brief?, want }][]
//       name     the combo label suffix ('lantern-...')
//       kind     where the row is walked: 'home' | 'crew' | 'notes' | 'shelf-empty' | 'project' (selftest.js sets up each place the way the sibling rows do)
//       state    the state patch (consoleLayer, and the crw / vdk state the place needs)
//       brief    (home rows) the LIVE.brief value; the empty one is what shows the empty-Brief line
//       want     what the row must show: { look, arts: { kind: { text, face } }, accent?, project? } (arts lists the cards that MUST be there, others may be there but must be honest; a row with the look
//                off lists none and none may exist; under Lantern no Workbench picture may exist either)
//   lanternSeen(doc)          what the page shows, as plain data: { look, accent, links, wbnLinks, wbnArts, arts: { kind: { text, face, label, roman } } }
//   lanternProblems(row, seen) -> string[]   what is wrong, in words ([] = the row is right)
//
// Invented placeholder names only; no IO, no timers, no listeners.
import { normaliseConsoleLayer } from './logic/console-layer.mjs';
import { bindProject } from './logic/lantern-art.mjs';

const L = (o) => normaliseConsoleLayer(o);
export const lanternInitState = () => ({ consoleLayer: normaliseConsoleLayer(null) });

const emptyBrief = { brief: { v: 1, generatedAt: '2026-11-18T09:00:00.000Z', items: [], more: 0, overflow: [], standing: [], errors: [] }, error: '', loaded: true };

const CREW_ROLES = [['developers', 'Developers'], ['designers', 'Designers'], ['other', 'Other']].map((r) => ({ id: r[0], label: r[1] }));
const crewRow = (i) => ({ id: 'selftest-skill-' + i, name: 'selftest-skill-' + i, description: 'A placeholder skill for the selftest, number ' + i + '.', role: CREW_ROLES[i % CREW_ROLES.length].id, plugin: '', canStart: true });
const CREW = { crw: { rows: Array.from({ length: 9 }, (_, i) => crewRow(i)), roles: CREW_ROLES, error: '', loaded: true, busy: false, at: '', q: '', page: 1, open: {} } };
const NOTE = { state: 'ready', vaultName: 'Selftest Vault', canOpen: true, folder: 'Daily', folderFromSettings: true, folderSource: 'daily-notes', settingsIgnored: false, noteName: '2026-11-18', date: '2026-11-18', text: '# Monday\n\n- a placeholder line\n', truncated: false, recent: ['Note A', 'Note B', 'Note C', 'Note D'].map((name) => ({ name })), noteCount: 4, noteCountCapped: false };
const NOTES = { vdk: { data: NOTE, error: '', loaded: true, busy: false, draft: '', sending: false } };
// the Vault desk before any answer: the count is not read yet, so the card is the face-down back
const NOTES_UNREAD = { vdk: { data: null, error: '', loaded: false, busy: false, draft: '', sending: false } };

const UP = (text) => ({ text, face: 'up' });
const SEALED = { text: 'SEALED', face: 'sealed' };

export function lanternStates({ projectId = 'a' } = {}) {
  const ln = (o) => ({ consoleLayer: L({ on: true, look: 'lantern', ...(o || {}) }) });
  const card = bindProject(projectId);
  return [
    { name: 'lantern-home', kind: 'home', state: ln(), want: { look: 'lantern', arts: {} } },
    // a stored palette does nothing under this look: no accent attribute, no extra link
    { name: 'lantern-home-palette-inert', kind: 'home', state: ln({ palette: 'signal' }), want: { look: 'lantern', arts: {}, accent: '' } },
    { name: 'lantern-home-cheat-palette-inert', kind: 'home', state: ln({ palette: 'ember' }), want: { look: 'lantern', arts: {}, accent: '' } },
    { name: 'lantern-home-empty-brief', kind: 'home', state: ln(), brief: emptyBrief, want: { look: 'lantern', arts: { needyou: UP('0 NEED YOU') } } },
    { name: 'lantern-crew', kind: 'crew', state: { ...ln(), ...CREW }, want: { look: 'lantern', arts: { skills: UP('9 SKILLS') } } },
    { name: 'lantern-notes', kind: 'notes', state: { ...ln(), ...NOTES }, want: { look: 'lantern', arts: { notes: UP('4 NOTES') } } },
    { name: 'lantern-notes-sealed', kind: 'notes', state: { ...ln(), ...NOTES_UNREAD }, want: { look: 'lantern', arts: { notes: SEALED } } },
    { name: 'lantern-shelf-empty', kind: 'shelf-empty', state: { consoleLayer: L({ on: true, look: 'lantern', shelf: true }) }, want: { look: 'lantern', arts: { projects: UP('0 PROJECTS') } } },
    { name: 'lantern-project', kind: 'project', state: ln(), want: { look: 'lantern', arts: {}, project: { text: card.label, aria: card.aria, face: 'up' } } },
    // not chosen: layer on without the look, the Console skin, the Workbench look, and a stored look with the layer off draw nothing of it
    { name: 'lantern-not-chosen', kind: 'crew', state: { consoleLayer: L({ on: true }), ...CREW }, want: { look: '', arts: {} } },
    { name: 'lantern-console-skin', kind: 'notes', state: { consoleLayer: L({ on: true, skin: true }), ...NOTES }, want: { look: '', arts: {} } },
    { name: 'lantern-workbench-look', kind: 'crew', state: { consoleLayer: L({ on: true, look: 'workbench' }), ...CREW }, want: { look: 'workbench', arts: {}, noLantern: true } },
    { name: 'lantern-off-stored', kind: 'crew', state: { consoleLayer: L({ on: false, look: 'lantern' }), ...CREW }, want: { look: '', arts: {} } },
  ];
}

/** Reads the page into plain data. doc is the page's own (or a fake in a test); nothing is changed. */
export function lanternSeen(doc) {
  const root = doc.querySelector('[data-hq-theme]');
  const arts = {};
  for (const el of doc.querySelectorAll('[data-lnt^="art-"]')) {
    const kind = String(el.getAttribute('data-lnt')).slice(4);
    const ro = el.querySelector('[data-lnt="readout"]'), rn = el.querySelector('[data-lnt="roman"]');
    arts[kind] = { text: ro ? String(ro.textContent || '').trim() : '', face: String(el.getAttribute('data-lnt-face') || ''), label: String(el.getAttribute('aria-label') || ''), roman: rn ? String(rn.textContent || '').trim() : '' };
  }
  return {
    look: root ? root.getAttribute('data-hq-look') : undefined,
    accent: root ? root.getAttribute('data-hq-accent') : undefined,
    links: doc.querySelectorAll('link#hq-lantern-css').length,
    wbnLinks: doc.querySelectorAll('link#hq-workbench-css').length,
    wbnArts: doc.querySelectorAll('[data-wbn^="art-"]').length,
    arts,
  };
}

export function lanternProblems(row, seen) {
  const out = [];
  const w = row.want, s = seen || {};
  if (s.look !== w.look) out.push('the root data-hq-look is ' + JSON.stringify(s.look) + ', want ' + JSON.stringify(w.look) + (w.look === '' ? ' (an EMPTY attribute, not a missing one)' : ''));
  const wantLink = w.look === 'lantern' ? 1 : 0;
  if (s.links !== wantLink) out.push('the page holds ' + s.links + ' #hq-lantern-css link(s), want ' + wantLink);
  if (w.look === 'lantern' && s.wbnLinks !== 0) out.push('the Workbench sheet is in the page beside the Lantern one');
  if ('accent' in w && s.accent !== w.accent) out.push('the root data-hq-accent is ' + JSON.stringify(s.accent) + ', want ' + JSON.stringify(w.accent));
  const got = { ...(s.arts || {}) };
  const project = got.project;
  delete got.project;
  for (const [kind, want] of Object.entries(w.arts)) {
    const g = got[kind];
    if (!g) { out.push('the ' + kind + ' card is not in the page'); continue; }
    if (g.text !== want.text) out.push('the ' + kind + ' card reads ' + JSON.stringify(g.text) + ', want ' + JSON.stringify(want.text));
    if (g.face !== want.face) out.push('the ' + kind + ' card is face ' + JSON.stringify(g.face) + ', want ' + JSON.stringify(want.face));
    if (want.face === 'sealed' && /\d/.test(g.text + g.label + g.roman)) out.push('the sealed ' + kind + ' card carries a number: ' + JSON.stringify(g.text + ' ' + g.label));
    if (want.face === 'up' && !g.label.startsWith(want.text.toLowerCase() + ', card: ')) out.push('the ' + kind + ' card is not named by its readout first: ' + JSON.stringify(g.label));
  }
  // a card this row does not list may be there (the all-clear card beside the empty Brief line, for one) but it must still be honest: a sealed one holds no digit, a face-up one is named by its readout
  for (const [kind, g] of Object.entries(got)) {
    if (kind in w.arts) continue;
    if (g.face === 'sealed' && /\d/.test(g.text + g.label + g.roman)) out.push('the sealed ' + kind + ' card carries a number: ' + JSON.stringify(g.text + ' ' + g.label));
    if (g.face === 'up' && !g.label.startsWith(g.text.toLowerCase() + ', card: ')) out.push('the ' + kind + ' card is not named by its readout first: ' + JSON.stringify(g.label));
  }
  if (w.project) {
    if (!project) out.push('the project card is not in the page');
    else {
      if (project.text !== w.project.text) out.push('the project card reads ' + JSON.stringify(project.text) + ', want ' + JSON.stringify(w.project.text));
      if (project.label !== w.project.aria) out.push('the project card is named ' + JSON.stringify(project.label) + ', want ' + JSON.stringify(w.project.aria));
      if (project.face !== w.project.face) out.push('the project card is face ' + JSON.stringify(project.face));
    }
  } else if (project) out.push('a project card is in the page but this row is not a project page');
  if (w.look !== 'lantern') { if (project) out.push('a project card is in the page but the Lantern look is not chosen'); for (const kind of Object.keys(got)) out.push('a ' + kind + ' card is in the page but the Lantern look is not chosen'); }
  if (w.look === 'lantern' && s.wbnArts) out.push(s.wbnArts + ' Workbench picture(s) are in the page under the Lantern look');
  return out;
}

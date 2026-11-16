// The Workbench look: the states the selftest walks (selftest.js loops them beside the Console layer's, in both themes).
//
//   workbenchInitState()      the consoleLayer a row never inherits from the previous row (everything off); the caller spreads it first
//   workbenchStates()         [{ name, kind, state, brief?, want }][]
//       name     the combo label suffix ('workbench-...')
//       kind     where the row is walked: 'home' | 'crew' | 'notes' | 'shelf-empty' (selftest.js sets up each place the way the sibling rows do)
//       state    the state patch (consoleLayer, and the crw / vdk state the place needs)
//       brief    (home rows) the LIVE.brief value; the empty one is what shows the empty-Brief line
//       want     what the row must show: { look, arts: { kind: label } } ('arts' lists the pictures that MUST be there; a row with look off lists none and none may exist)
//   workbenchSeen(doc)        what the page shows, as plain data: { look, links, arts: { kind: readout text } }
//   workbenchProblems(row, seen) -> string[]   what is wrong, in words ([] = the row is right)
//
// Invented placeholder names only; no IO, no timers, no listeners.
import { normaliseConsoleLayer } from './logic/console-layer.mjs';

const L = (o) => normaliseConsoleLayer(o);
export const workbenchInitState = () => ({ consoleLayer: normaliseConsoleLayer(null) });

const emptyBrief = { brief: { v: 1, generatedAt: '2026-11-16T09:00:00.000Z', items: [], more: 0, overflow: [], standing: [], errors: [] }, error: '', loaded: true };

const CREW_ROLES = [['developers', 'Developers'], ['designers', 'Designers'], ['other', 'Other']].map((r) => ({ id: r[0], label: r[1] }));
const crewRow = (i) => ({ id: 'selftest-skill-' + i, name: 'selftest-skill-' + i, description: 'A placeholder skill for the selftest, number ' + i + '.', role: CREW_ROLES[i % CREW_ROLES.length].id, plugin: '', canStart: true });
const CREW = { crw: { rows: Array.from({ length: 9 }, (_, i) => crewRow(i)), roles: CREW_ROLES, error: '', loaded: true, busy: false, at: '', q: '', page: 1, open: {} } };
const NOTE = { state: 'ready', vaultName: 'Selftest Vault', canOpen: true, folder: 'Daily', folderFromSettings: false, settingsIgnored: false, noteName: '2026-11-16', date: '2026-11-16', text: '# Monday\n\n- a placeholder line\n', truncated: false, recent: ['Note A', 'Note B', 'Note C', 'Note D'].map((name) => ({ name })) };
const NOTES = { vdk: { data: NOTE, error: '', loaded: true, busy: false, draft: '', sending: false } };

export function workbenchStates() {
  const wb = (o) => ({ consoleLayer: L({ on: true, look: 'workbench', ...(o || {}) }) });
  return [
    { name: 'workbench-home', kind: 'home', state: wb(), want: { look: 'workbench', arts: {} } },
    { name: 'workbench-home-signal', kind: 'home', state: wb({ palette: 'signal' }), want: { look: 'workbench', arts: {}, accent: 'signal' } },
    { name: 'workbench-home-empty-brief', kind: 'home', state: wb(), brief: emptyBrief, want: { look: 'workbench', arts: { needyou: '0 NEED YOU' } } },
    { name: 'workbench-crew', kind: 'crew', state: { ...wb(), ...CREW }, want: { look: 'workbench', arts: { skills: '9 SKILLS' } } },
    { name: 'workbench-notes', kind: 'notes', state: { ...wb(), ...NOTES }, want: { look: 'workbench', arts: { notes: '4 NOTES' } } },
    { name: 'workbench-shelf-empty', kind: 'shelf-empty', state: { consoleLayer: L({ on: true, look: 'workbench', shelf: true }) }, want: { look: 'workbench', arts: { projects: '0 PROJECTS' } } },
    // the look with the cheat palette stored: inert (no accent attribute), the picture is unchanged
    { name: 'workbench-home-cheat-palette-inert', kind: 'home', state: wb({ palette: 'ember' }), want: { look: 'workbench', arts: {}, accent: '' } },
    // not chosen: layer on without the look, the Console skin, and a stored look with the layer off draw nothing of it
    { name: 'workbench-not-chosen', kind: 'crew', state: { consoleLayer: L({ on: true }), ...CREW }, want: { look: '', arts: {} } },
    { name: 'workbench-console-skin', kind: 'notes', state: { consoleLayer: L({ on: true, skin: true }), ...NOTES }, want: { look: '', arts: {} } },
    { name: 'workbench-off-stored', kind: 'crew', state: { consoleLayer: L({ on: false, look: 'workbench' }), ...CREW }, want: { look: '', arts: {} } },
  ];
}

/** Reads the page into plain data. doc is the page's own (or a fake in a test); nothing is changed. */
export function workbenchSeen(doc) {
  const root = doc.querySelector('[data-hq-theme]');
  const arts = {};
  for (const el of doc.querySelectorAll('[data-wbn^="art-"]')) {
    const kind = String(el.getAttribute('data-wbn')).slice(4);
    const ro = el.querySelector('[data-wbn="readout"]');
    arts[kind] = ro ? String(ro.textContent || '').trim() : '';
  }
  return {
    look: root ? root.getAttribute('data-hq-look') : undefined,
    accent: root ? root.getAttribute('data-hq-accent') : undefined,
    links: doc.querySelectorAll('link#hq-workbench-css').length,
    arts,
  };
}

export function workbenchProblems(row, seen) {
  const out = [];
  const w = row.want, s = seen || {};
  if (s.look !== w.look) out.push('the root data-hq-look is ' + JSON.stringify(s.look) + ', want ' + JSON.stringify(w.look) + (w.look === '' ? ' (an EMPTY attribute, not a missing one)' : ''));
  if (s.links !== (w.look ? 1 : 0)) out.push('the page holds ' + s.links + ' #hq-workbench-css link(s), want ' + (w.look ? 1 : 0));
  if ('accent' in w && s.accent !== w.accent) out.push('the root data-hq-accent is ' + JSON.stringify(s.accent) + ', want ' + JSON.stringify(w.accent));
  const got = s.arts || {};
  for (const [kind, label] of Object.entries(w.arts)) if (got[kind] !== label) out.push('the ' + kind + ' picture reads ' + JSON.stringify(got[kind]) + ', want ' + JSON.stringify(label));
  if (!w.look) for (const kind of Object.keys(got)) out.push('a ' + kind + ' picture is in the page but the look is not chosen');
  return out;
}

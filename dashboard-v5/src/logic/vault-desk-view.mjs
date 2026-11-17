// The Vault desk's pure view logic (Life > Notes; main side: dashboard/vault-desk.js, hq:vault-desk:read). The answer arrives finished from main;
// this file re-checks it (a non-string never reaches the screen), and finds the plain words for each state. No DOM, no clock, no IPC.
export const VDK_OFF = 'The Vault desk needs the desktop app';
export const VDK_LINE_MAX = 1000;
export const VDK_STATES = Object.freeze(['ready', 'no-folder', 'no-note']);
export const VDK_SOURCES = Object.freeze(['daily-notes', 'vault-new-notes', 'vault-top']);
const CTRL = /[\u0000-\u001f\u007f-\u009f]+/g;

const str = (x, n) => (typeof x === 'string' ? Array.from(x.replace(CTRL, ' ')).slice(0, n).join('').trim() : '');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** The answer of hq.vaultDesk.read, made safe: bounded strings, a known state and folder source, a note count, at most twelve recent names. The note text keeps its line breaks. */
export function vdkClean(r) {
  if (!isObj(r)) return null;
  const state = VDK_STATES.includes(r.state) ? r.state : 'no-folder';
  const text = typeof r.text === 'string' ? r.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').slice(0, 21000) : '';
  const recent = (Array.isArray(r.recent) ? r.recent : []).map((x) => str(isObj(x) ? x.name : '', 100)).filter(Boolean).slice(0, 12);
  const folderFromSettings = r.folderFromSettings === true;
  // an answer from an older main has no source: the old flag says whether the daily notes settings named the folder
  const folderSource = VDK_SOURCES.includes(r.folderSource) ? r.folderSource : folderFromSettings ? 'daily-notes' : 'vault-top';
  const nc = typeof r.noteCount === 'number' && Number.isFinite(r.noteCount) ? Math.max(0, Math.min(99999, Math.floor(r.noteCount))) : null;
  return {
    state, vaultName: str(r.vaultName, 100), canOpen: r.canOpen === true, folder: str(r.folder, 120), folderFromSettings, folderSource,
    settingsIgnored: r.settingsIgnored === true, noteName: str(r.noteName, 100), date: str(r.date, 20), text, truncated: r.truncated === true, recent,
    noteCount: nc, noteCountCapped: nc !== null && r.noteCountCapped === true,
  };
}

/** Where the desk looked, in words: the folder, and which rule picked it (the daily notes settings, the vault's own folder for new notes, or the top of the vault). */
export function vdkWhere(d) {
  if (!d) return '';
  const folder = d.folder ? 'the folder “' + d.folder + '”' : 'the top of the vault';
  const from = d.folderSource === 'daily-notes' ? ' (from the vault’s daily notes settings)'
    : d.folderSource === 'vault-new-notes' ? ' (the vault’s own folder for new notes; the daily notes settings name no folder)'
      : ' (Obsidian’s default when no folder is set)';
  return 'Looking for today’s note in ' + folder + from + (d.settingsIgnored ? '. The vault’s settings named a folder or format that is not safe to use, so they were ignored' : '') + '.';
}

/** One plain sentence for a state that has no note to show. */
export function vdkStateWords(d) {
  if (!d) return '';
  if (d.state === 'no-folder') return 'That folder is not in the vault, so there is nothing to read and nothing can be added. The app never makes folders.';
  if (d.state === 'no-note') return 'There is no note for today yet, so there is nothing to add to. Make today’s note in Obsidian first (the app never makes notes), then it shows here.';
  return '';
}

/** A line the owner typed: how many characters it has and whether it can be sent. */
export function vdkLineInfo(line) {
  const s = typeof line === 'string' ? line.replace(CTRL, ' ').trim() : '';
  const n = Array.from(s).length;
  return { n, empty: n === 0, long: n > VDK_LINE_MAX };
}

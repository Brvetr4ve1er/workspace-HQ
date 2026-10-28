// "What's new · trailers" (Phase 3 P8): a v5 overlay (src/tpl/extras.tpl.js,
// values in src/vals/extras.js) with the two trailers and a short, honest list of
// what changed. Opened from Settings, from the palette (contract K-3:
// this.openWhatsNew()) and once per version on its own.
//
// "Once" means once in front of the owner: the app starts hidden to the tray at
// login (`--hidden`), and a hidden window never has focus. So the first-launch
// open waits for the window to have focus, then marks the version seen
// (whq3-prefs.whatsNewSeen). Opening it any other way marks it seen too.
//
// The trailers are <video preload="none" controls poster src>: nothing loads and
// nothing plays until the owner presses play. A missing poster logs an
// error-level "Failed to load resource" even with preload="none" (and fails the
// selftest and the CDP gates), so a trailer is rendered as a video only when
// it's bundled — TRAILERS[i].bundled, which whats-new.test.mjs checks against the
// files in dashboard-v5/media/. Otherwise, or when the file won't play (the
// video's error event), the card says "Trailer not bundled in this build".
import { FX, loadPrefs, savePrefs } from './shared.js';

export const WHATS_NEW_VERSION = '2026-10';

// Paths are relative to dashboard-v5/index.html. Flip `bundled` to true when the
// .webm AND the .jpg are in dashboard-v5/media/ (the unit test fails until you do).
export const TRAILERS = [
  // bundled: true since Phase 5 installed both trailers (tools/trailer/encode.mjs --install, 2026-10-05)
  { id: 'hq-trailer-1', title: 'Trailer 1', src: 'media/hq-trailer-1.webm', poster: 'media/hq-trailer-1.jpg', bundled: true },
  { id: 'hq-trailer-2', title: 'Trailer 2', src: 'media/hq-trailer-2.webm', poster: 'media/hq-trailer-2.jpg', bundled: true },
];

// What changed in v5, in plain words. Only what this build really does: a line
// that depends on another package's work names the method that work adds
// (`needs`) and is left out when that method isn't there.
export const CHANGES = [
  { text: 'Commits are checked before anything is staged: a .env file anywhere in the change set, untracked folders included, blocks the commit.' },
  { text: 'In the run confirm, Enter never runs the automation from a focused button (Enter on Cancel cancels) or from a held-down key.' },
  { text: 'The prototype’s sample numbers are gone: the streak and the Library counts come from your scans, and estimates are labelled.' },
  { text: 'Scan now won’t start a second scan while one is running, and a running scan still shows after the window reloads.' },
  { text: 'Your theme carries over between v3 and v5, so switching back keeps it.' },
  { text: 'Ask keeps today’s chat and the sources you ticked where v3 keeps them, so switching back keeps them too.', needs: 'askInitState' },
  // Phase 3 (v3 parity), added by the Phase 3 review once each landed in this tree
  { text: 'Ask lets you pick the sources an answer may use, stop an answer and keep what it said so far, retry it, or start a new chat.', needs: 'stopAsk' },
  { text: 'System › Machine has Re-examine: a fresh health check without a full scan. An issue a fix ran on stays hidden until you re-examine.', needs: 'reexamine' },
  { text: 'Workspace clutter, and a project’s missing tests, CI, README or license, can be noted to your Ideas in one click (the window refreshes).', needs: 'saveIdea' },
  { text: 'A project’s Next lists its own side quests and the scan’s suggestions; its page shows every risk flag and its git risk.', needs: 'questTerminal' },
  { text: 'Canvas has ＋ Note: add a text note to one of your boards.', needs: 'addCanvasNote' },
  { text: 'Automations also lists the interactive Claude skills and commands (they use Claude quota), with kind, source and category filters and a Rescan.', needs: 'rescanLib' },
  { text: 'Projects can be searched by name or stack and filtered by status, and “capture <text>” in the command palette saves an idea.', needs: 'paletteCapture' },
];

// ---- pure helpers (unit-tested) ------------------------------------------------
// due = this version was never shown (or a different one was)
export const whatsNewDue = (prefs, version = WHATS_NEW_VERSION) => !prefs || prefs.whatsNewSeen !== version;
// prefs with this version marked seen; every other key kept
export const withWhatsNewSeen = (prefs, version = WHATS_NEW_VERSION) => Object.assign({}, prefs || {}, { whatsNewSeen: version });
// the change lines this build can honestly show (logic = the Component)
export const changesFor = (logic) => CHANGES.filter((c) => !c.needs || (logic && typeof logic[c.needs] === 'function')).map((c) => c.text);
// whether the window has focus right now (false outside a browser)
const windowFocused = () => { try { return typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus(); } catch { return false; } };

export const whatsNewLogic = {
  openWhatsNew() {
    this.stopWhatsNewWait();
    savePrefs(withWhatsNewSeen(loadPrefs()));
    this.setState({ whatsNewOpen: true, paletteOpen: false, moreOpen: false });
    FX().sfx('open');
  },
  closeWhatsNew() { this.setState({ whatsNewOpen: false }); },
  // the video's error event: the file is missing or won't play → the text fallback
  trailerFailed(id) { this.setState((s) => ({ whatsNewMissing: Object.assign({}, s.whatsNewMissing || {}, { [id]: true }) })); },

  // First launch of this version (componentDidMount). Not on the loading or error
  // screen. Opens now when the window has focus, else on its first focus event.
  // → true when it opened now
  maybeShowWhatsNew() {
    if (!whatsNewDue(loadPrefs())) return false;
    const ps = this.ps();
    if (ps === 'loading' || ps === 'error') return false;
    if (windowFocused()) { this.openWhatsNew(); return true; }
    if (!this._whatsNewWait && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._whatsNewWait = () => { this.stopWhatsNewWait(); if (whatsNewDue(loadPrefs())) this.openWhatsNew(); };
      window.addEventListener('focus', this._whatsNewWait);
    }
    return false;
  },
  stopWhatsNewWait() {
    if (!this._whatsNewWait) return;
    try { window.removeEventListener('focus', this._whatsNewWait); } catch {}
    this._whatsNewWait = null;
  },
};
